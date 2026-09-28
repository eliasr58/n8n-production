'use strict';
// entwerfen.js: Unterworkflow „Entwurf schreiben“ (PLAN-QUELLEN Vertrag 3, Baustein 5) - Eingang (Aufruffehler werfen), Stapel
// vorbereiten (Wortliste und ohne Text ohne KI, Anfrage nur mit maskiertem Text), Abschluss (Schema, Leitplanken, KI-Fehler als
// Status statt Wurf), Status-Item zuerst. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('../kern/entwerfen.js');
const ew = require('../kern/entwurf.js');
const FIX = require('./testdaten/b1-fixtures.json');

const K = Object.assign({}, require('../kern/maskierung.js'), require('../kern/leitplanken.js'), require('../kern/bausteine.js'), { entwurfEntscheiden: ew.entwurfEntscheiden });
const SIG = FIX.betrieb.signatur;
const E = { betrieb: FIX.betrieb.name, signatur: SIG, kontaktweg: FIX.betrieb.kontaktweg, domain: FIX.betrieb.domain, hoechstlaenge: 800,
  verboten: '', hoechstzahl_entwuerfe: 20 };
const BS = { 'ohne Text 1': 'Guten Tag,\n\ndanke. {kontaktweg}\n\n{signatur}', 'ohne Text 2': 'Guten Tag,\n\ndanke. {kontaktweg}\n\n{signatur}',
  'ohne Text 3': 'Guten Tag,\n\ndanke. {kontaktweg}\n\n{signatur}', 'ohne Text 4': 'Guten Tag,\n\nvielen Dank!\n\n{signatur}',
  'ohne Text 5': 'Guten Tag,\n\nvielen Dank!\n\n{signatur}', unfair: 'Guten Tag,\n\nwir nehmen das ernst. {kontaktweg}\n\n{signatur}' };
const fx = (nr) => FIX.fixtures.find((f) => f.nr === nr);
const BW = (nr) => ({ sterne: fx(nr).sterne, text: fx(nr).text, anzeigename: fx(nr).anzeigename });
const EIN = (bewertungen, abw) => [Object.assign({ einstellungen: E, bausteine: BS, bewertungen }, abw || {})];
const ki = (o, usage) => ({ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(o) }],
  usage: usage || { input_tokens: 1200, output_tokens: 90 } } });
const GUT = 'Guten Tag,\n\nvielen Dank für Ihre freundliche Bewertung! Über Ihre Rückmeldung freuen wir uns.\n\n' + SIG;
const lauf = (bewertungen, antwortFuer) => {
  const e = en.pruefeEingangEntwurf(EIN(bewertungen));
  const v = en.entwurfVorbereiten(e, K);
  return { v, aus: en.entwurfAbschliessen(e, v.vorlaeufig, v.ki_liste.map((x) => antwortFuer(x)), K) };
};

test('Eingang: gültig → Einstellungen, Bausteine, Bewertungen; Aufruffehler werfen mit „Entwurf schreiben“, ohne „: “', () => {
  const e = en.pruefeEingangEntwurf(EIN([BW('M01')]));
  assert.deepEqual([e.bewertungen.length, e.einstellungen.betrieb, Object.keys(e.bausteine).length], [1, FIX.betrieb.name, 6]);
  assert.equal(en.pruefeEingangEntwurf(EIN([])).bewertungen.length, 0);
  const zu = Array.from({ length: 21 }, () => BW('M01'));
  const faelle = [[], EIN([]).concat(EIN([])), [null], EIN([BW('M01')], { einstellungen: undefined }), EIN([BW('M01')], { einstellungen: Object.assign({}, E, { signatur: ' ' }) }),
    EIN([BW('M01')], { einstellungen: Object.assign({}, E, { hoechstlaenge: 0 }) }), EIN([BW('M01')], { bausteine: Object.assign({}, BS, { unfair: '' }) }),
    EIN([BW('M01')], { bausteine: undefined }), EIN(undefined), EIN(zu), EIN([BW('M01')], { einstellungen: Object.assign({}, E, { hoechstzahl_entwuerfe: 0 }) }),
    EIN([{ sterne: 5, text: 7, anzeigename: '' }]), EIN([{ sterne: 5, text: 'Gut.' }])];
  faelle.forEach((f, i) => {
    let text = null;
    try { en.pruefeEingangEntwurf(f); } catch (x) { text = x.message; }
    assert.ok(text !== null && /Entwurf schreiben/.test(text), 'Fall ' + i + ' ohne Wurf');
    assert.equal(text.indexOf(': '), -1, text);
  });
});

test('Vorbereiten: Wortliste und ohne Text ohne KI; KI-Liste nur mit maskiertem Text - keine Bewertungs-ID, kein Anzeigename', () => {
  const e = en.pruefeEingangEntwurf(EIN([BW('M01'), { sterne: 5, text: '', anzeigename: 'Bewerter Probe 21' }, { sterne: 1, text: 'Mein Anwalt meldet sich.', anzeigename: 'Bewerter Probe 29' },
    BW('M13'), { sterne: 5, text: 'Herr Beispielmann war super, Bewerter Probe 02 sagt danke.', anzeigename: 'Bewerter Probe 02' }]));
  const v = en.entwurfVorbereiten(e, K);
  assert.deepEqual(v.ki_liste.map((x) => x.nr), [0, 4]);
  assert.deepEqual(v.vorlaeufig.map((x) => x.ki_noetig), [true, false, false, false, true]);
  const j = JSON.stringify(v.ki_liste);
  for (const nicht of ['Beispielmann', 'Bewerter Probe', 'R-80', 'R-90']) assert.ok(!j.includes(nicht), nicht);
  assert.ok(j.includes('Herr <NAME>'));
  assert.deepEqual(Object.keys(v.ki_liste[0]).sort(), ['anfrage', 'nr']);
});

test('Sterne ohne Wert (null, 0, 6, „FIVE“) → selbst lesen, kein KI-Aufruf, kein Wurf', () => {
  for (const s of [null, 0, 6, 'FIVE', 4.5]) {
    const { v, aus } = lauf([{ sterne: s, text: 'Gut gemacht.', anzeigename: '' }], () => assert.fail('KI'));
    assert.deepEqual([v.ki_liste.length, aus[1].status, aus[1].grund, aus[1].ki_aufruf, aus[1].entwurf], [0, 'selbst_lesen', 'Sterne ohne Wert', false, '']);
  }
});

test('Abschluss: gültige Antwort → ok mit Entwurf und vorbelegter Antwort; Status-Item zuerst mit Zählung und Token', () => {
  const { aus } = lauf([BW('M01'), { sterne: 5, text: '👍', anzeigename: '' }], () => ki({ kategorie: 'positiv', sicher: true, gruende: [], entwurf: GUT }));
  assert.deepEqual(aus.map((j) => j.art), ['status', 'entwurf', 'entwurf']);
  assert.deepEqual([aus[0].anzahl, aus[0].ok, aus[0].selbst_lesen, aus[0].ki_fehler, aus[0].ki_aufrufe, aus[0].tokens_ein, aus[0].tokens_aus, aus[0].modell],
    [2, 2, 0, 0, 1, 1200, 90, ew.KI_MODELL]);
  assert.deepEqual([aus[1].nr, aus[1].status, aus[1].ki_aufruf, aus[1].kategorie, aus[1].entwurf, aus[1].antwort, aus[1].http_status, aus[1].stop_reason, aus[1].tokens_ein],
    [0, 'ok', true, 'positiv', GUT, GUT, 200, 'end_turn', 1200]);
  assert.deepEqual([aus[2].nr, aus[2].status, aus[2].ki_aufruf, aus[2].kategorie, aus[2].entwurf], [1, 'ok', false, 'ohne Text', 'Guten Tag,\n\nvielen Dank!\n\n' + SIG]);
});

test('KI-Fehler → Status ki_fehler mit Grund, kein Entwurf, kein Wurf: HTTP 401, Schema (max_tokens), Zeitüberschreitung', () => {
  const faelle = [
    [{ statusCode: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }, 'HTTP 401', 401],
    [{ statusCode: 200, body: { type: 'message', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"kategorie":"positiv","sicher":true,"gruende":[],"entwu' }],
      usage: { input_tokens: 1200, output_tokens: 20 } } }, 'stop_reason max_tokens', 200],
    [{ error: { message: 'The connection was aborted, perhaps the server is offline' }, details: { httpCode: 'ECONNABORTED' } }, 'Zeitüberschreitung (ECONNABORTED)', ''],
    [{ error: { message: 'The connection was aborted, perhaps the server is offline', httpCode: 'ECONNABORTED' } }, 'Zeitüberschreitung (ECONNABORTED)', ''],
    [{ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: 'kein json' }] } }, 'kein JSON', 200],
  ];
  for (const [antwort, grund, http] of faelle) {
    const { aus } = lauf([BW('M01')], () => antwort);
    assert.deepEqual([aus[1].status, aus[1].grund, aus[1].entwurf, aus[1].antwort, aus[1].kategorie, aus[1].http_status], ['ki_fehler', grund, '', '', '', http], grund);
    assert.equal(aus[0].ki_fehler, 1);
  }
});

test('Abschluss: KI heikel → selbst lesen ohne Entwurf; Kategorie ohne Entwurf → selbst lesen; Wortliste → selbst lesen ohne KI', () => {
  const h = lauf([BW('M09')], () => ki({ kategorie: 'heikel', sicher: true, gruende: ['verletzung_schaden'], entwurf: 'Guten Tag, das tut uns leid.' })).aus[1];
  assert.deepEqual([h.status, h.grund, h.entwurf, h.ki_aufruf, h.aufgaben], ['selbst_lesen', 'KI heikel', '', true, ['Meldung an Google oder Anwalt prüfen']]);
  const o = lauf([BW('M01')], () => ki({ kategorie: 'positiv', sicher: true, gruende: ['anweisung_im_text'], entwurf: '' })).aus[1];
  assert.deepEqual([o.status, o.grund], ['selbst_lesen', 'Kategorie ohne Entwurf']);
  const w = lauf([BW('M13')], () => assert.fail('KI')).aus[1];
  assert.deepEqual([w.status, w.grund, w.ki_aufruf, w.kategorie], ['selbst_lesen', 'Wortliste heikel', false, 'heikel']);
});

test('Leitplanken am Entwurf: harter Treffer → ok, Antwort nicht vorbelegt; „Leistung bestätigt“ → weicher Hinweis; unfair → Baustein', () => {
  const hart = lauf([BW('M05')], () => ki({ kategorie: 'kritisch', sicher: true, gruende: [], entwurf: 'Guten Tag,\n\nIhr Auftrag war uns wichtig.\n\n' + SIG })).aus[1];
  assert.deepEqual([hart.status, hart.antwort, hart.hinweise.some((x) => /^hart: /.test(x))], ['ok', '', true]);
  const weich = lauf([BW('M01')], () => ki({ kategorie: 'positiv', sicher: true, gruende: [], entwurf: 'Guten Tag,\n\nschön, dass Sie mit unserer Arbeit zufrieden sind.\n\n' + SIG })).aus[1];
  assert.deepEqual([weich.status, weich.antwort !== '', weich.hinweise.includes('weich: Kundenbeziehung angedeutet')], ['ok', true, true]);
  const u = lauf([BW('M07')], () => ki({ kategorie: 'unfair', sicher: true, gruende: ['beleidigung'], entwurf: 'frei' })).aus[1];
  assert.deepEqual([u.status, u.kategorie, u.entwurf.startsWith('Guten Tag,\n\nwir nehmen das ernst.'), u.aufgaben], ['ok', 'unfair', true, ['Meldung an Google prüfen']]);
});

test('Abschluss wirft bei Unerwartetem: weniger oder mehr KI-Antworten als KI-Liste', () => {
  const e = en.pruefeEingangEntwurf(EIN([BW('M01'), BW('M02')]));
  const v = en.entwurfVorbereiten(e, K);
  for (const n of [1, 3]) assert.throws(() => en.entwurfAbschliessen(e, v.vorlaeufig, Array.from({ length: n }, () => ki({})), K), /Entwurf schreiben/);
});

test('gekürzt: Text über 2 000 Zeichen wird gekürzt gemeldet, die Anfrage trägt höchstens 2 000 Zeichen Bewertung', () => {
  const lang = 'Wir sind zufrieden. '.repeat(150);
  const { v, aus } = lauf([{ sterne: 4, text: lang, anzeigename: '' }], () => ki({ kategorie: 'positiv', sicher: true, gruende: [], entwurf: GUT }));
  const inhalt = v.ki_liste[0].anfrage.messages[0].content;
  const bewertung = inhalt.slice(inhalt.indexOf('<bewertung>\n') + 12, inhalt.lastIndexOf('\n</bewertung>'));
  assert.deepEqual([bewertung.length <= 2000, aus[1].gekuerzt], [true, true]);
  assert.equal(lauf([BW('M01')], () => ki({ kategorie: 'positiv', sicher: true, gruende: [], entwurf: GUT })).aus[1].gekuerzt, false);
});
