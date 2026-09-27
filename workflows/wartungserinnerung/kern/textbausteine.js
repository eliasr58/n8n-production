// Wartungserinnerung, Kernlogik: Textbausteine mit geprueften Platzhaltern (BAUPLAN b "Textbausteine", d, e; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Der Betrieb schreibt Betreff und Text je Art (Angebot,
// Erinnerung) selbst; der Code prueft jeden Platzhalter (fuellePlatzhalter aus dem Mahnlauf, byte-gleich; die Liste
// PLATZHALTER_ERLAUBT ist neu). Den Widerspruchshinweis setzt der CODE ein, nie der Betrieb und nie ein Aufrufer:
// jeder Text muss {widerspruch} genau einmal tragen (§ 7 Abs. 3 Nr. 4 UWG, Art. 21 Abs. 4 DSGVO - Arbeitsstand).
// Jeder Betreff traegt {vorgang}: die Suche im Gesendet-Ordner nach einem abgebrochenen Lauf findet eine Mail nur
// ueber den Betreff. Die KI formuliert keinen Text (Arbeitsregel 5).

var PLATZHALTER_ERLAUBT = ['kunde', 'anlage', 'faellig_monat', 'vorgang', 'firma', 'telefon', 'signatur', 'widerspruch'];

// Derselbe Wortlaut steht in widerspruch.js (dort wird er vor der Wortliste aus Antworten entfernt).
var WIDERSPRUCH_ABSATZ = 'Sie können der Verwendung Ihrer E-Mail-Adresse für Angebote dieser Art jederzeit widersprechen. Eine kurze Antwort auf diese Mail genügt; dafür entstehen Ihnen keine anderen als die Übermittlungskosten nach den Basistarifen.';

var TB_ARTEN = ['Angebot', 'Erinnerung'];
var TB_MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Übernommen aus Mahnlauf bau/kern/platzhalter.js (Commit 01c681b), unverändert: phTag formatiereDatum fuellePlatzhalter
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

function tbText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// "2026-10-20" -> "Oktober 2026"
function faelligMonat(iso) {
  phTag(iso);
  var t = String(iso).split('-');
  return TB_MONATE[+t[1] - 1] + ' ' + t[0];
}

// Blatt "Textbausteine" (Rohwerte, Kopfzeile zuerst) -> { ok, fehler: [Text] }
function pruefeTextbausteine(werte) {
  var w = werte || [];
  var kopf = (w[0] || []).map(tbText);
  var i = { art: kopf.indexOf('Art'), betreff: kopf.indexOf('Betreff'), text: kopf.indexOf('Text') };
  if (i.art < 0 || i.betreff < 0 || i.text < 0) return { ok: false, fehler: ['Blatt Textbausteine ohne Spalte Art, Betreff oder Text'] };
  var fehler = [];
  var anzahl = {};
  var betreffe = {};
  var probe = {};
  PLATZHALTER_ERLAUBT.forEach(function (p) { probe[p] = 'x'; });
  w.slice(1).forEach(function (z) {
    if (!z || z.every(function (v) { return tbText(v) === ''; })) return;
    var art = tbText(z[i.art]);
    var b = tbText(z[i.betreff]);
    var t = z[i.text] === undefined || z[i.text] === null ? '' : String(z[i.text]);
    if (TB_ARTEN.indexOf(art) < 0) { fehler.push('unbekannte Art ' + art); return; }
    anzahl[art] = (anzahl[art] || 0) + 1;
    if (!/\{\s*vorgang\s*\}/.test(b)) fehler.push(art + ' – Betreff ohne {vorgang}'); // Sicherung Betreff mit Vorgang
    var n = (t.match(/\{\s*widerspruch\s*\}/g) || []).length;
    if (n !== 1) fehler.push(art + ' – Text muss {widerspruch} genau einmal enthalten, gefunden ' + n); // Sicherung Widerspruch in der Vorlage
    [b, t].forEach(function (v) {
      var r = fuellePlatzhalter(v, probe);
      if (!r.ok) r.fehler.forEach(function (f) { fehler.push(art + ' – Platzhalter ' + f.platzhalter + ' ' + f.grund); });
    });
    var norm = b.replace(/\{\s*([^{}]*?)\s*\}/g, '{$1}');
    if (betreffe[norm] && betreffe[norm] !== art) fehler.push(betreffe[norm] + ' und ' + art + ' – gleicher Betreff');
    else betreffe[norm] = art;
  });
  TB_ARTEN.forEach(function (a) { if (anzahl[a] !== 1) fehler.push(a + ' – ' + (anzahl[a] || 0) + '-mal statt einmal'); });
  return { ok: fehler.length === 0, fehler: fehler };
}

// Letzte Pruefung vor dem Senden: der feste Hinweis steht wortgleich im Text.
function hinweisEnthalten(text) {
  return String(text == null ? '' : text).indexOf(WIDERSPRUCH_ABSATZ) >= 0; // Sicherung Hinweis-Pruefung
}

// art: 'Angebot' | 'Erinnerung'; werte: Platzhalterwerte ohne widerspruch; blatt: Rohwerte "Textbausteine"
// -> { ok, betreff, text } oder { ok: false, fehler: [Text] }
function baueMail(art, werte, blatt) {
  var p = pruefeTextbausteine(blatt);
  if (!p.ok) return { ok: false, fehler: p.fehler };
  var w = blatt || [];
  var kopf = (w[0] || []).map(tbText);
  var z = w.slice(1).filter(function (x) { return x && tbText(x[kopf.indexOf('Art')]) === art; })[0];
  if (!z) return { ok: false, fehler: ['Art unbekannt ' + art] };
  var v = {};
  Object.keys(werte || {}).forEach(function (k) { v[k] = werte[k]; });
  v.widerspruch = WIDERSPRUCH_ABSATZ; // Sicherung Hinweis vom Code
  var rb = fuellePlatzhalter(tbText(z[kopf.indexOf('Betreff')]), v);
  var rt = fuellePlatzhalter(String(z[kopf.indexOf('Text')]), v);
  if (!rb.ok || !rt.ok) {
    return { ok: false, fehler: (rb.fehler || []).concat(rt.fehler || []).map(function (f) { return f.platzhalter + ' ' + f.grund; }) };
  }
  if (!hinweisEnthalten(rt.text)) return { ok: false, fehler: ['Widerspruchshinweis fehlt im Text'] };
  return { ok: true, betreff: rb.text, text: rt.text };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PLATZHALTER_ERLAUBT, WIDERSPRUCH_ABSATZ, faelligMonat, pruefeTextbausteine, baueMail, hinweisEnthalten, formatiereDatum };
}
