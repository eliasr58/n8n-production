'use strict';
// lesen.js: Unterworkflow „Bewertungen lesen“ (PLAN-QUELLEN Vertrag 1, Baustein 4) - Eingang, Status statt Wurf, Blatt und
// Kopfzeile fail-closed, Filter seit, Status-Item zuerst. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const ls = require('../kern/lesen.js');
const tb = require('../kern/tabelle.js');
const zt = require('../kern/zeit.js');

const K = { leseTestquelle: tb.leseTestquelle, TQ_SPALTEN: tb.TQ_SPALTEN, berlinZuUtc: zt.berlinZuUtc };
const TQ = tb.TQ_SPALTEN;
const zeile = (o) => TQ.map((s) => (o[s] === undefined ? '' : o[s]));
const R = (id, abw) => Object.assign({ reviewId: id, starRating: 'FIVE', comment: 'Gut.', createTime: '2026-09-20T08:15:00Z',
  updateTime: '2026-09-20T08:15:00Z', 'reviewer.displayName': 'Bewerter Probe 01', 'reviewer.isAnonymous': false }, abw || {});
const BLAETTER = ['Bewertungen', 'Einstellungen', 'Textbausteine', 'Protokoll', 'Testquelle'];
const meta = (titel, code) => ({ statusCode: code || 200, body: { sheets: (titel || BLAETTER).map((t) => ({ properties: { title: t } })) } });
const werte = (values, code) => ({ statusCode: code || 200, body: values === undefined ? {} : { range: "'Testquelle'!A1:Z1000", values } });
const SEIT = '2026-01-01T00:00:00Z';
const TEST = { art: 'test', tabelle_id: 'tabelle-erfunden-0000' };

test('Eingang: test mit tabelle_id und seit → weiter; google und jede andere Art → quelle_nicht_gebaut ohne Wurf', () => {
  const e = ls.pruefeEingangLesen([{ quelle: TEST, seit: SEIT }]);
  assert.deepEqual([e.weiter, e.tabelle_id, e.seit], [true, 'tabelle-erfunden-0000', SEIT]);
  for (const q of [{ art: 'google', konto_id: '0000', standort_id: '0000' }, { art: 'google' }, { art: 'provenexpert' }]) {
    const g = ls.pruefeEingangLesen([{ quelle: q, seit: SEIT }]);
    assert.deepEqual([g.weiter, g.ergebnis.status.status, g.ergebnis.status.anzahl, g.ergebnis.status.vollstaendig, g.ergebnis.bewertungen],
      [false, 'quelle_nicht_gebaut', 0, false, []]);
    assert.match(g.ergebnis.status.meldungen[0], new RegExp(q.art));
  }
});

test('Eingang: Aufruffehler werfen (Unerwartetes) - kein oder zwei Items, ohne quelle.art, seit fehlt oder nicht RFC 3339 UTC, test ohne tabelle_id', () => {
  const faelle = [[], [{ quelle: TEST, seit: SEIT }, { quelle: TEST, seit: SEIT }], [null], [{ seit: SEIT }], [{ quelle: { art: '' }, seit: SEIT }],
    [{ quelle: TEST }], [{ quelle: TEST, seit: '2026-09-01' }], [{ quelle: TEST, seit: '27.09.2026' }], [{ quelle: TEST, seit: '2026-09-01T10:00:00+02:00' }],
    [{ quelle: TEST, seit: '2026-13-45T00:00:00Z' }], [{ quelle: { art: 'test' }, seit: SEIT }], [{ quelle: { art: 'test', tabelle_id: '  ' }, seit: SEIT }]];
  faelle.forEach((f, i) => assert.throws(() => ls.pruefeEingangLesen(f), /Bewertungen lesen/, 'Fall ' + i));
  assert.doesNotThrow(() => ls.pruefeEingangLesen([{ quelle: TEST, seit: '2026-09-01T10:00:00.250Z' }]));
});

test('Wurftexte ohne „: “ - der Code-Knoten kürzt bis zum ersten Doppelpunkt mit Leerzeichen', () => {
  for (const f of [[], [{ seit: SEIT }], [{ quelle: TEST, seit: 'gestern' }], [{ quelle: { art: 'test' }, seit: SEIT }]]) {
    let text = null;
    try { ls.pruefeEingangLesen(f); } catch (e) { text = e.message; }
    assert.ok(text !== null && /Bewertungen lesen/.test(text), 'kein Wurf');
    assert.equal(text.indexOf(': '), -1, text);
  }
});

test('Normalfall: Status ok, Anzahl, vollständig, eine Seite; Vertrags-Items aus dem Parser', () => {
  const r = ls.leseQuelleTest({ meta: meta(), werte: werte([TQ, zeile(R('R-9001')), zeile(R('R-9002', { starRating: 'TWO' }))]), seit: SEIT }, K);
  assert.deepEqual([r.status.art, r.status.status, r.status.anzahl, r.status.vollstaendig, r.status.seiten, r.status.meldungen], ['status', 'ok', 2, true, 1, []]);
  assert.deepEqual(r.bewertungen.map((b) => [b.art, b.bewertung_id, b.sterne]), [['bewertung', 'R-9001', 5], ['bewertung', 'R-9002', 2]]);
});

test('Tabelle nicht lesbar (HTTP ≠ 2xx) → quelle_fehler, keine Bewertungen; Kontrolle 200 → ok', () => {
  const r = ls.leseQuelleTest({ meta: { statusCode: 404, body: { error: { code: 404 } } }, werte: werte(undefined, 404), seit: SEIT }, K);
  assert.deepEqual([r.status.status, r.status.vollstaendig, r.bewertungen.length], ['quelle_fehler', false, 0]);
  assert.match(r.status.meldungen.join(' '), /HTTP 404/);
  assert.equal(ls.leseQuelleTest({ meta: meta(), werte: werte([TQ]), seit: SEIT }, K).status.status, 'ok');
});

test('Blatt „Testquelle“ fehlt oder umbenannt → aufbau_falsch, nicht quelle_fehler (values.get antwortet dann 400)', () => {
  const r = ls.leseQuelleTest({ meta: meta(['Bewertungen', 'Testquelle (alt)']), werte: werte(undefined, 400), seit: SEIT }, K);
  assert.deepEqual([r.status.status, r.status.vollstaendig, r.bewertungen.length], ['aufbau_falsch', false, 0]);
  assert.match(r.status.meldungen.join(' '), /Blatt Testquelle fehlt/);
  assert.equal(ls.leseQuelleTest({ meta: meta([]), werte: werte(undefined, 400), seit: SEIT }, K).status.status, 'aufbau_falsch');
});

test('Blatt da, Werte nicht lesbar (HTTP 500) → quelle_fehler; Kontrolle Werte 200 → ok', () => {
  const r = ls.leseQuelleTest({ meta: meta(), werte: werte(undefined, 500), seit: SEIT }, K);
  assert.deepEqual([r.status.status, r.bewertungen.length], ['quelle_fehler', 0]);
  assert.match(r.status.meldungen.join(' '), /HTTP 500/);
});

test('Spalte fehlt (umbenannt) → aufbau_falsch mit Namen; doppelt → aufbau_falsch mit Namen; keine Bewertungen', () => {
  const um = TQ.map((s) => (s === 'comment' ? 'comment (alt)' : s));
  const f = ls.leseQuelleTest({ meta: meta(), werte: werte([um, zeile(R('R-9001'))]), seit: SEIT }, K);
  assert.deepEqual([f.status.status, f.bewertungen.length], ['aufbau_falsch', 0]);
  assert.ok(f.status.meldungen.includes('Spalte fehlt – comment'), f.status.meldungen.join(' | '));
  assert.ok(f.status.meldungen.includes('Spalte zusätzlich – comment (alt)'), f.status.meldungen.join(' | '));
  const d = ls.leseQuelleTest({ meta: meta(), werte: werte([TQ.concat(['comment']), zeile(R('R-9001'))]), seit: SEIT }, K);
  assert.deepEqual([d.status.status, d.bewertungen.length], ['aufbau_falsch', 0]);
  assert.ok(d.status.meldungen.includes('Spalte doppelt – comment'), d.status.meldungen.join(' | '));
  const v = TQ.slice(); v[3] = TQ[4]; v[4] = TQ[3];
  const o = ls.leseQuelleTest({ meta: meta(), werte: werte([v, zeile(R('R-9001'))]), seit: SEIT }, K);
  assert.deepEqual([o.status.status, o.status.meldungen], ['aufbau_falsch', ['Spalten in anderer Reihenfolge']]);
});

test('Leere Quelle: nur Kopfzeile → ok mit 0; ganz leeres Blatt (keine Kopfzeile) → aufbau_falsch', () => {
  const r = ls.leseQuelleTest({ meta: meta(), werte: werte([TQ]), seit: SEIT }, K);
  assert.deepEqual([r.status.status, r.status.anzahl, r.status.vollstaendig, r.bewertungen], ['ok', 0, true, []]);
  const g = ls.leseQuelleTest({ meta: meta(), werte: werte(undefined), seit: SEIT }, K);
  assert.equal(g.status.status, 'aufbau_falsch');
  assert.ok(g.status.meldungen.includes('Spalte fehlt – reviewId'));
});

test('seit: nur updateTime ≥ seit, als Zeitpunkt verglichen (nicht als Text); unlesbare Zeit geht mit Mangel weiter', () => {
  const r = ls.leseQuelleTest({ meta: meta(), werte: werte([TQ,
    zeile(R('R-1', { updateTime: '2026-09-25T23:59:59Z' })),
    zeile(R('R-2', { updateTime: '2026-09-26T00:00:00Z' })),
    zeile(R('R-3', { updateTime: '2026-09-26T00:00:00.500Z' })),
    zeile(R('R-4', { updateTime: 'gestern' }))]), seit: '2026-09-26T00:00:00Z' }, K);
  assert.deepEqual(r.bewertungen.map((b) => b.bewertung_id), ['R-2', 'R-3', 'R-4']);
  assert.deepEqual([r.status.anzahl, r.status.vollstaendig], [3, true]);
  assert.deepEqual(r.bewertungen[2].mangel, ['updateTime unlesbar']);
});

test('Ausgabe: genau ein Status-Item zuerst, Bewertungen nur bei ok', () => {
  const b = { art: 'bewertung', bewertung_id: 'R-1' };
  const ok = ls.lesenAusgabe({ status: { art: 'status', status: 'ok', anzahl: 1 }, bewertungen: [b] });
  assert.deepEqual(ok.map((j) => j.art), ['status', 'bewertung']);
  for (const s of ['aufbau_falsch', 'quelle_fehler', 'quelle_nicht_gebaut']) {
    const x = ls.lesenAusgabe({ status: { art: 'status', status: s, anzahl: 1 }, bewertungen: [b] });
    assert.deepEqual(x.map((j) => [j.art, j.status]), [['status', s]]);
  }
});

test('Fixture der Test-Tabelle (Baustein 3, E33, E51): 45 Bewertungen, Mangel nur R-9904; Antworten R-9016, R-9022 PENDING, R-9023 REJECTED; seit 26.09. → 12', () => {
  const fx = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'testdaten', 'tabelle', 'testbetrieb.json'), 'utf8'));
  const tq = fx.blaetter.find((b) => b.titel === 'Testquelle').zeilen;
  const alle = ls.leseQuelleTest({ meta: meta(), werte: werte(tq), seit: SEIT }, K);
  assert.deepEqual([alle.status.status, alle.status.anzahl, alle.status.vollstaendig], ['ok', 45, true]);
  assert.deepEqual(alle.bewertungen.filter((b) => b.mangel.length).map((b) => [b.bewertung_id, b.mangel]), [['R-9904', ['comment unlesbar (#ERROR!)']]]);
  assert.deepEqual(alle.bewertungen.filter((b) => b.antwort_vorhanden).map((b) => [b.bewertung_id, b.antwort_status, b.antwort_verstoss]),
    [['R-9016', 'APPROVED', ''], ['R-9022', 'PENDING', ''], ['R-9023', 'REJECTED', 'PERSONAL_INFO']]);
  const ab26 = ls.leseQuelleTest({ meta: meta(), werte: werte(tq), seit: '2026-09-26T00:00:00Z' }, K);
  assert.deepEqual(ab26.bewertungen.map((b) => b.bewertung_id), ['R-8007', 'R-8014', 'R-9021', 'R-9022', 'R-9023', 'R-9024', 'R-9025', 'R-9901', 'R-9902', 'R-9904', 'R-9905', 'R-9906']);
  // E51: Kontrolle B11 genau 2 000 Zeichen (ungekürzt an Anthropic), Kontrolle B28 Stand = Stichtag 2026-10-23 − 20 Tage
  const neu = (id) => alle.bewertungen.find((b) => b.bewertung_id === id);
  assert.deepEqual([neu('R-9024').text.length, neu('R-9024').text.trim().length, neu('R-9025').geaendert_utc, neu('R-9025').erstellt_utc],
    [2000, 2000, '2026-10-03T10:00:00Z', '2026-10-03T10:00:00Z']);
});
