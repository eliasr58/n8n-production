'use strict';
// einstellungen.js: Felder aus BAUPLAN b, Prüfung vor jedem Schreiben (c 1, S17, B34, E7, E12). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const ei = require('../kern/einstellungen.js');

const BLATT = [['Schlüssel', 'Wert'], ['Modus', 'Test'], ['Quelle', 'test'], ['Meldeadresse', 'meldung@example.invalid'],
  ['Absenderadresse', 'info@example.invalid'], ['Betriebsname', 'Zimmerei & Dachbau Beispiel GmbH'],
  ['Signatur', 'Ihr Team der Zimmerei & Dachbau Beispiel GmbH'], ['Kontaktweg', 'Rufen Sie uns gern an: 0000 000000'],
  ['Eigene Domain', 'zimmerei-beispiel.example'], ['Bewertungen ab', 46266], ['Höchstzahl Veröffentlichungen je Lauf', 10],
  ['Höchstzahl Entwürfe je Lauf', 20], ['Höchstlänge', 800], ['Löschfrist in Tagen', 30], ['Stichtag (nur Test)', ''],
  ['zusätzliche verbotene Begriffe', 'Rabatt; Gutschein']];
const kern = (abw) => Object.assign({}, ei.leseEinstellungen(BLATT).kern, abw || {});

test('liest alle Felder; Adressen nie in der Ausgabe, nur gesetzt ja/nein; verbotene Begriffe als Liste', () => {
  const r = ei.leseEinstellungen(BLATT);
  assert.deepEqual([r.ok, r.fehlend], [true, []]);
  assert.deepEqual([r.kern.modus, r.kern.quelle, r.kern.loeschfrist, r.kern.bewertungen_ab], ['test', 'test', 30, '2026-09-01']);
  assert.ok(!JSON.stringify(r).includes('@example.invalid'));
  assert.deepEqual(r.adressen_gesetzt, { meldeadresse: true, absenderadresse: true });
  assert.deepEqual(ei.verboteneBegriffe(r.kern), ['Rabatt', 'Gutschein']);
});

test('Feldliste: jeder Schlüssel genau einmal; fehlender Schlüssel → nicht ok mit Namen', () => {
  const k = ei.EI_FELDER.map((f) => f[0]);
  assert.equal(new Set(k).size, k.length);
  assert.deepEqual(ei.leseEinstellungen(BLATT.filter((z) => z[0] !== 'Kontaktweg')).fehlend, ['Kontaktweg']);
});

test('c 1 Prüfung: gültig → keine Fehler; Kontrolle je Regel ein Fehler', () => {
  assert.deepEqual(ei.pruefeEinstellungen(kern()), []);
  const fall = (abw, muster) => assert.ok(ei.pruefeEinstellungen(kern(abw)).some((f) => muster.test(f)), JSON.stringify(abw));
  fall({ modus: 'scharf' }, /scharf gesperrt/);
  fall({ modus: 'probe' }, /Modus unbekannt/);
  fall({ quelle: 'google' }, /Modus test verlangt Quelle test/);
  fall({ quelle: 'sevdesk', modus: 'trocken' }, /Quelle unbekannt/);
  fall({ loeschfrist: 31 }, /Löschfrist/);
  fall({ loeschfrist: 0 }, /Löschfrist/);
  fall({ hoechstlaenge: 4097 }, /Höchstlänge/);
  fall({ hoechstzahl_veroeffentlichungen: NaN }, /Höchstzahl/);
  fall({ signatur: '' }, /Signatur/);
  assert.deepEqual(ei.pruefeEinstellungen(kern({ modus: 'trocken', quelle: 'google' })), []);
  assert.deepEqual(ei.EI_SPALTEN, ['Schlüssel', 'Wert', 'Bemerkung']);
  assert.ok(!ei.EI_FELDER.some((f) => /Baustein/.test(f[0])), 'Bausteine stehen im eigenen Blatt');
});
