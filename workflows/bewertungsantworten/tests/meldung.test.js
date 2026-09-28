'use strict';
// meldung.js: Adressen, Sammelmeldung ohne Bewertungstext (S18), Alarm (f, S19). Alle Adressen erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const me = require('../kern/meldung.js');

const BLATT = [['Schlüssel', 'Wert'], ['Meldeadresse', 'meldung@example.invalid'], ['Absenderadresse', 'info@example.invalid'], ['Meldeadresse', 'zweite@example.invalid']];

test('leseAdressenBewertung: erste Zeile je Schlüssel; Alarm an Melde-, sonst Absenderadresse (übernommene Wahl)', () => {
  const a = me.leseAdressenBewertung(BLATT);
  assert.deepEqual(a, { meldeadresse: 'meldung@example.invalid', absenderadresse: 'info@example.invalid' });
  assert.equal(me.waehleAlarmempfaenger(Object.assign({}, a, { meldeadresse: 'kaputt' })).an, 'info@example.invalid');
});

const X = (abw) => Object.assign({ modus: 'test', betrieb: 'Zimmerei & Dachbau Beispiel GmbH', lauf_id: '7000', zeit: '28.09.2026 08:00:05',
  link: 'https://docs.google.com/spreadsheets/d/TAB', eintraege: [
    { zeile: 2, sterne: 5, kategorie: 'positiv', status: 'Entwurf bereit', aufgabe: 'Entwurf lesen und freigeben', hinweise: ['weich: Termin', 'Zitat: GEHEIMER BEWERTUNGSTEXT'],
      text: 'GEHEIMER BEWERTUNGSTEXT', entwurf: 'GEHEIMER ENTWURF', anzeigename: 'Petra Musterfrau' },
    { zeile: 3, sterne: 1, kategorie: 'heikel', status: 'selbst lesen', aufgabe: 'Meldung an Google oder Anwalt prüfen', hinweise: [] }],
  veroeffentlicht: [{ zeile: 4, sterne: 5 }], wartet: [{ zeile: 5, sterne: 4 }], abgelehnt: [{ zeile: 6, sterne: 2, verstoss: 'PERSONAL_INFO' }],
  geloescht: [{ zeile: 7 }], frist_abgelaufen: [{ zeile: 8 }], alarme: [], wuerde: [] }, abw || {});

test('S18 Sammelmeldung: Zeile, Sterne, Kategorie, Status, Aufgabe, Link - nie Bewertungstext, Entwurf oder Name', () => {
  const m = me.baueSammelmeldung(X());
  for (const nicht of ['GEHEIM', 'Petra', 'Musterfrau']) assert.ok(!m.text.includes(nicht) && !m.betreff.includes(nicht), nicht);
  for (const muss of ['Zeile 2', '5 Sterne', 'positiv', 'Entwurf lesen und freigeben', 'weich: Termin', 'Meldung an Google oder Anwalt prüfen',
    'PERSONAL_INFO', 'https://docs.google.com/spreadsheets/d/TAB', 'Frist abgelaufen']) assert.ok(m.text.includes(muss), muss);
  assert.ok(!/ALARM/.test(m.betreff));
});

test('Sammelmeldung: Alarm im Betreff; trocken mit Präfix und „wäre veröffentlicht“; ohne Einträge ein Satz', () => {
  assert.match(me.baueSammelmeldung(X({ alarme: ['KI-Fehler: HTTP 401'] })).betreff, /^ALARM – /);
  const t = me.baueSammelmeldung(X({ modus: 'trocken', wuerde: [{ zeile: 9, sterne: 5 }] }));
  assert.match(t.betreff, /^\[TROCKEN – nichts veröffentlicht\] /);
  assert.ok(t.text.includes('Wäre veröffentlicht worden') && t.text.includes('Zeile 9'));
  const leer = me.baueSammelmeldung(X({ eintraege: [], veroeffentlicht: [], wartet: [], abgelehnt: [], geloescht: [], frist_abgelaufen: [] }));
  assert.ok(leer.text.includes('Keine neuen oder offenen Bewertungen.'));
});

test('baueAlarm: Betreff mit Betrieb und Workflow; Text mit Meldung, Lauf, Knoten, Zeit; ohne Modus im Betreff', () => {
  const f = me.leseFehler({ execution: { id: '7001', mode: 'trigger', lastNodeExecuted: 'Einstellungen prüfen', error: { message: 'Modus test verlangt Quelle test' } },
    workflow: { id: 'HL', name: 'Bewertungsantworten – Hauptlauf' } });
  const a = me.baueAlarm(f, 'Zimmerei & Dachbau Beispiel GmbH', '2026-09-28T06:00:05Z');
  assert.equal(a.betreff, 'ALARM – Bewertungsantworten Zimmerei & Dachbau Beispiel GmbH – Lauf abgebrochen – Bewertungsantworten – Hauptlauf');
  for (const muss of ['Modus test verlangt Quelle test', '7001', 'Einstellungen prüfen', '2026-09-28T06:00:05Z']) assert.ok(a.text.includes(muss), muss);
});

test('meldeAbsender: Anzeigename „Bewertungsantworten · Betrieb“, Anführungszeichen und Zeilenumbrüche entschärft', () => {
  assert.equal(me.meldeAbsender('Zimmerei & Dachbau Beispiel GmbH', 'info@example.invalid'), '"Bewertungsantworten · Zimmerei & Dachbau Beispiel GmbH" <info@example.invalid>');
  assert.equal(me.meldeAbsender('A "B"\nC', 'x@example.invalid'), '"Bewertungsantworten · A \\"B\\" C" <x@example.invalid>');
});

test('Sammelmeldung: Abschnitt „Hinweise“ (vom Code erzeugt, z. B. Entwürfe im nächsten Lauf); leer → kein Abschnitt', () => {
  const m = me.baueSammelmeldung(X({ hinweise: ['22 Entwürfe im nächsten Lauf (Höchstzahl 20)'] }));
  assert.ok(m.text.includes('Hinweise\n- 22 Entwürfe im nächsten Lauf (Höchstzahl 20)'));
  assert.ok(!me.baueSammelmeldung(X()).text.includes('Hinweise\n'));
});

test('Sammelmeldung: „1 Stern“ in der Einzahl, sonst „Sterne“', () => {
  const m = me.baueSammelmeldung(X({ eintraege: [{ zeile: 2, sterne: 1, kategorie: 'kritisch', status: 'Entwurf bereit' }, { zeile: 3, sterne: 4, status: 'Entwurf bereit' }] }));
  assert.ok(m.text.includes('Zeile 2 · 1 Stern · kritisch') && m.text.includes('Zeile 3 · 4 Sterne'), m.text);
});
