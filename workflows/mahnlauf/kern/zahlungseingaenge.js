// Mahnlauf, Kernlogik: Blatt "Zahlungseingänge" als Buch (BAUPLAN b und d, Baustein 5).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Das Blatt ist das Buch aller
// Buchungen, die je gelesen wurden: neue Schluessel werden angehaengt, nie geaendert; die
// Zuordnung wird bei jedem Lauf aus dem GANZEN Buch neu gerechnet (nie hochgezaehlt) und nur in
// die berechneten Spalten zurueckgeschrieben. Die Spalte "manuelle Zuordnung" schreibt nur der
// Betrieb. Werte wie die Sheets-API sie mit UNFORMATTED_VALUE/SERIAL_NUMBER liefert.
//
// Doppelzaehlung verhindern (Auftrag 25.09.2026, Teil A 3): Steht die Bankreferenz einer neuen
// Buchung schon im Buch - unter einem ANDEREN Schluessel -, wird sie Klaerfall "Referenz bereits
// vorhanden" und nicht verbucht. Derselbe Schluessel ist dieselbe Buchung (Auszug zweimal
// gelesen) und wird nicht noch einmal angehaengt.

var ZE_SPALTEN = [
  'Buchungsschlüssel', 'Bankreferenz', 'Buchungsdatum', 'Betrag', 'Währung', 'Auftraggeber', 'IBAN',
  'Verwendungszweck', 'Strukturierte Referenz', 'Quelldatei', 'Klärfall aus Auszug',
  'zugeordnete Rechnungsnr.', 'Zuordnung', 'Kandidaten', 'Grund', 'manuelle Zuordnung',
];

var ZE_TAG0 = Date.UTC(1899, 11, 30);

function zeText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function zeZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

function zeSerialZuDatum(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 1) return '';
  var d = new Date(ZE_TAG0 + Math.floor(v) * 86400000);
  return d.getUTCFullYear() + '-' + zeZwei(d.getUTCMonth() + 1) + '-' + zeZwei(d.getUTCDate());
}

function zeDatumZuSerial(d) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  if (!r) return '';
  return (Date.UTC(+r[1], +r[2] - 1, +r[3]) - ZE_TAG0) / 86400000;
}

function zeSpalte(i) {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

// werte: [[Kopfzeile], [Zeile], ...] -> { ok, fehlend_spalten, doppelte_spalten, reihenfolge_falsch,
// abweichend, zusaetzlich, zeilen, hinweise, naechste_zeile }. Die Kopfzeile muss EXAKT ZE_SPALTEN
// sein - Namen ungetrimmt, Reihenfolge, keine weitere nichtleere Spalte (Auftrag 25.09.2026, Teil A 1):
// zurueckgeschrieben wird nach Spaltenbuchstaben (schreibBereiche), eine verschobene Spalte bekaeme
// sonst fremde Werte. Bei Abweichung keine Zeilen - wer ok false bekommt, schreibt nicht.
function leseZahlungseingaenge(werte) {
  var w = werte || [];
  var roh = (w[0] || []).map(function (v) { return v === undefined || v === null ? '' : String(v); });
  var kopf = roh.map(zeText);
  var fehlend = ZE_SPALTEN.filter(function (s) { return kopf.indexOf(s) < 0; });
  var doppelt = ZE_SPALTEN.filter(function (s) {
    var i = kopf.indexOf(s);
    return i >= 0 && kopf.indexOf(s, i + 1) >= 0;
  });
  var reihenfolge = !fehlend.length && ZE_SPALTEN.some(function (s, i) { return kopf[i] !== s; });
  var abweichend = [];
  ZE_SPALTEN.forEach(function (s, i) {
    if (roh[i] !== s) abweichend.push(zeSpalte(i) + ': erwartet „' + s + '“, steht „' + (roh[i] === undefined ? '' : roh[i]) + '“');
  });
  var zusaetzlich = [];
  for (var j = ZE_SPALTEN.length; j < roh.length; j++) if (roh[j] !== '') zusaetzlich.push(zeSpalte(j) + ': ' + roh[j]);
  var aus = { ok: !fehlend.length && !doppelt.length && !reihenfolge,
    fehlend_spalten: fehlend, doppelte_spalten: doppelt, reihenfolge_falsch: reihenfolge, abweichend: abweichend,
    zusaetzlich: zusaetzlich, zeilen: [], hinweise: [], naechste_zeile: Math.max(w.length, 1) + 1 };
  if (abweichend.length || zusaetzlich.length) aus.ok = false; // Sicherung Kopfzeile exakt
  if (!aus.ok) return aus;
  var idx = {};
  ZE_SPALTEN.forEach(function (s) { idx[s] = kopf.indexOf(s); });
  for (var r = 1; r < w.length; r++) {
    var reihe = w[r] || [];
    if (reihe.every(function (v) { return zeText(v) === ''; })) continue;
    var feld = function (s) { return reihe[idx[s]]; };
    var nr = r + 1;
    var sl = zeText(feld('Buchungsschlüssel'));
    if (!sl) {
      sl = 'ZEILE-' + nr;
      aus.hinweise.push({ zeile: nr, text: 'Zeile ohne Buchungsschlüssel' });
    }
    var betrag = feld('Betrag');
    var cent = typeof betrag === 'number' && isFinite(betrag) ? Math.round(betrag * 100) : null;
    if (cent === null) aus.hinweise.push({ zeile: nr, text: 'Betrag ist keine Zahl' });
    aus.zeilen.push({
      zeile: nr,
      schluessel: sl,
      bankreferenz: zeText(feld('Bankreferenz')),
      buchungsdatum: zeSerialZuDatum(feld('Buchungsdatum')),
      betrag_cent: cent,
      waehrung: zeText(feld('Währung')) || 'EUR',
      auftraggeber: zeText(feld('Auftraggeber')),
      iban: zeText(feld('IBAN')),
      verwendungszweck: zeText(feld('Verwendungszweck')),
      referenz: zeText(feld('Strukturierte Referenz')),
      quelle: zeText(feld('Quelldatei')),
      klaerfall: zeText(feld('Klärfall aus Auszug')),
      manuell: zeText(feld('manuelle Zuordnung')),
    });
  }
  return aus;
}

// Zahlung oder Klaerfall eines Parsers -> Buchzeile. CSV: referenz ist die Bankreferenz.
// CAMT: bankreferenz ist AcctSvcrRef, referenz die strukturierte Referenz (CdtrRefInf).
function zeAusZahlung(z, datei, klaerfall) {
  var camt = Object.prototype.hasOwnProperty.call(z, 'bankreferenz');
  return {
    zeile: 0,
    schluessel: z.schluessel,
    bankreferenz: zeText(camt ? z.bankreferenz : z.referenz),
    buchungsdatum: z.buchungsdatum,
    betrag_cent: z.betrag_cent,
    waehrung: zeText(z.waehrung) || 'EUR',
    auftraggeber: zeText(z.auftraggeber),
    iban: zeText(z.iban),
    verwendungszweck: zeText(z.verwendungszweck),
    referenz: camt ? zeText(z.referenz) : '',
    quelle: zeText(z.quelle) || zeText(datei),
    klaerfall: zeText(klaerfall),
    manuell: '',
  };
}

// bestand: Zeilen aus leseZahlungseingaenge. dateien: [{ datei, ergebnis }] in Lesereihenfolge,
// ergebnis wie von parseKontoauszugCsv/-Camt. -> { neu: [Buchzeilen], schon_im_buch }
function schreibeFort(bestand, dateien) {
  var imBuch = {};
  var refs = {};
  (bestand || []).forEach(function (z) {
    imBuch[z.schluessel] = true;
    if (z.bankreferenz && refs[z.bankreferenz] === undefined) refs[z.bankreferenz] = z.schluessel;
  });
  var neu = [];
  var schon = 0;
  (dateien || []).forEach(function (d) {
    var e = d && d.ergebnis;
    if (!e || !e.ok) return;
    var liste = (e.zahlungen || []).map(function (z) { return [z, '']; })
      .concat((e.klaerfaelle || []).map(function (k) { return [k, zeText(k.grund) || 'Klärfall aus dem Auszug']; }));
    // Innerhalb einer Datei entscheidet der Parser (Teile einer Sammelbuchung teilen die Referenz,
    // doppelte Referenzen sind dort schon Klaerfall). Gegen das Buch und gegen frueher gelesene
    // Dateien gilt die Regel; die Referenzen dieser Datei zaehlen erst fuer die naechste.
    var dieseDatei = {};
    liste.forEach(function (p) {
      var z = p[0];
      if (imBuch[z.schluessel]) { schon++; return; }
      var zeile = zeAusZahlung(z, d.datei, p[1]);
      var vorhanden = zeile.bankreferenz ? refs[zeile.bankreferenz] : undefined;
      if (vorhanden !== undefined && vorhanden !== zeile.schluessel && !zeile.klaerfall) zeile.klaerfall = 'Referenz bereits vorhanden'; // Sicherung Referenz bereits vorhanden
      imBuch[zeile.schluessel] = true;
      if (zeile.bankreferenz && dieseDatei[zeile.bankreferenz] === undefined) dieseDatei[zeile.bankreferenz] = zeile.schluessel;
      neu.push(zeile);
    });
    Object.keys(dieseDatei).forEach(function (r) { if (refs[r] === undefined) refs[r] = dieseDatei[r]; });
  });
  return { neu: neu, schon_im_buch: schon };
}

// Buchzeilen -> Eingabe fuer ordneZahlungenZu. Eine Zeile mit Klaerfall-Marke ist Klaerfall,
// auch wenn ihre Datei nicht mehr im Ordner liegt. Gesucht wird in strukturierter und Bankreferenz.
function zuordnungsEingabe(zeilen) {
  var zahlungen = [];
  var klaerfaelle = [];
  var manuell = {};
  (zeilen || []).forEach(function (z) {
    var o = {
      schluessel: z.schluessel,
      buchungsdatum: z.buchungsdatum,
      betrag_cent: z.betrag_cent,
      waehrung: z.waehrung,
      auftraggeber: z.auftraggeber,
      iban: z.iban,
      verwendungszweck: z.verwendungszweck,
      referenz: [z.referenz, z.bankreferenz].filter(function (x) { return x; }).join(' '),
      quelle: z.quelle,
    };
    if (z.klaerfall) klaerfaelle.push(Object.assign({ grund: z.klaerfall }, o));
    else zahlungen.push(o);
    if (z.manuell) manuell[z.schluessel] = z.manuell;
  });
  return { zahlungen: zahlungen, klaerfaelle: klaerfaelle, manuell: manuell };
}

// bestandAnzahl: so viele Zeilen von "alle" stehen schon im Blatt (in Blattreihenfolge);
// der Rest ist neu. zuordnung: Ergebnis von ordneZahlungenZu.
// -> { berechnet: [[zugeordnete Rechnungsnr., Zuordnung, Kandidaten, Grund]] je Bestandszeile,
//      neu: [[alle Spalten in ZE_SPALTEN-Reihenfolge]] je neuer Zeile }. Datum als Seriennummer,
//      Betrag als Zahl - zu schreiben mit valueInputOption RAW (keine Formel aus Fremdtext).
function schreibauftrag(bestandAnzahl, alle, zuordnung) {
  var nach = {};
  ((zuordnung && zuordnung.zahlungen) || []).forEach(function (e) {
    if (!nach[e.schluessel]) nach[e.schluessel] = e;
  });
  var gesehen = {};
  var berechnet = function (z) {
    var e = gesehen[z.schluessel] ? null : nach[z.schluessel];
    gesehen[z.schluessel] = true;
    if (!e) return ['', '', '', 'doppelter Buchungsschlüssel'];
    return [e.rechnungen.map(function (r) { return r.rechnungsnr; }).join(', '), e.zuordnung, e.kandidaten.join(', '), e.grund];
  };
  var aus = { berechnet: [], neu: [] };
  (alle || []).forEach(function (z, i) {
    var b = berechnet(z);
    if (i < bestandAnzahl) { aus.berechnet.push(b); return; }
    aus.neu.push([z.schluessel, z.bankreferenz, zeDatumZuSerial(z.buchungsdatum),
      Number.isInteger(z.betrag_cent) ? z.betrag_cent / 100 : '', z.waehrung, z.auftraggeber, z.iban,
      z.verwendungszweck, z.referenz, z.quelle, z.klaerfall].concat(b).concat([z.manuell || '']));
  });
  return aus;
}

// Bereiche fuer values:batchUpdate (valueInputOption RAW): berechnete Spalten L:O je
// Bestandszeile an ihrer Blattzeile, neue Zeilen A:P ab der naechsten freien Zeile.
function schreibBereiche(bestand, naechsteZeile, auftrag) {
  var data = [];
  (auftrag.berechnet || []).forEach(function (werte, i) {
    var z = bestand[i].zeile;
    data.push({ range: "'Zahlungseingänge'!L" + z + ':O' + z, values: [werte] });
  });
  if ((auftrag.neu || []).length) {
    data.push({ range: "'Zahlungseingänge'!A" + naechsteZeile + ':P' + (naechsteZeile + auftrag.neu.length - 1), values: auftrag.neu });
  }
  return data;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ZE_SPALTEN, leseZahlungseingaenge, schreibeFort, zuordnungsEingabe, schreibauftrag, schreibBereiche };
}
