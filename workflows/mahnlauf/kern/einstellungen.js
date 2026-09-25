// Mahnlauf, Kernlogik: Blatt "Einstellungen" lesen (BAUPLAN b, Baustein 5/6).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Eingabe wie von values.get mit
// UNFORMATTED_VALUE/SERIAL_NUMBER: Spalte A Schluessel, Spalte B Wert. Ausgabe ist die Form,
// die planeLauf, die Parser und waehleAuszugsdateien erwarten. Die Adressen (Testempfaenger,
// Absenderadresse, Antwort an, Meldeadresse) kommen NIE in die Ausgabe - nur "gesetzt ja/nein";
// wer sie zum Senden braucht, liest sie am Versandschritt selbst (Baustein 7).
// Unlesbare Zahlen werden NaN; planeLauf wirft dann "Einstellung ungueltig" (fail-closed).

var EI_FELDER = [
  ['Modus', 'modus', 'klein'],
  ['Testempfänger', 'testempfaenger', 'adresse'],
  ['Stichtag (nur Test)', 'stichtag_test', 'datum'],
  ['Absendername', 'absendername', 'text'],
  ['Absenderadresse', 'absenderadresse', 'adresse'],
  ['Antwort an', 'antwort_an', 'adresse'],
  ['Firmenname', 'firma', 'text'],
  ['IBAN', 'iban', 'text'],
  ['BIC', 'bic', 'text'],
  ['Signatur', 'signatur', 'text'],
  ['Meldeadresse Betrieb', 'meldeadresse', 'adresse'],
  ['Intervall Erinnerung', 'intervall_erinnerung', 'zahl'],
  ['Intervall 1. Mahnung', 'intervall_mahnung1', 'zahl'],
  ['Intervall letzte Mahnung', 'intervall_letzte_mahnung', 'zahl'],
  ['Intervall Übergabe', 'intervall_uebergabe', 'zahl'],
  ['Zahlungsfrist in der Mahnung', 'zahlungsfrist', 'zahl'],
  ['Freigabemodus Erinnerung', 'freigabemodus_erinnerung', 'text'],
  ['Freigabemodus 1. Mahnung', 'freigabemodus_mahnung1', 'text'],
  ['Freigabemodus letzte Mahnung', 'freigabemodus_letzte_mahnung', 'text'],
  ['Freigabemodus Übergabe', 'freigabemodus_uebergabe', 'text'],
  ['Max. Alter Kontoauszug', 'max_alter_auszug', 'zahl'],
  ['Kontoauszug-Ordner', 'kontoauszug_ordner', 'text'],
  ['Auszugsformat', 'auszugsformat', 'text'],
  ['CSV: Trennzeichen', 'csv.trennzeichen', 'roh'],
  ['CSV: Zeichensatz', 'csv.zeichensatz', 'text'],
  ['CSV: Dezimalzeichen', 'csv.dezimalzeichen', 'text'],
  ['CSV: Datumsformat', 'csv.datumsformat', 'text'],
  ['CSV: Kopfzeile in Zeile', 'csv.kopfzeile', 'zahl'],
  ['CSV: Spalte Buchungsdatum', 'csv.spalte_buchungsdatum', 'text'],
  ['CSV: Spalte Betrag', 'csv.spalte_betrag', 'text'],
  ['CSV: Spalte Soll/Haben', 'csv.spalte_soll_haben', 'text'],
  ['CSV: Spalte Verwendungszweck', 'csv.spalte_verwendungszweck', 'text'],
  ['CSV: Spalte Auftraggeber', 'csv.spalte_auftraggeber', 'text'],
  ['CSV: Spalte IBAN', 'csv.spalte_iban', 'text'],
  ['CSV: Spalte Referenz', 'csv.spalte_referenz', 'text'],
  ['Rechnungsnummer-Muster', 'muster', 'text'],
  ['Mindestbetrag', 'mindestbetrag_cent', 'cent'],
  ['Höchstzahl Mails je Lauf', 'hoechstzahl_mails', 'zahl'],
  ['Versandtage', 'versandtage', 'text'],
  ['Uhrzeit', 'uhrzeit', 'text'],
  ['PDF anhängen', 'pdf_anhaengen', 'klein'],
  ['Quelle', 'quelle', 'text'],
];

function eiText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function eiZahl(v) {
  if (typeof v === 'number') return v;
  var s = eiText(v);
  return /^-?\d+$/.test(s) ? Number(s) : NaN;
}

// 5 -> 500; "5,00" -> 500; "1.234,5" -> 123450. Sonst NaN.
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

// werte: [[Schluessel, Wert, Bemerkung], ...] (Kopfzeile darf dabei sein).
// -> { ok, fehlend: [Schluessel], kern: {...}, adressen_gesetzt: {...} }
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
  module.exports = { leseEinstellungen };
}
