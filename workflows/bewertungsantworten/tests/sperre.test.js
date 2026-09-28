'use strict';
// sperre.js: Schlüssel antwort|ID|Stand, Data-Table-Zeilen ohne Text, Ergebnis des Zieladapters (S20, S21). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const sp = require('../kern/sperre.js');

const r = (id, aktion, lauf, zeit) => ({ id, schluessel: 'antwort|R-9001|2026-09-20T08:15:00Z', aktion, lauf_id: lauf,
  zeit_utc: zeit || '2026-09-28T06:00:01.000Z' });

test('nach dem übernommenen Test (Wartung versand.test.js 42b4f08), angepasst: „veroeffentlicht“ und „unklar“ sperren für immer', () => {
  assert.equal(sp.sperreEntscheid([r(1, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z').weiter, true);
  assert.equal(sp.sperreEntscheid([r(1, 'reserviert', '6999'), r(2, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z').grund, 'übersprungen, anderer Lauf');
  assert.equal(sp.sperreEntscheid([r(1, 'reserviert', '6999'), r(2, 'veroeffentlicht', '6999'), r(3, 'reserviert', '7000')], '7000').grund, 'schon veroeffentlicht');
  assert.equal(sp.sperreEntscheid([r(1, 'reserviert', '6999'), r(2, 'unklar', '6999'), r(3, 'reserviert', '7000')], '7000').grund, 'schon unklar');
  assert.equal(sp.sperreEntscheid([r(1, 'reserviert', '6999'), r(2, 'zurueckgegeben', '6999'), r(3, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z').weiter, true);
  const tot = sp.sperreEntscheid([r(1, 'reserviert', '6990', '2026-09-27T06:00:00.000Z'), r(2, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z');
  assert.deepEqual([tot.weiter, tot.grund], [false, 'Reservierung eines abgebrochenen Laufs']);
});

test('sperrSchluessel: antwort|<ID>|<Stand UTC>; ohne ID oder Stand wirft', () => {
  assert.equal(sp.sperrSchluessel('R-9001', '2026-09-20T08:15:00Z'), 'antwort|R-9001|2026-09-20T08:15:00Z');
  assert.throws(() => sp.sperrSchluessel('', '2026-09-20T08:15:00Z'));
  assert.throws(() => sp.sperrSchluessel('R-9001', 'gestern'));
});

test('datenZeile: genau sieben Spalten, nie ein Text oder Name (BAUPLAN b, S18 sinngemäß)', () => {
  const z = sp.datenZeile('antwort|R-9001|2026-09-20T08:15:00Z', 'reserviert', { id: '7000', zeit: '2026-09-28T06:00:01.000Z' },
    { bewertung_id: 'R-9001', text_hash: 'ab'.repeat(32), text: 'Guten Tag, Frau Musterfrau', anzeigename: 'Petra Musterfrau', grund: '' });
  assert.deepEqual(Object.keys(z).sort(), ['aktion', 'bewertung_id', 'grund', 'lauf_id', 'schluessel', 'text_hash', 'zeit_utc']);
  assert.ok(!JSON.stringify(z).includes('Musterfrau'));
  assert.throws(() => sp.datenZeile('k', 'erfunden', { id: '7000', zeit: 'z' }, {}));
});

test('S21 ergebnisAktion: veroeffentlicht; sicher nichts geschrieben → zurueckgegeben; vielleicht geschrieben → unklar; trocken → keine Zeile', () => {
  assert.equal(sp.ergebnisAktion({ status: 'veroeffentlicht', geschrieben: true }), 'veroeffentlicht');
  assert.equal(sp.ergebnisAktion({ status: 'vorbedingung_verletzt', grund: 'geaendert', geschrieben: false }), 'zurueckgegeben');
  assert.equal(sp.ergebnisAktion({ status: 'fehler', grund: '500', geschrieben: false }), 'zurueckgegeben');
  assert.equal(sp.ergebnisAktion({ status: 'fehler', grund: '500', geschrieben: true }), 'unklar');
  assert.equal(sp.ergebnisAktion({ status: 'wuerde_veroeffentlichen', geschrieben: false }), null);
  assert.equal(sp.ergebnisAktion(null), 'unklar');
});

test('S21 abgebrochener Lauf: Antwort in der Quelle mit gleichem Hash → nachziehen; ohne oder anderer Hash → unklar, nie erneut', () => {
  const h = 'ab'.repeat(32);
  assert.deepEqual(sp.abgebrochenNachziehen({ antwort_vorhanden: true, antwort_hash: h }, h), { aktion: 'veroeffentlicht', grund: 'nachgezogen über den Hash' });
  assert.equal(sp.abgebrochenNachziehen({ antwort_vorhanden: true, antwort_hash: 'cd'.repeat(32) }, h).aktion, 'unklar');
  assert.equal(sp.abgebrochenNachziehen({ antwort_vorhanden: false }, h).aktion, 'unklar');
});

test('S21 Versandstatus klären: veröffentlicht mit Antwort gleichen Hashs → nachziehen; nicht veröffentlicht → zurückgeben; ohne offene Reservierung → Hinweis', () => {
  const tot = [r(1, 'reserviert', '6990', '2026-09-27T06:00:00.000Z')];
  const h = 'ab'.repeat(32);
  assert.equal(sp.klaereVersandstatus('veröffentlicht', tot, '7000', '2026-09-28T06:00:00.000Z', { antwort_vorhanden: true, antwort_hash: h }, h).aktion, 'veroeffentlicht');
  assert.equal(sp.klaereVersandstatus('veröffentlicht', tot, '7000', '2026-09-28T06:00:00.000Z', { antwort_vorhanden: false }, h).aktion, 'hinweis');
  assert.equal(sp.klaereVersandstatus('nicht veröffentlicht', tot, '7000', '2026-09-28T06:00:00.000Z', {}, h).aktion, 'zurueckgegeben');
  assert.equal(sp.klaereVersandstatus('nicht veröffentlicht', [], '7000', '2026-09-28T06:00:00.000Z', {}, h).aktion, 'hinweis');
  assert.equal(sp.klaereVersandstatus('vielleicht', tot, '7000', '2026-09-28T06:00:00.000Z', {}, h).aktion, 'hinweis');
  assert.equal(sp.klaereVersandstatus('', tot, '7000', '2026-09-28T06:00:00.000Z', {}, h), null);
});

test('Baustein 8: „Versandstatus klären“ löst auch „unklar“ (Fehler nach dem Schreibaufruf) - Hash aus der offenen Zeile, wenn keiner übergeben wird', () => {
  const h = 'ab'.repeat(32);
  const tot = [Object.assign(r(1, 'reserviert', '6990', '2026-09-27T06:00:00.000Z'), { text_hash: h })];
  const unklar = [Object.assign(r(1, 'reserviert', '6990', '2026-09-27T06:00:00.000Z'), { text_hash: h }), Object.assign(r(2, 'unklar', '6990', '2026-09-27T06:00:09.000Z'), { text_hash: h })];
  const L = ['7000', '2026-09-28T06:00:00.000Z'];
  const mit = { antwort_vorhanden: true, antwort_hash: h };
  assert.equal(sp.klaereVersandstatus('veröffentlicht', tot, L[0], L[1], mit, '').aktion, 'veroeffentlicht');
  assert.equal(sp.klaereVersandstatus('veröffentlicht', unklar, L[0], L[1], mit, '').aktion, 'veroeffentlicht');
  assert.equal(sp.klaereVersandstatus('nicht veröffentlicht', unklar, L[0], L[1], { antwort_vorhanden: false }, '').aktion, 'zurueckgegeben');
  assert.equal(sp.klaereVersandstatus('nicht veröffentlicht', unklar, L[0], L[1], mit, '').aktion, 'hinweis');
  const fertig = [Object.assign(r(1, 'reserviert', '6990'), { text_hash: h }), Object.assign(r(2, 'veroeffentlicht', '6990'), { text_hash: h })];
  assert.equal(sp.klaereVersandstatus('veröffentlicht', fertig, L[0], L[1], mit, '').aktion, 'hinweis');
});
