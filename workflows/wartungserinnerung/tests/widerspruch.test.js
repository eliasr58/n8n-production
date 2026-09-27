'use strict';
// widerspruch.js: Wortliste, Anfrage an Claude, Prüfung der Antwort, Einordnung (BAUPLAN c 4, d).
// Antwortformen gemessen in Baustein 1 (Lauf 6600): 200 mit einem Textblock, 404 not_found_error, 401 authentication_error.
const test = require('node:test');
const assert = require('node:assert/strict');
const wi = require('../kern/widerspruch.js');

const kiOk = (inhalt, abw) => ({ statusCode: 200, body: Object.assign({
  type: 'message', model: 'claude-haiku-4-5-20251001', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(inhalt) }] }, abw || {}) });
const TERMIN = { kategorie: 'termin', sicher: true, widerspruch_moeglich: false };

test('Wortliste: Treffer in üblichen Formulierungen (klein, Umlaute, Zeilenumbruch)', () => {
  const ja = [
    'Bitte schicken Sie mir keine Werbung mehr.', 'Ich widerspreche der Nutzung meiner Daten.', 'Widerspruch!',
    'Bitte abmelden', 'Ich möchte das abbestellen.', 'Keine weiteren E-Mails bitte', 'keine Mails mehr',
    'Keine Angebote mehr.', 'Bitte nicht mehr anschreiben', 'Kontaktieren Sie mich nicht mehr', 'Bitte austragen',
    'Löschen Sie meine Daten', 'Bitte Daten loeschen', 'UNSUBSCRIBE', 'Bitte\nkeine   Werbung',
  ];
  for (const t of ja) assert.ok(wi.pruefeWortliste(t).length > 0, t);
});

test('Wortliste: Kontrolle — Terminwunsch, Rückfrage, Absage ohne Widerspruch lösen nicht aus', () => {
  const nein = ['Gern, rufen Sie mich an.', 'Was kostet die Wartung?', 'Diesmal kein Bedarf, nächstes Jahr gern.',
    'Die Werbung im Briefkasten war hübsch, Termin bitte.', 'Ich bin nicht mehr im Urlaub, Termin gern ab Montag.'];
  for (const t of nein) assert.deepEqual(wi.pruefeWortliste(t), [], t);
});

test('Wortliste: der eigene Widerspruchshinweis (zitiert oder nicht) löst nicht aus', () => {
  const t = 'Termin gern.\n\n' + wi.WIDERSPRUCH_ABSATZ + '\n';
  assert.deepEqual(wi.pruefeWortliste(t), []);
  const umbrochen = 'Termin gern.\n' + wi.WIDERSPRUCH_ABSATZ.replace(/ /g, '\n');
  assert.deepEqual(wi.pruefeWortliste(umbrochen), []);
  assert.ok(wi.pruefeWortliste('Keine Werbung. ' + wi.WIDERSPRUCH_ABSATZ).length > 0);
});

test('Anfrage: Modell, Schema mit genau drei Feldern, kein freies Textfeld, nur der übergebene Text', () => {
  const b = wi.kiAnfrage('Termin bitte.');
  assert.equal(b.model, 'claude-haiku-4-5-20251001');
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].content, 'Termin bitte.');
  const s = b.output_config.format;
  assert.equal(s.type, 'json_schema');
  assert.deepEqual(Object.keys(s.schema.properties).sort(), ['kategorie', 'sicher', 'widerspruch_moeglich']);
  assert.deepEqual(s.schema.required.slice().sort(), ['kategorie', 'sicher', 'widerspruch_moeglich']);
  assert.equal(s.schema.additionalProperties, false);
  assert.deepEqual(s.schema.properties.kategorie.enum, ['termin', 'rueckfrage', 'kein_interesse', 'widerspruch']);
  assert.throws(() => wi.kiAnfrage(''));
});

test('Teil A 2: Modell fest auf claude-haiku-4-5-20251001 (Tests gelten für eine feste Fassung), kein Aufrufer ändert es', () => {
  assert.equal(wi.KI_MODELL, 'claude-haiku-4-5-20251001');
  assert.equal(wi.kiAnfrage('Termin bitte.').model, 'claude-haiku-4-5-20251001');
  assert.equal(wi.kiAnfrage('Termin bitte.', 'claude-haiku-4-5').model, 'claude-haiku-4-5-20251001');
  assert.equal(wi.kiAnfrage('Termin bitte.', 'claude-sonnet-5').model, 'claude-haiku-4-5-20251001');
});

test('KI-Antwort prüfen: gültige Antwort', () => {
  assert.deepEqual(wi.pruefeKiAntwort(kiOk(TERMIN)), { ok: true, kategorie: 'termin', sicher: true, widerspruch_moeglich: false, grund: '' });
});

test('KI-Antwort prüfen: jede Abweichung ist ungültig', () => {
  const faelle = [
    { statusCode: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model: x' } } },
    { statusCode: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } },
    { statusCode: 529, body: {} },
    { error: { message: 'The connection was aborted, perhaps the server is offline' } },
    kiOk(TERMIN, { stop_reason: 'max_tokens' }),
    kiOk(TERMIN, { stop_reason: 'refusal' }),
    kiOk(TERMIN, { content: [] }),
    { statusCode: 200, body: { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n{}\n```' }] } },
    kiOk({ kategorie: 'termin', sicher: true }),
    kiOk({ kategorie: 'termin', sicher: 'ja', widerspruch_moeglich: false }),
    kiOk({ kategorie: 'anruf', sicher: true, widerspruch_moeglich: false }),
    kiOk(Object.assign({ begruendung: 'x' }, TERMIN)),
    null,
  ];
  for (const f of faelle) assert.equal(wi.pruefeKiAntwort(f).ok, false, JSON.stringify(f));
});

test('Einordnung: Wortliste sperrt ohne KI (W07)', () => {
  const r = wi.ordneEin({ text: 'Bitte abmelden.', ki_an: true, ki: null });
  assert.deepEqual(r, { gesperrt: true, grund: 'Wortliste', klasse: 'widerspruch', ki_noetig: false });
  const k = wi.ordneEin({ text: 'Termin bitte.', ki_an: true, ki: null });
  assert.equal(k.ki_noetig, true);
});

test('Einordnung: Wortliste gewinnt auch gegen eine sichere KI-Einordnung', () => {
  const r = wi.ordneEin({ text: 'Termin gern, aber danach keine Werbung mehr.', ki_an: true, ki: kiOk(TERMIN) });
  assert.equal(r.gesperrt, true);
  assert.equal(r.grund, 'Wortliste');
});

test('Einordnung: KI-Klasse widerspruch sperrt (W06)', () => {
  const r = wi.ordneEin({ text: 'Lassen Sie mich in Ruhe.', ki_an: true,
    ki: kiOk({ kategorie: 'widerspruch', sicher: true, widerspruch_moeglich: true }) });
  assert.deepEqual(r, { gesperrt: true, grund: 'Antwort', klasse: 'widerspruch', ki_noetig: false });
});

test('Teil A 27.09.: unsicher nur zwischen termin/rueckfrage/kein_interesse → zurückgestellt, keine Sperre (W08 Kontrolle)', () => {
  for (const k of ['termin', 'rueckfrage', 'kein_interesse']) {
    const r = wi.ordneEin({ text: 'Nächstes Jahr gern wieder.', ki_an: true, ki: kiOk({ kategorie: k, sicher: false, widerspruch_moeglich: false }) });
    assert.deepEqual(r, { gesperrt: false, grund: '', klasse: 'unklar', ki_klasse: k, ki_noetig: false }, k);
  }
  assert.match(wi.aufgabe('unklar'), /bitte lesen/);
  assert.match(wi.aufgabe('unklar'), /„Antwort erledigt“ = ja/);
});

test('Teil A 27.09.: im Zweifel am Widerspruch sperren — Widerspruch möglich, sicher oder nicht (W08)', () => {
  for (const sicher of [true, false]) {
    const r = wi.ordneEin({ text: 'Ich will von Ihnen nichts mehr hören.', ki_an: true,
      ki: kiOk({ kategorie: 'kein_interesse', sicher, widerspruch_moeglich: true }) });
    assert.deepEqual([r.gesperrt, r.grund, r.klasse], [true, 'Zweifel', 'kein_interesse'], String(sicher));
  }
  const unsicherWiderspruch = wi.ordneEin({ text: 'Lassen Sie das.', ki_an: true,
    ki: kiOk({ kategorie: 'widerspruch', sicher: false, widerspruch_moeglich: false }) });
  assert.deepEqual([unsicherWiderspruch.gesperrt, unsicherWiderspruch.grund], [true, 'Antwort']);
});

test('Teil A 27.09.: Entscheidung für jede Kombination der drei Schemafelder (16 Fälle)', () => {
  for (const kategorie of ['termin', 'rueckfrage', 'kein_interesse', 'widerspruch']) {
    for (const sicher of [true, false]) {
      for (const moeglich of [true, false]) {
        const r = wi.ordneEin({ text: 'Text.', ki_an: true, ki: kiOk({ kategorie, sicher, widerspruch_moeglich: moeglich }) });
        const soll = kategorie === 'widerspruch' ? [true, 'Antwort', 'widerspruch']
          : moeglich ? [true, 'Zweifel', kategorie] : !sicher ? [false, '', 'unklar'] : [false, '', kategorie];
        assert.deepEqual([r.gesperrt, r.grund, r.klasse], soll, kategorie + ' ' + sicher + ' ' + moeglich);
      }
    }
  }
});

test('Einordnung: ohne gültige KI-Antwort sperren (W10), mit Aufgabe', () => {
  const r = wi.ordneEin({ text: 'Termin bitte.', ki_an: true, ki: { statusCode: 401, body: {} } });
  assert.equal(r.gesperrt, true);
  assert.equal(r.grund, 'Zweifel');
  assert.equal(r.klasse, 'nicht eingeordnet');
  assert.equal(r.ki_fehler, true);
});

test('Einordnung: sichere Klassen ohne Verdacht sperren nicht (Kontrolle zu W06-W10)', () => {
  for (const k of ['termin', 'rueckfrage', 'kein_interesse']) {
    const r = wi.ordneEin({ text: 'Text.', ki_an: true, ki: kiOk({ kategorie: k, sicher: true, widerspruch_moeglich: false }) });
    assert.deepEqual(r, { gesperrt: false, grund: '', klasse: k, ki_noetig: false }, k);
  }
});

test('Einordnung: KI-Einordnung aus → Aufgabe „bitte lesen“, keine Sperre ohne Wortlistentreffer', () => {
  const r = wi.ordneEin({ text: 'Termin bitte.', ki_an: false, ki: null });
  assert.deepEqual(r, { gesperrt: false, grund: '', klasse: 'bitte lesen', ki_noetig: false });
});

test('Aufgabentexte je Klasse, Widerspruch ohne Handlungsbedarf außer Bestätigung (E7)', () => {
  assert.match(wi.aufgabe('termin'), /Termin/);
  assert.match(wi.aufgabe('rueckfrage'), /beantworten/);
  assert.match(wi.aufgabe('kein_interesse'), /Kenntnis/);
  assert.match(wi.aufgabe('widerspruch'), /bestätigen/);
  assert.match(wi.aufgabe('nicht eingeordnet'), /lesen/);
});
