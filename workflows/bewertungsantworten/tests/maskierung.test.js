'use strict';
// maskierung.js: Text für Claude (S09) - Kontakt, Namen, Kürzung. Befunde aus Baustein 1: mehrteilige Namen nach der Anrede,
// Leerzeichen nach der Anschrift bleibt. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const mk = require('../kern/maskierung.js');
const FIX = require('./testdaten/b1-fixtures.json');

const ERLAUBT = [FIX.betrieb.name, FIX.betrieb.signatur, FIX.betrieb.kontaktweg].join(' ');
const fx = (nr) => FIX.fixtures.find((f) => f.nr === nr);

test('Befund 8: Leerzeichen nach der Anschrift bleibt; Hausnummer mit Buchstabe wird mitgenommen', () => {
  assert.equal(mk.maskiereKontakt('Die Baustelle am Musterweg 1 war jeden Abend aufgeräumt.'),
    'Die Baustelle am <ANSCHRIFT> war jeden Abend aufgeräumt.');
  assert.equal(mk.maskiereKontakt('Musterweg 12a, 00000 Musterstadt'), '<ANSCHRIFT>, <PLZ_ORT>');
  assert.equal(mk.maskiereKontakt('Hauptstraße 12 a, dort'), '<ANSCHRIFT>, dort');
});

test('Befund 8: mehrteilige Namen nach Herr/Frau werden ganz maskiert; Titel bleibt', () => {
  assert.equal(mk.maskiereNamen('Vielen Dank, Frau Petra Musterfrau, für alles.', '', ERLAUBT), 'Vielen Dank, Frau <NAME>, für alles.');
  assert.equal(mk.maskiereNamen('Herr Beispielmann und sein Team', '', ERLAUBT), 'Herr <NAME> und sein Team');
  assert.equal(mk.maskiereNamen('Frau Dr. Petra Musterfrau kam', '', ERLAUBT), 'Frau Dr. <NAME> kam');
  assert.equal(mk.maskiereNamen('Hr. Müller-Lüdenscheidt war da', '', ERLAUBT), 'Hr. <NAME> war da');
});

test('Namen: Kontrolle - „Herr der Lage“, „Frau im Büro“ bleiben; Satzanfang nach Anrede ohne Großbuchstaben bleibt', () => {
  assert.equal(mk.maskiereNamen('Er war Herr der Lage, die Frau im Büro auch.', '', ERLAUBT), 'Er war Herr der Lage, die Frau im Büro auch.');
});

test('Anzeigename: Teile ab drei Buchstaben als ganzes Wort; Wörter des Betriebs sind ausgenommen (bestätigt 27.09.2026)', () => {
  assert.equal(mk.maskiereNamen('Petra hat recht, Musterfrauen gibt es viele.', 'Petra Musterfrau', ERLAUBT),
    '<NAME> hat recht, Musterfrauen gibt es viele.');
  assert.equal(mk.maskiereNamen('Kunde Beispiel lobt die Beispiel GmbH', 'Kunde Beispiel', ERLAUBT), '<NAME> Beispiel lobt die Beispiel GmbH');
  assert.equal(mk.maskiereNamen('www.konkurrenz-beispiel.example', 'Kunde Beispiel', ERLAUBT), 'www.konkurrenz-beispiel.example');
});

test('S09 fuerKi: M13 - Name, Nummer maskiert; M14 - Anschrift ohne verschlucktes Leerzeichen; M12 gekürzt auf 2000', () => {
  const m13 = mk.fuerKi(fx('M13').text, fx('M13').anzeigename, ERLAUBT);
  assert.ok(m13.text.includes('Vielen Dank, Frau <NAME>, für Ihren Auftrag'), m13.text);
  assert.ok(m13.text.includes('<TELEFON>') && !m13.text.includes('333333') && !m13.text.includes('Musterfrau') && !m13.text.includes('Petra'));
  const m14 = mk.fuerKi(fx('M14').text, fx('M14').anzeigename, ERLAUBT);
  assert.ok(m14.text.includes('am <ANSCHRIFT> war jeden Abend'), m14.text);
  const m12 = mk.fuerKi(fx('M12').text, fx('M12').anzeigename, ERLAUBT);
  assert.deepEqual([m12.text.length, m12.gekuerzt, m12.text.includes('444444')], [2000, true, false]);
  assert.deepEqual(mk.fuerKi('  Kurz.  ', '', ERLAUBT), { text: 'Kurz.', gekuerzt: false });
});

test('anredeNamen: Namen nach der Anrede für die Leitplanke (auch mehrteilig), ohne Titel', () => {
  assert.deepEqual(mk.anredeNamen('Danke, Frau Dr. Petra Musterfrau, und Herr Beispielmann!'), ['Petra', 'Musterfrau', 'Beispielmann']);
  assert.deepEqual(mk.anredeNamen('Herr der Lage'), []);
});
