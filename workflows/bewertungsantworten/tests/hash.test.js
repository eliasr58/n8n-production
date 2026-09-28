'use strict';
// hash.js: SHA-256 als eigene Funktion (Auftrag 27.09.2026: solange crypto im Task-Runner ungemessen ist), Zeilenenden normalisiert.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const hs = require('../kern/hash.js');

test('NIST-Vektoren: leer, „abc“, 448 Bit', () => {
  assert.equal(hs.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hs.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hs.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('gleich node:crypto für Umlaute, Emoji mit ZWJ, Surrogate und Längen um die Blockgrenzen', () => {
  const faelle = ['Grüße 👍', '👨‍👩‍👧 Dach', 'ß'.repeat(55), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000), '€ä😀'];
  for (const s of faelle) assert.equal(hs.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), s.slice(0, 10));
});

test('textHash: Zeilenenden normalisiert (\\r\\n und \\r wie \\n); Kontrolle anderer Text anderer Hash', () => {
  assert.equal(hs.textHash('a\r\nb\rc'), hs.textHash('a\nb\nc'));
  assert.equal(hs.textHash('a\nb'), hs.sha256Hex('a\nb'));
  assert.notEqual(hs.textHash('a\nb'), hs.textHash('a\nb '));
});
