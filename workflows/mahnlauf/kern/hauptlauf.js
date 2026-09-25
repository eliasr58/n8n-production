// Mahnlauf, Kernlogik: Hauptlauf (BAUPLAN c, e; Baustein 6, Modus trocken).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Der Hauptlauf kennt die Quelle nicht:
// Posten kommen aus "Offene Posten lesen", der Zahlstand aus "Zahlstand lesen". Den Zustand des
// Mahnlaufs (Stufe, Datum letzte Stufe, Freigabe, Entwurf) liest er selbst aus "Offene Posten"
// (BAUPLAN g: der Zustand bleibt immer im Sheet). Passt eine Zustandszeile nicht zur Rechnungsnr.
// des Postens, bekommt die Rechnung einen Hinweis - und eine Zeile mit Hinweis wird nie versendet.

var HL_ZUSTAND = { 'Rechnungsnr.': 'rechnungsnr', 'aktuelle Stufe': 'aktuelle_stufe', 'Datum letzte Stufe': 'datum_letzte_stufe',
  'Freigabe': 'freigabe', 'Entwurf-ID': 'entwurf_id', 'Entwurf-Restbetrag': 'entwurf_rest_cent', 'Status': 'status' };
var HL_VERSAND = ['senden', 'entwurf_anlegen', 'entwurf_senden', 'entwurf_ersetzen'];

function hlText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function hlDatum(v) {
  if (typeof v === 'number' && isFinite(v) && v >= 1) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
  }
  return hlText(v);
}

// werte: Rohwerte von "Offene Posten" (UNFORMATTED_VALUE/SERIAL_NUMBER) -> { Blattzeile: Zustand }
function leseZustand(werte) {
  var w = werte || [];
  var kopf = (w[0] || []).map(hlText);
  var aus = {};
  for (var r = 1; r < w.length; r++) {
    var reihe = w[r] || [];
    if (reihe.every(function (v) { return hlText(v) === ''; })) continue;
    var z = {};
    Object.keys(HL_ZUSTAND).forEach(function (s) {
      var v = reihe[kopf.indexOf(s)];
      var f = HL_ZUSTAND[s];
      if (f === 'aktuelle_stufe') z[f] = typeof v === 'number' ? v : hlText(v);
      else if (f === 'datum_letzte_stufe') z[f] = hlDatum(v);
      else if (f === 'entwurf_rest_cent') z[f] = typeof v === 'number' && isFinite(v) ? Math.round(v * 100) : null;
      else z[f] = hlText(v);
    });
    aus[r + 1] = z;
  }
  return aus;
}

// posten: Items von "Offene Posten lesen" (Vertragsfelder, quelle_id = Blattzeile, hinweise).
// zustand: Ergebnis von leseZustand. entwuerfe: Ergebnis von entwurfDaten (Teil B 5) oder leer.
// -> Rechnungen fuer mitZahlstand/planeLauf.
function baueRechnungen(posten, zustand, entwuerfe) {
  return (posten || []).map(function (p) {
    var r = {
      rechnungsnr: p.rechnungsnr, kunde: p.kunde, kundentyp: p.kundentyp, email: p.email,
      rechnungsdatum: p.rechnungsdatum, faelligkeit: p.faelligkeit, betrag_brutto_cent: p.betrag_brutto_cent,
      mahnsperre: p.mahnsperre, mahnsperre_grund: p.mahnsperre_grund, hinweise: (p.hinweise || []).slice(),
      versandstatus_klaeren: hlText(p.versandstatus_klaeren),
    };
    var z = (zustand || {})[p.quelle_id];
    if (!z || z.rechnungsnr !== p.rechnungsnr) {
      r.hinweise.push('Zustand nicht lesbar (Zeile verschoben?)');
      return r;
    }
    r.aktuelle_stufe = z.aktuelle_stufe;
    r.datum_letzte_stufe = z.datum_letzte_stufe;
    r.freigabe = z.freigabe;
    r.entwurf_id = z.entwurf_id;
    r.entwurf_rest_cent = z.entwurf_rest_cent;
    r.entwurf_datum = (entwuerfe || {})[hlText(z.entwurf_id)] || '';
    return r;
  });
}

// Teil B 5: Zeilen der Data Table (Sperre) -> { Entwurf-ID: Berliner Datum der fruehesten angelegt-Zeile }.
// Das Entwurfsdatum steht nicht im Blatt; "Entwurf wartet zu lange" (stufen.js) braucht es.
function entwurfDaten(zeilen) {
  var aus = {};
  var zeit = {};
  (zeilen || []).forEach(function (r) {
    if (!r || r.aktion !== 'angelegt' || !hlText(r.gmail_id)) return;
    var z = hlText(r.zeit_utc);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(z)) return;
    var id = hlText(r.gmail_id);
    if (zeit[id] === undefined || z < zeit[id]) zeit[id] = z;
  });
  Object.keys(zeit).forEach(function (id) { aus[id] = berlinZeit(zeit[id]).datum; });
  return aus;
}

function hlZahl(v) {
  return Number.isInteger(v) ? v : '';
}

// plan: Ergebnis von planeLauf. lauf = { lauf_id, modus, zeit_utc, zeit_berlin }. zusatz: stille Protokollzeilen
// [{ aktion, grund }] aus "Zahlstand lesen" (Belastungen, Baustein 10 Teil A 2), hinter den Entscheidungen.
// -> Zeilen fuer das Blatt "Protokoll" (Spalten wie BAUPLAN b), nur anhaengen.
function protokollZeilen(plan, lauf, zusatz) {
  var kopf = [lauf.zeit_utc, lauf.zeit_berlin, String(lauf.lauf_id), lauf.modus];
  var zeilen = [];
  (plan.entscheidungen || []).forEach(function (d) {
    var versand = HL_VERSAND.indexOf(d.aktion) >= 0;
    zeilen.push(kopf.concat([d.rechnungsnr, d.aktion, hlZahl(d.stufe_vorher), hlZahl(d.stufe),
      Number.isInteger(d.rest_cent) ? d.rest_cent / 100 : '', d.grund, '', versand ? d.rechnungsnr + '|' + d.stufe : '']));
  });
  (plan.protokoll || []).forEach(function (p) {
    if (p.rechnungsnr) return;
    zeilen.push(kopf.concat(['', p.aktion, '', '', '', p.grund, '', '']));
  });
  (zusatz || []).forEach(function (p) {
    zeilen.push(kopf.concat(['', hlText(p.aktion), '', '', '', hlText(p.grund), '', '']));
  });
  (plan.alarme || []).forEach(function (a) {
    zeilen.push(kopf.concat(['', 'alarm', '', '', '', a.art + ': ' + a.text, '', '']));
  });
  return zeilen;
}

function hlZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

function hlLetzterSonntag(jahr, monat) {
  var t = new Date(Date.UTC(jahr, monat, 0));
  return t.getUTCDate() - t.getUTCDay();
}

// UTC-Zeitpunkt 'JJJJ-MM-TTThh:mm:ss[.sss]Z' -> { datum: 'JJJJ-MM-TT', text: 'TT.MM.JJJJ hh:mm:ss' } in
// Europe/Berlin. Sommerzeit: letzter Sonntag im Maerz 01:00 UTC bis letzter Sonntag im Oktober
// 01:00 UTC. Ohne Intl - ob der Task-Runner volles ICU hat, ist nicht gemessen.
function berlinZeit(isoUtc) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(String(isoUtc));
  if (!m) throw new Error('Zeitpunkt nicht im Format JJJJ-MM-TTThh:mm:ssZ');
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  var j = +m[1];
  var sommer = ms >= Date.UTC(j, 2, hlLetzterSonntag(j, 3), 1) && ms < Date.UTC(j, 9, hlLetzterSonntag(j, 10), 1);
  var b = new Date(ms + (sommer ? 2 : 1) * 3600000);
  var datum = b.getUTCFullYear() + '-' + hlZwei(b.getUTCMonth() + 1) + '-' + hlZwei(b.getUTCDate());
  return { datum: datum, text: hlZwei(b.getUTCDate()) + '.' + hlZwei(b.getUTCMonth() + 1) + '.' + b.getUTCFullYear() + ' '
    + hlZwei(b.getUTCHours()) + ':' + hlZwei(b.getUTCMinutes()) + ':' + hlZwei(b.getUTCSeconds()) };
}

// Teil A 10 (Entscheidung Elias 25.09.2026): "Status" (P) je Zeile, bei jedem Lauf fuer alle Zeilen geschrieben.
// r: Rechnung mit Zahlstand, d: Entscheidung (planeLauf). Werte wie BAUPLAN b, dazu "Hinweis" fuer Zeilen,
// die wegen eines Mangels nie versendet werden (hinweis, ungueltig, keine_email).
function zeilenStatus(r, d) {
  var a = (d && d.aktion) || '';
  if (r.status === 'bezahlt' || r.status === 'überzahlt') return r.status;
  if (a === 'gesperrt') return 'gesperrt';
  if (a === 'klaerfall_halt' || r.klaerfall_halt === true) return 'Klärfall';
  if (a === 'hinweis' || a === 'ungueltig' || a === 'keine_email') return 'Hinweis';
  if (a === 'versandstatus_versendet') return 'offen';
  if (Number(r.aktuelle_stufe) >= 4) return 'übergeben';
  if (hlText(r.entwurf_id) !== '') return 'wartet auf Freigabe';
  return 'offen';
}

function hlSpalte(i) {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

// posten (quelle_id = Blattzeile), rechnungen (mit Zahlstand) und entscheidungen in derselben Reihenfolge,
// kopf = Kopfzeile "Offene Posten" -> { zeilen, data } fuer EIN values:batchUpdate (RAW): je Spalte EIN Bereich
// von Zeile 2 bis zur letzten Postenzeile; Zeilen ohne Posten bekommen ''. H = bezahlt in Euro (Zahl), '' ohne Zahlstand.
function bezahltUndStatus(posten, rechnungen, entscheidungen, kopf) {
  var k = (kopf || []).map(hlText);
  var iH = k.indexOf('bezahlt bis jetzt');
  var iP = k.indexOf('Status');
  if (iH < 0) throw new Error('Hauptlauf - Spalte fehlt bezahlt bis jetzt');
  if (iP < 0) throw new Error('Hauptlauf - Spalte fehlt Status');
  var p = posten || [];
  if (!p.length) return { zeilen: 0, data: [] };
  var letzte = Math.max.apply(null, p.map(function (x) { return x.quelle_id; }));
  var h = [];
  var s = [];
  for (var z = 2; z <= letzte; z++) { h.push(['']); s.push(['']); }
  p.forEach(function (x, i) {
    var r = (rechnungen || [])[i] || {};
    h[x.quelle_id - 2] = [Number.isInteger(r.bezahlt_cent) ? r.bezahlt_cent / 100 : ''];
    s[x.quelle_id - 2] = [zeilenStatus(r, (entscheidungen || [])[i])];
  });
  return { zeilen: p.length, data: [
    { range: "'Offene Posten'!" + hlSpalte(iH) + '2:' + hlSpalte(iH) + letzte, values: h },
    { range: "'Offene Posten'!" + hlSpalte(iP) + '2:' + hlSpalte(iP) + letzte, values: s }] };
}

// Steht in Spalte A (Rechnungsnr.) noch dasselbe wie beim Lesen? Leere Zeilen am Ende zaehlen nicht.
function spalteAGleich(vorher, jetzt) {
  var a = function (w) {
    var x = (w || []).map(function (r) { return hlText((r || [])[0]); });
    while (x.length && x[x.length - 1] === '') x.pop();
    return x.join('\n');
  };
  return a(vorher) === a(jetzt);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { leseZustand, baueRechnungen, entwurfDaten, protokollZeilen, berlinZeit, zeilenStatus, bezahltUndStatus, spalteAGleich };
}
