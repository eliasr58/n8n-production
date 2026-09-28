'use strict';
// hauptlauf.js, Baustein 8: Modus test (veroeffentlichen nur mit Quelle und Ziel test), Freigaben mit der Data Table planen,
// abgebrochene Reservierungen und "Versandstatus klären" (S21), je Antwort Schritt 1-7 (neu lesen und neu entscheiden, E37,
// Reservierung S20, Ergebnis des Zieladapters in Data Table, Blatt, Protokoll und Sammelmeldung). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const hp = require('../kern/hauptlauf.js');
const tb = require('../kern/tabelle.js');
const sp = require('../kern/sperre.js');
const hs = require('../kern/hash.js');

const K = Object.assign({}, tb, require('../kern/zeit.js'), require('../kern/einstellungen.js'), require('../kern/bausteine.js'), require('../kern/abgleich.js'),
  require('../kern/freigabe.js'), sp, hs, require('../kern/leitplanken.js'), require('../kern/meldung.js'));
const SIG = 'Ihr Team der Zimmerei & Dachbau Beispiel GmbH';
const E = { modus: 'test', quelle: 'test', betrieb: 'Zimmerei & Dachbau Beispiel GmbH', signatur: SIG, kontaktweg: 'Rufen Sie uns gern an: 0000 000000',
  domain: 'zimmerei-beispiel.example', bewertungen_ab: '2026-09-01', hoechstzahl_veroeffentlichungen: 10, hoechstzahl_entwuerfe: 20, hoechstlaenge: 800,
  loeschfrist: 30, stichtag_test: '', verboten: '' };
const BW = tb.BW_SPALTEN;
const zeile = (o) => BW.map((s) => (o[s] === undefined ? '' : o[s]));
const ST = '2026-09-20T08:00:00Z';
const GUT = 'Guten Tag,\n\nvielen Dank für Ihre Bewertung.\n\n' + SIG;
const WEICH = 'Guten Tag,\n\nvielen Dank für Ihre Bewertung. Wir melden uns gern bei Ihnen.\n\n' + SIG;
const Q = (id, abw) => Object.assign({ art: 'bewertung', bewertung_id: id, sterne: 5, text: 'Gut gemacht.', erstellt_utc: ST, geaendert_utc: ST, anonym: false,
  anzeigename: 'Bewerter Probe 01', antwort_vorhanden: false, antwort_text: '', antwort_geaendert_utc: '', antwort_status: '', antwort_verstoss: '', hinweise: [],
  mangel: [] }, abw || {});
const quelle = (bw) => ({ status: { art: 'status', status: 'ok', anzahl: bw.length, vollstaendig: true, seiten: 1, meldungen: [] }, bewertungen: bw });
const LAUF = { id: '7400', zeit_utc: '2026-09-28T12:00:05Z', zeit_berlin: '28.09.2026 14:00:05', start: '2026-09-28T12:00:05Z' };
const Z = (id, abw) => zeile(Object.assign({ 'Bewertungs-ID': id, Eingang: '20.09.2026 10:00:00', 'Stand (UTC)': ST, Sterne: 5, Bewertungstext: 'Gut gemacht.',
  Kategorie: 'positiv', Entwurf: GUT, Antwort: GUT, Status: 'Entwurf bereit' }, abw || {}));
const DT = (id, schluessel, aktion, lauf, zeit, hash, grund) => ({ id, schluessel, aktion, lauf_id: lauf, bewertung_id: schluessel.split('|')[1], text_hash: hash || '',
  zeit_utc: zeit, grund: grund || '' });
const plan = (zeilen, bw, sperr) => hp.entwurfPlan({ zeilen, quelle: quelle(bw), sperrzeilen: sperr || [], seit_utc: '2026-08-31T22:00:00Z', einstellungen: E, bausteine: {} }, K);
const blatt = (werte, bw, sperr, modus) => {
  const zeilen = tb.leseBewertungen([BW].concat(werte)).zeilen;
  const items = {}; bw.forEach((b) => { items[b.bewertung_id] = b; });
  return hp.blattPlan({ modus: modus || 'test', lauf: LAUF, einstellungen: E, zeilen, items, plan: plan(zeilen, bw, sperr), ergebnisse: [], sperrzeilen: sperr || [],
    loesch: { data: [], eintraege: [] } }, K);
};
const zelle = (b, sp_, z) => { const d = b.data.data.find((x) => x.range === "'Bewertungen'!" + sp_ + z); return d ? d.values[0][0] : undefined; };
const wirft = (f) => { let t = null; try { f(); } catch (e) { t = e.message; } return t; };

test('Modus test (Baustein 8): trocken und test mit Quelle test laufen; test mit anderer Quelle, scharf und leer werfen ohne „: “', () => {
  assert.doesNotThrow(() => hp.pruefeLaufModus({ modus: 'trocken', quelle: 'google' }));
  assert.doesNotThrow(() => hp.pruefeLaufModus({ modus: 'test', quelle: 'test' }));
  for (const e of [{ modus: 'test', quelle: 'google' }, { modus: 'scharf', quelle: 'test' }, { modus: '', quelle: 'test' }]) {
    const t = wirft(() => hp.pruefeLaufModus(e));
    assert.ok(t && /^Hauptlauf/.test(t) && t.indexOf(': ') < 0, JSON.stringify(e) + ' ' + t);
  }
});

test('Blattplan test: gültige Freigaben → Liste „veroeffentlichen“ (kein „wäre veröffentlicht“, kein Protokoll im Plan); trocken → leer, dafür „wäre“', () => {
  const werte = [Z('R-1', { Freigabe: 'freigeben' }), Z('R-2', { Antwort: WEICH, Freigabe: 'freigeben trotz Hinweis' }), Z('R-3', { Antwort: WEICH, Freigabe: 'freigeben' }),
    Z('R-4', { Freigabe: 'ja' })];
  const bw = ['R-1', 'R-2', 'R-3', 'R-4'].map((id) => Q(id));
  const b = blatt(werte, bw);
  assert.deepEqual(b.veroeffentlichen.map((d) => [d.bewertung_id, d.zeile, d.schluessel, d.schreiben, d.sterne, d.kategorie]),
    [['R-1', 2, 'antwort|R-1|' + ST, true, 5, 'positiv'], ['R-2', 3, 'antwort|R-2|' + ST, true, 5, 'positiv']]);
  assert.deepEqual([b.meldung.wuerde.length, b.zaehler.wuerde], [0, 0]);
  assert.ok(!b.protokoll.some((p) => p[5] === 'wuerde_veroeffentlichen'));
  assert.ok(/„freigeben trotz Hinweis“ nötig/.test(zelle(b, 'G', 4)) && /^Freigabe ungültig/.test(zelle(b, 'G', 5)));
  assert.deepEqual(b.dt, []);
  const t = blatt(werte, bw, [], 'trocken');
  assert.deepEqual([t.veroeffentlichen.length, t.meldung.wuerde.map((w) => w.zeile)], [0, [2, 3]]);
});

test('Blattplan test: Freigabe mit „veroeffentlicht“ oder „unklar“ in der Data Table → nie erneut (S20)', () => {
  const k1 = 'antwort|R-1|' + ST;
  const b = blatt([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')], [DT(1, k1, 'reserviert', '7390', '2026-09-28T06:00:00Z'), DT(2, k1, 'unklar', '7390', '2026-09-28T06:00:09Z')]);
  assert.deepEqual(b.veroeffentlichen, []);
});

test('S21 abgebrochener Lauf: Reservierung ohne Antwort in der Quelle → „unklar“ in die Data Table, Status „Versandstatus unklar“, Freigabe leer, Alarm; mit Antwort gleichen Hashs → nachgezogen', () => {
  const kx = 'antwort|R-7|' + ST, ky = 'antwort|R-8|' + ST;
  const sperr = [DT(1, kx, 'reserviert', '7390', '2026-09-28T11:59:00Z', hs.textHash(GUT)), DT(2, ky, 'reserviert', '7390', '2026-09-28T11:59:01Z', hs.textHash(GUT))];
  const bw = [Q('R-7', { antwort_vorhanden: true, antwort_text: GUT, antwort_geaendert_utc: '2026-09-28T11:59:03Z', antwort_status: 'APPROVED' }), Q('R-8')];
  const b = blatt([Z('R-7'), Z('R-8', { Freigabe: 'freigeben' })], bw, sperr);
  assert.deepEqual(b.dt.map((r) => [r.schluessel, r.aktion, r.lauf_id, r.text_hash === hs.textHash(GUT)]),
    [[kx, 'veroeffentlicht', '7400', true], [ky, 'unklar', '7400', true]]);
  assert.deepEqual([zelle(b, 'K', 2), zelle(b, 'L', 2)], ['veröffentlicht', '28.09.2026 13:59:03']);
  assert.deepEqual([zelle(b, 'K', 3), zelle(b, 'J', 3)], ['Versandstatus unklar', '']);
  assert.ok(/Versandstatus klären/.test(zelle(b, 'G', 3)));
  assert.equal(b.meldung.alarme.filter((a) => /Zeile 3/.test(a) && /abgebrochen/.test(a)).length, 1);
  assert.deepEqual(b.veroeffentlichen, []);
  assert.deepEqual(b.protokoll.filter((p) => ['nachgezogen', 'unklar'].includes(p[5])).map((p) => [p[4], p[5]]), [['R-7', 'nachgezogen'], ['R-8', 'unklar']]);
  assert.deepEqual(b.meldung.veroeffentlicht.map((e) => e.zeile), [2]);
});

test('S21 Versandstatus klären: veröffentlicht (Quelle zeigt die Antwort) → nachgezogen; nicht veröffentlicht → zurückgegeben, „Entwurf bereit“, Zelle leer; ohne offene Reservierung → Hinweis, Zelle bleibt', () => {
  const ky = 'antwort|R-8|' + ST, kw = 'antwort|R-9|' + ST;
  const h = hs.textHash(GUT);
  const sperr = [DT(1, ky, 'reserviert', '7390', '2026-09-28T11:00:00Z', h), DT(2, ky, 'unklar', '7395', '2026-09-28T11:30:00Z', h, 'abgebrochener Lauf'),
    DT(3, kw, 'reserviert', '7390', '2026-09-28T11:00:01Z', h), DT(4, kw, 'unklar', '7395', '2026-09-28T11:30:00Z', h, 'abgebrochener Lauf')];
  const bw = [Q('R-8', { antwort_vorhanden: true, antwort_text: GUT, antwort_geaendert_utc: '2026-09-28T11:40:00Z', antwort_status: 'APPROVED' }), Q('R-9'), Q('R-10')];
  const werte = [Z('R-8', { Status: 'Versandstatus unklar', 'Versandstatus klären': 'veröffentlicht' }),
    Z('R-9', { Status: 'Versandstatus unklar', 'Versandstatus klären': 'nicht veröffentlicht' }), Z('R-10', { 'Versandstatus klären': 'veröffentlicht' })];
  const b = blatt(werte, bw, sperr);
  assert.deepEqual(b.dt.map((r) => [r.schluessel, r.aktion]), [[ky, 'veroeffentlicht'], [kw, 'zurueckgegeben']]);
  assert.deepEqual([zelle(b, 'K', 2), zelle(b, 'M', 2)], ['veröffentlicht', '']);
  assert.deepEqual([zelle(b, 'K', 3), zelle(b, 'M', 3), zelle(b, 'J', 3)], ['Entwurf bereit', '', '']);
  assert.ok(/nicht veröffentlicht/.test(zelle(b, 'G', 3)));
  assert.deepEqual([zelle(b, 'M', 4), zelle(b, 'K', 4)], [undefined, undefined]);
  assert.ok(/ohne offene Reservierung/.test(zelle(b, 'G', 4)));
  assert.deepEqual(b.meldung.alarme, []);
});

// ---------------------------------------------------------------- je Antwort: Schritt 1-7
const CTX = { modus: 'test', einstellungen: E, lauf: { id: LAUF.id, start: LAUF.start } };
const geplant = (werte, bw) => blatt(werte, bw).veroeffentlichen[0];
const neu = (werte, g, it, abw) => hp.freigabeNeuLesen(Object.assign({ http: 200, werte: [BW].concat(werte), geplant: g, item: it, ctx: CTX }, abw || {}), K);

test('Schritt 1-2: Zeile und Freigabe neu lesen, Leitplanken am endgültigen Text (E37) → gleich der Planung veröffentlichen; Antwort, Freigabe, Stand geändert → nichts mit Hinweis', () => {
  const w = [Z('R-1', { Freigabe: 'freigeben' })];
  const g = geplant(w, [Q('R-1')]);
  const ok = neu(w, g, Q('R-1'));
  assert.deepEqual([ok.aktion, ok.zeile_jetzt, ok.text, ok.text_hash], ['veroeffentlichen', 2, GUT, hs.textHash(GUT)]);
  assert.equal(neu([Z('R-0'), Z('R-1', { Freigabe: 'freigeben' })], g, Q('R-1')).zeile_jetzt, 3, 'Zeile über die ID, nicht über die Nummer');
  const geaendert = neu([Z('R-1', { Freigabe: 'freigeben', Antwort: GUT + ' Bis bald.' })], g, Q('R-1'));
  assert.deepEqual([geaendert.aktion, geaendert.hinweise], ['nichts', ['Antwort seit der Planung geändert – nicht veröffentlicht']]);
  const hart = neu([Z('R-1', { Freigabe: 'freigeben', Antwort: GUT.replace('Bewertung.', 'Bewertung. Rufen Sie 0000 222222 an.') })], g, Q('R-1'));
  assert.deepEqual([hart.aktion, hart.felder.Status], ['nichts', 'blockiert']);
  assert.deepEqual(neu([Z('R-1', { Freigabe: '' })], g, Q('R-1')).aktion, 'nichts');
  assert.deepEqual(neu([Z('R-1', { Freigabe: 'freigeben', 'Stand (UTC)': '2026-09-21T08:00:00Z' })], g, Q('R-1', { geaendert_utc: '2026-09-21T08:00:00Z' })).hinweise,
    ['Stand seit der Planung geändert – nicht veröffentlicht']);
  const weg = neu([Z('R-0')], g, Q('R-1'));
  assert.deepEqual([weg.aktion, weg.hinweise], ['nichts', ['Zeile nicht mehr eindeutig – nicht veröffentlicht']]);
  assert.match(wirft(() => neu(w, g, Q('R-1'), { http: 403 })), /^Hauptlauf – Zeile neu lesen abgelehnt, HTTP 403/);
});

test('Schritt 3 Reservierung (S20): Zeile ohne Text; früheste gewinnt, der andere Lauf überspringt; „veroeffentlicht“ gewinnt; eigene nicht zurückgelesen → Wurf', () => {
  const g = geplant([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')]);
  const r = hp.reservierungsZeile(g, { id: '7400', zeit: '2026-09-28T12:00:10.000Z' }, K);
  assert.deepEqual(r, { schluessel: 'antwort|R-1|' + ST, aktion: 'reserviert', lauf_id: '7400', bewertung_id: 'R-1', text_hash: hs.textHash(GUT),
    zeit_utc: '2026-09-28T12:00:10.000Z', grund: '' });
  const L = { id: '7400', start: LAUF.start };
  const eigen = DT(5, g.schluessel, 'reserviert', '7400', '2026-09-28T12:00:10.000Z');
  assert.deepEqual(hp.sperreNachReservierung([eigen], g, L, K), { schreiben: true, grund: '' });
  const frueher = DT(4, g.schluessel, 'reserviert', '7401', '2026-09-28T12:00:09.000Z');
  assert.deepEqual(hp.sperreNachReservierung([frueher, eigen], g, L, K), { schreiben: false, grund: 'übersprungen, anderer Lauf' });
  assert.deepEqual(hp.sperreNachReservierung([frueher, DT(4.5, g.schluessel, 'veroeffentlicht', '7401', '2026-09-28T12:00:12.000Z'), eigen], g, L, K).grund, 'schon veroeffentlicht');
  assert.match(wirft(() => hp.sperreNachReservierung([frueher], g, L, K)), /^Hauptlauf – Reservierung nicht zurückgelesen/);
});

const nach = (s, abw) => hp.nachbereiten(Object.assign({ lauf: { id: '7400', zeit_utc: '2026-09-28T12:00:20Z', zeit_berlin: '28.09.2026 14:00:20' }, modus: 'test',
  d: Object.assign(geplant([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')]), { aktion: 'veroeffentlichen', zeile_jetzt: 2, hinweise_alt: '' }),
  sperre: { schreiben: true, grund: '' }, ergebnis: s, unterlauf_fehler: null }, abw || {}), K);
const felder = (r) => { const o = {}; r.data.forEach((d) => { o[BW[d.range.charCodeAt(14) - 65]] = d.values[0][0]; }); return o; };

test('Schritt 7: veröffentlicht → Data Table „veroeffentlicht“ mit Hash, Status je Moderation, veröffentlicht am, Freigabe leer, Protokoll ohne Text', () => {
  const s = (z, v) => ({ art: 'status', status: 'veroeffentlicht', grund: '', geschrieben: true, antwort_status: z, antwort_geaendert_utc: '2026-09-28T12:00:15.000Z', antwort_verstoss: v || '' });
  const a = nach(s('APPROVED'));
  assert.deepEqual([a.dt.aktion, a.dt.text_hash, a.dt.lauf_id], ['veroeffentlicht', hs.textHash(GUT), '7400']);
  assert.deepEqual(felder(a), { Status: 'veröffentlicht', 'veröffentlicht am': '28.09.2026 14:00:15', Freigabe: '' });
  assert.deepEqual([a.meldung.liste, a.meldung.eintrag.zeile, a.alarm], ['veroeffentlicht', 2, '']);
  assert.deepEqual(a.protokoll.slice(2), ['7400', 'test', 'R-1', 'veroeffentlicht', 'APPROVED', hs.textHash(GUT)]);
  assert.ok(!JSON.stringify(a).includes('Guten Tag'));
  assert.deepEqual([felder(nach(s('PENDING'))).Status, nach(s('PENDING')).meldung.liste], ['wartet auf Google', 'wartet']);
  const r = nach(s('REJECTED', 'PERSONAL_INFO'));
  assert.deepEqual([felder(r).Status, r.meldung.liste, r.meldung.eintrag.verstoss, r.dt.aktion], ['von Google abgelehnt', 'abgelehnt', 'PERSONAL_INFO', 'veroeffentlicht']);
  assert.ok(/PERSONAL_INFO/.test(felder(r).Hinweise));
});

test('Schritt 7: Vorbedingung verletzt → „zurueckgegeben“, Zeile je Grund; Fehler nach dem Schreibaufruf → „unklar“, Versandstatus unklar, Alarm; ohne Schreibaufruf → zurückgegeben, Alarm, Freigabe bleibt', () => {
  const v = (grund) => nach({ art: 'status', status: 'vorbedingung_verletzt', grund, geschrieben: false, antwort_status: '', antwort_geaendert_utc: '', antwort_verstoss: '' });
  assert.deepEqual([v('geloescht').dt.aktion, felder(v('geloescht')).Status, felder(v('geloescht')).Freigabe], ['zurueckgegeben', 'Bewertung gelöscht', '']);
  assert.deepEqual([felder(v('schon_beantwortet')).Status, felder(v('text_ungueltig')).Status], ['schon beantwortet', 'blockiert']);
  assert.deepEqual([felder(v('geaendert')).Freigabe, felder(v('geaendert')).Status], ['', undefined]);
  const u = nach({ art: 'status', status: 'fehler', grund: 'Nachlesen HTTP 500', geschrieben: true, antwort_status: '', antwort_geaendert_utc: '', antwort_verstoss: '' });
  assert.deepEqual([u.dt.aktion, felder(u).Status, felder(u).Freigabe], ['unklar', 'Versandstatus unklar', '']);
  assert.ok(/Zeile 2/.test(u.alarm) && /Versandstatus klären/.test(u.alarm));
  const z = nach({ art: 'status', status: 'fehler', grund: 'Tabelle nicht lesbar, HTTP 404', geschrieben: false, antwort_status: '', antwort_geaendert_utc: '', antwort_verstoss: '' });
  assert.deepEqual([z.dt.aktion, felder(z).Freigabe, felder(z).Status], ['zurueckgegeben', undefined, undefined]);
  assert.ok(/nichts geschrieben/.test(z.alarm));
  assert.match(wirft(() => nach({ art: 'status', status: 'wuerde_veroeffentlichen', geschrieben: false })), /^Hauptlauf – /);
});

test('Schritt 7: abgefangener Fehler im Unterlauf → „unklar“ (vielleicht geschrieben), kein zweiter Alarm in der Sammelmeldung (S19, der Unterlauf meldet selbst)', () => {
  const u = nach(null, { unterlauf_fehler: 'Antwort veröffentlichen – genau ein Eingang erwartet, gekommen 0 [line 3]' });
  assert.deepEqual([u.dt.aktion, felder(u).Status, u.alarm], ['unklar', 'Versandstatus unklar', '']);
  assert.ok(/Versandstatus klären/.test(u.meldung.eintrag.aufgabe) && /Unterlauf/.test(u.meldung.eintrag.aufgabe));
});

test('Befund 6 (E48): Zieladapter startet nicht → „unklar“, genau ein Alarm vom Hauptlauf, Sammelmeldung „Alarm gesendet“, nie „dort gemeldet“', () => {
  const leer = { eintraege: [], veroeffentlicht: [], wartet: [], abgelehnt: [], geloescht: [], frist_abgelaufen: [], alarme: [], wuerde: [], hinweise: [] };
  const meldung = (r) => K.baueSammelmeldung(Object.assign({}, hp.fuegeVeroeffentlichungEin(leer, [r]), { modus: 'test', betrieb: E.betrieb, lauf_id: '7400', zeit: 'jetzt', link: 'L' }));
  // gemessen Baustein 9, Lauf 7599/7600 (Zieladapter nicht veröffentlicht); dazu nicht gefunden und ohne Meldung (F_NACH_JS)
  for (const f of ['Workflow is not active and cannot be executed.', 'Workflow does not exist.', 'ohne Meldung']) {
    const u = nach(null, { unterlauf_fehler: f });
    assert.deepEqual([u.dt.aktion, felder(u).Status, felder(u).Freigabe], ['unklar', 'Versandstatus unklar', ''], f);
    assert.ok(/Zeile 2/.test(u.alarm) && /nicht gestartet/.test(u.alarm) && /Versandstatus klären/.test(u.alarm), f + ' | ' + u.alarm);
    assert.ok(/Alarm gesendet/.test(u.meldung.eintrag.aufgabe) && !/dort gemeldet/.test(u.meldung.eintrag.aufgabe), u.meldung.eintrag.aufgabe);
    const m = meldung(u);
    assert.ok(m.betreff.startsWith('ALARM – '), m.betreff);
    assert.equal((m.text.split('\n\n').find((a) => a.startsWith('ALARM\n')) || '').split('\n').filter((z) => z.startsWith('- ')).length, 1, 'genau eine Alarmzeile');
    assert.equal((m.text.match(/Veröffentlichung nicht bestätigt – Zeile 2/g) || []).length, 1, 'genau ein Alarm');
    assert.ok(!/dort gemeldet/.test(m.text) && /Alarm gesendet/.test(m.text));
  }
  // Kontrolle: der Zieladapter lief und meldet selbst (eigene Meldung bzw. Code-Fehler mit Zeile) → kein zweiter Alarm (S19)
  for (const f of ['Antwort veröffentlichen – Eingang ohne bewertung_id [line 38]', "Cannot read properties of undefined (reading 'x') [line 12]"]) {
    const u = nach(null, { unterlauf_fehler: f });
    assert.deepEqual([u.dt.aktion, u.alarm], ['unklar', ''], f);
    assert.ok(/dort gemeldet/.test(u.meldung.eintrag.aufgabe));
    assert.ok(!meldung(u).betreff.startsWith('ALARM'));
  }
});

test('Ohne Veröffentlichung: Entscheidung nichts → Zellen und Hinweis, keine Data Table; Sperre übersprungen → nur Protokoll und Hinweis', () => {
  const d = Object.assign(geplant([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')]), { aktion: 'nichts', felder: { Status: 'blockiert' }, hinweise: ['hart: Telefon'],
    zeile_jetzt: 2, hinweise_alt: 'weich: Termin' });
  const a = nach(null, { d, sperre: null });
  assert.deepEqual([a.dt, felder(a).Status, felder(a).Hinweise], [null, 'blockiert', 'weich: Termin; Freigabe: hart: Telefon']);
  assert.deepEqual(a.protokoll.slice(4, 7), ['R-1', 'freigabe', 'blockiert']);
  const s = nach(null, { sperre: { schreiben: false, grund: 'übersprungen, anderer Lauf' } });
  assert.deepEqual([s.dt, s.data, s.protokoll[5], s.protokoll[6]], [null, [], 'uebersprungen', 'übersprungen, anderer Lauf']);
  assert.ok(/Zeile 2/.test(s.hinweis));
});

test('Sammelmeldung: Ergebnisse je Antwort in veröffentlicht, wartet, abgelehnt, Zu tun, Alarm und Hinweise - ohne Text', () => {
  const m = { eintraege: [], veroeffentlicht: [], wartet: [], abgelehnt: [], geloescht: [], frist_abgelaufen: [], alarme: [], wuerde: [], hinweise: [] };
  const e = [{ meldung: { liste: 'veroeffentlicht', eintrag: { zeile: 2, sterne: 5, kategorie: 'positiv', status: 'veröffentlicht' } }, alarm: '', hinweis: '' },
    { meldung: { liste: 'abgelehnt', eintrag: { zeile: 3, sterne: 4, verstoss: 'PERSONAL_INFO' } }, alarm: '', hinweis: '' },
    { meldung: null, alarm: 'Veröffentlichung nicht bestätigt', hinweis: '' }, { meldung: null, alarm: '', hinweis: 'Zeile 5 übersprungen' }];
  const r = hp.fuegeVeroeffentlichungEin(m, e);
  assert.deepEqual([r.veroeffentlicht.length, r.abgelehnt[0].verstoss, r.alarme, r.hinweise], [1, 'PERSONAL_INFO', ['Veröffentlichung nicht bestätigt'], ['Zeile 5 übersprungen']]);
  const text = K.baueSammelmeldung(Object.assign({}, r, { modus: 'test', betrieb: E.betrieb, lauf_id: '7400', zeit: 'jetzt', link: 'L' }));
  assert.ok(/Veröffentlicht\n- Zeile 2/.test(text.text) && /PERSONAL_INFO/.test(text.text) && /^ALARM – Bewertungsantworten/.test(text.betreff));
});

test('trocken liest keine Data Table (E10): Zeilen der Data Table werden ignoriert - „wäre veröffentlicht“, keine Einträge; Kontrolle test → nie erneut', () => {
  const k1 = 'antwort|R-1|' + ST;
  const sperr = [DT(1, k1, 'reserviert', '7390', '2026-09-28T06:00:00Z'), DT(2, k1, 'veroeffentlicht', '7390', '2026-09-28T06:00:09Z')];
  const t = blatt([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')], sperr, 'trocken');
  assert.deepEqual([t.meldung.wuerde.map((w) => w.zeile), t.dt], [[2], []]);
  assert.deepEqual(blatt([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')], sperr, 'test').veroeffentlichen, []);
});

test('Ein Schlüssel, den die Data Table in diesem Lauf erledigt (nachgezogen, unklar, geklärt), plant keine Freigabe mehr - kein zweiter Hinweis', () => {
  const kx = 'antwort|R-7|' + ST, ky = 'antwort|R-8|' + ST;
  const sperr = [DT(1, kx, 'reserviert', '7390', '2026-09-28T11:59:00Z', hs.textHash(GUT)), DT(2, ky, 'reserviert', '7390', '2026-09-28T11:59:01Z', hs.textHash(GUT))];
  const bw = [Q('R-7', { antwort_vorhanden: true, antwort_text: GUT, antwort_geaendert_utc: '2026-09-28T11:59:03Z', antwort_status: 'APPROVED' }), Q('R-8'), Q('R-9')];
  const b = blatt([Z('R-7', { Freigabe: 'freigeben' }), Z('R-8', { Freigabe: 'freigeben' }), Z('R-9', { Freigabe: 'ja' })], bw, sperr);
  assert.deepEqual(b.protokoll.filter((p) => p[5] === 'freigabe').map((p) => p[4]), ['R-9']);
  assert.ok(!/schon beantwortet|Reservierung eines abgebrochenen/.test(String(zelle(b, 'G', 2)) + String(zelle(b, 'G', 3))));
  assert.deepEqual(b.meldung.eintraege.map((x) => x.zeile), [4]);
});

test('Freigabe seit der Planung entfallen (anderer Lauf war schneller) → kein leerer „Zu tun“-Eintrag, nur Hinweis und Protokoll', () => {
  const d = Object.assign(geplant([Z('R-1', { Freigabe: 'freigeben' })], [Q('R-1')]), { aktion: 'nichts', felder: {}, hinweise: [], zeile_jetzt: 2, hinweise_alt: '' });
  const a = nach(null, { d, sperre: null });
  assert.deepEqual([a.dt, a.data, a.meldung, a.protokoll[5], a.protokoll[6]], [null, [], null, 'freigabe', 'Freigabe seit der Planung entfallen']);
  assert.ok(/Zeile 2/.test(a.hinweis) && /entfallen/.test(a.hinweis));
});
