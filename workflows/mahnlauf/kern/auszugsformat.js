// Mahnlauf, Kernlogik: Kontoauszug-Dateien nach der Einstellung "Auszugsformat"
// auswaehlen (Teil A, 25.09.2026).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Gelesen werden nur
// Dateien des eingestellten Formats (CSV oder CAMT); Dateien im anderen Format
// oder ohne erkennbares Format werden gemeldet, nicht gelesen. Grund: Dieselbe
// Zahlung hat als CSV und als CAMT verschiedene Buchungsschluessel und zaehlte
// sonst doppelt. Ist die Einstellung leer oder unbekannt, wird nichts gelesen
// (fail-closed: ohne gelesenen Auszug gibt es keinen frischen Stand, keine Mail).

var AUSZUG_ENDUNG = { csv: 'CSV', xml: 'CAMT' };
var AUSZUG_MIME = { 'text/csv': 'CSV', 'application/xml': 'CAMT', 'text/xml': 'CAMT' };

// datei = { name, mimeType } (wie Google Drive sie liefert) -> 'CSV', 'CAMT' oder ''.
// Die Endung entscheidet, sonst der MIME-Typ.
function erkenneAuszugsformat(datei) {
  var name = String((datei && datei.name) || '');
  var m = /\.([A-Za-z0-9]+)$/.exec(name);
  if (m && AUSZUG_ENDUNG[m[1].toLowerCase()]) return AUSZUG_ENDUNG[m[1].toLowerCase()];
  var mime = String((datei && datei.mimeType) || '').toLowerCase().split(';')[0].trim();
  return AUSZUG_MIME[mime] || '';
}

// Ergebnis { ok, lesen: [{ ...datei, format }], gemeldet: [{ datei, format, grund }], grund }.
function waehleAuszugsdateien(dateien, auszugsformat) {
  var soll = String(auszugsformat == null ? '' : auszugsformat).trim().toUpperCase();
  var liste = dateien || [];
  var lesen = [];
  var gemeldet = [];
  if (soll !== 'CSV' && soll !== 'CAMT') {
    var grund = 'Auszugsformat ungültig: "' + (auszugsformat == null ? '' : auszugsformat) + '" (erlaubt: CSV, CAMT)';
    liste.forEach(function (d) {
      gemeldet.push({ datei: String((d && d.name) || ''), format: erkenneAuszugsformat(d), grund: grund });
    });
    return { ok: false, lesen: lesen, gemeldet: gemeldet, grund: grund };
  }
  liste.forEach(function (d) {
    var f = erkenneAuszugsformat(d);
    var name = String((d && d.name) || '');
    if (!f) { gemeldet.push({ datei: name, format: '', grund: 'Format nicht erkannt, nicht gelesen' }); return; }
    if (f !== soll) { gemeldet.push({ datei: name, format: f, grund: 'Format ' + f + ', eingestellt ist ' + soll + ' - nicht gelesen' }); return; } // Sicherung Auszugsformat
    lesen.push(Object.assign({}, d, { format: f }));
  });
  return { ok: true, lesen: lesen, gemeldet: gemeldet, grund: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { erkenneAuszugsformat, waehleAuszugsdateien };
}
