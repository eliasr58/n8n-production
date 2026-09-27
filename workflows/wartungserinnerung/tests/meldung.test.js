'use strict';
// meldung.js: Adressen, Alarm-Empfaenger, ein Alarm je Fehler, Alarmtext (BAUPLAN f; Baustein 7). Uebernommene Bloecke aus
// dem Mahnlauf (herkunft.py) werden hier nur an den Wartungs-Nahtstellen geprueft. Alle Adressen erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const me = require('../kern/meldung.js');

const BLATT = [['Schlüssel', 'Wert'], ['Testempfänger', 'test@example.invalid'], ['Absenderadresse', 'info@example.invalid'],
  ['Antwort an', 'antwort@example.invalid'], ['Meldeadresse', 'meldung@example.invalid'], ['Meldeadresse', 'zweite@example.invalid']];

test('leseAdressenWartung: vier Adressen aus dem Wartungs-Einstellungsblatt, erste Zeile je Schlüssel', () => {
  assert.deepEqual(me.leseAdressenWartung(BLATT), { testempfaenger: 'test@example.invalid', absenderadresse: 'info@example.invalid',
    antwort_an: 'antwort@example.invalid', meldeadresse: 'meldung@example.invalid' });
  assert.deepEqual(me.leseAdressenWartung([['Meldeadresse Betrieb', 'x@example.invalid']]).meldeadresse, '');
});

test('Alarm an die Meldeadresse, ungültig → an die Absenderadresse, beide ungültig → nicht senden (übernommen)', () => {
  const a = me.leseAdressenWartung(BLATT);
  assert.deepEqual([me.waehleAlarmempfaenger(a).senden, me.waehleAlarmempfaenger(a).an], [true, 'meldung@example.invalid']);
  const b = Object.assign({}, a, { meldeadresse: 'kaputt' });
  assert.deepEqual([me.waehleAlarmempfaenger(b).an], ['info@example.invalid']);
  assert.equal(me.waehleAlarmempfaenger({ meldeadresse: '', absenderadresse: '' }).senden, false);
  assert.equal(me.waehleMeldeempfaenger(b).senden, false);
});

test('ein Alarm je Fehler: Fehler aus einem Unterlauf schweigt, eigener Fehler meldet (übernommen, Wartungs-Fehlerform)', () => {
  const eigen = me.leseFehler({ execution: { id: '7001', mode: 'trigger', lastNodeExecuted: 'Aufbau prüfen',
    error: { message: 'Tabellenaufbau falsch' } }, workflow: { id: 'HL', name: 'ZZ Wartung Hauptlauf' } });
  assert.equal(me.alarmNoetig(eigen).noetig, true);
  const unter = me.leseFehler({ execution: { id: '7001', mode: 'trigger', error: { message: 'x', executionId: '7002', workflowId: 'VS' } },
    workflow: { id: 'HL', name: 'ZZ Wartung Hauptlauf' } });
  assert.deepEqual([me.alarmNoetig(unter).noetig, /7002/.test(me.alarmNoetig(unter).grund)], [false, true]);
});

test('baueAlarmWartung: Betreff mit Firma und Workflow, ohne Modus; Text mit Meldung, Lauf, Knoten, Zeit', () => {
  const f = { workflow_id: 'HL', workflow_name: 'ZZ Wartung Hauptlauf', lauf_id: '7001', modus: 'trigger', letzter_knoten: 'Aufbau prüfen',
    meldung: 'Tabellenaufbau falsch' };
  const a = me.baueAlarmWartung(f, 'Heizung & Sanitär Beispiel GmbH', '2026-09-27T12:00:00.000Z');
  assert.equal(a.betreff, 'ALARM – Wartungserinnerung Heizung & Sanitär Beispiel GmbH – Lauf abgebrochen – ZZ Wartung Hauptlauf');
  assert.doesNotMatch(a.betreff, /test|trocken|scharf/i);
  assert.match(a.text, /Meldung: Tabellenaufbau falsch/);
  assert.match(a.text, /Lauf 7001 · Modus trigger · letzter Knoten „Aufbau prüfen“/);
  assert.match(a.text, /Zeit \(UTC\): 2026-09-27T12:00:00\.000Z/);
});

test('meldeAbsenderWartung: Anzeigename als quoted-string, Anführungszeichen und Umbruch entschärft', () => {
  assert.equal(me.meldeAbsenderWartung('Heizung & Sanitär Beispiel GmbH', 'info@example.invalid'),
    '"Wartungserinnerung · Heizung & Sanitär Beispiel GmbH" <info@example.invalid>');
  assert.equal(me.meldeAbsenderWartung('A "B"\nC', 'info@example.invalid'), '"Wartungserinnerung · A \\"B\\" C" <info@example.invalid>');
});
