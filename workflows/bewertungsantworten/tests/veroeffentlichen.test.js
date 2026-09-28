'use strict';
// veroeffentlichen.js: Unterworkflow "Antwort veroeffentlichen" (PLAN-QUELLEN Vertrag 2; Baustein 8) - Eingang, Ziel test =
// Blatt "Testquelle" (Vorbedingung, Schreibauftrag RAW, Nachlesen), Ziel google = ziel_nicht_gebaut ohne Wurf. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const vo = require('../kern/veroeffentlichen.js');
const tb = require('../kern/tabelle.js');
const zt = require('../kern/zeit.js');
const fg = require('../kern/freigabe.js');
const FIX = require('./testdaten/tabelle/testbetrieb.json');

const K = Object.assign({}, tb, zt, fg);
const TQ = FIX.blaetter.find((b) => b.titel === 'Testquelle').zeilen;
const TEXT = 'Guten Tag,\n\nvielen Dank für Ihre Bewertung.\n\nIhr Team der Zimmerei & Dachbau Beispiel GmbH';
const JETZT = '2026-09-28T12:00:05.000Z';
const ein = (abw) => Object.assign({ ziel: { art: 'test', tabelle_id: 'TABELLE-TEST' }, bewertung_id: 'R-9001', erwartet_geaendert_utc: '2026-09-21T08:00:00Z',
  text: TEXT, schreiben: true }, abw || {});
const META = { statusCode: 200, body: { sheets: [{ properties: { title: 'Bewertungen' } }, { properties: { title: 'Testquelle' } }] } };
const WERTE = (zeilen) => ({ statusCode: 200, body: { values: JSON.parse(JSON.stringify(zeilen || TQ)) } });
const vorb = (e, abw) => vo.zielVorbereiten(Object.assign({ eingang: e, meta: META, werte: WERTE(), jetzt_utc: JETZT }, abw || {}), K);
const wirft = (f) => { let t = null; try { f(); } catch (e) { t = e.message; } return t; };

test('Eingang: genau ein Item mit ziel.art, bewertung_id, erwartet_geaendert_utc (UTC mit Z), text, schreiben; sonst Wurf ohne „: “', () => {
  const e = vo.pruefeEingangVeroeffentlichen([ein()]);
  assert.deepEqual([e.weiter, e.tabelle_id, e.bewertung_id, e.schreiben], [true, 'TABELLE-TEST', 'R-9001', true]);
  const faelle = [[], [ein(), ein()], [ein({ ziel: {} })], [ein({ bewertung_id: ' ' })], [ein({ erwartet_geaendert_utc: '2026-09-21 08:00' })],
    [ein({ text: 5 })], [ein({ schreiben: 'ja' })], [ein({ ziel: { art: 'test' } })]];
  for (const f of faelle) {
    const t = wirft(() => vo.pruefeEingangVeroeffentlichen(f));
    assert.ok(t && /^Antwort veröffentlichen/.test(t) && t.indexOf(': ') < 0, JSON.stringify(f).slice(0, 80) + ' → ' + t);
  }
});

test('Ziel google (und jede andere Art) → ziel_nicht_gebaut, geschrieben false, kein Wurf', () => {
  for (const art of ['google', 'provenexpert']) {
    const e = vo.pruefeEingangVeroeffentlichen([ein({ ziel: { art, konto_id: '1', standort_id: '2' } })]);
    assert.equal(e.weiter, false);
    assert.deepEqual(e.ergebnis, { art: 'status', status: 'ziel_nicht_gebaut', grund: '', geschrieben: false, antwort_status: '', antwort_geaendert_utc: '',
      antwort_verstoss: '' });
  }
});

test('Ziel test: unveränderte Bewertung ohne Antwort → Schreibauftrag RAW nur für H:K genau dieser Zeile; Moderation leer = APPROVED', () => {
  const v = vorb(ein());
  const zeile = TQ.findIndex((z) => z[0] === 'R-9001') + 1;
  assert.equal(v.weiter, true);
  assert.equal(v.zeile, zeile);
  assert.deepEqual(v.body, { valueInputOption: 'RAW', data: [{ range: "'Testquelle'!H" + zeile + ':K' + zeile, values: [[TEXT, JETZT, 'APPROVED', '']] }] });
});

test('Moderation (Test): PENDING, REJECTED, „REJECTED PERSONAL_INFO“ → so geschrieben; unbekannter Wert → fehler, nichts geschrieben', () => {
  const mit = (wert) => { const t = JSON.parse(JSON.stringify(TQ)); const i = t.findIndex((z) => z[0] === 'R-9001'); t[i][11] = wert; return WERTE(t); };
  const w = (wert) => vorb(ein(), { werte: mit(wert) });
  assert.deepEqual(w('PENDING').body.data[0].values[0].slice(2), ['PENDING', '']);
  assert.deepEqual(w('REJECTED').body.data[0].values[0].slice(2), ['REJECTED', '']);
  assert.deepEqual(w('REJECTED PERSONAL_INFO').body.data[0].values[0].slice(2), ['REJECTED', 'PERSONAL_INFO']);
  assert.deepEqual(w(' approved ').body.data[0].values[0].slice(2), ['APPROVED', '']);
  const f = w('VIELLEICHT');
  assert.deepEqual([f.weiter, f.ergebnis.status, f.ergebnis.geschrieben, f.ergebnis.grund], [false, 'fehler', false, 'Moderation (Test) unbekannt – VIELLEICHT']);
});

test('Vorbedingung am Ziel (zweite Verteidigung): gelöscht, geändert, schon beantwortet, Text ungültig → vorbedingung_verletzt, nichts geschrieben', () => {
  const f = (e) => { const v = vorb(e); assert.equal(v.weiter, false); return [v.ergebnis.status, v.ergebnis.grund, v.ergebnis.geschrieben]; };
  assert.deepEqual(f(ein({ bewertung_id: 'R-9990' })), ['vorbedingung_verletzt', 'geloescht', false]);
  assert.deepEqual(f(ein({ erwartet_geaendert_utc: '2026-09-20T08:00:00Z' })), ['vorbedingung_verletzt', 'geaendert', false]);
  assert.deepEqual(f(ein({ bewertung_id: 'R-9016', erwartet_geaendert_utc: '2026-09-24T11:00:00Z' })), ['vorbedingung_verletzt', 'schon_beantwortet', false]);
  assert.deepEqual(f(ein({ text: '  ' })), ['vorbedingung_verletzt', 'text_ungueltig', false]);
  const s = vorb(ein({ bewertung_id: 'R-9016', erwartet_geaendert_utc: '2026-09-24T11:00:00Z' })).ergebnis;
  assert.deepEqual([s.antwort_status, s.antwort_geaendert_utc], ['APPROVED', '2026-09-25T09:00:00Z']);
});

test('schreiben false (trocken) → wuerde_veroeffentlichen ohne Schreibauftrag; Kontrolle schreiben true → Schreibauftrag', () => {
  const v = vorb(ein({ schreiben: false }));
  assert.deepEqual([v.weiter, v.ergebnis.status, v.ergebnis.geschrieben, v.body], [false, 'wuerde_veroeffentlichen', false, undefined]);
  assert.equal(vorb(ein()).weiter, true);
});

test('Tabelle, Blatt, Werte nicht lesbar, Kopfzeile falsch, reviewId doppelt → fehler mit Grund, geschrieben false', () => {
  const g = (abw) => { const v = vorb(ein(), abw); return [v.weiter, v.ergebnis.status, v.ergebnis.grund, v.ergebnis.geschrieben]; };
  assert.deepEqual(g({ meta: { statusCode: 404, body: {} } }), [false, 'fehler', 'Tabelle nicht lesbar, HTTP 404', false]);
  assert.deepEqual(g({ meta: { statusCode: 200, body: { sheets: [{ properties: { title: 'Bewertungen' } }] } } }), [false, 'fehler', 'Blatt Testquelle fehlt', false]);
  assert.deepEqual(g({ werte: { statusCode: 500, body: {} } }), [false, 'fehler', 'Testquelle nicht lesbar, HTTP 500', false]);
  const kopf = JSON.parse(JSON.stringify(TQ)); kopf[0][11] = 'Moderation';
  assert.deepEqual(g({ werte: WERTE(kopf) }), [false, 'fehler', 'Kopfzeile der Testquelle weicht ab', false]);
  const doppelt = JSON.parse(JSON.stringify(TQ)); doppelt.push(doppelt.find((z) => z[0] === 'R-9001'));
  assert.deepEqual(g({ werte: WERTE(doppelt) }), [false, 'fehler', 'reviewId doppelt', false]);
});

const NACH = (text, zustand, verstoss) => {
  const t = JSON.parse(JSON.stringify(TQ)); const i = t.findIndex((z) => z[0] === 'R-9001');
  t[i][7] = text; t[i][8] = JETZT; t[i][9] = zustand; t[i][10] = verstoss || ''; return WERTE(t);
};
const ab = (schreiben, nachlesen, e) => vo.zielAbschliessen({ eingang: e || ein(), schreiben, nachlesen }, K);

test('Nachlesen: Text gleich (Zeilenenden normalisiert) und Zustand PENDING, APPROVED oder REJECTED → veroeffentlicht mit Zustand und Verstoß', () => {
  const ok = ab({ statusCode: 200, body: {} }, NACH(TEXT.replace(/\n/g, '\r\n'), 'APPROVED'));
  assert.deepEqual(ok, { art: 'status', status: 'veroeffentlicht', grund: '', geschrieben: true, antwort_status: 'APPROVED', antwort_geaendert_utc: JETZT, antwort_verstoss: '' });
  assert.equal(ab({ statusCode: 200 }, NACH(TEXT, 'PENDING')).antwort_status, 'PENDING');
  const rej = ab({ statusCode: 200 }, NACH(TEXT, 'REJECTED', 'PERSONAL_INFO'));
  assert.deepEqual([rej.status, rej.antwort_status, rej.antwort_verstoss], ['veroeffentlicht', 'REJECTED', 'PERSONAL_INFO']);
});

test('Nachlesen gescheitert → fehler mit geschrieben true (vielleicht geschrieben → nie erneut): Schreiben oder Nachlesen nicht 2xx, Text anders, Zustand leer', () => {
  const g = (s, n) => { const r = ab(s, n); return [r.status, r.grund, r.geschrieben]; };
  assert.deepEqual(g({ statusCode: 500, body: {} }, NACH(TEXT, 'APPROVED')), ['fehler', 'Schreiben HTTP 500', true]);
  assert.deepEqual(g({ statusCode: 200 }, { statusCode: 429, body: {} }), ['fehler', 'Nachlesen HTTP 429', true]);
  assert.deepEqual(g({ statusCode: 200 }, NACH(TEXT + '!', 'APPROVED')), ['fehler', 'Nachlesen – Text oder Zustand weicht ab', true]);
  assert.deepEqual(g({ statusCode: 200 }, NACH(TEXT, '')), ['fehler', 'Nachlesen – Text oder Zustand weicht ab', true]);
  assert.deepEqual(g({ statusCode: 200 }, WERTE(TQ.filter((z) => z[0] !== 'R-9001'))), ['fehler', 'Nachlesen – Text oder Zustand weicht ab', true]);
});

test('Ausgabe: genau ein Status-Item; ein Grund nennt nie den Text', () => {
  const r = ab({ statusCode: 200 }, NACH(TEXT + '!', 'APPROVED'));
  assert.deepEqual(vo.voAusgabe(r), [r]);
  assert.ok(!JSON.stringify(r).includes('Guten Tag'));
});
