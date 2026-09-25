'use strict';
// Versand einer Rechnung (Baustein 7, BAUPLAN c und e 6): neu lesen, neu entscheiden, Sperre in der
// Data Table, Texte mit geprüften Platzhaltern, Empfänger im Modus test erzwungen, Zustand erst nach
// dem Versand. Grundlage ist die Test-Tabelle (tests/testdaten/tabelle/testbetrieb.json), hier in die
// Form umgerechnet, die die Sheets-API mit UNFORMATTED_VALUE/SERIAL_NUMBER liefert. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vs = require('../kern/versand.js');

const K = Object.assign({}, require('../kern/einstellungen.js'), require('../kern/offene-posten.js'), require('../kern/zahlungseingaenge.js'),
  require('../kern/zuordnung.js'), require('../kern/stufen.js'), require('../kern/hauptlauf.js'), require('../kern/platzhalter.js'), require('../kern/meldung.js'));

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'testdaten', 'tabelle', 'testbetrieb.json'), 'utf8'));
const blatt = (t) => fx.blaetter.find((b) => b.titel === t).zeilen;
const serial = (s) => { const [t, m, j] = s.split('.'); return (Date.UTC(+j, +m - 1, +t) - Date.UTC(1899, 11, 30)) / 86400000; };
const zahl = (s) => +String(s).replace(/\./g, '').replace(',', '.');
const TEST = 'test@example.invalid';

function opRoh() {
  const z = blatt('Offene Posten');
  return [z[0]].concat(z.slice(1).map((r) => r.map((v, i) => {
    if (v === '') return '';
    if (i === 4 || i === 5 || i === 12) return serial(v);
    if (i === 6 || i === 7 || i === 18) return zahl(v);
    if (i === 11) return +v;
    return v;
  })));
}

function einstRoh(abw) {
  const a = Object.assign({ 'Testempfänger': TEST, 'Absenderadresse': 'absender@example.invalid', 'Antwort an': 'antwort@example.invalid',
    'Meldeadresse Betrieb': 'betrieb@example.invalid', 'Stichtag (nur Test)': 46289, 'Modus': 'test' }, abw || {});
  return blatt('Einstellungen').map((z) => (Object.prototype.hasOwnProperty.call(a, z[0]) ? [z[0], a[z[0]]] : [z[0], z[1]]));
}

function textRoh(abw) {
  return blatt('Textbausteine').map((z, i) => (i === 0 ? z : [+z[0], z[1], z[2], z[3], (abw && abw[z[0] + z[2]]) || z[4]]));
}

const ZE = require('../kern/zahlungseingaenge.js').ZE_SPALTEN;
function werte(p) {
  p = p || {};
  const op = opRoh();
  if (p.op) p.op(op);
  return { einstellungen: einstRoh(p.einst), offene_posten: op, buch: [ZE].concat(p.buch || []), textbausteine: textRoh(p.texte) };
}
const zeileVon = (op, nr) => op.findIndex((r) => r[0] === nr);
const spalte = (name) => blatt('Offene Posten')[0].indexOf(name);

function eingang(abw) {
  return Object.assign({ tabelle_id: 'T', lauf_id: '900', lauf_start: '2026-09-25T08:00:00.000Z', modus: 'test', stichtag: '2026-09-24',
    sperre_tabelle_id: 'S', rechnungsnr: 'RE-2026-9009', quelle_id: 10, aktion: 'senden', stufe: 1 }, abw || {});
}

test('Eingang: Pflichtfelder und Aktion geprüft; Modus trocken ist ein Aufruffehler', () => {
  assert.equal(vs.pruefeEingangVersand(eingang()).rechnungsnr, 'RE-2026-9009');
  assert.throws(() => vs.pruefeEingangVersand(eingang({ modus: 'trocken' })), /Versand im Modus trocken/);
  assert.throws(() => vs.pruefeEingangVersand(eingang({ aktion: 'loeschen' })), /Aktion/);
  assert.throws(() => vs.pruefeEingangVersand(eingang({ quelle_id: 1 })), /quelle_id/);
});

test('Sperrschlüssel: Versand Rechnungsnr.|Stufe (BAUPLAN e 6.4), Entwurf mit Zusatz, Übergabe |4', () => {
  assert.equal(vs.sperrSchluessel('senden', 'RE-2026-9009', 1), 'RE-2026-9009|1');
  assert.equal(vs.sperrSchluessel('entwurf_senden', 'RE-2026-9013', 2), 'RE-2026-9013|2');
  assert.equal(vs.sperrSchluessel('entwurf_anlegen', 'RE-2026-9013', 2), 'RE-2026-9013|2|entwurf');
  assert.equal(vs.sperrSchluessel('entwurf_ersetzen', 'RE-2026-9013', 2, 'r-123'), 'RE-2026-9013|2|entwurf|r-123');
  assert.equal(vs.sperrSchluessel('uebergabe', 'RE-2026-9016', 4), 'RE-2026-9016|4');
  assert.equal(vs.sperrSchluessel('nichts', 'RE-2026-9016', 4), '');
});

test('Sperre: früheste Reservierung gewinnt; eine fremde frühere → übersprungen; versendet → erledigt', () => {
  const r = (id, aktion, lauf) => ({ id, aktion, lauf_id: lauf, schluessel: 'X' });
  assert.deepEqual(vs.sperreEntscheid([r(1, 'reserviert', '900'), r(2, 'reserviert', '901')], '900'), { weiter: true, grund: '', erledigt: null });
  assert.equal(vs.sperreEntscheid([r(1, 'reserviert', '900'), r(2, 'reserviert', '901')], '901').grund, 'übersprungen, anderer Lauf');
  const e = vs.sperreEntscheid([r(1, 'reserviert', '800'), r(2, 'versendet', '800'), r(3, 'reserviert', '900')], '900');
  assert.equal(e.weiter, false);
  assert.equal(e.grund, 'schon versendet');
  assert.equal(e.erledigt.id, 2);
  assert.equal(vs.sperreEntscheid([], '900').grund, 'keine Reservierung');
  assert.equal(vs.sperreEntscheid([r(2, 'reserviert', '900'), r(1, 'reserviert', '901')], '900').grund, 'übersprungen, anderer Lauf');
});

test('Neu entscheiden, Normalfall 9009: senden an den Testempfänger (nicht an kunde-09@example.invalid), Text mit 700,00', () => {
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: werte(), entwurf: null }, K);
  assert.equal(n.schritt, 'senden', n.grund);
  assert.equal(n.empfaenger, TEST);
  assert.equal(n.betreff, 'Zahlungserinnerung zur Rechnung RE-2026-9009');
  assert.match(n.text, /über 700,00 €/);
  assert.match(n.text, /offen sind 700,00 €/);
  assert.equal(n.sperre_schluessel, 'RE-2026-9009|1');
  assert.equal(n.zeile, 10);
});

test('Neu entscheiden: Mahnsperre erst nach Laufbeginn gesetzt → nichts, Grund nennt die neue Entscheidung', () => {
  const w = werte({ op: (op) => { op[zeileVon(op, 'RE-2026-9009')][spalte('Mahnsperre')] = 'ja'; } });
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: w, entwurf: null }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'geändert seit Laufbeginn: gesperrt');
});

test('Neu entscheiden: Zahlung ohne Nummer über den Rest kam dazu → Klärfall-Halt, nichts', () => {
  const w = werte({ buch: [['REF:N', 'N', 46288, 700, 'EUR', 'Fremd', 'DE00', 'Überweisung', '', 'a.csv', '', '', '', '', '', '']] });
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: w, entwurf: null }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'geändert seit Laufbeginn: klaerfall_halt');
});

test('Neu entscheiden: Teilzahlung lässt 3,00 offen → unter Mindestbetrag, nichts', () => {
  const w = werte({ buch: [['REF:T', 'T', 46288, 697, 'EUR', 'Kunde Beispiel 09', 'DE00', 'RE-2026-9009', '', 'a.csv', '', '', '', '', '', '']] });
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: w, entwurf: null }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'geändert seit Laufbeginn: unter_mindestbetrag');
});

test('T17: unbekannter Platzhalter {frist} → keine Mail, Meldung nennt den Platzhalter; Kontrolle B2B unverändert → senden', () => {
  const w = werte({ texte: { '1B2C': 'Bitte zahlen Sie bis {frist}.' } });
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: w, entwurf: null }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'Platzhalter unbekannt: frist');
  assert.deepEqual(n.meldungen, [{ rechnungsnr: 'RE-2026-9009', text: 'Textbaustein Stufe 1 B2C: Platzhalter unbekannt: frist – keine Mail' }]);
  const w2 = werte({ texte: { '1B2C': 'Bitte zahlen Sie bis {frist}.' }, op: (op) => { op[zeileVon(op, 'RE-2026-9009')][2] = 'B2B'; } });
  assert.equal(vs.neuEntscheiden({ eingang: eingang(), werte: w2, entwurf: null }, K).schritt, 'senden');
});

test('Zeile verschoben: an der Blattzeile steht eine andere Rechnungsnr. → nichts', () => {
  const n = vs.neuEntscheiden({ eingang: eingang({ quelle_id: 11 }), werte: werte(), entwurf: null }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'Zeile verschoben – an Zeile 11 steht RE-2026-9013');
});

// 9013: Stufe 1 seit 27.08., 1. Mahnung fällig → Entwurf. Mit Entwurf-ID und Freigabe → entwurf_senden.
function mitEntwurf(freigabe, restEuro) {
  return (op) => {
    const z = zeileVon(op, 'RE-2026-9013');
    op[z][spalte('Entwurf-ID')] = 'r-555';
    op[z][spalte('Entwurf-Restbetrag')] = restEuro === undefined ? 1500 : restEuro;
    op[z][spalte('Freigabe')] = freigabe;
  };
}

test('Entwurf anlegen 9013: 1. Mahnung, Empfänger Testempfänger, Sperrschlüssel mit |entwurf', () => {
  const n = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_anlegen', stufe: 2 }),
    werte: werte(), entwurf: null }, K);
  assert.equal(n.schritt, 'entwurf_anlegen', n.grund);
  assert.equal(n.betreff, '1. Mahnung zur Rechnung RE-2026-9013');
  assert.equal(n.empfaenger, TEST);
  assert.equal(n.sperre_schluessel, 'RE-2026-9013|2|entwurf');
  assert.equal(n.rest_cent, 150000);
});

test('Entwurf freigegeben, Entwurf vorhanden, To = Testempfänger → entwurf_senden', () => {
  const n = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_senden', stufe: 2 }),
    werte: werte({ op: mitEntwurf('ja') }), entwurf: { status: 200, to: [TEST] } }, K);
  assert.equal(n.schritt, 'entwurf_senden', n.grund);
  assert.equal(n.entwurf_id, 'r-555');
  assert.equal(n.sperre_schluessel, 'RE-2026-9013|2');
});

test('Modus test: Entwurf mit anderem Empfänger wird nicht gesendet, Meldung als Alarm', () => {
  const n = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_senden', stufe: 2 }),
    werte: werte({ op: mitEntwurf('ja') }), entwurf: { status: 200, to: ['kunde-13@example.invalid'] } }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'Modus test: Entwurf hat einen anderen Empfänger als den Testempfänger');
  assert.equal(n.alarm, true);
});

test('T18: Entwurf fehlt (404) → im Gesendet-Ordner suchen, mit erwartetem Betreff der Stufe', () => {
  const n = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'wartet', stufe: 2 }),
    werte: werte({ op: mitEntwurf('') }), entwurf: { status: 404, to: [] } }, K);
  assert.equal(n.schritt, 'hand_versand_suchen');
  assert.equal(n.betreff, '1. Mahnung zur Rechnung RE-2026-9013');
  assert.equal(n.stufe, 2);
});

test('Wartet, Entwurf vorhanden → nichts (kein Versand ohne Freigabe)', () => {
  const n = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'wartet', stufe: 2 }),
    werte: werte({ op: mitEntwurf('') }), entwurf: { status: 200, to: [TEST] } }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'wartet auf Freigabe');
});

test('T11 voll: 9013 ist bezahlt, Entwurf vorhanden → entwurf_verwerfen; T11 teil: Rest geändert → entwurf_ersetzen', () => {
  const voll = [['REF:V', 'V', 46288, 1500, 'EUR', 'Kunde Beispiel 13', 'DE00', 'RE-2026-9013', '', 'a.csv', '', '', '', '', '', '']];
  const n = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_verwerfen', stufe: 2 }),
    werte: werte({ op: mitEntwurf('ja'), buch: voll }), entwurf: { status: 200, to: [TEST] } }, K);
  assert.equal(n.schritt, 'entwurf_verwerfen', n.grund);
  const teil = [['REF:P', 'P', 46288, 500, 'EUR', 'Kunde Beispiel 13', 'DE00', 'RE-2026-9013', '', 'a.csv', '', '', '', '', '', '']];
  const m = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_ersetzen', stufe: 2 }),
    werte: werte({ op: mitEntwurf('ja'), buch: teil }), entwurf: { status: 200, to: [TEST] } }, K);
  assert.equal(m.schritt, 'entwurf_ersetzen', m.grund);
  assert.equal(m.alte_entwurf_id, 'r-555');
  assert.equal(m.rest_cent, 100000);
  assert.match(m.text, /Offener Betrag: 1\.000,00 €/);
  assert.equal(m.sperre_schluessel, 'RE-2026-9013|2|entwurf|r-555');
});

test('Zustand nach Versand: Stufe, Datum als Seriennummer, Protokoll, Status; Entwurfsfelder geleert', () => {
  const kopf = blatt('Offene Posten')[0];
  const z = vs.zustandNachVersand({ ergebnis: 'versendet', stufe: 1, datum: '2026-09-24', zeile: 10 }, kopf);
  assert.deepEqual(z, [
    { range: "'Offene Posten'!L10", values: [[1]] },
    { range: "'Offene Posten'!M10", values: [[46289]] },
    { range: "'Offene Posten'!O10", values: [['Zahlungserinnerung versendet 24.09.2026']] },
    { range: "'Offene Posten'!P10", values: [['offen']] },
    { range: "'Offene Posten'!Q10", values: [['']] },
    { range: "'Offene Posten'!R10", values: [['']] },
    { range: "'Offene Posten'!S10", values: [['']] },
  ]);
  const e = vs.zustandNachVersand({ ergebnis: 'entwurf_angelegt', stufe: 2, datum: '2026-09-24', zeile: 11, entwurf_id: 'r-9', rest_cent: 150000 }, kopf);
  assert.deepEqual(e.map((x) => x.range.slice(-3) + '=' + x.values[0][0]),
    ['O11=1. Mahnung Entwurf angelegt 24.09.2026', 'P11=wartet auf Freigabe', 'Q11=', 'R11=r-9', 'S11=1500']);
  const u = vs.zustandNachVersand({ ergebnis: 'uebergeben', stufe: 4, datum: '2026-11-04', zeile: 14 }, kopf);
  assert.deepEqual(u.map((x) => x.range.slice(-3) + '=' + x.values[0][0]),
    ['L14=4', 'M14=46330', 'O14=Übergabe an den Betrieb 04.11.2026', 'P14=übergeben']);
  assert.deepEqual(vs.zustandNachVersand({ ergebnis: 'nichts', zeile: 10 }, kopf), []);
});

test('Hand-Versand: Treffer im Gesendet-Ordner → Datum aus internalDate in Berliner Zeit', () => {
  assert.deepEqual(vs.handVersandAuswerten({ statusCode: 200, body: { messages: [{ id: 'm1' }] } },
    { statusCode: 200, body: { id: 'm1', internalDate: String(Date.UTC(2026, 8, 24, 22, 30)), labelIds: ['SENT'] } }, K),
  { gefunden: true, gmail_id: 'm1', datum: '2026-09-25' });
  assert.deepEqual(vs.handVersandAuswerten({ statusCode: 200, body: {} }, null, K), { gefunden: false, gmail_id: '', datum: '' });
  assert.throws(() => vs.handVersandAuswerten({ statusCode: 403, body: {} }, null, K), /Gesendet-Suche abgelehnt, HTTP 403/);
});

test('Nachprüfung im Gesendet-Ordner: Label SENT und To genau der erwartete Empfänger', () => {
  const ok = { statusCode: 200, body: { id: 'm2', labelIds: ['SENT'], payload: { headers: [{ name: 'To', value: 'Test <' + TEST + '>' }] } } };
  assert.deepEqual(vs.nachpruefung(ok, TEST), { im_gesendet: true, to_gleich_empfaenger: true, to_anzahl: 1 });
  const falsch = { statusCode: 200, body: { id: 'm2', labelIds: ['INBOX'], payload: { headers: [{ name: 'To', value: 'a@example.invalid, ' + TEST }] } } };
  assert.deepEqual(vs.nachpruefung(falsch, TEST), { im_gesendet: false, to_gleich_empfaenger: false, to_anzahl: 2 });
});

test('Entwurf lesen: 200 → Empfänger aus dem To-Kopf; 404 → fehlt; anderer Status ist unerwartet', () => {
  const a = vs.entwurfAuswerten({ statusCode: 200, body: { id: 'r-1', message: { payload: { headers: [{ name: 'To', value: '<' + TEST + '>' }] } } } });
  assert.deepEqual(a, { status: 200, to: [TEST] });
  assert.deepEqual(vs.entwurfAuswerten({ statusCode: 404, body: {} }), { status: 404, to: [] });
  assert.throws(() => vs.entwurfAuswerten({ statusCode: 500, body: {} }), /Entwurf lesen abgelehnt, HTTP 500/);
});

test('Sperre: „verworfen“ beginnt den Schlüssel neu – ein neuer Entwurf derselben Stufe ist wieder erlaubt', () => {
  const r = (id, aktion, lauf) => ({ id, aktion, lauf_id: lauf, schluessel: 'RE-2026-9013|2|entwurf' });
  const alt = [r(1, 'reserviert', '800'), r(2, 'angelegt', '800'), r(3, 'verworfen', '810')];
  assert.deepEqual(vs.sperreEntscheid(alt.concat([r(4, 'reserviert', '900')]), '900'), { weiter: true, grund: '', erledigt: null });
  assert.equal(vs.sperreEntscheid(alt.concat([r(4, 'reserviert', '901'), r(5, 'reserviert', '900')]), '900').grund, 'übersprungen, anderer Lauf');
  assert.equal(vs.sperreEntscheid([r(1, 'reserviert', '800'), r(2, 'angelegt', '800'), r(3, 'reserviert', '900')], '900').grund, 'schon angelegt');
  assert.equal(vs.sperrSchluessel('entwurf_verwerfen', 'RE-2026-9013', 2), 'RE-2026-9013|2|entwurf');
});

// ------------------------------------------------------------------ Nachbau Teil B (25.09.2026)
const PDF = JSON.parse(fs.readFileSync(path.join(__dirname, 'testdaten', 'drive-pdf.json'), 'utf8')).dateien;

test('B 1: Neu entscheiden liefert Absendername und -adresse aus dem Einstellungsblatt und den Betreff zum Suchen', () => {
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: werte(), entwurf: null }, K);
  assert.equal(n.schritt, 'senden', n.grund);
  assert.equal(n.von_name, 'Tischlerei Beispiel GmbH (Test)');
  assert.equal(n.von_adresse, 'absender@example.invalid');
  assert.equal(n.antwort_an, 'antwort@example.invalid');
  assert.equal(n.such_betreff, 'Zahlungserinnerung zur Rechnung RE-2026-9009');
  const f = vs.neuEntscheiden({ eingang: eingang(), werte: werte({ einst: { 'Absenderadresse': 'kaputt' } }), entwurf: null }, K);
  assert.equal(f.schritt, 'nichts');
  assert.equal(f.grund, 'Absenderadresse fehlt oder ungültig');
  assert.equal(f.alarm, true);
});

test('B 6: PDF anhängen = ja und Link gesetzt → Drive-ID der PDF; nein → keine; Entwurf senden braucht keine (sie steckt im Entwurf)', () => {
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: werte(), entwurf: null }, K);
  assert.equal(n.pdf_id, PDF['RE-2026-9009.pdf']);
  const nein = vs.neuEntscheiden({ eingang: eingang(), werte: werte({ einst: { 'PDF anhängen': 'nein' } }), entwurf: null }, K);
  assert.equal(nein.schritt, 'senden');
  assert.equal(nein.pdf_id, '');
  const es = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_senden', stufe: 2 }),
    werte: werte({ op: mitEntwurf('ja') }), entwurf: { status: 200, to: [TEST] } }, K);
  assert.equal(es.schritt, 'entwurf_senden');
  assert.equal(es.pdf_id, '');
  assert.equal(es.such_betreff, '1. Mahnung zur Rechnung RE-2026-9013');
  const ea = vs.neuEntscheiden({ eingang: eingang({ rechnungsnr: 'RE-2026-9013', quelle_id: 11, aktion: 'entwurf_anlegen', stufe: 2 }),
    werte: werte(), entwurf: null }, K);
  assert.equal(ea.pdf_id, PDF['RE-2026-9013.pdf']);
});

test('B 6: Link leer oder unlesbar → kein Versand, Meldung; PDF anhängen mit unbekanntem Wert → kein Versand, Alarm', () => {
  const leer = vs.neuEntscheiden({ eingang: eingang(), werte: werte({ op: (op) => { op[zeileVon(op, 'RE-2026-9009')][spalte('Link zur Rechnungs-PDF')] = ''; } }), entwurf: null }, K);
  assert.equal(leer.schritt, 'nichts');
  assert.equal(leer.grund, 'PDF fehlt – Link zur Rechnungs-PDF leer');
  assert.equal(leer.alarm, false);
  assert.deepEqual(leer.meldungen, [{ rechnungsnr: 'RE-2026-9009', text: 'PDF fehlt – Link zur Rechnungs-PDF leer – keine Mail' }]);
  const kaputt = vs.neuEntscheiden({ eingang: eingang(), werte: werte({ op: (op) => { op[zeileVon(op, 'RE-2026-9009')][spalte('Link zur Rechnungs-PDF')] = 'siehe Ordner'; } }), entwurf: null }, K);
  assert.equal(kaputt.grund, 'PDF-Link unlesbar');
  const unbekannt = vs.neuEntscheiden({ eingang: eingang(), werte: werte({ einst: { 'PDF anhängen': 'vielleicht' } }), entwurf: null }, K);
  assert.equal(unbekannt.schritt, 'nichts');
  assert.equal(unbekannt.grund, 'Einstellung PDF anhängen ungültig – vielleicht');
  assert.equal(unbekannt.alarm, true);
});

test('B 6: Drive-ID aus den üblichen Linkformen', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-012';
  assert.equal(vs.pdfIdAusLink('https://drive.google.com/file/d/' + id + '/view?usp=sharing'), id);
  assert.equal(vs.pdfIdAusLink('https://drive.google.com/open?id=' + id), id);
  assert.equal(vs.pdfIdAusLink('https://drive.google.com/uc?export=download&id=' + id), id);
  assert.equal(vs.pdfIdAusLink(id), id);
  assert.equal(vs.pdfIdAusLink('siehe Ordner'), '');
  assert.equal(vs.pdfIdAusLink(''), '');
});

test('B 6: PDF prüfen – Metadaten (Drive files.get) und Inhalt; alles andere als eine lesbare PDF ist ein Fehler', () => {
  const m = (st, b) => vs.pdfMetaPruefen({ statusCode: st, body: b }, 3000000);
  assert.deepEqual(m(200, { id: 'x', name: 'RE.pdf', mimeType: 'application/pdf', size: '625', trashed: false }), { ok: true, grund: '', name: 'RE.pdf', bytes: 625 });
  assert.equal(m(404, { error: {} }).grund, 'PDF nicht gefunden');
  assert.equal(m(403, {}).grund, 'PDF nicht lesbar, HTTP 403');
  assert.equal(m(200, { mimeType: 'application/pdf', size: '625', trashed: true }).grund, 'PDF im Papierkorb');
  assert.equal(m(200, { mimeType: 'text/plain', size: '62', trashed: false }).grund, 'Datei ist keine PDF (text/plain)');
  assert.equal(m(200, { mimeType: 'application/pdf', size: '0', trashed: false }).grund, 'PDF leer');
  assert.equal(m(200, { mimeType: 'application/pdf', size: '3000001', trashed: false }).grund, 'PDF zu groß (3000001 Byte, erlaubt 3000000)');
  assert.deepEqual(vs.pdfInhaltPruefen(Buffer.from('%PDF-1.4\nx', 'latin1'), 3000000), { ok: true, grund: '' });
  assert.equal(vs.pdfInhaltPruefen(Buffer.from('Keine PDF', 'latin1'), 3000000).grund, 'Datei beginnt nicht mit %PDF-');
  assert.equal(vs.pdfInhaltPruefen([], 3000000).grund, 'PDF leer');
});

test('Teil A 9 im Versand: frisch gelesene Textbausteine ohne {rechnungsnr} im Betreff → nichts, Alarm', () => {
  const w = werte();
  w.textbausteine[1][3] = 'Zahlungserinnerung';
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: w, entwurf: null }, K);
  assert.equal(n.schritt, 'nichts');
  assert.equal(n.grund, 'Textbausteine ungültig – Stufe 1 B2B: Betreff ohne {rechnungsnr}');
  assert.equal(n.alarm, true);
});

// B 4: Reservierung eines abgebrochenen Laufs. „Älter als der laufende Lauf“ = anderer Lauf UND zeit_utc vor dem Beginn
// dieses Laufs. Eine gleichzeitige Reservierung (T10 b) liegt NACH dem eigenen Beginn und bleibt „übersprungen“.
const START = '2026-09-25T12:00:00.000Z';
const rz = (id, aktion, lauf, zeit, x) => Object.assign({ id, aktion, lauf_id: lauf, schluessel: 'RE-2026-9009|1', zeit_utc: zeit }, x || {});
const ALT = '2026-09-24T06:00:05.000Z';

test('B 4 Sperre: fremde Reservierung von vor dem Laufbeginn ohne versendet → abgebrochener Lauf; Kontrolle gleichzeitiger Lauf → übersprungen', () => {
  const tot = vs.sperreEntscheid([rz(1, 'reserviert', '800', ALT), rz(2, 'reserviert', '900', '2026-09-25T12:00:03.000Z')], '900', START);
  assert.deepEqual(tot, { weiter: false, grund: 'Reservierung eines abgebrochenen Laufs', erledigt: null, tot: rz(1, 'reserviert', '800', ALT) });
  const gleichzeitig = vs.sperreEntscheid([rz(1, 'reserviert', '901', '2026-09-25T12:00:02.000Z'), rz(2, 'reserviert', '900', '2026-09-25T12:00:03.000Z')], '900', START);
  assert.equal(gleichzeitig.grund, 'übersprungen, anderer Lauf');
  assert.equal(vs.sperreEntscheid([rz(1, 'reserviert', '800', ALT), rz(2, 'versendet', '800', ALT), rz(3, 'reserviert', '900', START)], '900', START).grund, 'schon versendet');
  assert.equal(vs.sperreEntscheid([rz(1, 'reserviert', '800', ALT), rz(2, 'reserviert', '900', START)], '900').grund, 'übersprungen, anderer Lauf');
});

test('B 4 Sperre: „zurueckgegeben“ beginnt den Schlüssel neu (nichts versendet, Reservierung freigegeben)', () => {
  assert.deepEqual(vs.sperreEntscheid([rz(1, 'reserviert', '800', ALT), rz(2, 'zurueckgegeben', '800', ALT), rz(3, 'reserviert', '900', START)], '900', START),
    { weiter: true, grund: '', erledigt: null });
});

test('B 4 Schritt nach der Sperre: abgebrochener Lauf → senden und Entwurf senden suchen im Gesendet-Ordner ab der Reservierung; Entwurf anlegen sucht Entwürfe; Übergabe läuft weiter', () => {
  const s = { weiter: false, grund: 'Reservierung eines abgebrochenen Laufs', erledigt: null, tot: rz(1, 'reserviert', '800', ALT) };
  const n = { schritt: 'senden', such_betreff: 'Zahlungserinnerung zur Rechnung RE-2026-9009', stufe: 1, rechnungsnr: 'RE-2026-9009' };
  const k = vs.schrittNachSperre(n, s);
  assert.equal(k.schritt, 'versand_klaeren');
  assert.equal(k.grund, 'Reservierung eines abgebrochenen Laufs (Lauf 800) – im Gesendet-Ordner suchen');
  assert.equal(k.such_q, 'in:sent subject:"Zahlungserinnerung zur Rechnung RE-2026-9009" after:' + (Date.parse(ALT) / 1000 - 60));
  assert.equal(k.tot_lauf, '800');
  assert.equal(vs.schrittNachSperre(Object.assign({}, n, { schritt: 'entwurf_senden' }), s).schritt, 'versand_klaeren');
  const e = vs.schrittNachSperre(Object.assign({}, n, { schritt: 'entwurf_anlegen', such_betreff: '1. Mahnung zur Rechnung RE-2026-9013' }), s);
  assert.equal(e.schritt, 'entwurf_klaeren');
  assert.equal(e.such_q, 'subject:"1. Mahnung zur Rechnung RE-2026-9013"');
  assert.equal(vs.schrittNachSperre(Object.assign({}, n, { schritt: 'uebergabe' }), s).schritt, 'uebergabe');
  assert.equal(vs.schrittNachSperre(n, { weiter: true, grund: '', erledigt: null }).schritt, 'senden');
  const v = vs.schrittNachSperre(n, { weiter: false, grund: 'schon versendet', erledigt: { aktion: 'versendet', gmail_id: 'm1', datum: '2026-09-24' } });
  assert.deepEqual([v.schritt, v.erledigt], ['nachziehen', { gmail_id: 'm1', datum: '2026-09-24' }]);
  const u = vs.schrittNachSperre(n, { weiter: false, grund: 'übersprungen, anderer Lauf', erledigt: null });
  assert.deepEqual([u.schritt, u.alarm], ['nichts', false]);
  assert.deepEqual([vs.schrittNachSperre(n, { weiter: false, grund: 'keine Reservierung', erledigt: null }).alarm], [true]);
});

test('B 4: Entwurf-Suche auswerten; Zustand „Versandstatus unklar“ → Status Klärfall, Stufe bleibt', () => {
  assert.deepEqual(vs.entwurfSucheAuswerten({ statusCode: 200, body: { drafts: [{ id: 'r-7', message: { id: 'm7' } }] } }), { gefunden: true, entwurf_id: 'r-7' });
  assert.deepEqual(vs.entwurfSucheAuswerten({ statusCode: 200, body: { resultSizeEstimate: 0 } }), { gefunden: false, entwurf_id: '' });
  assert.throws(() => vs.entwurfSucheAuswerten({ statusCode: 401, body: {} }), /Entwurf-Suche abgelehnt, HTTP 401/);
  const kopf = blatt('Offene Posten')[0];
  const z = vs.zustandNachVersand({ ergebnis: 'versand_unklar', stufe: 1, datum: '2026-09-25', zeile: 10 }, kopf);
  assert.deepEqual(z.map((x) => x.range.slice(-3) + '=' + x.values[0][0]),
    ['O10=Versandstatus unklar – Zahlungserinnerung nicht bestätigt 25.09.2026 – bitte „Versandstatus klären“ setzen', 'P10=Klärfall']);
});

test('B 4: Eingang braucht den Laufbeginn', () => {
  assert.throws(() => vs.pruefeEingangVersand(eingang({ lauf_start: '' })), /Eingang ohne lauf_start/);
  assert.equal(vs.pruefeEingangVersand(eingang()).lauf_start, '2026-09-25T08:00:00.000Z');
});

// Baustein 10, Teil A 4 (Entscheidung Elias 25.09.2026): Spalte „Versandstatus klären“ (leer / versendet / nicht versendet).
// versendet → Stufe und Datum nachziehen, Datum = Tag des verarbeitenden Laufs (Rückfrage 25.09.: die Sheets-API kennt kein
// Bearbeitungsdatum je Zelle); nicht versendet → Schlüssel zurückgeben, der nächste Lauf entscheidet normal. Danach Zelle leeren.
const KL = (wert, zeilen, stufe) => vs.klaereVersandstatus(wert, stufe === undefined ? 0 : stufe, 'RE-2026-9009', zeilen, '900', START, '2026-09-25');
test('B10 A 4: versendet + Reservierung eines abgebrochenen Laufs → nachziehen mit dem Tag des Laufs, Eintrag versendet', () => {
  assert.deepEqual(KL('versendet', [rz(1, 'reserviert', '800', ALT), rz(2, 'reserviert', '1', ALT, { schluessel: 'RE-2026-9009|2' })]), {
    aktion: 'versandstatus_versendet', stufe: 1, schluessel: 'RE-2026-9009|1', datum: '2026-09-25',
    grund: 'Versandstatus geklärt: versendet – Stufe nachgezogen', eintrag: { aktion: 'versendet', datum: '2026-09-25' } });
  // Eintrag steht schon (Blatt damals nicht geschrieben): nachziehen mit dem Datum von dort, kein zweiter Eintrag
  const schon = KL(' Versendet ', [rz(1, 'reserviert', '800', ALT), rz(2, 'versendet', '901', ALT, { datum: '2026-09-24' })]);
  assert.deepEqual([schon.aktion, schon.datum, schon.eintrag], ['versandstatus_versendet', '2026-09-24', null]);
});

test('B10 A 4: versendet ohne offene Reservierung, unbekannter Wert, Stufe 3 → Hinweis, nichts geändert', () => {
  assert.deepEqual(KL('versendet', []), { aktion: 'hinweis', stufe: 1, schluessel: 'RE-2026-9009|1', datum: '', eintrag: null,
    grund: 'Versandstatus klären ohne offene Reservierung – nichts geändert' });
  assert.equal(KL('versendet', [rz(1, 'reserviert', '901', '2026-09-25T12:00:02.000Z')]).aktion, 'hinweis');
  assert.equal(KL('vielleicht', [rz(1, 'reserviert', '800', ALT)]).grund,
    'Versandstatus klären: Wert „vielleicht“ unbekannt (erlaubt: versendet, nicht versendet)');
  assert.equal(KL('versendet', [rz(1, 'reserviert', '800', ALT, { schluessel: 'RE-2026-9009|4' })], 3).grund,
    'Versandstatus klären nur für Stufe 1 bis 3');
  assert.equal(KL('', [rz(1, 'reserviert', '800', ALT)]), null);
});

test('B10 A 4: nicht versendet → Schlüssel zurückgeben; ohne Reservierung nur Zelle leeren; widerspricht einer Versandbestätigung → Hinweis', () => {
  const z = KL('nicht versendet', [rz(1, 'reserviert', '800', ALT)]);
  assert.deepEqual(z, { aktion: 'versandstatus_zurueck', stufe: 1, schluessel: 'RE-2026-9009|1', datum: '2026-09-25',
    grund: 'Versandstatus geklärt: nicht versendet – Reservierung zurückgegeben, nächster Lauf entscheidet neu',
    eintrag: { aktion: 'zurueckgegeben', datum: '2026-09-25' } });
  const leer = KL('nicht versendet', [rz(1, 'reserviert', '800', ALT), rz(2, 'zurueckgegeben', '901', ALT)]);
  assert.deepEqual([leer.aktion, leer.eintrag], ['versandstatus_zurueck', null]);
  assert.equal(KL('nicht versendet', [rz(1, 'reserviert', '800', ALT), rz(2, 'versendet', '800', ALT)]).grund,
    'Versandstatus klären „nicht versendet“ widerspricht der Versandbestätigung – nichts geändert');
  assert.equal(KL('nicht versendet', [rz(1, 'reserviert', '901', '2026-09-25T12:00:02.000Z')]).aktion, 'hinweis');
});

test('B10 A 4: Klärungen je Rechnung; ohne Data Table (Modus trocken) → Hinweis, nicht verarbeitet', () => {
  const r = [{ rechnungsnr: 'RE-2026-9009', aktuelle_stufe: 0, versandstatus_klaeren: 'versendet' },
    { rechnungsnr: 'RE-2026-9006', aktuelle_stufe: 0, versandstatus_klaeren: '' }];
  const mit = vs.versandstatusKlaerungen(r, [rz(1, 'reserviert', '800', ALT)], '900', START, '2026-09-25');
  assert.equal(mit[0].versandstatus_klaerung.aktion, 'versandstatus_versendet');
  assert.equal(mit[1].versandstatus_klaerung, undefined);
  assert.equal(r[0].versandstatus_klaerung, undefined);
  const trocken = vs.versandstatusKlaerungen(r, null, '900', START, '2026-09-25');
  assert.deepEqual(trocken[0].versandstatus_klaerung, { aktion: 'hinweis', grund: 'Versandstatus klären: im Modus trocken nicht verarbeitet' });
});

test('B10 A 4: Schreibauftrag – versendet: Stufe, Datum, Protokoll, Entwurfsfelder und T leeren; zurück: Protokoll und T; Einträge für die Data Table', () => {
  const kopf = blatt('Offene Posten')[0];
  assert.equal(kopf[19], 'Versandstatus klären');
  const posten = [{ rechnungsnr: 'RE-2026-9009', quelle_id: 10 }, { rechnungsnr: 'RE-2026-9006', quelle_id: 7 }, { rechnungsnr: 'RE-2026-9002', quelle_id: 3 }];
  const ent = [
    { rechnungsnr: 'RE-2026-9009', aktion: 'versandstatus_versendet', stufe: 1, klaerung: KL('versendet', [rz(1, 'reserviert', '800', ALT)]) },
    { rechnungsnr: 'RE-2026-9006', aktion: 'versandstatus_zurueck', stufe: 1,
      klaerung: vs.klaereVersandstatus('nicht versendet', 0, 'RE-2026-9006', [rz(1, 'reserviert', '800', ALT, { schluessel: 'RE-2026-9006|1' })], '900', START, '2026-09-25') },
    { rechnungsnr: 'RE-2026-9002', aktion: 'senden', stufe: 1 }];
  const a = vs.versandstatusAuftrag(posten, ent, kopf, '900');
  assert.deepEqual(a.data.map((x) => x.range.replace("'Offene Posten'!", '') + '=' + x.values[0][0]), [
    'L10=1', 'M10=46290', 'O10=Zahlungserinnerung versendet 25.09.2026 (Versandstatus geklärt)', 'Q10=', 'R10=', 'S10=', 'T10=',
    'O7=Versandstatus geklärt: nicht versendet 25.09.2026 – nächster Lauf entscheidet neu', 'T7=']);
  assert.deepEqual(a.eintraege, [
    { schluessel: 'RE-2026-9009|1', aktion: 'versendet', lauf_id: '900', rechnungsnr: 'RE-2026-9009', stufe: 1, gmail_id: '', datum: '2026-09-25' },
    { schluessel: 'RE-2026-9006|1', aktion: 'zurueckgegeben', lauf_id: '900', rechnungsnr: 'RE-2026-9006', stufe: 1, gmail_id: '', datum: '2026-09-25' }]);
  assert.deepEqual(vs.versandstatusAuftrag(posten, [ent[2]], kopf, '900'), { data: [], eintraege: [] });
});

test('B10 A 4: „Versandstatus klären“ nach Laufbeginn gesetzt → der Versand sendet nicht (geändert seit Laufbeginn)', () => {
  const w = werte({ op: (op) => { op[zeileVon(op, 'RE-2026-9009')][spalte('Versandstatus klären')] = 'versendet'; } });
  const n = vs.neuEntscheiden({ eingang: eingang(), werte: w, entwurf: null }, K);
  assert.deepEqual([n.schritt, n.grund], ['nichts', 'geändert seit Laufbeginn: hinweis']);
});
