'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const csv = require('../kern/csv-parser.js');
const { ladeBytes } = require('./hilfen.js');

const EINST_ISO = {
  trennzeichen: ';', zeichensatz: 'ISO-8859-1', dezimalzeichen: ',', datumsformat: 'TT.MM.JJJJ', kopfzeile: 5,
  spalte_buchungsdatum: 'Buchungstag', spalte_betrag: 'Betrag', spalte_soll_haben: 'Soll/Haben',
  spalte_verwendungszweck: 'Verwendungszweck', spalte_auftraggeber: 'Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: '',
};
const EINST_UTF = {
  trennzeichen: ';', zeichensatz: 'UTF-8', dezimalzeichen: '.', datumsformat: 'JJJJ-MM-TT', kopfzeile: 1,
  spalte_buchungsdatum: 'Datum', spalte_betrag: 'Betrag', spalte_soll_haben: '',
  spalte_verwendungszweck: 'Zweck', spalte_auftraggeber: 'Empfänger/Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: 'Bankreferenz',
};
const EINST_EINFACH = {
  trennzeichen: ';', zeichensatz: 'UTF-8', dezimalzeichen: ',', datumsformat: 'TT.MM.JJJJ', kopfzeile: 1,
  spalte_buchungsdatum: 'Buchungstag', spalte_betrag: 'Betrag', spalte_soll_haben: '',
  spalte_verwendungszweck: 'Verwendungszweck', spalte_auftraggeber: 'Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: '',
};

function lies(datei, einst) {
  return csv.parseKontoauszugCsv(ladeBytes(datei), einst, datei);
}

test('CSV Vorspann + Soll/Haben + ISO-8859-1: nur Haben zählt, Umlaute und Feld mit ; richtig', () => {
  const r = lies('vorspann-soll-haben-iso.csv', EINST_ISO);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.zahlungen.length, 2);
  assert.equal(r.zahlungen[0].betrag_cent, 123456);
  assert.equal(r.zahlungen[0].buchungsdatum, '2026-09-22');
  assert.equal(r.zahlungen[0].verwendungszweck, 'RE-2026-9001 Tür Küche');
  assert.equal(r.zahlungen[1].auftraggeber, 'Müller Bau GmbH (Test)');
  assert.equal(r.zahlungen[1].verwendungszweck, 'RE 2026-9002; Teilzahlung');
  assert.equal(r.zahlungen[1].betrag_cent, 40000);
  assert.equal(r.stand, '2026-09-23');
  for (const z of r.zahlungen) {
    assert.equal(z.waehrung, 'EUR');
    assert.equal(z.quelle, 'vorspann-soll-haben-iso.csv');
    assert.ok(Number.isInteger(z.betrag_cent) && z.betrag_cent > 0);
    assert.match(z.schluessel, /^H:[0-9a-f]{16}$/);
  }
  // Kontrolle im selben Lauf: die Soll-Buchung (89,90) ist NICHT dabei.
  assert.equal(r.zahlungen.some((z) => z.betrag_cent === 8990), false);
});

test('CSV Vorspann: Kopfzeile in Zeile 1 statt 5 verwirft die Datei (Kontrolle zur Vorspann-Einstellung)', () => {
  const r = lies('vorspann-soll-haben-iso.csv', Object.assign({}, EINST_ISO, { kopfzeile: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.fehler.datei, 'vorspann-soll-haben-iso.csv');
  assert.equal(r.fehler.zeile, 1);
});

test('CSV Vorzeichen, Dezimalpunkt, ISO-Datum, Bankreferenz: Lastschrift zählt nicht', () => {
  const r = lies('vorzeichen-utf8.csv', EINST_UTF);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.zahlungen.map((z) => z.betrag_cent), [40000, 55000, 130000]);
  assert.deepEqual(r.zahlungen.map((z) => z.schluessel), ['REF:BANKREF-0001', 'REF:BANKREF-0003', 'REF:BANKREF-0004']);
  assert.equal(r.zahlungen[2].verwendungszweck, 'Danke für die gute Arbeit');
  assert.equal(r.zahlungen[0].referenz, 'BANKREF-0001');
  assert.equal(r.stand, '2026-09-22');
  assert.equal(r.zahlungen.some((z) => z.schluessel === 'REF:BANKREF-0002'), false);
});

test('CSV ISO-8859-1 mit Einstellung ISO-8859-1: Umlaut korrekt (Kontrolle zu T12 d)', () => {
  const r = lies('kaputt-umlaut-iso.csv', Object.assign({}, EINST_EINFACH, { zeichensatz: 'ISO-8859-1' }));
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.zahlungen[0].auftraggeber, 'Müller Bau GmbH (Test)');
});

test('CSV: Text statt Bytes wird gleich gelesen', () => {
  const text = 'Buchungstag;Auftraggeber;IBAN;Verwendungszweck;Betrag\n21.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;400,00\n';
  const r = csv.parseKontoauszugCsv(text, EINST_EINFACH, 'text.csv');
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.zahlungen[0].betrag_cent, 40000);
});

test('Buchungsschlüssel: gleiche Datei zweimal gleich, zwei gleiche Buchungen am selben Tag verschieden', () => {
  const text = 'Buchungstag;Auftraggeber;IBAN;Verwendungszweck;Betrag\n'
    + '21.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;100,00\n'
    + '21.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;100,00\n';
  const a = csv.parseKontoauszugCsv(text, EINST_EINFACH, 'a.csv');
  const b = csv.parseKontoauszugCsv(text, EINST_EINFACH, 'b.csv');
  assert.equal(a.ok, true);
  assert.equal(a.zahlungen.length, 2);
  assert.notEqual(a.zahlungen[0].schluessel, a.zahlungen[1].schluessel);
  assert.deepEqual(a.zahlungen.map((z) => z.schluessel), b.zahlungen.map((z) => z.schluessel));
});

test('leseBetragCent: nur ganze Cent, strenges Format', () => {
  assert.equal(csv.leseBetragCent('1.234,56', ','), 123456);
  assert.equal(csv.leseBetragCent('1.234', ','), 123400);
  assert.equal(csv.leseBetragCent('12,3', ','), 1230);
  assert.equal(csv.leseBetragCent('0,5', ','), 50);
  assert.equal(csv.leseBetragCent('-45.10', '.'), -4510);
  assert.equal(csv.leseBetragCent('+550.00', '.'), 55000);
  assert.equal(csv.leseBetragCent('1,300.00', '.'), 130000);
  assert.equal(csv.leseBetragCent('0,10', ','), 10);
  assert.equal(csv.leseBetragCent('12,3x', ','), null);
  assert.equal(csv.leseBetragCent('12,345', ','), null);
  assert.equal(csv.leseBetragCent('1.23,45', ','), null);
  assert.equal(csv.leseBetragCent('', ','), null);
});

test('leseDatum: Formate und echte Kalenderdaten', () => {
  assert.equal(csv.leseDatum('22.09.2026', 'TT.MM.JJJJ'), '2026-09-22');
  assert.equal(csv.leseDatum('2.9.2026', 'TT.MM.JJJJ'), '2026-09-02');
  assert.equal(csv.leseDatum('22.09.26', 'TT.MM.JJ'), '2026-09-22');
  assert.equal(csv.leseDatum('2026-09-21', 'JJJJ-MM-TT'), '2026-09-21');
  assert.equal(csv.leseDatum('31.02.2026', 'TT.MM.JJJJ'), null);
  assert.equal(csv.leseDatum('2026-09-21', 'TT.MM.JJJJ'), null);
});

// ---- T12: kaputte CSV, je mit Kontrolle ----

test('T12 a) falsches Trennzeichen verwirft die Datei mit Zeile', () => {
  const r = lies('kaputt-trennzeichen.csv', EINST_UTF);
  assert.equal(r.ok, false);
  assert.equal(r.zahlungen, undefined);
  assert.equal(r.fehler.datei, 'kaputt-trennzeichen.csv');
  assert.equal(r.fehler.zeile, 1);
  assert.match(r.fehler.grund, /Trennzeichen/);
});

test('T12 a) Kontrolle: dieselbe Datei mit Trennzeichen Komma wird gelesen', () => {
  const r = lies('kaputt-trennzeichen.csv', Object.assign({}, EINST_UTF, { trennzeichen: ',' }));
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.zahlungen.length, 1);
  assert.equal(r.zahlungen[0].betrag_cent, 40000);
});

test('T12 b) fehlende Spalte verwirft die Datei und nennt die Spalte', () => {
  const r = lies('kaputt-spalte-fehlt.csv', EINST_UTF);
  assert.equal(r.ok, false);
  assert.equal(r.fehler.zeile, 1);
  assert.match(r.fehler.grund, /Zweck/);
});

test('T12 b) Kontrolle: vollständige Datei mit denselben Einstellungen wird gelesen', () => {
  const r = lies('vorzeichen-utf8.csv', EINST_UTF);
  assert.equal(r.ok, true);
});

test('T12 c) Betrag „12,3x“ verwirft die GANZE Datei, auch die lesbaren Zeilen', () => {
  const r = lies('kaputt-betrag.csv', EINST_EINFACH);
  assert.equal(r.ok, false);
  assert.equal(r.zahlungen, undefined);
  assert.equal(r.fehler.datei, 'kaputt-betrag.csv');
  assert.equal(r.fehler.zeile, 3);
  assert.match(r.fehler.grund, /12,3x/);
});

test('T12 c) Kontrolle: gleiche Datei mit lesbarem Betrag liefert alle drei Zahlungen', () => {
  const r = lies('kaputt-betrag-kontrolle.csv', EINST_EINFACH);
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.zahlungen.map((z) => z.betrag_cent), [40000, 1230, 30000]);
});

test('T12 d) Umlaut in ISO-8859-1 bei Einstellung UTF-8 verwirft die Datei mit Zeile', () => {
  const r = lies('kaputt-umlaut-iso.csv', EINST_EINFACH);
  assert.equal(r.ok, false);
  assert.equal(r.fehler.zeile, 2);
  assert.match(r.fehler.grund, /UTF-8/);
});

// ---- Teil A, 25.09.2026: verworfen wird nur bei Formatfehlern, Auffälligkeiten einzelner
// Buchungen werden Klärfall. Bankreferenz-Platzhalter zählen als „keine Referenz“. ----

const KOPF_REF = 'Buchungstag;Auftraggeber;IBAN;Verwendungszweck;Betrag;Referenz\n';
const EINST_REF = Object.assign({}, EINST_EINFACH, { spalte_referenz: 'Referenz' });

test('Bankreferenz-Platzhalter (leer, NONREF, NOTPROVIDED, NOT PROVIDED, klein) → Ersatzschlüssel aus dem Hash; Kontrolle echte Referenz → REF:', () => {
  const text = KOPF_REF
    + '21.09.2026;Kunde Beispiel 01;DE00111122223333444401;RE-2026-9001;100,00;NONREF\n'
    + '21.09.2026;Kunde Beispiel 02;DE00111122223333444402;RE-2026-9002;200,00;nonref\n'
    + '21.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;300,00;NOTPROVIDED\n'
    + '21.09.2026;Kunde Beispiel 04;DE00111122223333444404;RE-2026-9004;400,00;NOT PROVIDED\n'
    + '21.09.2026;Kunde Beispiel 05;DE00111122223333444405;RE-2026-9005;500,00; not provided \n'
    + '21.09.2026;Kunde Beispiel 06;DE00111122223333444406;RE-2026-9006;600,00;\n'
    + '21.09.2026;Kunde Beispiel 07;DE00111122223333444407;RE-2026-9007;700,00;BANKREF-0007\n';
  const r = csv.parseKontoauszugCsv(text, EINST_REF, 'platzhalter.csv');
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.zahlungen.length, 7);
  for (const z of r.zahlungen.slice(0, 6)) assert.match(z.schluessel, /^H:[0-9a-f]{16}$/, z.verwendungszweck);
  assert.equal(r.zahlungen[6].schluessel, 'REF:BANKREF-0007');
  assert.equal(new Set(r.zahlungen.map((z) => z.schluessel)).size, 7);
});

test('Derselbe Platzhalter zweimal in einer Datei → beide Zahlungen mit verschiedenen Schlüsseln, kein Klärfall', () => {
  const text = KOPF_REF
    + '21.09.2026;Kunde Beispiel 01;DE00111122223333444401;RE-2026-9001;100,00;NONREF\n'
    + '22.09.2026;Kunde Beispiel 02;DE00111122223333444402;RE-2026-9002;200,00;NONREF\n';
  const r = csv.parseKontoauszugCsv(text, EINST_REF, 'platzhalter2.csv');
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.zahlungen.map((z) => z.betrag_cent), [10000, 20000]);
  assert.notEqual(r.zahlungen[0].schluessel, r.zahlungen[1].schluessel);
  assert.equal(r.klaerfaelle.length, 0);
});

test('Echte Bankreferenz doppelt in einer Datei → beide Buchungen Klärfall, Datei bleibt gültig; Kontrolle: die übrige Buchung wird Zahlung', () => {
  const text = KOPF_REF
    + '21.09.2026;Kunde Beispiel 01;DE00111122223333444401;RE-2026-9001;100,00;BANKREF-0001\n'
    + '22.09.2026;Kunde Beispiel 02;DE00111122223333444402;RE-2026-9002;200,00;BANKREF-0001\n'
    + '22.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;300,00;BANKREF-0003\n';
  const r = csv.parseKontoauszugCsv(text, EINST_REF, 'doppelt.csv');
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.zahlungen.map((z) => z.schluessel), ['REF:BANKREF-0003']);
  assert.deepEqual(r.klaerfaelle.map((k) => k.betrag_cent), [10000, 20000]);
  for (const k of r.klaerfaelle) {
    assert.match(k.grund, /Bankreferenz doppelt/);
    assert.match(k.schluessel, /^H:[0-9a-f]{16}$/);
    assert.equal(k.quelle, 'doppelt.csv');
  }
  assert.notEqual(r.klaerfaelle[0].schluessel, r.klaerfaelle[1].schluessel);
  assert.equal(r.stand, '2026-09-22');
});

// Auftrag 25.09.2026, Teil A 2: eine Belastung mit derselben Referenz macht die Gutschrift nicht zum Klärfall.
test('Referenz einer Belastung gleich der einer Gutschrift → Gutschrift bleibt Zahlung mit REF:; Kontrolle zwei Gutschriften → Klärfall', () => {
  const text = KOPF_REF
    + '21.09.2026;Kunde Beispiel 01;DE00111122223333444401;RE-2026-9001;100,00;BANKREF-0001\n'
    + '22.09.2026;Miete Werkstatt;DE00111122223333444499;Miete September;-45,00;BANKREF-0001\n';
  const r = csv.parseKontoauszugCsv(text, EINST_REF, 'belastung.csv');
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.deepEqual(r.zahlungen.map((z) => z.schluessel), ['REF:BANKREF-0001']);
  assert.equal(r.klaerfaelle.length, 0);
  const k = csv.parseKontoauszugCsv(text.replace('-45,00', '45,00'), EINST_REF, 'kontrolle.csv');
  assert.equal(k.zahlungen.length, 0);
  assert.equal(k.klaerfaelle.length, 2);
});
