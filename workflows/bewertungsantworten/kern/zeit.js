// Bewertungsantworten, Kernlogik: Tage, Berliner Zeit, Stichtag (BAUPLAN c 2, E2, E7; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Die Tagesarithmetik und berlinZeit kommen aus der
// Wartungserinnerung (dort aus Mahnlauf bau/kern/stufen.js und hauptlauf.js, Commit 61022e4). Neu: Laufplan und Loeschfrist.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Übernommen aus Wartungserinnerung bau/kern/entscheidung.js (Commit 42b4f08), unverändert: stufenTag stufenIstDatum datumPlusTage tageZwischen bestimmeStichtag
function stufenTag(d) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  if (!r) throw new Error('Datum nicht im Format JJJJ-MM-TT: ' + d);
  var j = +r[1];
  var m = +r[2];
  var t = +r[3];
  var ms = Date.UTC(j, m - 1, t);
  var x = new Date(ms);
  if (x.getUTCFullYear() !== j || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== t) {
    throw new Error('kein Kalenderdatum: ' + d);
  }
  return ms / 86400000;
}

function stufenIstDatum(d) {
  try { stufenTag(d); return true; } catch (e) { return false; }
}

function datumPlusTage(datum, tage) {
  if (!Number.isInteger(tage)) throw new Error('Tage muss ganze Zahl sein: ' + tage);
  var x = new Date((stufenTag(datum) + tage) * 86400000);
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  return x.getUTCFullYear() + '-' + z(x.getUTCMonth() + 1) + '-' + z(x.getUTCDate());
}

function tageZwischen(von, bis) {
  return stufenTag(bis) - stufenTag(von);
}

function bestimmeStichtag(modus, stichtagEinstellung, heute) {
  stufenTag(heute);
  var s = String(stichtagEinstellung == null ? '' : stichtagEinstellung).trim();
  if (!s) return { stichtag: heute, hinweis: '' };
  if (modus === 'test' || modus === 'trocken') {
    stufenTag(s);
    return { stichtag: s, hinweis: '' };
  }
  return { stichtag: heute, hinweis: 'Stichtag im Modus ' + modus + ' ignoriert' };
}

// Übernommen aus Wartungserinnerung bau/kern/lauf.js (Commit 7501301), unverändert: hlZwei hlLetzterSonntag berlinZeit
function hlZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

function hlLetzterSonntag(jahr, monat) {
  var t = new Date(Date.UTC(jahr, monat, 0));
  return t.getUTCDate() - t.getUTCDay();
}

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

// E2 (Elias 27.09.2026): Hauptlauf werktags 08:00 und 14:00 Europe/Berlin. Feiertage kennt der Plan nicht (ein Lauf mehr
// schadet der Frist nicht).
var ZT_PLANZEITEN = ['08:00', '14:00'];

function ztIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Ortszeit Berlin (Datum JJJJ-MM-TT, Uhrzeit hh:mm) -> Zeitpunkt UTC 'JJJJ-MM-TTThh:mm:ssZ'. Probiert Sommer-, dann Winterzeit
// und nimmt die, die berlinZeit zurueck auf dieselbe Ortszeit bringt.
function berlinZuUtc(datum, uhrzeit) {
  var d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(datum));
  var u = /^(\d{2}):(\d{2})$/.exec(String(uhrzeit));
  if (!d || !u) throw new Error('Datum oder Uhrzeit ungültig');
  var lokal = Date.UTC(+d[1], +d[2] - 1, +d[3], +u[1], +u[2]);
  for (var off = 2; off >= 1; off--) {
    var iso = ztIso(lokal - off * 3600000);
    var b = berlinZeit(iso);
    if (b.datum === String(datum) && b.text.slice(11, 16) === String(uhrzeit)) return iso;
  }
  throw new Error('Ortszeit in Berlin nicht eindeutig');
}

// Naechster planmaessiger Lauf ECHT nach jetztUtc (werktags, ZT_PLANZEITEN) als UTC-Zeitpunkt.
function naechsterPlanlauf(jetztUtc) {
  var jetzt = Date.parse(String(jetztUtc));
  if (!isFinite(jetzt)) throw new Error('Zeitpunkt ungültig');
  var tag = berlinZeit(ztIso(jetzt)).datum;
  for (var i = 0; i < 8; i++) {
    var d = datumPlusTage(tag, i);
    var wt = new Date(stufenTag(d) * 86400000).getUTCDay();
    if (wt === 0 || wt === 6) continue;
    for (var j = 0; j < ZT_PLANZEITEN.length; j++) {
      var u = berlinZuUtc(d, ZT_PLANZEITEN[j]);
      if (Date.parse(u) > jetzt) return u;
    }
  }
  throw new Error('kein Planlauf in acht Tagen');
}

// S26/E7: Laeuft Stand (UTC) plus Frist spaetestens beim naechsten planmaessigen Lauf ab, wird JETZT geloescht - so ist die
// Frist nie laenger als erlaubt, auch ueber ein Wochenende. Ein unlesbarer Stand loescht (fail-closed).
function loeschfristFaellig(standUtc, fristTage, jetztUtc) {
  var s = String(standUtc == null ? '' : standUtc);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s) || !isFinite(Date.parse(s))) return true; // Sicherung Loeschfrist ohne Stand
  return Date.parse(s) + Number(fristTage) * 86400000 <= Date.parse(naechsterPlanlauf(jetztUtc)); // Sicherung Loeschfrist vor dem naechsten Lauf
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stufenTag, stufenIstDatum, datumPlusTage, tageZwischen, bestimmeStichtag, hlLetzterSonntag, berlinZeit, berlinZuUtc,
    naechsterPlanlauf, loeschfristFaellig };
}
