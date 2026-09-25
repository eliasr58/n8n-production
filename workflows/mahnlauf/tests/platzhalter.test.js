'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ph = require('../kern/platzhalter.js');
const { einstellungen, zeile } = require('./hilfen.js');

const FIRMA = { firma: 'Tischlerei Beispiel GmbH', iban: 'DE00 1234 5678 9012 3456 78', signatur: 'Ihre Tischlerei Beispiel' };

function werte(extra) {
  const r = Object.assign(zeile(9003, { rechnungsdatum: '2026-08-01' }), { bezahlt_cent: 40000, rest_cent: 60000 }, extra || {});
  return ph.bauePlatzhalterWerte(r, Object.assign(einstellungen(), FIRMA), '2026-09-24');
}

test('Beträge deutsch aus Cent, ohne Gleitkomma', () => {
  assert.equal(ph.formatiereBetrag(123456), '1.234,56');
  assert.equal(ph.formatiereBetrag(5), '0,05');
  assert.equal(ph.formatiereBetrag(100000), '1.000,00');
  assert.equal(ph.formatiereBetrag(60000), '600,00');
  assert.equal(ph.formatiereBetrag(-5000), '-50,00');
  assert.equal(ph.formatiereBetrag(123456789), '1.234.567,89');
  assert.throws(() => ph.formatiereBetrag(12.5));
});

test('Datum TT.MM.JJJJ', () => {
  assert.equal(ph.formatiereDatum('2026-09-24'), '24.09.2026');
  assert.throws(() => ph.formatiereDatum('24.09.2026'));
});

test('T02 Mailtext nennt den Rest 600,00, nicht 1.000,00 als Rest', () => {
  const r = ph.fuellePlatzhalter('Offener Rest: {rest} (Rechnung {rechnungsnr} über {betrag}, bezahlt {bezahlt})', werte());
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Offener Rest: 600,00 (Rechnung RE-2026-9003 über 1.000,00, bezahlt 400,00)');
  assert.equal(r.text.includes('Rest: 1.000,00'), false);
});

test('T17 unbekannter Platzhalter {frist} → keine Ausgabe, Fehler nennt den Namen', () => {
  const r = ph.fuellePlatzhalter('Bitte zahlen Sie bis {frist}.', werte());
  assert.equal(r.ok, false);
  assert.equal(r.text, undefined);
  assert.deepEqual(r.fehler, [{ platzhalter: 'frist', grund: 'unbekannt' }]);
});

test('T17 Kontrolle: {frist_datum} → Stichtag + 10 Tage', () => {
  const r = ph.fuellePlatzhalter('Bitte zahlen Sie bis {frist_datum}.', werte());
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Bitte zahlen Sie bis 04.10.2026.');
});

test('Leerer Platzhalter → Fehler; Kontrolle gefüllt → ok', () => {
  const leer = ph.fuellePlatzhalter('IBAN {iban}', Object.assign(werte(), { iban: '' }));
  assert.equal(leer.ok, false);
  assert.deepEqual(leer.fehler, [{ platzhalter: 'iban', grund: 'leer' }]);
  assert.equal(ph.fuellePlatzhalter('IBAN {iban}', werte()).ok, true);
});

test('Ungeschlossene Klammer ist ein Fehler, kein Text', () => {
  const r = ph.fuellePlatzhalter('Rest {rest und mehr', werte());
  assert.equal(r.ok, false);
  assert.equal(r.fehler[0].grund, 'ungeschlossen');
});

test('Alle erlaubten Platzhalter aus BAUPLAN b sind belegt', () => {
  assert.deepEqual(ph.PLATZHALTER_ERLAUBT.slice().sort(), ['betrag', 'bezahlt', 'firma', 'frist_datum', 'iban', 'kunde', 'rechnungsdatum', 'rechnungsnr', 'rest', 'signatur'].sort());
  const vorlage = ph.PLATZHALTER_ERLAUBT.map((n) => '{' + n + '}').join('|');
  const r = ph.fuellePlatzhalter(vorlage, werte());
  assert.equal(r.ok, true, JSON.stringify(r.fehler));
  assert.equal(r.text.includes('{'), false);
});

// Baustein 3: jeder Textbaustein der Test-Tabelle (tests/testdaten/tabelle/testbetrieb.json) lässt sich
// füllen - nur erlaubte Platzhalter, keiner bleibt übrig. Kontrolle: {frist} statt {frist_datum} (T17).
test('Textbausteine der Test-Tabelle: alle 6 füllbar; Kontrolle mit {frist} → Fehler', () => {
  const t = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'testdaten',
    'tabelle', 'testbetrieb.json'), 'utf8')).blaetter.find((b) => b.titel === 'Textbausteine').zeilen.slice(1);
  assert.equal(t.length, 6);
  const werte = ph.bauePlatzhalterWerte(
    { kunde: 'Kunde Beispiel 02', rechnungsnr: 'RE-2026-9002', rechnungsdatum: '2026-09-01',
      betrag_brutto_cent: 85000, bezahlt_cent: 0, rest_cent: 85000 },
    { zahlungsfrist: 10, firma: 'Tischlerei Beispiel GmbH', iban: 'DE00 1234 5678 9000 0000 01', signatur: 'Tischlerei Beispiel GmbH' },
    '2026-09-24');
  for (const [stufe, , typ, betreff, text] of t) {
    const b = ph.fuellePlatzhalter(betreff, werte);
    const x = ph.fuellePlatzhalter(text, werte);
    assert.equal(b.ok, true, stufe + typ + JSON.stringify(b.fehler));
    assert.equal(x.ok, true, stufe + typ + JSON.stringify(x.fehler));
    assert.match(b.text, /RE-2026-9002/);
    assert.doesNotMatch(x.text, /[{}]/);
  }
  const k = ph.fuellePlatzhalter(t[0][4].replace('{frist_datum}', '{frist}'), werte);
  assert.equal(k.ok, false);
  assert.deepEqual(k.fehler.map((f) => f.platzhalter), ['frist']);
});

// Teil A 9 (Entscheidung Elias 25.09.2026): jeder Betreff trägt {rechnungsnr}. Die Suche im Gesendet-Ordner
// (Hand-Versand, abgebrochene Reservierung) findet eine Mail nur über ihren Betreff.
const TB_KOPF = ['Stufe', 'Stufenname', 'Kundentyp', 'Betreff', 'Text'];
const TB = () => [TB_KOPF,
  [1, 'Zahlungserinnerung', 'B2B', 'Zahlungserinnerung zur Rechnung {rechnungsnr}', 'x'],
  [1, 'Zahlungserinnerung', 'B2C', 'Zahlungserinnerung zur Rechnung {rechnungsnr}', 'x'],
  [2, '1. Mahnung', 'B2B', '1. Mahnung zur Rechnung {rechnungsnr}', 'x'],
  [3, 'letzte Mahnung', 'B2B', 'Letzte Mahnung zur Rechnung {rechnungsnr}', 'x']];

test('Textbausteine (Teil A 9): jeder Betreff mit {rechnungsnr} → ok; Kontrolle ein Betreff ohne → Fehler mit Stufe und Kundentyp', () => {
  assert.deepEqual(ph.pruefeTextbausteine(TB()), { ok: true, fehler: [] });
  const ohne = TB();
  ohne[3][3] = '1. Mahnung zu unserer Rechnung';
  assert.deepEqual(ph.pruefeTextbausteine(ohne), { ok: false, fehler: ['Stufe 2 B2B: Betreff ohne {rechnungsnr}'] });
  const leer = TB();
  leer[1][3] = '';
  assert.deepEqual(ph.pruefeTextbausteine(leer).fehler, ['Stufe 1 B2B: Betreff ohne {rechnungsnr}']);
});

test('Textbausteine: Leerzeichen in der Klammer zählt wie der Platzhalter; gleicher Betreff in zwei Stufen desselben Kundentyps ist ein Fehler', () => {
  const sp = TB();
  sp[4][3] = 'Letzte Mahnung zur Rechnung { rechnungsnr }';
  assert.equal(ph.pruefeTextbausteine(sp).ok, true);
  const gleich = TB();
  gleich[4][3] = '1. Mahnung zur Rechnung {rechnungsnr}';
  assert.deepEqual(ph.pruefeTextbausteine(gleich).fehler, ['Stufe 2 und 3 B2B: gleicher Betreff']);
  assert.deepEqual(ph.pruefeTextbausteine([['Stufe', 'Text']]).fehler, ['Blatt Textbausteine ohne Spalte Stufe/Kundentyp/Betreff']);
});
