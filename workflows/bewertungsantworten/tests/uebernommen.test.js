'use strict';
// Übernommene Testfälle der Wartungserinnerung (BAUPLAN g, Arbeitsregel 19): laufen ZUERST unverändert grün gegen die
// unverändert übernommenen Blöcke, erst danach wird angepasst. Nur die Modulnamen oben sind hier neu (die Blöcke liegen in
// anderen Dateien); die Testblöcke selbst prüft herkunft.py byte-gleich gegen die Quelle.
const test = require('node:test');
const assert = require('node:assert/strict');
const tb = require('../kern/bausteine.js');
const an = require('../kern/tabelle.js');
const aw = require('../kern/maskierung.js');
const en = require('../kern/zeit.js');
const la = require('../kern/zeit.js');
const me = require('../kern/meldung.js');
const STICHTAG = '2026-09-28';

// Der übernommene Test „übernommen: sperreEntscheid …“ (Wartung versand.test.js 42b4f08) lief hier zuerst unverändert grün
// (Commit 832bc2e); seit der Anpassung von VS_ERLEDIGT steht er angepasst in sperre.test.js.


// Übernommen aus Wartungserinnerung bau/kern/tests/textbausteine.test.js (Commit cf13b76), unverändert: test „übernommen: formatiereDatum (aus Mahnlauf platzhalter.js)“
test('übernommen: formatiereDatum (aus Mahnlauf platzhalter.js)', () => {
  assert.equal(tb.formatiereDatum('2026-09-24'), '24.09.2026');
  assert.throws(() => tb.formatiereDatum('2026-02-30'));
});

// Übernommen aus Wartungserinnerung bau/kern/tests/anlagen.test.js (Commit b79066d), unverändert: test „übernommen: Seriennummer → Datum (aus Mahnlauf offene-posten.js)“
test('übernommen: Seriennummer → Datum (aus Mahnlauf offene-posten.js)', () => {
  assert.equal(an.seriennummerZuDatum(46279), '2026-09-14');
  assert.equal(an.seriennummerZuDatum(0), null);
  assert.equal(an.seriennummerZuDatum('46279'), null);
});

// Übernommen aus Wartungserinnerung bau/kern/tests/antwort.test.js (Commit 391232c), unverändert: test „maskiereKontakt: Telefon, Mail, IBAN, Anschrift, PLZ/Ort; Kontrolle Datum und Uhrzeit bleiben“
test('maskiereKontakt: Telefon, Mail, IBAN, Anschrift, PLZ/Ort; Kontrolle Datum und Uhrzeit bleiben', () => {
  const t = 'Tel. +49 000 0000011, mobil 0000/0000022, Festnetz (0000) 000 033, Fax 0000 000000\n'
    + 'Mail: kunde-01@example.invalid\nIBAN DE00 1234 5678 9012 3456 78\nHauptstraße 12a, 00000 Musterstadt\nMusterweg 1';
  const m = aw.maskiereKontakt(t);
  for (const x of ['0000011', '0000022', '000 033', '0000 000000', 'example.invalid', 'DE00', 'Hauptstraße', 'Musterweg', '00000']) {
    assert.ok(!m.includes(x), x + ' in: ' + m);
  }
  for (const p of ['<TELEFON>', '<EMAIL>', '<IBAN>', '<ANSCHRIFT>', '<PLZ_ORT>']) assert.ok(m.includes(p), p);
  const k = 'Termin am 12.10.2026 um 14:30 Uhr, Anlage von 2018, 3 Heizkörper.';
  assert.equal(aw.maskiereKontakt(k), k);
});

// Übernommen aus Wartungserinnerung bau/kern/tests/entscheidung.test.js (Commit 42b4f08), unverändert: test „übernommene Tagesarithmetik (aus Mahnlauf stufen.test.js)“
test('übernommene Tagesarithmetik (aus Mahnlauf stufen.test.js)', () => {
  assert.equal(en.datumPlusTage('2026-02-27', 2), '2026-03-01');
  assert.equal(en.datumPlusTage('2026-03-01', -1), '2026-02-28');
  assert.equal(en.tageZwischen('2026-09-20', '2026-09-23'), 3);
  assert.equal(en.tageZwischen('2026-10-24', '2026-10-26'), 2);
});

// Übernommen aus Wartungserinnerung bau/kern/tests/entscheidung.test.js (Commit 42b4f08), unverändert: test „übernommen: Stichtag nur in test und trocken“
test('übernommen: Stichtag nur in test und trocken', () => {
  assert.equal(en.bestimmeStichtag('test', '2026-10-01', STICHTAG).stichtag, '2026-10-01');
  assert.equal(en.bestimmeStichtag('scharf', '2026-10-01', STICHTAG).stichtag, STICHTAG);
});

// Übernommen aus Wartungserinnerung bau/kern/tests/lauf.test.js (Commit 7501301), unverändert: test „übernommen: berlinZeit (aus Mahnlauf hauptlauf.js) - Sommer- und Winterzeit“
test('übernommen: berlinZeit (aus Mahnlauf hauptlauf.js) - Sommer- und Winterzeit', () => {
  assert.deepEqual(la.berlinZeit('2026-09-14T22:30:00Z'), { datum: '2026-09-15', text: '15.09.2026 00:30:00' });
  assert.deepEqual(la.berlinZeit('2026-12-01T23:30:00.000Z'), { datum: '2026-12-02', text: '02.12.2026 00:30:00' });
});

// Übernommen aus Wartungserinnerung bau/kern/tests/meldung.test.js (Commit 391232c), unverändert: test „ein Alarm je Fehler: Fehler aus einem Unterlauf schweigt, eigener Fehler meldet (übernommen, Wartungs-Fehlerform)“
test('ein Alarm je Fehler: Fehler aus einem Unterlauf schweigt, eigener Fehler meldet (übernommen, Wartungs-Fehlerform)', () => {
  const eigen = me.leseFehler({ execution: { id: '7001', mode: 'trigger', lastNodeExecuted: 'Aufbau prüfen',
    error: { message: 'Tabellenaufbau falsch' } }, workflow: { id: 'HL', name: 'ZZ Wartung Hauptlauf' } });
  assert.equal(me.alarmNoetig(eigen).noetig, true);
  const unter = me.leseFehler({ execution: { id: '7001', mode: 'trigger', error: { message: 'x', executionId: '7002', workflowId: 'VS' } },
    workflow: { id: 'HL', name: 'ZZ Wartung Hauptlauf' } });
  assert.deepEqual([me.alarmNoetig(unter).noetig, /7002/.test(me.alarmNoetig(unter).grund)], [false, true]);
});
