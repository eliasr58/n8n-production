'use strict';
// Hauptlauf (Baustein 6, Modus trocken): Zustandsspalten aus „Offene Posten“ lesen, Posten + Zustand +
// Zahlstand zu Rechnungen für planeLauf zusammensetzen, Protokollzeilen bauen. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const hl = require('../kern/hauptlauf.js');
const op = require('../kern/offene-posten.js');
const st = require('../kern/stufen.js');

const KOPF = op.OP_SPALTEN;
function reihe(nr, abw) {
  const r = ['RE-2026-' + nr, 'Kunde Beispiel ' + String(nr).slice(-2), 'B2B', 'kunde-' + String(nr).slice(-2) + '@example.invalid',
    46266, 46281, 1000, '', 'nein', '', '', 0, '', '', '', '', '', '', ''];
  Object.entries(abw || {}).forEach(([k, v]) => { r[KOPF.indexOf(k)] = v; });
  return r;
}

test('Zustand lesen: aktuelle Stufe, Datum letzte Stufe (Seriennummer), Freigabe, Entwurf; je Blattzeile', () => {
  const z = hl.leseZustand([KOPF, reihe(9001), reihe(9013, { 'aktuelle Stufe': 1, 'Datum letzte Stufe': 46261, Freigabe: 'ja',
    'Entwurf-ID': 'r-1', 'Entwurf-Restbetrag': 1500 }), [], reihe(9016, { 'aktuelle Stufe': '' })]);
  assert.deepEqual(z[2], { rechnungsnr: 'RE-2026-9001', aktuelle_stufe: 0, datum_letzte_stufe: '', freigabe: '', entwurf_id: '', entwurf_rest_cent: null, status: '' });
  assert.deepEqual(z[3], { rechnungsnr: 'RE-2026-9013', aktuelle_stufe: 1, datum_letzte_stufe: '2026-08-27', freigabe: 'ja', entwurf_id: 'r-1', entwurf_rest_cent: 150000, status: '' });
  assert.equal(z[4], undefined);
  assert.equal(z[5].aktuelle_stufe, '');
});

test('Rechnungen: Posten + Zustand je quelle_id; fehlt der Zustand oder steht dort eine andere Rechnungsnr. → Hinweis (nie versendet)', () => {
  const posten = [{ rechnungsnr: 'RE-2026-9013', kunde: 'K', kundentyp: 'B2B', email: 'a@example.invalid', rechnungsdatum: '2026-08-06',
    faelligkeit: '2026-08-20', betrag_brutto_cent: 150000, verzugshinweis: 'nein', mahnsperre: '', mahnsperre_grund: '', pdf_ref: '',
    quelle_id: 3, hinweise: [] }, { rechnungsnr: 'RE-2026-9099', quelle_id: 9, hinweise: ['Dublette'] }];
  const r = hl.baueRechnungen(posten, { 3: { rechnungsnr: 'RE-2026-9013', aktuelle_stufe: 1, datum_letzte_stufe: '2026-08-27', freigabe: '',
    entwurf_id: '', entwurf_rest_cent: null, status: '' }, 9: { rechnungsnr: 'RE-2026-9098', aktuelle_stufe: 0 } });
  assert.equal(r[0].aktuelle_stufe, 1);
  assert.equal(r[0].datum_letzte_stufe, '2026-08-27');
  assert.equal(r[0].betrag_brutto_cent, 150000);
  assert.deepEqual(r[0].hinweise, []);
  assert.equal(r[1].aktuelle_stufe, undefined);
  assert.deepEqual(r[1].hinweise, ['Dublette', 'Zustand nicht lesbar (Zeile verschoben?)']);
  assert.deepEqual(hl.baueRechnungen([posten[0]], {})[0].hinweise, ['Zustand nicht lesbar (Zeile verschoben?)']);
});

test('Protokollzeilen: je Entscheidung eine Zeile, Idempotenzschlüssel nur bei Versandaktionen, Alarme als eigene Zeilen', () => {
  const plan = {
    entscheidungen: [
      { rechnungsnr: 'RE-2026-9002', aktion: 'senden', stufe_vorher: 0, stufe: 1, rest_cent: 85000, grund: 'Zahlungserinnerung fällig' },
      { rechnungsnr: 'RE-2026-9008', aktion: 'gesperrt', stufe_vorher: 0, stufe: null, rest_cent: 70000, grund: 'gesperrt' }],
    alarme: [{ art: 'Mengenbremse', text: '25 Vorgänge fällig, Höchstzahl 20' }],
    protokoll: [],
  };
  const z = hl.protokollZeilen(plan, { lauf_id: '5600', modus: 'trocken', zeit_utc: '2026-09-25T00:10:00.000Z', zeit_berlin: '25.09.2026 02:10:00' });
  assert.deepEqual(z[0], ['2026-09-25T00:10:00.000Z', '25.09.2026 02:10:00', '5600', 'trocken', 'RE-2026-9002', 'senden', 0, 1, 850,
    'Zahlungserinnerung fällig', '', 'RE-2026-9002|1']);
  assert.deepEqual(z[1].slice(4, 12), ['RE-2026-9008', 'gesperrt', 0, '', 700, 'gesperrt', '', '']);
  assert.deepEqual(z[2].slice(4, 12), ['', 'alarm', '', '', '', 'Mengenbremse: 25 Vorgänge fällig, Höchstzahl 20', '', '']);
  const leer = hl.protokollZeilen({ entscheidungen: [], alarme: [], protokoll: [{ rechnungsnr: '', aktion: 'keine', grund: '0 offene Posten' }] },
    { lauf_id: '5601', modus: 'trocken', zeit_utc: 'u', zeit_berlin: 'b' });
  assert.deepEqual(leer, [['u', 'b', '5601', 'trocken', '', 'keine', '', '', '', '0 offene Posten', '', '']]);
});

test('Kette Hauptlauf trocken: Posten aus Blattwerten → Zustand → planeLauf; Zeile mit Hinweis nie im Versand', () => {
  const werte = [KOPF, reihe(9002), reihe(9031, { Fälligkeit: 46260, Rechnungsdatum: 46266 }), reihe(9008, { Mahnsperre: 'ja', 'Mahnsperre Grund': 'Reklamation' })];
  const p = op.leseOffenePosten({ blaetter: ['Offene Posten', 'Einstellungen', 'Zahlungseingänge', 'Protokoll', 'Textbausteine'],
    zeitzone: 'Europe/Berlin', werte, quelle: { art: 'Sheet', tabelle_id: 'x' }, stichtag: '2026-09-24' });
  const rechnungen = hl.baueRechnungen(p.posten, hl.leseZustand(werte));
  const zahlstand = rechnungen.map((r) => ({ rechnungsnr: r.rechnungsnr, bezahlt_cent: 0, rest_cent: r.betrag_brutto_cent, status: 'offen',
    ueberschuss_cent: 0, klaerfall_halt: false, dublette: false }));
  const plan = st.planeLauf({ kopfzeile: st.STUFEN_PFLICHTSPALTEN, rechnungen: st.mitZahlstand(rechnungen, zahlstand), stichtag: '2026-09-24',
    auszugStand: '2026-09-23', einstellungen: { intervall_erinnerung: 7, intervall_mahnung1: 14, intervall_letzte_mahnung: 14,
      intervall_uebergabe: 14, freigabemodus_erinnerung: 'automatisch', freigabemodus_mahnung1: 'Entwurf',
      freigabemodus_letzte_mahnung: 'Entwurf', max_alter_auszug: 3, mindestbetrag_cent: 500, hoechstzahl_mails: 20 } });
  assert.deepEqual(plan.entscheidungen.map((d) => [d.rechnungsnr, d.aktion]),
    [['RE-2026-9002', 'senden'], ['RE-2026-9031', 'hinweis'], ['RE-2026-9008', 'gesperrt']]);
});

test('Berliner Zeit aus UTC: Datum für „heute“ und Text fürs Protokoll, Sommer- und Winterzeit, Tageswechsel', () => {
  assert.deepEqual(hl.berlinZeit('2026-09-24T23:30:05.123Z'), { datum: '2026-09-25', text: '25.09.2026 01:30:05' });
  assert.deepEqual(hl.berlinZeit('2026-09-24T21:59:59.000Z'), { datum: '2026-09-24', text: '24.09.2026 23:59:59' });
  assert.deepEqual(hl.berlinZeit('2026-12-31T23:30:00.000Z'), { datum: '2027-01-01', text: '01.01.2027 00:30:00' });
  assert.deepEqual(hl.berlinZeit('2026-03-29T00:59:59.000Z'), { datum: '2026-03-29', text: '29.03.2026 01:59:59' });
  assert.deepEqual(hl.berlinZeit('2026-03-29T01:00:00.000Z'), { datum: '2026-03-29', text: '29.03.2026 03:00:00' });
  assert.throws(() => hl.berlinZeit('24.09.2026'));
});

// Teil A 10 (Entscheidung Elias 25.09.2026): „bezahlt bis jetzt“ (H) und „Status“ (P) für ALLE Zeilen, je Spalte ein Bereich.
test('Teil A 10: Status je Zeile aus Zahlstand und Entscheidung', () => {
  const s = (r, d) => hl.zeilenStatus(r, d);
  assert.equal(s({ status: 'bezahlt' }, { aktion: 'keine' }), 'bezahlt');
  assert.equal(s({ status: 'überzahlt' }, { aktion: 'keine' }), 'überzahlt');
  assert.equal(s({ status: 'bezahlt', entwurf_id: 'r-1' }, { aktion: 'entwurf_verwerfen' }), 'bezahlt');
  assert.equal(s({ status: 'offen' }, { aktion: 'gesperrt' }), 'gesperrt');
  assert.equal(s({ status: 'Dublette' }, { aktion: 'gesperrt' }), 'gesperrt');
  assert.equal(s({ status: 'offen', klaerfall_halt: true }, { aktion: 'klaerfall_halt' }), 'Klärfall');
  assert.equal(s({ status: 'offen' }, { aktion: 'hinweis' }), 'Hinweis');
  assert.equal(s({ status: 'offen' }, { aktion: 'ungueltig' }), 'Hinweis');
  assert.equal(s({ status: 'offen' }, { aktion: 'keine_email' }), 'Hinweis');
  assert.equal(s({ status: 'offen', aktuelle_stufe: 4 }, { aktion: 'keine' }), 'übergeben');
  assert.equal(s({ status: 'offen', entwurf_id: 'r-1' }, { aktion: 'wartet' }), 'wartet auf Freigabe');
  assert.equal(s({ status: 'offen' }, { aktion: 'senden' }), 'offen');
  assert.equal(s({ status: 'offen' }, { aktion: 'mengenbremse' }), 'offen');
});

test('Teil A 10: H und P als je EIN Bereich über alle Blattzeilen, Lücken leer, Spalten nach Namen', () => {
  const posten = [{ rechnungsnr: 'RE-2026-9001', quelle_id: 2 }, { rechnungsnr: 'RE-2026-9003', quelle_id: 3 }, { rechnungsnr: 'RE-2026-9008', quelle_id: 5 }];
  const rechnungen = [{ status: 'bezahlt', bezahlt_cent: 123456 }, { status: 'offen', bezahlt_cent: 40000 }, { status: 'offen', bezahlt_cent: 0 }];
  const ent = [{ aktion: 'keine' }, { aktion: 'senden' }, { aktion: 'gesperrt' }];
  const b = hl.bezahltUndStatus(posten, rechnungen, ent, KOPF);
  assert.deepEqual(b, { zeilen: 3, data: [
    { range: "'Offene Posten'!H2:H5", values: [[1234.56], [400], [''], [0]] },
    { range: "'Offene Posten'!P2:P5", values: [['bezahlt'], ['offen'], [''], ['gesperrt']] }] });
  const unbekannt = hl.bezahltUndStatus([{ rechnungsnr: 'X', quelle_id: 2 }], [{ status: 'unbekannt' }], [{ aktion: 'hinweis' }], KOPF);
  assert.deepEqual(unbekannt.data[0].values, [['']]);
  assert.deepEqual(hl.bezahltUndStatus([], [], [], KOPF), { zeilen: 0, data: [] });
  assert.throws(() => hl.bezahltUndStatus(posten, rechnungen, ent, KOPF.filter((k) => k !== 'Status')), /Spalte fehlt Status/);
});

test('Teil A 10: Spalte A unverändert seit dem Lesen? Sonst wird H/P nicht geschrieben', () => {
  const vorher = [KOPF, reihe(9001), reihe(9002)];
  assert.equal(hl.spalteAGleich(vorher, [['Rechnungsnr.'], ['RE-2026-9001'], ['RE-2026-9002']]), true);
  assert.equal(hl.spalteAGleich(vorher, [['Rechnungsnr.'], ['RE-2026-9002'], ['RE-2026-9001']]), false);
  assert.equal(hl.spalteAGleich(vorher, [['Rechnungsnr.'], ['RE-2026-9001'], ['RE-2026-9002'], ['RE-2026-9099']]), false);
  assert.equal(hl.spalteAGleich(vorher.concat([[]]), [['Rechnungsnr.'], ['RE-2026-9001'], ['RE-2026-9002']]), true);
});

// Teil B 5: Entwurfsdatum aus dem Zeitstempel der angelegt-Zeile in der Data Table (Berliner Datum, früheste Zeile).
test('Teil B 5: Entwurfsdatum je Entwurf-ID aus der Data Table, früheste angelegt-Zeile, Berliner Datum', () => {
  const d = hl.entwurfDaten([
    { id: 3, aktion: 'angelegt', gmail_id: 'r-1', zeit_utc: '2026-09-25T22:30:00.000Z' },
    { id: 1, aktion: 'reserviert', gmail_id: '', zeit_utc: '2026-09-20T08:00:00.000Z' },
    { id: 5, aktion: 'angelegt', gmail_id: 'r-1', zeit_utc: '2026-09-27T08:00:00.000Z' },
    { id: 7, aktion: 'angelegt', gmail_id: 'r-2', zeit_utc: 'kaputt' }]);
  assert.deepEqual(d, { 'r-1': '2026-09-26' });
  const posten = [{ rechnungsnr: 'RE-2026-9013', quelle_id: 2, hinweise: [] }, { rechnungsnr: 'RE-2026-9016', quelle_id: 3, hinweise: [] }];
  const zustand = { 2: { rechnungsnr: 'RE-2026-9013', aktuelle_stufe: 1, entwurf_id: 'r-1' }, 3: { rechnungsnr: 'RE-2026-9016', aktuelle_stufe: 0, entwurf_id: '' } };
  const r = hl.baueRechnungen(posten, zustand, d);
  assert.equal(r[0].entwurf_datum, '2026-09-26');
  assert.equal(r[1].entwurf_datum, '');
  assert.equal(hl.baueRechnungen(posten, zustand)[0].entwurf_datum, '');
});

test('Teil B 5: Entwurf wartet länger als das Intervall der Stufe → Meldung an den Betrieb, nie Versand; Kontrolle am Tag des Intervalls → keine Meldung', () => {
  const e = { intervall_erinnerung: 7, intervall_mahnung1: 14, intervall_letzte_mahnung: 14, intervall_uebergabe: 14,
    freigabemodus_erinnerung: 'automatisch', freigabemodus_mahnung1: 'Entwurf', freigabemodus_letzte_mahnung: 'Entwurf',
    max_alter_auszug: 3, mindestbetrag_cent: 500, hoechstzahl_mails: 20 };
  const r = (datum) => ({ rechnungsnr: 'RE-2026-9013', kundentyp: 'B2B', email: 'kunde-13@example.invalid', faelligkeit: '2026-08-20',
    aktuelle_stufe: 1, datum_letzte_stufe: '2026-08-27', status: 'offen', rest_cent: 150000, entwurf_id: 'r-1', entwurf_rest_cent: 150000,
    freigabe: '', entwurf_datum: datum, hinweise: [] });
  const lang = st.entscheide(r(hl.entwurfDaten([{ aktion: 'angelegt', gmail_id: 'r-1', zeit_utc: '2026-09-25T09:00:00.000Z' }])['r-1']), e, '2026-10-10');
  assert.equal(lang.aktion, 'wartet');
  assert.deepEqual(lang.meldungen, [{ rechnungsnr: 'RE-2026-9013', text: 'Entwurf wartet zu lange auf Freigabe' }]);
  const knapp = st.entscheide(r('2026-09-25'), e, '2026-10-09');
  assert.equal(knapp.aktion, 'wartet');
  assert.deepEqual(knapp.meldungen, []);
});

test('B10 A 2: Zusatzzeilen aus „Zahlstand lesen“ (Belastungen) stehen als eigene Protokollzeilen hinter den Entscheidungen', () => {
  const plan = { entscheidungen: [{ rechnungsnr: 'RE-2026-9001', aktion: 'keine', stufe_vorher: 0, stufe: null, rest_cent: 0, grund: 'bezahlt' }],
    alarme: [], protokoll: [] };
  const z = hl.protokollZeilen(plan, { lauf_id: '7000', modus: 'test', zeit_utc: 'u', zeit_berlin: 'b' },
    [{ aktion: 'Belastungen nicht gezählt', grund: 'Datei auszug-2026-09-23.csv · 1' }]);
  assert.equal(z.length, 2);
  assert.deepEqual(z[1], ['u', 'b', '7000', 'test', '', 'Belastungen nicht gezählt', '', '', '', 'Datei auszug-2026-09-23.csv · 1', '', '']);
  assert.equal(hl.protokollZeilen(plan, { lauf_id: '7000', modus: 'test', zeit_utc: 'u', zeit_berlin: 'b' }).length, 1);
});

// Baustein 10, Teil A 4 (Entscheidung Elias 25.09.2026): Spalte „Versandstatus klären“.
test('B10 A 4: Rechnung trägt den Wert aus „Versandstatus klären“; Status nach geklärtem Versand offen', () => {
  const posten = [{ rechnungsnr: 'RE-2026-9009', kunde: 'K', kundentyp: 'B2C', email: 'a@example.invalid', rechnungsdatum: '2026-08-11',
    faelligkeit: '2026-08-25', betrag_brutto_cent: 70000, verzugshinweis: 'ja', mahnsperre: '', mahnsperre_grund: '', pdf_ref: '',
    versandstatus_klaeren: 'versendet', quelle_id: 10, hinweise: [] }];
  const r = hl.baueRechnungen(posten, { 10: { rechnungsnr: 'RE-2026-9009', aktuelle_stufe: 0, datum_letzte_stufe: '', freigabe: '',
    entwurf_id: '', entwurf_rest_cent: null, status: 'Klärfall' } });
  assert.equal(r[0].versandstatus_klaeren, 'versendet');
  assert.equal(hl.zeilenStatus({ status: 'offen', entwurf_id: 'r-1' }, { aktion: 'versandstatus_versendet' }), 'offen');
  assert.equal(hl.zeilenStatus({ status: 'offen', entwurf_id: 'r-1' }, { aktion: 'versandstatus_zurueck' }), 'wartet auf Freigabe');
});
