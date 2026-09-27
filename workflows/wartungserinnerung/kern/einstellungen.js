// Wartungserinnerung, Kernlogik: Blatt "Einstellungen" lesen (BAUPLAN b, Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Eingabe wie von values.get mit
// UNFORMATTED_VALUE/SERIAL_NUMBER: Spalte A Schluessel, Spalte B Wert. Das Lesen ist aus dem Mahnlauf uebernommen
// (byte-gleich, E8); neu ist nur die Feldliste. Die Adressen (Testempfaenger, Absenderadresse, Antwort an,
// Meldeadresse) kommen NIE in die Ausgabe - nur "gesetzt ja/nein"; wer sie zum Senden braucht, liest sie am
// Versandschritt selbst. Unlesbare Zahlen werden NaN; planeLauf wirft dann "Einstellung ungueltig" (fail-closed).
// Das Feld kern.csv bleibt leer (Erbe der uebernommenen Funktion, ohne Wirkung).

var EI_FELDER = [
  ['Modus', 'modus', 'klein'],
  ['Testempfänger', 'testempfaenger', 'adresse'],
  ['Stichtag (nur Test)', 'stichtag_test', 'datum'],
  ['Absendername', 'absendername', 'text'],
  ['Absenderadresse', 'absenderadresse', 'adresse'],
  ['Antwort an', 'antwort_an', 'adresse'],
  ['Meldeadresse', 'meldeadresse', 'adresse'],
  ['Firmenname', 'firma', 'text'],
  ['Telefon', 'telefon', 'text'],
  ['Signatur', 'signatur', 'text'],
  ['Vorlauf Angebot', 'vorlauf', 'zahl'],
  ['Nachlauf', 'nachlauf', 'zahl'],
  ['Erinnerung nach', 'erinnerung_nach', 'zahl'],
  ['Antwortfenster', 'antwortfenster', 'zahl'],
  ['Antworten lesen bis', 'antworten_lesen_bis', 'zahl'],
  ['Standardintervall', 'standardintervall', 'zahl'],
  ['Höchstzahl Mails je Lauf', 'hoechstzahl_mails', 'zahl'],
  ['KI-Einordnung', 'ki_einordnung', 'klein'],
  ['Versandtage', 'versandtage', 'text'],
  ['Uhrzeit', 'uhrzeit', 'text'],
];

// Übernommen aus Mahnlauf bau/kern/einstellungen.js (Commit d442173), unverändert: eiText eiZahl eiCent eiDatum leseEinstellungen
function eiText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function eiZahl(v) {
  if (typeof v === 'number') return v;
  var s = eiText(v);
  return /^-?\d+$/.test(s) ? Number(s) : NaN;
}

function eiCent(v) {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v * 100);
  var s = eiText(v).replace(/\s*€$/, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return NaN;
  var t = s.replace(/\./g, '').split(',');
  return parseInt(t[0], 10) * 100 + parseInt(((t[1] || '') + '00').slice(0, 2), 10);
}

function eiDatum(v) {
  if (typeof v === 'number' && isFinite(v) && v >= 1) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
  }
  var s = eiText(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : (s === '' ? '' : 'ungültig: ' + s);
}

function leseEinstellungen(werte) {
  var roh = {};
  (werte || []).forEach(function (z) {
    var k = eiText(z && z[0]);
    if (k && !Object.prototype.hasOwnProperty.call(roh, k)) roh[k] = z.length > 1 ? z[1] : '';
  });
  var aus = { ok: true, fehlend: [], kern: { csv: {} }, adressen_gesetzt: {} };
  EI_FELDER.forEach(function (f) {
    if (!Object.prototype.hasOwnProperty.call(roh, f[0])) { aus.fehlend.push(f[0]); return; }
    var v = roh[f[0]];
    if (f[2] === 'adresse') { aus.adressen_gesetzt[f[1]] = eiText(v) !== ''; return; }
    var w;
    if (f[2] === 'zahl') w = eiZahl(v);
    else if (f[2] === 'cent') w = eiCent(v);
    else if (f[2] === 'datum') w = eiDatum(v);
    else if (f[2] === 'klein') w = eiText(v).toLowerCase();
    else if (f[2] === 'roh') w = v === undefined || v === null ? '' : String(v);
    else w = eiText(v);
    if (f[1].indexOf('csv.') === 0) aus.kern.csv[f[1].slice(4)] = w;
    else aus.kern[f[1]] = w;
  });
  aus.ok = aus.fehlend.length === 0;
  return aus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EI_FELDER, leseEinstellungen };
}
