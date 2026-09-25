// Mahnlauf, Kernlogik: Zahlungen den Rechnungen zuordnen (BAUPLAN d, "Zuordnung").
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Reine Funktion:
// gleiche Eingabe -> gleiches Ergebnis. "bezahlt" wird bei jedem Lauf aus allen
// bekannten Zahlungen NEU summiert, nie hochgezaehlt. Betraege in ganzen Cent.
// Was nicht sicher ist, wird Klaerfall - verbucht wird nur Eindeutiges.

var ZUO_TRENNER = '[\\s\\-\\/\\.\\u2010-\\u2015]*';

// Grossbuchstaben, ohne Leerzeichen, Binde-/Schraegstriche und Punkte:
// "RE 2026-014" = "RE2026014".
function normalisiereNummer(text) {
  return String(text == null ? '' : text).toUpperCase().replace(/[\s\-\/\.‐-―]/g, '');
}

// Trenner im Muster ("-", "/", "\.", " ", "\s") ausserhalb von Zeichenklassen
// werden zu "beliebig viele Trenner". So passt "RE-\d{4}-\d{3,5}" auf
// "RE 2026-9001", "RE2026/9001" und "RE20269001" - aber Ziffern nach einem
// Leerzeichen ("RE-2026-9001 12,50") werden nicht an die Nummer geklebt.
function zuoLockeresMuster(muster) {
  var src = String(muster || '');
  var aus = '';
  var inKlasse = false;
  for (var i = 0; i < src.length; i++) {
    var c = src[i];
    if (c === '\\') {
      var n = src[i + 1];
      if (!inKlasse && (n === '-' || n === '/' || n === '.' || n === ' ' || n === 's')) {
        aus += ZUO_TRENNER;
        i++;
        continue;
      }
      aus += c + (n === undefined ? '' : n);
      i++;
      continue;
    }
    if (inKlasse) {
      if (c === ']') inKlasse = false;
      aus += c;
      continue;
    }
    if (c === '[') { inKlasse = true; aus += c; continue; }
    if (c === '-' || c === '/' || c === ' ') { aus += ZUO_TRENNER; continue; }
    aus += c;
  }
  return aus;
}

// Alle Rechnungsnummern im Text, normalisiert, ohne Doppelte, in Textreihenfolge.
function findeRechnungsnummern(text, muster) {
  var s = String(text == null ? '' : text).toUpperCase();
  if (!s || !muster) return [];
  var re = new RegExp('(?<![A-Z0-9])(?:' + zuoLockeresMuster(muster) + ')(?![0-9])', 'gi');
  var aus = [];
  var m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    var n = normalisiereNummer(m[0]);
    if (aus.indexOf(n) < 0) aus.push(n);
  }
  return aus;
}

function zuoSperre(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  var s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'nein' && s !== 'false' && s !== '0';
}

function zuoName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

// Auftraggeber passt zum Kunden: gleich oder einer enthaelt den anderen,
// beide mindestens 5 Zeichen nach dem Glaetten.
function zuoNamePasst(a, b) {
  var x = zuoName(a);
  var y = zuoName(b);
  if (x.length < 5 || y.length < 5) return false;
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

// p = { rechnungen, zahlungen, klaerfaelle, manuell, muster }
//   rechnungen: Zeilen aus "Offene Posten" (rechnungsnr, kunde, betrag_brutto_cent, mahnsperre)
//   zahlungen:  Zahlungsobjekte (schluessel, buchungsdatum, betrag_cent, waehrung,
//               auftraggeber, iban, verwendungszweck, referenz, quelle)
//   klaerfaelle: Klaerfaelle der Parser (wie Zahlungen, dazu grund). Sie werden nie
//               automatisch verbucht, halten aber ihre Kandidaten an; nur eine
//               manuelle Zuordnung verbucht sie.
//   manuell:    { Buchungsschluessel: "RE-2026-9005" } aus der Spalte "manuelle Zuordnung"
//   muster:     Rechnungsnummer-Muster aus dem Einstellungsblatt
// Ergebnis: { zahlungen: [...], rechnungen: [... je Eingangszeile, gleiche Reihenfolge], meldungen: [...] }
function ordneZahlungenZu(p) {
  var manuell = p.manuell || {};
  var muster = p.muster;
  var meldungen = [];

  var anzahl = {};
  (p.rechnungen || []).forEach(function (r) {
    var n = normalisiereNummer(r.rechnungsnr);
    anzahl[n] = (anzahl[n] || 0) + 1;
  });
  var liste = [];
  var bekannt = {};
  var gemeldet = {};
  (p.rechnungen || []).forEach(function (r) {
    var n = normalisiereNummer(r.rechnungsnr);
    var eintrag = {
      rechnungsnr: r.rechnungsnr,
      norm: n,
      kunde: r.kunde || '',
      brutto: r.betrag_brutto_cent,
      gueltig: n !== '' && Number.isInteger(r.betrag_brutto_cent) && r.betrag_brutto_cent > 0,
      gesperrt: zuoSperre(r.mahnsperre),
      dublette: n !== '' && anzahl[n] > 1,
      bezahlt: 0,
      klaerfall: [],
    };
    liste.push(eintrag);
    if (n !== '') (bekannt[n] = bekannt[n] || []).push(eintrag);
    if (!eintrag.gueltig) meldungen.push({ art: 'ungültige Zeile', rechnungsnr: r.rechnungsnr, text: 'Rechnungsnr. leer oder Betrag brutto nicht > 0' });
    if (eintrag.dublette && !gemeldet[n]) {
      gemeldet[n] = true;
      meldungen.push({ art: 'Dublette', rechnungsnr: r.rechnungsnr, text: 'Rechnungsnr. mehrfach, alle Zeilen gesperrt' });
    }
  });
  var rest = function (r) { return r.brutto - r.bezahlt; };

  // Doppelte Buchungsschluessel zaehlen einmal (derselbe Auszug zweimal gelesen).
  var gesehen = {};
  var eindeutig = [];
  var ausAuszug = {};
  var nimm = function (z, klaerfall) {
    if (gesehen[z.schluessel]) {
      meldungen.push({ art: 'doppelter Buchungsschlüssel', schluessel: z.schluessel, text: 'nur einmal gezählt' });
      return;
    }
    gesehen[z.schluessel] = true;
    if (klaerfall) ausAuszug[z.schluessel] = String(z.grund || '').trim() || 'ohne Grund';
    eindeutig.push(z);
  };
  (p.zahlungen || []).forEach(function (z) { nimm(z, false); });
  (p.klaerfaelle || []).forEach(function (z) { nimm(z, true); });
  eindeutig.sort(function (a, b) {
    if (a.buchungsdatum !== b.buchungsdatum) return a.buchungsdatum < b.buchungsdatum ? -1 : 1;
    return a.schluessel < b.schluessel ? -1 : a.schluessel > b.schluessel ? 1 : 0;
  });

  var ergebnisse = [];
  eindeutig.forEach(function (z) {
    var erg = { schluessel: z.schluessel, betrag_cent: z.betrag_cent, zuordnung: 'ungeklärt', rechnungen: [], kandidaten: [], genannt: [], grund: '' };
    ergebnisse.push(erg);
    // Genannte Nummern immer suchen - auch eine unverwertbare Zahlung haelt die Rechnung an, die sie nennt.
    var nummern = findeRechnungsnummern(z.verwendungszweck, muster);
    findeRechnungsnummern(z.referenz, muster).forEach(function (n) {
      if (nummern.indexOf(n) < 0) nummern.push(n);
    });
    erg.genannt = nummern;
    if (!Number.isInteger(z.betrag_cent) || z.betrag_cent <= 0 || z.waehrung !== 'EUR') {
      erg.grund = 'Betrag oder Währung nicht verwertbar';
      return;
    }
    var man = manuell[z.schluessel];
    if (man !== undefined && man !== null && String(man).trim() !== '') {
      var ziel = bekannt[normalisiereNummer(man)];
      if (!ziel) { erg.grund = 'manuelle Zuordnung: Rechnungsnr. unbekannt'; return; }
      if (ziel.length > 1) { erg.grund = 'manuelle Zuordnung: Rechnungsnr. mehrfach (Dublette)'; return; }
      if (!ziel[0].gueltig) { erg.grund = 'manuelle Zuordnung: Zeile ungültig'; return; }
      ziel[0].bezahlt += z.betrag_cent;
      erg.zuordnung = 'manuell';
      erg.rechnungen = [{ rechnungsnr: ziel[0].rechnungsnr, betrag_cent: z.betrag_cent }];
      return;
    }
    if (ausAuszug[z.schluessel] !== undefined) { erg.grund = 'Klärfall aus dem Auszug: ' + ausAuszug[z.schluessel]; return; } // Sicherung Klärfall aus dem Auszug
    if (!nummern.length) { erg.grund = 'keine Rechnungsnr.'; return; }
    var ziele = [];
    for (var i = 0; i < nummern.length; i++) {
      var b = bekannt[nummern[i]];
      if (!b) { erg.grund = 'Rechnungsnr. unbekannt: ' + nummern[i]; return; }
      if (b.length > 1) { erg.grund = 'Rechnungsnr. mehrfach (Dublette): ' + b[0].rechnungsnr; return; }
      if (!b[0].gueltig) { erg.grund = 'Zeile ungültig: ' + b[0].rechnungsnr; return; }
      if (b[0].gesperrt) { erg.grund = 'Rechnung gesperrt: ' + b[0].rechnungsnr; return; }
      if (rest(b[0]) <= 0) { erg.grund = 'Rechnung schon bezahlt: ' + b[0].rechnungsnr; return; }
      ziele.push(b[0]);
    }
    if (ziele.length === 1) {
      ziele[0].bezahlt += z.betrag_cent;
      erg.zuordnung = 'automatisch';
      erg.rechnungen = [{ rechnungsnr: ziele[0].rechnungsnr, betrag_cent: z.betrag_cent }];
      return;
    }
    var summe = ziele.reduce(function (s, r) { return s + rest(r); }, 0);
    if (summe !== z.betrag_cent) { erg.grund = 'mehrere Rechnungsnr., Betrag passt nicht'; return; }
    erg.zuordnung = 'automatisch';
    ziele.forEach(function (r) {
      erg.rechnungen.push({ rechnungsnr: r.rechnungsnr, betrag_cent: rest(r) });
      r.bezahlt += rest(r);
    });
  });

  // Kandidaten erst nach allen Verbuchungen: offene Rechnungen, die genannt sind,
  // deren Rest dem Betrag gleicht oder deren Kunde zum Auftraggeber passt.
  // Jeder Kandidat wird bis zur Klaerung angehalten (Klaerfall-Halt).
  var nachSchluessel = {};
  eindeutig.forEach(function (z) { nachSchluessel[z.schluessel] = z; });
  ergebnisse.forEach(function (erg) {
    if (erg.zuordnung !== 'ungeklärt') return;
    var z = nachSchluessel[erg.schluessel];
    var kand = [];
    liste.forEach(function (r) {
      if (!r.gueltig || r.dublette || rest(r) <= 0) return;
      var genannt = erg.genannt.indexOf(r.norm) >= 0;
      if (genannt || rest(r) === z.betrag_cent || zuoNamePasst(z.auftraggeber, r.kunde)) {
        if (kand.indexOf(r.rechnungsnr) < 0) kand.push(r.rechnungsnr);
        r.klaerfall.push(erg.schluessel);
      }
    });
    kand.sort();
    erg.kandidaten = kand;
    meldungen.push({ art: 'Klärfall', schluessel: erg.schluessel, betrag_cent: erg.betrag_cent, grund: erg.grund, kandidaten: kand });
  });

  var rechnungen = liste.map(function (r) {
    var offen = r.gueltig ? rest(r) : null;
    var status;
    if (!r.gueltig) status = 'ungültig';
    else if (r.dublette) status = 'Dublette';
    else if (offen === 0) status = 'bezahlt';
    else if (offen < 0) status = 'überzahlt';
    else status = 'offen';
    if (status === 'überzahlt') {
      meldungen.push({ art: 'Überzahlung', rechnungsnr: r.rechnungsnr, ueberschuss_cent: -offen, text: 'Überschuss gemeldet, nicht verrechnet' });
    }
    return {
      rechnungsnr: r.rechnungsnr,
      bezahlt_cent: r.bezahlt,
      rest_cent: offen,
      status: status,
      ueberschuss_cent: offen !== null && offen < 0 ? -offen : 0,
      klaerfall_halt: r.klaerfall.length > 0,
      klaerfall_schluessel: r.klaerfall.slice(),
      dublette: r.dublette,
    };
  });

  return {
    zahlungen: ergebnisse.map(function (e) {
      return { schluessel: e.schluessel, betrag_cent: e.betrag_cent, zuordnung: e.zuordnung, rechnungen: e.rechnungen, kandidaten: e.kandidaten, grund: e.grund };
    }),
    rechnungen: rechnungen,
    meldungen: meldungen,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalisiereNummer, findeRechnungsnummern, ordneZahlungenZu };
}
