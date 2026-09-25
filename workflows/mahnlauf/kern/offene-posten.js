// Mahnlauf, Kernlogik: Unterworkflow "Offene Posten lesen", Quelle Sheet (BAUPLAN g, Baustein 4).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Eingabe ist die Antwort der
// Sheets-API: Blattnamen und Zeitzone aus spreadsheets.get, die Werte aus values.get mit
// valueRenderOption=UNFORMATTED_VALUE und dateTimeRenderOption=SERIAL_NUMBER. Gemessen in
// Baustein 1 (Lauf 5414): ein Datum kommt dann als Seriennummer (ganze Zahl), ein Betrag als
// Zahl, alles andere als Text - ein getipptes Text-Datum ist damit als ungueltig erkennbar.
// Die Seriennummer zaehlt Tage in der Zeitzone der Tabelle; die Tabelle steht auf
// Europe/Berlin (Baustein 3), eine andere Zeitzone wird gemeldet.
//
// Regel (BAUPLAN h): Erwartbares kommt als Status zurueck, geworfen wird nur bei
// Unerwartetem. Falscher Tabellenaufbau -> status "tabellenaufbau_falsch", keine Posten;
// der Hauptlauf bricht dann ab. Auffaellige Zeilen (Dublette, Kundentyp, E-Mail, Datum,
// Betrag) werden weitergegeben, mit Hinweis - entscheiden tut der Hauptlauf.

var OP_BLAETTER = ['Offene Posten', 'Einstellungen', 'Zahlungseingänge', 'Protokoll', 'Textbausteine'];

var OP_SPALTEN = [
  'Rechnungsnr.', 'Kunde', 'Kundentyp', 'E-Mail', 'Rechnungsdatum', 'Fälligkeit',
  'Betrag brutto', 'bezahlt bis jetzt', 'Verzugshinweis auf Rechnung', 'Mahnsperre',
  'Mahnsperre Grund', 'aktuelle Stufe', 'Datum letzte Stufe', 'Link zur Rechnungs-PDF',
  'Protokoll', 'Status', 'Freigabe', 'Entwurf-ID', 'Entwurf-Restbetrag', 'Versandstatus klären',
];

var OP_TAG0 = Date.UTC(1899, 11, 30);

function opZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

// Seriennummer (Tage seit 30.12.1899, Nachkommastellen = Uhrzeit) -> 'JJJJ-MM-TT'.
// Alles andere (Text, leer, Wahrheitswert) -> null.
function seriennummerZuDatum(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 1) return null;
  var d = new Date(OP_TAG0 + Math.floor(v) * 86400000);
  return d.getUTCFullYear() + '-' + opZwei(d.getUTCMonth() + 1) + '-' + opZwei(d.getUTCDate());
}

// Zahl aus der Tabelle -> ganze Cent. Text ist kein Betrag -> null.
function betragZuCent(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return Math.round(v * 100);
}

function opText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function opLeer(v) {
  return opText(v) === '';
}

function opNorm(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[\s\-\/\.‐-―]/g, '');
}

function opMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(opText(s));
}

function opIstDatum(s) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!r) return false;
  var d = new Date(Date.UTC(+r[1], +r[2] - 1, +r[3]));
  return d.getUTCFullYear() === +r[1] && d.getUTCMonth() === +r[2] - 1 && d.getUTCDate() === +r[3];
}

function opErgebnis(quelle, stichtag, zeitzone) {
  return {
    status: 'ok', quelle: quelle, stichtag: stichtag, zeitzone: zeitzone || '', anzahl: 0,
    fehlend_blaetter: [], fehlend_spalten: [], doppelte_spalten: [], meldungen: [], posten: [],
  };
}

// Eingang des Unterworkflows { quelle, stichtag }. Quelle Sheet: { art: 'Sheet', tabelle_id }.
// Eine andere Quelle ist vorbereitet, nicht gebaut -> Status statt Wurf. Ein Aufruf ohne
// Pflichtfeld ist ein Fehler des Aufrufers -> Wurf (unerwartet). Die Meldungen tragen
// keinen Doppelpunkt: der Code-Node schneidet alles bis zum ersten ": " ab.
function pruefeEingangOffenePosten(e) {
  if (!e || typeof e !== 'object') throw new Error('Offene Posten lesen - Eingang fehlt');
  var q = e.quelle;
  if (!q || typeof q !== 'object' || opLeer(q.art)) throw new Error('Offene Posten lesen - Eingang ohne quelle.art');
  if (!opIstDatum(e.stichtag)) throw new Error('Offene Posten lesen - Stichtag nicht im Format JJJJ-MM-TT');
  if (q.art !== 'Sheet') {
    var erg = opErgebnis(q, e.stichtag, '');
    erg.status = 'quelle_nicht_gebaut';
    erg.meldungen.push({ rechnungsnr: '', zeile: 0, text: 'Quelle "' + opText(q.art) + '" ist vorbereitet, nicht gebaut' });
    return { weiter: false, status: erg.status, quelle: q, stichtag: e.stichtag, ergebnis: erg };
  }
  if (opLeer(q.tabelle_id)) throw new Error('Offene Posten lesen - Eingang ohne quelle.tabelle_id');
  return { weiter: true, status: '', quelle: q, stichtag: e.stichtag, tabelle_id: opText(q.tabelle_id) };
}

// p = { blaetter: [Namen], zeitzone, werte: [[Kopfzeile], [Zeile], ...] oder null, quelle, stichtag }
function leseOffenePosten(p) {
  var aus = opErgebnis(p.quelle, p.stichtag, p.zeitzone);
  var blaetter = (p.blaetter || []).map(opText);
  if (opText(p.zeitzone) !== 'Europe/Berlin') {
    aus.meldungen.push({ rechnungsnr: '', zeile: 0, text: 'Zeitzone der Tabelle ist "' + opText(p.zeitzone) + '", erwartet Europe/Berlin' });
  }
  aus.fehlend_blaetter = OP_BLAETTER.filter(function (b) { return blaetter.indexOf(b) < 0; });
  var werte = p.werte || [];
  var kopf = (werte[0] || []).map(opText);
  if (blaetter.indexOf('Offene Posten') >= 0) {
    aus.fehlend_spalten = OP_SPALTEN.filter(function (s) { return kopf.indexOf(s) < 0; });
    aus.doppelte_spalten = OP_SPALTEN.filter(function (s) {
      var i = kopf.indexOf(s);
      return i >= 0 && kopf.indexOf(s, i + 1) >= 0;
    });
  }
  if (aus.fehlend_blaetter.length || aus.fehlend_spalten.length || aus.doppelte_spalten.length) {
    aus.status = 'tabellenaufbau_falsch';
    return aus;
  }

  var idx = {};
  OP_SPALTEN.forEach(function (s) { idx[s] = kopf.indexOf(s); });
  var zellen = [];
  var anzahl = {};
  for (var r = 1; r < werte.length; r++) {
    var reihe = werte[r] || [];
    if (reihe.every(opLeer)) continue;
    var feld = function (s) { return reihe[idx[s]]; };
    var h = [];
    var nr = opText(feld('Rechnungsnr.'));
    var kundentyp = opText(feld('Kundentyp'));
    if (kundentyp.toUpperCase() === 'B2B' || kundentyp.toUpperCase() === 'B2C') kundentyp = kundentyp.toUpperCase();
    var email = opText(feld('E-Mail'));
    var rd = seriennummerZuDatum(feld('Rechnungsdatum'));
    var fd = seriennummerZuDatum(feld('Fälligkeit'));
    var cent = betragZuCent(feld('Betrag brutto'));
    if (!nr) h.push('Rechnungsnr. fehlt');
    if (kundentyp !== 'B2B' && kundentyp !== 'B2C') h.push('Kundentyp ungültig');
    if (!opMailOk(email)) h.push('E-Mail fehlt oder ungültig');
    if (!rd) h.push('Rechnungsdatum ist kein Datum');
    if (!fd) h.push('Fälligkeit ist kein Datum');
    if (rd && fd && fd < rd) h.push('Fälligkeit liegt vor dem Rechnungsdatum');
    if (cent === null || cent <= 0) h.push('Betrag brutto ist keine Zahl > 0');
    var posten = {
      rechnungsnr: nr,
      kunde: opText(feld('Kunde')),
      kundentyp: kundentyp,
      email: email,
      rechnungsdatum: rd || '',
      faelligkeit: fd || '',
      betrag_brutto_cent: cent,
      verzugshinweis: opText(feld('Verzugshinweis auf Rechnung')),
      mahnsperre: opText(feld('Mahnsperre')),
      mahnsperre_grund: opText(feld('Mahnsperre Grund')),
      pdf_ref: opText(feld('Link zur Rechnungs-PDF')),
      versandstatus_klaeren: opText(feld('Versandstatus klären')),
      quelle_id: r + 1,
      hinweise: h,
    };
    zellen.push(posten);
    if (nr) anzahl[opNorm(nr)] = (anzahl[opNorm(nr)] || 0) + 1;
  }
  zellen.forEach(function (x) {
    if (x.rechnungsnr && anzahl[opNorm(x.rechnungsnr)] > 1) x.hinweise.push('Dublette');
    x.hinweise.forEach(function (t) {
      aus.meldungen.push({ rechnungsnr: x.rechnungsnr, zeile: x.quelle_id, text: t });
    });
  });
  aus.posten = zellen;
  aus.anzahl = zellen.length;
  return aus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OP_SPALTEN, seriennummerZuDatum, betragZuCent, leseOffenePosten, pruefeEingangOffenePosten };
}
