// Bewertungsantworten, Kernlogik: feste Bausteine mit geprueften Platzhaltern (BAUPLAN b "Einstellungen", d S13/S14, E5/E6;
// Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Die KI formuliert hier nichts (Arbeitsregel 5): ein Baustein ist
// ein fester Text des Betriebs, der Code setzt nur {betrieb}, {signatur}, {kontaktweg} ein. fuellePlatzhalter kommt aus der
// Wartungserinnerung (dort aus Mahnlauf bau/kern/platzhalter.js, Commit 01c681b); neu ist nur die Liste der Platzhalter.

var PLATZHALTER_ERLAUBT = ['betrieb', 'signatur', 'kontaktweg'];

// Übernommen aus Wartungserinnerung bau/kern/textbausteine.js (Commit cf13b76), unverändert: phTag formatiereDatum fuellePlatzhalter
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

function formatiereDatum(iso) {
  phTag(iso);
  var t = String(iso).split('-');
  return t[2] + '.' + t[1] + '.' + t[0];
}

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

// Blatt "Textbausteine" (Auftrag 27.09.2026, Baustein 3): Spalten Art und Text; "ohne Text" je Sternzahl 1-5 (E5) und
// "unfair" (E6). Vorher standen drei Bausteine in "Einstellungen" (BAUPLAN b, selbst entschieden) - abgeloest.
var TB_SPALTEN = ['Art', 'Text'];
var TB_ARTEN = ['ohne Text 1', 'ohne Text 2', 'ohne Text 3', 'ohne Text 4', 'ohne Text 5', 'unfair'];

function bsText(v) {
  return v === undefined || v === null ? '' : String(v);
}

// Map Art -> Text pruefen: jede Art vorhanden und nicht leer, nur bekannte Platzhalter (mit Probewerten).
function pruefeBausteine(bausteine) {
  var fehler = [];
  TB_ARTEN.forEach(function (a) {
    if (!Object.prototype.hasOwnProperty.call(bausteine || {}, a)) { fehler.push('Textbaustein „' + a + '“ fehlt'); return; }
    var v = bsText(bausteine[a]);
    if (!v.trim()) { fehler.push('Textbaustein „' + a + '“ leer'); return; }
    var r = fuellePlatzhalter(v, { betrieb: 'x', signatur: 'x', kontaktweg: 'x' });
    if (!r.ok) r.fehler.forEach(function (f) { fehler.push('Textbaustein „' + a + '“ – Platzhalter {' + f.platzhalter + '} ' + f.grund); }); // Sicherung Bausteine nur bekannte Platzhalter
  });
  return fehler;
}

// Blatt "Textbausteine" (values.get) -> { ok, fehler, bausteine: { Art: Text } }. Kopfzeile exakt, jede Art genau einmal.
function leseTextbausteine(werte) {
  var w = werte || [];
  var kopf = (w[0] || []).map(function (s) { return bsText(s).trim(); });
  if (kopf.length !== TB_SPALTEN.length || kopf.some(function (s, i) { return s !== TB_SPALTEN[i]; })) {
    return { ok: false, fehler: ['Kopfzeile Textbausteine weicht ab'], bausteine: {} }; // Sicherung Textbausteine Kopfzeile exakt
  }
  var aus = {};
  var fehler = [];
  w.slice(1).forEach(function (z) {
    var art = bsText(z && z[0]).trim();
    if (!art && !bsText(z && z[1]).trim()) return;
    if (TB_ARTEN.indexOf(art) < 0) { fehler.push('Textbaustein „' + art + '“ unbekannt'); return; }
    if (Object.prototype.hasOwnProperty.call(aus, art)) { fehler.push('Textbaustein „' + art + '“ doppelt'); return; } // Sicherung Textbaustein doppelt
    aus[art] = bsText(z[1]);
  });
  fehler = fehler.concat(pruefeBausteine(aus));
  return { ok: fehler.length === 0, fehler: fehler, bausteine: aus };
}

// S14: ohne Text = leer, nur Leerzeichen, Satzzeichen, Symbole oder Emoji (auch mit Verbinder) - kein KI-Aufruf (E5).
function ohneText(text) {
  return String(text == null ? '' : text).replace(/[\s\p{P}\p{S}\p{M}‍️]/gu, '') === '';
}

// art: 'ohne_text' (Baustein "ohne Text <Sterne>", E5) oder 'unfair' (E6); bausteine aus leseTextbausteine; e: Einstellungen.
// -> { ok, text } oder { ok: false, fehler: [...] }. Der Text ist fest; der Code setzt nur die drei Platzhalter ein.
function baueBaustein(art, sterne, bausteine, e) {
  var s = Number(sterne);
  var k = art === 'unfair' ? 'unfair' : (art === 'ohne_text' && Number.isInteger(s) && s >= 1 && s <= 5 ? 'ohne Text ' + s : '');
  if (!k) return { ok: false, fehler: ['Art oder Sterne ungültig ' + art + ' ' + sterne] };
  var v = bsText((bausteine || {})[k]);
  if (!v.trim()) return { ok: false, fehler: ['Textbaustein „' + k + '“ leer'] };
  var x = e || {};
  var r = fuellePlatzhalter(v, { betrieb: x.betrieb, signatur: x.signatur, kontaktweg: x.kontaktweg });
  if (!r.ok) return { ok: false, fehler: r.fehler.map(function (f) { return 'Platzhalter {' + f.platzhalter + '} ' + f.grund; }) };
  return { ok: true, text: r.text };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PLATZHALTER_ERLAUBT, TB_SPALTEN, TB_ARTEN, formatiereDatum, fuellePlatzhalter, ohneText, baueBaustein, pruefeBausteine,
    leseTextbausteine };
}
