// Bewertungsantworten, Kernlogik: Blaetter lesen und schreiben (BAUPLAN b; PLAN-QUELLEN Vertrag 1; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Eingaben wie von values.get mit UNFORMATTED_VALUE/SERIAL_NUMBER.
// pruefeKopfzeile und seriennummerZuDatum kommen aus der Wartungserinnerung (dort aus Mahnlauf bau/kern/stufen.js und
// offene-posten.js, Commit 61022e4). Neu: Testquelle, Google-Schema, Blatt "Bewertungen", immer RAW.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Übernommen aus Wartungserinnerung bau/kern/anlagen.js (Commit b79066d), unverändert: pruefeKopfzeile OP_TAG0 opZwei seriennummerZuDatum
function pruefeKopfzeile(kopf, pflichtspalten) {
  var k = (kopf || []).map(function (s) { return String(s).trim(); });
  var fehlend = (pflichtspalten || []).filter(function (s) { return k.indexOf(s) < 0; });
  return { ok: fehlend.length === 0, fehlend: fehlend };
}

var OP_TAG0 = Date.UTC(1899, 11, 30);

function opZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

function seriennummerZuDatum(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 1) return null;
  var d = new Date(OP_TAG0 + Math.floor(v) * 86400000);
  return d.getUTCFullYear() + '-' + opZwei(d.getUTCMonth() + 1) + '-' + opZwei(d.getUTCDate());
}

// Blatt "Testquelle" = nachgebautes Google-Profil (BAUPLAN b), Spalten in Google-Form.
var TQ_SPALTEN = ['reviewId', 'starRating', 'comment', 'createTime', 'updateTime', 'reviewer.displayName', 'reviewer.isAnonymous',
  'reviewReply.comment', 'reviewReply.updateTime', 'reviewReply.reviewReplyState', 'reviewReply.policyViolation', 'Moderation (Test)'];
// Blatt "Bewertungen" = Freigabe-Oberflaeche des Betriebs (BAUPLAN b), Spalten A-M.
var BW_SPALTEN = ['Bewertungs-ID', 'Eingang', 'Stand (UTC)', 'Sterne', 'Bewertungstext', 'Kategorie', 'Hinweise', 'Entwurf', 'Antwort',
  'Freigabe', 'Status', 'veröffentlicht am', 'Versandstatus klären'];
// Blatt "Protokoll" (BAUPLAN b): nur anhaengen, nie ein Text, Entwurf, Antworttext oder Name.
var PR_SPALTEN = ['Zeitpunkt UTC', 'Zeitpunkt Berlin', 'Lauf-ID', 'Modus', 'Bewertungs-ID', 'Aktion', 'Grund', 'Hash'];
var TB_STERNE = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
var TB_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
var TB_FEHLERWERT = /^#(?:ERROR!|N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NUM!|NULL!)/;

function tbText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function tbSpalte(i) {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

// Kopfzeile genau gleich der Liste (Reihenfolge eingeschlossen) - geschrieben wird spaltenweise (S23).
function tbKopfExakt(kopf, spalten) {
  var k = (kopf || []).map(tbText);
  var p = pruefeKopfzeile(k, spalten);
  return p.ok && k.length === spalten.length && k.every(function (s, i) { return s === spalten[i]; }); // Sicherung Kopfzeile exakt
}

// Zeitfeld: RFC 3339 als Text; eine Seriennummer (von Hand eingetragen, USER_ENTERED - Baustein 1, Lauf 7126) wird als
// Ortszeit Berlin gelesen, wenn k.berlinZuUtc da ist, mit Hinweis. -> { wert, hinweis, mangel }
function tbZeit(v, feld, k) {
  if (typeof v === 'number' && isFinite(v) && v >= 1) {
    if (!k || typeof k.berlinZuUtc !== 'function') return { wert: '', hinweis: '', mangel: feld + ' als Seriennummer ohne Zeitmodul' };
    var tag = seriennummerZuDatum(v);
    var min = Math.round((v - Math.floor(v)) * 1440);
    var hhmm = opZwei(Math.floor(min / 60) % 24) + ':' + opZwei(min % 60);
    return { wert: k.berlinZuUtc(tag, hhmm), hinweis: feld + ' aus Seriennummer (Berlin) gelesen', mangel: '' };
  }
  var s = tbText(v);
  if (s === '') return { wert: '', hinweis: '', mangel: '' };
  if (TB_ZEIT.test(s) && isFinite(Date.parse(s))) return { wert: s, hinweis: '', mangel: '' };
  return { wert: '', hinweis: '', mangel: feld + ' unlesbar' };
}

// Text: Zahl oder Boolean (USER_ENTERED hat umgewandelt) -> Text mit Hinweis; Fehlerwert (#ERROR! ...) -> leer mit Mangel.
function tbFreitext(v, feld) {
  if (typeof v === 'number' || typeof v === 'boolean') return { wert: String(v), hinweis: feld + ' als Zahl gelesen – möglicherweise umgewandelt', mangel: '' };
  var s = v === undefined || v === null ? '' : String(v);
  var m = TB_FEHLERWERT.exec(s.trim());
  if (m) return { wert: '', hinweis: '', mangel: feld + ' unlesbar (' + m[0] + ')' }; // Sicherung Fehlerwert
  return { wert: s, hinweis: '', mangel: '' };
}

function tbJaNein(v) {
  if (v === true || v === false) return v;
  var s = tbText(v).toLowerCase();
  if (s === 'true' || s === 'wahr') return true;
  return false;
}

// Blatt "Testquelle" (values.get UNFORMATTED_VALUE/SERIAL_NUMBER) -> Vertrag 1 (PLAN-QUELLEN): { status, bewertungen }.
// Zeilen, denen am Ende leere Zellen fehlen (values.get laesst sie weg), werden aufgefuellt. k = { berlinZuUtc } (zeit.js).
function leseTestquelle(werte, k) {
  var w = werte || [];
  var status = { art: 'status', status: 'ok', anzahl: 0, vollstaendig: true, seiten: 1, meldungen: [] };
  if (!tbKopfExakt(w[0], TQ_SPALTEN)) {
    status.status = 'aufbau_falsch';
    status.vollstaendig = false;
    status.meldungen.push('Kopfzeile der Testquelle weicht ab');
    return { status: status, bewertungen: [] };
  }
  var aus = [];
  w.slice(1).forEach(function (z, i) {
    var r = TQ_SPALTEN.map(function (s, j) { return (z || [])[j] === undefined ? '' : z[j]; });
    if (r.every(function (v) { return tbText(v) === ''; })) return;
    var g = function (s) { return r[TQ_SPALTEN.indexOf(s)]; };
    var id = tbText(g('reviewId'));
    if (!id) { status.meldungen.push('Zeile ' + (i + 2) + ' ohne reviewId übersprungen'); return; }
    var b = { art: 'bewertung', bewertung_id: id, sterne: null, text: '', erstellt_utc: '', geaendert_utc: '', anonym: false, anzeigename: '',
      antwort_vorhanden: false, antwort_text: '', antwort_geaendert_utc: '', antwort_status: '', antwort_verstoss: '', hinweise: [], mangel: [] };
    var st = g('starRating');
    if (typeof st === 'number' && st >= 1 && st <= 5 && st === Math.floor(st)) { b.sterne = st; b.hinweise.push('starRating als Zahl gelesen'); }
    else if (TB_STERNE[tbText(st)]) b.sterne = TB_STERNE[tbText(st)];
    else if (tbText(st) === '' || tbText(st) === 'STAR_RATING_UNSPECIFIED') b.hinweise.push('Sterne ohne Wert');
    else b.mangel.push('starRating unbekannt');
    var t = tbFreitext(g('comment'), 'comment');
    b.text = t.wert;
    [t, tbZeit(g('createTime'), 'createTime', k), tbZeit(g('updateTime'), 'updateTime', k)].forEach(function (x, j) {
      if (j === 1) b.erstellt_utc = x.wert;
      if (j === 2) b.geaendert_utc = x.wert;
      if (x.hinweis) b.hinweise.push(x.hinweis);
      if (x.mangel) b.mangel.push(x.mangel);
    });
    if (!b.geaendert_utc && b.mangel.indexOf('updateTime unlesbar') < 0) b.mangel.push('updateTime fehlt');
    b.anonym = tbJaNein(g('reviewer.isAnonymous'));
    b.anzeigename = tbText(g('reviewer.displayName'));
    var at = tbFreitext(g('reviewReply.comment'), 'reviewReply.comment');
    b.antwort_text = at.wert;
    b.antwort_vorhanden = at.wert.trim() !== '' || !!at.mangel;
    if (at.mangel) b.mangel.push(at.mangel);
    var az = tbZeit(g('reviewReply.updateTime'), 'reviewReply.updateTime', k);
    b.antwort_geaendert_utc = az.wert;
    b.antwort_status = tbText(g('reviewReply.reviewReplyState'));
    b.antwort_verstoss = tbText(g('reviewReply.policyViolation'));
    aus.push(b);
  });
  var zaehl = {};
  aus.forEach(function (b) { zaehl[b.bewertung_id] = (zaehl[b.bewertung_id] || 0) + 1; });
  aus.forEach(function (b) { if (zaehl[b.bewertung_id] > 1) b.mangel.push('reviewId doppelt'); }); // Sicherung reviewId doppelt
  status.anzahl = aus.length;
  return { status: status, bewertungen: aus };
}

// Google-Review (Doku-Schema, Stand 24.07.2026, UNGEMESSEN) -> Vertrag 1.
function googleZuVertrag(g) {
  var r = g || {};
  var rp = r.reviewReply || null;
  var st = TB_STERNE[tbText(r.starRating)] || null;
  return { art: 'bewertung', bewertung_id: tbText(r.reviewId), sterne: st, text: r.comment === undefined || r.comment === null ? '' : String(r.comment),
    erstellt_utc: tbText(r.createTime), geaendert_utc: tbText(r.updateTime), anonym: !!(r.reviewer && r.reviewer.isAnonymous),
    anzeigename: tbText(r.reviewer && r.reviewer.displayName), antwort_vorhanden: !!rp, antwort_text: rp ? String(rp.comment || '') : '',
    antwort_geaendert_utc: rp ? tbText(rp.updateTime) : '', antwort_status: rp ? tbText(rp.reviewReplyState) : '',
    antwort_verstoss: rp ? tbText(rp.policyViolation) : '', hinweise: st ? [] : ['Sterne ohne Wert'], mangel: [] };
}

// Seiten von reviews.list (updateTime desc) -> { status, bewertungen ab seit }. Vollstaendig nur, wenn die letzte gelesene
// Seite kein nextPageToken traegt (S27).
function leseGoogleSeiten(seiten, seitUtc) {
  var s = seiten || [];
  var alle = [];
  s.forEach(function (p) { ((p && p.reviews) || []).forEach(function (g) { alle.push(googleZuVertrag(g)); }); });
  var letzte = s.length ? s[s.length - 1] : null;
  var bw = alle.filter(function (b) { return b.geaendert_utc >= String(seitUtc || ''); });
  return { status: { art: 'status', status: 'ok', anzahl: bw.length, vollstaendig: !!letzte && !letzte.nextPageToken, seiten: s.length, meldungen: [] },
    bewertungen: bw };
}

// Blatt "Bewertungen" -> { ok, zeilen }. Werte wie geschrieben (RAW); Stand bleibt Text (Schluessel der Data Table).
function leseBewertungen(werte) {
  var w = werte || [];
  if (!tbKopfExakt(w[0], BW_SPALTEN)) return { ok: false, zeilen: [] };
  var zeilen = [];
  w.slice(1).forEach(function (z, i) {
    var r = BW_SPALTEN.map(function (s, j) { return (z || [])[j] === undefined ? '' : z[j]; });
    if (r.every(function (v) { return tbText(v) === ''; })) return;
    var g = function (s) { return r[BW_SPALTEN.indexOf(s)]; };
    zeilen.push({ zeile: i + 2, bewertung_id: tbText(g('Bewertungs-ID')), eingang: tbText(g('Eingang')), stand_utc: tbText(g('Stand (UTC)')),
      sterne: typeof g('Sterne') === 'number' ? g('Sterne') : (tbText(g('Sterne')) === '' ? null : Number(tbText(g('Sterne')))),
      text: g('Bewertungstext') === '' ? '' : String(g('Bewertungstext')), kategorie: tbText(g('Kategorie')), hinweise: tbText(g('Hinweise')),
      entwurf: String(g('Entwurf')), antwort: String(g('Antwort')), freigabe: tbText(g('Freigabe')), status: tbText(g('Status')),
      veroeffentlicht_am: tbText(g('veröffentlicht am')), versandstatus_klaeren: tbText(g('Versandstatus klären')) });
  });
  return { ok: true, zeilen: zeilen };
}

// Zellen einer Zeile im Blatt "Bewertungen" nach Spaltennamen -> Bereiche fuer values:batchUpdate.
function zellen(zeile, felder) {
  var z = Number(zeile);
  if (!Number.isInteger(z) || z < 2) throw new Error('Zeile ungültig');
  return Object.keys(felder || {}).map(function (s) {
    var i = BW_SPALTEN.indexOf(s);
    if (i < 0) throw new Error('Spalte unbekannt ' + s);
    return { range: "'Bewertungen'!" + tbSpalte(i) + z, values: [[felder[s]]] };
  });
}

// Befund 10 aus Baustein 1: USER_ENTERED wandelt Text um (Formel, Apostroph, fuehrende Nullen, Datum). Geschrieben wird immer RAW.
function rawSchreibauftrag(bereiche) {
  (bereiche || []).forEach(function (b) { if (!b || !tbText(b.range)) throw new Error('Bereich ohne range'); });
  return { valueInputOption: 'RAW', data: bereiche || [] }; // Sicherung immer RAW
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TQ_SPALTEN, BW_SPALTEN, PR_SPALTEN, pruefeKopfzeile, seriennummerZuDatum, leseTestquelle, googleZuVertrag, leseGoogleSeiten,
    leseBewertungen, zellen, rawSchreibauftrag };
}
