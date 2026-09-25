// Mahnlauf, Kernlogik: CSV-Kontoauszug lesen (BAUPLAN d, "CSV-Parser").
//
// Ohne Abhaengigkeit: kein require, kein Buffer, kein TextDecoder. 1:1 in einen
// n8n-Code-Node kopierbar. Betraege nur in ganzen Cent, Daten als JJJJ-MM-TT.
// Verworfen wird eine Datei nur bei Formatfehlern: eine Zeile, die sich nicht
// lesen laesst, verwirft die GANZE Datei - keine teilweise Verbuchung.
// Inhaltliche Auffaelligkeiten einzelner Buchungen (Bankreferenz doppelt) werden
// Klaerfall, die Datei bleibt gueltig. Nur Gutschriften werden zu Zahlungen.

var CSV_CP1252 = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152,
  0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A,
  0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};

var CSV_DATUMSFORMATE = ['TT.MM.JJJJ', 'TT.MM.JJ', 'JJJJ-MM-TT'];

function csvAusCodepunkten(cps) {
  var teile = [];
  for (var i = 0; i < cps.length; i += 8192) {
    teile.push(String.fromCodePoint.apply(null, cps.slice(i, i + 8192)));
  }
  return teile.join('');
}

function csvUtf8(b) {
  var cps = [];
  var i = 0;
  var n = b.length;
  var zeile = 1;
  if (n >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) i = 3;
  var fehler = function () {
    return { ok: false, zeile: zeile, grund: 'kein gültiges UTF-8 (Zeichensatz prüfen, z. B. ISO-8859-1)' };
  };
  while (i < n) {
    var c = b[i];
    if (c < 0x80) {
      if (c === 0x0A) zeile++;
      cps.push(c);
      i++;
      continue;
    }
    var laenge, cp, min;
    if (c >= 0xC2 && c <= 0xDF) { laenge = 2; cp = c & 0x1F; min = 0x80; }
    else if (c >= 0xE0 && c <= 0xEF) { laenge = 3; cp = c & 0x0F; min = 0x800; }
    else if (c >= 0xF0 && c <= 0xF4) { laenge = 4; cp = c & 0x07; min = 0x10000; }
    else return fehler();
    if (i + laenge > n) return fehler();
    for (var k = 1; k < laenge; k++) {
      var f = b[i + k];
      if ((f & 0xC0) !== 0x80) return fehler();
      cp = (cp << 6) | (f & 0x3F);
    }
    if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return fehler();
    cps.push(cp);
    i += laenge;
  }
  return { ok: true, text: csvAusCodepunkten(cps) };
}

function csvEinByte(b, cp1252) {
  var cps = new Array(b.length);
  for (var i = 0; i < b.length; i++) {
    var c = b[i];
    cps[i] = cp1252 && CSV_CP1252[c] !== undefined ? CSV_CP1252[c] : c;
  }
  return csvAusCodepunkten(cps);
}

// Bytes (Array oder Uint8Array, 0-255) oder Text -> Text.
function dekodiereBytes(eingabe, zeichensatz) {
  if (typeof eingabe === 'string') {
    return { ok: true, text: eingabe.charCodeAt(0) === 0xFEFF ? eingabe.slice(1) : eingabe };
  }
  if (!eingabe || typeof eingabe.length !== 'number') {
    return { ok: false, zeile: 0, grund: 'keine Daten' };
  }
  for (var i = 0; i < eingabe.length; i++) {
    var c = eingabe[i];
    if (!(c >= 0 && c <= 255 && c === Math.floor(c))) return { ok: false, zeile: 0, grund: 'keine Bytefolge' };
  }
  var zs = String(zeichensatz || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (zs === 'UTF8') return csvUtf8(eingabe);
  if (zs === 'ISO88591' || zs === 'LATIN1') return { ok: true, text: csvEinByte(eingabe, false) };
  if (zs === 'WINDOWS1252' || zs === 'CP1252') return { ok: true, text: csvEinByte(eingabe, true) };
  return { ok: false, zeile: 0, grund: 'Zeichensatz unbekannt: ' + zeichensatz };
}

// Text -> Datensaetze mit der Zeilennummer, in der sie beginnen (1-basiert).
// Ein Anfuehrungszeichen am Feldanfang oeffnet ein Feld mit Trennern und
// Zeilenumbruechen; "" darin ist ein Anfuehrungszeichen. Mitten im Feld ist " Text.
function zerlegeCsv(text, trennzeichen) {
  var t = String(trennzeichen == null ? '' : trennzeichen);
  if (t === '\\t' || t.toUpperCase() === 'TAB') t = '\t';
  if (t.length !== 1 || t === '"' || t === '\r' || t === '\n') {
    return { ok: false, zeile: 0, grund: 'Trennzeichen muss genau ein Zeichen sein (eingestellt: "' + trennzeichen + '")' };
  }
  var s = String(text);
  var saetze = [];
  var felder = [];
  var feld = '';
  var imFeld = false;
  var zeile = 1;
  var beginn = 1;
  var i = 0;
  var n = s.length;
  while (i < n) {
    var ch = s[i];
    if (imFeld) {
      if (ch === '"') {
        if (s[i + 1] === '"') { feld += '"'; i += 2; continue; }
        imFeld = false;
        i++;
        if (i < n && s[i] !== t && s[i] !== '\r' && s[i] !== '\n') {
          return { ok: false, zeile: zeile, grund: 'Zeichen nach schließendem Anführungszeichen' };
        }
        continue;
      }
      if (ch === '\n') zeile++;
      feld += ch;
      i++;
      continue;
    }
    if (ch === '"' && feld === '') { imFeld = true; i++; continue; }
    if (ch === t) { felder.push(feld); feld = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      felder.push(feld);
      saetze.push({ zeile: beginn, felder: felder });
      felder = [];
      feld = '';
      zeile++;
      beginn = zeile;
      i++;
      continue;
    }
    feld += ch;
    i++;
  }
  if (imFeld) return { ok: false, zeile: beginn, grund: 'Anführungszeichen nicht geschlossen' };
  if (feld !== '' || felder.length) {
    felder.push(feld);
    saetze.push({ zeile: beginn, felder: felder });
  }
  return { ok: true, datensaetze: saetze };
}

// "1.234,56" -> 123456. Nur ganze Cent, hoechstens zwei Nachkommastellen,
// Tausendertrenner nur in Dreiergruppen. Nicht lesbar -> null.
function leseBetragCent(text, dezimalzeichen) {
  var s = String(text == null ? '' : text).trim();
  var dz = dezimalzeichen === '.' ? '.' : ',';
  var tz = dz === ',' ? '.' : ',';
  var vz = '';
  if (s[0] === '+' || s[0] === '-') { vz = s[0]; s = s.slice(1); }
  var tzRe = tz === '.' ? '\\.' : ',';
  var dzRe = dz === '.' ? '\\.' : ',';
  var r = new RegExp('^(\\d{1,3}(?:' + tzRe + '\\d{3})+|\\d+)(?:' + dzRe + '(\\d{1,2}))?$').exec(s);
  if (!r) return null;
  var ganz = r[1].split(tz).join('').replace(/^0+(?=\d)/, '');
  if (ganz.length > 13) return null;
  var nach = ((r[2] || '') + '00').slice(0, 2);
  var cent = parseInt(ganz, 10) * 100 + parseInt(nach, 10);
  return vz === '-' && cent !== 0 ? -cent : cent;
}

function csvZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

// Datum nach Format -> JJJJ-MM-TT, nur echte Kalenderdaten. Sonst null.
function leseDatum(text, datumsformat) {
  var s = String(text == null ? '' : text).trim();
  var f = String(datumsformat || '').toUpperCase();
  var r, j, m, t;
  if (f === 'TT.MM.JJJJ') {
    r = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    if (!r) return null;
    t = +r[1]; m = +r[2]; j = +r[3];
  } else if (f === 'TT.MM.JJ') {
    r = /^(\d{1,2})\.(\d{1,2})\.(\d{2})$/.exec(s);
    if (!r) return null;
    t = +r[1]; m = +r[2]; j = 2000 + +r[3];
  } else if (f === 'JJJJ-MM-TT') {
    r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!r) return null;
    j = +r[1]; m = +r[2]; t = +r[3];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || t < 1) return null;
  var d = new Date(Date.UTC(j, m - 1, t));
  if (d.getUTCFullYear() !== j || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== t) return null;
  return j + '-' + csvZwei(m) + '-' + csvZwei(t);
}

function csvFnv(s, basis) {
  var h = basis >>> 0;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function csvKompakt(s) {
  return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
}

// Bankreferenz-Platzhalter zaehlen als "keine Referenz": leer, NONREF,
// NOTPROVIDED, NOT PROVIDED, gross/klein egal. Dann gilt der Ersatzschluessel.
var CSV_REF_PLATZHALTER = ['', 'NONREF', 'NOTPROVIDED'];

function csvEchteReferenz(r) {
  var s = String(r == null ? '' : r).trim();
  if (CSV_REF_PLATZHALTER.indexOf(csvKompakt(s)) >= 0) return ''; // Sicherung Referenz-Platzhalter
  return s;
}

// Buchungsschluessel (BAUPLAN d): Bankreferenz, sonst Hash aus Buchungsdatum,
// Betrag, IBAN, Verwendungszweck und laufender Nummer gleicher Buchungen am
// selben Tag. Grenze: zwei vollkommen gleiche Buchungen in unterschiedlich
// geschnittenen Dateien trennt nur die Bankreferenz sicher.
function buchungsschluessel(z, laufendeNummer) {
  if (z.referenz) return 'REF:' + String(z.referenz).trim();
  var s = [z.buchungsdatum, z.betrag_cent, csvKompakt(z.iban), String(z.verwendungszweck || '').trim(), laufendeNummer].join('|');
  return 'H:' + csvFnv(s, 0x811C9DC5) + csvFnv(s, 0x9DC5811C);
}

var CSV_SPALTEN_PFLICHT = [
  ['buchungsdatum', 'spalte_buchungsdatum'],
  ['betrag', 'spalte_betrag'],
  ['verwendungszweck', 'spalte_verwendungszweck'],
  ['auftraggeber', 'spalte_auftraggeber'],
  ['iban', 'spalte_iban'],
];
var CSV_SPALTEN_OPTIONAL = [
  ['soll_haben', 'spalte_soll_haben'],
  ['referenz', 'spalte_referenz'],
];

// Hauptfunktion. eingabe: Bytes oder Text. einstellungen: Schluessel aus dem
// Einstellungsblatt (trennzeichen, zeichensatz, dezimalzeichen, datumsformat,
// kopfzeile, spalte_*). dateiname: nur fuer Meldung und Feld "quelle".
function parseKontoauszugCsv(eingabe, einstellungen, dateiname) {
  var e = einstellungen || {};
  var datei = String(dateiname || '');
  var fehler = function (zeile, grund) {
    return { ok: false, fehler: { datei: datei, zeile: zeile, grund: grund } };
  };
  var fmt = String(e.datumsformat || '').toUpperCase();
  if (CSV_DATUMSFORMATE.indexOf(fmt) < 0) return fehler(0, 'Datumsformat unbekannt: ' + e.datumsformat);
  if (e.dezimalzeichen !== ',' && e.dezimalzeichen !== '.') return fehler(0, 'Dezimalzeichen muss "," oder "." sein');
  var kopfNr = Number(e.kopfzeile === undefined || e.kopfzeile === '' ? 1 : e.kopfzeile);
  if (!Number.isInteger(kopfNr) || kopfNr < 1) return fehler(0, 'Kopfzeile in Zeile ungültig: ' + e.kopfzeile);

  var dek = dekodiereBytes(eingabe, e.zeichensatz);
  if (!dek.ok) return fehler(dek.zeile, dek.grund);
  var zer = zerlegeCsv(dek.text, e.trennzeichen);
  if (!zer.ok) return fehler(zer.zeile, zer.grund);
  var saetze = zer.datensaetze;

  var kopfIdx = -1;
  for (var k = 0; k < saetze.length; k++) {
    if (saetze[k].zeile === kopfNr) { kopfIdx = k; break; }
  }
  if (kopfIdx < 0) return fehler(kopfNr, 'Kopfzeile nicht gefunden');
  var kopf = saetze[kopfIdx].felder.map(function (x) { return x.trim(); });

  var idx = {};
  var fehlend = [];
  var i, name, pos;
  for (i = 0; i < CSV_SPALTEN_PFLICHT.length; i++) {
    name = String(e[CSV_SPALTEN_PFLICHT[i][1]] || '').trim();
    if (!name) return fehler(0, 'Einstellung fehlt: ' + CSV_SPALTEN_PFLICHT[i][1]);
    pos = kopf.indexOf(name);
    if (pos < 0) fehlend.push(name);
    else if (kopf.indexOf(name, pos + 1) >= 0) return fehler(kopfNr, 'Spalte doppelt: ' + name);
    idx[CSV_SPALTEN_PFLICHT[i][0]] = pos;
  }
  for (i = 0; i < CSV_SPALTEN_OPTIONAL.length; i++) {
    name = String(e[CSV_SPALTEN_OPTIONAL[i][1]] || '').trim();
    idx[CSV_SPALTEN_OPTIONAL[i][0]] = -1;
    if (!name) continue;
    pos = kopf.indexOf(name);
    if (pos < 0) fehlend.push(name);
    else if (kopf.indexOf(name, pos + 1) >= 0) return fehler(kopfNr, 'Spalte doppelt: ' + name);
    idx[CSV_SPALTEN_OPTIONAL[i][0]] = pos;
  }
  if (fehlend.length) {
    if (kopf.length === 1 && /[;,\t|]/.test(kopf[0])) {
      return fehler(kopfNr, 'Kopfzeile hat nur eine Spalte - Trennzeichen passt nicht (eingestellt: "' + e.trennzeichen + '")');
    }
    return fehler(kopfNr, 'Spalte fehlt: ' + fehlend.join(', '));
  }

  var gutschriften = [];
  var stand = null;
  var gleiche = {};
  var referenzen = {};
  var lastschriften = 0;
  for (k = kopfIdx + 1; k < saetze.length; k++) {
    var ds = saetze[k];
    var f = ds.felder;
    if (f.every(function (x) { return x.trim() === ''; })) continue;
    if (f.length < kopf.length) {
      return fehler(ds.zeile, 'zu wenige Felder (' + f.length + ' statt ' + kopf.length + ')');
    }
    for (i = kopf.length; i < f.length; i++) {
      if (f[i].trim() !== '') return fehler(ds.zeile, 'zu viele Felder (' + f.length + ' statt ' + kopf.length + ')');
    }
    var rohDatum = f[idx.buchungsdatum];
    var datum = leseDatum(rohDatum, fmt);
    if (!datum) return fehler(ds.zeile, 'Buchungsdatum nicht lesbar: "' + rohDatum + '"');
    var rohBetrag = f[idx.betrag];
    var betrag = leseBetragCent(rohBetrag, e.dezimalzeichen);
    if (betrag === null) return fehler(ds.zeile, 'Betrag nicht lesbar: "' + rohBetrag + '"');
    if (idx.soll_haben >= 0) {
      var sh = f[idx.soll_haben].trim().toUpperCase();
      if (/^[+-]/.test(String(rohBetrag).trim())) return fehler(ds.zeile, 'Vorzeichen im Betrag trotz Soll/Haben-Spalte');
      if (sh === 'H' || sh === 'HABEN' || sh === 'CR' || sh === 'CRDT') { /* Gutschrift */ }
      else if (sh === 'S' || sh === 'SOLL' || sh === 'DR' || sh === 'DBIT') betrag = -betrag;
      else return fehler(ds.zeile, 'Soll/Haben nicht lesbar: "' + f[idx.soll_haben] + '"');
    }
    if (stand === null || datum > stand) stand = datum;
    if (betrag <= 0) { lastschriften++; continue; }
    // Doppelte Referenz zaehlt nur unter verarbeiteten Buchungen (Gutschriften).
    var ref = idx.referenz >= 0 ? csvEchteReferenz(f[idx.referenz]) : '';
    if (ref) referenzen[ref] = (referenzen[ref] || 0) + 1;
    var z = {
      schluessel: '',
      buchungsdatum: datum,
      betrag_cent: betrag,
      waehrung: 'EUR',
      auftraggeber: f[idx.auftraggeber].trim(),
      iban: f[idx.iban].trim(),
      verwendungszweck: f[idx.verwendungszweck].trim(),
      referenz: ref,
      quelle: datei,
    };
    var basis = [datum, betrag, csvKompakt(z.iban), z.verwendungszweck].join('|');
    gleiche[basis] = (gleiche[basis] || 0) + 1;
    gutschriften.push({ z: z, nr: gleiche[basis] });
  }

  // Eine echte Bankreferenz, die in der Datei mehrfach vorkommt, taugt nicht als
  // Schluessel: jede Buchung damit wird Klaerfall mit Ersatzschluessel aus dem Hash.
  var zahlungen = [];
  var klaerfaelle = [];
  gutschriften.forEach(function (g) {
    var doppelt = false;
    if (g.z.referenz && referenzen[g.z.referenz] > 1) doppelt = true; // Sicherung Referenz doppelt
    if (doppelt) {
      g.z.schluessel = buchungsschluessel({ buchungsdatum: g.z.buchungsdatum, betrag_cent: g.z.betrag_cent,
        iban: g.z.iban, verwendungszweck: g.z.verwendungszweck, referenz: '' }, g.nr);
      klaerfaelle.push(Object.assign({ grund: 'Bankreferenz doppelt: "' + g.z.referenz + '"' }, g.z));
      return;
    }
    g.z.schluessel = buchungsschluessel(g.z, g.nr);
    zahlungen.push(g.z);
  });
  var hinweise = [];
  if (lastschriften) hinweise.push({ art: 'Belastungen nicht gezählt', anzahl: lastschriften, datei: datei });
  if (klaerfaelle.length) hinweise.push({ art: 'Klärfall aus dem Auszug', anzahl: klaerfaelle.length, datei: datei });
  return { ok: true, zahlungen: zahlungen, stand: stand, hinweise: hinweise, klaerfaelle: klaerfaelle };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { dekodiereBytes, zerlegeCsv, leseBetragCent, leseDatum, buchungsschluessel, parseKontoauszugCsv };
}
