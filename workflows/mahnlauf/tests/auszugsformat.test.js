'use strict';
// Einstellung „Auszugsformat“ (Teil A, 25.09.2026): gelesen werden nur Dateien des
// eingestellten Formats, alle anderen werden gemeldet. Grund: Dieselbe Zahlung als CSV
// und als CAMT hat verschiedene Buchungsschlüssel und würde sonst doppelt zählen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const af = require('../kern/auszugsformat.js');
const csv = require('../kern/csv-parser.js');
const camt = require('../kern/camt-parser.js');
const zuo = require('../kern/zuordnung.js');
const { ladeBytes, MUSTER, zeile } = require('./hilfen.js');

const DATEIEN = [
  { name: 'auszug-2026-09-22.csv', mimeType: 'text/csv' },
  { name: 'camt053-2026-09-22.xml', mimeType: 'application/xml' },
  { name: 'notiz.pdf', mimeType: 'application/pdf' },
];

test('Auszugsformat CSV: nur die CSV-Datei wird gelesen, CAMT und Unbekanntes werden gemeldet; Kontrolle CAMT: umgekehrt', () => {
  const c = af.waehleAuszugsdateien(DATEIEN, 'CSV');
  assert.equal(c.ok, true);
  assert.deepEqual(c.lesen.map((d) => [d.name, d.format]), [['auszug-2026-09-22.csv', 'CSV']]);
  assert.deepEqual(c.gemeldet.map((d) => d.datei), ['camt053-2026-09-22.xml', 'notiz.pdf']);
  const x = af.waehleAuszugsdateien(DATEIEN, 'CAMT');
  assert.equal(x.ok, true);
  assert.deepEqual(x.lesen.map((d) => [d.name, d.format]), [['camt053-2026-09-22.xml', 'CAMT']]);
  assert.deepEqual(x.gemeldet.map((d) => d.datei), ['auszug-2026-09-22.csv', 'notiz.pdf']);
});

test('Format aus Endung, sonst aus dem MIME-Typ; groß/klein egal', () => {
  const d = [
    { name: 'AUSZUG.CSV', mimeType: '' },
    { name: 'auszug-ohne-endung', mimeType: 'text/csv' },
    { name: 'camt-ohne-endung', mimeType: 'text/xml' },
  ];
  assert.deepEqual(af.waehleAuszugsdateien(d, 'csv').lesen.map((x) => x.name), ['AUSZUG.CSV', 'auszug-ohne-endung']);
  assert.deepEqual(af.waehleAuszugsdateien(d, ' camt ').lesen.map((x) => x.name), ['camt-ohne-endung']);
});

test('Auszugsformat leer oder unbekannt → keine Datei gelesen, jede gemeldet (fail-closed)', () => {
  for (const wert of ['', 'MT940', undefined]) {
    const e = af.waehleAuszugsdateien(DATEIEN, wert);
    assert.equal(e.ok, false, String(wert));
    assert.equal(e.lesen.length, 0, String(wert));
    assert.equal(e.gemeldet.length, 3, String(wert));
    assert.match(e.grund, /Auszugsformat/);
  }
});

// Dieselbe Gutschrift 1.234,56 für RE-2026-9001 liegt als CSV (vorspann-soll-haben-iso.csv)
// und als CAMT (camt053-001-08-mehrere) im Ordner. Die Rechnung lautet auf 3.000,00, die
// Gutschrift ist also eine Teilzahlung. (Bei voller Zahlung würde die zweite Kopie zum
// Klärfall „schon bezahlt“ - gemessen im ersten grünen Lauf, 22:59:51Z.)
const EINST_ISO = {
  trennzeichen: ';', zeichensatz: 'ISO-8859-1', dezimalzeichen: ',', datumsformat: 'TT.MM.JJJJ', kopfzeile: 5,
  spalte_buchungsdatum: 'Buchungstag', spalte_betrag: 'Betrag', spalte_soll_haben: 'Soll/Haben',
  spalte_verwendungszweck: 'Verwendungszweck', spalte_auftraggeber: 'Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: '',
};
const ORDNER = [
  { name: 'vorspann-soll-haben-iso.csv', mimeType: 'text/csv' },
  { name: 'camt053-001-08-mehrere.xml', mimeType: 'application/xml' },
];
function lies(datei) {
  if (datei.format === 'CSV') return csv.parseKontoauszugCsv(ladeBytes(datei.name), EINST_ISO, datei.name);
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'testdaten', 'camt',
    datei.name.replace(/\.xml$/, '.xml-standard.json')), 'utf8')).json;
  return camt.parseKontoauszugCamt(j, datei.name);
}
function bezahlt9001(dateien) {
  const zahlungen = [];
  dateien.forEach((d) => { const e = lies(d); assert.equal(e.ok, true, d.name); zahlungen.push(...e.zahlungen); });
  const z = zuo.ordneZahlungenZu({ rechnungen: [zeile(9001, { betrag_brutto_cent: 300000 })], zahlungen, manuell: {}, muster: MUSTER });
  return z.rechnungen[0];
}

test('Dieselbe Teilzahlung als CSV und als CAMT im Ordner zählt einmal: mit Auszugsformat Rest 1.765,44; Kontrolle beide gelesen → doppelt gezählt, Rest 530,88', () => {
  for (const format of ['CSV', 'CAMT']) {
    const r = bezahlt9001(af.waehleAuszugsdateien(ORDNER, format).lesen);
    assert.equal(r.bezahlt_cent, 123456, format);
    assert.equal(r.rest_cent, 176544, format);
  }
  const beide = bezahlt9001([{ name: ORDNER[0].name, format: 'CSV' }, { name: ORDNER[1].name, format: 'CAMT' }]);
  assert.equal(beide.bezahlt_cent, 246912);
  assert.equal(beide.rest_cent, 53088);
});
