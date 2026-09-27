'use strict';
// textbausteine.js: feste Bausteine, geprüfte Platzhalter, Widerspruchshinweis vom Code (BAUPLAN b, d, e).
const test = require('node:test');
const assert = require('node:assert/strict');
const tb = require('../kern/textbausteine.js');
const wi = require('../kern/widerspruch.js');

const KOPF = ['Art', 'Betreff', 'Text'];
const ANGEBOT = ['Angebot', 'Wartung Ihrer {anlage} – {vorgang}',
  'Guten Tag {kunde},\n\nIhre {anlage} ist im {faellig_monat} zur Wartung fällig. Rufen Sie uns an: {telefon}.\n\n{widerspruch}\n\n{signatur}'];
const ERINNERUNG = ['Erinnerung', 'Erinnerung: Wartung Ihrer {anlage} – {vorgang}',
  'Guten Tag {kunde},\n\nwir erinnern an die Wartung im {faellig_monat}.\n\n{widerspruch}\n\n{signatur}'];
const WERTE = { kunde: 'Kunde Beispiel 01', anlage: 'Gas-Brennwerttherme', faellig_monat: 'Oktober 2026', vorgang: 'W-9001/2026-10',
  firma: 'Heizung & Sanitär Beispiel GmbH', telefon: '0000 000000', signatur: 'Heizung & Sanitär Beispiel GmbH (Test)' };
const blatt = (...z) => [KOPF].concat(z);

test('der Widerspruchsabsatz ist in beiden Modulen derselbe', () => {
  assert.equal(tb.WIDERSPRUCH_ABSATZ, wi.WIDERSPRUCH_ABSATZ);
  assert.match(tb.WIDERSPRUCH_ABSATZ, /jederzeit widersprechen/);
  assert.match(tb.WIDERSPRUCH_ABSATZ, /Basistarif/);
});

test('Fälligkeitsmonat und Vorgang', () => {
  assert.equal(tb.faelligMonat('2026-10-20'), 'Oktober 2026');
  assert.equal(tb.faelligMonat('2027-03-01'), 'März 2027');
  assert.throws(() => tb.faelligMonat('2026-13-01'));
});

test('pruefeTextbausteine: gültiges Blatt', () => {
  assert.deepEqual(tb.pruefeTextbausteine(blatt(ANGEBOT, ERINNERUNG)), { ok: true, fehler: [] });
});

test('W14: jeder Text braucht {widerspruch} genau einmal — fehlt oder doppelt → Fehler; Kontrolle einmal', () => {
  const ohne = ['Erinnerung', ERINNERUNG[1], ERINNERUNG[2].replace('{widerspruch}', '')];
  const doppelt = ['Erinnerung', ERINNERUNG[1], ERINNERUNG[2] + '\n{widerspruch}'];
  const leerzeichen = ['Erinnerung', ERINNERUNG[1], ERINNERUNG[2].replace('{widerspruch}', '{ widerspruch }')];
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT, ohne)).ok, false);
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT, doppelt)).ok, false);
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT, leerzeichen)).ok, true);
});

test('Betreff trägt {vorgang}; Betreffe der Arten verschieden; jede Art genau einmal; unbekannte Art', () => {
  const ohneVorgang = ['Angebot', 'Wartung Ihrer {anlage}', ANGEBOT[2]];
  assert.equal(tb.pruefeTextbausteine(blatt(ohneVorgang, ERINNERUNG)).ok, false);
  const gleich = ['Erinnerung', ANGEBOT[1], ERINNERUNG[2]];
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT, gleich)).ok, false);
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT)).ok, false);
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT, ERINNERUNG, ERINNERUNG)).ok, false);
  assert.equal(tb.pruefeTextbausteine(blatt(ANGEBOT, ERINNERUNG, ['Mahnung', 'x {vorgang}', 'y {widerspruch}'])).ok, false);
  assert.equal(tb.pruefeTextbausteine([['Art', 'Betreff'], ANGEBOT]).ok, false);
});

test('unbekannter Platzhalter im Blatt → Fehler (übernommene Prüfung)', () => {
  const falsch = ['Angebot', ANGEBOT[1], ANGEBOT[2].replace('{telefon}', '{telfon}')];
  const r = tb.pruefeTextbausteine(blatt(falsch, ERINNERUNG));
  assert.equal(r.ok, false);
  assert.ok(r.fehler.some((f) => /telfon/.test(f)));
});

test('baueMail: Hinweis vom Code eingesetzt, Werte des Aufrufers für {widerspruch} werden ignoriert', () => {
  const m = tb.baueMail('Angebot', Object.assign({ widerspruch: 'nichts' }, WERTE), blatt(ANGEBOT, ERINNERUNG));
  assert.equal(m.ok, true);
  assert.equal(m.betreff, 'Wartung Ihrer Gas-Brennwerttherme – W-9001/2026-10');
  assert.ok(m.text.includes(tb.WIDERSPRUCH_ABSATZ));
  assert.ok(!m.text.includes('nichts'));
  assert.ok(!/[{}]/.test(m.text));
});

test('baueMail: leerer Wert oder unbekannte Art → kein Text', () => {
  assert.equal(tb.baueMail('Angebot', Object.assign({}, WERTE, { telefon: '' }), blatt(ANGEBOT, ERINNERUNG)).ok, false);
  assert.equal(tb.baueMail('Mahnung', WERTE, blatt(ANGEBOT, ERINNERUNG)).ok, false);
});

test('baueMail: ohne gültiges Blatt keine Mail (Prüfung auch hier, nicht nur im Plan)', () => {
  const ohne = ['Angebot', ANGEBOT[1], ANGEBOT[2].replace('{widerspruch}', '')];
  assert.equal(tb.baueMail('Angebot', WERTE, blatt(ohne, ERINNERUNG)).ok, false);
});

test('hinweisEnthalten: letzte Prüfung vor dem Senden', () => {
  assert.equal(tb.hinweisEnthalten('Text\n\n' + tb.WIDERSPRUCH_ABSATZ), true);
  assert.equal(tb.hinweisEnthalten('Text ohne Hinweis'), false);
  assert.equal(tb.hinweisEnthalten('Text ' + tb.WIDERSPRUCH_ABSATZ.slice(0, 40)), false);
});

test('übernommen: formatiereDatum (aus Mahnlauf platzhalter.js)', () => {
  assert.equal(tb.formatiereDatum('2026-09-24'), '24.09.2026');
  assert.throws(() => tb.formatiereDatum('2026-02-30'));
});
