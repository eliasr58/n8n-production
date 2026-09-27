'use strict';
// Gemeinsame Testbausteine. Kein Test selbst (Dateiname ohne .test.js).
// Alle Werte erfunden (BAUPLAN j): Betrieb „Heizung & Sanitär Beispiel GmbH“, Kunden „Kunde Beispiel NN“,
// Adressen @example.invalid, Anlagen W-9NNN, Kunden K-9NNN.

const STICHTAG = '2026-09-28';

// Kern der Einstellungen, wie leseEinstellungen ihn liefert (E9-Standardwerte).
function einstellungen(abweichend) {
  return Object.assign({
    modus: 'test',
    vorlauf: 42,
    nachlauf: 30,
    erinnerung_nach: 14,
    antwortfenster: 21,
    antworten_lesen_bis: 180,
    standardintervall: 12,
    hoechstzahl_mails: 20,
    ki_einordnung: 'an',
  }, abweichend || {});
}

// Eine Anlage, wie leseAnlagen sie liefert. nr: 9001 ... ; Fälligkeit über letzte_wartung steuern.
function anlage(nr, abweichend) {
  const zz = String(nr).slice(-2);
  return Object.assign({
    zeile: nr - 8999,
    anlagen_id: 'W-' + nr,
    kunden_id: 'K-' + nr,
    kunde: 'Kunde Beispiel ' + zz,
    email: 'kunde-' + zz + '@example.invalid',
    anlage: 'Gas-Brennwerttherme',
    leistung: 'Wartung',
    erhoben_bei: 'RE-2025-' + nr,
    hinweis_erhebung: '2025-10-01',
    einbaudatum: '2018-05-14',
    letzte_wartung: '2025-10-20',
    intervall: 12,
    pause: false,
    pause_grund: '',
    werbewiderspruch: false,
    widerspruch_aufheben: '',
    faelligkeit_zelle: '',
    status: '',
    angebot_am: '',
    erinnerung_am: '',
    thread_id: '',
    antwort: '',
    antwort_erledigt: false,
    versandstatus_klaeren: '',
    mangel: [],
  }, abweichend || {});
}

// letzte Wartung so, dass die Fälligkeit (12 Monate) in `tage` Tagen nach dem Stichtag liegt.
function wartungFuerFaelligIn(tage) {
  const t = Date.UTC(2026, 8, 28) + tage * 86400000;
  const d = new Date(t);
  const z = (n) => (n < 10 ? '0' : '') + n;
  return (d.getUTCFullYear() - 1) + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
}

module.exports = { STICHTAG, einstellungen, anlage, wartungFuerFaelligIn };
