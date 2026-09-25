// Mahnlauf, Kernlogik: Textbausteine mit geprueften Platzhaltern (BAUPLAN b, "Textbausteine").
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Der Betrieb schreibt
// seine Texte selbst, der Code prueft jeden Platzhalter: ein unbekannter, leerer
// oder ungeschlossener Platzhalter ergibt KEINEN Text, sondern einen Fehler mit
// Namen (-> keine Mail, Meldung). Die KI formuliert keinen Mahntext.
// Version 1: ohne {zinsen} und {pauschale}. Jeder Betreff muss {rechnungsnr} tragen (pruefeTextbausteine).

var PLATZHALTER_ERLAUBT = [
  'kunde', 'rechnungsnr', 'rechnungsdatum', 'betrag', 'bezahlt', 'rest',
  'frist_datum', 'firma', 'iban', 'signatur',
];

// Ganze Cent -> "1.234,56". Nur Zeichenketten-Arbeit, keine Euro-Gleitkommazahl.
function formatiereBetrag(cent) {
  if (!Number.isInteger(cent)) throw new Error('Betrag muss ganze Cent sein: ' + cent);
  var neg = cent < 0;
  var s = String(Math.abs(cent));
  while (s.length < 3) s = '0' + s;
  var euro = s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + euro + ',' + s.slice(-2);
}

function phTag(d) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  if (!r) throw new Error('Datum nicht im Format JJJJ-MM-TT: ' + d);
  var ms = Date.UTC(+r[1], +r[2] - 1, +r[3]);
  var x = new Date(ms);
  if (x.getUTCFullYear() !== +r[1] || x.getUTCMonth() !== +r[2] - 1 || x.getUTCDate() !== +r[3]) {
    throw new Error('kein Kalenderdatum: ' + d);
  }
  return ms / 86400000;
}

// "2026-09-24" -> "24.09.2026"
function formatiereDatum(iso) {
  phTag(iso);
  var t = String(iso).split('-');
  return t[2] + '.' + t[1] + '.' + t[0];
}

function phDatumPlusTage(d, tage) {
  var x = new Date((phTag(d) + tage) * 86400000);
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  return x.getUTCFullYear() + '-' + z(x.getUTCMonth() + 1) + '-' + z(x.getUTCDate());
}

// vorlage mit {name}; werte: { name: Text }. Ergebnis { ok, text } oder { ok:false, fehler:[{platzhalter, grund}] }.
function fuellePlatzhalter(vorlage, werte) {
  var s = String(vorlage == null ? '' : vorlage);
  var fehler = [];
  var tiefe = 0;
  for (var i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      if (tiefe > 0) fehler.push({ platzhalter: '', grund: 'verschachtelt' });
      tiefe++;
    } else if (s[i] === '}') {
      if (tiefe === 0) fehler.push({ platzhalter: '', grund: 'ungeschlossen' });
      else tiefe--;
    }
  }
  if (tiefe > 0) fehler.push({ platzhalter: '', grund: 'ungeschlossen' });
  var text = s.replace(/\{([^{}]*)\}/g, function (ganz, roh) {
    var name = roh.trim();
    if (PLATZHALTER_ERLAUBT.indexOf(name) < 0) {
      fehler.push({ platzhalter: name, grund: 'unbekannt' });
      return ganz;
    }
    var v = werte ? werte[name] : undefined;
    if (v === undefined || v === null || String(v).trim() === '') {
      fehler.push({ platzhalter: name, grund: 'leer' });
      return ganz;
    }
    return String(v);
  });
  if (fehler.length) return { ok: false, fehler: fehler };
  return { ok: true, text: text };
}

function phSicher(f) {
  try { return f(); } catch (e) { return ''; }
}

// Werte fuer die Platzhalter aus einer Zeile mit Zahlstand, den Einstellungen und
// dem Versanddatum (= Stichtag des Laufs). Was sich nicht formatieren laesst, wird
// leer - und damit von fuellePlatzhalter als "leer" gemeldet, nie still ersetzt.
function bauePlatzhalterWerte(rechnung, einstellungen, versanddatum) {
  var r = rechnung || {};
  var e = einstellungen || {};
  var frist = Number(e.zahlungsfrist);
  return {
    kunde: r.kunde,
    rechnungsnr: r.rechnungsnr,
    rechnungsdatum: phSicher(function () { return formatiereDatum(r.rechnungsdatum); }),
    betrag: phSicher(function () { return formatiereBetrag(r.betrag_brutto_cent); }),
    bezahlt: phSicher(function () { return formatiereBetrag(r.bezahlt_cent); }),
    rest: phSicher(function () { return formatiereBetrag(r.rest_cent); }),
    frist_datum: Number.isInteger(frist) && frist >= 0
      ? phSicher(function () { return formatiereDatum(phDatumPlusTage(versanddatum, frist)); })
      : '',
    firma: e.firma,
    iban: e.iban,
    signatur: e.signatur,
  };
}

function phText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// Blatt "Textbausteine" (Rohwerte, Kopfzeile zuerst) -> { ok, fehler: [Text] }. Entscheidung Elias 25.09.2026
// (Teil A 9): jeder Betreff traegt {rechnungsnr} - die Suche im Gesendet-Ordner (Hand-Versand, abgebrochene
// Reservierung) findet eine Mail nur ueber ihren Betreff. Aus demselben Grund darf derselbe Kundentyp nicht in
// zwei Stufen denselben Betreff haben (sonst waere die Stufe aus dem Gesendet-Ordner nicht ablesbar).
function pruefeTextbausteine(werte) {
  var w = werte || [];
  var kopf = (w[0] || []).map(phText);
  var i = { stufe: kopf.indexOf('Stufe'), typ: kopf.indexOf('Kundentyp'), betreff: kopf.indexOf('Betreff') };
  if (i.stufe < 0 || i.typ < 0 || i.betreff < 0) return { ok: false, fehler: ['Blatt Textbausteine ohne Spalte Stufe/Kundentyp/Betreff'] };
  var fehler = [];
  var gesehen = {};
  w.slice(1).forEach(function (z) {
    if (!z || z.every(function (v) { return phText(v) === ''; })) return;
    var name = 'Stufe ' + phText(z[i.stufe]) + ' ' + phText(z[i.typ]).toUpperCase();
    var b = phText(z[i.betreff]);
    if (!/\{\s*rechnungsnr\s*\}/.test(b)) fehler.push(name + ': Betreff ohne {rechnungsnr}'); // Sicherung Betreff mit Rechnungsnr
    var schl = phText(z[i.typ]).toUpperCase() + '|' + b.replace(/\{\s*([^{}]*?)\s*\}/g, '{$1}');
    if (gesehen[schl] !== undefined && gesehen[schl] !== phText(z[i.stufe])) {
      fehler.push('Stufe ' + gesehen[schl] + ' und ' + phText(z[i.stufe]) + ' ' + phText(z[i.typ]).toUpperCase() + ': gleicher Betreff');
    } else if (gesehen[schl] === undefined) {
      gesehen[schl] = phText(z[i.stufe]);
    }
  });
  return { ok: fehler.length === 0, fehler: fehler };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PLATZHALTER_ERLAUBT, formatiereBetrag, formatiereDatum, fuellePlatzhalter, bauePlatzhalterWerte, pruefeTextbausteine };
}
