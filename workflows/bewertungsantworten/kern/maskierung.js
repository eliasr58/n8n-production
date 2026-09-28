// Bewertungsantworten, Kernlogik: Text fuer Claude maskieren und kuerzen (BAUPLAN d S09; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. maskiereKontakt kommt aus der Wartungserinnerung
// bau/kern/antwort.js (angepasst, siehe dort); dieselben Muster speisen die Leitplanken (S07/S08).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Gemeinsame Muster (S09 Maskierung, S07/S08 Leitplanken): dieselben Zeilen stehen in leitplanken.js, herkunft.py verlangt sie
// byte-gleich. Mit /g nur ueber replace und match benutzen (beide setzen lastIndex zurueck), nie ueber test oder exec.
var MK_MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var MK_IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;
var MK_TELEFON = /(?:\+\d{1,3}[ \t\-\/]*(?:\(0\)[ \t]*)?|\(0\d{1,5}\)[ \t\-\/]*|\b0\d{1,5}[ \t\-\/]*)\d(?:[ \t\-\/]?\d){4,}/g;
var MK_ANSCHRIFT = /\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer)\s+\d+(?:\s?[a-zA-Z]\b)?/g;
var MK_PLZ_ORT = /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)*/g;
var MK_ANREDE = /(^|[^\p{L}])(Herrn?|Frau|Hr\.|Fr\.)(\s+)((?:(?:Dr|Prof)\.\s+)*)(\p{Lu}[\p{L}\-]*(?:[ \t]+\p{Lu}[\p{L}\-]*){0,2})/gu;

// Nach Wartungserinnerung bau/kern/antwort.js maskiereKontakt (Commit 391232c); angepasst 27.09.2026: die Muster stehen als
// gemeinsame Variablen oben, und die Anschrift nimmt das folgende Leerzeichen nicht mehr mit (Befund 8 aus Baustein 1:
// "am Musterweg 1 war" wurde "am <ANSCHRIFT>war"). Kontakt -> Platzhalter, Reihenfolge Mail, IBAN, Telefon, Anschrift, PLZ/Ort.
function maskiereKontakt(text) {
  var s = String(text == null ? '' : text);
  s = s.replace(MK_MAIL, '<EMAIL>');
  s = s.replace(MK_IBAN, '<IBAN>');
  s = s.replace(MK_TELEFON, '<TELEFON>');
  s = s.replace(MK_ANSCHRIFT, '<ANSCHRIFT>'); // Sicherung Anschrift ohne folgendes Leerzeichen
  s = s.replace(MK_PLZ_ORT, '<PLZ_ORT>');
  return s;
}

// Namen nach der Anrede (Herr, Herrn, Frau, Hr., Fr.; Titel Dr./Prof. bleiben stehen), bis zu drei grossgeschriebene Woerter.
function anredeNamen(text) {
  var aus = [];
  String(text == null ? '' : text).replace(MK_ANREDE, function (ganz, vor, anrede, zw, titel, namen) {
    namen.split(/[ \t]+/).forEach(function (n) { if (n && aus.indexOf(n) < 0) aus.push(n); });
    return ganz;
  });
  return aus;
}

// Woerter des Betriebs (Name, Signatur, Kontaktweg) klein - sie sind nie ein Name (bestaetigt 27.09.2026, Befund 8).
function betriebsWoerter(erlaubt) {
  return String(erlaubt == null ? '' : erlaubt).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// S09 Namen -> <NAME>: jeder Teil des Anzeigenamens ab drei Buchstaben als ganzes Wort, ausser Woertern des Betriebs, und die
// Namen nach der Anrede (mehrteilig, Befund 8: "Frau Petra Musterfrau" wurde "Frau <NAME> Musterfrau").
function maskiereNamen(text, anzeigename, erlaubt) {
  var s = String(text == null ? '' : text);
  var frei = betriebsWoerter(erlaubt);
  String(anzeigename || '').split(/[^\p{L}\-]+/u).filter(function (t) {
    return t.replace(/-/g, '').length >= 3 && frei.indexOf(t.toLowerCase()) < 0;
  }).forEach(function (t) {
    var e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp('(^|[^\\p{L}\\p{N}_])' + e + '(?=$|[^\\p{L}\\p{N}_])', 'giu'), '$1<NAME>');
  });
  s = s.replace(MK_ANREDE, function (ganz, vor, anrede, zw, titel) { return vor + anrede + zw + titel + '<NAME>'; }); // Sicherung Namen nach der Anrede
  return s;
}

// S09 Text fuer Claude -> { text, gekuerzt }: Namen, Kontakt, hoechstens 2000 Zeichen. Nach dem Muster von fuerKi der
// Wartungserinnerung (antwort.js, Commit 391232c), ohne Zitat- und Signaturschnitt (eine Bewertung ist keine Mail).
function fuerKi(text, anzeigename, erlaubt) {
  var t = maskiereNamen(text, anzeigename, erlaubt); // Sicherung Datensparsamkeit Namen
  t = maskiereKontakt(t); // Sicherung Datensparsamkeit Kontakt
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > 2000) return { text: t.slice(0, 2000), gekuerzt: true }; // Sicherung Kuerzung 2000
  return { text: t, gekuerzt: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { maskiereKontakt, maskiereNamen, anredeNamen, betriebsWoerter, fuerKi };
}
