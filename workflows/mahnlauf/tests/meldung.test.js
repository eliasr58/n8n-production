'use strict';
// Meldungen an den Betrieb (Baustein 8): Empfänger nach Modus, Sammelmeldung, Alarm aus dem
// Fehler-Trigger. Alle Adressen erfunden (@example.invalid), BAUPLAN j.
const test = require('node:test');
const assert = require('node:assert/strict');
const me = require('../kern/meldung.js');

const EINST = [['Schlüssel', 'Wert'], ['Modus', 'test'], ['Testempfänger', ' test@example.invalid '],
  ['Absenderadresse', 'absender@example.invalid'], ['Antwort an', ''], ['Meldeadresse Betrieb', 'betrieb@example.invalid'],
  ['Firmenname', 'Tischlerei Beispiel GmbH']];

test('Adressen: nur die vier Adresszellen, getrimmt, nichts sonst', () => {
  assert.deepEqual(me.leseAdressen(EINST), { testempfaenger: 'test@example.invalid', absenderadresse: 'absender@example.invalid',
    antwort_an: '', meldeadresse: 'betrieb@example.invalid' });
});

// Entscheidung Elias 25.09.2026 (Baustein 10, Teil A 1): Sammelmeldungen und Alarme gehen in JEDEM Modus an die
// Meldeadresse; nur Kundenmails werden im Modus test umgelenkt. Teil A 3: Meldeadresse ungültig → Alarm an die Absenderadresse.
test('Meldeempfänger (B10 A 1): jeder Modus → Meldeadresse, nie der Testempfänger', () => {
  const a = me.leseAdressen(EINST);
  ['test', 'trocken', 'scharf', '', 'Test '].forEach((m) => {
    assert.deepEqual(me.waehleMeldeempfaenger(a), { senden: true, an: 'betrieb@example.invalid', grund: 'Meldeadresse' }, m);
  });
});

test('Meldeempfänger (B10 A 1): Meldeadresse fehlt oder ungültig → keine Sammelmeldung (der Hauptlauf wirft, der Fänger meldet)', () => {
  const a = me.leseAdressen(EINST);
  assert.deepEqual(me.waehleMeldeempfaenger(Object.assign({}, a, { meldeadresse: '' })),
    { senden: false, an: null, grund: 'Meldeadresse fehlt oder ungültig' });
  assert.equal(me.waehleMeldeempfaenger(Object.assign({}, a, { meldeadresse: 'kaputt' })).senden, false);
});

test('Alarmempfänger (B10 A 1): jeder Modus → Meldeadresse', () => {
  const a = me.leseAdressen(EINST);
  assert.deepEqual(me.waehleAlarmempfaenger(a), { senden: true, an: 'betrieb@example.invalid', grund: '' });
});

test('Alarmempfänger (B10 A 3): Meldeadresse ungültig → Absenderadresse; beide ungültig → nicht zustellbar', () => {
  const a = me.leseAdressen(EINST);
  assert.deepEqual(me.waehleAlarmempfaenger(Object.assign({}, a, { meldeadresse: 'kaputt' })),
    { senden: true, an: 'absender@example.invalid', grund: 'Meldeadresse fehlt oder ungültig – Alarm an die Absenderadresse' });
  assert.equal(me.waehleAlarmempfaenger(Object.assign({}, a, { meldeadresse: '' })).an, 'absender@example.invalid');
  assert.deepEqual(me.waehleAlarmempfaenger(Object.assign({}, a, { meldeadresse: '', absenderadresse: 'x' })),
    { senden: false, an: null, grund: 'Meldeadresse und Absenderadresse fehlen oder ungültig' });
});

test('Sammelmeldung (Teil A 3): auch bei 0 Vorgängen, dann genau eine Zeile – das einzige Lebenszeichen', () => {
  const s = me.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-24', lauf_id: '1', alarme: [], versand: [], meldungen: [] });
  assert.equal(s.senden, true);
  assert.equal(s.alarm, false);
  assert.equal(s.betreff, 'Mahnlauf F – 24.09.2026 – Lauf 1 (Modus test)');
  assert.equal(s.text, 'Mahnlauf F, Lauf 1, Stichtag 24.09.2026, Modus test: keine Vorgänge, keine Hinweise.');
});

test('Sammelmeldung Modus trocken (Teil A 1): Präfix im Betreff, nennt was versendet worden wäre', () => {
  const s = me.baueSammelmeldung({ firma: 'Tischlerei Beispiel GmbH', modus: 'trocken', stichtag: '2026-09-24', lauf_id: '5801', alarme: [], versand: [],
    geplant: [{ rechnungsnr: 'RE-2026-9002', stufe: 1, aktion: 'senden' }, { rechnungsnr: 'RE-2026-9013', stufe: 2, aktion: 'entwurf_anlegen' }],
    meldungen: [] });
  assert.equal(s.senden, true);
  assert.equal(s.betreff, '[TROCKEN – nichts versendet] Mahnlauf Tischlerei Beispiel GmbH – 24.09.2026 – Lauf 5801');
  assert.match(s.text, /\nHätte versendet \(Modus trocken, nichts versendet\)\n- RE-2026-9002 · Stufe 1 · Zahlungserinnerung senden\n- RE-2026-9013 · Stufe 2 · 1\. Mahnung als Entwurf anlegen/);
  const a = me.baueSammelmeldung({ firma: 'F', modus: 'trocken', stichtag: '2026-09-24', lauf_id: '2', alarme: [{ art: 'Mengenbremse', text: '25' }],
    versand: [], geplant: [], meldungen: [] });
  assert.equal(a.betreff, '[TROCKEN – nichts versendet] ALARM – Mahnlauf F – 24.09.2026 – Lauf 2');
  const leer = me.baueSammelmeldung({ firma: 'F', modus: 'trocken', stichtag: '2026-09-24', lauf_id: '3', alarme: [], versand: [], geplant: [], meldungen: [] });
  assert.equal(leer.betreff, '[TROCKEN – nichts versendet] Mahnlauf F – 24.09.2026 – Lauf 3');
  assert.equal(leer.text, 'Mahnlauf F, Lauf 3, Stichtag 24.09.2026, Modus trocken: keine Vorgänge, keine Hinweise.');
  const test = me.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-24', lauf_id: '4', alarme: [], versand: [],
    geplant: [{ rechnungsnr: 'RE-2026-9002', stufe: 1, aktion: 'senden' }], meldungen: [] });
  assert.equal(test.text.indexOf('Hätte versendet'), -1);
});

test('Sammelmeldung: Alarm steht im Betreff, Klärfall mit Kandidaten und Betrag im Text', () => {
  const s = me.baueSammelmeldung({ firma: 'Tischlerei Beispiel GmbH', modus: 'test', stichtag: '2026-09-24', lauf_id: '5800',
    alarme: [{ art: 'Kontoauszug zu alt', text: 'Kontoauszug 5 Tage alt, erlaubt 3' }],
    versand: [{ rechnungsnr: 'RE-2026-9009', stufe: 1, ergebnis: 'versendet', grund: 'Zahlungserinnerung fällig' }],
    meldungen: [{ art: 'Klärfall', schluessel: 'REF:X', betrag_cent: 32000, grund: 'keine Rechnungsnr.', kandidaten: ['RE-2026-9005'] },
      { rechnungsnr: 'RE-2026-9023', text: 'E-Mail fehlt oder ungültig, keine Mail' }] });
  assert.equal(s.senden, true);
  assert.equal(s.alarm, true);
  assert.equal(s.betreff, 'ALARM – Mahnlauf Tischlerei Beispiel GmbH – 24.09.2026 – Lauf 5800 (Modus test)');
  assert.match(s.text, /Kontoauszug zu alt/);
  assert.match(s.text, /RE-2026-9009 · Stufe 1 · versendet/);
  assert.match(s.text, /Klärfall REF:X über 320,00 € · keine Rechnungsnr\. · Kandidaten RE-2026-9005/);
  assert.match(s.text, /RE-2026-9023 · E-Mail fehlt oder ungültig/);
});

test('Sammelmeldung ohne Alarm: Betreff ohne ALARM', () => {
  const s = me.baueSammelmeldung({ firma: 'F', modus: 'scharf', stichtag: '2026-09-24', lauf_id: '7', alarme: [],
    versand: [{ rechnungsnr: 'RE-1', stufe: 2, ergebnis: 'entwurf_angelegt', grund: '' }], meldungen: [] });
  assert.equal(s.alarm, false);
  assert.equal(s.betreff, 'Mahnlauf F – 24.09.2026 – Lauf 7');
});

test('Alarm aus dem Fehler-Trigger: Meldung mit Dateiname wörtlich im Text, Workflow im Betreff', () => {
  const j = { execution: { id: '5640', mode: 'trigger', lastNodeExecuted: 'Dateien lesen',
    error: { message: 'Kontoauszug unlesbar – Datei camt-kaputt.xml – Zeile 22 – schließendes Tag </Betrag> passt nicht zu <Amt> [line 847]' } },
    workflow: { id: 'abc', name: 'ZZ Mahnlauf Zahlstand lesen' } };
  const f = me.leseFehler(j);
  assert.equal(f.meldung.indexOf('camt-kaputt.xml') > 0, true);
  const a = me.baueAlarm(f, 'Tischlerei Beispiel GmbH', '2026-09-25T10:00:00.000Z');
  assert.equal(a.betreff, 'ALARM – Mahnlauf Tischlerei Beispiel GmbH – Lauf abgebrochen – ZZ Mahnlauf Zahlstand lesen – Datei camt-kaputt.xml');
  assert.match(a.text, /\nDatei: camt-kaputt\.xml\n/);
  assert.match(a.text, /Kontoauszug unlesbar – Datei camt-kaputt\.xml – Zeile 22/);
  assert.match(a.text, /Lauf 5640 · Modus trigger · letzter Knoten „Dateien lesen“/);
});

test('Alarm aus dem Fehler-Trigger: Fehler im Trigger selbst (kein execution.error) wird gelesen', () => {
  const f = me.leseFehler({ trigger: { mode: 'trigger', error: { message: 'Trigger kaputt' } }, workflow: { id: 'x', name: 'W' } });
  assert.equal(f.meldung, 'Trigger kaputt');
  assert.equal(f.modus, 'trigger');
});

test('Alarm aus einem Inline-Unterlauf: kein Workflow-Name im Fehler-Trigger → Betreff nennt die Workflow-ID (gemessen Lauf 5865)', () => {
  const f = me.leseFehler({ execution: { id: '5864', mode: 'integrated', lastNodeExecuted: 'Wirft', error: { message: 'x' } },
    workflow: { id: '31AtEq3nhG7tkaba', name: '' } });
  assert.equal(me.baueAlarm(f, 'F', 'z').betreff, 'ALARM – Mahnlauf F – Lauf abgebrochen – Workflow 31AtEq3nhG7tkaba');
});

test('Absender der Meldungen (Teil B 2): Anzeigename „Mahnlauf · <Firmenname>“, Anführungszeichen maskiert', () => {
  assert.equal(me.meldeAbsender('Tischlerei Beispiel GmbH', 'absender@example.invalid'), '"Mahnlauf · Tischlerei Beispiel GmbH" <absender@example.invalid>');
  assert.equal(me.meldeAbsender('A "B" \\ C', 'a@example.invalid'), '"Mahnlauf · A \\"B\\" \\\\ C" <a@example.invalid>');
  assert.equal(me.meldeAbsender('', 'a@example.invalid'), '"Mahnlauf" <a@example.invalid>');
});

// Teil B 3: genau ein Alarm je Fehler. Gemessen (Läufe 5914 → 5915, 5912 → 5916): der Fehler des Aufrufers trägt
// executionId und workflowId des gescheiterten Unterlaufs; der Unterlauf hat seinen Alarm schon selbst ausgelöst.
const MELD = 'Kontoauszug unlesbar – Datei camt-kaputt.xml – Zeile 22 – schließendes Tag </Betrag> passt nicht zu <Amt> [line 847]';
const P5915 = { execution: { id: '5914', mode: 'integrated', lastNodeExecuted: 'Dateien lesen', error: { message: MELD, lineNumber: 847 } },
  workflow: { id: '9ojM0tWbeunDIZpd', name: 'ZZ Mahnlauf Zahlstand lesen' } };
const P5916 = { execution: { id: '5912', mode: 'integrated', lastNodeExecuted: 'Zahlstand lesen',
  error: { message: MELD, executionId: '5914', workflowId: '9ojM0tWbeunDIZpd' } }, workflow: { id: 'WOz8J2D4rXoDYWkK', name: 'ZZ Mahnlauf Hauptlauf' } };

test('Teil B 3: Fehler des Aufrufers, der aus einem Unterlauf stammt → kein zweiter Alarm; der Unterlauf selbst → Alarm', () => {
  assert.deepEqual(me.alarmNoetig(me.leseFehler(P5916)), { noetig: false, grund: 'Fehler aus Unterlauf 5914 (Workflow 9ojM0tWbeunDIZpd) – dort gemeldet' });
  assert.deepEqual(me.alarmNoetig(me.leseFehler(P5915)), { noetig: true, grund: '' });
  const eigen = JSON.parse(JSON.stringify(P5916));
  eigen.execution.error.executionId = '5912';
  assert.equal(me.alarmNoetig(me.leseFehler(eigen)).noetig, true);
  const ohne = JSON.parse(JSON.stringify(P5916));
  delete ohne.execution.error.executionId;
  assert.equal(me.alarmNoetig(me.leseFehler(ohne)).noetig, true);
});

test('Teil B 3: Dateiname aus der Meldung, auch mit Leerzeichen; ohne Datei kein Dateiteil im Betreff', () => {
  assert.equal(me.leseFehler(P5915).datei, 'camt-kaputt.xml');
  const l = me.leseFehler({ execution: { id: '1', error: { message: 'Kontoauszug unlesbar – Datei auszug-2026-09-23 Kopie.csv – Zeile 3 – x' } }, workflow: { id: 'w', name: 'W' } });
  assert.equal(l.datei, 'auszug-2026-09-23 Kopie.csv');
  const o = me.leseFehler({ execution: { id: '1', error: { message: 'Versand - Tabelle nicht lesbar, HTTP 500' } }, workflow: { id: 'w', name: 'W' } });
  assert.equal(o.datei, '');
  assert.equal(me.baueAlarm(o, 'F', 'z').betreff, 'ALARM – Mahnlauf F – Lauf abgebrochen – W');
});

test('Teil B 3: Inline-Unterlauf mit Namen im Workflow-JSON → Name im Betreff', () => {
  const f = me.leseFehler({ execution: { id: '5864', mode: 'integrated', lastNodeExecuted: 'Wirft', error: { message: 'x' } },
    workflow: { id: '31AtEq3nhG7tkaba', name: 'ZZ Mahnlauf Inline-Test wirft' } });
  assert.equal(me.alarmNoetig(f).noetig, true);
  assert.equal(me.baueAlarm(f, 'F', 'z').betreff, 'ALARM – Mahnlauf F – Lauf abgebrochen – ZZ Mahnlauf Inline-Test wirft');
});
