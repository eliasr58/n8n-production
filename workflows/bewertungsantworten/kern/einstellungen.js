// Bewertungsantworten, Kernlogik: Blatt "Einstellungen" lesen (BAUPLAN b, c 1; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Das Lesen kommt aus der Wartungserinnerung (dort aus Mahnlauf
// bau/kern/einstellungen.js, Commit d442173). Die Adressen kommen NIE in die Ausgabe - nur "gesetzt ja/nein".
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Felder aus BAUPLAN b "Einstellungen". "Absenderadresse" ist ergaenzt (selbst entschieden, Baustein 2): Alarm an die
// Absenderadresse, wenn die Meldeadresse ungueltig ist (BAUPLAN f), wie in der Wartungserinnerung.
var EI_FELDER = [
  ['Modus', 'modus', 'klein'],
  ['Quelle', 'quelle', 'klein'],
  ['Meldeadresse', 'meldeadresse', 'adresse'],
  ['Absenderadresse', 'absenderadresse', 'adresse'],
  ['Betriebsname', 'betrieb', 'text'],
  ['Signatur', 'signatur', 'text'],
  ['Kontaktweg', 'kontaktweg', 'text'],
  ['Eigene Domain', 'domain', 'klein'],
  ['Bewertungen ab', 'bewertungen_ab', 'datum'],
  ['Höchstzahl Veröffentlichungen je Lauf', 'hoechstzahl_veroeffentlichungen', 'zahl'],
  ['Höchstzahl Entwürfe je Lauf', 'hoechstzahl_entwuerfe', 'zahl'],
  ['Höchstlänge', 'hoechstlaenge', 'zahl'],
  ['Löschfrist in Tagen', 'loeschfrist', 'zahl'],
  ['Stichtag (nur Test)', 'stichtag_test', 'datum'],
  ['zusätzliche verbotene Begriffe', 'verboten', 'text'],
];
// Blatt "Einstellungen": Spalte A Schluessel, B Wert, C Bemerkung (gelesen werden A und B). Die Textbausteine stehen seit
// Baustein 3 im eigenen Blatt (bausteine.js).
var EI_SPALTEN = ['Schlüssel', 'Wert', 'Bemerkung'];
var EI_MODI = ['trocken', 'test', 'scharf'];
var EI_QUELLEN = ['test', 'google'];

// Übernommen aus Wartungserinnerung bau/kern/einstellungen.js (Commit cf13b76), unverändert: eiText eiZahl eiCent eiDatum leseEinstellungen
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

function verboteneBegriffe(kern) {
  return String((kern || {}).verboten || '').split(';').map(function (s) { return s.trim(); }).filter(Boolean);
}

function eiGanz(v, von, bis) {
  return Number.isInteger(v) && v >= von && v <= bis;
}

// c 1: Pruefung vor jedem Schreiben (fail-closed) -> Liste der Fehler (leer = gueltig). Die Textbausteine prueft
// leseTextbausteine (bausteine.js).
function pruefeEinstellungen(kern) {
  var e = kern || {};
  var f = [];
  if (e.modus === 'scharf') f.push('Modus scharf gesperrt (Portfolio, Version 1)'); // Sicherung scharf gesperrt
  else if (EI_MODI.indexOf(e.modus) < 0) f.push('Modus unbekannt: ' + e.modus);
  if (EI_QUELLEN.indexOf(e.quelle) < 0) f.push('Quelle unbekannt: ' + e.quelle);
  else if (e.modus === 'test' && e.quelle !== 'test') f.push('Modus test verlangt Quelle test'); // Sicherung Modus test verlangt Quelle test
  if (!eiGanz(e.loeschfrist, 1, 30)) f.push('Löschfrist außerhalb 1–30 Tage'); // Sicherung Loeschfrist 1-30
  if (!eiGanz(e.hoechstlaenge, 1, 4096)) f.push('Höchstlänge außerhalb 1–4096');
  if (!eiGanz(e.hoechstzahl_veroeffentlichungen, 0, 1000)) f.push('Höchstzahl Veröffentlichungen je Lauf ungültig');
  if (!eiGanz(e.hoechstzahl_entwuerfe, 0, 1000)) f.push('Höchstzahl Entwürfe je Lauf ungültig');
  [['betrieb', 'Betriebsname'], ['signatur', 'Signatur'], ['kontaktweg', 'Kontaktweg']].forEach(function (x) {
    if (!String(e[x[0]] || '').trim()) f.push(x[1] + ' fehlt');
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.bewertungen_ab || ''))) f.push('Bewertungen ab fehlt oder ungültig');
  if (String(e.stichtag_test || '') !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.stichtag_test))) f.push('Stichtag (nur Test) ungültig');
  return f;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { EI_FELDER, EI_SPALTEN, leseEinstellungen, verboteneBegriffe, pruefeEinstellungen };
}
