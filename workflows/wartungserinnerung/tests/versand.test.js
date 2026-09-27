'use strict';
// versand.js: Versand EINER Mail (Baustein 6, Auftrag 27.09.2026) - Sperrschluessel, Neu-Entscheiden, Mail mit
// List-Unsubscribe (Teil B), Erinnerung im Thread, Nachpruefung, Zellen nach dem Versand. Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const vs = require('../kern/versand.js');
const K = Object.assign({}, require('../kern/entscheidung.js'), require('../kern/textbausteine.js'), require('../kern/mime.js'),
  require('../kern/einstellungen.js'), require('../kern/anlagen.js'), require('../kern/meldung.js'));
const { anlage, wartungFuerFaelligIn } = require('./hilfen.js');

const EINST = [['Schlüssel', 'Wert'], ['Modus', 'test'], ['Testempfänger', 'test@example.invalid'], ['Stichtag (nur Test)', '2026-09-28'],
  ['Absendername', 'Heizung & Sanitär Beispiel GmbH (Test)'], ['Absenderadresse', 'info@example.invalid'], ['Antwort an', 'antwort@example.invalid'],
  ['Meldeadresse', 'meldung@example.invalid'], ['Firmenname', 'Heizung & Sanitär Beispiel GmbH'], ['Telefon', '0000 000000'],
  ['Signatur', 'Heizung & Sanitär Beispiel GmbH'], ['Vorlauf Angebot', 42], ['Nachlauf', 30], ['Erinnerung nach', 14], ['Antwortfenster', 21],
  ['Antworten lesen bis', 180], ['Standardintervall', 12], ['Höchstzahl Mails je Lauf', 20], ['KI-Einordnung', 'an'], ['Versandtage', 'Mo–Fr'],
  ['Uhrzeit', '08:00']];
const TB = [['Art', 'Betreff', 'Text'],
  ['Angebot', 'Wartung Ihrer {anlage} – {vorgang}', 'Guten Tag {kunde},\n\nIhre {anlage} ist im {faellig_monat} fällig.\n\n{signatur}\n\n{widerspruch}'],
  ['Erinnerung', 'Erinnerung: Wartung Ihrer {anlage} – {vorgang}', 'Guten Tag {kunde},\n\nErinnerung.\n\n{signatur}\n\n{widerspruch}']];
const SP = K.leseAnlagen([[]]) && require('../kern/anlagen.js').AN_SPALTEN;
const FELD = { 'Anlagen-ID': 'anlagen_id', 'Kunden-ID': 'kunden_id', Kunde: 'kunde', 'E-Mail': 'email', Anlage: 'anlage',
  'Leistung des Betriebs': 'leistung', 'Adresse erhoben bei': 'erhoben_bei', 'Widerspruchshinweis bei Erhebung': 'hinweis_erhebung',
  Einbaudatum: 'einbaudatum', 'letzte Wartung': 'letzte_wartung', 'Intervall (Monate)': 'intervall', 'Angebot am': 'angebot_am',
  'Erinnerung am': 'erinnerung_am', 'Thread-ID': 'thread_id', Status: 'status', Pause: 'pause', 'Pause Grund': 'pause_grund',
  Werbewiderspruch: 'werbewiderspruch' };
const zeile = (a) => SP.map((s) => (FELD[s] ? (a[FELD[s]] === null || a[FELD[s]] === undefined ? '' : a[FELD[s]]) : ''));
const blatt = (liste) => [SP].concat(liste.map(zeile));
const A1 = anlage(9001, { letzte_wartung: wartungFuerFaelligIn(40) });
const A5 = anlage(9005, { letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-14', thread_id: 'T05', status: 'Angebot versendet' });
const eingang = (abw) => Object.assign({ tabelle_id: 'TAB', sperre_tabelle_id: 'DT', lauf_id: '7000', lauf_start: '2026-09-28T06:00:00.000Z',
  modus: 'test', stichtag: '2026-09-28', anlagen_id: 'W-9001', aktion: 'angebot', faelligkeit: '2026-11-07', vorgang: 'W-9001/2026-11',
  antworten: {}, antworten_gelesen: true }, abw || {});
const b64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1');
const kopfteil = (raw) => b64(raw).split('\r\n\r\n')[0];

test('versandSchluessel: Aktion, Anlagen-ID, Fälligkeit; unbekannte Aktion wirft', () => {
  assert.equal(vs.versandSchluessel('angebot', 'W-9001', '2026-11-07'), 'angebot|W-9001|2026-11-07');
  assert.equal(vs.versandSchluessel('erinnerung', 'W-9005', '2026-10-18'), 'erinnerung|W-9005|2026-10-18');
  assert.throws(() => vs.versandSchluessel('mahnung', 'W-9001', '2026-11-07'));
  assert.throws(() => vs.versandSchluessel('angebot', '', '2026-11-07'));
});

test('übernommen: sperreEntscheid - früheste Reservierung gewinnt, versendet gewinnt, abgebrochener Lauf nie erneut', () => {
  const r = (id, aktion, lauf, zeit) => ({ id, schluessel: 'angebot|W-9001|2026-11-07', aktion, lauf_id: lauf, zeit_utc: zeit || '2026-09-28T06:00:01.000Z' });
  assert.deepEqual(vs.sperreEntscheid([r(1, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z').weiter, true);
  assert.equal(vs.sperreEntscheid([r(1, 'reserviert', '6999'), r(2, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z').grund, 'übersprungen, anderer Lauf');
  assert.equal(vs.sperreEntscheid([r(1, 'reserviert', '6999'), r(2, 'versendet', '6999'), r(3, 'reserviert', '7000')], '7000').grund, 'schon versendet');
  const tot = vs.sperreEntscheid([r(1, 'reserviert', '6990', '2026-09-27T06:00:00.000Z'), r(2, 'reserviert', '7000')], '7000', '2026-09-28T06:00:00.000Z');
  assert.deepEqual([tot.weiter, tot.grund], [false, 'Reservierung eines abgebrochenen Laufs']);
});

test('Teil B: abmeldeKopf - List-Unsubscribe mit mailto an „Antwort an“, Betreff „Abmelden <Vorgang>“, URL-kodiert', () => {
  assert.equal(vs.abmeldeKopf('antwort@example.invalid', 'W-9001/2026-11'),
    'List-Unsubscribe: <mailto:antwort@example.invalid?subject=Abmelden%20W-9001%2F2026-11>');
  assert.throws(() => vs.abmeldeKopf('kaputt', 'W-9001/2026-11'));
  assert.throws(() => vs.abmeldeKopf('antwort@example.invalid', ''));
});

test('kopfEinfuegen: Zeilen vor MIME-Version; Zeilenumbruch oder Nicht-ASCII in einer Zeile wirft (Kopfinjektion)', () => {
  const n = 'From: a@example.invalid\r\nTo: b@example.invalid\r\nSubject: x\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nText\r\n';
  const m = vs.kopfEinfuegen(n, ['X-Test: 1', 'X-Zwei: 2']);
  assert.equal(m, 'From: a@example.invalid\r\nTo: b@example.invalid\r\nSubject: x\r\nX-Test: 1\r\nX-Zwei: 2\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\nText\r\n');
  assert.throws(() => vs.kopfEinfuegen(n, ['X-Test: 1\r\nBcc: c@example.invalid']));
  assert.throws(() => vs.kopfEinfuegen(n, ['X-Test: ä']));
  assert.throws(() => vs.kopfEinfuegen('ohne Kopf', ['X-Test: 1']));
});

test('baueKundenmail: Angebot im Modus test an den Testempfänger, From mit Absendername, Reply-To, List-Unsubscribe, Hinweis', () => {
  const m = vs.baueKundenmail({ werte_einstellungen: EINST, modus: 'test', anlage: A1, aktion: 'angebot', faelligkeit: '2026-11-07',
    textbausteine: TB, referenz: null }, K);
  assert.equal(m.ok, true);
  assert.equal(m.an, 'test@example.invalid');
  assert.equal(m.betreff, 'Wartung Ihrer Gas-Brennwerttherme – W-9001/2026-11');
  assert.equal(m.thread_id, '');
  const k = kopfteil(m.raw);
  assert.match(k, /^From: =\?UTF-8\?B\?SGVpenVuZyAmIFNhbml0w6RyIEJlaXNwaWVsIEdtYkggKFRlc3Qp\?= <info@example\.invalid>\r\n/);
  assert.match(k, /\r\nTo: test@example\.invalid\r\n/);
  assert.match(k, /\r\nReply-To: antwort@example\.invalid\r\n/);
  assert.match(k, /\r\nList-Unsubscribe: <mailto:antwort@example\.invalid\?subject=Abmelden%20W-9001%2F2026-11>\r\nMIME-Version: 1\.0\r\n/);
  assert.doesNotMatch(k, /In-Reply-To|References/);
  assert.ok(K.hinweisEnthalten(m.text));
  assert.ok(!b64(m.raw).includes('kunde-01@example.invalid'));
});

test('baueKundenmail: Erinnerung mit threadId, In-Reply-To und References der ersten eigenen Mail', () => {
  const m = vs.baueKundenmail({ werte_einstellungen: EINST, modus: 'test', anlage: A5, aktion: 'erinnerung', faelligkeit: '2026-10-18',
    textbausteine: TB, referenz: { thread_id: 'T05', message_id: '<m0-05@beispiel.invalid>' } }, K);
  assert.equal(m.ok, true);
  assert.equal(m.thread_id, 'T05');
  assert.equal(m.betreff, 'Erinnerung: Wartung Ihrer Gas-Brennwerttherme – W-9005/2026-10');
  const k = kopfteil(m.raw);
  assert.match(k, /\r\nIn-Reply-To: <m0-05@beispiel\.invalid>\r\nReferences: <m0-05@beispiel\.invalid>\r\n/);
  assert.match(k, /List-Unsubscribe: <mailto:antwort@example\.invalid\?subject=Abmelden%20W-9005%2F2026-10>/);
});

test('baueKundenmail: ohne gültigen Testempfänger, mit kaputtem Textbaustein oder Modus trocken → ok false, kein raw', () => {
  const ohne = vs.baueKundenmail({ werte_einstellungen: EINST.map((z) => (z[0] === 'Testempfänger' ? [z[0], ''] : z)), modus: 'test', anlage: A1,
    aktion: 'angebot', faelligkeit: '2026-11-07', textbausteine: TB, referenz: null }, K);
  assert.deepEqual([ohne.ok, ohne.raw], [false, undefined]);
  const tb = vs.baueKundenmail({ werte_einstellungen: EINST, modus: 'test', anlage: A1, aktion: 'angebot', faelligkeit: '2026-11-07',
    textbausteine: [TB[0], [TB[1][0], TB[1][1], 'ohne Hinweis'], TB[2]], referenz: null }, K);
  assert.equal(tb.ok, false);
  const tr = vs.baueKundenmail({ werte_einstellungen: EINST, modus: 'trocken', anlage: A1, aktion: 'angebot', faelligkeit: '2026-11-07',
    textbausteine: TB, referenz: null }, K);
  assert.equal(tr.ok, false);
});

test('referenzAusThread: früheste eigene Mail (SENT) liefert Message-ID und Thread-ID; ohne eigene Mail oder HTTP-Fehler null', () => {
  const m = (id, ms, lab, mid) => ({ id, internalDate: String(ms), labelIds: lab, payload: { headers: [{ name: 'Message-ID', value: mid }] } });
  const r = { statusCode: 200, body: { id: 'T05', messages: [m('b', 3, ['SENT'], '<zwei@x>'), m('r', 2, ['INBOX'], '<kunde@x>'), m('a', 1, ['SENT'], '<eins@x>')] } };
  assert.deepEqual(vs.referenzAusThread(r), { thread_id: 'T05', message_id: '<eins@x>' });
  assert.equal(vs.referenzAusThread({ statusCode: 200, body: { id: 'T', messages: [m('r', 2, ['INBOX'], '<k@x>')] } }), null);
  assert.equal(vs.referenzAusThread({ statusCode: 404, body: {} }), null);
});

test('neuEntscheidenVersand: frische Entscheidung gleich der Planung → senden; Sperre, Pause, Modus oder Zeile geändert → nichts', () => {
  const werte = { einstellungen: EINST, anlagen: blatt([A1, A5]), textbausteine: TB };
  const ok = vs.neuEntscheidenVersand({ eingang: eingang(), werte, sperrzeilen: [] }, K);
  assert.deepEqual([ok.schritt, ok.grund], ['senden', '']);
  assert.equal(ok.anlage.anlagen_id, 'W-9001');
  const sp = vs.neuEntscheidenVersand({ eingang: eingang(), werte, sperrzeilen: [{ id: 1, schluessel: 'widerspruch|kunde|K-9001', aktion: 'gesperrt', grund: 'Antwort' }] }, K);
  assert.deepEqual([sp.schritt, /geändert seit Laufbeginn/.test(sp.grund)], ['nichts', true]);
  const pa = vs.neuEntscheidenVersand({ eingang: eingang(), werte: Object.assign({}, werte, { anlagen: blatt([Object.assign({}, A1, { pause: true }), A5]) }), sperrzeilen: [] }, K);
  assert.equal(pa.schritt, 'nichts');
  const mo = vs.neuEntscheidenVersand({ eingang: eingang(), werte: Object.assign({}, werte, { einstellungen: EINST.map((z) => (z[0] === 'Modus' ? [z[0], 'trocken'] : z)) }), sperrzeilen: [] }, K);
  assert.deepEqual([mo.schritt, /Modus/.test(mo.grund)], ['nichts', true]);
  const weg = vs.neuEntscheidenVersand({ eingang: eingang({ anlagen_id: 'W-9099' }), werte, sperrzeilen: [] }, K);
  assert.equal(weg.schritt, 'nichts');
  const er = vs.neuEntscheidenVersand({ eingang: eingang({ anlagen_id: 'W-9005', aktion: 'erinnerung', faelligkeit: '2026-10-18', vorgang: 'W-9005/2026-10' }), werte, sperrzeilen: [] }, K);
  assert.equal(er.schritt, 'senden');
});

test('neuEntscheidenVersand: eine Antwort dieses Laufs (aus dem Hauptlauf) verhindert die Erinnerung', () => {
  const werte = { einstellungen: EINST, anlagen: blatt([A1, A5]), textbausteine: TB };
  const r = vs.neuEntscheidenVersand({ eingang: eingang({ anlagen_id: 'W-9005', aktion: 'erinnerung', faelligkeit: '2026-10-18', vorgang: 'W-9005/2026-10',
    antworten: { 'W-9005': { art: 'antwort', klasse: 'termin', datum: '2026-09-27' } } }), werte, sperrzeilen: [] }, K);
  assert.equal(r.schritt, 'nichts');
});

test('übernommen: nachpruefung - Label SENT und To genau der Empfänger', () => {
  const g = (lab, to) => ({ statusCode: 200, body: { labelIds: lab, payload: { headers: [{ name: 'To', value: to }] } } });
  assert.deepEqual(vs.nachpruefung(g(['SENT'], 'test@example.invalid'), 'test@example.invalid'), { im_gesendet: true, to_gleich_empfaenger: true, to_anzahl: 1 });
  assert.equal(vs.nachpruefung(g(['SENT'], 'a@example.invalid, test@example.invalid'), 'test@example.invalid').to_gleich_empfaenger, false);
  assert.equal(vs.nachpruefung({ statusCode: 404 }, 'test@example.invalid').im_gesendet, false);
});

test('zellenNachVersand: Angebot → Angebot am (Seriennummer), Thread-ID, Status; Erinnerung → Erinnerung am, Status, Thread-ID bleibt', () => {
  const a = vs.zellenNachVersand({ zeile: 2, aktion: 'angebot', datum: '2026-09-28', thread_id: 'T01' }, SP);
  assert.deepEqual(a, [{ range: "'Anlagen'!R2", values: [[46293]] }, { range: "'Anlagen'!T2", values: [['T01']] },
    { range: "'Anlagen'!Q2", values: [['Angebot versendet']] }]);
  const e = vs.zellenNachVersand({ zeile: 6, aktion: 'erinnerung', datum: '2026-09-28', thread_id: 'T99' }, SP);
  assert.deepEqual(e, [{ range: "'Anlagen'!S6", values: [[46293]] }, { range: "'Anlagen'!Q6", values: [['Erinnerung versendet']] }]);
  assert.throws(() => vs.zellenNachVersand({ zeile: 2, aktion: 'angebot', datum: '2026-09-28', thread_id: 'T01' }, SP.slice(1)));
});

// ---- Auftrag 27.09.2026 nachmittags, Teil A 3: Versandstatus klären (nach Mahnlauf versand.js klaereVersandstatus, Tests dort
// "B10 A 4" angepasst: Schlüssel „aktion|Anlagen-ID|Fälligkeit“ statt „Rechnungsnr.|Stufe“, ohne Stufenprüfung) ----------------
const START = '2026-09-28T06:00:00.000Z';
const ALT = '2026-09-27T06:00:00.000Z';
const SCH = 'angebot|W-9001|2026-11-07';
const rz = (id, aktion, lauf, zeit, abw) => Object.assign({ id, schluessel: SCH, aktion, lauf_id: lauf, zeit_utc: zeit, gmail_id: '', datum: '' }, abw || {});
const KL = (wert, zeilen) => vs.klaereVersandstatusWartung(wert, SCH, zeilen, '7000', START, '2026-09-28');

test('A3: versendet + Reservierung eines abgebrochenen Laufs → nachziehen mit dem Tag des Laufs, Eintrag versendet; schon versendet → Datum von dort', () => {
  assert.deepEqual(KL('versendet', [rz(1, 'reserviert', '6990', ALT), rz(2, 'reserviert', '1', ALT, { schluessel: 'angebot|W-9002|2026-11-07' })]), {
    aktion: 'versandstatus_versendet', schluessel: SCH, datum: '2026-09-28', thread_id: '',
    grund: 'Versandstatus geklärt: versendet – nachgezogen', eintrag: { aktion: 'versendet', datum: '2026-09-28' } });
  const schon = KL(' Versendet ', [rz(1, 'reserviert', '6990', ALT), rz(2, 'versendet', '6991', ALT, { datum: '2026-09-27', thread_id: 'T9' })]);
  assert.deepEqual([schon.aktion, schon.datum, schon.thread_id, schon.eintrag], ['versandstatus_versendet', '2026-09-27', 'T9', null]);
});

test('A3: versendet ohne offene Reservierung, unbekannter Wert → Hinweis, nichts geändert; leer → null', () => {
  assert.deepEqual(KL('versendet', []), { aktion: 'hinweis', schluessel: SCH, datum: '', thread_id: '', eintrag: null,
    grund: 'Versandstatus klären ohne offene Reservierung – nichts geändert' });
  assert.equal(KL('versendet', [rz(1, 'reserviert', '6999', '2026-09-28T06:00:02.000Z')]).aktion, 'hinweis');
  assert.equal(KL('vielleicht', [rz(1, 'reserviert', '6990', ALT)]).grund, 'Versandstatus klären: Wert „vielleicht“ unbekannt (erlaubt: versendet, nicht versendet)');
  assert.equal(KL('', [rz(1, 'reserviert', '6990', ALT)]), null);
});

test('A3: nicht versendet → Schlüssel zurückgeben; ohne Reservierung nur Zelle leeren; widerspricht einer Versandbestätigung → Hinweis', () => {
  const z = KL('nicht versendet', [rz(1, 'reserviert', '6990', ALT)]);
  assert.deepEqual([z.aktion, z.eintrag], ['versandstatus_zurueck', { aktion: 'zurueckgegeben', datum: '2026-09-28' }]);
  const leer = KL('nicht versendet', []);
  assert.deepEqual([leer.aktion, leer.eintrag], ['versandstatus_zurueck', null]);
  assert.equal(KL('nicht versendet', [rz(1, 'reserviert', '6990', ALT), rz(2, 'versendet', '6990', ALT)]).aktion, 'hinweis');
  assert.equal(KL('nicht versendet', [rz(1, 'reserviert', '6999', '2026-09-28T06:00:02.000Z')]).aktion, 'hinweis');
});

test('A3: Gesendet-Suche nach abgebrochenem Lauf über die Vorgangsnummer - Suchausdruck ab 60 s vor der Reservierung', () => {
  assert.equal(vs.gesendetSuche('W-9001/2026-11', '2026-09-27T06:00:00.000Z'), 'in:sent subject:"W-9001/2026-11" after:' + (Date.UTC(2026, 8, 27, 6, 0, 0) / 1000 - 60));
  assert.throws(() => vs.gesendetSuche('', ALT));
  assert.throws(() => vs.gesendetSuche('W-9001/2026-11', 'kaputt'));
});

test('A1: neuEntscheidenVersand kennt die Tagesgrenze - heute schon eine Mail an denselben Kunden (andere Anlage, Data Table) → nichts', () => {
  const A2 = anlage(9002, { kunden_id: 'K-9001', email: 'kunde-01@example.invalid', letzte_wartung: wartungFuerFaelligIn(10) });
  const werte = { einstellungen: EINST, anlagen: blatt([A1, A2]), textbausteine: TB };
  const heute = [{ id: 1, schluessel: 'angebot|W-9002|2026-10-08', aktion: 'versendet', lauf_id: '6999', datum: '2026-09-28', kunden_id: 'K-9001' }];
  // W-9002 ist früher fällig und wäre die Mail des Laufs; sie ging heute schon → W-9001 wartet auf morgen
  const r = vs.neuEntscheidenVersand({ eingang: eingang(), werte: Object.assign({}, werte, { anlagen: blatt([A1, Object.assign({}, A2, { angebot_am: '2026-09-28' })]) }),
    sperrzeilen: heute }, K);
  assert.deepEqual([r.schritt, /geändert seit Laufbeginn/.test(r.grund)], ['nichts', true]);
  const gestern = [Object.assign({}, heute[0], { datum: '2026-09-27' })];
  const g = vs.neuEntscheidenVersand({ eingang: eingang(), werte: Object.assign({}, werte, { anlagen: blatt([A1, Object.assign({}, A2, { angebot_am: '2026-09-27' })]) }),
    sperrzeilen: gestern }, K);
  assert.equal(g.schritt, 'senden');
});
