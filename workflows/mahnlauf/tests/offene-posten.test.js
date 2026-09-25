'use strict';
// Unterworkflow „Offene Posten lesen“ (Baustein 4, BAUPLAN g): Vertragsprüfung von Blättern
// und Spalten, Zeilen in die Vertragsform. Eingabe ist die Antwort der Sheets-API
// (values.get mit UNFORMATTED_VALUE + SERIAL_NUMBER): Daten als Seriennummer, Beträge als
// Zahl, Text als Text. Seriennummern und Beträge: gemessen in Baustein 1, Lauf 5414.
// Alle Werte erfunden (BAUPLAN j).
const test = require('node:test');
const assert = require('node:assert/strict');
const op = require('../kern/offene-posten.js');

const KOPF = ['Rechnungsnr.', 'Kunde', 'Kundentyp', 'E-Mail', 'Rechnungsdatum', 'Fälligkeit',
  'Betrag brutto', 'bezahlt bis jetzt', 'Verzugshinweis auf Rechnung', 'Mahnsperre',
  'Mahnsperre Grund', 'aktuelle Stufe', 'Datum letzte Stufe', 'Link zur Rechnungs-PDF',
  'Protokoll', 'Status', 'Freigabe', 'Entwurf-ID', 'Entwurf-Restbetrag', 'Versandstatus klären'];
const BLAETTER = ['Offene Posten', 'Einstellungen', 'Zahlungseingänge', 'Protokoll', 'Textbausteine', 'Basiszins'];
// 46266 = 01.09.2026, 46296 = 01.10.2026 (Lauf 5414)
function reihe(nr, abw) {
  const r = ['RE-2026-' + nr, 'Kunde Beispiel ' + String(nr).slice(-2), 'B2B', 'kunde-' + String(nr).slice(-2) + '@example.invalid',
    46266, 46296, 1234.56, '', 'nein', '', '', 0, '', '', '', '', '', '', '', ''];
  Object.entries(abw || {}).forEach(([k, v]) => { r[KOPF.indexOf(k)] = v; });
  return r;
}
function lies(werte, abw) {
  return op.leseOffenePosten(Object.assign({ blaetter: BLAETTER, zeitzone: 'Europe/Berlin', werte,
    quelle: { art: 'Sheet', tabelle_id: 'ZZ-TEST' }, stichtag: '2026-09-24' }, abw || {}));
}

test('Seriennummer → Datum (Werte aus Lauf 5414); Uhrzeitanteil zählt nicht; Text ist kein Datum', () => {
  assert.equal(op.seriennummerZuDatum(46266), '2026-09-01');
  assert.equal(op.seriennummerZuDatum(46388), '2027-01-01');
  assert.equal(op.seriennummerZuDatum(46296), '2026-10-01');
  assert.equal(op.seriennummerZuDatum(46266.99), '2026-09-01');
  assert.equal(op.seriennummerZuDatum('01.09.2026'), null);
  assert.equal(op.seriennummerZuDatum('2026-02-29'), null);
  assert.equal(op.seriennummerZuDatum(''), null);
  assert.equal(op.seriennummerZuDatum(true), null);
  assert.equal(op.seriennummerZuDatum(-3), null);
});

test('Betrag → ganze Cent (Werte aus Lauf 5414); Text ist kein Betrag', () => {
  assert.equal(op.betragZuCent(1234.56), 123456);
  assert.equal(op.betragZuCent(12.3), 1230);
  assert.equal(op.betragZuCent(0.01), 1);
  assert.equal(op.betragZuCent(1000000), 100000000);
  assert.equal(op.betragZuCent(-5), -500);
  assert.equal(op.betragZuCent('1.234,56'), null);
  assert.equal(op.betragZuCent(''), null);
});

test('Normalfall: eine Zeile in Vertragsform, Status ok, keine Hinweise', () => {
  const e = lies([KOPF, reihe(9001)]);
  assert.equal(e.status, 'ok');
  assert.equal(e.anzahl, 1);
  assert.deepEqual(e.meldungen, []);
  assert.deepEqual(e.posten[0], {
    rechnungsnr: 'RE-2026-9001', kunde: 'Kunde Beispiel 01', kundentyp: 'B2B',
    email: 'kunde-01@example.invalid', rechnungsdatum: '2026-09-01', faelligkeit: '2026-10-01',
    betrag_brutto_cent: 123456, verzugshinweis: 'nein', mahnsperre: '', mahnsperre_grund: '',
    pdf_ref: '', versandstatus_klaeren: '', quelle_id: 2, hinweise: [],
  });
});

test('T13 b) Spalte „Fälligkeit“ umbenannt → Status tabellenaufbau_falsch, kein Posten; Kontrolle richtige Kopfzeile → ok', () => {
  const kopf = KOPF.map((s) => (s === 'Fälligkeit' ? 'Fälligkeit (alt)' : s));
  const e = lies([kopf, reihe(9001)]);
  assert.equal(e.status, 'tabellenaufbau_falsch');
  assert.deepEqual(e.fehlend_spalten, ['Fälligkeit']);
  assert.deepEqual(e.posten, []);
  assert.equal(lies([KOPF, reihe(9001)]).status, 'ok');
});

test('T13 a) nur Kopfzeile → Status ok, 0 Posten; ganz leeres Blatt → tabellenaufbau_falsch', () => {
  const e = lies([KOPF]);
  assert.equal(e.status, 'ok');
  assert.equal(e.anzahl, 0);
  assert.deepEqual(e.posten, []);
  const leer = lies([]);
  assert.equal(leer.status, 'tabellenaufbau_falsch');
  assert.equal(leer.fehlend_spalten.length, KOPF.length);
});

test('Blatt fehlt → tabellenaufbau_falsch mit Namen; „Offene Posten“ fehlt → ebenso, auch ohne Werte', () => {
  const e = lies([KOPF, reihe(9001)], { blaetter: BLAETTER.filter((b) => b !== 'Protokoll') });
  assert.equal(e.status, 'tabellenaufbau_falsch');
  assert.deepEqual(e.fehlend_blaetter, ['Protokoll']);
  assert.deepEqual(e.posten, []);
  const o = lies(null, { blaetter: BLAETTER.filter((b) => b !== 'Offene Posten') });
  assert.equal(o.status, 'tabellenaufbau_falsch');
  assert.deepEqual(o.fehlend_blaetter, ['Offene Posten']);
});

test('Spalte doppelt → tabellenaufbau_falsch; zusätzliche Spalte am Ende ist erlaubt', () => {
  const d = lies([KOPF.concat(['Kunde']), reihe(9001)]);
  assert.equal(d.status, 'tabellenaufbau_falsch');
  assert.deepEqual(d.doppelte_spalten, ['Kunde']);
  const z = lies([KOPF.concat(['Notiz']), reihe(9001).concat(['frei'])]);
  assert.equal(z.status, 'ok');
});

test('Dublette → beide Zeilen mit Hinweis, gemeldet; Kontrolle eindeutige Nummer ohne Hinweis', () => {
  const e = lies([KOPF, reihe(9021), reihe(9001), reihe(9021, { 'Rechnungsnr.': 're 2026/9021' })]);
  assert.equal(e.status, 'ok');
  assert.deepEqual(e.posten.map((p) => p.hinweise.includes('Dublette')), [true, false, true]);
  assert.equal(e.meldungen.filter((m) => m.text === 'Dublette').length, 2);
  assert.deepEqual(e.meldungen.filter((m) => m.text === 'Dublette').map((m) => m.zeile), [2, 4]);
});

test('Kundentyp nicht B2B/B2C → Hinweis; Kontrolle B2C ohne Hinweis', () => {
  const e = lies([KOPF, reihe(9022, { Kundentyp: 'Privat' }), reihe(9002, { Kundentyp: 'B2C' })]);
  assert.deepEqual(e.posten[0].hinweise, ['Kundentyp ungültig']);
  assert.equal(e.posten[0].kundentyp, 'Privat');
  assert.deepEqual(e.posten[1].hinweise, []);
});

test('E-Mail leer oder ohne @ → Hinweis; Kontrolle gültige Adresse ohne Hinweis', () => {
  const e = lies([KOPF, reihe(9023, { 'E-Mail': '' }), reihe(9024, { 'E-Mail': 'kunde-24(at)example.invalid' }), reihe(9001)]);
  assert.deepEqual(e.posten.map((p) => p.hinweise), [['E-Mail fehlt oder ungültig'], ['E-Mail fehlt oder ungültig'], []]);
});

test('Datum als Text, Betrag als Text, Fälligkeit vor Rechnungsdatum → Hinweise, Werte leer bzw. null', () => {
  const e = lies([KOPF,
    reihe(9031, { Fälligkeit: '15.10.2026' }),
    reihe(9032, { 'Betrag brutto': '1.234,56' }),
    reihe(9033, { Rechnungsdatum: 46296, Fälligkeit: 46266 })]);
  assert.equal(e.posten[0].faelligkeit, '');
  assert.deepEqual(e.posten[0].hinweise, ['Fälligkeit ist kein Datum']);
  assert.equal(e.posten[1].betrag_brutto_cent, null);
  assert.deepEqual(e.posten[1].hinweise, ['Betrag brutto ist keine Zahl > 0']);
  assert.deepEqual(e.posten[2].hinweise, ['Fälligkeit liegt vor dem Rechnungsdatum']);
});

test('Leere Zeilen werden übersprungen, kurze Zeilen (API lässt leere Zellen am Ende weg) gelesen', () => {
  const kurz = ['RE-2026-9001', 'Kunde Beispiel 01', 'B2B', 'kunde-01@example.invalid', 46266, 46296, 1234.56];
  const e = lies([KOPF, [], kurz, ['', '', ''], reihe(9002)]);
  assert.equal(e.anzahl, 2);
  assert.deepEqual(e.posten.map((p) => p.quelle_id), [3, 5]);
  assert.equal(e.posten[0].verzugshinweis, '');
  assert.equal(e.posten[0].mahnsperre, '');
});

test('Zeitzone der Tabelle nicht Europe/Berlin → Meldung, Status bleibt ok', () => {
  const e = lies([KOPF, reihe(9001)], { zeitzone: 'Etc/GMT' });
  assert.equal(e.status, 'ok');
  assert.ok(e.meldungen.some((m) => /Zeitzone/.test(m.text) && /Etc\/GMT/.test(m.text)));
  assert.equal(lies([KOPF, reihe(9001)]).meldungen.length, 0);
});

test('Eingang: Quelle Sheet mit Tabelle → weiter; sevDesk → Status quelle_nicht_gebaut; Aufruffehler → Wurf', () => {
  const s = op.pruefeEingangOffenePosten({ quelle: { art: 'Sheet', tabelle_id: 'abc' }, stichtag: '2026-09-24' });
  assert.equal(s.weiter, true);
  assert.equal(s.tabelle_id, 'abc');
  const d = op.pruefeEingangOffenePosten({ quelle: { art: 'sevDesk' }, stichtag: '2026-09-24' });
  assert.equal(d.weiter, false);
  assert.equal(d.status, 'quelle_nicht_gebaut');
  assert.throws(() => op.pruefeEingangOffenePosten({ quelle: { art: 'Sheet' }, stichtag: '2026-09-24' }));
  assert.throws(() => op.pruefeEingangOffenePosten({ quelle: { art: 'Sheet', tabelle_id: 'abc' }, stichtag: '24.09.2026' }));
  assert.throws(() => op.pruefeEingangOffenePosten({ stichtag: '2026-09-24' }));
});

// Gemessen: Rohwerte der Test-Tabelle, Lauf 5547 (tests/testdaten/tabelle/testbetrieb-offene-posten.gelesen.json).
test('Test-Tabelle, wie gemessen gelesen (Lauf 5547): 17 Posten, Hinweise nur bei 9021 (zweimal), 9022, 9023', () => {
  const g = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'testdaten',
    'tabelle', 'testbetrieb-offene-posten.gelesen.json'), 'utf8'));
  // B10 A 4: Spalte „Versandstatus klären“ ist seit 25.09.2026 Pflicht; die gemessenen Werte stammen von davor.
  const e = lies([g.values[0].concat(['Versandstatus klären'])].concat(g.values.slice(1)));
  assert.equal(e.status, 'ok');
  assert.equal(e.anzahl, 17);
  const mitHinweis = e.posten.filter((p) => p.hinweise.length).map((p) => [p.rechnungsnr, p.quelle_id, p.hinweise]);
  assert.deepEqual(mitHinweis, [
    ['RE-2026-9021', 15, ['Dublette']], ['RE-2026-9021', 16, ['Dublette']],
    ['RE-2026-9022', 17, ['Kundentyp ungültig']], ['RE-2026-9023', 18, ['E-Mail fehlt oder ungültig']]]);
  const p9001 = e.posten.find((p) => p.rechnungsnr === 'RE-2026-9001');
  assert.deepEqual([p9001.rechnungsdatum, p9001.faelligkeit, p9001.betrag_brutto_cent, p9001.quelle_id],
    ['2026-09-01', '2026-09-29', 123456, 2]);
  const p9008 = e.posten.find((p) => p.rechnungsnr === 'RE-2026-9008');
  assert.deepEqual([p9008.mahnsperre, p9008.mahnsperre_grund], ['ja', 'Reklamation']);
});

// Auftrag 25.09.2026, Teil A 1: Kundentyp trimmen und in Großbuchstaben (b2b → B2B).
test('Kundentyp „b2b“, „ b2c “ → B2B/B2C ohne Hinweis; Kontrolle „Privat“ bleibt ungültig', () => {
  const e = lies([KOPF, reihe(9001, { Kundentyp: 'b2b' }), reihe(9002, { Kundentyp: ' b2c ' }), reihe(9022, { Kundentyp: 'Privat' })]);
  assert.deepEqual(e.posten.map((p) => [p.kundentyp, p.hinweise]),
    [['B2B', []], ['B2C', []], ['Privat', ['Kundentyp ungültig']]]);
});

// Baustein 10, Teil A 4: neue Spalte „Versandstatus klären“ (leer / versendet / nicht versendet), Kopfzeilenprüfung zieht mit.
test('B10 A 4: Spalte „Versandstatus klären“ ist Pflicht und wird je Posten gelesen; Kontrolle ohne Spalte → tabellenaufbau_falsch', () => {
  assert.equal(op.OP_SPALTEN[op.OP_SPALTEN.length - 1], 'Versandstatus klären');
  const k = KOPF.slice();
  const r = reihe(9009);
  r[k.indexOf('Versandstatus klären')] = ' nicht versendet ';
  const e = lies([k, r, reihe(9002)]);
  assert.equal(e.status, 'ok');
  assert.deepEqual(e.posten.map((p) => p.versandstatus_klaeren), ['nicht versendet', '']);
  const ohne = lies([k.slice(0, -1), reihe(9002).slice(0, -1)]);
  assert.deepEqual([ohne.status, ohne.fehlend_spalten], ['tabellenaufbau_falsch', ['Versandstatus klären']]);
});
