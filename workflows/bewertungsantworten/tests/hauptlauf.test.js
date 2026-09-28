'use strict';
// hauptlauf.js: Hauptlauf im Modus trocken (BAUPLAN c; E2, E7, E10, E13; Baustein 6) - Modus, Stichtag, Aufbau fail-closed,
// Loeschfrist als eigener Schritt, Entwurfsplan mit Mengenbremse vor dem Aufruf, Blattplan (neue Zeilen, Aenderungen, Freigaben
// ohne Veroeffentlichen), Protokoll und Sammelmeldung ohne Text. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const hp = require('../kern/hauptlauf.js');
const tb = require('../kern/tabelle.js');
const zt = require('../kern/zeit.js');
const ei = require('../kern/einstellungen.js');
const bs = require('../kern/bausteine.js');

const K = Object.assign({}, tb, zt, ei, bs, require('../kern/abgleich.js'), require('../kern/freigabe.js'), require('../kern/sperre.js'), require('../kern/hash.js'),
  require('../kern/leitplanken.js'));
const SIG = 'Ihr Team der Zimmerei & Dachbau Beispiel GmbH';
const E = { modus: 'trocken', quelle: 'test', betrieb: 'Zimmerei & Dachbau Beispiel GmbH', signatur: SIG, kontaktweg: 'Rufen Sie uns gern an: 0000 000000',
  domain: 'zimmerei-beispiel.example', bewertungen_ab: '2026-09-01', hoechstzahl_veroeffentlichungen: 10, hoechstzahl_entwuerfe: 20, hoechstlaenge: 800,
  loeschfrist: 30, stichtag_test: '', verboten: '' };
const BW = tb.BW_SPALTEN;
const zeile = (o) => BW.map((s) => (o[s] === undefined ? '' : o[s]));
const Q = (id, abw) => Object.assign({ art: 'bewertung', bewertung_id: id, sterne: 5, text: 'Gut gemacht.', erstellt_utc: '2026-09-20T08:00:00Z',
  geaendert_utc: '2026-09-20T08:00:00Z', anonym: false, anzeigename: 'Bewerter Probe 01', antwort_vorhanden: false, antwort_text: '', antwort_geaendert_utc: '',
  antwort_status: '', antwort_verstoss: '', hinweise: [], mangel: [] }, abw || {});
const quelle = (bw) => ({ status: { art: 'status', status: 'ok', anzahl: bw.length, vollstaendig: true, seiten: 1, meldungen: [] }, bewertungen: bw });
const LAUF = { id: '7300', zeit_utc: '2026-09-28T06:00:05Z', zeit_berlin: '28.09.2026 08:00:05', start: '2026-09-28T06:00:00Z' };
const GUT = 'Guten Tag,\n\nvielen Dank für Ihre Bewertung! Über Ihre Rückmeldung freuen wir uns.\n\n' + SIG;
const ERG = (nr, abw) => Object.assign({ art: 'entwurf', nr, status: 'ok', grund: '', ki_aufruf: true, kategorie: 'positiv', sicher: true, gruende: [],
  entwurf: GUT, antwort: GUT, hinweise: [], aufgaben: [], gekuerzt: false, http_status: 200, stop_reason: 'end_turn', tokens_ein: 1300, tokens_aus: 90 }, abw || {});

test('Modus: trocken läuft; scharf und leer werfen ohne „: “ (test seit Baustein 8: hauptlauf-b8.test.js)', () => {
  assert.doesNotThrow(() => hp.pruefeLaufModus({ modus: 'trocken' }));
  for (const m of ['scharf', '']) {
    let t = null;
    try { hp.pruefeLaufModus({ modus: m }); } catch (e) { t = e.message; }
    assert.ok(t && /Hauptlauf/.test(t) && t.indexOf(': ') < 0, m + ' ' + t);
  }
});

test('Stichtag (nur Test): trocken → „jetzt“ auf den Stichtag verschoben (gleiche Uhrzeit Berlin); scharf ignoriert mit Hinweis; leer → jetzt', () => {
  assert.deepEqual(hp.laufJetzt('trocken', '2026-10-30', '2026-09-28T06:00:05.123Z', K),
    { jetzt_utc: '2026-10-30T07:00:00Z', heute: '2026-10-30', hinweis: 'Stichtag 2026-10-30 (nur Test) statt 2026-09-28' });
  assert.deepEqual(hp.laufJetzt('trocken', '', '2026-09-28T06:00:05Z', K), { jetzt_utc: '2026-09-28T06:00:05Z', heute: '2026-09-28', hinweis: '' });
  assert.deepEqual(hp.laufJetzt('trocken', '2026-09-28', '2026-09-28T06:00:05Z', K).jetzt_utc, '2026-09-28T06:00:05Z');
  const s = hp.laufJetzt('scharf', '2026-10-30', '2026-09-28T06:00:05Z', K);
  assert.deepEqual([s.jetzt_utc, s.heute, s.hinweis], ['2026-09-28T06:00:05Z', '2026-09-28', 'Stichtag im Modus scharf ignoriert']);
});

const WERTE = () => ({ Einstellungen: [ei.EI_SPALTEN, ['Modus', 'trocken']], Bewertungen: [BW], Protokoll: [tb.PR_SPALTEN],
  Textbausteine: [bs.TB_SPALTEN].concat(bs.TB_ARTEN.map((a) => [a, 'Guten Tag,\n\ndanke.\n\n{signatur}'])) });
const BLAETTER = ['Bewertungen', 'Einstellungen', 'Textbausteine', 'Protokoll', 'Testquelle'];

test('Aufbau fail-closed: alle Blätter und Kopfzeilen exakt → ok; Blatt fehlt, Kopfzeile umbenannt, Textbaustein doppelt → Fehler mit Namen', () => {
  assert.deepEqual(hp.pruefeAufbau({ blaetter: BLAETTER, werte: WERTE() }, K), { ok: true, fehler: [] });
  assert.deepEqual(hp.pruefeAufbau({ blaetter: BLAETTER.filter((b) => b !== 'Protokoll'), werte: WERTE() }, K), { ok: false, fehler: ['Blatt Protokoll fehlt'] });
  const f = (aendern) => { const w = WERTE(); aendern(w); return hp.pruefeAufbau({ blaetter: BLAETTER, werte: w }, K); };
  assert.deepEqual(f((w) => { w.Bewertungen[0] = BW.map((s) => (s === 'Freigabe' ? 'Freigabe Betrieb' : s)); }).fehler, ['Kopfzeile Bewertungen weicht ab']);
  assert.deepEqual(f((w) => { w.Einstellungen[0] = ['Schlüssel', 'Wert']; }).fehler, ['Kopfzeile Einstellungen weicht ab']);
  assert.deepEqual(f((w) => { w.Protokoll[0] = tb.PR_SPALTEN.slice(0, 7); }).fehler, ['Kopfzeile Protokoll weicht ab']);
  assert.deepEqual(f((w) => { w.Textbausteine.push(['unfair', 'noch einmal']); }).fehler, ['Textbaustein „unfair“ doppelt']);
});

test('Löschfrist (E7) eigener Schritt: Zeilen mit Text, deren Frist vor dem nächsten Planlauf abläuft → Texte leer, „Frist abgelaufen“; veröffentlicht bleibt', () => {
  const zeilen = tb.leseBewertungen([BW,
    zeile({ 'Bewertungs-ID': 'R-1', 'Stand (UTC)': '2026-08-25T08:00:00Z', Sterne: 5, Bewertungstext: 'alt', Entwurf: 'E', Antwort: 'A', Status: 'Entwurf bereit' }),
    zeile({ 'Bewertungs-ID': 'R-2', 'Stand (UTC)': '2026-08-25T08:00:00Z', Sterne: 4, Bewertungstext: 'alt', Status: 'veröffentlicht' }),
    zeile({ 'Bewertungs-ID': 'R-3', 'Stand (UTC)': '2026-09-20T08:00:00Z', Sterne: 3, Bewertungstext: 'neu', Status: 'Entwurf bereit' }),
    zeile({ 'Bewertungs-ID': 'R-4', 'Stand (UTC)': '2026-08-25T08:00:00Z', Sterne: 2, Status: 'Frist abgelaufen' })]).zeilen;
  const l = hp.loeschSchritt(zeilen, 30, '2026-09-28T06:00:05Z', K);
  assert.deepEqual(l.eintraege, [{ zeile: 2, bewertung_id: 'R-1', sterne: 5, status: 'Frist abgelaufen' }, { zeile: 3, bewertung_id: 'R-2', sterne: 4, status: 'veröffentlicht' }]);
  assert.ok(l.data.some((d) => d.range === "'Bewertungen'!E2" && d.values[0][0] === ''));
  assert.ok(l.data.some((d) => d.range === "'Bewertungen'!K2" && d.values[0][0] === 'Frist abgelaufen'));
  assert.ok(!l.data.some((d) => /!\w4$/.test(d.range) || /!\w+4$/.test(d.range)));
});

test('Entwurfsplan: Mengenbremse VOR dem Aufruf (älteste zuerst, Rest mit Hinweis); Eingang ohne ID; Mangel ohne Entwurf; Quelle nicht ok → nichts, Alarm', () => {
  const bw = [Q('R-3', { erstellt_utc: '2026-09-22T08:00:00Z' }), Q('R-1', { erstellt_utc: '2026-09-20T08:00:00Z' }), Q('R-2', { erstellt_utc: '2026-09-21T08:00:00Z' }),
    Q('R-9', { mangel: ['comment unlesbar (#ERROR!)'] })];
  const p = hp.entwurfPlan({ zeilen: [], quelle: quelle(bw), seit_utc: '2026-08-31T22:00:00Z', einstellungen: Object.assign({}, E, { hoechstzahl_entwuerfe: 2 }),
    bausteine: { x: 1 } }, K);
  assert.deepEqual(p.ziele.map((z) => [z.bewertung_id, z.grund]), [['R-1', 'neu'], ['R-2', 'neu']]);
  assert.equal(p.eingang.bewertungen.length, 2);
  assert.ok(!JSON.stringify(p.eingang).includes('R-1') && !JSON.stringify(p.eingang).includes('bewertung_id'));
  assert.deepEqual([p.spaeter, p.hinweis], [1, '1 Entwurf im nächsten Lauf (Höchstzahl 2)']);
  assert.deepEqual(Object.keys(p.eingang.einstellungen).sort(), ['betrieb', 'domain', 'hoechstlaenge', 'hoechstzahl_entwuerfe', 'kontaktweg', 'signatur', 'verboten']);
  assert.deepEqual(p.abgleich.neu_ohne_entwurf.map((x) => x.bewertung.bewertung_id), ['R-9']);
  const n = hp.entwurfPlan({ zeilen: [], quelle: { status: { status: 'aufbau_falsch' }, bewertungen: [] }, seit_utc: '', einstellungen: E, bausteine: {} }, K);
  assert.deepEqual([n.ziele.length, n.abgleich.alarme], [0, ['Quelle nicht ok: aufbau_falsch']]);
});

const ZEILEN_ALT = () => tb.leseBewertungen([BW,
  zeile({ 'Bewertungs-ID': 'R-5', Eingang: '20.09.2026 10:00:00', 'Stand (UTC)': '2026-09-20T08:00:00Z', Sterne: 5, Bewertungstext: 'Gut gemacht, R-5.', Kategorie: 'ohne Text',
    Entwurf: GUT, Antwort: GUT, Freigabe: 'freigeben', Status: 'Entwurf bereit' }),
  zeile({ 'Bewertungs-ID': 'R-6', 'Stand (UTC)': '2026-09-20T08:00:00Z', Sterne: 4, Bewertungstext: 'Gut gemacht, R-6.', Hinweise: 'weich: Termin', Entwurf: GUT,
    Antwort: GUT, Freigabe: 'ja', Status: 'Entwurf bereit' })]).zeilen;

test('Blattplan trocken: neue Zeilen am Ende (13 Spalten, Antwort leer bei hartem Treffer), Freigabe → „wäre veröffentlicht“ ohne Zelle, ungültige Freigabe → Hinweis', () => {
  const bw = [Q('R-5'), Q('R-6'), Q('R-1'), Q('R-2', { erstellt_utc: '2026-09-21T08:00:00Z' }), Q('R-9', { mangel: ['comment unlesbar (#ERROR!)'], text: '' })];
  const items = {}; bw.forEach((b) => { items[b.bewertung_id] = b; });
  const zeilen = ZEILEN_ALT();
  const plan = hp.entwurfPlan({ zeilen, quelle: quelle(bw), seit_utc: '2026-08-31T22:00:00Z', einstellungen: E, bausteine: {} }, K);
  const erg = [{ art: 'status', anzahl: 2 }, ERG(0), ERG(1, { status: 'ki_fehler', grund: 'HTTP 401', kategorie: '', entwurf: '', antwort: '', hinweise: ['keine Einordnung (KI-Fehler)'] })];
  const b = hp.blattPlan({ modus: 'trocken', lauf: LAUF, einstellungen: E, zeilen, items, plan, ergebnisse: erg, loesch: { data: [], eintraege: [] } }, K);
  assert.deepEqual(b.neue_zeilen, [{ zeile: 4, bewertung_id: 'R-1' }, { zeile: 5, bewertung_id: 'R-2' }, { zeile: 6, bewertung_id: 'R-9' }]);
  const r4 = b.data.data.find((d) => d.range === "'Bewertungen'!A4:M4").values[0];
  assert.deepEqual(r4, ['R-1', '20.09.2026 10:00:00', '2026-09-20T08:00:00Z', 5, 'Gut gemacht.', 'positiv', '', GUT, GUT, '', 'Entwurf bereit', '', '']);
  const r5 = b.data.data.find((d) => d.range === "'Bewertungen'!A5:M5").values[0];
  assert.deepEqual([r5[5], r5[6], r5[7], r5[8], r5[10]], ['', 'keine Einordnung (KI-Fehler)', '', '', 'selbst lesen']);
  const r6 = b.data.data.find((d) => d.range === "'Bewertungen'!A6:M6").values[0];
  assert.deepEqual([r6[4], r6[6], r6[7], r6[10]], ['', 'Bewertung unlesbar: comment unlesbar (#ERROR!)', '', 'selbst lesen']);
  assert.equal(b.data.valueInputOption, 'RAW');
  assert.deepEqual(b.meldung.wuerde.map((w) => [w.zeile, w.sterne]), [[2, 5]]);
  assert.ok(!b.data.data.some((d) => /!J2$|!K2$/.test(d.range)), 'Freigabe und Status von R-5 unverändert');
  const h3 = b.data.data.find((d) => d.range === "'Bewertungen'!G3");
  assert.ok(h3 && /^weich: Termin; Freigabe ungültig/.test(h3.values[0][0]), JSON.stringify(h3));
  assert.deepEqual(b.meldung.alarme, ['KI-Fehler bei 1 Bewertung – keine Einordnung, selbst lesen']);
  assert.ok(b.meldung.eintraege.some((x) => x.zeile === 3 && /^Freigabe ungültig/.test(x.aufgabe)));
  assert.deepEqual(b.zaehler, { neu: 3, geaendert: 0, aenderungen: 0, wuerde: 1, freigabe_hinweise: 1, ki_fehler: 1, frist: 0 });
});

test('Protokoll: je Vorgang eine Zeile mit Zeit, Lauf, Modus, ID, Aktion, Grund, Hash - nie Bewertungstext, Entwurf oder Name', () => {
  const bw = [Q('R-5'), Q('R-6'), Q('R-1')];
  const items = {}; bw.forEach((x) => { items[x.bewertung_id] = x; });
  const zeilen = ZEILEN_ALT();
  const plan = hp.entwurfPlan({ zeilen, quelle: quelle(bw), seit_utc: '2026-08-31T22:00:00Z', einstellungen: E, bausteine: {} }, K);
  const b = hp.blattPlan({ modus: 'trocken', lauf: LAUF, einstellungen: E, zeilen, items, plan, ergebnisse: [{ art: 'status' }, ERG(0)],
    loesch: { data: [], eintraege: [{ zeile: 9, bewertung_id: 'R-0', sterne: 3, status: 'Frist abgelaufen' }] } }, K);
  assert.deepEqual(b.protokoll.map((z) => [z[4], z[5]]), [['R-0', 'frist_abgelaufen'], ['R-1', 'entwurf'], ['R-5', 'wuerde_veroeffentlichen'], ['R-6', 'freigabe']]);
  for (const z of b.protokoll) assert.deepEqual(z.slice(0, 4), [LAUF.zeit_utc, LAUF.zeit_berlin, LAUF.id, 'trocken']);
  assert.match(b.protokoll[2][7], /^[0-9a-f]{64}$/);
  const j = JSON.stringify(b.protokoll);
  for (const nicht of ['Gut gemacht', 'Guten Tag', 'Bewerter Probe']) assert.ok(!j.includes(nicht), nicht);
  assert.deepEqual(b.meldung.frist_abgelaufen, [{ zeile: 9, sterne: 3 }]);
});

test('Blattplan wirft bei Unerwartetem: Entwurf schreiben liefert nicht so viele Ergebnisse wie Ziele', () => {
  const bw = [Q('R-1'), Q('R-2')];
  const plan = hp.entwurfPlan({ zeilen: [], quelle: quelle(bw), seit_utc: '2026-08-31T22:00:00Z', einstellungen: E, bausteine: {} }, K);
  assert.throws(() => hp.blattPlan({ modus: 'trocken', lauf: LAUF, einstellungen: E, zeilen: [], items: {}, plan, ergebnisse: [{ art: 'status' }, ERG(0)],
    loesch: { data: [], eintraege: [] } }, K), /Hauptlauf/);
});

test('Geänderte Bewertung: Zellen neu (Stand, Text, Entwurf), Antwort nur ersetzt, wenn sie gleich dem alten Entwurf war; Freigabe verfällt', () => {
  const zeilen = tb.leseBewertungen([BW, zeile({ 'Bewertungs-ID': 'R-7', 'Stand (UTC)': '2026-09-20T08:00:00Z', Sterne: 5, Bewertungstext: 'alt', Entwurf: 'E-alt',
    Antwort: 'vom Betrieb geändert', Freigabe: 'freigeben', Status: 'Entwurf bereit' })]).zeilen;
  const neu = Q('R-7', { geaendert_utc: '2026-09-25T08:00:00Z', text: 'neu' });
  const plan = hp.entwurfPlan({ zeilen, quelle: quelle([neu]), seit_utc: '2026-08-31T22:00:00Z', einstellungen: E, bausteine: {} }, K);
  const b = hp.blattPlan({ modus: 'trocken', lauf: LAUF, einstellungen: E, zeilen, items: { 'R-7': neu }, plan, ergebnisse: [{ art: 'status' }, ERG(0)],
    loesch: { data: [], eintraege: [] } }, K);
  const z = (sp) => (b.data.data.find((d) => d.range === "'Bewertungen'!" + sp + '2') || { values: [[undefined]] }).values[0][0];
  assert.deepEqual([z('C'), z('E'), z('H'), z('I'), z('J'), z('K')], ['2026-09-25T08:00:00Z', 'neu', GUT, undefined, '', 'Entwurf bereit']);
  assert.ok(/Bewertung geändert – eigene Antwort prüfen/.test(z('G')));
  assert.deepEqual([b.meldung.wuerde.length, b.zaehler.geaendert], [0, 1]);
  // Mengenbremse 0: die Änderung wartet ganz (kein neuer Stand im Blatt), sonst erkennte der nächste Lauf sie nicht mehr
  const p0 = hp.entwurfPlan({ zeilen, quelle: quelle([neu]), seit_utc: '2026-08-31T22:00:00Z', einstellungen: Object.assign({}, E, { hoechstzahl_entwuerfe: 0 }), bausteine: {} }, K);
  const b0 = hp.blattPlan({ modus: 'trocken', lauf: LAUF, einstellungen: E, zeilen, items: { 'R-7': neu }, plan: p0, ergebnisse: [], loesch: { data: [], eintraege: [] } }, K);
  assert.ok(!b0.data.data.some((d) => /!C2$|!E2$/.test(d.range)), JSON.stringify(b0.data.data.map((d) => d.range)));
  assert.deepEqual(b0.meldung.hinweise, ['1 Entwurf im nächsten Lauf (Höchstzahl 0)']);
});

test('Neue Bewertung mit Antwort in der Quelle → Zeile „schon beantwortet“ ohne Entwurf, Protokoll, kein Aufruf von Entwurf schreiben', () => {
  const bw = [Q('R-16', { antwort_vorhanden: true, antwort_text: 'Danke, von Hand.', antwort_status: 'APPROVED' }), Q('R-1')];
  const items = {}; bw.forEach((x) => { items[x.bewertung_id] = x; });
  const plan = hp.entwurfPlan({ zeilen: [], quelle: quelle(bw), seit_utc: '2026-08-31T22:00:00Z', einstellungen: E, bausteine: {} }, K);
  assert.deepEqual(plan.ziele.map((z) => z.bewertung_id), ['R-1']);
  const b = hp.blattPlan({ modus: 'trocken', lauf: LAUF, einstellungen: E, zeilen: [], items, plan, ergebnisse: [{ art: 'status' }, ERG(0)], loesch: { data: [], eintraege: [] } }, K);
  const r = b.data.data.find((d) => d.range === "'Bewertungen'!A3:M3").values[0];
  assert.deepEqual([r[0], r[7], r[8], r[10]], ['R-16', '', '', 'schon beantwortet']);
  assert.ok(b.protokoll.some((z) => z[4] === 'R-16' && z[5] === 'schon_beantwortet'));
});
