'use strict';
// CAMT.053-Parser (BAUPLAN d). Eingabe ist das JSON, das der n8n-Knoten `xml` 1
// liefert - gemessen, nicht angenommen: tests/testdaten/camt/*.xml-standard.json
// (Lauf 5474, Standardoptionen) und *.xml-explicitArray.json (explicitArray: true).
// Alle Werte erfunden (BAUPLAN j), IBANs mit Pruefziffer 00.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const camt = require('../kern/camt-parser.js');
const zuo = require('../kern/zuordnung.js');
const { MUSTER, zeile } = require('./hilfen.js');

const ORDNER = path.join(__dirname, 'testdaten', 'camt');
function fixture(name, form) {
  return JSON.parse(fs.readFileSync(path.join(ORDNER, name + '.xml-' + (form || 'standard') + '.json'), 'utf8')).json;
}
function lies(name, form) {
  return camt.parseKontoauszugCamt(fixture(name, form), name + '.xml');
}
const V08 = 'camt053-001-08-mehrere';
const V02 = 'camt053-001-02-mehrere';
const V08E = 'camt053-001-08-einzeln';
function nachBetrag(erg, cent) {
  return erg.zahlungen.filter((z) => z.betrag_cent === cent);
}

test('T15 Sammelbuchung .08: ein Ntry, zwei TxDtls → zwei Zahlungen mit eigenem Betrag und Schlüssel; Kontrolle Ntry mit einem TxDtls → eine', () => {
  const e = lies(V08);
  assert.equal(e.ok, true);
  const a = nachBetrag(e, 30000);
  const b = nachBetrag(e, 50000);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.notEqual(a[0].schluessel, b[0].schluessel);
  assert.equal(a[0].verwendungszweck, 'Rechnung RE-2026-9014 vielen Dank');
  assert.equal(b[0].referenz, 'RE-2026-9015');
  assert.equal(a[0].auftraggeber, 'Müller Bau GmbH (Test)');
  assert.equal(a[0].iban, 'DE00500105170000000014');
  assert.equal(nachBetrag(e, 80000).length, 0, 'die Sammelsumme ist keine eigene Zahlung');
  // Kontrolle
  const k = nachBetrag(e, 123456);
  assert.equal(k.length, 1);
  assert.equal(k[0].verwendungszweck, 'RE-2026-9001');
});

test('T15 Sammelbuchung .02: Beträge aus AmtDtls/TxAmt, Auftraggeber ohne Pty', () => {
  const e = lies(V02);
  assert.equal(e.ok, true);
  assert.equal(nachBetrag(e, 30000)[0].auftraggeber, 'Müller Bau GmbH (Test)');
  assert.equal(nachBetrag(e, 50000)[0].referenz, 'RE-2026-9015');
  assert.equal(nachBetrag(e, 123456).length, 1);
});

test('T15 Ende zu Ende: beide Teilzahlungen der Sammelbuchung werden einzeln verbucht; Kontrolle ohne CAMT-Zahlung offen', () => {
  const e = lies(V08);
  const zeilen = [zeile(9014, { betrag_brutto_cent: 30000 }), zeile(9015, { betrag_brutto_cent: 50000 }),
    zeile(9016, { betrag_brutto_cent: 50000 })];
  const z = zuo.ordneZahlungenZu({ rechnungen: zeilen, zahlungen: e.zahlungen, manuell: {}, muster: MUSTER });
  const r = (nr) => z.rechnungen.find((x) => x.rechnungsnr === 'RE-2026-' + nr);
  assert.equal(r(9014).status, 'bezahlt');
  assert.equal(r(9014).bezahlt_cent, 30000);
  assert.equal(r(9015).status, 'bezahlt');
  assert.equal(r(9015).bezahlt_cent, 50000);
  assert.equal(r(9016).status, 'offen', 'Kontrolle: gleicher Betrag wie 9015, aber keine Nummer genannt');
});

test('RvslInd = true → Klärfall „Storno“, nie Zahlung; Kontrolle gleiche Datei ohne Kennzeichen → Zahlung', () => {
  for (const v of [V08, V02]) {
    const e = lies(v);
    assert.equal(nachBetrag(e, 20000).length, 0, v);
    const k = e.klaerfaelle.filter((x) => x.betrag_cent === 20000);
    assert.equal(k.length, 1, v);
    assert.equal(k[0].grund, 'Storno');
    assert.equal(nachBetrag(e, 123456).length, 1, v + ' Kontrolle');
  }
});

test('Sts PDNG zählt nicht (Hinweis), Sts BOOK zählt — .08 (Sts/Cd) und .02 (Sts als Text)', () => {
  for (const v of [V08, V02]) {
    const e = lies(v);
    assert.equal(nachBetrag(e, 15000).length, 0, v);
    assert.equal(e.klaerfaelle.filter((x) => x.betrag_cent === 15000).length, 0, 'vorgemerkt ist kein Klärfall');
    assert.ok(e.hinweise.some((h) => h.art === 'vorgemerkt nicht gezählt' && h.anzahl === 1), v);
    assert.equal(nachBetrag(e, 123456).length, 1, v + ' Kontrolle BOOK');
  }
});

test('Fremde Währung → Klärfall „Fremdwährung“; Kontrolle EUR → Zahlung', () => {
  const e = lies(V08);
  assert.equal(e.zahlungen.some((z) => z.betrag_cent === 9900), false);
  const k = e.klaerfaelle.filter((x) => x.grund === 'Fremdwährung');
  assert.equal(k.length, 1);
  assert.equal(k[0].waehrung, 'USD');
  assert.ok(e.zahlungen.every((z) => z.waehrung === 'EUR'));
});

test('Belastung (DBIT) ist keine Zahlung; Gutschrift ohne TxDtls wird aus dem Ntry gelesen', () => {
  const e = lies(V08);
  assert.equal(nachBetrag(e, 4500).length, 0);
  assert.ok(e.hinweise.some((h) => h.art === 'Belastungen nicht gezählt' && h.anzahl === 1));
  const o = nachBetrag(e, 7500);
  assert.equal(o.length, 1);
  assert.equal(o[0].verwendungszweck, 'Gutschrift RE-2026-9005 Kunde Beispiel 05');
  assert.equal(o[0].buchungsdatum, '2026-09-23');
});

test('Genau die erwarteten Zahlungen: .08 und .02 liefern dieselben Beträge', () => {
  const summe = (e) => e.zahlungen.map((z) => z.betrag_cent).sort((a, b) => a - b);
  assert.deepEqual(summe(lies(V08)), [7500, 30000, 50000, 123456]);
  assert.deepEqual(summe(lies(V02)), [7500, 30000, 50000, 123456]);
});

test('Ein einzelnes Ntry/TxDtls/Ustrd kommt als Objekt bzw. Text, nicht als Array — wird gelesen', () => {
  const e = lies(V08E);
  assert.equal(e.ok, true);
  assert.equal(e.zahlungen.length, 1);
  assert.equal(e.zahlungen[0].betrag_cent, 40000);
  assert.equal(e.zahlungen[0].verwendungszweck, 'RE 2026/9003 Teilzahlung');
  assert.equal(e.zahlungen[0].referenz, '');
});

test('Form explicitArray: true ergibt dieselben Zahlungen wie die Standardform', () => {
  for (const v of [V08, V02, V08E]) {
    assert.deepEqual(lies(v, 'explicitArray'), lies(v), v);
  }
});

test('Stand = Datum aus FrToDt/ToDtTm (Berlin); Kontrolle ohne FrToDt → jüngstes BookgDt', () => {
  assert.equal(lies(V08).stand, '2026-09-23');
  const ohne = JSON.parse(JSON.stringify(fixture(V08E)));
  delete ohne.Document.BkToCstmrStmt.Stmt.FrToDt;
  ohne.Document.BkToCstmrStmt.Stmt.Ntry.BookgDt.Dt = '2026-09-21';
  assert.equal(camt.parseKontoauszugCamt(ohne, 'x.xml').stand, '2026-09-21');
});

test('ToDtTm in UTC wird auf den Berliner Kalendertag umgerechnet (Sommer- und Winterzeit)', () => {
  assert.equal(camt.berlinerDatum('2026-09-23T22:30:00Z'), '2026-09-24');
  assert.equal(camt.berlinerDatum('2026-09-23T21:59:59Z'), '2026-09-23');
  assert.equal(camt.berlinerDatum('2026-12-31T23:30:00Z'), '2027-01-01');
  assert.equal(camt.berlinerDatum('2026-12-31T22:59:59Z'), '2026-12-31');
  assert.equal(camt.berlinerDatum('2026-09-23T23:59:59+02:00'), '2026-09-23');
  assert.equal(camt.berlinerDatum('2026-09-23'), '2026-09-23');
  assert.equal(camt.berlinerDatum('23.09.2026'), null);
});

test('Unbekannte Variante (Namensraum) → Datei verworfen; Kontrolle .001.08 und .001.02 → gelesen', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08E)));
  x.Document.xmlns = 'urn:iso:std:iso:20022:tech:xsd:camt.053.001.04';
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, false);
  assert.match(e.fehler.grund, /Variante/);
  assert.equal(e.fehler.datei, 'x.xml');
  const ohneDoc = camt.parseKontoauszugCamt({ data: '<xml/>' }, 'y.xml');
  assert.equal(ohneDoc.ok, false);
  assert.equal(lies(V08).ok, true);
  assert.equal(lies(V02).ok, true);
});

// Teil A, 25.09.2026 (geändert): vorher „ganze Datei verworfen“. Jetzt wird nur bei
// Formatfehlern verworfen; eine abweichende Summe ist eine Auffälligkeit dieses Eintrags.
test('Summe der TxDtls ≠ Betrag des Ntry → dieser Eintrag ein Klärfall über den Ntry-Betrag, Datei bleibt gültig; Kontrolle stimmige Summe → zwei Zahlungen', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08)));
  x.Document.BkToCstmrStmt.Stmt.Ntry[1].NtryDtls.TxDtls[1].Amt._ = '499.99';
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  assert.equal(nachBetrag(e, 30000).length, 0);
  assert.equal(nachBetrag(e, 49999).length, 0);
  const k = e.klaerfaelle.filter((f) => /Summe/.test(f.grund));
  assert.equal(k.length, 1);
  assert.equal(k[0].betrag_cent, 80000);
  assert.equal(k[0].schluessel, 'REF:ZZBANKREF080002');
  assert.match(k[0].verwendungszweck, /RE-2026-9014/);
  assert.match(k[0].referenz, /RE-2026-9015/);
  assert.deepEqual(e.zahlungen.map((z) => z.betrag_cent).sort((a, b) => a - b), [7500, 123456]);
  const kontrolle = lies(V08);
  assert.equal(nachBetrag(kontrolle, 30000).length, 1);
  assert.equal(nachBetrag(kontrolle, 50000).length, 1);
  assert.equal(kontrolle.klaerfaelle.filter((f) => /Summe/.test(f.grund)).length, 0);
});

test('Ein einzelnes TxDtls ohne eigenen Amt → Ntry-Betrag übernommen (.08 und .02)', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08E)));
  delete x.Document.BkToCstmrStmt.Stmt.Ntry.NtryDtls.TxDtls.Amt;
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  assert.deepEqual(e.zahlungen.map((z) => [z.betrag_cent, z.verwendungszweck]), [[40000, 'RE 2026/9003 Teilzahlung']]);
  const y = JSON.parse(JSON.stringify(fixture(V02)));
  const n = y.Document.BkToCstmrStmt.Stmt.Ntry.find((f) => f.AcctSvcrRef === 'ZZBANKREF020001');
  delete n.NtryDtls.TxDtls.AmtDtls;
  const f = camt.parseKontoauszugCamt(y, 'y.xml');
  assert.equal(f.ok, true, JSON.stringify(f.fehler));
  assert.equal(nachBetrag(f, 123456).length, 1);
});

test('Sammelbuchung, ein TxDtls ohne eigenen Amt → dieser Eintrag Klärfall über den Ntry-Betrag, Datei bleibt gültig', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08)));
  delete x.Document.BkToCstmrStmt.Stmt.Ntry[1].NtryDtls.TxDtls[0].Amt;
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  assert.equal(nachBetrag(e, 50000).length, 0);
  const k = e.klaerfaelle.filter((f) => f.betrag_cent === 80000);
  assert.equal(k.length, 1);
  assert.match(k[0].grund, /Einzelbetrag/);
  assert.equal(nachBetrag(e, 123456).length, 1);
});

test('Belastung (DBIT) in einem TxDtls einer Gutschrift → dieser Eintrag Klärfall, Datei bleibt gültig', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08)));
  x.Document.BkToCstmrStmt.Stmt.Ntry[1].NtryDtls.TxDtls[1].CdtDbtInd = 'DBIT';
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  assert.equal(nachBetrag(e, 30000).length, 0);
  const k = e.klaerfaelle.filter((f) => f.betrag_cent === 80000);
  assert.equal(k.length, 1);
  assert.match(k[0].grund, /Belastung/);
  assert.equal(nachBetrag(e, 123456).length, 1);
});

test('AcctSvcrRef doppelt in einer Datei → beide Einträge Klärfall mit Ersatzschlüssel, Datei bleibt gültig; übrige Einträge Zahlungen', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08)));
  x.Document.BkToCstmrStmt.Stmt.Ntry[6].AcctSvcrRef = 'ZZBANKREF080001';
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  assert.equal(nachBetrag(e, 123456).length, 0);
  assert.equal(nachBetrag(e, 7500).length, 0);
  const k = e.klaerfaelle.filter((f) => /Bankreferenz doppelt/.test(f.grund));
  assert.deepEqual(k.map((f) => f.betrag_cent).sort((a, b) => a - b), [7500, 123456]);
  for (const f of k) assert.match(f.schluessel, /^H:[0-9a-f]{16}$/);
  assert.deepEqual(e.zahlungen.map((z) => z.betrag_cent).sort((a, b) => a - b), [30000, 50000]);
});

test('AcctSvcrRef-Platzhalter (NONREF, NOTPROVIDED, klein) → Ersatzschlüssel aus dem Hash, auch zweimal in einer Datei; Kontrolle echte Referenz → REF:', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08)));
  x.Document.BkToCstmrStmt.Stmt.Ntry[0].AcctSvcrRef = 'NONREF';
  x.Document.BkToCstmrStmt.Stmt.Ntry[6].AcctSvcrRef = 'nonref';
  x.Document.BkToCstmrStmt.Stmt.Ntry[1].AcctSvcrRef = 'NOT PROVIDED';
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, true, JSON.stringify(e.fehler));
  assert.equal(e.klaerfaelle.filter((f) => /Bankreferenz/.test(f.grund)).length, 0);
  for (const cent of [123456, 7500, 30000, 50000]) {
    const z = nachBetrag(e, cent);
    assert.equal(z.length, 1, String(cent));
    assert.match(z[0].schluessel, /^H:[0-9a-f]{16}$/, String(cent));
  }
  assert.equal(new Set(e.zahlungen.map((z) => z.schluessel)).size, e.zahlungen.length);
  assert.ok(lies(V08).zahlungen.some((z) => z.schluessel === 'REF:ZZBANKREF080001'));
});

test('Unlesbarer Betrag → ganze Datei verworfen, keine Teilverbuchung', () => {
  const x = JSON.parse(JSON.stringify(fixture(V08)));
  x.Document.BkToCstmrStmt.Stmt.Ntry[0].Amt._ = '1.234,56';
  const e = camt.parseKontoauszugCamt(x, 'x.xml');
  assert.equal(e.ok, false);
  assert.equal(e.zahlungen, undefined);
});

test('Beträge nur als ganze Cent, nie Gleitkomma', () => {
  assert.equal(camt.camtBetragCent('1234.56'), 123456);
  assert.equal(camt.camtBetragCent('0.1'), 10);
  assert.equal(camt.camtBetragCent('12.3'), 1230);
  assert.equal(camt.camtBetragCent('400'), 40000);
  assert.equal(camt.camtBetragCent('0.29'), 29);
  assert.equal(camt.camtBetragCent('12.345'), null);
  assert.equal(camt.camtBetragCent('1,00'), null);
  assert.equal(camt.camtBetragCent('-5.00'), null);
  assert.equal(camt.camtBetragCent(''), null);
  for (const z of lies(V08).zahlungen) assert.ok(Number.isInteger(z.betrag_cent));
});

test('Buchungsschlüssel: eindeutig in der Datei, gleich beim zweiten Lesen, aus der Bankreferenz', () => {
  const a = lies(V08).zahlungen.map((z) => z.schluessel);
  const b = lies(V08).zahlungen.map((z) => z.schluessel);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.includes('REF:ZZBANKREF080001'));
  assert.ok(a.includes('REF:ZZBANKREF080002#1'));
  assert.ok(a.includes('REF:ZZBANKREF080002#2'));
});

// Auftrag 25.09.2026, Teil A 2: doppelte Referenz nur unter verarbeiteten Buchungen (CRDT und gebucht).
test('AcctSvcrRef einer Belastung (DBIT) oder vorgemerkten Buchung (PDNG) gleich der einer Gutschrift → Gutschrift bleibt Zahlung mit REF:', () => {
  for (const idx of [5, 3]) {
    const x = JSON.parse(JSON.stringify(fixture(V08)));
    x.Document.BkToCstmrStmt.Stmt.Ntry[idx].AcctSvcrRef = 'ZZBANKREF080001';
    const e = camt.parseKontoauszugCamt(x, 'x.xml');
    assert.equal(e.ok, true, JSON.stringify(e.fehler));
    const z = nachBetrag(e, 123456);
    assert.equal(z.length, 1, 'Ntry ' + idx);
    assert.equal(z[0].schluessel, 'REF:ZZBANKREF080001', 'Ntry ' + idx);
    assert.equal(e.klaerfaelle.filter((f) => /Bankreferenz doppelt/.test(f.grund)).length, 0, 'Ntry ' + idx);
  }
});

// Baustein 5: Vorprüfung vor dem xml-Knoten (der verschluckt Fehler-Items und nennt keinen Dateinamen).
test('XML-Vorprüfung: die drei gemessenen CAMT-Dateien sind wohlgeformt; kaputte Formen werden mit Zeile erkannt', () => {
  for (const n of ['camt053-001-08-mehrere.xml', 'camt053-001-02-mehrere.xml', 'camt053-001-08-einzeln.xml']) {
    const t = fs.readFileSync(path.join(ORDNER, n), 'utf8');
    assert.deepEqual(camt.camtXmlWohlgeformt(t), { ok: true, zeile: 0, grund: '' }, n);
  }
  const kaputt = [
    ['<?xml version="1.0"?>\n<a>\n<b>1</a>\n', 3, /passt nicht/],
    ['<a><b>1</b>', 1, /nicht geschlossen/],
    ['<a>x & y</a>', 1, /&/],
    ['<a b=1></a>', 1, /Attribut/],
    ['<a></a><c></c>', 1, /Wurzel/],
    ['', 0, /leer/],
    ['Buchungstag;Betrag\n', 1, /kein XML|außerhalb/],
  ];
  for (const [t, zeile, grund] of kaputt) {
    const e = camt.camtXmlWohlgeformt(t);
    assert.equal(e.ok, false, t);
    assert.equal(e.zeile, zeile, t);
    assert.match(e.grund, grund, t);
  }
  assert.equal(camt.camtXmlWohlgeformt('<a x="1" y=\'2\'><!-- k --><![CDATA[<>&]]>&amp;&#228;&#xE4;<b/></a>').ok, true);
});
