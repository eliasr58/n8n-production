'use strict';
// entscheidung.js: Fälligkeit, Zyklus, Sperre (BAUPLAN b, c 5-6, d), Plan-Sicherungen.
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('../kern/entscheidung.js');
const { STICHTAG, einstellungen, anlage, wartungFuerFaelligIn } = require('./hilfen.js');

const E = einstellungen();
const leer = () => en.sperrZustand([]);
const ent = (a, abw) => en.entscheideAnlage(a, Object.assign({ e: E, stichtag: STICHTAG, sperre: leer(), antwort: null }, abw || {}));
const plane = (anlagen, abw) => en.planeLauf(Object.assign({
  einstellungen: E, stichtag: STICHTAG, anlagen, sperrzeilen: [], antworten: {}, antworten_gelesen: true, textbausteine_fehler: [],
}, abw || {}));
const aktion = (plan, id) => plan.entscheidungen.find((d) => d.anlagen_id === id).aktion;

// ---- Datum und Fälligkeit -------------------------------------------------------------------------------

test('übernommene Tagesarithmetik (aus Mahnlauf stufen.test.js)', () => {
  assert.equal(en.datumPlusTage('2026-02-27', 2), '2026-03-01');
  assert.equal(en.datumPlusTage('2026-03-01', -1), '2026-02-28');
  assert.equal(en.tageZwischen('2026-09-20', '2026-09-23'), 3);
  assert.equal(en.tageZwischen('2026-10-24', '2026-10-26'), 2);
});

test('plusMonate: Monatsende-Regel und Schaltjahr', () => {
  assert.equal(en.plusMonate('2026-01-31', 1), '2026-02-28');
  assert.equal(en.plusMonate('2027-01-31', 13), '2028-02-29');
  assert.equal(en.plusMonate('2026-03-31', 1), '2026-04-30');
  assert.equal(en.plusMonate('2025-10-20', 12), '2026-10-20');
  assert.equal(en.plusMonate('2026-11-15', 2), '2027-01-15');
  assert.throws(() => en.plusMonate('2026-02-30', 1));
  assert.throws(() => en.plusMonate('2026-01-01', 1.5));
});

test('naechsteFaelligkeit: letzte Wartung vor Einbaudatum, Standardintervall bei leerem Intervall', () => {
  assert.deepEqual(en.naechsteFaelligkeit(anlage(9001), 12), { ok: true, faelligkeit: '2026-10-20', basis: 'letzte Wartung' });
  assert.deepEqual(en.naechsteFaelligkeit(anlage(9002, { letzte_wartung: '', einbaudatum: '2025-11-03' }), 12),
    { ok: true, faelligkeit: '2026-11-03', basis: 'Einbaudatum' });
  assert.equal(en.naechsteFaelligkeit(anlage(9003, { intervall: null }), 24).faelligkeit, '2027-10-20');
  assert.equal(en.naechsteFaelligkeit(anlage(9004, { intervall: 0 }), 12).ok, false);
  assert.equal(en.naechsteFaelligkeit(anlage(9005, { intervall: 61 }), 12).ok, false);
  assert.equal(en.naechsteFaelligkeit(anlage(9006, { letzte_wartung: '', einbaudatum: '' }), 12).ok, false);
  assert.equal(en.naechsteFaelligkeit(anlage(9007, { letzte_wartung: 'ungültig: 31.02.' }), 12).ok, false);
});

test('Vorgangsnummer aus Anlagen-ID und Fälligkeitsmonat', () => {
  assert.equal(en.vorgangNummer('W-9001', '2026-10-20'), 'W-9001/2026-10');
});

// ---- Angebot, Erinnerung, Abschluss --------------------------------------------------------------------

test('W01: Angebot im Vorlauf (40 Tage), Kontrolle 44 Tage nicht fällig', () => {
  assert.equal(ent(anlage(9001, { letzte_wartung: wartungFuerFaelligIn(40) })).aktion, 'angebot');
  assert.equal(ent(anlage(9002, { letzte_wartung: wartungFuerFaelligIn(44) })).aktion, 'nicht_faellig');
  assert.equal(ent(anlage(9003, { letzte_wartung: wartungFuerFaelligIn(42) })).aktion, 'angebot');
  assert.equal(ent(anlage(9004, { letzte_wartung: wartungFuerFaelligIn(43) })).aktion, 'nicht_faellig');
});

test('W21: verpasst nach dem Nachlauf, Kontrolle innerhalb', () => {
  assert.equal(ent(anlage(9001, { letzte_wartung: wartungFuerFaelligIn(-31) })).aktion, 'verpasst');
  assert.equal(ent(anlage(9002, { letzte_wartung: wartungFuerFaelligIn(-30) })).aktion, 'angebot');
  assert.equal(ent(anlage(9003, { letzte_wartung: wartungFuerFaelligIn(-20) })).aktion, 'angebot');
});

test('W03: Erinnerung genau nach 14 Tagen, Kontrolle 13 Tage wartet', () => {
  const f = wartungFuerFaelligIn(20);
  assert.equal(ent(anlage(9005, { letzte_wartung: f, angebot_am: '2026-09-14' })).aktion, 'erinnerung');
  assert.equal(ent(anlage(9006, { letzte_wartung: f, angebot_am: '2026-09-15' })).aktion, 'wartet');
});

test('nach der Erinnerung keine zweite; nach dem Antwortfenster abgeschlossen', () => {
  const f = wartungFuerFaelligIn(5);
  assert.equal(ent(anlage(9005, { letzte_wartung: f, angebot_am: '2026-08-20', erinnerung_am: '2026-09-10' })).aktion, 'wartet');
  assert.equal(ent(anlage(9005, { letzte_wartung: f, angebot_am: '2026-08-20', erinnerung_am: '2026-09-07' })).aktion, 'abgeschlossen');
});

test('E5: abgeschlossen ohne Wartungsdatum seit zwölf Monaten nach Fälligkeit → Hinweis', () => {
  const d = ent(anlage(9005, { letzte_wartung: '2024-09-01', angebot_am: '2025-07-25', erinnerung_am: '2025-08-10' }));
  assert.equal(d.aktion, 'abgeschlossen');
  assert.ok(d.hinweise.some((h) => /zwölf Monate/.test(h)));
  const k = ent(anlage(9006, { letzte_wartung: '2025-02-01', angebot_am: '2025-12-25', erinnerung_am: '2026-01-10' }));
  assert.equal(k.aktion, 'abgeschlossen');
  assert.equal(k.hinweise.length, 0);
});

test('W04: eine Antwort beendet den Zyklus für Mails; Abwesenheit nicht; Unzustellbar ohne Erinnerung', () => {
  const a = anlage(9007, { letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-14' });
  assert.equal(ent(a, { antwort: { art: 'antwort', klasse: 'termin', datum: '2026-09-27' } }).aktion, 'beantwortet');
  assert.equal(ent(a, { antwort: { art: 'abwesenheit', datum: '2026-09-15' } }).aktion, 'erinnerung');
  assert.equal(ent(a, { antwort: { art: 'unzustellbar', datum: '2026-09-14' } }).aktion, 'unzustellbar');
  assert.equal(ent(Object.assign({}, a, { antwort: 'Termin gewünscht, 27.09.2026' })).aktion, 'beantwortet');
  assert.equal(ent(Object.assign({}, a, { status: 'unzustellbar' })).aktion, 'unzustellbar');
});

test('W15: neues Wartungsdatum eröffnet einen neuen Zyklus, Kontrolle ohne Eintrag', () => {
  const alt = { faelligkeit_zelle: '2026-10-20', angebot_am: '2026-09-08', antwort: 'Termin gewünscht, 10.09.2026', status: 'beantwortet' };
  const neu = ent(anlage(9007, Object.assign({}, alt, { letzte_wartung: '2026-09-25' })));
  assert.equal(neu.zyklus_neu, true);
  assert.equal(neu.faelligkeit, '2027-09-25');
  assert.equal(neu.aktion, 'nicht_faellig');
  const bleibt = ent(anlage(9007, Object.assign({}, alt, { letzte_wartung: '2025-10-20' })));
  assert.equal(bleibt.zyklus_neu, false);
  assert.equal(bleibt.aktion, 'beantwortet');
});

// ---- Sperre (Widerspruch) --------------------------------------------------------------------------------

test('sperrZeilen: je ein Schlüssel für Kunden-ID und normalisierte E-Mail', () => {
  assert.deepEqual(en.sperrZeilen('K-9001', ' Kunde-01@Example.INVALID ', 'Antwort'), [
    { schluessel: 'widerspruch|kunde|K-9001', aktion: 'gesperrt', grund: 'Antwort' },
    { schluessel: 'widerspruch|mail|kunde-01@example.invalid', aktion: 'gesperrt', grund: 'Antwort' },
  ]);
  assert.throws(() => en.sperrZeilen('K-9001', 'x@example.invalid', 'weil'));
});

test('sperrZustand: Reihenfolge nach id, aufgehoben hebt auf, erneut gesperrt sperrt', () => {
  const z = en.sperrZustand([
    { id: 3, schluessel: 'widerspruch|kunde|K-1', aktion: 'aufgehoben', grund: 'neue Einwilligung vom 01.10.2026' },
    { id: 1, schluessel: 'widerspruch|kunde|K-1', aktion: 'gesperrt', grund: 'Antwort' },
    { id: 2, schluessel: 'widerspruch|kunde|K-2', aktion: 'gesperrt', grund: 'Zweifel' },
    { id: 4, schluessel: 'widerspruch|kunde|K-2', aktion: 'aufgehoben', grund: 'neue Einwilligung vom 02.10.2026' },
    { id: 5, schluessel: 'widerspruch|kunde|K-2', aktion: 'gesperrt', grund: 'Wortliste' },
    { id: 6, schluessel: 'angebot|W-1|2026-10-20', aktion: 'versendet' },
  ]);
  assert.equal(z.kunden['K-1'], undefined);
  assert.equal(z.kunden['K-2'].grund, 'Wortliste');
});

test('W06/W12: gesperrt über Kunden-ID', () => {
  const sperre = en.sperrZustand([{ id: 1, schluessel: 'widerspruch|kunde|K-9001', aktion: 'gesperrt', grund: 'Antwort' }]);
  const d = ent(anlage(9001, { letzte_wartung: wartungFuerFaelligIn(30) }), { sperre });
  assert.equal(d.aktion, 'gesperrt');
  assert.equal(ent(anlage(9002, { letzte_wartung: wartungFuerFaelligIn(30) }), { sperre }).aktion, 'angebot');
});

test('W12: gesperrt über E-Mail bei neuer Kunden-ID (Groß-/Kleinschreibung egal)', () => {
  const sperre = en.sperrZustand([{ id: 1, schluessel: 'widerspruch|mail|kunde-01@example.invalid', aktion: 'gesperrt', grund: 'Antwort' }]);
  const d = ent(anlage(9001, { kunden_id: 'K-NEU', email: 'Kunde-01@Example.invalid', letzte_wartung: wartungFuerFaelligIn(30) }), { sperre });
  assert.equal(d.aktion, 'gesperrt');
  assert.equal(ent(anlage(9002, { letzte_wartung: wartungFuerFaelligIn(30) }), { sperre }).aktion, 'angebot');
});

test('W11: Sperre überlebt leere Zelle (Zelle wird nachgetragen), Zelle ohne Data Table wird nachgetragen', () => {
  const sperre = en.sperrZustand([{ id: 1, schluessel: 'widerspruch|kunde|K-9001', aktion: 'gesperrt', grund: 'Antwort' }]);
  const d = ent(anlage(9001, { werbewiderspruch: false, letzte_wartung: '2026-09-01' }), { sperre });
  assert.equal(d.aktion, 'gesperrt');
  assert.equal(d.zelle_nachtragen, true);
  const z = ent(anlage(9002, { werbewiderspruch: true, letzte_wartung: wartungFuerFaelligIn(30) }));
  assert.equal(z.aktion, 'gesperrt');
  assert.equal(z.sperre_nachtragen, true);
});

test('E4: Aufheben wird vorgemerkt, wirkt aber erst nach dem Schreiben (in diesem Lauf gesperrt)', () => {
  const sperre = en.sperrZustand([{ id: 1, schluessel: 'widerspruch|kunde|K-9001', aktion: 'gesperrt', grund: 'Zweifel' }]);
  const d = ent(anlage(9001, { werbewiderspruch: true, widerspruch_aufheben: 'neue Einwilligung vom 01.10.2026',
    letzte_wartung: wartungFuerFaelligIn(30) }), { sperre });
  assert.equal(d.aktion, 'gesperrt');
  assert.deepEqual(d.aufheben, { grund: 'neue Einwilligung vom 01.10.2026' });
  const kurz = ent(anlage(9001, { werbewiderspruch: true, widerspruch_aufheben: 'ok', letzte_wartung: wartungFuerFaelligIn(30) }), { sperre });
  assert.equal(kurz.aufheben, null);
  assert.ok(kurz.hinweise.some((h) => /Grund/.test(h)));
});

// ---- Pause, Pflichtangaben, Mängel ------------------------------------------------------------------------

test('W21: Pause gewinnt; Pause ohne Grund bleibt Pause mit Hinweis', () => {
  const f = wartungFuerFaelligIn(30);
  assert.equal(ent(anlage(9001, { pause: true, pause_grund: 'Haus verkauft', letzte_wartung: f })).aktion, 'pausiert');
  const o = ent(anlage(9002, { pause: true, pause_grund: '', letzte_wartung: f }));
  assert.equal(o.aktion, 'pausiert');
  assert.ok(o.hinweise.some((h) => /Grund/.test(h)));
});

test('W13: Pflichtangaben § 7 Abs. 3 UWG — je fehlende Angabe keine Mail, Kontrolle vollständig', () => {
  const f = wartungFuerFaelligIn(30);
  const faelle = [
    { leistung: '' }, { leistung: 'Beratung' }, { erhoben_bei: '' }, { hinweis_erhebung: '' },
    { hinweis_erhebung: 'ungültig: 32.13.' }, { hinweis_erhebung: '2026-09-29' }, { email: '' }, { email: 'kein-at.example.invalid' },
  ];
  for (const abw of faelle) {
    const d = ent(anlage(9001, Object.assign({ letzte_wartung: f }, abw)));
    assert.equal(d.aktion, 'pflichtangabe', JSON.stringify(abw));
  }
  for (const l of ['Einbau', 'Wartung', 'Reparatur']) {
    assert.equal(ent(anlage(9002, { leistung: l, letzte_wartung: f })).aktion, 'angebot', l);
  }
});

test('Mängel aus dem Lesen (Dublette, unlesbares Datum) → keine Mail', () => {
  const f = wartungFuerFaelligIn(30);
  assert.equal(ent(anlage(9001, { letzte_wartung: f, mangel: ['Anlagen-ID doppelt'] })).aktion, 'mangel');
  assert.equal(ent(anlage(9002, { letzte_wartung: f, intervall: 'x' })).aktion, 'mangel');
  assert.equal(ent(anlage(9003, { letzte_wartung: f, angebot_am: 'ungültig: 1.1.' })).aktion, 'mangel');
});

// ---- Plan: Sicherungen über alle Anlagen ------------------------------------------------------------------

test('Plan: Versandliste nur Angebot und Erinnerung', () => {
  const plan = plane([
    anlage(9001, { letzte_wartung: wartungFuerFaelligIn(30) }),
    anlage(9002, { letzte_wartung: wartungFuerFaelligIn(90) }),
    anlage(9003, { letzte_wartung: wartungFuerFaelligIn(10), angebot_am: '2026-09-01' }),
  ]);
  assert.deepEqual(plan.versand.map((d) => [d.anlagen_id, d.aktion]), [['W-9001', 'angebot'], ['W-9003', 'erinnerung']]);
  assert.equal(plan.alarme.length, 0);
});

test('E6: höchstens eine Mail je Kunde und Lauf (früheste Fälligkeit zuerst), auch über gleiche E-Mail', () => {
  const plan = plane([
    anlage(9001, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(35) }),
    anlage(9002, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(20), email: 'kunde-02@example.invalid' }),
    anlage(9003, { kunden_id: 'K-3', email: 'Kunde-02@example.invalid', letzte_wartung: wartungFuerFaelligIn(25) }),
    anlage(9004, { kunden_id: 'K-4', letzte_wartung: wartungFuerFaelligIn(25) }),
  ]);
  assert.equal(aktion(plan, 'W-9002'), 'angebot');
  assert.equal(aktion(plan, 'W-9001'), 'naechster_werktag');
  assert.equal(aktion(plan, 'W-9003'), 'naechster_werktag');
  assert.equal(aktion(plan, 'W-9004'), 'angebot');
  assert.equal(plan.versand.length, 2);
});

test('W17: Mengenbremse bei 21 von 20, Kontrolle 20 von 20', () => {
  const viele = (n) => Array.from({ length: n }, (_, i) => anlage(9100 + i, { letzte_wartung: wartungFuerFaelligIn(30) }));
  const r = plane(viele(21));
  assert.equal(r.mengenbremse.gerissen, true);
  assert.equal(r.versand.length, 0);
  assert.ok(r.alarme.some((a) => a.art === 'Mengenbremse'));
  assert.ok(r.entscheidungen.every((d) => d.aktion === 'mengenbremse' && d.aktion_geplant === 'angebot'));
  const k = plane(viele(20));
  assert.equal(k.mengenbremse.gerissen, false);
  assert.equal(k.versand.length, 20);
});

test('Frische: ohne vollständig gelesene Antworten kein Versand im ganzen Lauf, Alarm', () => {
  const a = [anlage(9001, { letzte_wartung: wartungFuerFaelligIn(30) })];
  const r = plane(a, { antworten_gelesen: false });
  assert.equal(r.versand.length, 0);
  assert.equal(aktion(r, 'W-9001'), 'antworten_ungelesen');
  assert.ok(r.alarme.some((x) => x.art === 'Antworten nicht gelesen'));
  assert.equal(plane(a).versand.length, 1);
});

test('W14: Textbausteine ungültig → kein Versand, Alarm', () => {
  const a = [anlage(9001, { letzte_wartung: wartungFuerFaelligIn(30) })];
  const r = plane(a, { textbausteine_fehler: ['Erinnerung: Text ohne {widerspruch}'] });
  assert.equal(r.versand.length, 0);
  assert.equal(aktion(r, 'W-9001'), 'textbausteine');
  assert.ok(r.alarme.some((x) => x.art === 'Textbausteine ungültig'));
});

test('Plan: Antworten dieses Laufs wirken (Antwort vor Erinnerung)', () => {
  const a = [anlage(9007, { letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-14' })];
  const r = plane(a, { antworten: { 'W-9007': { art: 'antwort', klasse: 'rueckfrage', datum: '2026-09-27' } } });
  assert.equal(aktion(r, 'W-9007'), 'beantwortet');
  assert.equal(r.versand.length, 0);
});

test('Plan: ungültige Einstellung wirft (fail-closed)', () => {
  assert.throws(() => plane([], { einstellungen: einstellungen({ hoechstzahl_mails: NaN }) }), /Einstellung ungültig/);
  assert.throws(() => plane([], { einstellungen: einstellungen({ vorlauf: -1 }) }), /Einstellung ungültig/);
});

// ---- Neu entscheiden vor dem Versand -----------------------------------------------------------------------

test('vergleichePlanung: gleich nur bei gleicher Aktion und gleichem Vorgang', () => {
  const g = ent(anlage(9001, { letzte_wartung: wartungFuerFaelligIn(30) }));
  assert.equal(en.vergleichePlanung(g, g).gleich, true);
  const gesperrt = ent(anlage(9001, { werbewiderspruch: true, letzte_wartung: wartungFuerFaelligIn(30) }));
  assert.equal(en.vergleichePlanung(g, gesperrt).gleich, false);
  const andererZyklus = ent(anlage(9001, { letzte_wartung: wartungFuerFaelligIn(31) }));
  assert.equal(en.vergleichePlanung(g, andererZyklus).gleich, false);
  assert.equal(en.vergleichePlanung(g, null).gleich, false);
});

// ---- Empfänger und Stichtag (übernommen) ------------------------------------------------------------------

test('übernommen: Modus test erzwingt den Testempfänger, trocken sendet nicht', () => {
  assert.deepEqual(en.waehleEmpfaenger('test', 'kunde-01@example.invalid', 'test@example.invalid'),
    { senden: true, an: 'test@example.invalid', grund: 'Modus test: Testempfänger erzwungen' });
  assert.equal(en.waehleEmpfaenger('test', 'kunde-01@example.invalid', '').senden, false);
  assert.equal(en.waehleEmpfaenger('trocken', 'kunde-01@example.invalid', 'test@example.invalid').senden, false);
  assert.equal(en.waehleEmpfaenger('scharf', 'kunde-01@example.invalid', 'test@example.invalid').an, 'kunde-01@example.invalid');
});

test('übernommen: Stichtag nur in test und trocken', () => {
  assert.equal(en.bestimmeStichtag('test', '2026-10-01', STICHTAG).stichtag, '2026-10-01');
  assert.equal(en.bestimmeStichtag('scharf', '2026-10-01', STICHTAG).stichtag, STICHTAG);
});

// ---- Teil A 7: offene Antwort ---------------------------------------------------------------------------------

const mitAntwort = (nr, abw) => anlage(nr, Object.assign({ kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(20),
  angebot_am: '2026-09-14', antwort: 'Rückfrage, 20.09.2026', status: 'beantwortet', antwort_erledigt: false }, abw || {}));

test('Teil A 7: offene Antwort — kein Angebot an eine andere Anlage des Kunden, bis „Antwort erledigt“; Kontrolle erledigt', () => {
  const b = anlage(9002, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(30) });
  const r = plane([mitAntwort(9001), b]);
  assert.equal(aktion(r, 'W-9001'), 'beantwortet');
  assert.equal(aktion(r, 'W-9002'), 'antwort_offen');
  assert.equal(r.entscheidungen.find((d) => d.anlagen_id === 'W-9002').aktion_geplant, 'angebot');
  assert.equal(r.versand.length, 0);
  const k = plane([mitAntwort(9001, { antwort_erledigt: true }), b]);
  assert.equal(aktion(k, 'W-9002'), 'angebot');
});

test('Teil A 7: auch keine Erinnerung; auch über dieselbe E-Mail bei anderer Kunden-ID', () => {
  const erinnerung = anlage(9002, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-14' });
  assert.equal(aktion(plane([mitAntwort(9001), erinnerung]), 'W-9002'), 'antwort_offen');
  const gleicheMail = anlage(9003, { kunden_id: 'K-3', email: 'Kunde-01@example.invalid', letzte_wartung: wartungFuerFaelligIn(30) });
  assert.equal(aktion(plane([mitAntwort(9001), gleicheMail]), 'W-9003'), 'antwort_offen');
  const fremd = anlage(9004, { kunden_id: 'K-4', letzte_wartung: wartungFuerFaelligIn(30) });
  assert.equal(aktion(plane([mitAntwort(9001), fremd]), 'W-9004'), 'angebot');
});

test('Teil A 7: Antwort aus diesem Lauf und noch nicht eingeordnete Antwort sperren weitere Mails; erledigt gilt nicht für eine neue Antwort', () => {
  const a = anlage(9001, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-14' });
  const b = anlage(9002, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(30) });
  const neu = { 'W-9001': { art: 'antwort', klasse: 'termin', datum: '2026-09-27', eingeordnet: true } };
  assert.equal(aktion(plane([a, b], { antworten: neu }), 'W-9002'), 'antwort_offen');
  const nichtEingeordnet = { 'W-9001': { art: 'antwort', klasse: '', datum: '2026-09-27', eingeordnet: false } };
  assert.equal(aktion(plane([a, b], { antworten: nichtEingeordnet }), 'W-9002'), 'antwort_offen');
  const erledigtAlt = Object.assign({}, a, { antwort: 'Rückfrage, 20.09.2026', antwort_erledigt: true });
  assert.equal(aktion(plane([erledigtAlt, b], { antworten: neu }), 'W-9002'), 'antwort_offen');
});

test('Teil A 7: Kontrollen — Abwesenheit ist keine offene Antwort; ein neuer Zyklus schließt die alte Antwort', () => {
  // Angebot vor fünf Tagen: W-9001 wartet (keine eigene Mail in diesem Lauf, E6 greift nicht)
  const a = anlage(9001, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-23' });
  const b = anlage(9002, { kunden_id: 'K-1', letzte_wartung: wartungFuerFaelligIn(30) });
  const abw = { 'W-9001': { art: 'abwesenheit', datum: '2026-09-15', eingeordnet: true } };
  assert.equal(aktion(plane([a, b], { antworten: abw }), 'W-9002'), 'angebot');
  const neuerZyklus = mitAntwort(9001, { faelligkeit_zelle: '2026-10-18', letzte_wartung: '2026-09-25' });
  assert.equal(aktion(plane([neuerZyklus, b]), 'W-9002'), 'angebot');
});

// ---- Baustein 5: welche Threads werden gelesen --------------------------------------------------------------

test('zuLesendeThreads: nur mit Thread-ID, nicht gesperrt, letzte eigene Mail höchstens „Antworten lesen bis“ Tage zurück', () => {
  const anl = [
    anlage(9001, { thread_id: 'T1', angebot_am: '2026-09-14' }),
    anlage(9002, { thread_id: '' , angebot_am: '2026-09-14' }),
    anlage(9003, { thread_id: 'T3', angebot_am: '2026-03-01', erinnerung_am: '2026-04-01' }),
    anlage(9004, { thread_id: 'T4', angebot_am: '2026-03-01', erinnerung_am: '2026-03-31' }),
    anlage(9005, { thread_id: 'T5', angebot_am: '' }),
    anlage(9006, { thread_id: 'T6', angebot_am: '2026-09-14', werbewiderspruch: true }),
    anlage(9007, { thread_id: 'T7', angebot_am: '2026-09-14' }),
  ];
  const sperre = en.sperrZustand([{ id: 1, schluessel: 'widerspruch|mail|kunde-07@example.invalid', aktion: 'gesperrt', grund: 'Antwort' }]);
  const r = en.zuLesendeThreads(anl, sperre, STICHTAG, E);
  // 9003: letzte eigene Mail 01.04. = 180 Tage vor dem 28.09. → noch lesen; 9004: 181 Tage → nicht; 9005 ohne Datum → lesen
  // Auftrag 27.09. nachmittags: W-9002 hat ein Angebot, aber keine Thread-ID (z. B. nach „Versandstatus klären“) → nur Vorgangssuche
  assert.deepEqual(r.map((x) => [x.anlagen_id, x.thread_id, !!x.nur_suche]), [['W-9001', 'T1', false], ['W-9002', '', true], ['W-9003', 'T3', false], ['W-9005', 'T5', false]]);
  assert.deepEqual(Object.keys(r[0]).sort(), ['anlagen_id', 'email_norm', 'kunden_id', 'thread_id', 'vorgang']);
  assert.equal(r[1].ab_ms, Date.UTC(2026, 8, 14) - 2 * 3600e3);
  // Teil B: der Vorgang des laufenden Zyklus fuer die Vorgangssuche (Abmeldung per Klick, Antwort auf die Erinnerung)
  assert.deepEqual(r.map((x) => x.vorgang), ['W-9001/2026-10', 'W-9002/2026-10', 'W-9003/2026-10', 'W-9005/2026-10']);
  assert.equal(en.zuLesendeThreads([anlage(9008, { thread_id: 'T8', intervall: 99 })], en.sperrZustand([]), STICHTAG, E)[0].vorgang, '');
});

// ---- Auftrag 27.09.2026 nachmittags, Teil A ---------------------------------------------------------------------------------

const vz = (id, aktion, schluessel, datum, abw) => Object.assign({ id, schluessel, aktion, lauf_id: '6900', datum, zeit_utc: datum + 'T06:00:00.000Z' }, abw || {});

test('A1: E6 je Kalendertag - heuteVersendet aus der Data Table (Versand heute, auch nur reserviert); Kontrolle gestern', () => {
  const anl = [anlage(9030, { kunden_id: 'K-9029', email: 'kunde-29@example.invalid' }), anlage(9029, { kunden_id: 'K-9029', email: 'kunde-29@example.invalid' })];
  const z = [vz(1, 'reserviert', 'angebot|W-9030|2026-10-23', '2026-09-28'), vz(2, 'versendet', 'angebot|W-9030|2026-10-23', '2026-09-28'),
    vz(3, 'versendet', 'angebot|W-9001|2026-11-07', '2026-09-27'), vz(4, 'gesperrt', 'widerspruch|kunde|K-9011', '2026-09-28'),
    vz(5, 'reserviert', 'erinnerung|W-9005|2026-10-18', '2026-09-28', { kunden_id: 'K-9005' })];
  const h = en.heuteVersendet(z, anl, '2026-09-28');
  assert.deepEqual(h.map((x) => [x.anlagen_id, x.kunden_id, x.email_norm]),
    [['W-9030', 'K-9029', 'kunde-29@example.invalid'], ['W-9005', 'K-9005', '']]);
  assert.deepEqual(en.heuteVersendet(z, anl, '2026-09-29'), []);
});

test('A1: E6 je Kalendertag - zweite Anlage des Kunden wartet, wenn heute schon eine Mail ging; am Folgetag geht sie; Kontrolle anderer Kunde', () => {
  const a29 = anlage(9029, { kunden_id: 'K-9029', email: 'kunde-29@example.invalid', letzte_wartung: wartungFuerFaelligIn(35) });
  const a4 = anlage(9004, { letzte_wartung: wartungFuerFaelligIn(25) });
  const heute = [{ anlagen_id: 'W-9030', kunden_id: 'K-9029', email_norm: 'kunde-29@example.invalid' }];
  const p = plane([a29, a4], { heute_versendet: heute });
  assert.equal(aktion(p, 'W-9029'), 'naechster_werktag');
  assert.match(p.entscheidungen[0].grund, /heute schon eine Mail/);
  assert.equal(aktion(p, 'W-9004'), 'angebot');
  assert.equal(aktion(plane([a29, a4], { heute_versendet: [] }), 'W-9029'), 'angebot');
  // auch über dieselbe E-Mail bei anderer Kunden-ID
  assert.equal(aktion(plane([a29], { heute_versendet: [{ anlagen_id: 'W-1', kunden_id: 'K-X', email_norm: 'kunde-29@example.invalid' }] }), 'W-9029'), 'naechster_werktag');
});

test('A2: zuLesendeThreads - alte Vorgänge aus der Data Table 180 Tage nach Versand (alt), Zykluswechsel im selben Lauf ist alt; Kontrolle 181 Tage', () => {
  const zeilen = [vz(1, 'versendet', 'angebot|W-9001|2025-10-20', '2025-09-10', { thread_id: 'T-ALT' }),
    vz(2, 'versendet', 'angebot|W-9001|2025-04-01', '2025-03-31', { thread_id: 'T-ZU-ALT' }),
    vz(3, 'versendet', 'angebot|W-9001|2026-10-20', '2026-09-14', { thread_id: 'T1' })];
  const neu = anlage(9001, { letzte_wartung: '2025-10-20', thread_id: 'T1', angebot_am: '2026-09-14' });
  const r = en.zuLesendeThreads([neu], en.sperrZustand([]), STICHTAG, E, zeilen.map((z) => Object.assign({}, z, { datum: z.datum })));
  assert.deepEqual(r.map((x) => [x.thread_id, x.vorgang, !!x.alt]), [['T1', 'W-9001/2026-10', false]]);
  const z2 = [vz(1, 'versendet', 'angebot|W-9001|2025-10-20', '2026-04-01', { thread_id: 'T-ALT' }), vz(2, 'versendet', 'angebot|W-9001|2025-05-20', '2026-03-31', { thread_id: 'T-ZU-ALT' })];
  const r2 = en.zuLesendeThreads([neu], en.sperrZustand([]), STICHTAG, E, z2);
  assert.deepEqual(r2.map((x) => [x.thread_id, x.vorgang, !!x.alt]), [['T1', 'W-9001/2026-10', false], ['T-ALT', 'W-9001/2025-10', true]]);
  // Zykluswechsel in diesem Lauf: die Zelle traegt noch die alte Faelligkeit und den alten Thread -> alt
  const wechsel = anlage(9002, { letzte_wartung: '2026-09-25', faelligkeit_zelle: '2026-10-18', thread_id: 'T2', angebot_am: '2026-09-06' });
  const r3 = en.zuLesendeThreads([wechsel], en.sperrZustand([]), STICHTAG, E, []);
  assert.deepEqual(r3.map((x) => [x.thread_id, x.vorgang, !!x.alt]), [['T2', 'W-9002/2026-10', true]]);
  // ohne Data Table (trocken) wie bisher
  assert.deepEqual(en.zuLesendeThreads([neu], en.sperrZustand([]), STICHTAG, E).map((x) => x.thread_id), ['T1']);
});

test('A3: Versandstatus klären hält die Mail an (kein Versand in diesem Lauf) und nennt den Schlüssel der anstehenden Mail', () => {
  const a = anlage(9001, { letzte_wartung: wartungFuerFaelligIn(40), versandstatus_klaeren: 'versendet' });
  const e5 = anlage(9005, { letzte_wartung: wartungFuerFaelligIn(20), angebot_am: '2026-09-14', versandstatus_klaeren: 'nicht versendet' });
  const p = plane([a, e5, anlage(9004, { letzte_wartung: wartungFuerFaelligIn(40) })]);
  const d = (id) => p.entscheidungen.find((x) => x.anlagen_id === id);
  assert.deepEqual([d('W-9001').aktion, d('W-9001').aktion_geplant, d('W-9001').klaer_schluessel], ['versandstatus', 'angebot', 'angebot|W-9001|2026-11-07']);
  assert.deepEqual([d('W-9005').aktion, d('W-9005').klaer_schluessel], ['versandstatus', 'erinnerung|W-9005|2026-10-18']);
  assert.equal(d('W-9004').aktion, 'angebot');
  assert.deepEqual(p.versand.map((x) => x.anlagen_id), ['W-9004']);
});
