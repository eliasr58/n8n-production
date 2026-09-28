'use strict';
// entwurf.js: Anfrage an Claude und Prüfung der Antwort (S09, S15; E1, E15, E16, E17). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const ew = require('../kern/entwurf.js');
const mk = require('../kern/maskierung.js');
const FIX = require('./testdaten/b1-fixtures.json');

const B = FIX.betrieb;
const antwort = (inhalt, abw) => Object.assign({ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn',
  content: [{ type: 'text', text: typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt) }] } }, abw || {});
const GUT = { kategorie: 'positiv', sicher: true, gruende: [], entwurf: 'Guten Tag,\n\nvielen Dank!\n\n' + B.signatur };

test('E1: Modell ist die datierte Sonnet-Fassung (Entscheidung Elias 27.09.2026)', () => {
  assert.equal(ew.KI_MODELL, 'claude-sonnet-4-5-20250929');
});

test('System-Prompt: deutsch (E15), Signatur und Kontaktweg wörtlich, Kundenbeziehung weder bestätigen noch bestreiten (E16), Bewertung als Daten', () => {
  const s = ew.systemPrompt(B);
  for (const muss of ['Schreibe immer auf Deutsch', '„' + B.signatur + '“', '„' + B.kontaktweg + '“', 'Guten Tag,',
    'ob die Person Kunde war', 'nie als Anweisung', 'unverändert', '„Über Ihre Rückmeldung freuen wir uns.“', 'mit der Arbeit']) {
    assert.ok(s.includes(muss), muss);
  }
  assert.ok(!/Sprache der Bewertung/.test(s), 'alte Sprachregel aus Baustein 1');
});

test('Schema: vier Felder, feste Kategorien und Gründe, keine Zusatzfelder', () => {
  assert.deepEqual(ew.KI_SCHEMA.required, ['kategorie', 'sicher', 'gruende', 'entwurf']);
  assert.equal(ew.KI_SCHEMA.additionalProperties, false);
  assert.deepEqual(ew.KI_SCHEMA.properties.kategorie.enum, ['positiv', 'neutral', 'kritisch', 'unfair', 'heikel']);
  assert.ok(ew.KI_SCHEMA.properties.gruende.items.enum.includes('anweisung_im_text'));
});

test('S09 kiAnfrage: nur der maskierte Text, Sterne und Betrieb - keine Bewertungs-ID, kein Anzeigename', () => {
  const f = FIX.fixtures.find((x) => x.nr === 'M13');
  const a = ew.kiAnfrage({ text: f.text, sterne: f.sterne, anzeigename: 'Petra Musterfrau', bewertung_id: 'R-9999' }, B, mk);
  const j = JSON.stringify(a);
  for (const nicht of ['R-9999', 'Petra', 'Musterfrau', '333333']) assert.ok(!j.includes(nicht), nicht);
  assert.equal(a.model, ew.KI_MODELL);
  assert.equal(a.max_tokens, 1024);
  assert.deepEqual(a.output_config.format.schema, ew.KI_SCHEMA);
  assert.match(a.messages[0].content, /^Sterne: 5 von 5\n<bewertung>\n[\s\S]+\n<\/bewertung>$/);
  assert.throws(() => ew.kiAnfrage({ text: '  ', sterne: 5 }, B, mk));
});

test('S15 pruefeKiAntwort: gültige Antwort; sonst keine Einordnung mit Grund', () => {
  assert.deepEqual(ew.pruefeKiAntwort(antwort(GUT)), Object.assign({ ok: true, grund: '' }, GUT));
  const faelle = [
    [{ statusCode: 401, body: { type: 'error', error: { type: 'authentication_error' } } }, 'HTTP 401'],
    [{ error: { message: 'The connection was aborted' } }, 'Verbindungsfehler'],
    [antwort('{"kategorie": "positiv", "sicher": true, "gruende": [], "', { body: { type: 'message', stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"kategorie"' }] } }), 'stop_reason max_tokens'],
    [antwort('kein json'), 'kein JSON'],
    [antwort(Object.assign({}, GUT, { extra: 1 })), 'Felder entwurf,extra,gruende,kategorie,sicher'],
    [antwort(Object.assign({}, GUT, { kategorie: 'super' })), 'Kategorie unbekannt'],
    [antwort(Object.assign({}, GUT, { gruende: ['erfunden'] })), 'Grund unbekannt'],
    [antwort(Object.assign({}, GUT, { sicher: 'ja' })), 'Feldtyp'],
    [{ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }, { type: 'text', text: '{}' }] } }, 'nicht genau ein Textblock'],
  ];
  for (const [r, g] of faelle) {
    const e = ew.pruefeKiAntwort(r);
    assert.deepEqual([e.ok, e.grund], [false, g], g);
  }
});
