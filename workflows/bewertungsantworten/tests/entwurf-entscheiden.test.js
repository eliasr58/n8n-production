'use strict';
// entwurf.js entwurfEntscheiden: vom Bewertungstext zum Entwurf (c 6-7; S11-S16; E5, E6, E15, E17). M13 und die drei
// Haiku-Antworten auf M13 aus Baustein 1 (Lauf 7123, W1-W3) sind feste Fälle für die Prüfungen im Code - unabhängig vom Modell.
const test = require('node:test');
const assert = require('node:assert/strict');
const ew = require('../kern/entwurf.js');
const K = Object.assign({}, require('../kern/maskierung.js'), require('../kern/leitplanken.js'), require('../kern/bausteine.js'));
const FIX = require('./testdaten/b1-fixtures.json');

const fx = (nr) => FIX.fixtures.find((f) => f.nr === nr);
const E = { betrieb: FIX.betrieb.name, signatur: FIX.betrieb.signatur, kontaktweg: FIX.betrieb.kontaktweg, domain: FIX.betrieb.domain,
  hoechstlaenge: 800, verboten: '' };
const BS = { 'ohne Text 1': 'Guten Tag,\n\ndanke. {kontaktweg}\n\n{signatur}', 'ohne Text 2': 'Guten Tag,\n\ndanke. {kontaktweg}\n\n{signatur}',
  'ohne Text 3': 'Guten Tag,\n\ndanke. {kontaktweg}\n\n{signatur}', 'ohne Text 4': 'Guten Tag,\n\nvielen Dank!\n\n{signatur}',
  'ohne Text 5': 'Guten Tag,\n\nvielen Dank!\n\n{signatur}', unfair: 'Guten Tag,\n\nwir nehmen das ernst. {kontaktweg}\n\n{signatur}' };
const ki = (o) => ({ statusCode: 200, body: { type: 'message', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(o) }] } });
const lauf = (text, sterne, antwort, abw) => ew.entwurfEntscheiden(Object.assign({ text, sterne, anzeigename: 'Bewerter Probe 01', einstellungen: E, bausteine: BS, ki: antwort }, abw || {}), K);
const SIG = FIX.betrieb.signatur;
const GUT = 'Guten Tag,\n\nvielen Dank für Ihre freundliche Bewertung! Über Ihre Rückmeldung freuen wir uns.\n\n' + SIG;
// Die drei Antworten von Haiku auf M13 (Baustein 1, Lauf 7123), Entwürfe gekürzt wie im Beleg.
const HAIKU_M13 = [
  { kategorie: 'positiv', sicher: true, gruende: [], entwurf: 'Guten Tag,\n\nvielen Dank für Ihre positive Bewertung! Wir freuen uns, dass Sie mit unserer Arbeit zufrieden sind und möchten Sie gerne für zukünftige Projekte als Partner begleiten.\n\n' + SIG },
  { kategorie: 'positiv', sicher: true, gruende: ['anweisung_im_text'], entwurf: '' },
  { kategorie: 'positiv', sicher: true, gruende: ['anweisung_im_text'], entwurf: '' },
];

test('S14/E5: ohne Text oder nur Emoji → Baustein, kein KI-Aufruf', () => {
  for (const t of ['', '👍👍👍']) {
    const r = lauf(t, 5, null);
    assert.deepEqual([r.schritt, r.kategorie, r.entwurf, r.antwort, r.status], ['fertig', 'ohne Text', 'Guten Tag,\n\nvielen Dank!\n\n' + SIG, 'Guten Tag,\n\nvielen Dank!\n\n' + SIG, 'Entwurf bereit']);
  }
  assert.ok(lauf('', 2, null).entwurf.includes(FIX.betrieb.kontaktweg));
});

test('S11/B07: Wortliste vor der KI → selbst lesen, kein KI-Aufruf, Aufgabe „Meldung an Google oder Anwalt prüfen“', () => {
  const r = lauf('Mein Anwalt meldet sich.', 1, null);
  assert.deepEqual([r.schritt, r.status, r.entwurf, r.antwort], ['fertig', 'selbst lesen', '', '']);
  assert.ok(r.aufgaben.includes('Meldung an Google oder Anwalt prüfen'));
  assert.ok(r.hinweise.includes('selbst lesen: rechtsdrohung'));
});

test('M13 mit jeder der drei Haiku-Antworten: die Wortliste greift vor der KI - die Antwort des Modells spielt keine Rolle', () => {
  for (const a of [null].concat(HAIKU_M13.map(ki))) {
    const r = lauf(fx('M13').text, 5, a);
    assert.deepEqual([r.schritt, r.status, r.entwurf, r.antwort, r.ki_noetig], ['fertig', 'selbst lesen', '', '', false]);
    assert.ok(r.hinweise.includes('selbst lesen: anweisung_im_text'));
  }
  assert.equal(lauf(fx('M10').text, 1, null).status, 'selbst lesen');
});

test('Haiku-Antworten auf M13 ohne Wortliste (angenommen, eine Anweisung entgeht ihr): Kategorie ohne Entwurf → selbst lesen; harmloser Entwurf wird vorgelegt (Grenze, README)', () => {
  const neutral = 'Top Arbeit, gern wieder.';
  for (const a of HAIKU_M13.slice(1)) {
    const r = lauf(neutral, 5, ki(a));
    assert.deepEqual([r.status, r.antwort], ['selbst lesen', '']);
    assert.ok(r.hinweise.includes('KI-Antwort widersprüchlich: Kategorie ohne Entwurf'));
  }
  const w1 = lauf(neutral, 5, ki(HAIKU_M13[0]));
  assert.deepEqual([w1.status, w1.antwort === HAIKU_M13[0].entwurf], ['Entwurf bereit', true]);
});

test('ohne KI-Antwort: Anfrage mit maskiertem Text; S15 KI-Fehler → selbst lesen und Alarm', () => {
  const r = lauf(fx('M02').text, 5, null);
  assert.deepEqual([r.schritt, r.ki_noetig, r.anfrage.model], ['ki', true, ew.KI_MODELL]);
  assert.ok(r.anfrage.messages[0].content.includes('Herr <NAME>'));
  const f = lauf(fx('M02').text, 5, { statusCode: 401, body: { type: 'error' } });
  assert.deepEqual([f.status, f.kategorie, f.alarm], ['selbst lesen', '', 'KI-Fehler: HTTP 401']);
});

test('S12 heikel → kein Entwurf, auch wenn einer kommt; Aufgabe bei verletzung_schaden', () => {
  const r = lauf(fx('M09').text, 1, ki({ kategorie: 'heikel', sicher: true, gruende: ['verletzung_schaden'], entwurf: 'Guten Tag, das tut uns leid.' }));
  assert.deepEqual([r.status, r.entwurf, r.antwort, r.kategorie], ['selbst lesen', '', '', 'heikel']);
  assert.ok(r.aufgaben.includes('Meldung an Google oder Anwalt prüfen'));
});

test('S13/E6 unfair → Baustein unfair statt KI-Entwurf, Hinweis „Meldung an Google prüfen“', () => {
  const r = lauf(fx('M07').text, 1, ki({ kategorie: 'unfair', sicher: true, gruende: ['beleidigung'], entwurf: 'Guten Tag, frei formuliert.' }));
  assert.deepEqual([r.status, r.entwurf.startsWith('Guten Tag,\n\nwir nehmen das ernst.'), r.antwort === r.entwurf], ['Entwurf bereit', true, true]);
  assert.ok(r.aufgaben.includes('Meldung an Google prüfen'));
});

test('c 7: sauberer Entwurf wird vorbelegt; harter Treffer → nicht vorbelegt; weicher → vorbelegt mit Hinweis', () => {
  const ok = lauf(fx('M01').text, 5, ki({ kategorie: 'positiv', sicher: true, gruende: [], entwurf: GUT }));
  assert.deepEqual([ok.status, ok.antwort, ok.hinweise], ['Entwurf bereit', GUT, []]);
  const hart = lauf(fx('M08').text.replace('nie Kunde', 'nie da'), 2, ki({ kategorie: 'kritisch', sicher: true, gruende: [],
    entwurf: 'Guten Tag,\n\nda Sie nach eigener Aussage nicht selbst Kunde bei uns waren, …\n\n' + SIG }));
  assert.deepEqual([hart.status, hart.antwort, hart.hinweise.includes('hart: Kundenbeziehung')], ['Entwurf bereit', '', true]);
  const weich = lauf(fx('M05').text, 2, ki({ kategorie: 'kritisch', sicher: true, gruende: [], entwurf: 'Guten Tag,\n\nden Termin am 12.10. holen wir nach.\n\n' + SIG }));
  assert.deepEqual([weich.antwort !== '', weich.hinweise.includes('weich: Termin')], [true, true]);
});

test('E15: englische Bewertung, deutscher Entwurf → Hinweis „weich: Bewertung nicht deutsch“; E17: sicher=false nur Anzeige', () => {
  const r = lauf(fx('M11').text, 5, ki({ kategorie: 'positiv', sicher: false, gruende: [], entwurf: GUT }));
  assert.deepEqual([r.status, r.antwort, r.sicher], ['Entwurf bereit', GUT, false]);
  assert.ok(r.hinweise.includes('weich: Bewertung nicht deutsch'));
  assert.ok(r.hinweise.includes('KI unsicher (nur Anzeige)'));
});
