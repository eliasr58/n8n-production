'use strict';
// zeit.js: Laufplan (E2 werktags 08:00 und 14:00 Berlin) und Löschfrist (E7, S26, B28). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const zt = require('../kern/zeit.js');

test('berlinZuUtc: Sommer- und Winterzeit, Umstellungstage', () => {
  assert.equal(zt.berlinZuUtc('2026-09-25', '14:00'), '2026-09-25T12:00:00Z');
  assert.equal(zt.berlinZuUtc('2026-12-01', '08:00'), '2026-12-01T07:00:00Z');
  assert.equal(zt.berlinZuUtc('2026-03-29', '08:00'), '2026-03-29T06:00:00Z');
  assert.equal(zt.berlinZuUtc('2026-10-25', '08:00'), '2026-10-25T07:00:00Z');
});

test('naechsterPlanlauf: werktags 08:00 und 14:00 Berlin, echt nach jetzt; Freitag 14:00 → Montag 08:00', () => {
  assert.equal(zt.naechsterPlanlauf('2026-09-28T05:00:00Z'), '2026-09-28T06:00:00Z');
  assert.equal(zt.naechsterPlanlauf('2026-09-28T06:00:00Z'), '2026-09-28T12:00:00Z');
  assert.equal(zt.naechsterPlanlauf('2026-10-02T12:00:00Z'), '2026-10-05T06:00:00Z');
  assert.equal(zt.naechsterPlanlauf('2026-10-23T12:00:00Z'), '2026-10-26T07:00:00Z');
});

test('B28 Löschfrist: Frist 30, Lauf Freitag 14:00, Stand vor 28 Tagen → Montag wäre Tag 31 → heute löschen; Kontrolle 20 Tage', () => {
  const jetzt = '2026-10-02T12:00:00Z';
  assert.equal(zt.loeschfristFaellig('2026-09-04T12:00:00Z', 30, jetzt), true);
  assert.equal(zt.loeschfristFaellig('2026-09-12T12:00:00Z', 30, jetzt), false);
  assert.equal(zt.loeschfristFaellig('2026-08-01T00:00:00Z', 30, jetzt), true);
  assert.equal(zt.loeschfristFaellig('ungültig', 30, jetzt), true);
});

test('Löschfrist genau am nächsten Lauf → schon jetzt löschen (nie länger als erlaubt); eine Minute danach → noch nicht', () => {
  assert.equal(zt.loeschfristFaellig('2026-09-05T06:00:00Z', 30, '2026-10-02T12:00:00Z'), true);
  assert.equal(zt.loeschfristFaellig('2026-09-05T06:01:00Z', 30, '2026-10-02T12:00:00Z'), false);
});
