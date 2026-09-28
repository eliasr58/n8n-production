// Bewertungsantworten, Kernlogik: Leitplanken am Text (BAUPLAN d S07, S08, S11; E15, E16; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. pruefeText laeuft am Entwurf UND am endgueltigen Text aus
// "Antwort" (auch vom Betrieb geaendert): harte Treffer blockieren immer, weiche verlangen "freigeben trotz Hinweis".
// wortlisteHeikel laeuft VOR der KI am Bewertungstext (S11): ein Treffer -> selbst lesen, kein KI-Aufruf - auch fuer
// Anweisungen an die KI im Text (M10, M13), damit deren Erkennung nicht am Modell haengt.
// Die Muster finden Formen, keine Bedeutungen (README): die Pruefung ersetzt das Lesen nicht.
// Die Kundenbeziehungs-Muster sind aus den Entwuerfen von Baustein 1 abgeleitet (Beleg Baustein 2, Begruendung dort):
// hart ist eine eigene Aussage des Betriebs zum Status der Person (Kunde ja/nein, Erfahrung mit uns, fuer Sie gearbeitet,
// Ihr Auftrag, beauftragt). Entscheidung Elias 27.09.2026 (Baustein 3): Saetze, die bestaetigen, dass der Betrieb fuer die
// Person gearbeitet hat ("dass Sie mit unserer Arbeit zufrieden sind", "bei Ihnen vor Ort" und Verwandte), sind WEICH -
// vorher erlaubt (Selbst entschieden Nr. 2 aus Baustein 2, damit geaendert).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var MK_MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var MK_IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;
var MK_TELEFON = /(?:\+\d{1,3}[ \t\-\/]*(?:\(0\)[ \t]*)?|\(0\d{1,5}\)[ \t\-\/]*|\b0\d{1,5}[ \t\-\/]*)\d(?:[ \t\-\/]?\d){4,}/g;
var MK_ANSCHRIFT = /\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer)\s+\d+(?:\s?[a-zA-Z]\b)?/g;
var MK_PLZ_ORT = /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)*/g;
var MK_ANREDE = /(^|[^\p{L}])(Herrn?|Frau|Hr\.|Fr\.)(\s+)((?:(?:Dr|Prof)\.\s+)*)(\p{Lu}[\p{L}\-]*(?:[ \t]+\p{Lu}[\p{L}\-]*){0,2})/gu;
var LP_URL = /(?:https?:\/\/|www\.)[^\s<>"')\]]+|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|eu|info|biz|example|io|at|ch)\b/gi;
var LP_PLATZHALTER = /<\s*(?:NAME|TELEFON|EMAIL|IBAN|ANSCHRIFT|PLZ_ORT)\s*>|\{[^{}\n]{0,40}\}/gi;
var LP_BETRAG = /\d[\d.,]*\s?(?:€|EUR\b|Euro\b)|€\s?\d/gi;
var LP_DATUM = /\b\d{1,2}\.\s?\d{1,2}\.(?:\d{2,4})?|\b\d{1,2}:\d{2}\b|\b(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/g;
var LP_ORT = /\b\d{5}\b|(?:^|[^\p{L}])\p{Lu}[\p{L}\-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer)(?=$|[^\p{L}])/gu;
var LP_VORGANG = /auftr[aä]g|rechnung|angebot|baustelle|bei ihnen|nicht zuordnen/gi;
var LP_WOCHENTAG = /\b(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b/;
var LP_TERMIN_BESTIMMT = /(?:^|[^\p{L}])(?:der|den|dem|des|ein|einen|einem|eines|ihr|ihren|ihrem|ihres|unser|unseren|unserem|unseres|diesen|diesem|dieses|dieser)\s+(?:\p{L}+\s+){0,2}([\p{L}\-]*termins?)(?=$|[^\p{L}])/giu;
var LP_VERTRAUEN = /\bIhr(?:em)?\s+Vertrauen\b/g;
// Weich (Entscheidung Elias 27.09.2026): Bestaetigung einer Leistung fuer die Person - Zufriedenheit mit Arbeit/Ergebnis, Lob
// fuer die Arbeit, "zu Ihrer Zufriedenheit", "bei Ihnen vor Ort", "unser Team bei Ihnen", "bei uns gut aufgehoben".
var LP_ANGEDEUTET = [
  /\bSie\b[^.!?]{0,60}\bzufrieden\b/,
  /\b(?:Lob|Anerkennung|Vertrauen|Feedback|Rückmeldung)\s+(?:für|zu[rm]?|in|über|an)\s+(?:(?:unsere[rnms]?|die|das|der|den|dem)\s+)?(?:\p{L}+\s+)?(?:Arbeit(?:en)?|Leistung|Ausführung|Ergebnis|Qualität|Team|Mannschaft|Service|Handwerk)(?=$|[^\p{L}])/u,
  /\bzu\s+Ihrer\s+(?:vollsten\s+)?Zufriedenheit\b/,
  /\b(?:bei|zu)\s+Ihnen\s+vor\s+Ort\b|\bvor\s+Ort\s+bei\s+Ihnen\b/,
  /\b(?:[Uu]nser(?:e|em|en)?\s+(?:Team|Mannschaft|Handwerker|Monteure|Mitarbeiter\w*)|die\s+Mannschaft|das\s+Team)\b[^.!?]{0,40}\b(?:bei\s+Ihnen|für\s+Sie)\b/,
  /\bbei\s+uns\b[^.!?]{0,30}\b(?:aufgehoben|betreut|beraten)\b/,
];
var LP_DE = /\b(?:und|der|die|das|wir|uns|ihnen|ihre?n?|für|nicht|mit|ist|sehr|vielen|dank|gern|freuen)\b/gi;
var LP_EN = /\b(?:the|and|we|you|your|our|for|thank|thanks|is|are|with|very|glad|appreciate)\b/gi;

// E16 (Cowork 27.09.2026): jede Aussage zur Kundenbeziehung, bestaetigend oder bestreitend, ist hart. Belegt aus Lauf 7123:
// M08 "nicht selbst Kunde bei uns", "keine (eigene) Erfahrung mit uns"; M02 "dass wir Ihnen eine gute Arbeit leisten konnten";
// M14 "Gelegenheit gegeben, Ihre Aufgabe ... umzusetzen", "Vertrauen, das Sie uns entgegengebracht haben".
var LP_KUNDENBEZIEHUNG = [
  /\b(?:Kund(?:e|in)|Kundschaft|Kundenbeziehung|Kundenverhältnis)\b/i,
  /Erfahrung(?:en)?\s+(?:mit|bei)\s+uns\b/i,
  /\b(?:nie|niemals)\s+(?:selbst\s+)?(?:bei|mit)\s+uns\b|\bnicht\s+(?:selbst\s+)?(?:bei|mit)\s+uns\s+(?:gewesen|war|waren|gearbeitet)\b/i,
  /\b(?:für|bei)\s+(?:Sie|Ihnen)\b[^.!?]{0,40}\b(?:gearbeitet|ausgeführt|erledigt|umgesetzt|erbracht|tätig|gebaut|gedeckt|saniert|montiert|repariert|eingebaut|geleistet)\b/,
  /\bIhnen\b[^.!?]{0,40}\b(?:leisten|erbringen|umsetzen|ausführen)\s+(?:konnten|durften|zu dürfen)\b/,
  /\bIhr(?:e|en|em|er|es)?\s+(?:Auftrag|Aufgabe|Projekt|Bauvorhaben|Baustelle|Dach\w*|Haus|Rechnung|Angebot|Termin\w*|Anfrage)\b/,
  /\bbeauftrag|\bAuftrag\s+(?:erteilt|gegeben|anvertraut)/i,
  /\bGelegenheit\s+gegeben\b/i,
  /Vertrauen[^.!?]{0,30}\b(?:entgegengebracht|geschenkt)\b/i,
];

// S11: Wortliste "heikel" VOR der KI (Muster der Wartungserinnerung, neu fuer Bewertungen) mit dem Grund aus dem KI-Schema.
var LP_HEIKEL = [
  ['rechtsdrohung', /\b(?:rechts)?anw(?:a|ä)lt(?:in|s|e|en|lich\w*)?\b/i],
  ['rechtsdrohung', /\b(?:ver)?klag(?:e|en|t|te|ten)?\b/i],
  ['rechtsdrohung', /\bgericht(?:e|s|en|lich\w*)?\b/i],
  ['rechtsdrohung', /\b(?:abmahn\w*|staatsanw(?:a|ä)lt\w*|polizei\w*|(?:straf)?anzeigen?|schadens?ersatz|schmerzensgeld)\b/i],
  ['verletzung_schaden', /\b(?:verletz\w*|unfall\w*|krankenhaus\w*|notaufnahme|arzt\w*|ärzt\w*)\b/i],
  ['daten_dritter', /\b(?:datenschutz\w*|dsgvo)\b/i],
  ['anweisung_im_text', /\b(?:ignorier\w*|ignore|anweisung\w*|systemhinweis\w*|systemprompt|system-?prompt|kategorie|assistent\w*|assistant|chatgpt|claude|sprachmodell)\b/i],
  ['anweisung_im_text', /\bregeln?\s+gelten\s+nicht\b|\bschreibe\s+(?:genau|folgend\w*|diesen|nur|jetzt)\b/i],
  ['anweisung_im_text', /\bordne\b[^.!?]{0,40}\bals\s+(?:positiv|neutral|kritisch)\b|\bsetze\b[^.!?]{0,30}\b(?:auf|als)\s+(?:positiv|true)\b/i],
];

function anredeNamen(text) {
  var aus = [];
  String(text == null ? '' : text).replace(MK_ANREDE, function (ganz, vor, anrede, zw, titel, namen) {
    namen.split(/[ \t]+/).forEach(function (n) { if (n && aus.indexOf(n) < 0) aus.push(n); });
    return ganz;
  });
  return aus;
}

function betriebsWoerter(erlaubt) {
  return String(erlaubt == null ? '' : erlaubt).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function lpZiffern(s) {
  return String(s).replace(/\D/g, '');
}

function lpWort(wort, s) {
  var e = wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\p{L}\\p{N}_])' + e + '(?=$|[^\\p{L}\\p{N}_])', 'iu').test(s);
}

// Deutsch oder nicht (Heuristik ueber haeufige Woerter): mehr englische als deutsche Signalwoerter -> nicht deutsch.
function lpNichtDeutsch(s) {
  var de = (String(s).match(LP_DE) || []).length;
  var en = (String(s).match(LP_EN) || []).length;
  return { nicht: en > de, de: de, en: en };
}

// E15: fremdsprachige Bewertung -> weicher Hinweis "Bewertung nicht deutsch" (die Antwort bleibt deutsch).
function bewertungNichtDeutsch(text) {
  var t = String(text == null ? '' : text).trim();
  return t !== '' && lpNichtDeutsch(t).nicht;
}

// S11 -> [{ wort, grund }] (leer = kein Treffer).
function wortlisteHeikel(text) {
  var t = String(text == null ? '' : text);
  var aus = [];
  LP_HEIKEL.forEach(function (w) {
    var m = t.match(w[1]);
    if (m) aus.push({ wort: m[0], grund: w[0] });
  });
  return aus;
}

// ctx = { anzeigename, bewertungstext, betrieb: { name, signatur, kontaktweg, domain }, hoechstlaenge, verboten: [] }
// -> { hart: ['Klasse Detail'], weich: ['Klasse Detail'] }
function pruefeText(text, ctx) {
  var e = String(text == null ? '' : text);
  var c = ctx || {};
  var b = c.betrieb || {};
  var erlaubt = [b.name, b.signatur, b.kontaktweg].join(' ');
  var hart = [];
  var weich = [];
  if (!e.trim()) return { hart: ['leer'], weich: [] }; // Sicherung leerer Text
  (e.match(MK_MAIL) || []).forEach(function (m) { if (erlaubt.indexOf(m) < 0) hart.push('Mail ' + m); }); // Sicherung Mail
  (e.match(MK_TELEFON) || []).forEach(function (m) {
    if (lpZiffern(erlaubt).indexOf(lpZiffern(m)) < 0) hart.push('Telefon …' + lpZiffern(m).slice(-4)); // Sicherung Telefon
  });
  (e.match(LP_URL) || []).forEach(function (m) {
    var host = m.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0].replace(/[.,;:!?]+$/, '');
    var d = String(b.domain || '').toLowerCase();
    if (!d || (host !== d && host.slice(-(d.length + 1)) !== '.' + d)) hart.push('URL ' + host); // Sicherung URL
  });
  (e.match(MK_IBAN) || []).forEach(function () { hart.push('IBAN'); }); // Sicherung IBAN
  var frei = betriebsWoerter(erlaubt);
  var namen = String(c.anzeigename || '').split(/[^\p{L}\-]+/u).concat(anredeNamen(c.bewertungstext)).filter(function (n, i, a) {
    return n.replace(/-/g, '').length >= 3 && frei.indexOf(n.toLowerCase()) < 0 && a.indexOf(n) === i;
  });
  namen.forEach(function (n) { if (lpWort(n, e)) hart.push('Name ' + n); }); // Sicherung Name
  (e.match(LP_PLATZHALTER) || []).forEach(function (m) { hart.push('Platzhalter ' + m); }); // Sicherung Platzhalter
  (c.verboten || []).forEach(function (w) {
    if (String(w).trim() && e.toLowerCase().indexOf(String(w).trim().toLowerCase()) >= 0) hart.push('verbotener Begriff ' + String(w).trim()); // Sicherung verbotene Begriffe
  });
  var zeichen = Array.from(e).length;
  var grenze = Number(c.hoechstlaenge) > 0 ? Number(c.hoechstlaenge) : 800;
  if (zeichen > grenze) hart.push('Länge ' + zeichen + ' Zeichen'); // Sicherung Laenge Zeichen
  else if (lpBytes(e) > 4096) hart.push('Länge > 4096 Byte'); // Sicherung Laenge Byte
  LP_KUNDENBEZIEHUNG.forEach(function (re) {
    var m = e.match(re);
    if (m) hart.push('Kundenbeziehung „' + m[0] + '“'); // Sicherung Kundenbeziehung
  });
  (e.match(LP_BETRAG) || []).forEach(function (m) { weich.push('Betrag ' + m.trim()); });
  (e.match(LP_DATUM) || []).forEach(function (m) { weich.push('Datum/Zeit ' + m); });
  (e.match(LP_ORT) || []).forEach(function (m) { weich.push('Ort ' + m.replace(/^[^\p{L}\d]+/u, '')); });
  (e.match(LP_VORGANG) || []).forEach(function (m) { weich.push('Vorgang ' + m); });
  lpTermin(e).forEach(function (m) { weich.push(m); });
  (e.match(LP_VERTRAUEN) || []).forEach(function (m) { weich.push('Kundenbeziehung angedeutet (' + m + ')'); });
  LP_ANGEDEUTET.forEach(function (re) {
    var m = e.match(re);
    if (m) weich.push('Kundenbeziehung angedeutet (' + m[0].trim() + ')'); // Sicherung Leistung bestaetigt weich
  });
  var sp = lpNichtDeutsch(e);
  if (sp.nicht) weich.push('nicht deutsch (de ' + sp.de + ', en ' + sp.en + ')');
  return { hart: hart, weich: weich };
}

function lpBytes(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}

// "Termin" (Baustein 2, Befund 5 aus Baustein 1): Zusammensetzungen ("Terminverschiebung", "Termintreue") und die Mehrzahl
// ("mit den Terminen") nennen keinen bestimmten Termin - kein Treffer. Weich ist ein bestimmter Termin ("den Termin", "des
// Starttermins") und jeder Satz, der ein Termin-Wort UND eine Angabe traegt (Datum, Uhrzeit, Wochentag, Zahl).
// "Ihr(en) Termin" ist hart (Kundenbeziehung).
function lpTermin(e) {
  var aus = [];
  var m;
  LP_TERMIN_BESTIMMT.lastIndex = 0;
  while ((m = LP_TERMIN_BESTIMMT.exec(e)) !== null) aus.push('Termin bestimmter Termin (' + m[1] + ')'); // Sicherung Termin bestimmt
  e.split(/[.!?](?=\s|$)/).forEach(function (satz) {
    if (/termin/i.test(satz) && (LP_WOCHENTAG.test(satz) || /\d/.test(satz))) aus.push('Termin mit Angabe'); // Sicherung Termin mit Angabe
  });
  return aus;
}

function lpKlasse(d) {
  if (/^nicht deutsch/.test(d)) return 'Antwort nicht deutsch';
  if (/^Kundenbeziehung angedeutet/.test(d)) return 'Kundenbeziehung angedeutet';
  if (/^verbotener Begriff/.test(d)) return 'verbotener Begriff';
  return d.split(' ')[0];
}

// Hinweise fuer das Blatt und die Sammelmeldung: nur Klassen ("hart: Name", "weich: Termin"), nie ein Zitat, ein Name oder eine
// Nummer (BAUPLAN b "Hinweise"). Die Einzelheiten aus pruefeText bleiben im Lauf.
function hinweiseFuerBlatt(r) {
  var aus = [];
  [['hart', (r && r.hart) || []], ['weich', (r && r.weich) || []]].forEach(function (x) {
    x[1].forEach(function (d) {
      var h = x[0] + ': ' + lpKlasse(String(d)); // Sicherung Hinweise ohne Zitat
      if (aus.indexOf(h) < 0) aus.push(h);
    });
  });
  return aus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeText, wortlisteHeikel, bewertungNichtDeutsch, hinweiseFuerBlatt };
}
