'use strict';
// lauf.js: "Antworten einordnen" (Baustein 4) und Hauptlauf (Baustein 5) - Aufbereiten, Abschliessen, Plan-Eingang,
// Protokoll, Sammelmeldung. Alle Texte erfunden; Kontaktangaben offenkundig falsch.
const test = require('node:test');
const assert = require('node:assert/strict');
const la = require('../kern/lauf.js');
const K = Object.assign({}, require('../kern/antwort.js'), require('../kern/widerspruch.js'), require('../kern/entscheidung.js'));
const { anlage } = require('./hilfen.js');

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const kopf = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const nachricht = (id, ms, labels, headers, text, mime) => ({ id, internalDate: String(ms), labelIds: labels,
  payload: { mimeType: mime || 'text/plain', headers: kopf(headers), body: { data: b64u(text || 'x') } } });
// 14.09.2026 10:00 UTC = 12:00 Berlin; Antworten danach
const T0 = Date.UTC(2026, 8, 14, 10, 0, 0);
const TEXT_R1 = 'Guten Tag,\n\ngern, rufen Sie mich an: 0000 000000.\n\nViele Grüße\nKunde Beispiel 07\nMusterweg 1\n00000 Musterstadt\n\n'
  + 'Am 14.09.2026 um 12:00 schrieb Heizung & Sanitär Beispiel GmbH <absender@example.invalid>:\n> Ihre Anlage ist fällig.\n';
const thread = () => ({ id: 'T7', messages: [
  nachricht('r5', T0 + 4 * 3600e3, [], { From: 'mailer-daemon@example.invalid' }, 'Address not found'),
  nachricht('m0', T0, ['SENT'], { From: 'absender@example.invalid' }, 'Angebot'),
  nachricht('r1', T0 + 22 * 3600e3, ['INBOX'], { From: 'kunde-07@example.invalid' }, TEXT_R1),
  nachricht('r4', T0 + 3600e3, [], { From: 'kunde-07@example.invalid', 'Auto-Submitted': 'auto-replied' }, 'Bin nicht da'),
] });
const eingang = (abw) => Object.assign({ anlagen_id: 'W-9007', kunden_id: 'K-9007', email_norm: 'kunde-07@example.invalid',
  thread_id: 'T7', bekannt: [], ki_an: true }, abw || {});
const kiOk = (inhalt) => ({ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(inhalt) }] } });
const TERMIN = { kategorie: 'termin', sicher: true, widerspruch_moeglich: false };

test('übernommen: berlinZeit (aus Mahnlauf hauptlauf.js) - Sommer- und Winterzeit', () => {
  assert.deepEqual(la.berlinZeit('2026-09-14T22:30:00Z'), { datum: '2026-09-15', text: '15.09.2026 00:30:00' });
  assert.deepEqual(la.berlinZeit('2026-12-01T23:30:00.000Z'), { datum: '2026-12-02', text: '02.12.2026 00:30:00' });
});

test('antwortenAufbereiten: Antworten nach der eigenen Mail, Art, Berliner Datum, Text gekürzt nur für die KI', () => {
  const r = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K);
  assert.equal(r.gelesen, true);
  assert.deepEqual(r.antworten.map((a) => [a.gmail_id, a.art, a.datum, a.ki_noetig]),
    [['r4', 'abwesenheit', '2026-09-14', false], ['r5', 'unzustellbar', '2026-09-14', false], ['r1', 'antwort', '2026-09-15', true]]);
  const r1 = r.antworten[2];
  assert.equal(r1.ki_text, 'Guten Tag,\n\ngern, rufen Sie mich an: <TELEFON>.');
  assert.deepEqual(r1.treffer, []);
  assert.equal(r1.anlagen_id, 'W-9007');
  assert.equal(r1.thread_id, 'T7');
});

test('antwortenAufbereiten: bekannte Antworten übersprungen; Wortliste oder KI aus → keine KI; Thread nicht lesbar → gelesen false', () => {
  assert.deepEqual(la.antwortenAufbereiten(eingang({ bekannt: ['r1', 'r4'] }), { statusCode: 200, body: thread() }, K).antworten.map((a) => a.gmail_id), ['r5']);
  const w = thread();
  w.messages[2] = nachricht('r1', T0 + 22 * 3600e3, [], {}, 'Bitte melden Sie mich ab.');
  const rw = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: w }, K).antworten[2];
  assert.deepEqual([rw.treffer, rw.ki_noetig], [['abmelden'], false]);
  assert.equal(la.antwortenAufbereiten(eingang({ ki_an: false }), { statusCode: 200, body: thread() }, K).antworten[2].ki_noetig, false);
  const f = la.antwortenAufbereiten(eingang(), { statusCode: 404, body: { error: { code: 404 } } }, K);
  assert.deepEqual([f.gelesen, f.status, f.antworten], [false, 404, []]);
  assert.equal(la.antwortenAufbereiten(eingang(), { error: { message: 'timeout' } }, K).gelesen, false);
});

test('einordnungAbschliessen: KI sicher → Klasse, keine Sperre; Ausgabe ohne jeden Antworttext', () => {
  const a = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K).antworten[2];
  const r = la.einordnungAbschliessen(a, kiOk(TERMIN), true, K);
  assert.deepEqual([r.klasse, r.gesperrt, r.grund, r.eingeordnet, r.ki_aufruf], ['termin', false, '', true, true]);
  assert.match(r.aufgabe, /Termin/);
  for (const k of Object.keys(r)) assert.ok(!/text/.test(k), k);
  assert.ok(!JSON.stringify(r).includes('rufen Sie mich an'));
});

test('einordnungAbschliessen: im Zweifel sperren - HTTP-Fehler, fehlende KI-Antwort, leerer Text; Wortliste ohne KI', () => {
  const a = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K).antworten[2];
  const f = la.einordnungAbschliessen(a, { statusCode: 401, body: { error: { type: 'authentication_error' } } }, true, K);
  assert.deepEqual([f.gesperrt, f.grund, f.klasse, f.ki_grund], [true, 'Zweifel', 'nicht eingeordnet', 'HTTP 401']);
  assert.match(f.aufgabe, /lesen/);
  const n = la.einordnungAbschliessen(a, null, true, K);
  assert.deepEqual([n.gesperrt, n.grund], [true, 'Zweifel']);
  const leer = la.einordnungAbschliessen(Object.assign({}, a, { ki_text: '', ki_noetig: false }), null, true, K);
  assert.deepEqual([leer.gesperrt, leer.grund, leer.ki_grund], [true, 'Zweifel', 'kein Text nach dem Kürzen']);
  const w = la.einordnungAbschliessen(Object.assign({}, a, { treffer: ['abmelden'], ki_noetig: false, text_wortliste: 'Bitte melden Sie mich ab.' }), null, true, K);
  assert.deepEqual([w.gesperrt, w.grund, w.ki_aufruf], [true, 'Wortliste', false]);
  const aus = la.einordnungAbschliessen(Object.assign({}, a, { ki_noetig: false }), null, false, K);
  assert.deepEqual([aus.gesperrt, aus.klasse], [false, 'bitte lesen']);
});

test('Teil A 27.09.: „Nächstes Jahr gern wieder.“ unsicher → zurückgestellt, keine Sperrzeile, keine automatische Mail an den Kunden; Kontrolle „Bitte keine Werbung mehr.“ → gesperrt', () => {
  const en = require('../kern/entscheidung.js');
  const { einstellungen, wartungFuerFaelligIn } = require('./hilfen.js');
  const th = (text) => ({ id: 'T13', messages: [nachricht('m0', T0, ['SENT'], { From: 'absender@example.invalid' }, 'Angebot'),
    nachricht('r1', T0 + 3600e3, ['INBOX'], { From: 'kunde-13@example.invalid' }, text)] });
  const ein = eingang({ anlagen_id: 'W-9013', kunden_id: 'K-9013', email_norm: 'kunde-13@example.invalid', thread_id: 'T13' });
  const anl = [anlage(9013, { letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-18', thread_id: 'T13' }),
    anlage(9040, { kunden_id: 'K-9013', kunde: 'Kunde Beispiel 13', email: 'kunde-13@example.invalid', letzte_wartung: wartungFuerFaelligIn(30) })];
  const lauf = (text, ki) => {
    const a = la.antwortenAufbereiten(ein, { statusCode: 200, body: th(text) }, K).antworten[0];
    const e = la.einordnungAbschliessen(a, a.ki_noetig ? ki : null, true, K);
    const p = la.antwortenFuerPlan([e], anl, K);
    const plan = en.planeLauf({ einstellungen: einstellungen(), stichtag: '2026-09-28', anlagen: anl, sperrzeilen: p.sperrzeilen,
      antworten: p.antworten, antworten_gelesen: true, textbausteine_fehler: [] });
    const akt = (id) => plan.entscheidungen.find((d) => d.anlagen_id === id).aktion;
    return { a, e, p, plan, akt };
  };
  const z = lauf('Nächstes Jahr gern wieder.', kiOk({ kategorie: 'kein_interesse', sicher: false, widerspruch_moeglich: false }));
  assert.deepEqual([z.a.treffer, z.a.ki_noetig], [[], true]);
  assert.deepEqual([z.e.gesperrt, z.e.grund, z.e.klasse], [false, '', 'unklar']);
  assert.match(z.e.aufgabe, /bitte lesen/);
  assert.deepEqual(z.p.sperrzeilen, []);
  assert.deepEqual([z.akt('W-9013'), z.akt('W-9040')], ['beantwortet', 'antwort_offen']);
  assert.equal(z.plan.versand.length, 0);
  const m = la.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-28', lauf_id: '1', anlagen: anl, aufgaben: z.p.aufgaben, plan: z.plan });
  assert.match(m.text, /Antwort unklar – bitte lesen/);
  assert.doesNotMatch(m.text, /gesperrt/);
  const k = lauf('Bitte keine Werbung mehr.', kiOk(TERMIN));
  assert.deepEqual([k.a.treffer, k.a.ki_noetig], [['keine Werbung/Mails'], false]);
  assert.deepEqual([k.e.gesperrt, k.e.grund, k.e.ki_aufruf], [true, 'Wortliste', false]);
  assert.deepEqual(k.p.sperrzeilen.map((x) => x.schluessel), ['widerspruch|kunde|K-9013', 'widerspruch|mail|kunde-13@example.invalid']);
  assert.deepEqual([k.akt('W-9013'), k.akt('W-9040')], ['gesperrt', 'gesperrt']);
});

test('einordnungAbschliessen: Abwesenheit und Unzustellbar ohne Einordnung und ohne Sperre', () => {
  const r = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K).antworten;
  const ab = la.einordnungAbschliessen(r[0], null, true, K);
  assert.deepEqual([ab.art, ab.gesperrt, ab.klasse, ab.eingeordnet, ab.ki_aufruf], ['abwesenheit', false, '', true, false]);
  assert.match(la.einordnungAbschliessen(r[1], null, true, K).aufgabe, /unzustellbar/);
});

const erg = (id, anlagen_id, abw) => Object.assign({ anlagen_id, kunden_id: 'K-' + anlagen_id.slice(2), email_norm: 'kunde-' + anlagen_id.slice(-2) + '@example.invalid',
  thread_id: 'T' + anlagen_id.slice(-2), gmail_id: id, internalDate: 1000, datum: '2026-09-15', art: 'antwort', klasse: 'termin',
  gesperrt: false, grund: '', eingeordnet: true, ki_aufruf: true, ki_grund: '', aufgabe: 'Termin gewünscht – Kunde anrufen und Termin vereinbaren' }, abw || {});

test('antwortenFuerPlan: Stand je Anlage, Sperrzeilen dieses Laufs nach Kunden-ID und E-Mail, Aufgaben mit Thread-Link', () => {
  const anl = [anlage(9007), anlage(9011)];
  const p = la.antwortenFuerPlan([erg('a', 'W-9007'), erg('b', 'W-9011', { klasse: 'widerspruch', gesperrt: true, grund: 'Wortliste' })], anl, K);
  assert.deepEqual(p.antworten['W-9007'], { art: 'antwort', klasse: 'termin', datum: '2026-09-15', eingeordnet: true, gesperrt: false, anzahl: 1 });
  assert.deepEqual(p.sperrzeilen.map((z) => [z.schluessel, z.aktion, z.grund]),
    [['widerspruch|kunde|K-9011', 'gesperrt', 'Wortliste'], ['widerspruch|mail|kunde-11@example.invalid', 'gesperrt', 'Wortliste']]);
  assert.ok(p.sperrzeilen.every((z) => z.id >= 1e12));
  assert.deepEqual(p.aufgaben.map((x) => [x.anlagen_id, x.kunde, x.klasse]), [['W-9007', 'Kunde Beispiel 07', 'termin'], ['W-9011', 'Kunde Beispiel 11', 'widerspruch']]);
  assert.equal(p.aufgaben[0].link, 'https://mail.google.com/mail/u/0/#all/T07');
});

test('protokollZeilen: eine Zeile je Entscheidung und je Antwort, neun Spalten', () => {
  const plan = { entscheidungen: [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11', grund: '' },
    { anlagen_id: 'W-9024', aktion: 'pflichtangabe', vorgang: '', grund: 'Widerspruchshinweis bei Erhebung' }] };
  const z = la.protokollZeilen(plan, [erg('a', 'W-9007')], { zeit_utc: '2026-09-28T06:00:00.000Z', zeit_berlin: '28.09.2026 08:00:00', lauf_id: '7000', modus: 'trocken' });
  assert.equal(z.length, 3);
  assert.ok(z.every((r) => r.length === 9));
  assert.deepEqual(z[0].slice(2), ['7000', 'trocken', 'W-9001', 'angebot', 'W-9001/2026-11', '', '']);
  assert.deepEqual(z[2].slice(4), ['W-9007', 'Antwort eingeordnet: termin', '', '', 'a']);
});

test('baueSammelmeldung: trocken mit Präfix und Geplantem; Aufgaben mit Link, ohne Antworttext; Alarm im Betreff; leer mit Hinweis', () => {
  const anl = [anlage(9001), anlage(9007)];
  const plan = { versand: [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11' }], alarme: [],
    hinweise: [{ anlagen_id: 'W-9024', text: 'Pflichtangabe fehlt – Widerspruchshinweis bei Erhebung' }], entscheidungen: [] };
  const aufgaben = la.antwortenFuerPlan([erg('a', 'W-9007')], anl, K).aufgaben;
  const m = la.baueSammelmeldung({ firma: 'Heizung & Sanitär Beispiel GmbH', modus: 'trocken', stichtag: '2026-09-28', lauf_id: '7000',
    plan, aufgaben, anlagen: anl });
  assert.match(m.betreff, /^\[TROCKEN – nichts versendet\] Wartungserinnerung Heizung & Sanitär Beispiel GmbH – 28\.09\.2026$/);
  assert.equal(m.alarm, false);
  assert.match(m.text, /Angebot W-9001 \(Kunde Beispiel 01, Gas-Brennwerttherme\) – Vorgang W-9001\/2026-11/);
  assert.match(m.text, /Termin gewünscht – Kunde anrufen und Termin vereinbaren – Kunde Beispiel 07, Gas-Brennwerttherme \(W-9007\), Antwort vom 15\.09\.2026 – https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/T07/);
  assert.match(m.text, /W-9024: Pflichtangabe fehlt/);
  const a = la.baueSammelmeldung({ firma: 'F', modus: 'trocken', stichtag: '2026-09-28', lauf_id: '1', anlagen: [], aufgaben: [],
    plan: { versand: [], alarme: [{ art: 'Mengenbremse', text: '21 Mails fällig, Höchstzahl 20' }], hinweise: [], entscheidungen: [] } });
  assert.match(a.betreff, /ALARM/);
  assert.equal(a.alarm, true);
  assert.match(a.text, /Mengenbremse: 21 Mails fällig/);
  const leer = la.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-28', lauf_id: '1', anlagen: [], aufgaben: [],
    plan: { versand: [], alarme: [], hinweise: [], entscheidungen: [] } });
  assert.doesNotMatch(leer.betreff, /TROCKEN/);
  assert.match(leer.text, /Keine Vorgänge/);
});

test('baueSammelmeldung: eine gesperrte Antwort nennt die Sperre; bei Zweifel den Weg „Widerspruch aufheben“ (Befund Lauf 6638, W-9013)', () => {
  const anl = [anlage(9013), anlage(9011)];
  const auf = la.antwortenFuerPlan([erg('a', 'W-9013', { gesperrt: true, grund: 'Zweifel' }),
    erg('b', 'W-9011', { klasse: 'widerspruch', gesperrt: true, grund: 'Wortliste', aufgabe: 'Widerspruch – gesperrt' })], anl, K).aufgaben;
  const m = la.baueSammelmeldung({ firma: 'F', modus: 'trocken', stichtag: '2026-09-28', lauf_id: '1', anlagen: anl, aufgaben: auf,
    plan: { versand: [], alarme: [], hinweise: [], entscheidungen: [] } });
  assert.match(m.text, /Termin gewünscht – Kunde anrufen und Termin vereinbaren – gesperrt \(Zweifel\); ist es kein Widerspruch, in der Zeile „Widerspruch aufheben“ den Grund eintragen – Kunde Beispiel 13/);
  assert.match(m.text, /Widerspruch – gesperrt – gesperrt \(Wortliste\) – Kunde Beispiel 11/);
});

test('baueSammelmeldung: zurückgestellte Mails mit Grund (offene Antwort, eine Mail je Kunde), damit der Betrieb handeln kann (Teil A 7)', () => {
  const anl = [anlage(9018), anlage(9029)];
  const plan = { versand: [], alarme: [], hinweise: [], entscheidungen: [
    { anlagen_id: 'W-9018', aktion: 'antwort_offen', aktion_geplant: 'angebot', grund: 'offene Antwort des Kunden (W-9007) – erst „Antwort erledigt“ = ja' },
    { anlagen_id: 'W-9029', aktion: 'naechster_werktag', aktion_geplant: 'angebot', grund: 'höchstens eine Mail je Kunde und Lauf' },
    { anlagen_id: 'W-9001', aktion: 'nicht_faellig', grund: '' }] };
  const m = la.baueSammelmeldung({ firma: 'F', modus: 'trocken', stichtag: '2026-09-28', lauf_id: '1', anlagen: anl, aufgaben: [], plan });
  assert.match(m.text, /Zurückgestellt \(keine Mail in diesem Lauf\):\n- Angebot W-9018 \(Kunde Beispiel 18, Gas-Brennwerttherme\) – offene Antwort des Kunden \(W-9007\) – erst „Antwort erledigt“ = ja\n- Angebot W-9029 \(Kunde Beispiel 29, Gas-Brennwerttherme\) – höchstens eine Mail je Kunde und Lauf/);
  assert.doesNotMatch(m.text, /W-9001/);
  assert.doesNotMatch(m.text, /Keine Vorgänge/);
});

// ---- Teil B / Baustein 6 (Auftrag 27.09.2026): Vorgangssuche, Datenhaltung, Zustand, Sammelmeldung mit Versand ----------

const KL = Object.assign({}, K, require('../kern/versand.js'));
const LAUF = { lauf_id: '7000', zeit_utc: '2026-09-28T06:00:05.000Z', lauf_start: '2026-09-28T06:00:00.000Z', stichtag: '2026-09-28' };

test('Teil B: antwortenAufbereiten - Wortliste auch im Betreff (Abmeldung per Klick: „Abmelden <Vorgang>“, Text von Gmail), ohne KI', () => {
  const t = { id: 'TA', messages: [nachricht('ab', T0 + 3600e3, ['INBOX'], { From: 'kunde-07@example.invalid', Subject: 'Abmelden W-9007/2026-10' },
    'This message was automatically generated by Gmail.')] };
  const r = la.antwortenAufbereiten(eingang({ thread_id: 'TA' }), { statusCode: 200, body: t }, K, T0);
  assert.equal(r.gelesen, true);
  assert.deepEqual(r.antworten.map((a) => [a.gmail_id, a.art, a.treffer, a.ki_noetig]), [['ab', 'antwort', ['abmelden'], false]]);
  const e = la.einordnungAbschliessen(r.antworten[0], null, true, K);
  assert.deepEqual([e.gesperrt, e.grund, e.klasse, e.ki_aufruf], [true, 'Wortliste', 'widerspruch', false]);
  const ohne = la.antwortenAufbereiten(eingang({ thread_id: 'TA' }), { statusCode: 200, body: t }, K);
  assert.deepEqual(ohne.antworten, []);
  const re = { id: 'TB', messages: [nachricht('m0', T0, ['SENT'], {}, 'Angebot'),
    nachricht('r', T0 + 60e3, [], { Subject: 'Re: Wartung Ihrer Gas-Brennwerttherme – W-9007/2026-10' }, 'Termin gern.')] };
  assert.deepEqual(la.antwortenAufbereiten(eingang(), { statusCode: 200, body: re }, K).antworten[0].treffer, []);
  assert.equal(la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K).erste_eigene_ms, T0);
});

test('Teil B: threadListe - gespeicherter Thread zuerst, Treffer der Vorgangssuche dazu (ohne Doppel); Suche je Anlage mit Kontrolle', () => {
  const ein = [eingang({ vorgang: 'W-9007/2026-10' }), eingang({ anlagen_id: 'W-9008', thread_id: 'T8', vorgang: 'W-9008/2026-10' }),
    eingang({ anlagen_id: 'W-9009', thread_id: 'T9', vorgang: '' })];
  const such = [{ statusCode: 200, body: { threads: [{ id: 'TX' }, { id: 'T7' }] } }, { statusCode: 200, body: { resultSizeEstimate: 0 } }, null];
  const r = la.threadListe(ein, such);
  assert.deepEqual(r.threads.map((x) => [x.anlagen_id, x.thread_id, x.haupt]),
    [['W-9007', 'T7', true], ['W-9007', 'TX', false], ['W-9008', 'T8', true], ['W-9009', 'T9', true]]);
  assert.deepEqual(r.suche, [{ anlagen_id: 'W-9007', status: 200, gefunden: 2, haupt_gefunden: true },
    { anlagen_id: 'W-9008', status: 200, gefunden: 0, haupt_gefunden: false }, { anlagen_id: 'W-9009', status: 0, gefunden: 0, haupt_gefunden: false, ohne_vorgang: true }]);
  assert.throws(() => la.threadListe(ein, such.slice(1)));
});

test('Teil B: antwortenSammeln - Nebenthread ab der ersten eigenen Mail des Hauptthreads; Suche ohne Treffer beim Hauptthread → Hinweis; keine Suche trifft → nicht gelesen (Positivkontrolle)', () => {
  const ein = [eingang({ vorgang: 'W-9007/2026-10' }), eingang({ anlagen_id: 'W-9008', kunden_id: 'K-9008', email_norm: 'kunde-08@example.invalid', thread_id: 'T8', vorgang: 'W-9008/2026-10' })];
  const nebenthread = { id: 'TX', messages: [nachricht('ab', T0 + 3600e3, ['INBOX'], { Subject: 'Abmelden W-9007/2026-10' }, 'This message was automatically generated by Gmail.')] };
  const t8 = { id: 'T8', messages: [nachricht('m8', T0, ['SENT'], {}, 'Angebot')] };
  const liste = la.threadListe(ein, [{ statusCode: 200, body: { threads: [{ id: 'T7' }, { id: 'TX' }] } }, { statusCode: 200, body: {} }]);
  const r = la.antwortenSammeln(liste, [{ statusCode: 200, body: thread() }, { statusCode: 200, body: nebenthread }, { statusCode: 200, body: t8 }], K);
  assert.deepEqual(r.antworten.map((a) => [a.anlagen_id, a.gmail_id, a.art]),
    [['W-9007', 'r4', 'abwesenheit'], ['W-9007', 'r5', 'unzustellbar'], ['W-9007', 'r1', 'antwort'], ['W-9007', 'ab', 'antwort']]);
  assert.deepEqual([r.status.threads, r.status.gelesen, r.status.gelesen_alle, r.status.suche_kontrolle], [2, 2, true, true]);
  assert.deepEqual(r.status.suche_hinweise, [{ anlagen_id: 'W-9008', text: 'Vorgangssuche fand den gespeicherten Thread nicht – Betreff geändert?' }]);
  const nichts = la.threadListe(ein, [{ statusCode: 200, body: {} }, { statusCode: 200, body: {} }]);
  const k = la.antwortenSammeln(nichts, [{ statusCode: 200, body: thread() }, { statusCode: 200, body: t8 }], K);
  assert.deepEqual([k.status.gelesen_alle, k.status.suche_kontrolle], [false, false]);
  const fehler = la.antwortenSammeln(la.threadListe(ein, [{ statusCode: 429, body: {} }, { statusCode: 200, body: { threads: [{ id: 'T8' }] } }]),
    [{ statusCode: 200, body: thread() }, { statusCode: 200, body: t8 }], K);
  assert.deepEqual([fehler.status.gelesen_alle, fehler.status.fehler], [false, [{ anlagen_id: 'W-9007', status: 429, art: 'suche' }]]);
  const neben404 = la.antwortenSammeln(liste, [{ statusCode: 200, body: thread() }, { statusCode: 404, body: {} }, { statusCode: 200, body: t8 }], K);
  assert.deepEqual([neben404.status.gelesen_alle, neben404.status.fehler], [false, [{ anlagen_id: 'W-9007', status: 404, art: 'thread' }]]);
  const bekannt = la.antwortenSammeln(la.threadListe([eingang({ vorgang: 'W-9007/2026-10', bekannt: ['r1', 'ab'] })],
    [{ statusCode: 200, body: { threads: [{ id: 'T7' }] } }]), [{ statusCode: 200, body: thread() }], K);
  assert.deepEqual(bekannt.antworten.map((a) => a.gmail_id), ['r4', 'r5']);
});

test('Baustein 6: antwortReservierung - eigene früheste Reservierung → einordnen; eingeordnet → nie wieder; abgebrochener Lauf → ohne KI; gleichzeitiger Lauf → übersprungen', () => {
  const z = (id, aktion, lauf, zeit) => ({ id, schluessel: 'antwort|r1', aktion, lauf_id: lauf, zeit_utc: zeit || '2026-09-28T06:00:03.000Z' });
  const f = (zeilen) => la.antwortReservierung(zeilen, 'r1', '7000', '2026-09-28T06:00:00.000Z');
  assert.deepEqual(f([z(5, 'reserviert', '7000')]), { weiter: true, ohne_ki: false, grund: '' });
  assert.deepEqual(f([z(1, 'reserviert', '6990'), z(2, 'eingeordnet', '6990'), z(5, 'reserviert', '7000')]).weiter, false);
  const tot = f([z(1, 'reserviert', '6990', '2026-09-27T06:00:00.000Z'), z(5, 'reserviert', '7000')]);
  assert.deepEqual([tot.weiter, tot.ohne_ki, /abgebrochen/.test(tot.grund)], [true, true, true]);
  const gleich = f([z(4, 'reserviert', '7001', '2026-09-28T06:00:02.000Z'), z(5, 'reserviert', '7000')]);
  assert.deepEqual([gleich.weiter, gleich.grund], [false, 'übersprungen, anderer Lauf']);
  assert.deepEqual([f([]).weiter, f([]).grund], [false, 'keine Reservierung']);
  assert.deepEqual(f([z(5, 'reserviert', '7000'), { id: 6, schluessel: 'antwort|r2', aktion: 'eingeordnet', lauf_id: '1' }]).weiter, true);
});

test('Baustein 6: einordnungAbschliessen - Reservierung eines abgebrochenen Laufs → ohne KI „bitte lesen“ (Wortliste gilt); gleichzeitiger Lauf → nicht eingeordnet', () => {
  const a = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K).antworten[2];
  const r = la.einordnungAbschliessen(Object.assign({}, a, { ohne_ki: true, ki_noetig: false }), null, true, K);
  assert.deepEqual([r.gesperrt, r.klasse, r.ki_aufruf, /abgebrochen/.test(r.ki_grund)], [false, 'bitte lesen', false, true]);
  const w = la.einordnungAbschliessen(Object.assign({}, a, { ohne_ki: true, ki_noetig: false, treffer: ['abmelden'], text_wortliste: 'Bitte abmelden.' }), null, true, K);
  assert.deepEqual([w.gesperrt, w.grund], [true, 'Wortliste']);
  const u = la.einordnungAbschliessen(Object.assign({}, a, { uebersprungen: true, ki_noetig: false }), null, true, K);
  assert.deepEqual([u.gesperrt, u.klasse, u.eingeordnet], [false, 'anderer Lauf', false]);
});

test('Baustein 6: Data-Table-Zeilen - Reservierung je Nachricht, Sperre je Kunde und Mail, eingeordnet mit Klasse; nie ein Text', () => {
  const ant = la.antwortenAufbereiten(eingang(), { statusCode: 200, body: thread() }, K).antworten;
  const res = la.reservierungsZeilen(ant, LAUF);
  assert.deepEqual(res.map((z) => [z.schluessel, z.aktion, z.lauf_id, z.anlagen_id, z.gmail_id, z.zeit_utc]),
    ant.map((a) => ['antwort|' + a.gmail_id, 'reserviert', '7000', 'W-9007', a.gmail_id, LAUF.zeit_utc]));
  const erg = [erg_('r1', 'W-9007', {}), erg_('r9', 'W-9011', { klasse: 'widerspruch', gesperrt: true, grund: 'Wortliste' }),
    erg_('r8', 'W-9012', { klasse: 'anderer Lauf', eingeordnet: false })];
  const sp = la.sperrDatenZeilen(erg, LAUF, KL);
  assert.deepEqual(sp.map((z) => [z.schluessel, z.aktion, z.grund, z.anlagen_id, z.gmail_id]),
    [['widerspruch|kunde|K-9011', 'gesperrt', 'Wortliste', 'W-9011', 'r9'], ['widerspruch|mail|kunde-11@example.invalid', 'gesperrt', 'Wortliste', 'W-9011', 'r9']]);
  const alle = res.concat(sp);
  for (const z of alle) assert.deepEqual(Object.keys(z).sort(), ['aktion', 'anlagen_id', 'datum', 'gmail_id', 'grund', 'kunden_id', 'lauf_id', 'schluessel', 'zeit_utc']);
  assert.ok(!JSON.stringify(alle).includes('rufen Sie'));
});

const erg_ = (id, anlagen_id, abw) => Object.assign({ anlagen_id, kunden_id: 'K-' + anlagen_id.slice(2), email_norm: 'kunde-' + anlagen_id.slice(-2) + '@example.invalid',
  thread_id: 'T' + anlagen_id.slice(-2), gmail_id: id, internalDate: 1000, datum: '2026-09-27', art: 'antwort', klasse: 'termin',
  gesperrt: false, grund: '', eingeordnet: true, ki_aufruf: true, ki_grund: '', aufgabe: 'Termin gewünscht – Kunde anrufen und Termin vereinbaren' }, abw || {});

test('Baustein 6: nachtragZeilen - eingeordnet (Klasse als Grund) nach dem Schreiben des Blatts; Zelle → Sperrliste (Betrieb); Aufheben (E4)', () => {
  const plan = { entscheidungen: [
    { anlagen_id: 'W-9028', kunden_id: 'K-9028', email_norm: 'kunde-28@example.invalid', aktion: 'gesperrt', sperre_nachtragen: true, aufheben: null },
    { anlagen_id: 'W-9030', kunden_id: 'K-9030', email_norm: 'kunde-30@example.invalid', aktion: 'gesperrt', sperre_nachtragen: false,
      aufheben: { grund: 'Kunde hat telefonisch um Angebote gebeten' } },
    { anlagen_id: 'W-9001', kunden_id: 'K-9001', email_norm: 'kunde-01@example.invalid', aktion: 'angebot', sperre_nachtragen: false, aufheben: null }] };
  const z = la.nachtragZeilen(plan, [erg_('r1', 'W-9007', {}), erg_('r8', 'W-9012', { klasse: 'anderer Lauf', eingeordnet: false })], LAUF, KL);
  assert.deepEqual(z.map((x) => [x.schluessel, x.aktion, x.grund]), [
    ['antwort|r1', 'eingeordnet', 'termin'],
    ['widerspruch|kunde|K-9028', 'gesperrt', 'Betrieb'], ['widerspruch|mail|kunde-28@example.invalid', 'gesperrt', 'Betrieb'],
    ['widerspruch|kunde|K-9030', 'aufgehoben', 'Kunde hat telefonisch um Angebote gebeten'],
    ['widerspruch|mail|kunde-30@example.invalid', 'aufgehoben', 'Kunde hat telefonisch um Angebote gebeten']]);
});

test('Baustein 6: zustandZellen - Fälligkeit, Status (nicht bei Mails), Zyklus neu leert, Antwort mit Klasse und Datum, Werbewiderspruch, Protokoll', () => {
  const { AN_SPALTEN } = require('../kern/anlagen.js');
  const anl = [anlage(9001), anlage(9006, { angebot_am: '2026-09-15' }), anlage(9007, { angebot_am: '2026-09-14', thread_id: 'T07' }),
    anlage(9011), anlage(9020, { erinnerung_am: '2026-09-10', angebot_am: '2026-08-20' }), anlage(9033, { thread_id: 'T33' }), anlage(9040)];
  const plan = { entscheidungen: [
    { anlagen_id: 'W-9001', zeile: 2, aktion: 'angebot', faelligkeit: '2026-11-07', grund: '' },
    { anlagen_id: 'W-9006', zeile: 7, aktion: 'wartet', faelligkeit: '2026-10-18', grund: '' },
    { anlagen_id: 'W-9007', zeile: 8, aktion: 'beantwortet', faelligkeit: '2026-10-18', grund: '' },
    { anlagen_id: 'W-9011', zeile: 12, aktion: 'gesperrt', faelligkeit: '', grund: 'Werbewiderspruch', zelle_nachtragen: true },
    { anlagen_id: 'W-9020', zeile: 21, aktion: 'nicht_faellig', faelligkeit: '2027-09-01', grund: '', zyklus_neu: true },
    { anlagen_id: 'W-9033', zeile: 34, aktion: 'beantwortet', faelligkeit: '2026-10-18', grund: '' },
    { anlagen_id: 'W-9040', zeile: 41, aktion: 'antwort_offen', aktion_geplant: 'angebot', faelligkeit: '2026-10-28', grund: 'offene Antwort' }] };
  const antworten = { 'W-9007': { art: 'antwort', klasse: 'termin', datum: '2026-09-27' }, 'W-9033': { art: 'antwort', klasse: 'unklar', datum: '2026-09-27' } };
  const r = la.zustandZellen(plan, antworten, anl, AN_SPALTEN, LAUF);
  const w = {};
  r.data.forEach((d) => { w[d.range] = d.values[0][0]; });
  assert.equal(w["'Anlagen'!P2"], 46333);
  assert.equal(w["'Anlagen'!Q2"], undefined);
  assert.equal(w["'Anlagen'!Q7"], 'Angebot versendet');
  assert.equal(w["'Anlagen'!Q8"], 'beantwortet');
  assert.equal(w["'Anlagen'!U8"], 'Termin gewünscht, 27.09.2026');
  assert.equal(w["'Anlagen'!V8"], '');
  assert.equal(w["'Anlagen'!U34"], 'unklar – bitte lesen, 27.09.2026');
  assert.equal(w["'Anlagen'!N12"], 'ja');
  assert.equal(w["'Anlagen'!Q12"], 'gesperrt');
  assert.equal(w["'Anlagen'!P12"], undefined);
  assert.deepEqual([w["'Anlagen'!R21"], w["'Anlagen'!S21"], w["'Anlagen'!T21"], w["'Anlagen'!U21"], w["'Anlagen'!V21"]], ['', '', '', '', '']);
  assert.equal(w["'Anlagen'!Q41"], undefined);
  assert.match(w["'Anlagen'!W41"], /^28\.09\.2026: zurückgestellt \(Angebot\) – offene Antwort$/);
  assert.match(w["'Anlagen'!W8"], /^28\.09\.2026: beantwortet/);
  assert.deepEqual(r.hinweise, [{ anlagen_id: 'W-9011', text: 'Zelle „Werbewiderspruch“ neu gesetzt – die Sperre steht in der Sperrliste' },
    { anlagen_id: 'W-9020', text: 'neuer Zyklus – Angebot am, Erinnerung am, Thread-ID und Antwort geleert' }]);
  assert.throws(() => la.zustandZellen(plan, antworten, anl, AN_SPALTEN.slice(1), LAUF));
});

test('Baustein 6: zustandZellen - eine Sperre aus DIESEM Lauf setzt die Zelle ohne Hinweis; nur eine ältere Sperre mit leerer Zelle meldet „neu gesetzt“', () => {
  const { AN_SPALTEN } = require('../kern/anlagen.js');
  const plan = { entscheidungen: [
    { anlagen_id: 'W-9011', kunden_id: 'K-9011', email_norm: 'kunde-11@example.invalid', zeile: 12, aktion: 'gesperrt', faelligkeit: '', grund: 'Werbewiderspruch', zelle_nachtragen: true },
    { anlagen_id: 'W-9034', kunden_id: 'K-9034', email_norm: 'kunde-34@example.invalid', zeile: 35, aktion: 'gesperrt', faelligkeit: '', grund: 'Werbewiderspruch', zelle_nachtragen: true }] };
  const neu = [{ schluessel: 'widerspruch|kunde|K-9034' }, { schluessel: 'widerspruch|mail|kunde-34@example.invalid' }];
  const r = la.zustandZellen(plan, {}, [anlage(9011), anlage(9034)], AN_SPALTEN, LAUF, neu);
  assert.deepEqual(r.hinweise, [{ anlagen_id: 'W-9011', text: 'Zelle „Werbewiderspruch“ neu gesetzt – die Sperre steht in der Sperrliste' }]);
  assert.equal(r.data.filter((d) => d.range === "'Anlagen'!N35" && d.values[0][0] === 'ja').length, 1);
});

test('Baustein 6: baueSammelmeldung mit Versandergebnissen - Versendet und Nicht versendet mit Grund; Zusatzhinweise; Modus test sagt Testempfänger', () => {
  const anl = [anlage(9001), anlage(9005), anlage(9019)];
  const plan = { versand: [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11' }, { anlagen_id: 'W-9005', aktion: 'erinnerung', vorgang: 'W-9005/2026-10' },
    { anlagen_id: 'W-9019', aktion: 'angebot', vorgang: 'W-9019/2026-10' }], alarme: [], hinweise: [], entscheidungen: [] };
  const v = [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11', ergebnis: 'versendet', grund: '' },
    { anlagen_id: 'W-9005', aktion: 'erinnerung', vorgang: 'W-9005/2026-10', ergebnis: 'versendet', grund: '' },
    { anlagen_id: 'W-9019', aktion: 'angebot', vorgang: 'W-9019/2026-10', ergebnis: 'nicht versendet', grund: 'geändert seit Laufbeginn – geplant angebot, jetzt gesperrt' }];
  const m = la.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-28', lauf_id: '7000', plan, aufgaben: [], anlagen: anl,
    versand_ergebnisse: v, zusatz_hinweise: [{ anlagen_id: 'W-9011', text: 'Zelle „Werbewiderspruch“ neu gesetzt – die Sperre steht in der Sperrliste' }] });
  assert.match(m.text, /Versendet \(Modus test: an den Testempfänger\):\n- Angebot W-9001 \(Kunde Beispiel 01, Gas-Brennwerttherme\) – Vorgang W-9001\/2026-11\n- Erinnerung W-9005/);
  assert.match(m.text, /Nicht versendet:\n- Angebot W-9019 \(Kunde Beispiel 19, Gas-Brennwerttherme\) – geändert seit Laufbeginn/);
  assert.match(m.text, /Hinweise:\n- W-9011: Zelle „Werbewiderspruch“ neu gesetzt/);
  assert.doesNotMatch(m.text, /^Mails:/m);
  assert.equal(m.alarm, false);
  const unklar = la.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-28', lauf_id: '7000', plan, aufgaben: [], anlagen: anl,
    versand_ergebnisse: [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11', ergebnis: 'versand_unklar', grund: 'Reservierung eines abgebrochenen Laufs, im Gesendet-Ordner nicht gefunden' }] });
  assert.match(unklar.betreff, /ALARM/);
  assert.match(unklar.text, /ALARM:\n- Versandstatus unklar: W-9001/);
});

test('Baustein 6: protokollZeilen mit Versandergebnissen - eine Zeile je Mail mit Gmail-ID', () => {
  const z = la.protokollZeilen({ entscheidungen: [] }, [], { zeit_utc: 'u', zeit_berlin: 'b', lauf_id: '7000', modus: 'test' },
    [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11', ergebnis: 'versendet', grund: '', gmail_id: 'g1' }]);
  assert.deepEqual(z, [['u', 'b', '7000', 'test', 'W-9001', 'Versand angebot: versendet', 'W-9001/2026-11', '', 'g1']]);
});

// ---- Auftrag 27.09.2026 nachmittags, Teil A ---------------------------------------------------------------------------------
const KV = Object.assign({}, K, require('../kern/versand.js'));

test('A2: alter Vorgang - „Bitte keine Werbung mehr“ sperrt (Wortliste, ohne KI); Kontrolle „Danke, alles bestens“ → ignoriert: keine Aufgabe, keine Sperre, kein Antwortstand', () => {
  const alt = (text) => la.antwortenAufbereiten(eingang({ thread_id: 'TA', alt: true }), { statusCode: 200, body: { id: 'TA', messages: [
    nachricht('m0', T0, ['SENT'], {}, 'Angebot'), nachricht('ra', T0 + 3600e3, [], {}, text)] } }, K).antworten[0];
  const w = alt('Bitte keine Werbung mehr.');
  assert.equal(w.alt, true);
  const ew = la.einordnungAbschliessen(w, null, true, K);
  assert.deepEqual([ew.gesperrt, ew.grund, ew.alt], [true, 'Wortliste', true]);
  const d = alt('Danke, alles bestens.');
  const ed = la.einordnungAbschliessen(d, kiOk({ kategorie: 'kein_interesse', sicher: true, widerspruch_moeglich: false }), true, K);
  assert.deepEqual([ed.gesperrt, ed.klasse, ed.aufgabe, ed.alt], [false, 'ignoriert (alter Vorgang)', '', true]);
  const p = la.antwortenFuerPlan([ew, ed], [anlage(9007)], K);
  assert.deepEqual(p.sperrzeilen.map((z) => z.schluessel), ['widerspruch|kunde|K-9007', 'widerspruch|mail|kunde-07@example.invalid']);
  assert.deepEqual(p.aufgaben.map((a) => [a.anlagen_id, a.klasse, a.gesperrt]), [['W-9007', 'widerspruch', true]]);
  assert.deepEqual(p.antworten, {});
});

test('A2: alter Vorgang - im Zweifel am Widerspruch sperren: Widerspruch möglich, KI aus, KI ausgefallen, leerer Text; unsicher ohne Verdacht → ignoriert', () => {
  const a = la.antwortenAufbereiten(eingang({ thread_id: 'TA', alt: true }), { statusCode: 200, body: { id: 'TA', messages: [
    nachricht('m0', T0, ['SENT'], {}, 'Angebot'), nachricht('ra', T0 + 3600e3, [], {}, 'Hören Sie auf.')] } }, K).antworten[0];
  const f = (ki, kiAn, abw) => la.einordnungAbschliessen(Object.assign({}, a, abw || {}), ki, kiAn, K);
  assert.deepEqual([f(kiOk({ kategorie: 'kein_interesse', sicher: true, widerspruch_moeglich: true }), true).gesperrt], [true]);
  assert.deepEqual([f(null, false, { ki_noetig: false }).gesperrt, f(null, false, { ki_noetig: false }).grund], [true, 'Zweifel']);
  assert.deepEqual([f({ statusCode: 500, body: {} }, true).gesperrt], [true]);
  assert.deepEqual([f(null, true, { ki_text: '', ki_noetig: false }).gesperrt], [true]);
  const u = f(kiOk({ kategorie: 'termin', sicher: false, widerspruch_moeglich: false }), true);
  assert.deepEqual([u.gesperrt, u.klasse], [false, 'ignoriert (alter Vorgang)']);
});

test('A2/A3: threadListe - Eingangsnummer je Thread; nur Suche ohne gespeicherten Thread; antwortenSammeln mit Untergrenze aus dem Angebotsdatum', () => {
  const ein = [eingang({ vorgang: 'W-9007/2026-10' }), eingang({ thread_id: '', vorgang: 'W-9007/2026-10', nur_suche: true, ab_ms: T0 - 1 }),
    eingang({ thread_id: 'TA', vorgang: 'W-9007/2025-10', alt: true })];
  const such = [{ statusCode: 200, body: { threads: [{ id: 'T7' }] } }, { statusCode: 200, body: { threads: [{ id: 'TN' }] } },
    { statusCode: 200, body: { threads: [{ id: 'TA' }] } }];
  const l = la.threadListe(ein, such);
  assert.deepEqual(l.threads.map((t) => [t.eingang_nr, t.thread_id, t.haupt]), [[0, 'T7', true], [1, 'TN', false], [2, 'TA', true]]);
  assert.equal(l.suche[1].ohne_haupt, true);
  const TN = { id: 'TN', messages: [nachricht('rn', T0 + 60e3, [], { Subject: 'Re: Wartung – W-9007/2026-10' }, 'Termin gern.')] };
  const TA = { id: 'TA', messages: [nachricht('ma', T0 - 400 * 86400e3, ['SENT'], {}, 'altes Angebot'), nachricht('ra', T0 - 300 * 86400e3, [], {}, 'Danke.')] };
  const r = la.antwortenSammeln(l, [{ statusCode: 200, body: thread() }, { statusCode: 200, body: TN }, { statusCode: 200, body: TA }], K);
  assert.deepEqual(r.antworten.map((a) => [a.gmail_id, !!a.alt]), [['r4', false], ['r5', false], ['r1', false], ['rn', false], ['ra', true]]);
  assert.deepEqual([r.status.threads, r.status.gelesen, r.status.gelesen_alle, r.status.suche_kontrolle], [3, 3, true, true]);
});

test('A3: klaerungsAuftrag - versendet → Datum, Status, Thread-ID nachziehen, Zelle leeren, Eintrag; nicht versendet → zurückgeben; trocken → nur Hinweis', () => {
  const { AN_SPALTEN } = require('../kern/anlagen.js');
  const anl = [anlage(9001, { zeile: 2, versandstatus_klaeren: 'versendet' }), anlage(9005, { zeile: 6, angebot_am: '2026-09-14', versandstatus_klaeren: 'nicht versendet' }),
    anlage(9006, { zeile: 7, angebot_am: '2026-09-14', erinnerung_am: '2026-09-28', versandstatus_klaeren: 'versendet' })];
  const plan = { entscheidungen: [
    { anlagen_id: 'W-9001', zeile: 2, aktion: 'versandstatus', aktion_geplant: 'angebot', klaer_schluessel: 'angebot|W-9001|2026-11-07', klaer_wert: 'versendet', faelligkeit: '2026-11-07' },
    { anlagen_id: 'W-9005', zeile: 6, aktion: 'versandstatus', aktion_geplant: 'erinnerung', klaer_schluessel: 'erinnerung|W-9005|2026-10-18', klaer_wert: 'nicht versendet', faelligkeit: '2026-10-18' },
    { anlagen_id: 'W-9006', zeile: 7, aktion: 'wartet', faelligkeit: '2026-10-18' }] };
  const zeilen = [{ id: 1, schluessel: 'angebot|W-9001|2026-11-07', aktion: 'reserviert', lauf_id: '6990', zeit_utc: '2026-09-27T06:00:00.000Z' },
    { id: 2, schluessel: 'erinnerung|W-9005|2026-10-18', aktion: 'reserviert', lauf_id: '6990', zeit_utc: '2026-09-27T06:00:00.000Z' }];
  const r = la.klaerungsAuftrag(plan, anl, zeilen, AN_SPALTEN, { lauf_id: '7000', lauf_start: '2026-09-28T06:00:00.000Z', stichtag: '2026-09-28',
    zeit_utc: '2026-09-28T06:00:09.000Z' }, KV);
  const w = {};
  r.data.forEach((d) => { w[d.range] = d.values[0][0]; });
  assert.deepEqual([w["'Anlagen'!R2"], w["'Anlagen'!Q2"], w["'Anlagen'!X2"]], [46293, 'Angebot versendet', '']);
  assert.equal(w["'Anlagen'!T2"], undefined);
  assert.deepEqual([w["'Anlagen'!X6"], w["'Anlagen'!S6"]], ['', undefined]);
  assert.equal(w["'Anlagen'!X7"], undefined);
  assert.deepEqual(r.eintraege.map((e) => [e.schluessel, e.aktion, e.lauf_id, e.datum]),
    [['angebot|W-9001|2026-11-07', 'versendet', '7000', '2026-09-28'], ['erinnerung|W-9005|2026-10-18', 'zurueckgegeben', '7000', '2026-09-28']]);
  assert.deepEqual(r.hinweise.map((h) => h.anlagen_id + ': ' + h.text), ['W-9001: Versandstatus geklärt: versendet – nachgezogen',
    'W-9005: Versandstatus geklärt: nicht versendet – Reservierung zurückgegeben, nächster Lauf entscheidet neu',
    'W-9006: Versandstatus klären ohne anstehende Mail – nichts geändert']);
  const tr = la.klaerungsAuftrag(plan, anl, null, AN_SPALTEN, { lauf_id: '7000', stichtag: '2026-09-28' }, KV);
  assert.deepEqual([tr.data, tr.eintraege, tr.hinweise.length], [[], [], 3]);
  assert.match(tr.hinweise[0].text, /im Modus trocken nicht verarbeitet/);
});

test('A3: Sammelmeldung - nachgezogene Mails (schon versendet, im Gesendet-Ordner gefunden) eigener Abschnitt, nicht unter „Nicht versendet“', () => {
  const anl = [anlage(9001), anlage(9019)];
  const plan = { versand: [], alarme: [], hinweise: [], entscheidungen: [] };
  const m = la.baueSammelmeldung({ firma: 'F', modus: 'test', stichtag: '2026-09-28', lauf_id: '1', anlagen: anl, aufgaben: [], plan,
    versand_ergebnisse: [{ anlagen_id: 'W-9001', aktion: 'angebot', vorgang: 'W-9001/2026-11', ergebnis: 'nachgezogen', grund: 'im Gesendet-Ordner gefunden – nachgezogen' },
      { anlagen_id: 'W-9019', aktion: 'angebot', vorgang: 'W-9019/2026-10', ergebnis: 'schon versendet', grund: 'schon versendet – nachgezogen' }] });
  assert.match(m.text, /Nachgezogen \(war schon versendet, nicht erneut gesendet\):\n- Angebot W-9001 \(Kunde Beispiel 01, Gas-Brennwerttherme\) – im Gesendet-Ordner gefunden – nachgezogen\n- Angebot W-9019/);
  assert.doesNotMatch(m.text, /Nicht versendet/);
});

test('W10 (BAUPLAN f): Anthropic ohne 2xx → Alarm in der Sammelmeldung (Kunde gesperrt aus Zweifel); Kontrolle ohne KI-Fehler kein Alarm', () => {
  assert.deepEqual(la.alarmeAusAntworten({ ki_fehler: 2, ki_aufrufe: 3 }), [{ art: 'KI-Einordnung fehlgeschlagen',
    text: '2 Antworten ohne Einordnung – aus Zweifel gesperrt; bitte lesen und bei Bedarf „Widerspruch aufheben“' }]);
  assert.deepEqual(la.alarmeAusAntworten({ ki_fehler: 0, ki_aufrufe: 3 }), []);
  assert.deepEqual(la.alarmeAusAntworten({}), []);
});

test('E4 (Befund Vorhersage G2): Aufheben leert „Werbewiderspruch“ bei ALLEN Anlagen des Kunden (Kunden-ID oder E-Mail) - sonst sperrt die Zelle einer zweiten Anlage ihn wieder', () => {
  const { AN_SPALTEN } = require('../kern/anlagen.js');
  const plan = { entscheidungen: [
    { anlagen_id: 'W-9011', kunden_id: 'K-9011', email_norm: 'kunde-11@example.invalid', zeile: 12, aktion: 'gesperrt', grund: 'Werbewiderspruch',
      aufheben: { grund: 'Kunde hat telefonisch um Angebote gebeten' } },
    { anlagen_id: 'W-9042', kunden_id: 'K-9011', email_norm: 'kunde-11@example.invalid', zeile: 41, aktion: 'gesperrt', grund: 'Werbewiderspruch' },
    { anlagen_id: 'W-9043', kunden_id: 'K-9043', email_norm: 'kunde-11@example.invalid', zeile: 42, aktion: 'gesperrt', grund: 'Werbewiderspruch' },
    { anlagen_id: 'W-9034', kunden_id: 'K-9034', email_norm: 'kunde-34@example.invalid', zeile: 35, aktion: 'gesperrt', grund: 'Werbewiderspruch' }] };
  const r = la.zustandZellen(plan, {}, [anlage(9011), anlage(9042), anlage(9043), anlage(9034)], AN_SPALTEN, LAUF, []);
  const w = {};
  r.data.forEach((d) => { w[d.range] = d.values[0][0]; });
  assert.deepEqual([w["'Anlagen'!N12"], w["'Anlagen'!N41"], w["'Anlagen'!N42"], w["'Anlagen'!N35"]], ['', '', '', 'ja']);
  assert.deepEqual([w["'Anlagen'!O12"], w["'Anlagen'!O41"]], ['', undefined]);
});
