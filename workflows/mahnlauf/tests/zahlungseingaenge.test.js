'use strict';
// Blatt „Zahlungseingänge“ als Buch (Baustein 5): lesen, fortschreiben, Eingabe der Zuordnung,
// Schreibauftrag. Auftrag 25.09.2026, Teil A 3: Doppelzählung verhindern statt dokumentieren -
// eine Referenz, die im Buch schon steht (unter einem anderen Schlüssel), wird Klärfall
// „Referenz bereits vorhanden“. Alle Werte erfunden (BAUPLAN j).
const test = require('node:test');
const assert = require('node:assert/strict');
const ze = require('../kern/zahlungseingaenge.js');
const csv = require('../kern/csv-parser.js');
const zuo = require('../kern/zuordnung.js');
const { MUSTER, zeile } = require('./hilfen.js');

const EINST = {
  trennzeichen: ';', zeichensatz: 'UTF-8', dezimalzeichen: ',', datumsformat: 'TT.MM.JJJJ', kopfzeile: 1,
  spalte_buchungsdatum: 'Buchungstag', spalte_betrag: 'Betrag', spalte_soll_haben: '',
  spalte_verwendungszweck: 'Verwendungszweck', spalte_auftraggeber: 'Auftraggeber', spalte_iban: 'IBAN', spalte_referenz: 'Referenz',
};
const KOPF = 'Buchungstag;Auftraggeber;IBAN;Verwendungszweck;Betrag;Referenz\n';
// Datei A: Referenz X zweimal → zwei Klärfälle „Bankreferenz doppelt“.
const DATEI_A = KOPF
  + '21.09.2026;Kunde Beispiel 02;DE00111122223333444402;RE-2026-9002;200,00;BANKREF-X\n'
  + '22.09.2026;Kunde Beispiel 02;DE00111122223333444402;RE-2026-9002 Rest;200,00;BANKREF-X\n';
// Datei B, später: dieselbe Referenz X nur einmal.
const DATEI_B = KOPF
  + '22.09.2026;Kunde Beispiel 02;DE00111122223333444402;RE-2026-9002 Rest;200,00;BANKREF-X\n';

function lies(text, name) {
  const e = csv.parseKontoauszugCsv(text, EINST, name);
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  return { datei: name, ergebnis: e };
}
// Buch wie aus dem Blatt gelesen: Zeilennummern ab 2.
function alsBestand(zeilen) {
  return zeilen.map((z, i) => Object.assign({}, z, { zeile: i + 2 }));
}
function zahlstand(buch, rechnungen) {
  const ein = ze.zuordnungsEingabe(buch);
  return zuo.ordneZahlungenZu({ rechnungen, zahlungen: ein.zahlungen, klaerfaelle: ein.klaerfaelle, manuell: ein.manuell, muster: MUSTER });
}

test('Grenze aus dem Beleg: X zweimal in A (Klärfälle), einer manuell RE-2026-9002; spätere Datei B mit X einmal → Klärfall „Referenz bereits vorhanden“, 9002 einmal bezahlt', () => {
  const rechnungen = [zeile(9002, { betrag_brutto_cent: 20000 })];
  const lauf1 = ze.schreibeFort([], [lies(DATEI_A, 'a.csv')]);
  assert.equal(lauf1.neu.length, 2);
  assert.ok(lauf1.neu.every((z) => /Bankreferenz doppelt/.test(z.klaerfall) && z.bankreferenz === 'BANKREF-X'));
  const bestand = alsBestand(lauf1.neu);
  bestand[0].manuell = 'RE-2026-9002';
  const lauf2 = ze.schreibeFort(bestand, [lies(DATEI_A, 'a.csv'), lies(DATEI_B, 'b.csv')]);
  assert.equal(lauf2.neu.length, 1);
  assert.equal(lauf2.neu[0].schluessel, 'REF:BANKREF-X');
  assert.equal(lauf2.neu[0].klaerfall, 'Referenz bereits vorhanden');
  const z = zahlstand(bestand.concat(lauf2.neu), rechnungen);
  assert.equal(z.rechnungen[0].bezahlt_cent, 20000);
  assert.equal(z.rechnungen[0].status, 'bezahlt');
  assert.equal(z.zahlungen.find((x) => x.schluessel === 'REF:BANKREF-X').zuordnung, 'ungeklärt');
});

test('Grenze, Kontrolle: Datei B allein auf leerem Buch → REF:BANKREF-X wird automatisch verbucht', () => {
  const lauf = ze.schreibeFort([], [lies(DATEI_B, 'b.csv')]);
  assert.equal(lauf.neu.length, 1);
  assert.equal(lauf.neu[0].klaerfall, '');
  const z = zahlstand(alsBestand(lauf.neu), [zeile(9002, { betrag_brutto_cent: 20000 })]);
  assert.equal(z.zahlungen[0].zuordnung, 'automatisch');
  assert.equal(z.rechnungen[0].status, 'bezahlt');
});

test('Derselbe Auszug zweimal: zweiter Lauf schreibt nichts Neues, bezahlt bleibt gleich (keine Doppelzählung)', () => {
  const datei = KOPF + '21.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;400,00;BANKREF-0003\n';
  const r = [zeile(9003, { betrag_brutto_cent: 100000 })];
  const l1 = ze.schreibeFort([], [lies(datei, 'x.csv')]);
  const bestand = alsBestand(l1.neu);
  const l2 = ze.schreibeFort(bestand, [lies(datei, 'x.csv'), lies(datei, 'x-kopie.csv')]);
  assert.equal(l2.neu.length, 0);
  assert.equal(l2.schon_im_buch, 2);
  assert.equal(zahlstand(bestand, r).rechnungen[0].bezahlt_cent, 40000);
});

test('Buch lesen: Kopfzeile geprüft, Datum als Seriennummer, Betrag als Zahl, Klärfall-Marke und manuelle Zuordnung', () => {
  const werte = [ze.ZE_SPALTEN,
    ['REF:A1', 'A1', 46286, 400, 'EUR', 'Kunde Beispiel 03', 'DE00', 'RE-2026-9003', '', 'x.csv', '', 'RE-2026-9003', 'automatisch', '', '', ''],
    ['H:abc', '', 46288, 99, 'USD', 'Kunde X', '', 'RE-2026-9004', '', 'y.xml', 'Fremdwährung', '', 'ungeklärt', '', '', 'RE-2026-9004'],
    [], ['', '', 46288, 50, 'EUR', 'Barzahlung', '', 'bar', '', '', '', '', '', '', '', 'RE-2026-9005']];
  const b = ze.leseZahlungseingaenge(werte);
  assert.equal(b.ok, true);
  assert.equal(b.zeilen.length, 3);
  assert.deepEqual([b.zeilen[0].schluessel, b.zeilen[0].buchungsdatum, b.zeilen[0].betrag_cent, b.zeilen[0].zeile], ['REF:A1', '2026-09-21', 40000, 2]);
  assert.equal(b.zeilen[1].klaerfall, 'Fremdwährung');
  assert.equal(b.zeilen[2].schluessel, 'ZEILE-5');
  assert.equal(b.zeilen[2].manuell, 'RE-2026-9005');
  const kopf = ze.ZE_SPALTEN.map((s) => (s === 'Bankreferenz' ? 'Bank-Ref' : s));
  const f = ze.leseZahlungseingaenge([kopf]);
  assert.equal(f.ok, false);
  assert.deepEqual(f.fehlend_spalten, ['Bankreferenz']);
});

test('Klärfall-Marke aus dem Buch gilt auch ohne Datei: Fremdwährung wird nie automatisch verbucht, manuelle Zuordnung auch nicht', () => {
  const b = ze.leseZahlungseingaenge([ze.ZE_SPALTEN,
    ['H:abc', '', 46288, 99, 'USD', 'Kunde X', '', 'RE-2026-9004', '', 'y.xml', 'Fremdwährung', '', '', '', '', 'RE-2026-9004']]);
  const z = zahlstand(b.zeilen, [zeile(9004, { betrag_brutto_cent: 9900 })]);
  assert.equal(z.zahlungen[0].zuordnung, 'ungeklärt');
  assert.equal(z.rechnungen[0].bezahlt_cent, 0);
});

test('Schreibauftrag: berechnete Spalten je Bestandszeile, neue Zeilen vollständig; zurückgelesen gleiche Zahlungen', () => {
  const l = ze.schreibeFort([], [lies(KOPF + '21.09.2026;Kunde Beispiel 03;DE00111122223333444403;RE-2026-9003;400,00;BANKREF-0003\n', 'x.csv')]);
  const alle = alsBestand(l.neu);
  const z = zahlstand(alle, [zeile(9003, { betrag_brutto_cent: 100000 })]);
  const s = ze.schreibauftrag(0, alle, z);
  assert.equal(s.berechnet.length, 0);
  assert.equal(s.neu.length, 1);
  assert.equal(s.neu[0].length, ze.ZE_SPALTEN.length);
  assert.deepEqual(s.neu[0].slice(0, 5), ['REF:BANKREF-0003', 'BANKREF-0003', 46286, 400, 'EUR']);
  assert.deepEqual(s.neu[0].slice(11, 16), ['RE-2026-9003', 'automatisch', '', '', '']);
  const zurueck = ze.leseZahlungseingaenge([ze.ZE_SPALTEN].concat(s.neu));
  assert.deepEqual(ze.zuordnungsEingabe(zurueck.zeilen), ze.zuordnungsEingabe(alle));
  const s2 = ze.schreibauftrag(1, alle, z);
  assert.deepEqual(s2.berechnet, [['RE-2026-9003', 'automatisch', '', '']]);
  assert.equal(s2.neu.length, 0);
});

test('Buch lesen: nächste freie Zeile; Spaltenreihenfolge ist Pflicht (geschrieben wird nach Spaltenbuchstaben)', () => {
  const b = ze.leseZahlungseingaenge([ze.ZE_SPALTEN, ['REF:A1', 'A1', 46286, 400], [], ['REF:A2', 'A2', 46286, 50]]);
  assert.equal(b.ok, true);
  assert.equal(b.naechste_zeile, 5);
  const vertauscht = ze.ZE_SPALTEN.slice();
  [vertauscht[0], vertauscht[1]] = [vertauscht[1], vertauscht[0]];
  const f = ze.leseZahlungseingaenge([vertauscht]);
  assert.equal(f.ok, false);
  assert.equal(f.reihenfolge_falsch, true);
  assert.equal(ze.leseZahlungseingaenge([ze.ZE_SPALTEN]).naechste_zeile, 2);
});

// Auftrag 25.09.2026, Teil A 1: Kopfzeile EXAKT - Namen und Reihenfolge, nichts getrimmt, keine
// Spalte zu viel. Bei Abweichung kein Buch (ok false), damit nichts geschrieben wird.
test('Kopfzeile exakt: vertauschte Spalten (Betrag/Buchungsdatum) → ok false, Abweichung nennt beide Stellen', () => {
  const v = ze.ZE_SPALTEN.slice();
  [v[2], v[3]] = [v[3], v[2]];
  const f = ze.leseZahlungseingaenge([v, ['REF:A1', 'A1', 400, 46286]]);
  assert.equal(f.ok, false);
  assert.deepEqual(f.zeilen, []);
  assert.deepEqual(f.abweichend, ['C: erwartet „Buchungsdatum“, steht „Betrag“', 'D: erwartet „Betrag“, steht „Buchungsdatum“']);
});

test('Kopfzeile exakt: Leerzeichen am Namen ist eine Abweichung, kein Tippfehler zum Wegtrimmen', () => {
  const v = ze.ZE_SPALTEN.slice();
  v[3] = 'Betrag ';
  const f = ze.leseZahlungseingaenge([v]);
  assert.equal(f.ok, false);
  assert.deepEqual(f.abweichend, ['D: erwartet „Betrag“, steht „Betrag “']);
});

test('Kopfzeile exakt: Spalte zu viel hinter P → ok false; leere Zellen dahinter sind keine Spalte', () => {
  const f = ze.leseZahlungseingaenge([ze.ZE_SPALTEN.concat(['Notiz'])]);
  assert.equal(f.ok, false);
  assert.deepEqual(f.zusaetzlich, ['Q: Notiz']);
  const g = ze.leseZahlungseingaenge([ze.ZE_SPALTEN.concat(['', ''])]);
  assert.equal(g.ok, true);
  assert.deepEqual(g.zusaetzlich, []);
});

test('Schreibbereiche: berechnete Spalten L:O je Bestandszeile nach ihrer Blattzeile, neue Zeilen ab der nächsten freien', () => {
  const bestand = [{ zeile: 2 }, { zeile: 4 }];
  const d = ze.schreibBereiche(bestand, 5, { berechnet: [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']], neu: [['n1'], ['n2']] });
  assert.deepEqual(d, [
    { range: "'Zahlungseingänge'!L2:O2", values: [['a', 'b', 'c', 'd']] },
    { range: "'Zahlungseingänge'!L4:O4", values: [['e', 'f', 'g', 'h']] },
    { range: "'Zahlungseingänge'!A5:P6", values: [['n1'], ['n2']] }]);
  assert.deepEqual(ze.schreibBereiche([], 2, { berechnet: [], neu: [] }), []);
});

// Gefunden bei der Vorhersage Baustein 5 (vorhersage_b5.js): Teile einer CAMT-Sammelbuchung teilen die
// Bankreferenz (REF:X#1, REF:X#2). Innerhalb einer Datei entscheidet der Parser; die Buch-Regel gilt nur
// gegen das Buch und gegen früher gelesene Dateien.
test('CAMT-Sammelbuchung: beide Teile ins Buch, kein Klärfall „Referenz bereits vorhanden“ (T15); Kontrolle spätere Datei mit derselben Referenz → Klärfall', () => {
  const camt = require('../kern/camt-parser.js');
  const j = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'testdaten', 'camt',
    'camt053-001-08-mehrere.xml-standard.json'), 'utf8')).json;
  const d = { datei: 'c.xml', ergebnis: camt.parseKontoauszugCamt(j, 'c.xml') };
  const l = ze.schreibeFort([], [d]);
  const teile = l.neu.filter((z) => z.bankreferenz === 'ZZBANKREF080002');
  assert.deepEqual(teile.map((z) => [z.schluessel, z.klaerfall]), [['REF:ZZBANKREF080002#1', ''], ['REF:ZZBANKREF080002#2', '']]);
  const spaeter = { datei: 's.csv', ergebnis: { ok: true, klaerfaelle: [], zahlungen: [{ schluessel: 'REF:ZZBANKREF080002', buchungsdatum: '2026-09-24',
    betrag_cent: 80000, waehrung: 'EUR', auftraggeber: 'x', iban: '', verwendungszweck: 'RE-2026-9015', referenz: 'ZZBANKREF080002', quelle: 's.csv' }] } };
  const l2 = ze.schreibeFort(alsBestand(l.neu), [d, spaeter]);
  assert.deepEqual(l2.neu.map((z) => [z.schluessel, z.klaerfall]), [['REF:ZZBANKREF080002', 'Referenz bereits vorhanden']]);
});
