'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const kern = {
  zuordnung: require('../kern/zuordnung.js'),
  stufen: require('../kern/stufen.js'),
};
const st = kern.stufen;
const { einstellungen, zeile, zahlung, planeMitZahlungen, aktionVon } = require('./hilfen.js');

const STICHTAG = '2026-09-24';
const VOR = (tage) => st.datumPlusTage(STICHTAG, -tage);

test('Tagesarithmetik über Monats- und Zeitumstellungsgrenzen', () => {
  assert.equal(st.datumPlusTage('2026-02-27', 2), '2026-03-01');
  assert.equal(st.datumPlusTage('2026-03-01', -1), '2026-02-28');
  assert.equal(st.tageZwischen('2026-09-20', '2026-09-23'), 3);
  assert.equal(st.tageZwischen('2026-10-24', '2026-10-26'), 2);
  assert.equal(st.tageZwischen('2026-03-28', '2026-03-30'), 2);
});

test('T01 pünktlich bezahlt: 9001 keine Mail; Kontrolle 9002 ohne Zahlung, fällig vor 8 Tagen → Erinnerung', () => {
  const zeilen = [
    zeile(9001, { faelligkeit: st.datumPlusTage(STICHTAG, 5) }),
    zeile(9002, { betrag_brutto_cent: 50000, faelligkeit: VOR(8) }),
  ];
  const { plan } = planeMitZahlungen(kern, { zeilen, zahlungen: [zahlung('Z1', 100000, 'RE-2026-9001')], stichtag: STICHTAG });
  assert.equal(plan.versand.filter((e) => e.rechnungsnr === 'RE-2026-9001').length, 0);
  assert.equal(aktionVon(plan, 'RE-2026-9002'), 'senden');
  assert.equal(plan.versand.find((e) => e.rechnungsnr === 'RE-2026-9002').stufe, 1);
});

test('T01 zweiter Teil: 20 Tage später bleibt 9001 wegen der Zahlung ohne Mail; ohne Zahlung wäre sie fällig', () => {
  const spaeter = st.datumPlusTage(STICHTAG, 20);
  const zeilen = [zeile(9001, { faelligkeit: st.datumPlusTage(STICHTAG, 5) })];
  const mit = planeMitZahlungen(kern, { zeilen, zahlungen: [zahlung('Z1', 100000, 'RE-2026-9001')], stichtag: spaeter });
  const ohne = planeMitZahlungen(kern, { zeilen, zahlungen: [], stichtag: spaeter });
  assert.equal(mit.plan.versand.length, 0);
  assert.equal(aktionVon(ohne.plan, 'RE-2026-9001'), 'senden');
});

test('T04 Klärfall-Halt: ungeklärte Zahlung hält die fällige 9005 an; Kontrolle ohne Zahlung → Erinnerung', () => {
  const zeilen = [zeile(9005, { betrag_brutto_cent: 30000, faelligkeit: VOR(20) })];
  const halt = planeMitZahlungen(kern, {
    zeilen, stichtag: STICHTAG,
    zahlungen: [zahlung('Z1', 30000, 'Danke', { auftraggeber: 'Kunde Beispiel' })],
  });
  assert.equal(aktionVon(halt.plan, 'RE-2026-9005'), 'klaerfall_halt');
  assert.equal(halt.plan.versand.length, 0);
  assert.ok(halt.plan.protokoll.some((p) => p.rechnungsnr === 'RE-2026-9005' && p.grund === 'Klärfall-Halt'));
  const kontrolle = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG, zahlungen: [] });
  assert.equal(aktionVon(kontrolle.plan, 'RE-2026-9005'), 'senden');
});

test('T04 nach manueller Zuordnung: 9005 bezahlt, keine Mail', () => {
  const zeilen = [zeile(9005, { betrag_brutto_cent: 30000, faelligkeit: VOR(20) })];
  const r = planeMitZahlungen(kern, {
    zeilen, stichtag: STICHTAG,
    zahlungen: [zahlung('Z1', 30000, 'Danke', { auftraggeber: 'Kunde Beispiel' })],
    manuell: { Z1: 'RE-2026-9005' },
  });
  assert.equal(aktionVon(r.plan, 'RE-2026-9005'), 'keine');
  assert.equal(r.plan.versand.length, 0);
});

test('T05 b) beide Kandidaten angehalten; Kontrolle a) mit Nummer: nur die nicht bezahlte wird erinnert', () => {
  const zeilen = [
    zeile(9006, { betrag_brutto_cent: 25000, faelligkeit: VOR(10) }),
    zeile(9007, { betrag_brutto_cent: 25000, faelligkeit: VOR(10) }),
  ];
  const b = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG, zahlungen: [zahlung('Z1', 25000, 'Überweisung', { auftraggeber: 'Jemand Test' })] });
  assert.equal(aktionVon(b.plan, 'RE-2026-9006'), 'klaerfall_halt');
  assert.equal(aktionVon(b.plan, 'RE-2026-9007'), 'klaerfall_halt');
  const a = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG, zahlungen: [zahlung('Z1', 25000, 'RE-2026-9007')] });
  assert.equal(aktionVon(a.plan, 'RE-2026-9006'), 'senden');
  assert.equal(aktionVon(a.plan, 'RE-2026-9007'), 'keine');
});

test('T06 Mahnsperre: 9008 gesperrt, keine Mail; Kontrolle 9009 gleich ohne Sperre → Erinnerung', () => {
  const zeilen = [
    zeile(9008, { faelligkeit: VOR(30), mahnsperre: 'ja', mahnsperre_grund: 'Reklamation' }),
    zeile(9009, { faelligkeit: VOR(30) }),
  ];
  const { plan } = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG });
  assert.equal(aktionVon(plan, 'RE-2026-9008'), 'gesperrt');
  assert.ok(plan.protokoll.some((p) => p.rechnungsnr === 'RE-2026-9008' && p.grund === 'gesperrt'));
  assert.equal(aktionVon(plan, 'RE-2026-9009'), 'senden');
  assert.deepEqual(plan.versand.map((e) => e.rechnungsnr), ['RE-2026-9009']);
});

test('T06 Variante: Sperre gewinnt auch über einen freigegebenen Entwurf; Kontrolle ohne Sperre → Entwurf senden', () => {
  const basis = { aktuelle_stufe: 1, datum_letzte_stufe: VOR(20), faelligkeit: VOR(40), entwurf_id: 'E-1', entwurf_rest_cent: 100000, freigabe: 'ja', entwurf_datum: VOR(3) };
  const zeilen = [
    zeile(9008, Object.assign({}, basis, { mahnsperre: 'ja', mahnsperre_grund: 'Reklamation' })),
    zeile(9009, basis),
  ];
  const { plan } = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG });
  assert.equal(aktionVon(plan, 'RE-2026-9008'), 'gesperrt');
  assert.equal(aktionVon(plan, 'RE-2026-9009'), 'entwurf_senden');
});

test('Mahnsperre ohne Grund bleibt wirksam und erzeugt einen Hinweis', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [zeile(9008, { faelligkeit: VOR(30), mahnsperre: 'ja' })], stichtag: STICHTAG });
  assert.equal(aktionVon(plan, 'RE-2026-9008'), 'gesperrt');
  assert.ok(plan.meldungen.some((m) => m.rechnungsnr === 'RE-2026-9008' && /Grund/.test(m.text)));
});

test('T09 Kontoauszug 5 Tage alt, Max. 3: 0 Mails, 0 Entwürfe, 1 Alarm', () => {
  const zeilen = [
    zeile(9021, { faelligkeit: VOR(10) }),
    zeile(9022, { faelligkeit: VOR(10) }),
    zeile(9023, { faelligkeit: VOR(30), aktuelle_stufe: 1, datum_letzte_stufe: VOR(15) }),
  ];
  const { plan } = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG, auszugStand: VOR(5) });
  assert.equal(plan.frische.frisch, false);
  assert.equal(plan.versand.length, 0);
  assert.equal(plan.entscheidungen.filter((e) => e.aktion === 'zu_alt').length, 3);
  assert.equal(plan.alarme.length, 1);
  assert.ok(plan.protokoll.some((p) => p.grund === 'zu alt'));
});

test('T09 Kontrolle: derselbe Datenstand mit frischem Auszug (3 Tage) → 3 Vorgänge, kein Alarm', () => {
  const zeilen = [
    zeile(9021, { faelligkeit: VOR(10) }),
    zeile(9022, { faelligkeit: VOR(10) }),
    zeile(9023, { faelligkeit: VOR(30), aktuelle_stufe: 1, datum_letzte_stufe: VOR(15) }),
  ];
  const { plan } = planeMitZahlungen(kern, { zeilen, stichtag: STICHTAG, auszugStand: VOR(3) });
  assert.equal(plan.frische.frisch, true);
  assert.deepEqual(plan.versand.map((e) => e.aktion).sort(), ['entwurf_anlegen', 'senden', 'senden']);
  assert.equal(plan.alarme.length, 0);
});

test('T09 ohne jeden Auszug → keine Mail, Alarm', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [zeile(9021, { faelligkeit: VOR(10) })], stichtag: STICHTAG, auszugStand: null });
  assert.equal(plan.versand.length, 0);
  assert.equal(plan.alarme.length, 1);
});

test('T10 a) zweiter Lauf nach Versand → nicht senden; b) gleichzeitig → nur die früheste Reservierung sendet', () => {
  const nacheinander = [
    { schluessel: 'RE-2026-9030|1', aktion: 'reserviert', lauf_id: '101' },
    { schluessel: 'RE-2026-9030|1', aktion: 'versendet', lauf_id: '101' },
    { schluessel: 'RE-2026-9030|1', aktion: 'reserviert', lauf_id: '102' },
  ];
  assert.equal(st.darfSenden(nacheinander, 'RE-2026-9030', 1, '102').senden, false);
  const gleichzeitig = [
    { schluessel: 'RE-2026-9030|1', aktion: 'reserviert', lauf_id: '201' },
    { schluessel: 'RE-2026-9030|1', aktion: 'reserviert', lauf_id: '202' },
  ];
  assert.equal(st.darfSenden(gleichzeitig, 'RE-2026-9030', 1, '201').senden, true);
  const b = st.darfSenden(gleichzeitig, 'RE-2026-9030', 1, '202');
  assert.equal(b.senden, false);
  assert.equal(b.grund, 'übersprungen, anderer Lauf');
});

test('T10 Kontrolle: nur die eigene Reservierung, andere Stufe daneben → senden; ohne Reservierung → nicht', () => {
  const p = [
    { schluessel: 'RE-2026-9030|1', aktion: 'versendet', lauf_id: '100' },
    { schluessel: 'RE-2026-9030|2', aktion: 'reserviert', lauf_id: '300' },
  ];
  assert.equal(st.darfSenden(p, 'RE-2026-9030', 2, '300').senden, true);
  assert.equal(st.darfSenden(p, 'RE-2026-9030', 2, '301').senden, false);
  assert.equal(st.darfSenden([], 'RE-2026-9030', 2, '300').senden, false);
});

function mitEntwurf(nr, extra) {
  return zeile(nr, Object.assign({
    faelligkeit: VOR(40), aktuelle_stufe: 1, datum_letzte_stufe: VOR(20),
    entwurf_id: 'E-' + nr, entwurf_rest_cent: 100000, freigabe: 'ja', entwurf_datum: VOR(2),
  }, extra || {}));
}

test('T11 volle Zahlung zwischen Entwurf und Versand → Entwurf verworfen, kein Versand', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [mitEntwurf(9013)], stichtag: STICHTAG, zahlungen: [zahlung('Z1', 100000, 'RE-2026-9013')] });
  assert.equal(aktionVon(plan, 'RE-2026-9013'), 'entwurf_verwerfen');
  assert.equal(plan.versand.length, 0);
  assert.ok(plan.protokoll.some((p) => p.grund === 'Entwurf verworfen'));
});

test('T11 Teilzahlung → Entwurf ersetzt, Freigabe geleert, nicht versendet', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [mitEntwurf(9013)], stichtag: STICHTAG, zahlungen: [zahlung('Z1', 40000, 'RE-2026-9013')] });
  const e = plan.entscheidungen.find((x) => x.rechnungsnr === 'RE-2026-9013');
  assert.equal(e.aktion, 'entwurf_ersetzen');
  assert.equal(e.freigabe_leeren, true);
  assert.equal(e.rest_cent, 60000);
  assert.equal(plan.versand.filter((x) => x.aktion === 'entwurf_senden').length, 0);
});

test('T11 Kontrolle: Restbetrag unverändert und freigegeben → Entwurf senden', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [mitEntwurf(9013)], stichtag: STICHTAG });
  assert.equal(aktionVon(plan, 'RE-2026-9013'), 'entwurf_senden');
});

test('T11 Kontrolle: Entwurf ohne Freigabe → wartet, nichts versendet', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [mitEntwurf(9013, { freigabe: '' })], stichtag: STICHTAG });
  assert.equal(aktionVon(plan, 'RE-2026-9013'), 'wartet');
  assert.equal(plan.versand.length, 0);
});

test('T13 a) nur Kopfzeile: Lauf endet sauber, 0 Mails, Protokoll „0 offene Posten“', () => {
  const plan = st.planeLauf({ kopfzeile: st.STUFEN_PFLICHTSPALTEN, rechnungen: [], einstellungen: einstellungen(), stichtag: STICHTAG, auszugStand: STICHTAG });
  assert.equal(plan.entscheidungen.length, 0);
  assert.equal(plan.versand.length, 0);
  assert.ok(plan.protokoll.some((p) => p.grund === '0 offene Posten'));
});

test('T13 b) Spalte „Fälligkeit“ umbenannt → Abbruch vor jedem Versand; Kontrolle richtige Kopfzeile', () => {
  const kopf = st.STUFEN_PFLICHTSPALTEN.map((s) => (s === 'Fälligkeit' ? 'Faellig am' : s));
  assert.ok(st.STUFEN_PFLICHTSPALTEN.includes('Fälligkeit'));
  assert.throws(
    () => st.planeLauf({ kopfzeile: kopf, rechnungen: [zeile(9001, { faelligkeit: VOR(10) })], einstellungen: einstellungen(), stichtag: STICHTAG, auszugStand: STICHTAG }),
    /Fälligkeit/,
  );
  const ok = planeMitZahlungen(kern, { kopfzeile: st.STUFEN_PFLICHTSPALTEN, zeilen: [zeile(9001, { faelligkeit: VOR(10) })], stichtag: STICHTAG });
  assert.equal(ok.plan.versand.length, 1);
  assert.deepEqual(st.pruefeKopfzeile(kopf, st.STUFEN_PFLICHTSPALTEN).fehlend, ['Fälligkeit']);
});

// Simuliert jeden Kalendertag einen Lauf. Entwürfe gibt der Betrieb am selben Tag frei,
// versendet wird damit im Lauf des Folgetags.
function simuliere(startZeile, von, bisTage, mitFreigabe) {
  let z = Object.assign({}, startZeile);
  const ereignisse = [];
  for (let t = 0; t <= bisTage; t++) {
    const tag = st.datumPlusTage(von, t);
    const { plan } = planeMitZahlungen(kern, { zeilen: [z], stichtag: tag });
    const e = plan.entscheidungen[0];
    const vorher = z.aktuelle_stufe;
    if (e.aktion === 'senden' || e.aktion === 'entwurf_senden' || e.aktion === 'uebergabe') {
      z = Object.assign({}, z, { aktuelle_stufe: e.stufe, datum_letzte_stufe: tag, entwurf_id: '', entwurf_rest_cent: null, freigabe: '', entwurf_datum: '' });
      ereignisse.push({ tag, aktion: e.aktion, stufe: e.stufe });
    } else if (e.aktion === 'entwurf_anlegen') {
      z = Object.assign({}, z, { entwurf_id: 'E' + tag, entwurf_rest_cent: e.rest_cent, entwurf_datum: tag, freigabe: mitFreigabe ? 'ja' : '' });
      ereignisse.push({ tag, aktion: e.aktion, stufe: e.stufe });
    }
    assert.ok(z.aktuelle_stufe - vorher <= 1, 'mehr als eine Stufe in einem Lauf am ' + tag);
  }
  return ereignisse;
}

test('T16 ganze Stufenfolge: Erinnerung → 1. Mahnung → letzte Mahnung → Übergabe, je genau im Intervall', () => {
  const F = '2026-08-03';
  const ev = simuliere(zeile(9016, { faelligkeit: F }), F, 90, true);
  assert.deepEqual(ev, [
    { tag: st.datumPlusTage(F, 7), aktion: 'senden', stufe: 1 },
    { tag: st.datumPlusTage(F, 21), aktion: 'entwurf_anlegen', stufe: 2 },
    { tag: st.datumPlusTage(F, 22), aktion: 'entwurf_senden', stufe: 2 },
    { tag: st.datumPlusTage(F, 36), aktion: 'entwurf_anlegen', stufe: 3 },
    { tag: st.datumPlusTage(F, 37), aktion: 'entwurf_senden', stufe: 3 },
    { tag: st.datumPlusTage(F, 51), aktion: 'uebergabe', stufe: 4 },
  ]);
});

test('T16 Kontrolle: ohne Freigabe bleibt es bei Stufe 1 und einem wartenden Entwurf', () => {
  const F = '2026-08-03';
  const ev = simuliere(zeile(9016, { faelligkeit: F }), F, 90, false);
  assert.deepEqual(ev.map((x) => x.aktion), ['senden', 'entwurf_anlegen']);
});

test('T16 keine Stufe übersprungen: 90 Tage überfällig und nie gemahnt → zuerst die Erinnerung', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: [zeile(9016, { faelligkeit: VOR(90) })], stichtag: STICHTAG });
  const e = plan.entscheidungen[0];
  assert.equal(e.aktion, 'senden');
  assert.equal(e.stufe, 1);
});

test('T16 Grenze: einen Tag vor dem Intervall nichts, am Tag des Intervalls die Stufe', () => {
  const vorher = planeMitZahlungen(kern, { zeilen: [zeile(9016, { faelligkeit: VOR(6) })], stichtag: STICHTAG });
  const genau = planeMitZahlungen(kern, { zeilen: [zeile(9016, { faelligkeit: VOR(7) })], stichtag: STICHTAG });
  assert.equal(aktionVon(vorher.plan, 'RE-2026-9016'), 'keine');
  assert.equal(aktionVon(genau.plan, 'RE-2026-9016'), 'senden');
});

test('Übergabe ist nur Meldung, danach keine Automatik mehr', () => {
  const a = planeMitZahlungen(kern, { zeilen: [zeile(9017, { faelligkeit: VOR(80), aktuelle_stufe: 3, datum_letzte_stufe: VOR(14) })], stichtag: STICHTAG });
  assert.equal(aktionVon(a.plan, 'RE-2026-9017'), 'uebergabe');
  assert.equal(a.plan.versand.length, 0);
  const b = planeMitZahlungen(kern, { zeilen: [zeile(9017, { faelligkeit: VOR(80), aktuelle_stufe: 4, datum_letzte_stufe: VOR(30) })], stichtag: STICHTAG });
  assert.equal(aktionVon(b.plan, 'RE-2026-9017'), 'keine');
});

test('Mindestbetrag: Rest 4,00 wird gemeldet statt gemahnt; Kontrolle Rest 5,00 → Erinnerung', () => {
  const zeilen = [
    zeile(9018, { betrag_brutto_cent: 10000, faelligkeit: VOR(10) }),
    zeile(9019, { betrag_brutto_cent: 10000, faelligkeit: VOR(10) }),
  ];
  const { plan } = planeMitZahlungen(kern, {
    zeilen, stichtag: STICHTAG,
    zahlungen: [zahlung('Z1', 9600, 'RE-2026-9018'), zahlung('Z2', 9500, 'RE-2026-9019')],
  });
  assert.equal(aktionVon(plan, 'RE-2026-9018'), 'unter_mindestbetrag');
  assert.equal(aktionVon(plan, 'RE-2026-9019'), 'senden');
});

function faellige(n) {
  const z = [];
  for (let i = 0; i < n; i++) z.push(zeile(9100 + i, { faelligkeit: VOR(10) }));
  return z;
}

test('T19 Mengenbremse: 25 fällige bei Höchstzahl 20 → 0 Mails, Alarm', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: faellige(25), stichtag: STICHTAG });
  assert.equal(plan.mengenbremse.gerissen, true);
  assert.equal(plan.mengenbremse.anzahl, 25);
  assert.equal(plan.versand.length, 0);
  assert.equal(plan.alarme.length, 1);
  assert.equal(plan.entscheidungen.filter((e) => e.aktion === 'mengenbremse').length, 25);
});

test('T19 Kontrolle: genau 20 fällige bei Höchstzahl 20 → 20 Mails, kein Alarm', () => {
  const { plan } = planeMitZahlungen(kern, { zeilen: faellige(20), stichtag: STICHTAG });
  assert.equal(plan.mengenbremse.gerissen, false);
  assert.equal(plan.versand.length, 20);
  assert.equal(plan.alarme.length, 0);
});

test('T20 Modus test erzwingt den Testempfänger; Kontrolle scharf → Kundenadresse; trocken → kein Versand', () => {
  const t = st.waehleEmpfaenger('test', 'kunde-20@example.invalid', 'testempfaenger@example.invalid');
  assert.equal(t.senden, true);
  assert.equal(t.an, 'testempfaenger@example.invalid');
  const s = st.waehleEmpfaenger('scharf', 'kunde-20@example.invalid', 'testempfaenger@example.invalid');
  assert.equal(s.an, 'kunde-20@example.invalid');
  assert.equal(st.waehleEmpfaenger('trocken', 'kunde-20@example.invalid', 'testempfaenger@example.invalid').senden, false);
});

test('T20 fail-closed: Modus test ohne Testempfänger, unbekannter Modus, ungültige Kundenadresse → kein Versand', () => {
  assert.equal(st.waehleEmpfaenger('test', 'kunde-20@example.invalid', '').senden, false);
  assert.equal(st.waehleEmpfaenger('Scharf!', 'kunde-20@example.invalid', 'testempfaenger@example.invalid').senden, false);
  assert.equal(st.waehleEmpfaenger('scharf', 'keine-adresse', 'testempfaenger@example.invalid').senden, false);
});

test('Stichtag gilt nur in test/trocken; im Modus scharf ignoriert und gemeldet', () => {
  assert.deepEqual(st.bestimmeStichtag('test', '2026-10-01', STICHTAG), { stichtag: '2026-10-01', hinweis: '' });
  const s = st.bestimmeStichtag('scharf', '2026-10-01', STICHTAG);
  assert.equal(s.stichtag, STICHTAG);
  assert.match(s.hinweis, /ignoriert/);
  assert.deepEqual(st.bestimmeStichtag('test', '', STICHTAG), { stichtag: STICHTAG, hinweis: '' });
});

// Auftrag 25.09.2026, Bedingung zu Teil A: eine Zeile mit Hinweis aus „Offene Posten lesen“ wird nie versendet.
test('Zeile mit Hinweis (Fälligkeit vor Rechnungsdatum), fällig → keine Mail, Aktion hinweis; Kontrolle gleiche Zeile ohne Hinweis → Erinnerung', () => {
  const mit = zeile(9031, { faelligkeit: VOR(8), rechnungsdatum: VOR(1), hinweise: ['Fälligkeit liegt vor dem Rechnungsdatum'] });
  const ohne = zeile(9032, { faelligkeit: VOR(8), rechnungsdatum: VOR(1), hinweise: [] });
  const { plan } = planeMitZahlungen(kern, { zeilen: [mit, ohne], stichtag: STICHTAG });
  assert.equal(aktionVon(plan, 'RE-2026-9031'), 'hinweis');
  assert.equal(aktionVon(plan, 'RE-2026-9032'), 'senden');
  assert.deepEqual(plan.versand.map((d) => d.rechnungsnr), ['RE-2026-9032']);
});

test('Teil A 9: Textbausteine ungültig → kein Versand im ganzen Lauf, Alarm nennt den Betreff; Übergabe bleibt; Kontrolle ohne Fehler → Versand', () => {
  const zeilen = [zeile(9002, { faelligkeit: VOR(8) }), zeile(9016, { aktuelle_stufe: 3, datum_letzte_stufe: VOR(14) })];
  const kette = (fehler) => {
    const zuo = kern.zuordnung.ordneZahlungenZu({ rechnungen: zeilen, zahlungen: [], manuell: {}, muster: 'RE-\\d{4}-\\d{3,5}' });
    return st.planeLauf({ kopfzeile: st.STUFEN_PFLICHTSPALTEN, rechnungen: st.mitZahlstand(zeilen, zuo.rechnungen),
      einstellungen: einstellungen(), stichtag: STICHTAG, auszugStand: STICHTAG, textbausteine_fehler: fehler });
  };
  const p = kette(['Stufe 2 B2B: Betreff ohne {rechnungsnr}']);
  assert.equal(aktionVon(p, 'RE-2026-9002'), 'textbausteine');
  assert.equal(aktionVon(p, 'RE-2026-9016'), 'uebergabe');
  assert.equal(p.versand.length, 0);
  assert.deepEqual(p.alarme, [{ art: 'Textbausteine ungültig', text: 'Stufe 2 B2B: Betreff ohne {rechnungsnr}' }]);
  const k = kette([]);
  assert.equal(aktionVon(k, 'RE-2026-9002'), 'senden');
  assert.deepEqual(k.alarme, []);
});

// Baustein 10, Teil A 4 (Entscheidung Elias 25.09.2026): Spalte „Versandstatus klären“. Die Klärung rechnet der Hauptlauf
// aus der Data Table (versand.js klaereVersandstatus); ohne sie wird eine Zeile mit Wert nie versendet.
const MIT_STAND = (nr, x) => Object.assign(zeile(nr, x), { status: 'offen', bezahlt_cent: 0, rest_cent: 100000 });
test('B10 A 4: „Versandstatus klären“ gesetzt, vom Hauptlauf nicht geklärt → Hinweis, nie Versand; Kontrolle leer → Erinnerung', () => {
  const d = st.entscheide(MIT_STAND(9009, { versandstatus_klaeren: 'versendet' }), einstellungen(), STICHTAG);
  assert.deepEqual([d.aktion, d.grund], ['hinweis', 'Versandstatus klären gesetzt, nicht verarbeitet']);
  assert.deepEqual(d.meldungen, [{ rechnungsnr: 'RE-2026-9009', text: 'Versandstatus klären gesetzt, nicht verarbeitet' }]);
  assert.equal(st.entscheide(MIT_STAND(9009, { versandstatus_klaeren: '' }), einstellungen(), STICHTAG).aktion, 'senden');
  const h = st.entscheide(MIT_STAND(9009, { versandstatus_klaeren: 'vielleicht', versandstatus_klaerung: { aktion: 'hinweis',
    grund: 'Versandstatus klären: Wert „vielleicht“ unbekannt (erlaubt: versendet, nicht versendet)' } }), einstellungen(), STICHTAG);
  assert.deepEqual([h.aktion, h.meldungen.length], ['hinweis', 1]);
});

test('B10 A 4: Klärung „versendet“ bzw. „nicht versendet“ → eigene Aktion mit Stufe, kein Versand, zählt nicht zur Mengenbremse', () => {
  const kv = { aktion: 'versandstatus_versendet', stufe: 1, grund: 'Versandstatus geklärt: versendet – Stufe nachgezogen' };
  const kz = { aktion: 'versandstatus_zurueck', stufe: 1, grund: 'Versandstatus geklärt: nicht versendet – Reservierung zurückgegeben' };
  const plan = st.planeLauf({ kopfzeile: st.STUFEN_PFLICHTSPALTEN, einstellungen: einstellungen({ hoechstzahl_mails: 0 }), stichtag: STICHTAG,
    auszugStand: STICHTAG, rechnungen: [MIT_STAND(9009, { versandstatus_klaeren: 'versendet', versandstatus_klaerung: kv }),
      MIT_STAND(9006, { versandstatus_klaeren: 'nicht versendet', versandstatus_klaerung: kz })] });
  assert.deepEqual(plan.entscheidungen.map((d) => [d.aktion, d.stufe, d.grund]),
    [['versandstatus_versendet', 1, kv.grund], ['versandstatus_zurueck', 1, kz.grund]]);
  // der Betrieb sieht die Klärung in der Sammelmeldung (die Zelle ist danach leer)
  assert.deepEqual(plan.meldungen, [{ rechnungsnr: 'RE-2026-9009', text: kv.grund }, { rechnungsnr: 'RE-2026-9006', text: kz.grund }]);
  assert.equal(plan.versand.length, 0);
  assert.equal(plan.mengenbremse.gerissen, false);
  assert.equal(st.STUFEN_PFLICHTSPALTEN[st.STUFEN_PFLICHTSPALTEN.length - 1], 'Versandstatus klären');
});
