'use strict';
// anlagen.js: Blatt „Anlagen“ lesen (BAUPLAN b). Eingabe wie values.get mit UNFORMATTED_VALUE/SERIAL_NUMBER.
const test = require('node:test');
const assert = require('node:assert/strict');
const an = require('../kern/anlagen.js');

const KOPF = an.AN_SPALTEN.slice();
// Seriennummer (Tage seit 30.12.1899) für ein ISO-Datum
const serie = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

function zeile(werte) {
  const z = KOPF.map(() => '');
  for (const [k, v] of Object.entries(werte)) {
    const i = KOPF.indexOf(k);
    if (i < 0) throw new Error('unbekannte Spalte ' + k);
    z[i] = v;
  }
  return z;
}
const basis = (nr, abw) => zeile(Object.assign({
  'Anlagen-ID': 'W-' + nr, 'Kunden-ID': 'K-' + nr, 'Kunde': 'Kunde Beispiel ' + String(nr).slice(-2),
  'E-Mail': 'kunde-' + String(nr).slice(-2) + '@example.invalid', 'Anlage': 'Gas-Brennwerttherme',
  'Leistung des Betriebs': 'Wartung', 'Adresse erhoben bei': 'RE-2025-' + nr, 'Widerspruchshinweis bei Erhebung': serie('2025-10-01'),
  'Einbaudatum': serie('2018-05-14'), 'letzte Wartung': serie('2025-10-20'), 'Intervall (Monate)': 12,
}, abw || {}));

test('Spalten in fester Reihenfolge, Pflichtspalten § 7 Abs. 3 enthalten', () => {
  for (const s of ['Leistung des Betriebs', 'Adresse erhoben bei', 'Widerspruchshinweis bei Erhebung', 'Werbewiderspruch',
    'Widerspruch aufheben', 'Pause', 'Pause Grund', 'Thread-ID', 'Versandstatus klären']) {
    assert.ok(KOPF.includes(s), s);
  }
  assert.equal(new Set(KOPF).size, KOPF.length);
});

test('W22: Kopfzeile exakt — fehlende, umbenannte, vertauschte oder zusätzliche Spalte → nicht ok; Kontrolle exakt', () => {
  assert.equal(an.leseAnlagen([KOPF, basis(9001)]).ok, true);
  const umbenannt = KOPF.map((s) => (s === 'Intervall (Monate)' ? 'Intervall' : s));
  const r = an.leseAnlagen([umbenannt, basis(9001)]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.fehlend, ['Intervall (Monate)']);
  const vertauscht = KOPF.slice(); [vertauscht[1], vertauscht[2]] = [vertauscht[2], vertauscht[1]];
  assert.equal(an.leseAnlagen([vertauscht, basis(9001)]).ok, false);
  assert.equal(an.leseAnlagen([KOPF.concat(['Neu']), basis(9001)]).ok, false);
  assert.equal(an.leseAnlagen([KOPF.map((s) => ' ' + s + ' ')]).ok, true, 'Leerzeichen am Rand zählen nicht');
  assert.equal(an.leseAnlagen([]).ok, false);
});

test('Werte: Seriennummer und ISO werden JJJJ-MM-TT, Text wird „ungültig: …“, leer bleibt leer', () => {
  const r = an.leseAnlagen([KOPF, basis(9001, { 'letzte Wartung': '2025-10-20', 'Angebot am': 'irgendwann', 'Erinnerung am': '' })]);
  const a = r.anlagen[0];
  assert.equal(a.letzte_wartung, '2025-10-20');
  assert.equal(a.einbaudatum, '2018-05-14');
  assert.equal(a.hinweis_erhebung, '2025-10-01');
  assert.equal(a.angebot_am, 'ungültig: irgendwann');
  assert.equal(a.erinnerung_am, '');
  assert.equal(a.intervall, 12);
  assert.equal(a.zeile, 2);
});

test('Intervall: leer → null, Zahl als Text → Zahl, sonst NaN', () => {
  const lies = (v) => an.leseAnlagen([KOPF, basis(9001, { 'Intervall (Monate)': v })]).anlagen[0].intervall;
  assert.equal(lies(''), null);
  assert.equal(lies('24'), 24);
  assert.ok(Number.isNaN(lies('zwölf')));
});

test('Pause und Werbewiderspruch: unklarer Wert gilt (übernommene Sperre-Regel), leer/nein nicht', () => {
  const lies = (spalte, v) => an.leseAnlagen([KOPF, basis(9001, { [spalte]: v })]).anlagen[0];
  assert.equal(lies('Pause', 'ja').pause, true);
  assert.equal(lies('Pause', 'vielleicht').pause, true);
  assert.equal(lies('Pause', 'nein').pause, false);
  assert.equal(lies('Pause', '').pause, false);
  assert.equal(lies('Werbewiderspruch', 'ja').werbewiderspruch, true);
  assert.equal(lies('Werbewiderspruch', 'x').werbewiderspruch, true);
  assert.equal(lies('Werbewiderspruch', '').werbewiderspruch, false);
});

test('Dublette der Anlagen-ID → beide Zeilen mit Mangel; leere Zeilen übersprungen', () => {
  const r = an.leseAnlagen([KOPF, basis(9001), KOPF.map(() => ''), basis(9001, { 'Kunden-ID': 'K-X' }), basis(9002)]);
  assert.equal(r.anlagen.length, 3);
  assert.deepEqual(r.dubletten, ['W-9001']);
  assert.deepEqual(r.anlagen.filter((a) => a.mangel.includes('Anlagen-ID doppelt')).map((a) => a.zeile), [2, 4]);
  assert.deepEqual(r.anlagen.find((a) => a.anlagen_id === 'W-9002').mangel, []);
});

test('fehlende Anlagen-ID oder Kunden-ID → Mangel', () => {
  const r = an.leseAnlagen([KOPF, basis(9001, { 'Anlagen-ID': '' }), basis(9002, { 'Kunden-ID': ' ' })]);
  assert.ok(r.anlagen[0].mangel.includes('Anlagen-ID fehlt'));
  assert.ok(r.anlagen[1].mangel.includes('Kunden-ID fehlt'));
});

test('übernommen: Seriennummer → Datum (aus Mahnlauf offene-posten.js)', () => {
  assert.equal(an.seriennummerZuDatum(46279), '2026-09-14');
  assert.equal(an.seriennummerZuDatum(0), null);
  assert.equal(an.seriennummerZuDatum('46279'), null);
});

test('Teil A 7: Spalte „Antwort erledigt“ direkt nach „Antwort“; nur „ja“ gilt als erledigt, alles andere nicht (sperrt weiter)', () => {
  assert.equal(KOPF.indexOf('Antwort erledigt'), KOPF.indexOf('Antwort') + 1);
  const r = an.leseAnlagen([KOPF, basis(9001, { 'Antwort erledigt': 'ja' }), basis(9002, { 'Antwort erledigt': ' JA ' }),
    basis(9003), basis(9004, { 'Antwort erledigt': 'x' }), basis(9005, { 'Antwort erledigt': 'nein' })]);
  assert.deepEqual(r.anlagen.map((a) => a.antwort_erledigt), [true, true, false, false, false]);
});
