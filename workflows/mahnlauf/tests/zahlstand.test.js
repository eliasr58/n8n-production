'use strict';
// Unterworkflow „Zahlstand lesen“ (Baustein 5): das Zusammenspiel aus Buch, Parsern, Zuordnung und
// Frische, wie es der Code-Node „Abgleich“ fährt. Eingabe: die Test-Kontoauszüge aus
// tests/testdaten/auszuege/. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zs = require('../kern/zahlstand.js');
const csv = require('../kern/csv-parser.js');
const ze = require('../kern/zahlungseingaenge.js');
const zuo = require('../kern/zuordnung.js');
const st = require('../kern/stufen.js');

const K = { ordneZahlungenZu: zuo.ordneZahlungenZu, pruefeFrische: st.pruefeFrische, schreibeFort: ze.schreibeFort,
  zuordnungsEingabe: ze.zuordnungsEingabe, schreibauftrag: ze.schreibauftrag };
const EINST = { max_alter_auszug: 3, muster: 'RE-\\d{4}-\\d{3,5}', auszugsformat: 'CSV',
  csv: { trennzeichen: ';', zeichensatz: 'ISO-8859-1', dezimalzeichen: ',', datumsformat: 'TT.MM.JJJJ', kopfzeile: 5,
    spalte_buchungsdatum: 'Buchungstag', spalte_betrag: 'Betrag', spalte_soll_haben: 'Soll/Haben',
    spalte_verwendungszweck: 'Verwendungszweck', spalte_auftraggeber: 'Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: 'Referenz' } };
function posten(nr, cent, kunde) {
  return { rechnungsnr: 'RE-2026-' + nr, kunde: kunde || 'Kunde Beispiel ' + String(nr).slice(-2), kundentyp: 'B2B',
    email: 'kunde-' + String(nr).slice(-2) + '@example.invalid', rechnungsdatum: '2026-09-01', faelligkeit: '2026-09-16',
    betrag_brutto_cent: cent, verzugshinweis: 'nein', mahnsperre: '', mahnsperre_grund: '', pdf_ref: '', quelle_id: 0, hinweise: [] };
}
const POSTEN = [posten(9001, 123456), posten(9003, 100000), posten(9004, 50000), posten(9005, 32000),
  posten(9006, 25000), posten(9007, 25000), posten(9014, 30000, 'Müller Bau GmbH (Test)')];
function datei(fall, name) {
  const pfad = path.join(__dirname, 'testdaten', 'auszuege', fall, name);
  return { datei: name, format: 'CSV', ergebnis: csv.parseKontoauszugCsv(Array.from(fs.readFileSync(pfad)), EINST.csv, name) };
}
function rechne(dateien, bestand, stichtag) {
  return zs.berechneZahlstand({ einstellungen: EINST, bestand: bestand || [], dateien, gemeldet: [], posten: POSTEN,
    stichtag: stichtag || '2026-09-24' }, K);
}
const nach = (e, nr) => e.zahlstand.find((z) => z.rechnungsnr === 'RE-2026-' + nr);

test('Grundfall (T01–T05 a): 9001 bezahlt, 9003 Rest 600,00, 9004 überzahlt 50,00, 9005 angehalten, 9007 bezahlt; frisch', () => {
  const e = rechne([datei('grund', 'auszug-2026-09-23.csv')]);
  assert.equal(e.status.status, 'ok');
  assert.equal(e.status.auszug_stand, '2026-09-23');
  assert.equal(e.status.auszug_frisch, true);
  assert.deepEqual([nach(e, 9001).status, nach(e, 9001).bezahlt_cent], ['bezahlt', 123456]);
  assert.deepEqual([nach(e, 9003).status, nach(e, 9003).rest_cent], ['offen', 60000]);
  assert.deepEqual([nach(e, 9004).status, nach(e, 9004).ueberschuss_cent], ['überzahlt', 5000]);
  assert.deepEqual([nach(e, 9005).status, nach(e, 9005).klaerfall_halt, nach(e, 9005).bezahlt_cent], ['offen', true, 0]);
  assert.deepEqual([nach(e, 9006).klaerfall_halt, nach(e, 9007).status], [false, 'bezahlt']);
  assert.equal(nach(e, 9014).klaerfall_halt, false, 'T04: nur 9005 ist Kandidat (320,00)');
  assert.equal(e.status.neu, 5);
  assert.equal(e.auftrag.neu.length, 5);
});

test('Frische: Auszug 5 Tage alt → nicht frisch; ohne lesbaren Auszug → nicht frisch; Kontrolle Grundfall frisch', () => {
  assert.equal(rechne([datei('alt', 'auszug-2026-09-19.csv')]).status.auszug_frisch, false);
  const k = rechne([datei('t12', 't12c-betrag.csv')]);
  assert.equal(k.status.auszug_frisch, false);
  assert.equal(k.status.auszug_stand, null);
  assert.ok(k.status.meldungen.some((m) => m.art === 'Kontoauszug unlesbar' && m.datei === 't12c-betrag.csv' && m.zeile === 7));
  assert.equal(rechne([datei('grund', 'auszug-2026-09-23.csv')]).status.auszug_frisch, true);
});

test('Zweiter Lauf auf dem geschriebenen Buch: nichts Neues, dieselben Zahlstände', () => {
  const e1 = rechne([datei('grund', 'auszug-2026-09-23.csv')]);
  const bestand = ze.leseZahlungseingaenge([ze.ZE_SPALTEN].concat(e1.auftrag.neu)).zeilen;
  const e2 = rechne([datei('grund', 'auszug-2026-09-23.csv')], bestand);
  assert.equal(e2.status.neu, 0);
  assert.equal(e2.status.schon_im_buch, 5);
  assert.deepEqual(e2.zahlstand, e1.zahlstand);
});

test('Eingang: Sheet mit posten und schreiben → weiter; sevDesk → Status; ohne schreiben (Wahrheitswert) → Wurf', () => {
  const ok = zs.pruefeEingangZahlstand({ quelle: { art: 'Sheet', tabelle_id: 'x' }, stichtag: '2026-09-24', posten: POSTEN, schreiben: false });
  assert.equal(ok.weiter, true);
  // Lauf 5567: der Code-Node „Abgleich“ liest die Posten aus dieser Rückgabe - sie müssen durchgereicht werden.
  assert.deepEqual(ok.posten, POSTEN);
  assert.equal(ok.schreiben, false);
  const s = zs.pruefeEingangZahlstand({ quelle: { art: 'sevDesk' }, stichtag: '2026-09-24', posten: [], schreiben: true });
  assert.deepEqual([s.weiter, s.status], [false, 'quelle_nicht_gebaut']);
  assert.throws(() => zs.pruefeEingangZahlstand({ quelle: { art: 'Sheet', tabelle_id: 'x' }, stichtag: '2026-09-24', posten: [] }));
  assert.throws(() => zs.pruefeEingangZahlstand({ quelle: { art: 'Sheet', tabelle_id: 'x' }, stichtag: '2026-09-24', schreiben: true }));
});

test('Drive-Liste → Dateien nach Namen sortiert, Ordner und Google-Dokumente ausgelassen', () => {
  const d = zs.dateienAusDrive({ files: [
    { id: '2', name: 'b.csv', mimeType: 'text/csv' }, { id: '1', name: 'a.xml', mimeType: 'application/xml' },
    { id: '3', name: 'Unterordner', mimeType: 'application/vnd.google-apps.folder' },
    { id: '4', name: 'Notiz', mimeType: 'application/vnd.google-apps.document' }] });
  assert.deepEqual(d.map((x) => x.name), ['a.xml', 'b.csv']);
});

// Entscheidung Elias 25.09.2026 (Baustein 10, Teil A 2, Befund 1): Belastungen sind kein Hinweis mehr, sie gehen still ins
// Protokoll. Klärfall bleiben Storno und Rücklastschrift (camt-parser.js).
test('B10 A 2: Belastungen nicht in den Meldungen, sondern als Protokollzeile; Kontrolle: der Klärfall bleibt Meldung', () => {
  const e = rechne([datei('grund', 'auszug-2026-09-23.csv')]);
  assert.equal(e.status.meldungen.some((m) => m.art === 'Belastungen nicht gezählt'), false);
  assert.deepEqual(e.status.protokoll, [{ aktion: 'Belastungen nicht gezählt', grund: 'Datei auszug-2026-09-23.csv · 1' }]);
  assert.ok(e.status.meldungen.some((m) => m.art === 'Klärfall'));
});
