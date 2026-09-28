// Bewertungsantworten, Kernlogik: Unterworkflow "Bewertungen lesen" (PLAN-QUELLEN Vertrag 1; Baustein 4).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Den Parser der Testquelle (tabelle.js leseTestquelle) und
// berlinZuUtc (zeit.js) bekommt leseQuelleTest ueber k, damit die Module einzeln testbar bleiben. Nach dem Muster von Mahnlauf
// bau/kern/offene-posten.js (pruefeEingangOffenePosten, leseOffenePosten; Commit 61022e4): Erwartbares kommt als Status zurueck,
// geworfen wird nur bei einem Aufruffehler. Wurftexte ohne ": " (der Code-Knoten kuerzt bis dorthin).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var LS_BLATT = 'Testquelle';
var LS_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function lsText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function lsStatus(status, meldungen) {
  return { art: 'status', status: status, anzahl: 0, vollstaendig: false, seiten: 0, meldungen: meldungen || [] };
}

function lsOk(code) {
  return typeof code === 'number' && code >= 200 && code <= 299;
}

// Eingang = alle Items des Aufrufs (json). Genau eines: { quelle: { art, tabelle_id | konto_id, standort_id }, seit }.
// -> { weiter: true, quelle, seit, tabelle_id } oder { weiter: false, quelle, seit, ergebnis } (Art nicht gebaut).
function pruefeEingangLesen(items) {
  var l = items || [];
  if (l.length !== 1) throw new Error('Bewertungen lesen – genau ein Eingang erwartet, gekommen ' + l.length); // Sicherung genau ein Eingang
  var e = l[0];
  if (!e || typeof e !== 'object') throw new Error('Bewertungen lesen – Eingang fehlt');
  var q = e.quelle;
  if (!q || typeof q !== 'object' || !lsText(q.art)) throw new Error('Bewertungen lesen – Eingang ohne quelle.art');
  var seit = lsText(e.seit);
  if (!LS_ZEIT.test(seit) || !isFinite(Date.parse(seit))) throw new Error('Bewertungen lesen – seit nicht als Zeitpunkt UTC (RFC 3339) – ' + (seit || 'leer')); // Sicherung seit RFC 3339
  if (lsText(q.art) !== 'test') { // Sicherung andere Quelle nicht gebaut
    return { weiter: false, quelle: q, seit: seit,
      ergebnis: { status: lsStatus('quelle_nicht_gebaut', ['Quelle „' + lsText(q.art) + '“ ist vorbereitet, nicht gebaut']), bewertungen: [] } };
  }
  if (!lsText(q.tabelle_id)) throw new Error('Bewertungen lesen – Quelle test ohne tabelle_id'); // Sicherung test ohne tabelle_id
  return { weiter: true, quelle: q, seit: seit, tabelle_id: lsText(q.tabelle_id) };
}

// Kopfzeile gegen die Pflichtspalten, nur fuer die Meldung - ob sie gilt, entscheidet der Parser (tbKopfExakt, S23).
function lsKopfMeldungen(kopf, spalten) {
  var k = (kopf || []).map(lsText);
  var m = [];
  spalten.forEach(function (s) { if (k.indexOf(s) < 0) m.push('Spalte fehlt – ' + s); });
  spalten.forEach(function (s) { var i = k.indexOf(s); if (i >= 0 && k.indexOf(s, i + 1) >= 0) m.push('Spalte doppelt – ' + s); });
  k.forEach(function (s) { if (s && spalten.indexOf(s) < 0) m.push('Spalte zusätzlich – ' + s); });
  if (!m.length) m.push('Spalten in anderer Reihenfolge');
  return m;
}

// p = { meta: Antwort spreadsheets.get (voll, Never Error), werte: Antwort values.get 'Testquelle' (UNFORMATTED_VALUE,
// SERIAL_NUMBER), seit }. k = { leseTestquelle, TQ_SPALTEN, berlinZuUtc }. -> { status, bewertungen } nach Vertrag 1.
function leseQuelleTest(p, k) {
  var meta = (p && p.meta) || {};
  var werte = (p && p.werte) || {};
  if (!lsOk(meta.statusCode)) return { status: lsStatus('quelle_fehler', ['Tabelle nicht lesbar, HTTP ' + meta.statusCode]), bewertungen: [] }; // Sicherung Tabelle nicht lesbar
  var blaetter = ((meta.body && meta.body.sheets) || []).map(function (s) { return lsText(s && s.properties && s.properties.title); });
  if (blaetter.indexOf(LS_BLATT) < 0) return { status: lsStatus('aufbau_falsch', ['Blatt ' + LS_BLATT + ' fehlt']), bewertungen: [] }; // Sicherung Blatt fehlt
  if (!lsOk(werte.statusCode)) return { status: lsStatus('quelle_fehler', ['Blatt ' + LS_BLATT + ' nicht lesbar, HTTP ' + werte.statusCode]), bewertungen: [] }; // Sicherung Werte nicht lesbar
  var zeilen = (werte.body && werte.body.values) || [];
  var r = k.leseTestquelle(zeilen, k);
  if (r.status.status !== 'ok') {
    r.status.meldungen = lsKopfMeldungen(zeilen[0], k.TQ_SPALTEN);
    return { status: r.status, bewertungen: [] };
  }
  var ab = Date.parse(p.seit);
  var bw = r.bewertungen.filter(function (b) { return !b.geaendert_utc || Date.parse(b.geaendert_utc) >= ab; }); // Sicherung seit
  r.status.anzahl = bw.length;
  return { status: r.status, bewertungen: bw };
}

// Ausgabe des Unterworkflows: genau ein Status-Item zuerst, Vertrags-Items nur bei ok.
function lesenAusgabe(erg) {
  var aus = [erg.status]; // Sicherung Status zuerst
  if (erg.status.status === 'ok') aus = aus.concat(erg.bewertungen); // Sicherung Bewertungen nur bei ok
  return aus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeEingangLesen, leseQuelleTest, lesenAusgabe };
}
