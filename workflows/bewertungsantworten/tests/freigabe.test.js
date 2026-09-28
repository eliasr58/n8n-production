'use strict';
// freigabe.js: Freigabe-Entscheidung (c 8, 10; S01-S08, S17, S22), Neu-Entscheiden vor dem Schreiben (S02), Vorbedingung und
// Nachlesen im Zieladapter (Vertrag 2, S03-S06). Alle Werte erfunden.
const test = require('node:test');
const assert = require('node:assert/strict');
const fg = require('../kern/freigabe.js');
const K = Object.assign({}, require('../kern/leitplanken.js'), require('../kern/sperre.js'), require('../kern/hash.js'));
const FIX = require('./testdaten/b1-fixtures.json');

const B = FIX.betrieb;
const ST = '2026-09-20T08:15:00Z';
const SIG = B.signatur;
const TEXT = 'Guten Tag,\n\nvielen Dank für Ihre Bewertung! ' + B.kontaktweg + '\n\n' + SIG;
const E = { betrieb: B.name, signatur: SIG, kontaktweg: B.kontaktweg, domain: B.domain, hoechstlaenge: 800, verboten: '', hoechstzahl_veroeffentlichungen: 10 };
const ctx = (abw) => Object.assign({ modus: 'test', einstellungen: E, lauf: { id: '7000', start: '2026-09-28T06:00:00.000Z' } }, abw || {});
const zeile = (n, abw) => Object.assign({ zeile: n, bewertung_id: 'R-90' + String(n).padStart(2, '0'), stand_utc: ST, antwort: TEXT, freigabe: 'freigeben', status: 'Entwurf bereit' }, abw || {});
const item = (z, abw) => Object.assign({ bewertung_id: z.bewertung_id, geaendert_utc: ST, text: 'Gut.', anzeigename: 'Bewerter Probe 01', anonym: false, antwort_vorhanden: false }, abw || {});
const ent = (z, it, sp, c) => fg.entscheideFreigabe(z, it === undefined ? item(z) : it, sp || [], c || ctx(), K);

test('S01/B15: nur „freigeben“ oder „freigeben trotz Hinweis“; „ja“ → Hinweis, nichts, Zelle bleibt; leer → nichts', () => {
  const z = zeile(2, { freigabe: 'ja' });
  const r = ent(z);
  assert.deepEqual([r.aktion, r.felder, r.hinweise], ['nichts', {}, ['Freigabe ungültig: „ja“ (erlaubt: freigeben, freigeben trotz Hinweis, ablehnen, selbst beantwortet)']]);
  assert.deepEqual(ent(zeile(2, { freigabe: '' })).aktion, 'nichts');
});

test('„ablehnen“ und „selbst beantwortet“ → Status, Freigabe leer, nichts veröffentlicht', () => {
  assert.deepEqual(ent(zeile(2, { freigabe: 'ablehnen' })).felder, { Status: 'abgelehnt', Freigabe: '' });
  assert.deepEqual(ent(zeile(2, { freigabe: 'selbst beantwortet' })).felder, { Status: 'selbst beantwortet', Freigabe: '' });
});

test('S02 gültige Freigabe → veröffentlichen genau den Text aus „Antwort“, mit Schlüssel und Hash; trocken → schreiben false (S17)', () => {
  const r = ent(zeile(2));
  assert.deepEqual([r.aktion, r.text, r.text_hash, r.schluessel, r.schreiben], ['veroeffentlichen', TEXT, K.textHash(TEXT), 'antwort|R-9002|' + ST, true]);
  assert.equal(ent(zeile(2), undefined, [], ctx({ modus: 'trocken' })).schreiben, false);
});

test('S07/B13: harter Treffer blockiert auch bei „freigeben trotz Hinweis“; Kontrolle Nummer aus dem Kontaktweg', () => {
  const fremd = ent(zeile(2, { antwort: TEXT.replace('0000 000000', '0000 222222'), freigabe: 'freigeben trotz Hinweis' }));
  assert.deepEqual([fremd.aktion, fremd.felder.Status, fremd.hinweise], ['nichts', 'blockiert', ['hart: Telefon']]);
  assert.equal(ent(zeile(2, { freigabe: 'freigeben trotz Hinweis' })).aktion, 'veroeffentlichen');
});

test('S08/B14: weicher Treffer mit „freigeben“ → nichts, Hinweis; mit „freigeben trotz Hinweis“ → veröffentlichen', () => {
  const t = TEXT.replace('vielen Dank für Ihre Bewertung!', 'die 120 € Anfahrt erstatten wir.');
  const a = ent(zeile(2, { antwort: t }));
  assert.deepEqual([a.aktion, a.hinweise], ['nichts', ['weich: Betrag – „freigeben trotz Hinweis“ nötig']]);
  assert.equal(ent(zeile(2, { antwort: t, freigabe: 'freigeben trotz Hinweis' })).aktion, 'veroeffentlichen');
});

test('B33/E16: Anzeigename oder Kundenbeziehung in „Antwort“ → blockiert; Kontrolle anonyme Bewertung ohne Namen', () => {
  const z = zeile(2, { antwort: 'Liebe Frau Musterfrau, danke!\n\n' + SIG });
  assert.equal(ent(z, item(z, { anzeigename: 'Petra Musterfrau' })).felder.Status, 'blockiert');
  assert.equal(ent(zeile(2, { antwort: 'Guten Tag,\n\nda Sie Kunde bei uns waren, danke.\n\n' + SIG })).felder.Status, 'blockiert');
  const k = zeile(2, { antwort: 'Guten Tag,\n\ndanke!\n\n' + SIG });
  assert.equal(ent(k, item(k, { anonym: true, anzeigename: '' })).aktion, 'veroeffentlichen');
});

test('S03/S04/S05: Bewertung geändert, gelöscht oder schon beantwortet → nichts mit Hinweis', () => {
  const z = zeile(2);
  assert.deepEqual(ent(z, item(z, { geaendert_utc: '2026-09-25T10:00:00Z' })).hinweise, ['Bewertung geändert – Freigabe verfällt']);
  assert.deepEqual(ent(z, null).hinweise, ['Bewertung nicht mehr in der Quelle']);
  assert.deepEqual(ent(z, item(z, { antwort_vorhanden: true })).hinweise, ['schon beantwortet']);
});

test('Data Table: „veroeffentlicht“ oder „unklar“ für den Schlüssel → nie erneut; Status veröffentlicht → nichts', () => {
  const z = zeile(2);
  for (const a of ['veroeffentlicht', 'unklar']) {
    const r = ent(z, undefined, [{ id: 1, schluessel: 'antwort|R-9002|' + ST, aktion: a, lauf_id: '6999', zeit_utc: '2026-09-27T06:00:00.000Z' }]);
    assert.equal(r.aktion, 'nichts', a);
  }
  assert.equal(ent(zeile(2, { status: 'veröffentlicht' })).aktion, 'nichts');
});

test('S22/B24 Mengenbremse: 11 Freigaben bei Höchstzahl 10 → keine, Alarm; Kontrolle 10 → 10', () => {
  const zs = (n) => Array.from({ length: n }, (_, i) => zeile(i + 2));
  const plan = (n) => fg.planeFreigaben(zs(n), Object.fromEntries(zs(n).map((z) => [z.bewertung_id, item(z)])), [], ctx(), K);
  const elf = plan(11);
  assert.deepEqual([elf.veroeffentlichen.length, elf.alarme], [0, ['Mengenbremse: 11 Freigaben, Höchstzahl 10 – nichts veröffentlicht']]);
  assert.equal(plan(10).veroeffentlichen.length, 10);
  assert.equal(fg.ABSTAND_MS, 7000);
});

test('S02 neuEntscheiden: frische Zeile gleich der Planung → veröffentlichen; Antwort geändert oder Freigabe entzogen → nichts', () => {
  const z = zeile(2);
  const g = ent(z);
  const neu = (zz) => fg.neuEntscheiden({ geplant: g, zeile: zz, item: item(zz), sperrzeilen: [], ctx: ctx() }, K);
  assert.equal(neu(z).aktion, 'veroeffentlichen');
  assert.deepEqual(neu(zeile(2, { antwort: TEXT + ' ' })).hinweise, ['Antwort seit der Planung geändert – nicht veröffentlicht']);
  assert.equal(neu(zeile(2, { freigabe: '' })).aktion, 'nichts');
});

test('Vertrag 2 Vorbedingung (S03-S05) und Nachlesen (S06; Baustein 8: REJECTED ist geschrieben und bestätigt, Auftrag Schritt 6)', () => {
  const q = { bewertung_id: 'R-9002', geaendert_utc: ST, antwort_vorhanden: false };
  assert.equal(fg.vorbedingungZiel(q, ST, TEXT), '');
  assert.equal(fg.vorbedingungZiel(null, ST, TEXT), 'geloescht');
  assert.equal(fg.vorbedingungZiel(Object.assign({}, q, { geaendert_utc: '2026-09-25T10:00:00Z' }), ST, TEXT), 'geaendert');
  assert.equal(fg.vorbedingungZiel(Object.assign({}, q, { antwort_vorhanden: true }), ST, TEXT), 'schon_beantwortet');
  assert.equal(fg.vorbedingungZiel(q, ST, '😀'.repeat(1025)), 'text_ungueltig');
  assert.equal(fg.nachlesenOk(TEXT, { antwort_text: TEXT.replace(/\n/g, '\r\n'), antwort_status: 'PENDING' }), true);
  assert.equal(fg.nachlesenOk(TEXT, { antwort_text: TEXT, antwort_status: 'REJECTED' }), true);
  assert.equal(fg.nachlesenOk(TEXT, { antwort_text: TEXT, antwort_status: '' }), false);
  assert.equal(fg.nachlesenOk(TEXT, { antwort_text: TEXT, antwort_status: 'STATE_UNSPECIFIED' }), false);
  assert.equal(fg.nachlesenOk(TEXT, { antwort_text: TEXT + '!', antwort_status: 'APPROVED' }), false);
});

test('S21: Reservierung eines abgebrochenen Laufs für den Schlüssel → nichts, Hinweis „Versandstatus klären“', () => {
  const r = ent(zeile(2), undefined, [{ id: 1, schluessel: 'antwort|R-9002|' + ST, aktion: 'reserviert', lauf_id: '6990', zeit_utc: '2026-09-27T06:00:00.000Z' }]);
  assert.deepEqual([r.aktion, r.hinweise], ['nichts', ['Reservierung eines abgebrochenen Laufs – Versandstatus klären']]);
});

test('TESTKATALOG „Nur im Kern“: jede Kombination aus Freigabewert (6), Treffertyp (3) und Stand (2) - 36 Fälle', () => {
  const texte = { keiner: TEXT, weich: TEXT.replace('vielen Dank für Ihre Bewertung!', 'die 120 € erstatten wir.'),
    hart: TEXT.replace('0000 000000', '0000 222222') };
  const soll = (f, t, s) => {
    if (f === '') return ['nichts', ''];
    if (f === 'ja') return ['nichts', 'ungültig'];
    if (f === 'ablehnen') return ['nichts', 'abgelehnt'];
    if (f === 'selbst beantwortet') return ['nichts', 'selbst beantwortet'];
    if (s === 'geändert') return ['nichts', 'geändert'];
    if (t === 'hart') return ['nichts', 'blockiert'];
    if (t === 'weich' && f === 'freigeben') return ['nichts', 'trotz Hinweis'];
    return ['veroeffentlichen', ''];
  };
  const ist = (r) => [r.aktion, r.felder.Status === 'blockiert' ? 'blockiert' : r.felder.Status === 'abgelehnt' ? 'abgelehnt'
    : r.felder.Status === 'selbst beantwortet' ? 'selbst beantwortet' : r.hinweise.some((h) => /ungültig/.test(h)) ? 'ungültig'
    : r.hinweise.some((h) => /Bewertung geändert/.test(h)) ? 'geändert' : r.hinweise.some((h) => /trotz Hinweis/.test(h)) ? 'trotz Hinweis' : ''];
  let n = 0;
  for (const f of ['', 'ja', 'freigeben', 'freigeben trotz Hinweis', 'ablehnen', 'selbst beantwortet']) {
    for (const t of ['keiner', 'weich', 'hart']) {
      for (const s of ['gleich', 'geändert']) {
        const z = zeile(2, { freigabe: f, antwort: texte[t] });
        const it = item(z, s === 'geändert' ? { geaendert_utc: '2026-09-25T10:00:00Z' } : {});
        assert.deepEqual(ist(ent(z, it)), soll(f, t, s), [f, t, s].join(' / '));
        n++;
      }
    }
  }
  assert.equal(n, 36);
});
