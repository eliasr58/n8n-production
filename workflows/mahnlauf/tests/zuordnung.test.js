'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zuo = require('../kern/zuordnung.js');
const { MUSTER, zeile, zahlung } = require('./hilfen.js');

function ordne(zeilen, zahlungen, manuell) {
  return zuo.ordneZahlungenZu({ rechnungen: zeilen, zahlungen, manuell: manuell || {}, muster: MUSTER });
}
function rechnung(erg, nr) {
  return erg.rechnungen.find((r) => r.rechnungsnr === 'RE-2026-' + nr);
}
function zahlungErg(erg, schluessel) {
  return erg.zahlungen.find((z) => z.schluessel === schluessel);
}

test('Normalisierung: „RE 2026-014“ = „RE2026014“, beide Seiten', () => {
  assert.equal(zuo.normalisiereNummer('RE 2026-014'), 'RE2026014');
  assert.equal(zuo.normalisiereNummer('RE2026014'), 'RE2026014');
  assert.equal(zuo.normalisiereNummer('re-2026/9001.'), 'RE20269001');
});

test('Rechnungsnummern im Text: mit Trennern, mehrere, Ziffern danach kleben nicht an', () => {
  assert.deepEqual(zuo.findeRechnungsnummern('Zahlung RE 2026-9001 und RE-2026-9002 300,00', MUSTER), ['RE20269001', 'RE20269002']);
  assert.deepEqual(zuo.findeRechnungsnummern('re-2026-9001 12,50 EUR', MUSTER), ['RE20269001']);
  assert.deepEqual(zuo.findeRechnungsnummern('RE2026-9003/RE-2026-9003', MUSTER), ['RE20269003']);
  assert.deepEqual(zuo.findeRechnungsnummern('Danke für die Arbeit', MUSTER), []);
});

test('T01 (Zuordnung) volle Zahlung mit Nummer → bezahlt; Kontrolle ohne Zahlung → offen', () => {
  const zeilen = [zeile(9001), zeile(9002, { betrag_brutto_cent: 50000 })];
  const e = ordne(zeilen, [zahlung('Z1', 100000, 'RE-2026-9001')]);
  assert.equal(zahlungErg(e, 'Z1').zuordnung, 'automatisch');
  assert.equal(rechnung(e, 9001).status, 'bezahlt');
  assert.equal(rechnung(e, 9001).rest_cent, 0);
  assert.equal(rechnung(e, 9002).status, 'offen');
  assert.equal(rechnung(e, 9002).rest_cent, 50000);
});

test('T02 Teilzahlung: 400,00 auf 1.000,00 → bezahlt 400,00, Rest 600,00, offen', () => {
  const e = ordne([zeile(9003, { betrag_brutto_cent: 100000 })], [zahlung('Z1', 40000, 'RE-2026-9003')]);
  const r = rechnung(e, 9003);
  assert.equal(zahlungErg(e, 'Z1').zuordnung, 'automatisch');
  assert.equal(r.bezahlt_cent, 40000);
  assert.equal(r.rest_cent, 60000);
  assert.equal(r.status, 'offen');
});

test('T02 Kontrolle: volle Zahlung → bezahlt, Rest 0', () => {
  const r = rechnung(ordne([zeile(9003)], [zahlung('Z1', 100000, 'RE-2026-9003')]), 9003);
  assert.equal(r.status, 'bezahlt');
  assert.equal(r.rest_cent, 0);
});

test('T03 Überzahlung: 550,00 auf 500,00 → überzahlt, 50,00 gemeldet, nichts auf andere Rechnung', () => {
  const zeilen = [zeile(9004, { betrag_brutto_cent: 50000 }), zeile(9099, { betrag_brutto_cent: 70000 })];
  const e = ordne(zeilen, [zahlung('Z1', 55000, 'RE-2026-9004')]);
  assert.equal(rechnung(e, 9004).status, 'überzahlt');
  assert.equal(rechnung(e, 9004).ueberschuss_cent, 5000);
  assert.equal(rechnung(e, 9099).bezahlt_cent, 0);
  const m = e.meldungen.filter((x) => x.art === 'Überzahlung');
  assert.equal(m.length, 1);
  assert.equal(m[0].rechnungsnr, 'RE-2026-9004');
  assert.equal(m[0].ueberschuss_cent, 5000);
});

test('T03 Kontrolle: genau 500,00 → bezahlt, keine Überzahlungsmeldung', () => {
  const e = ordne([zeile(9004, { betrag_brutto_cent: 50000 })], [zahlung('Z1', 50000, 'RE-2026-9004')]);
  assert.equal(rechnung(e, 9004).status, 'bezahlt');
  assert.equal(e.meldungen.filter((x) => x.art === 'Überzahlung').length, 0);
});

test('T04 Zahlung ohne Nummer → Klärfall mit Kandidat, nicht verbucht, Kandidat angehalten', () => {
  const zeilen = [zeile(9005, { betrag_brutto_cent: 30000 })];
  const e = ordne(zeilen, [zahlung('Z1', 30000, 'Danke für die Arbeit', { auftraggeber: 'Kunde Beispiel' })]);
  const z = zahlungErg(e, 'Z1');
  assert.equal(z.zuordnung, 'ungeklärt');
  assert.deepEqual(z.kandidaten, ['RE-2026-9005']);
  assert.equal(rechnung(e, 9005).bezahlt_cent, 0);
  assert.equal(rechnung(e, 9005).klaerfall_halt, true);
  assert.equal(e.meldungen.filter((x) => x.art === 'Klärfall').length, 1);
});

test('T04 Kontrolle: manuelle Zuordnung „RE-2026-9005“ → verbucht als manuell, kein Halt', () => {
  const zeilen = [zeile(9005, { betrag_brutto_cent: 30000 })];
  const e = ordne(zeilen, [zahlung('Z1', 30000, 'Danke für die Arbeit', { auftraggeber: 'Kunde Beispiel' })], { Z1: 'RE-2026-9005' });
  assert.equal(zahlungErg(e, 'Z1').zuordnung, 'manuell');
  assert.equal(rechnung(e, 9005).status, 'bezahlt');
  assert.equal(rechnung(e, 9005).klaerfall_halt, false);
});

test('T05 a) zwei Rechnungen gleicher Betrag, Zahlung nennt RE-2026-9007 → nur 9007 bezahlt', () => {
  const zeilen = [zeile(9006, { betrag_brutto_cent: 25000 }), zeile(9007, { betrag_brutto_cent: 25000 })];
  const e = ordne(zeilen, [zahlung('Z1', 25000, 'RE-2026-9007')]);
  assert.equal(rechnung(e, 9007).status, 'bezahlt');
  assert.equal(rechnung(e, 9006).status, 'offen');
  assert.equal(rechnung(e, 9006).klaerfall_halt, false);
});

test('T05 b) gleicher Betrag ohne Nummer → Klärfall mit beiden Kandidaten, beide angehalten', () => {
  const zeilen = [zeile(9006, { betrag_brutto_cent: 25000 }), zeile(9007, { betrag_brutto_cent: 25000 })];
  const e = ordne(zeilen, [zahlung('Z1', 25000, 'Überweisung', { auftraggeber: 'Jemand Test' })]);
  assert.deepEqual(zahlungErg(e, 'Z1').kandidaten, ['RE-2026-9006', 'RE-2026-9007']);
  assert.equal(rechnung(e, 9006).klaerfall_halt, true);
  assert.equal(rechnung(e, 9007).klaerfall_halt, true);
  assert.equal(rechnung(e, 9006).bezahlt_cent + rechnung(e, 9007).bezahlt_cent, 0);
});

test('Unbekannte Rechnungsnr. → Klärfall; Kontrolle bekannte Nr. → automatisch', () => {
  const zeilen = [zeile(9006, { betrag_brutto_cent: 25000 })];
  const e = ordne(zeilen, [zahlung('Z1', 25000, 'RE-2026-9999'), zahlung('Z2', 25000, 'RE-2026-9006', { buchungsdatum: '2026-09-23' })]);
  assert.equal(zahlungErg(e, 'Z1').zuordnung, 'ungeklärt');
  assert.match(zahlungErg(e, 'Z1').grund, /unbekannt/);
  assert.equal(zahlungErg(e, 'Z2').zuordnung, 'automatisch');
});

test('Mehrere Nummern: Betrag = Summe der Reste auf den Cent → beide voll; Kontrolle 1 Cent weniger → Klärfall', () => {
  const zeilen = [zeile(9006, { betrag_brutto_cent: 25000 }), zeile(9007, { betrag_brutto_cent: 25000 })];
  const a = ordne(zeilen, [zahlung('Z1', 50000, 'RE-2026-9006 RE-2026-9007')]);
  assert.equal(zahlungErg(a, 'Z1').zuordnung, 'automatisch');
  assert.equal(rechnung(a, 9006).status, 'bezahlt');
  assert.equal(rechnung(a, 9007).status, 'bezahlt');
  const b = ordne(zeilen, [zahlung('Z1', 49999, 'RE-2026-9006 RE-2026-9007')]);
  assert.equal(zahlungErg(b, 'Z1').zuordnung, 'ungeklärt');
  assert.match(zahlungErg(b, 'Z1').grund, /Betrag passt nicht/);
  assert.equal(rechnung(b, 9006).bezahlt_cent, 0);
  assert.equal(rechnung(b, 9006).klaerfall_halt, true);
  assert.equal(rechnung(b, 9007).klaerfall_halt, true);
});

test('Schon bezahlte Rechnung → zweite Zahlung ist Klärfall, bezahlt bleibt 250,00', () => {
  const zeilen = [zeile(9006, { betrag_brutto_cent: 25000 })];
  const e = ordne(zeilen, [
    zahlung('Z1', 25000, 'RE-2026-9006', { buchungsdatum: '2026-09-20' }),
    zahlung('Z2', 25000, 'RE-2026-9006', { buchungsdatum: '2026-09-21' }),
  ]);
  assert.equal(zahlungErg(e, 'Z2').zuordnung, 'ungeklärt');
  assert.match(zahlungErg(e, 'Z2').grund, /schon bezahlt/);
  assert.equal(rechnung(e, 9006).bezahlt_cent, 25000);
});

test('Gesperrte Rechnung in der Zahlung → Klärfall; Kontrolle ohne Sperre → automatisch', () => {
  const a = ordne([zeile(9008, { mahnsperre: 'ja', mahnsperre_grund: 'Reklamation' })], [zahlung('Z1', 100000, 'RE-2026-9008')]);
  assert.equal(zahlungErg(a, 'Z1').zuordnung, 'ungeklärt');
  assert.match(zahlungErg(a, 'Z1').grund, /gesperrt/);
  const b = ordne([zeile(9008)], [zahlung('Z1', 100000, 'RE-2026-9008')]);
  assert.equal(zahlungErg(b, 'Z1').zuordnung, 'automatisch');
});

test('bezahlt wird neu summiert, nie hochgezählt: zweimal gerechnet gleich, doppelter Schlüssel zählt einmal', () => {
  const zeilen = [zeile(9003)];
  const zahlungen = [zahlung('Z1', 40000, 'RE-2026-9003'), zahlung('Z1', 40000, 'RE-2026-9003')];
  const a = ordne(zeilen, zahlungen);
  const b = ordne(zeilen, zahlungen);
  assert.equal(rechnung(a, 9003).bezahlt_cent, 40000);
  assert.equal(rechnung(b, 9003).bezahlt_cent, 40000);
  assert.equal(a.meldungen.filter((m) => m.art === 'doppelter Buchungsschlüssel').length, 1);
});

test('Dublette Rechnungsnr. → beide Zeilen gesperrt und gemeldet; Kontrolle eindeutige Nummern', () => {
  const e = ordne([zeile(9010), zeile(9010)], []);
  assert.equal(e.rechnungen.filter((r) => r.dublette === true).length, 2);
  assert.equal(e.meldungen.filter((m) => m.art === 'Dublette').length, 1);
  const k = ordne([zeile(9010), zeile(9011)], []);
  assert.equal(k.rechnungen.filter((r) => r.dublette === true).length, 0);
});

// ---- Teil A, 25.09.2026: Klärfälle aus dem Auszug (Storno, Fremdwährung, Bankreferenz
// doppelt, Summe TxDtls) laufen durch die Zuordnung, werden aber nie automatisch verbucht. ----

test('Klärfall aus dem Auszug nennt RE-2026-9001 → ungeklärt, 9001 bleibt offen und angehalten; Kontrolle dieselbe Buchung als Zahlung → automatisch', () => {
  const zeilen = [zeile(9001, { betrag_brutto_cent: 10000 })];
  const k = zuo.ordneZahlungenZu({ rechnungen: zeilen, zahlungen: [],
    klaerfaelle: [zahlung('K1', 10000, 'RE-2026-9001', { grund: 'Bankreferenz doppelt' })], manuell: {}, muster: MUSTER });
  assert.equal(zahlungErg(k, 'K1').zuordnung, 'ungeklärt');
  assert.match(zahlungErg(k, 'K1').grund, /Bankreferenz doppelt/);
  assert.deepEqual(zahlungErg(k, 'K1').kandidaten, ['RE-2026-9001']);
  assert.equal(rechnung(k, 9001).status, 'offen');
  assert.equal(rechnung(k, 9001).bezahlt_cent, 0);
  assert.equal(rechnung(k, 9001).klaerfall_halt, true);
  const a = ordne(zeilen, [zahlung('K1', 10000, 'RE-2026-9001')]);
  assert.equal(zahlungErg(a, 'K1').zuordnung, 'automatisch');
  assert.equal(rechnung(a, 9001).status, 'bezahlt');
});

test('Klärfall aus dem Auszug mit manueller Zuordnung → manuell verbucht (der Betrieb hat entschieden)', () => {
  const zeilen = [zeile(9001, { betrag_brutto_cent: 10000 })];
  const k = zuo.ordneZahlungenZu({ rechnungen: zeilen, zahlungen: [],
    klaerfaelle: [zahlung('K1', 10000, 'RE-2026-9001', { grund: 'Storno' })], manuell: { K1: 'RE-2026-9001' }, muster: MUSTER });
  assert.equal(zahlungErg(k, 'K1').zuordnung, 'manuell');
  assert.equal(rechnung(k, 9001).status, 'bezahlt');
  assert.equal(rechnung(k, 9001).klaerfall_halt, false);
});

// Gefunden bei der Vorhersage Baustein 5: ein Klärfall in Fremdwährung, der eine Rechnungsnr. nennt, hält sie an.
test('Fremdwährung nennt RE-2026-9004 → 9004 angehalten (Klärfall-Halt); Kontrolle Fremdwährung ohne Nummer, anderer Betrag → nicht angehalten', () => {
  const zeilen = [zeile(9004, { betrag_brutto_cent: 50000 })];
  const k = zuo.ordneZahlungenZu({ rechnungen: zeilen, zahlungen: [], manuell: {}, muster: MUSTER,
    klaerfaelle: [zahlung('U1', 9900, 'RE-2026-9004', { waehrung: 'USD', grund: 'Fremdwährung' })] });
  assert.equal(zahlungErg(k, 'U1').zuordnung, 'ungeklärt');
  assert.equal(rechnung(k, 9004).klaerfall_halt, true);
  const o = zuo.ordneZahlungenZu({ rechnungen: zeilen, zahlungen: [], manuell: {}, muster: MUSTER,
    klaerfaelle: [zahlung('U2', 9900, 'Rechnung', { waehrung: 'USD', grund: 'Fremdwährung' })] });
  assert.equal(rechnung(o, 9004).klaerfall_halt, false);
});
