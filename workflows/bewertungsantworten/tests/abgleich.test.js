'use strict';
// abgleich.js: Zeilen des Blatts gegen die Quelle (c 5), Löschfrist (c 2, S26), Mengen (E13). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const ab = require('../kern/abgleich.js');
const K = Object.assign({}, require('../kern/sperre.js'), require('../kern/zeit.js'), require('../kern/hash.js'));

const ST = '2026-09-20T08:15:00Z';
const item = (id, abw) => Object.assign({ art: 'bewertung', bewertung_id: id, sterne: 5, text: 'Gut.', erstellt_utc: ST, geaendert_utc: ST, anonym: false,
  anzeigename: 'Bewerter Probe 01', antwort_vorhanden: false, antwort_text: '', antwort_geaendert_utc: '', antwort_status: '', antwort_verstoss: '', hinweise: [], mangel: [] }, abw || {});
const zeile = (n, id, abw) => Object.assign({ zeile: n, bewertung_id: id, eingang: '', stand_utc: ST, sterne: 5, text: 'Gut.', kategorie: 'positiv',
  hinweise: '', entwurf: 'Guten Tag, danke.', antwort: 'Guten Tag, danke.', freigabe: '', status: 'Entwurf bereit', veroeffentlicht_am: '', versandstatus_klaeren: '' }, abw || {});
const status = (abw) => Object.assign({ art: 'status', status: 'ok', vollstaendig: true }, abw || {});
const dt = (id, aktion, stand) => ({ id: 1, schluessel: 'antwort|' + id + '|' + (stand || ST), aktion, lauf_id: '6999', zeit_utc: '2026-09-27T06:00:00.000Z' });
const lauf = (zeilen, items, sperr, abw) => ab.abgleichen(Object.assign({ zeilen, quelle: { status: status(), bewertungen: items }, sperrzeilen: sperr || [],
  seit_utc: '2026-09-01T00:00:00Z' }, abw || {}), K);
const felder = (r, n) => (r.aenderungen.find((a) => a.zeile === n) || {}).felder;

test('neue Bewertung → Entwurf nötig (neue Zeile); unveränderte → nichts', () => {
  const r = lauf([zeile(2, 'R-9001')], [item('R-9001'), item('R-9002')]);
  assert.deepEqual(r.entwurf_noetig.map((e) => [e.bewertung.bewertung_id, e.grund, e.zeile]), [['R-9002', 'neu', null]]);
  assert.deepEqual(r.aenderungen, []);
});

test('S03/B16 geänderte Bewertung: Freigabe verfällt, neuer Stand und Text; a) Antwort gleich altem Entwurf → wird ersetzt; b) vom Betrieb geändert → bleibt, Hinweis', () => {
  const neu = item('R-9001', { geaendert_utc: '2026-09-25T10:00:00Z', text: 'Geändert: doch nicht so gut.' });
  const a = lauf([zeile(2, 'R-9001', { freigabe: 'freigeben' })], [neu]);
  assert.deepEqual(felder(a, 2), { 'Stand (UTC)': '2026-09-25T10:00:00Z', Bewertungstext: 'Geändert: doch nicht so gut.', Freigabe: '', Status: '', Kategorie: '' });
  assert.deepEqual(a.entwurf_noetig.map((e) => [e.grund, e.zeile, e.antwort_ersetzen]), [['geaendert', 2, true]]);
  const b = lauf([zeile(2, 'R-9001', { freigabe: 'freigeben', antwort: 'Eigener Text des Betriebs.' })], [neu]);
  assert.deepEqual([b.entwurf_noetig[0].antwort_ersetzen, b.aenderungen[0].hinweise], [false, ['Bewertung geändert – eigene Antwort prüfen']]);
});

test('S05/B18 Antwort in der Quelle ohne eigene Veröffentlichung → „schon beantwortet“, Freigabe verfällt; Kontrolle ohne Antwort nichts', () => {
  const r = lauf([zeile(2, 'R-9001', { freigabe: 'freigeben' })], [item('R-9001', { antwort_vorhanden: true, antwort_text: 'Von Hand.', antwort_status: 'APPROVED' })]);
  assert.deepEqual(felder(r, 2), { Status: 'schon beantwortet', Freigabe: '' });
});

test('S25 eigene Antwort: PENDING → wartet auf Google; APPROVED → veröffentlicht; REJECTED → abgelehnt mit policyViolation, kein neuer Versuch', () => {
  const eigen = [dt('R-9001', 'veroeffentlicht')];
  const mit = (st, v) => item('R-9001', { antwort_vorhanden: true, antwort_text: 'Guten Tag, danke.', antwort_status: st, antwort_verstoss: v || '' });
  assert.deepEqual(felder(lauf([zeile(2, 'R-9001', { status: 'veröffentlicht' })], [mit('PENDING')], eigen), 2), { Status: 'wartet auf Google' });
  assert.deepEqual(felder(lauf([zeile(2, 'R-9001', { status: 'wartet auf Google' })], [mit('APPROVED')], eigen), 2), { Status: 'veröffentlicht' });
  const rj = lauf([zeile(2, 'R-9001', { status: 'wartet auf Google' })], [mit('REJECTED', 'PERSONAL_INFO')], eigen);
  assert.deepEqual([felder(rj, 2), rj.aenderungen[0].aufgaben], [{ Status: 'von Google abgelehnt' }, ['Von Google abgelehnt (PERSONAL_INFO) – in Google von Hand antworten']]);
  assert.deepEqual(lauf([zeile(2, 'R-9001', { status: 'von Google abgelehnt' })], [mit('REJECTED', 'PERSONAL_INFO')], eigen).aenderungen, []);
});

test('S04/S27/B17 gelöscht nur bei vollständig gelesener Liste und Stand im Lesefenster; Kontrollen', () => {
  assert.deepEqual(felder(lauf([zeile(2, 'R-9001', { freigabe: 'freigeben' })], []), 2), { Status: 'Bewertung gelöscht', Freigabe: '' });
  const unv = lauf([zeile(2, 'R-9001')], [], [], { quelle: { status: status({ vollstaendig: false }), bewertungen: [] } });
  assert.deepEqual([unv.aenderungen, unv.meldungen], [[], ['Quelle nicht vollständig gelesen – keine Zeile als gelöscht markiert']]);
  assert.deepEqual(lauf([zeile(2, 'R-9001', { stand_utc: '2026-08-01T00:00:00Z' })], []).aenderungen, []);
  assert.deepEqual(lauf([zeile(2, 'R-9001', { status: 'Bewertung gelöscht' })], []).aenderungen, []);
});

test('Mangel aus dem Lesen (z. B. #ERROR!) → Hinweis, kein Entwurf; Quelle nicht ok → nichts, Alarm', () => {
  const r = lauf([], [item('R-9003', { text: '', mangel: ['comment unlesbar (#ERROR!)'] })]);
  assert.deepEqual([r.entwurf_noetig, r.neu_ohne_entwurf.map((x) => x.hinweise)], [[], [['Bewertung unlesbar: comment unlesbar (#ERROR!)']]]);
  const f = ab.abgleichen({ zeilen: [zeile(2, 'R-9001')], quelle: { status: status({ status: 'quelle_fehler' }), bewertungen: [] }, sperrzeilen: [], seit_utc: ST }, K);
  assert.deepEqual([f.aenderungen, f.entwurf_noetig, f.alarme], [[], [], ['Quelle nicht ok: quelle_fehler']]);
});

test('E13 Höchstzahl Entwürfe: älteste zuerst, Rest im nächsten Lauf mit Hinweis; Kontrolle genau an der Grenze', () => {
  const l = [3, 1, 2].map((i) => ({ bewertung: item('R-900' + i, { erstellt_utc: '2026-09-2' + i + 'T08:00:00Z' }), grund: 'neu', zeile: null }));
  const r = ab.begrenzeEntwuerfe(l, 2);
  assert.deepEqual([r.jetzt.map((e) => e.bewertung.bewertung_id), r.spaeter.map((e) => e.bewertung.bewertung_id), r.hinweis], [['R-9001', 'R-9002'], ['R-9003'], '1 Entwurf im nächsten Lauf (Höchstzahl 2)']);
  assert.deepEqual(ab.begrenzeEntwuerfe(l, 3).spaeter, []);
});

test('Lesefenster: seit = später von „Bewertungen ab“ (Berlin 00:00) und jetzt − Frist', () => {
  assert.equal(ab.leseFenster('2026-09-01', 30, '2026-10-02T12:00:00Z', K), '2026-09-02T12:00:00Z');
  assert.equal(ab.leseFenster('2026-09-20', 30, '2026-10-02T12:00:00Z', K), '2026-09-19T22:00:00Z');
});

test('S26/B28 Löschfrist: Texte leer, Status „Frist abgelaufen“ (außer veröffentlicht); Kontrolle 20 Tage; schon geleerte Zeile nicht erneut', () => {
  const jetzt = '2026-10-02T12:00:00Z';
  const r = ab.loeschAuftraege([zeile(2, 'R-9001', { stand_utc: '2026-09-04T12:00:00Z' }), zeile(3, 'R-9002', { stand_utc: '2026-09-12T12:00:00Z' }),
    zeile(4, 'R-9003', { stand_utc: '2026-09-04T12:00:00Z', status: 'veröffentlicht' }), zeile(5, 'R-9004', { stand_utc: '2026-09-04T12:00:00Z', text: '', entwurf: '', antwort: '', status: 'Frist abgelaufen' })], 30, jetzt, K);
  assert.deepEqual(r, [
    { zeile: 2, felder: { Bewertungstext: '', Entwurf: '', Antwort: '', Freigabe: '', Status: 'Frist abgelaufen' } },
    { zeile: 4, felder: { Bewertungstext: '', Entwurf: '', Antwort: '', Freigabe: '', Status: 'veröffentlicht' } }]);
});

test('S21 eigene Antwort über den Hash (abgebrochener Lauf, nur „reserviert“): wie eigene behandelt und zum Nachziehen gemeldet; Kontrolle anderer Hash → schon beantwortet', () => {
  const text = 'Guten Tag, danke.';
  const res = [{ id: 1, schluessel: 'antwort|R-9001|' + ST, aktion: 'reserviert', lauf_id: '6990', zeit_utc: '2026-09-27T06:00:00.000Z', text_hash: K.textHash(text) }];
  const it = item('R-9001', { antwort_vorhanden: true, antwort_text: text, antwort_status: 'APPROVED' });
  const r = lauf([zeile(2, 'R-9001', { status: 'Versandstatus unklar' })], [it], res);
  assert.deepEqual([felder(r, 2), r.nachziehen], [{ Status: 'veröffentlicht' }, [{ bewertung_id: 'R-9001', schluessel: 'antwort|R-9001|' + ST, text_hash: K.textHash(text) }]]);
  const k = lauf([zeile(2, 'R-9001', { status: 'Versandstatus unklar' })], [item('R-9001', { antwort_vorhanden: true, antwort_text: 'Von Hand.', antwort_status: 'APPROVED' })], res);
  assert.deepEqual(felder(k, 2), { Status: 'schon beantwortet', Freigabe: '' });
});

test('c 6/S05: NEUE Bewertung mit Antwort in der Quelle (von Hand, PENDING, REJECTED) → kein Entwurf, eigene Liste; Kontrolle ohne Antwort → Entwurf', () => {
  const r = lauf([], [item('R-9016', { antwort_vorhanden: true, antwort_text: 'Danke, von Hand.', antwort_status: 'APPROVED' }),
    item('R-9022', { antwort_vorhanden: true, antwort_status: 'PENDING' }), item('R-9002')]);
  assert.deepEqual(r.entwurf_noetig.map((e) => e.bewertung.bewertung_id), ['R-9002']);
  assert.deepEqual(r.neu_beantwortet.map((e) => e.bewertung.bewertung_id), ['R-9016', 'R-9022']);
  assert.deepEqual(lauf([], [item('R-9003', { mangel: ['comment unlesbar (#ERROR!)'], antwort_vorhanden: true })]).neu_ohne_entwurf.length, 1);
});

test('E13 Hinweistext: Mehrzahl „Entwürfe“ (nicht „Entwurfe“), Einzahl „Entwurf“', () => {
  const l = ['R-1', 'R-2', 'R-3'].map((id) => ({ bewertung: item(id), grund: 'neu', zeile: null }));
  assert.equal(ab.begrenzeEntwuerfe(l, 1).hinweis, '2 Entwürfe im nächsten Lauf (Höchstzahl 1)');
  assert.equal(ab.begrenzeEntwuerfe(l, 2).hinweis, '1 Entwurf im nächsten Lauf (Höchstzahl 2)');
});
