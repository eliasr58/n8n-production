'use strict';
// Nachbau Teil B 1 und B 6: Kundenmail als RFC-5322/MIME-Nachricht, gleich für direkten Versand und Entwurf.
// Gemessen (Lauf 5939): Gmail-Knoten senden → „Tischlerei Beispiel GmbH <…>“ (der Zusatz „(Test)“ fehlt),
// Entwurf → Name des Kontoinhabers. Alle Adressen erfunden (@example.invalid).
const test = require('node:test');
const assert = require('node:assert/strict');
const mi = require('../kern/mime.js');

const kopf = (nachricht, name) => {
  const k = nachricht.split('\r\n\r\n')[0].replace(/\r\n[ \t]/g, ' ').split('\r\n');
  const z = k.find((x) => x.toLowerCase().startsWith(name.toLowerCase() + ':'));
  return z ? z.slice(name.length + 1).trim() : undefined;
};
const wort = (s) => s.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/g, (g, b) => Buffer.from(b, 'base64').toString('utf8'));
const M = (abw) => Object.assign({ von_name: 'Tischlerei Beispiel GmbH (Test)', von_adresse: 'absender@example.invalid',
  an: 'test@example.invalid', antwort_an: '', betreff: 'Zahlungserinnerung zur Rechnung RE-2026-9002', text: 'Guten Tag,\nZeile 2', anhaenge: [] }, abw || {});

test('From: ASCII-Name mit Klammern als quoted-string – „(Test)“ bleibt Teil des Namens', () => {
  assert.equal(kopf(mi.baueMime(M()), 'From'), '"Tischlerei Beispiel GmbH (Test)" <absender@example.invalid>');
  assert.equal(mi.mimeAdresse('Firma "X" \\ Y', 'a@example.invalid'), '"Firma \\"X\\" \\\\ Y" <a@example.invalid>');
  assert.equal(mi.mimeAdresse('', 'a@example.invalid'), 'a@example.invalid');
});

test('From mit Umlauten: RFC 2047 (UTF-8, B), jedes Wort höchstens 75 Zeichen, dekodiert gleich dem Namen', () => {
  const name = 'Tischlerei Bäumer & Söhne GmbH (Test) – Möbel, Türen, Küchen und Innenausbau aus Überlingen';
  const n = mi.baueMime(M({ von_name: name }));
  const roh = n.split('\r\n\r\n')[0].split('\r\n');
  const from = kopf(n, 'From');
  assert.match(from, /^=\?UTF-8\?B\?/);
  assert.equal(wort(from.replace(/ <absender@example\.invalid>$/, '')), name);
  (from.match(/=\?UTF-8\?B\?[^?]*\?=/g) || []).forEach((w) => assert.ok(w.length <= 75, w));
  roh.forEach((z) => assert.ok(z.length <= 998));
  assert.ok(/^[\x20-\x7e\r\n\t]*$/.test(n), 'Nachricht ist reines ASCII');
});

test('Betreff: ASCII unverändert; mit Umlaut kodiert; Zeilenumbruch in Betreff oder Name wirft (Kopfinjektion)', () => {
  assert.equal(kopf(mi.baueMime(M()), 'Subject'), 'Zahlungserinnerung zur Rechnung RE-2026-9002');
  const b = kopf(mi.baueMime(M({ betreff: 'Übergabe RE-2026-9016' })), 'Subject');
  assert.equal(wort(b), 'Übergabe RE-2026-9016');
  assert.throws(() => mi.baueMime(M({ betreff: 'x\r\nBcc: y@example.invalid' })), /Zeilenumbruch/);
  assert.throws(() => mi.baueMime(M({ von_name: 'x\nBcc: y' })), /Zeilenumbruch/);
  assert.throws(() => mi.baueMime(M({ an: 'a@example.invalid, b@example.invalid' })), /Empfänger ungültig/);
  assert.throws(() => mi.baueMime(M({ von_adresse: '' })), /Absenderadresse ungültig/);
});

test('Ohne Anhang: text/plain UTF-8 base64, Text mit CRLF, Reply-To nur wenn gesetzt, To genau ein Empfänger', () => {
  const n = mi.baueMime(M({ text: 'Offen sind 600,00 €.\nGrüße' }));
  assert.equal(kopf(n, 'To'), 'test@example.invalid');
  assert.equal(kopf(n, 'Reply-To'), undefined);
  assert.equal(kopf(n, 'MIME-Version'), '1.0');
  assert.equal(kopf(n, 'Content-Type'), 'text/plain; charset=UTF-8');
  assert.equal(kopf(n, 'Content-Transfer-Encoding'), 'base64');
  const rumpf = n.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  assert.equal(Buffer.from(rumpf.replace(/\r\n/g, ''), 'base64').toString('utf8'), 'Offen sind 600,00 €.\r\nGrüße');
  rumpf.split('\r\n').forEach((z) => assert.ok(z.length <= 76));
  assert.equal(kopf(mi.baueMime(M({ antwort_an: 'antwort@example.invalid' })), 'Reply-To'), 'antwort@example.invalid');
});

test('Mit PDF-Anhang: multipart/mixed, Textteil und Anhang mit Dateiname, base64-Zeilen ≤ 76', () => {
  const pdf = Buffer.from('%PDF-1.4\n' + 'x'.repeat(200), 'latin1').toString('base64');
  const n = mi.baueMime(M({ anhaenge: [{ name: 'RE-2026-9002.pdf', typ: 'application/pdf', base64: pdf }] }));
  const ct = kopf(n, 'Content-Type');
  assert.match(ct, /^multipart\/mixed; boundary="(.+)"$/);
  const g = /boundary="(.+)"/.exec(ct)[1];
  const teile = n.split('--' + g);
  assert.equal(teile.length, 4);
  assert.match(teile[2], /Content-Type: application\/pdf; name="RE-2026-9002\.pdf"/);
  assert.match(teile[2], /Content-Disposition: attachment; filename="RE-2026-9002\.pdf"/);
  const b64 = teile[2].split('\r\n\r\n')[1].trim();
  assert.equal(Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString('latin1').slice(0, 5), '%PDF-');
  b64.split('\r\n').forEach((z) => assert.ok(z.length <= 76));
  assert.equal(teile[3].trim(), '--');
});

test('Dateiname aus der Rechnungsnummer, nur sichere Zeichen', () => {
  assert.equal(mi.mimeDateiname('RE-2026-9002'), 'RE-2026-9002.pdf');
  assert.equal(mi.mimeDateiname('RE 2026/9002 "ü"'), 'RE_2026_9002____.pdf');
  assert.equal(mi.mimeDateiname(''), 'Rechnung.pdf');
});

test('raw für die Gmail-API: base64url ohne Auffüllung, zurückgewandelt gleich der Nachricht; Nicht-ASCII wirft', () => {
  const n = mi.baueMime(M());
  const r = mi.mimeRaw(n);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(r));
  assert.equal(Buffer.from(r.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'), n);
  assert.throws(() => mi.mimeRaw('Subject: Ü\r\n\r\nx'), /nicht ASCII/);
});
