'use strict';
// tabelle.js: Blatt „Bewertungen“ (S23), Testquelle in Google-Form (Parser nach Baustein 1, Lauf 7126), Google-Schema
// (aus Doku-Schema, ungemessen), immer RAW. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const tb = require('../kern/tabelle.js');
const zt = require('../kern/zeit.js');

const TQ = tb.TQ_SPALTEN;
const zeile = (o) => TQ.map((s) => (o[s] === undefined ? '' : o[s]));
const R = (id, abw) => Object.assign({ reviewId: id, starRating: 'FIVE', comment: 'Gut.', createTime: '2026-09-20T08:15:00Z',
  updateTime: '2026-09-20T08:15:00Z', 'reviewer.displayName': 'Bewerter Probe 01', 'reviewer.isAnonymous': false }, abw || {});

test('Testquelle: Kopfzeile exakt (S23) - vertauschte oder fehlende Spalte → aufbau_falsch; Kontrolle exakt', () => {
  assert.equal(tb.leseTestquelle([TQ, zeile(R('R-9001'))]).status.status, 'ok');
  const vertauscht = TQ.slice(); vertauscht[0] = TQ[1]; vertauscht[1] = TQ[0];
  assert.equal(tb.leseTestquelle([vertauscht]).status.status, 'aufbau_falsch');
  assert.equal(tb.leseTestquelle([TQ.slice(0, 11)]).status.status, 'aufbau_falsch');
});

test('Testquelle → Vertrag 1: Sterne, Text, Zeiten, Anonym, Antwort; kurze Zeilen (leere Zellen am Ende fehlen) werden aufgefüllt', () => {
  const kurz = zeile(R('R-9001', { comment: '' })).slice(0, 7);
  const r = tb.leseTestquelle([TQ, kurz, zeile(R('R-9002', { starRating: 'TWO', 'reviewReply.comment': 'Danke.', 'reviewReply.updateTime': '2026-09-21T10:00:00Z',
    'reviewReply.reviewReplyState': 'REJECTED', 'reviewReply.policyViolation': 'PERSONAL_INFO' }))]);
  assert.deepEqual([r.status.status, r.status.anzahl, r.status.vollstaendig], ['ok', 2, true]);
  const [a, b] = r.bewertungen;
  assert.deepEqual([a.art, a.bewertung_id, a.sterne, a.text, a.geaendert_utc, a.anonym, a.antwort_vorhanden], ['bewertung', 'R-9001', 5, '', '2026-09-20T08:15:00Z', false, false]);
  assert.deepEqual([b.sterne, b.antwort_vorhanden, b.antwort_status, b.antwort_verstoss], [2, true, 'REJECTED', 'PERSONAL_INFO']);
});

test('Parser: Formen aus Baustein 1 (USER_ENTERED) - Zahl statt Text, Boolean als Text, #ERROR!, Datum als Seriennummer', () => {
  const r = tb.leseTestquelle([TQ,
    zeile(R('R-9004', { comment: 2 })),
    zeile(R('R-9006', { comment: 0, 'reviewer.isAnonymous': 'TRUE' })),
    zeile(R('R-9007', { comment: '#ERROR! (Formula parse error.)' })),
    zeile(R('R-9009', { updateTime: 46285.5 })),
    zeile(R('R-9010', { 'reviewer.isAnonymous': 'FALSCH', starRating: 4 }))], zt).bewertungen;
  assert.deepEqual([r[0].text, r[0].hinweise], ['2', ['comment als Zahl gelesen – möglicherweise umgewandelt']]);
  assert.deepEqual([r[1].text, r[1].anonym], ['0', true]);
  assert.deepEqual([r[2].text, r[2].mangel], ['', ['comment unlesbar (#ERROR!)']]);
  assert.deepEqual([r[3].geaendert_utc, r[3].hinweise], ['2026-09-20T10:00:00Z', ['updateTime aus Seriennummer (Berlin) gelesen']]);
  assert.deepEqual([r[4].anonym, r[4].sterne, r[4].hinweise], [false, 4, ['starRating als Zahl gelesen']]);
});

test('Parser: Pflichtfelder - ohne reviewId übersprungen mit Meldung; unlesbare Zeit oder Sterne → Mangel; doppelte ID → Mangel', () => {
  const r = tb.leseTestquelle([TQ, zeile(R('')), zeile(R('R-9001', { updateTime: 'gestern' })), zeile(R('R-9002', { starRating: 'SIX' })),
    zeile(R('R-9003')), zeile(R('R-9003'))]);
  assert.equal(r.status.meldungen.length, 1);
  const m = Object.fromEntries(r.bewertungen.map((b, i) => [b.bewertung_id + '#' + i, b.mangel]));
  assert.deepEqual(m, { 'R-9001#0': ['updateTime unlesbar'], 'R-9002#1': ['starRating unbekannt'], 'R-9003#2': ['reviewId doppelt'], 'R-9003#3': ['reviewId doppelt'] });
});

test('Blatt „Bewertungen“: Kopfzeile exakt (S23), Zeilen mit Nummer; Kontrolle umbenannte Spalte „Freigabe“ → nicht ok', () => {
  const K = tb.BW_SPALTEN;
  const z = K.map((s) => ({ 'Bewertungs-ID': 'R-9001', 'Stand (UTC)': '2026-09-20T08:15:00Z', Sterne: 5, Antwort: 'Danke.', Freigabe: 'freigeben' }[s] || ''));
  const r = tb.leseBewertungen([K, z, K.map(() => '')]);
  assert.deepEqual([r.ok, r.zeilen.length, r.zeilen[0].zeile, r.zeilen[0].bewertung_id, r.zeilen[0].freigabe, r.zeilen[0].sterne], [true, 1, 2, 'R-9001', 'freigeben', 5]);
  const falsch = K.map((s) => (s === 'Freigabe' ? 'Freigabe Betrieb' : s));
  assert.equal(tb.leseBewertungen([falsch, z]).ok, false);
});

test('Google (aus Doku-Schema, ungemessen): Review → Vertrag 1; Seiten - vollständig nur ohne nextPageToken; nur ab seit', () => {
  const g = { name: 'accounts/1/locations/2/reviews/R-G1', reviewId: 'R-G1', reviewer: { displayName: 'Bewerter Probe 02', isAnonymous: false },
    starRating: 'FOUR', comment: 'Gut.', createTime: '2026-09-20T08:15:00.123456Z', updateTime: '2026-09-21T08:15:00Z',
    reviewReply: { comment: 'Danke.', updateTime: '2026-09-22T08:00:00Z', reviewReplyState: 'PENDING' } };
  const v = tb.googleZuVertrag(g);
  assert.deepEqual([v.bewertung_id, v.sterne, v.anzeigename, v.antwort_status, v.antwort_vorhanden, v.geaendert_utc], ['R-G1', 4, 'Bewerter Probe 02', 'PENDING', true, '2026-09-21T08:15:00Z']);
  assert.equal(tb.googleZuVertrag(Object.assign({}, g, { comment: undefined, reviewReply: undefined })).text, '');
  const s1 = tb.leseGoogleSeiten([{ reviews: [g], nextPageToken: 'x' }], '2026-09-01T00:00:00Z');
  assert.equal(s1.status.vollstaendig, false);
  const s2 = tb.leseGoogleSeiten([{ reviews: [g] }, { reviews: [Object.assign({}, g, { reviewId: 'R-G0', updateTime: '2026-08-01T00:00:00Z' })] }], '2026-09-01T00:00:00Z');
  assert.deepEqual([s2.status.vollstaendig, s2.bewertungen.map((b) => b.bewertung_id)], [true, ['R-G1']]);
});

test('Sheets immer RAW (Befund 10 aus Baustein 1): Schreibauftrag trägt RAW; leerer Bereich wirft', () => {
  const a = tb.rawSchreibauftrag([{ range: "'Bewertungen'!H2", values: [['=1+1']] }]);
  assert.deepEqual(a, { valueInputOption: 'RAW', data: [{ range: "'Bewertungen'!H2", values: [['=1+1']] }] });
  assert.throws(() => tb.rawSchreibauftrag([{ range: '', values: [['x']] }]));
});

test('Zellen: Spalten nach Namen (A, …, M) und Zeile ≥ 2; unbekannte Spalte wirft', () => {
  assert.deepEqual(tb.zellen(5, { Status: 'blockiert', Freigabe: '' }),
    [{ range: "'Bewertungen'!K5", values: [['blockiert']] }, { range: "'Bewertungen'!J5", values: [['']] }]);
  assert.throws(() => tb.zellen(1, { Status: 'x' }));
  assert.throws(() => tb.zellen(5, { Unbekannt: 'x' }));
});
