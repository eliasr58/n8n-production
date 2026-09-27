// Wartungserinnerung, Kernlogik: Blatt "Anlagen" lesen (BAUPLAN b, Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Eingabe wie von values.get mit
// UNFORMATTED_VALUE/SERIAL_NUMBER: erste Zeile Kopf, dann eine Zeile je Anlage. Die Kopfzeile muss GENAU AN_SPALTEN
// sein (Reihenfolge eingeschlossen) - geschrieben wird spaltenweise, eine verschobene Spalte schriebe in die falsche
// Zelle. Sonst ok=false und nichts wird gelesen (Abbruch vor jedem Schreiben, fail-closed).
// Daten werden JJJJ-MM-TT, Unlesbares "ungültig: <Text>"; ob ein Datum gilt, entscheidet entscheidung.js.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var AN_SPALTEN = [
  'Anlagen-ID', 'Kunden-ID', 'Kunde', 'E-Mail', 'Anlage', 'Leistung des Betriebs', 'Adresse erhoben bei',
  'Widerspruchshinweis bei Erhebung', 'Einbaudatum', 'letzte Wartung', 'Intervall (Monate)', 'Pause', 'Pause Grund',
  'Werbewiderspruch', 'Widerspruch aufheben', 'nächste Fälligkeit', 'Status', 'Angebot am', 'Erinnerung am',
  'Thread-ID', 'Antwort', 'Antwort erledigt', 'Protokoll', 'Versandstatus klären',
];

function anText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function anDatum(v) {
  if (typeof v === 'number') {
    var d = seriennummerZuDatum(v);
    return d === null ? 'ungültig: ' + v : d;
  }
  var s = anText(v);
  if (s === '') return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : 'ungültig: ' + s;
}

// leer -> null (Standardintervall), ganze Zahl oder Ziffernfolge -> Zahl, sonst NaN (entscheidung.js prueft 1-60).
function anIntervall(v) {
  if (typeof v === 'number') return v;
  var s = anText(v);
  if (s === '') return null;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// Übernommen aus Mahnlauf bau/kern/stufen.js (Commit 61022e4), unverändert: pruefeKopfzeile stufenSperre
function pruefeKopfzeile(kopf, pflichtspalten) {
  var k = (kopf || []).map(function (s) { return String(s).trim(); });
  var fehlend = (pflichtspalten || []).filter(function (s) { return k.indexOf(s) < 0; });
  return { ok: fehlend.length === 0, fehlend: fehlend };
}

function stufenSperre(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  var s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'nein' && s !== 'false' && s !== '0';
}

// Übernommen aus Mahnlauf bau/kern/offene-posten.js (Commit 61022e4), unverändert: OP_TAG0 opZwei seriennummerZuDatum
var OP_TAG0 = Date.UTC(1899, 11, 30);

function opZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

function seriennummerZuDatum(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 1) return null;
  var d = new Date(OP_TAG0 + Math.floor(v) * 86400000);
  return d.getUTCFullYear() + '-' + opZwei(d.getUTCMonth() + 1) + '-' + opZwei(d.getUTCDate());
}

// werte: [[Kopf...], [Zeile...], ...] -> { ok, fehlend, abweichend, anlagen: [...], dubletten: [Anlagen-ID] }
function leseAnlagen(werte) {
  var w = werte || [];
  var kopf = (w[0] || []).map(anText);
  var p = pruefeKopfzeile(kopf, AN_SPALTEN);
  var aus = { ok: true, fehlend: p.fehlend, abweichend: false, anlagen: [], dubletten: [] };
  // Sicherung Kopfzeile exakt: Anfang
  if (!p.ok || kopf.length !== AN_SPALTEN.length || kopf.some(function (s, i) { return s !== AN_SPALTEN[i]; })) {
    aus.ok = false;
    aus.abweichend = true;
    return aus;
  }
  // Sicherung Kopfzeile exakt: Ende
  var idx = {};
  AN_SPALTEN.forEach(function (s, i) { idx[s] = i; });
  var zaehl = {};
  w.slice(1).forEach(function (z, k) {
    if (!z || z.every(function (v) { return anText(v) === ''; })) return;
    var g = function (s) { return z[idx[s]]; };
    var a = {
      zeile: k + 2,
      anlagen_id: anText(g('Anlagen-ID')),
      kunden_id: anText(g('Kunden-ID')),
      kunde: anText(g('Kunde')),
      email: anText(g('E-Mail')),
      anlage: anText(g('Anlage')),
      leistung: anText(g('Leistung des Betriebs')),
      erhoben_bei: anText(g('Adresse erhoben bei')),
      hinweis_erhebung: anDatum(g('Widerspruchshinweis bei Erhebung')),
      einbaudatum: anDatum(g('Einbaudatum')),
      letzte_wartung: anDatum(g('letzte Wartung')),
      intervall: anIntervall(g('Intervall (Monate)')),
      pause: stufenSperre(g('Pause')),
      pause_grund: anText(g('Pause Grund')),
      werbewiderspruch: stufenSperre(g('Werbewiderspruch')),
      widerspruch_aufheben: anText(g('Widerspruch aufheben')),
      faelligkeit_zelle: anDatum(g('nächste Fälligkeit')),
      status: anText(g('Status')),
      angebot_am: anDatum(g('Angebot am')),
      erinnerung_am: anDatum(g('Erinnerung am')),
      thread_id: anText(g('Thread-ID')),
      antwort: anText(g('Antwort')),
      antwort_erledigt: anText(g('Antwort erledigt')).toLowerCase() === 'ja',
      versandstatus_klaeren: anText(g('Versandstatus klären')),
      mangel: [],
    };
    if (!a.anlagen_id) a.mangel.push('Anlagen-ID fehlt');
    if (!a.kunden_id) a.mangel.push('Kunden-ID fehlt');
    if (a.anlagen_id) zaehl[a.anlagen_id] = (zaehl[a.anlagen_id] || 0) + 1;
    aus.anlagen.push(a);
  });
  aus.dubletten = Object.keys(zaehl).filter(function (id) { return zaehl[id] > 1; });
  aus.anlagen.forEach(function (a) {
    if (a.anlagen_id && zaehl[a.anlagen_id] > 1) a.mangel.push('Anlagen-ID doppelt'); // Sicherung Dublette
  });
  return aus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AN_SPALTEN, leseAnlagen, seriennummerZuDatum };
}
