'use strict';
// Blatt „Einstellungen“ lesen (Baustein 5/6). Werte wie die Sheets-API sie mit UNFORMATTED_VALUE und
// SERIAL_NUMBER liefert (gemessen Lauf 5547): Zahlen als Zahl, Datum als Seriennummer, Text als Text.
// Adressen (Testempfänger, Absender, Antwort an, Meldeadresse) kommen NIE in die Ausgabe, nur „gesetzt ja/nein“.
const test = require('node:test');
const assert = require('node:assert/strict');
const ei = require('../kern/einstellungen.js');

const WERTE = [['Schlüssel', 'Wert', 'Bemerkung'],
  ['Modus', 'Trocken', ''], ['Testempfänger', 'jemand@firma.test', ''], ['Stichtag (nur Test)', 46289, ''],
  ['Absendername', 'Tischlerei Beispiel GmbH (Test)'], ['Absenderadresse', ''], ['Antwort an'],
  ['Firmenname', 'Tischlerei Beispiel GmbH'], ['IBAN', 'DE00 1234 5678 9000 0000 01'], ['BIC', 'ZZZZDEZZXXX'],
  ['Signatur', 'Tischlerei Beispiel GmbH\nMusterweg 1'], ['Meldeadresse Betrieb', 'melde@firma.test'],
  ['Intervall Erinnerung', 7], ['Intervall 1. Mahnung', 14], ['Intervall letzte Mahnung', 14], ['Intervall Übergabe', 14],
  ['Zahlungsfrist in der Mahnung', 10], ['Freigabemodus Erinnerung', 'automatisch'], ['Freigabemodus 1. Mahnung', 'Entwurf'],
  ['Freigabemodus letzte Mahnung', 'Entwurf'], ['Freigabemodus Übergabe', 'Meldung'], ['Max. Alter Kontoauszug', 3],
  ['Kontoauszug-Ordner', 'ORDNER-ID'], ['Auszugsformat', 'CSV'], ['CSV: Trennzeichen', ';'], ['CSV: Zeichensatz', 'ISO-8859-1'],
  ['CSV: Dezimalzeichen', ','], ['CSV: Datumsformat', 'TT.MM.JJJJ'], ['CSV: Kopfzeile in Zeile', 5],
  ['CSV: Spalte Buchungsdatum', 'Buchungstag'], ['CSV: Spalte Betrag', 'Betrag'], ['CSV: Spalte Soll/Haben', 'Soll/Haben'],
  ['CSV: Spalte Verwendungszweck', 'Verwendungszweck'], ['CSV: Spalte Auftraggeber', 'Auftraggeber'], ['CSV: Spalte IBAN', 'IBAN'],
  ['CSV: Spalte Referenz', 'Referenz'], ['Rechnungsnummer-Muster', 'RE-\\d{4}-\\d{3,5}'], ['Mindestbetrag', 5],
  ['Höchstzahl Mails je Lauf', 20], ['Versandtage', 'Mo–Fr'], ['Uhrzeit', '08:00'], ['PDF anhängen', 'ja'], ['Quelle', 'Sheet']];

test('Einstellungen in Kernform: Zahlen, Cent, Datum, CSV-Zuordnung; Modus klein', () => {
  const e = ei.leseEinstellungen(WERTE);
  assert.equal(e.ok, true, JSON.stringify(e.fehlend));
  const k = e.kern;
  assert.equal(k.modus, 'trocken');
  assert.equal(k.stichtag_test, '2026-09-24');
  assert.deepEqual([k.intervall_erinnerung, k.intervall_mahnung1, k.intervall_letzte_mahnung, k.intervall_uebergabe], [7, 14, 14, 14]);
  assert.deepEqual([k.freigabemodus_erinnerung, k.freigabemodus_mahnung1, k.freigabemodus_letzte_mahnung], ['automatisch', 'Entwurf', 'Entwurf']);
  assert.equal(k.max_alter_auszug, 3);
  assert.equal(k.mindestbetrag_cent, 500);
  assert.equal(k.hoechstzahl_mails, 20);
  assert.equal(k.zahlungsfrist, 10);
  assert.equal(k.auszugsformat, 'CSV');
  assert.equal(k.kontoauszug_ordner, 'ORDNER-ID');
  assert.equal(k.muster, 'RE-\\d{4}-\\d{3,5}');
  assert.deepEqual(k.csv, { trennzeichen: ';', zeichensatz: 'ISO-8859-1', dezimalzeichen: ',', datumsformat: 'TT.MM.JJJJ',
    kopfzeile: 5, spalte_buchungsdatum: 'Buchungstag', spalte_betrag: 'Betrag', spalte_soll_haben: 'Soll/Haben',
    spalte_verwendungszweck: 'Verwendungszweck', spalte_auftraggeber: 'Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: 'Referenz' });
  assert.equal(k.quelle, 'Sheet');
});

test('Adressen stehen nie in der Ausgabe, nur gesetzt ja/nein', () => {
  const e = ei.leseEinstellungen(WERTE);
  const text = JSON.stringify(e);
  assert.doesNotMatch(text, /@firma\.test/);
  assert.deepEqual(e.adressen_gesetzt, { testempfaenger: true, absenderadresse: false, antwort_an: false, meldeadresse: true });
});

test('Fehlender Schlüssel → ok false mit Namen; Kontrolle vollständig → ok', () => {
  const ohne = WERTE.filter((z) => z[0] !== 'Auszugsformat');
  const e = ei.leseEinstellungen(ohne);
  assert.equal(e.ok, false);
  assert.deepEqual(e.fehlend, ['Auszugsformat']);
  assert.equal(ei.leseEinstellungen(WERTE).ok, true);
});

test('Zahl als Text getippt ("7") wird Zahl; Unlesbares wird NaN (planeLauf wirft dann)', () => {
  const w = WERTE.map((z) => (z[0] === 'Intervall Erinnerung' ? [z[0], '7'] : z[0] === 'Mindestbetrag' ? [z[0], '5,00'] : z));
  const k = ei.leseEinstellungen(w).kern;
  assert.equal(k.intervall_erinnerung, 7);
  assert.equal(k.mindestbetrag_cent, 500);
  const x = ei.leseEinstellungen(WERTE.map((z) => (z[0] === 'Intervall Erinnerung' ? [z[0], 'sieben'] : z))).kern;
  assert.ok(Number.isNaN(x.intervall_erinnerung));
});

// Auftrag 25.09.2026, Teil A 4: Vorlage fürs Repo mit Modus = trocken, alles andere leer.
// Dazu: Kopfzeile „Zahlungseingänge“ in Vorlage und Test-Tabelle = Buchspalten (Teil A 3, Spalte Bankreferenz).
test('Vorlage: Modus trocken, alle anderen Werte leer; Zahlungseingänge-Kopf in Vorlage und Test-Tabelle wie ZE_SPALTEN', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lade = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'testdaten', 'tabelle', n), 'utf8'));
  const blatt = (t, n) => t.blaetter.find((b) => b.titel === n).zeilen;
  const v = lade('vorlage-leer.json');
  const werte = blatt(v, 'Einstellungen').slice(1);
  assert.deepEqual(werte.filter((z) => z[1] !== '').map((z) => [z[0], z[1]]), [['Modus', 'trocken']]);
  assert.equal(ei.leseEinstellungen(blatt(v, 'Einstellungen')).kern.modus, 'trocken');
  const ze = require('../kern/zahlungseingaenge.js');
  assert.deepEqual(blatt(v, 'Zahlungseingänge')[0], ze.ZE_SPALTEN);
  assert.deepEqual(blatt(lade('testbetrieb.json'), 'Zahlungseingänge')[0], ze.ZE_SPALTEN);
});
