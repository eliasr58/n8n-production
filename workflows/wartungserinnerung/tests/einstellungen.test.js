'use strict';
// einstellungen.js: Blatt „Einstellungen“ (BAUPLAN b). leseEinstellungen ist aus dem Mahnlauf übernommen (byte-gleich),
// nur die Feldliste EI_FELDER ist neu. Adressen kommen nie in die Ausgabe.
const test = require('node:test');
const assert = require('node:assert/strict');
const ei = require('../kern/einstellungen.js');

const BLATT = [
  ['Schlüssel', 'Wert'],
  ['Modus', 'Trocken'], ['Testempfänger', 'test@example.invalid'], ['Stichtag (nur Test)', 46293],
  ['Absendername', 'Heizung & Sanitär Beispiel GmbH'], ['Absenderadresse', 'info@example.invalid'],
  ['Antwort an', 'info@example.invalid'], ['Meldeadresse', 'meldung@example.invalid'], ['Firmenname', 'Heizung & Sanitär Beispiel GmbH'],
  ['Telefon', '0000 000000'], ['Signatur', 'Ihr Team'], ['Vorlauf Angebot', 42], ['Nachlauf', 30], ['Erinnerung nach', 14],
  ['Antwortfenster', 21], ['Antworten lesen bis', 180], ['Standardintervall', 12], ['Höchstzahl Mails je Lauf', 20],
  ['KI-Einordnung', 'An'], ['Versandtage', 'Mo–Fr'], ['Uhrzeit', '08:00'],
];

test('liest alle Felder, Zahlen als Zahl, Modus klein, Datum aus Seriennummer', () => {
  const r = ei.leseEinstellungen(BLATT);
  assert.equal(r.ok, true);
  assert.deepEqual(r.fehlend, []);
  assert.equal(r.kern.modus, 'trocken');
  assert.equal(r.kern.stichtag_test, '2026-09-28');
  assert.equal(r.kern.vorlauf, 42);
  assert.equal(r.kern.hoechstzahl_mails, 20);
  assert.equal(r.kern.ki_einordnung, 'an');
});

test('Adressen nie in der Ausgabe, nur gesetzt ja/nein', () => {
  const r = ei.leseEinstellungen(BLATT);
  assert.deepEqual(r.adressen_gesetzt, { testempfaenger: true, absenderadresse: true, antwort_an: true, meldeadresse: true });
  assert.ok(!JSON.stringify(r).includes('@'));
});

test('fehlender Schlüssel → nicht ok, mit Namen; unlesbare Zahl → NaN', () => {
  const r = ei.leseEinstellungen(BLATT.filter((z) => z[0] !== 'Nachlauf'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.fehlend, ['Nachlauf']);
  const n = ei.leseEinstellungen(BLATT.map((z) => (z[0] === 'Vorlauf Angebot' ? [z[0], 'sechs Wochen'] : z)));
  assert.ok(Number.isNaN(n.kern.vorlauf));
});

test('Feldliste: jeder Schlüssel aus BAUPLAN b genau einmal', () => {
  const namen = ei.EI_FELDER.map((f) => f[0]);
  assert.equal(new Set(namen).size, namen.length);
  for (const n of ['Modus', 'Testempfänger', 'Stichtag (nur Test)', 'Antwort an', 'Meldeadresse', 'Vorlauf Angebot', 'Nachlauf',
    'Erinnerung nach', 'Antwortfenster', 'Antworten lesen bis', 'Standardintervall', 'Höchstzahl Mails je Lauf', 'KI-Einordnung']) {
    assert.ok(namen.includes(n), n);
  }
});
