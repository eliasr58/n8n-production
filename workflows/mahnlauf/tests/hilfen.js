'use strict';
// Gemeinsame Testbausteine. Kein Test selbst (Dateiname ohne .test.js).
// Alle Werte erfunden, Regeln aus BAUPLAN j.

const fs = require('node:fs');
const path = require('node:path');

const TESTDATEN = path.join(__dirname, 'testdaten');

function ladeBytes(name) {
  return Array.from(fs.readFileSync(path.join(TESTDATEN, 'csv', name)));
}

const MUSTER = 'RE-\\d{4}-\\d{3,5}';

function einstellungen(abweichend) {
  return Object.assign({
    modus: 'test',
    intervall_erinnerung: 7,
    intervall_mahnung1: 14,
    intervall_letzte_mahnung: 14,
    intervall_uebergabe: 14,
    freigabemodus_erinnerung: 'automatisch',
    freigabemodus_mahnung1: 'Entwurf',
    freigabemodus_letzte_mahnung: 'Entwurf',
    max_alter_auszug: 3,
    mindestbetrag_cent: 500,
    hoechstzahl_mails: 20,
    zahlungsfrist: 10,
  }, abweichend || {});
}

// Eine Zeile aus „Offene Posten“, wie der Code-Node sie nach dem Lesen bekommt
// (Beträge schon in Cent, Daten schon als JJJJ-MM-TT).
function zeile(nr, abweichend) {
  const zz = String(nr).slice(-2);
  return Object.assign({
    rechnungsnr: 'RE-2026-' + nr,
    kunde: 'Kunde Beispiel ' + zz,
    kundentyp: 'B2B',
    email: 'kunde-' + zz + '@example.invalid',
    rechnungsdatum: '2026-08-01',
    faelligkeit: '2026-08-15',
    betrag_brutto_cent: 100000,
    mahnsperre: '',
    mahnsperre_grund: '',
    aktuelle_stufe: 0,
    datum_letzte_stufe: '',
    freigabe: '',
    entwurf_id: '',
    entwurf_rest_cent: null,
    entwurf_datum: '',
  }, abweichend || {});
}

function zahlung(schluessel, betragCent, zweck, abweichend) {
  return Object.assign({
    schluessel,
    buchungsdatum: '2026-09-22',
    betrag_cent: betragCent,
    waehrung: 'EUR',
    auftraggeber: 'Unbekannt Test',
    iban: 'DE00111122223333444499',
    verwendungszweck: zweck,
    referenz: '',
    quelle: 'test.csv',
  }, abweichend || {});
}

// Die Kette, wie der Hauptlauf sie fährt: Zuordnung → Zahlstand an die Zeilen → Plan.
function planeMitZahlungen(kern, o) {
  const zuo = kern.zuordnung.ordneZahlungenZu({
    rechnungen: o.zeilen,
    zahlungen: o.zahlungen || [],
    manuell: o.manuell || {},
    muster: MUSTER,
  });
  const mitStand = kern.stufen.mitZahlstand(o.zeilen, zuo.rechnungen);
  const plan = kern.stufen.planeLauf({
    kopfzeile: o.kopfzeile || kern.stufen.STUFEN_PFLICHTSPALTEN,
    rechnungen: mitStand,
    einstellungen: einstellungen(o.einst),
    stichtag: o.stichtag,
    auszugStand: o.auszugStand === undefined ? o.stichtag : o.auszugStand,
  });
  return { zuo, plan };
}

function aktionVon(plan, rechnungsnr) {
  const e = plan.entscheidungen.find((x) => x.rechnungsnr === rechnungsnr);
  return e ? e.aktion : undefined;
}

module.exports = { ladeBytes, MUSTER, einstellungen, zeile, zahlung, planeMitZahlungen, aktionVon };
