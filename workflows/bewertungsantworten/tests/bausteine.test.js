'use strict';
// bausteine.js: feste Texte im Blatt „Textbausteine“ mit geprüften Platzhaltern (S13, S14, E5, E6; Arbeitsregel 5).
// Seit Baustein 3 (Auftrag 27.09.2026): eigenes Blatt, „ohne Text“ je Sternzahl 1–5 und „unfair“. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const bs = require('../kern/bausteine.js');

const E = { betrieb: 'Zimmerei & Dachbau Beispiel GmbH', signatur: 'Ihr Team der Zimmerei & Dachbau Beispiel GmbH',
  kontaktweg: 'Rufen Sie uns gern an: 0000 000000' };
const ZEILEN = [['ohne Text 1', 'Guten Tag,\n\neins. {kontaktweg}\n\n{signatur}'], ['ohne Text 2', 'Guten Tag,\n\nzwei. {kontaktweg}\n\n{signatur}'],
  ['ohne Text 3', 'Guten Tag,\n\ndrei.\n\n{signatur}'], ['ohne Text 4', 'Guten Tag,\n\nvier.\n\n{signatur}'],
  ['ohne Text 5', 'Guten Tag,\n\nvielen Dank!\n\n{signatur}'], ['unfair', 'Guten Tag,\n\n{kontaktweg}\n\n{signatur}']];
const BLATT = (z) => [['Art', 'Text']].concat(z || ZEILEN);
const BS = bs.leseTextbausteine(BLATT()).bausteine;

test('leseTextbausteine: Kopfzeile exakt (Art, Text), jede Art genau einmal, nur bekannte Platzhalter → ok', () => {
  const r = bs.leseTextbausteine(BLATT());
  assert.deepEqual([r.ok, r.fehler, Object.keys(r.bausteine)], [true, [], ['ohne Text 1', 'ohne Text 2', 'ohne Text 3', 'ohne Text 4', 'ohne Text 5', 'unfair']]);
  assert.deepEqual(bs.TB_SPALTEN, ['Art', 'Text']);
});

test('leseTextbausteine: Kopfzeile falsch, Art fehlt, doppelt, unbekannt, leer, unbekannter Platzhalter → nicht ok mit Grund', () => {
  const f = (werte) => bs.leseTextbausteine(werte).fehler;
  assert.deepEqual(f([['Art', 'Betreff', 'Text']].concat(ZEILEN)), ['Kopfzeile Textbausteine weicht ab']);
  assert.deepEqual(f(BLATT(ZEILEN.slice(1))), ['Textbaustein „ohne Text 1“ fehlt']);
  assert.deepEqual(f(BLATT(ZEILEN.concat([['unfair', 'x']]))), ['Textbaustein „unfair“ doppelt']);
  assert.deepEqual(f(BLATT(ZEILEN.concat([['Lob', 'x']]))), ['Textbaustein „Lob“ unbekannt']);
  assert.deepEqual(f(BLATT(ZEILEN.slice(0, 5).concat([['unfair', '  ']]))), ['Textbaustein „unfair“ leer']);
  assert.deepEqual(f(BLATT(ZEILEN.slice(0, 5).concat([['unfair', 'Guten Tag {name}']]))), ['Textbaustein „unfair“ – Platzhalter {name} unbekannt']);
});

test('E5 je Sternzahl, E6 unfair: richtiger Baustein, Platzhalter gefüllt; Sterne ungültig, Wert leer oder Art unbekannt → ok false', () => {
  assert.equal(bs.baueBaustein('ohne_text', 5, BS, E).text, 'Guten Tag,\n\nvielen Dank!\n\nIhr Team der Zimmerei & Dachbau Beispiel GmbH');
  assert.equal(bs.baueBaustein('ohne_text', 2, BS, E).text, 'Guten Tag,\n\nzwei. Rufen Sie uns gern an: 0000 000000\n\nIhr Team der Zimmerei & Dachbau Beispiel GmbH');
  assert.equal(bs.baueBaustein('ohne_text', 3, BS, E).text, 'Guten Tag,\n\ndrei.\n\nIhr Team der Zimmerei & Dachbau Beispiel GmbH');
  assert.equal(bs.baueBaustein('unfair', 1, BS, E).ok, true);
  assert.equal(bs.baueBaustein('ohne_text', 0, BS, E).ok, false);
  assert.equal(bs.baueBaustein('ohne_text', null, BS, E).ok, false);
  assert.equal(bs.baueBaustein('unfair', 1, BS, Object.assign({}, E, { kontaktweg: '' })).ok, false);
  assert.equal(bs.baueBaustein('lob', 5, BS, E).ok, false);
});

test('S14 ohneText: leer, nur Leerzeichen, nur Emoji oder Satzzeichen → ohne Text; Kontrolle ein Wort', () => {
  for (const t of ['', '   ', '👍👍👍', '👨‍👩‍👧 !!', '\n\t']) assert.equal(bs.ohneText(t), true, JSON.stringify(t));
  for (const t of ['Top', 'ok 👍', '5']) assert.equal(bs.ohneText(t), false, t);
});
