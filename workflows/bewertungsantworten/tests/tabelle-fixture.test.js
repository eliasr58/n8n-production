'use strict';
// Baustein 3: die Fixture der Test-Tabelle und die leere Vorlage gegen den Kern (tests/testdaten/tabelle/, erzeugt von
// bau/werkzeuge/tabelle_fixture.py). Kopfzeilen = Pflichtspalten des Kerns; jeder Textbaustein 0 harte und 0 weiche Treffer;
// die Testquelle liest der Parser wie vorgesehen (Formen-Zeilen gezielt). Adressen stehen in keiner Datei.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const tb = require('../kern/tabelle.js');
const bs = require('../kern/bausteine.js');
const ei = require('../kern/einstellungen.js');
const lp = require('../kern/leitplanken.js');
const zt = require('../kern/zeit.js');

const DIR = path.join(__dirname, 'testdaten', 'tabelle');
const lade = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));
const T = lade('testbetrieb.json');
const V = lade('vorlage-leer.json');
const blatt = (x, titel) => x.blaetter.find((b) => b.titel === titel).zeilen;

test('Blätter und Kopfzeilen = Pflichtspalten des Kerns, in Test-Tabelle und Vorlage', () => {
  for (const x of [T, V]) {
    assert.deepEqual(x.blaetter.map((b) => b.titel), ['Bewertungen', 'Einstellungen', 'Textbausteine', 'Protokoll', 'Testquelle']);
    assert.deepEqual(blatt(x, 'Bewertungen')[0], tb.BW_SPALTEN);
    assert.deepEqual(blatt(x, 'Einstellungen')[0], ei.EI_SPALTEN);
    assert.deepEqual(blatt(x, 'Textbausteine')[0], bs.TB_SPALTEN);
    assert.deepEqual(blatt(x, 'Protokoll')[0], tb.PR_SPALTEN);
    assert.deepEqual(blatt(x, 'Testquelle')[0], tb.TQ_SPALTEN);
    assert.deepEqual(blatt(x, 'Einstellungen').slice(1).map((z) => z[0]), ei.EI_FELDER.map((f) => f[0]));
  }
});

test('Einstellungen: Test-Tabelle gültig bis auf die Adressen (werden nur in Google gesetzt); Vorlage Modus trocken', () => {
  const r = ei.leseEinstellungen(blatt(T, 'Einstellungen'));
  assert.deepEqual([r.ok, r.kern.modus, r.kern.quelle, r.adressen_gesetzt], [true, 'trocken', 'test', { meldeadresse: false, absenderadresse: false }]);
  assert.deepEqual(ei.pruefeEinstellungen(r.kern), []);
  const v = ei.leseEinstellungen(blatt(V, 'Einstellungen'));
  assert.deepEqual([v.ok, v.kern.modus], [true, 'trocken']);
  assert.ok(!JSON.stringify([T, V]).match(/@(?!example\.invalid|beispiel\.invalid|konkurrenz-beispiel\.example)[a-z0-9.-]+\.[a-z]{2,}/i), 'keine echte Adresse');
});

test('Textbausteine: Blatt gültig; JEDER Baustein nach dem Einsetzen 0 harte und 0 weiche Treffer (Test-Tabelle und Vorlage)', () => {
  const e = ei.leseEinstellungen(blatt(T, 'Einstellungen')).kern;
  for (const x of [T, V]) {
    const r = bs.leseTextbausteine(blatt(x, 'Textbausteine'));
    assert.deepEqual([r.ok, r.fehler], [true, []]);
    for (const [art, sterne] of [['ohne_text', 1], ['ohne_text', 2], ['ohne_text', 3], ['ohne_text', 4], ['ohne_text', 5], ['unfair', 1]]) {
      const b = bs.baueBaustein(art, sterne, r.bausteine, e);
      assert.equal(b.ok, true, art + sterne);
      const p = lp.pruefeText(b.text, { anzeigename: 'Bewerter Probe 01', bewertungstext: '', betrieb: { name: e.betrieb, signatur: e.signatur,
        kontaktweg: e.kontaktweg, domain: e.domain }, hoechstlaenge: e.hoechstlaenge, verboten: ei.verboteneBegriffe(e) });
      assert.deepEqual(p, { hart: [], weich: [] }, art + ' ' + sterne + ': ' + b.text);
    }
  }
});

test('Testquelle: M01–M14 und B-Fälle ohne Mangel; Anzeigenamen ohne Wörter aus Betriebsname und Signatur', () => {
  const r = tb.leseTestquelle(blatt(T, 'Testquelle'), zt);
  assert.deepEqual([r.status.status, r.status.meldungen], ['ok', []]);
  const normal = r.bewertungen.filter((b) => !/^R-99/.test(b.bewertung_id));
  assert.deepEqual(normal.filter((b) => b.mangel.length).map((b) => b.bewertung_id), []);
  for (const nr of ['R-8001', 'R-8014', 'R-9001', 'R-9014', 'R-9021']) assert.ok(normal.some((b) => b.bewertung_id === nr), nr);
  const e = ei.leseEinstellungen(blatt(T, 'Einstellungen')).kern;
  const frei = [e.betrieb, e.signatur, e.kontaktweg].join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kollision = r.bewertungen.filter((b) => b.anzeigename.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 3 && frei.includes(w)));
  assert.deepEqual(kollision.map((b) => b.bewertung_id), []);
  assert.equal(normal.find((b) => b.bewertung_id === 'R-9014').text.length, 5000);
  assert.equal(normal.find((b) => b.bewertung_id === 'R-9001').text, '');
});

test('Testquelle, Formen-Zeilen R-99xx gezielt: Zahl, Boolean als Text, Seriennummer, #ERROR!, Sterne als Zahl', () => {
  const r = tb.leseTestquelle(blatt(T, 'Testquelle'), zt).bewertungen;
  const b = (id) => r.find((x) => x.bewertung_id === id);
  assert.deepEqual([b('R-9901').text, b('R-9901').hinweise], ['2', ['comment als Zahl gelesen – möglicherweise umgewandelt']]);
  assert.deepEqual([b('R-9902').anonym, b('R-9902').hinweise], [true, []]);
  assert.deepEqual([b('R-9903').geaendert_utc, b('R-9903').hinweise], ['2026-09-20T10:00:00Z', ['updateTime aus Seriennummer (Berlin) gelesen']]);
  assert.deepEqual([b('R-9904').text, b('R-9904').mangel], ['', ['comment unlesbar (#ERROR!)']]);
  assert.deepEqual([b('R-9905').sterne, b('R-9905').hinweise], [4, ['starRating als Zahl gelesen']]);
  assert.deepEqual([b('R-9906').anonym, b('R-9906').text], [false, '00000']);
});

test('E33: Lese-Zeilen mit bestehender Antwort - R-9022 PENDING, R-9023 REJECTED mit policyViolation, „Moderation (Test)“ leer; R-9017/R-9018 nur Moderation (Schreibweg)', () => {
  const z = (id) => blatt(T, 'Testquelle').find((r) => r[0] === id);
  const s = (id, feld) => z(id)[tb.TQ_SPALTEN.indexOf(feld)];
  assert.deepEqual(['reviewReply.reviewReplyState', 'reviewReply.policyViolation', 'Moderation (Test)'].map((f) => s('R-9022', f)), ['PENDING', '', '']);
  assert.deepEqual(['reviewReply.reviewReplyState', 'reviewReply.policyViolation', 'Moderation (Test)'].map((f) => s('R-9023', f)), ['REJECTED', 'PERSONAL_INFO', '']);
  for (const id of ['R-9022', 'R-9023']) assert.ok(String(s(id, 'reviewReply.comment')).trim() && /Z$/.test(s(id, 'reviewReply.updateTime')), id);
  assert.deepEqual([s('R-9017', 'reviewReply.reviewReplyState'), s('R-9017', 'Moderation (Test)'), s('R-9018', 'reviewReply.reviewReplyState'), s('R-9018', 'Moderation (Test)')],
    ['', 'PENDING', '', 'REJECTED']);
  const ids = blatt(T, 'Testquelle').slice(1).map((r) => r[0]);
  assert.deepEqual([ids.indexOf('R-9022') === ids.indexOf('R-9021') + 1, ids.indexOf('R-9023') === ids.indexOf('R-9022') + 1, ids.length], [true, true, 45]);
});
