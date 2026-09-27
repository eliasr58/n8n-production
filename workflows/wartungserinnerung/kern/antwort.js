// Wartungserinnerung, Kernlogik: Antworten im Gmail-Thread erkennen und fuer die Einordnung kuerzen
// (BAUPLAN c 3-4, e Datensparsamkeit; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar: kein Buffer, kein TextDecoder (base64url und die
// Zeichensaetze UTF-8 und windows-1252/ISO-8859-1 selbst). Eingabe ist die Antwort von Gmail threads.get format=full.
// Gemessen in Baustein 1 (Lauf 6602): eigene Mail traegt das Label SENT, eine Antwort nicht; die Reihenfolge im Thread
// folgt NICHT internalDate - deshalb wird hier nach internalDate sortiert.
// An Claude geht nur fuerKi(): ohne Zitat, ohne Signatur und Grussblock, Kontaktangaben maskiert, hoechstens 2000
// Zeichen. Die Trennung ist eine Heuristik und kann versagen (README). Die Wortliste bekommt textFuerWortliste():
// ohne Zitat (sonst loeste der zitierte eigene Widerspruchshinweis aus), aber MIT Signaturbereich - ein
// Widerspruch nach dem Gruss zaehlt.

var AW_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
var AW_CP1252 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352,
  139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
  153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
var AW_ENTITAETEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', ndash: '–', mdash: '—', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”' };
var AW_GRUSS = /^(?:mit\s+)?(?:(?:freundlichen|besten|vielen|lieben|herzlichen|sonnigen|schönen|schoenen)\s+)?gr(?:ü|ue)(?:ß|ss)(?:en|e)?\b|^(?:viele|beste|liebe|freundliche|herzliche)\s+gr(?:ü|ue)|^gru(?:ß|ss)\b|^(?:mfg|lg|vg)\b|^(?:best|kind|warm)\s+regards\b|^regards\b/i;
var AW_ANREDE = /^gr(?:ü|ue)(?:ß|ss)\s+gott\b/i;

function awBytes(s) {
  var t = String(s == null ? '' : s).replace(/\+/g, '-').replace(/\//g, '_');
  var aus = [];
  var puffer = 0;
  var bits = 0;
  for (var i = 0; i < t.length; i++) {
    var v = AW_B64.indexOf(t[i]);
    if (v < 0) continue;
    puffer = (puffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      aus.push((puffer >> bits) & 255);
      puffer &= (1 << bits) - 1;
    }
  }
  return aus;
}

function awUtf8(b) {
  var s = '';
  var i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c >= 0xc0 && c < 0xe0 && i < b.length) s += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    else if (c >= 0xe0 && c < 0xf0 && i + 1 < b.length) s += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
    else if (c >= 0xf0 && i + 2 < b.length) {
      var cp = (((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63)) - 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    } else s += '�';
  }
  return s;
}

// ISO-8859-1 wird wie windows-1252 gelesen (Outlook deklariert oft das eine und schreibt das andere).
function awCp1252(b) {
  return b.map(function (c) { return String.fromCharCode(AW_CP1252[c] || c); }).join('');
}

// base64url-Daten eines Teils -> Text im angegebenen Zeichensatz (leer/unbekannt: UTF-8).
function dekodiere(daten, zeichensatz) {
  var b = awBytes(daten);
  var z = String(zeichensatz || '').toLowerCase().replace(/["\s]/g, '');
  if (/^(?:iso-?8859-1|iso-?8859-15|latin-?1|windows-1252|cp1252|us-ascii|ascii)$/.test(z)) return awCp1252(b);
  return awUtf8(b);
}

function awKopfListe(headers, name) {
  var h = (headers || []).filter(function (x) { return x && String(x.name).toLowerCase() === name.toLowerCase(); })[0];
  return h ? String(h.value) : '';
}

function awKopf(msg, name) {
  return awKopfListe(msg && msg.payload && msg.payload.headers, name);
}

function awSuche(p, typ) {
  if (!p) return null;
  if (String(p.mimeType).toLowerCase() === typ && p.body && p.body.data && !p.filename) return p;
  var t = p.parts || [];
  for (var i = 0; i < t.length; i++) {
    var r = awSuche(t[i], typ);
    if (r) return r;
  }
  return null;
}

function awTeilText(p) {
  var m = /charset\s*=\s*"?([^";\s]+)/i.exec(awKopfListe(p.headers, 'Content-Type'));
  return dekodiere(p.body.data, m ? m[1] : '').replace(/\r\n?/g, '\n');
}

function awEntitaeten(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (ganz, e) {
    if (e[0] === '#') {
      var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ganz;
    }
    return Object.prototype.hasOwnProperty.call(AW_ENTITAETEN, e) ? AW_ENTITAETEN[e] : ganz;
  });
}

// HTML -> Text: Zitate (Gmail, Outlook, blockquote) weg, Bloecke werden Zeilen, leere Zeilen zusammengezogen.
function htmlZuText(html) {
  var s = String(html == null ? '' : html);
  s = s.replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<div\b[^>]*class="[^"]*gmail_quote[^"]*"[\s\S]*$/i, '');
  s = s.replace(/<div\b[^>]*id="(?:divRplyFwdMsg|appendonsend)"[\s\S]*$/i, '');
  var vorher;
  do {
    vorher = s;
    s = s.replace(/<blockquote\b[^>]*>(?:(?!<blockquote\b)[\s\S])*?<\/blockquote\s*>/i, '\n');
  } while (s !== vorher);
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(?:p|div|li|tr|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '');
  s = awEntitaeten(s);
  return s.split('\n').map(function (z) { return z.trim(); }).filter(function (z) { return z !== ''; }).join('\n');
}

// Gmail-Nachricht -> { text, quelle: 'plain' | 'html' | null }; text/plain hat Vorrang.
function textAusNachricht(msg) {
  var p = msg && msg.payload;
  var plain = awSuche(p, 'text/plain');
  if (plain) return { text: awTeilText(plain), quelle: 'plain' };
  var html = awSuche(p, 'text/html');
  if (html) return { text: htmlZuText(awTeilText(html)), quelle: 'html' };
  return { text: '', quelle: null };
}

function awFolgt(z, i, re) {
  for (var k = i + 1; k <= i + 3 && k < z.length; k++) if (re.test(z[k].trim())) return true;
  return false;
}

// Schneidet ab dem ersten Zitatkopf ab und entfernt jede Zeile, die mit ">" beginnt.
function ohneZitat(text) {
  var z = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  var ende = z.length;
  for (var i = 0; i < z.length; i++) {
    var l = z[i].trim();
    var n = (z[i + 1] || '').trim();
    if (/^Am\s.+\bschrieb\b.*:$/.test(l) || (/^Am\s.+\bschrieb\b/.test(l) && /:$/.test(n) && /[@<>]/.test(n))
      || /^On\s.+\bwrote:$/.test(l) || (/^On\s.+/.test(l) && /\bwrote:$/.test(n))
      || /^-{3,}\s*(?:Ursprüngliche Nachricht|Original Message|Weitergeleitete Nachricht|Forwarded message)\s*-{3,}/i.test(l)
      || (/^_{10,}$/.test(l) && /^(?:Von|From):/.test(n))
      || (/^(?:Von|From):\s/.test(l) && awFolgt(z, i, /^(?:Gesendet|Sent|Datum|Date):\s/))) {
      ende = i;
      break;
    }
  }
  return z.slice(0, ende).filter(function (x) { return !/^\s*>/.test(x); }).join('\n').replace(/\s+$/, '');
}

// Signatur ab "-- "; sonst ab dem letzten Schlussgruss, wenn danach hoechstens zehn Zeilen folgen und er nicht in der
// ersten Zeile steht. "Grüß Gott" ist eine Anrede, kein Schlussgruss.
function ohneSignatur(text) {
  var z = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  for (var i = 0; i < z.length; i++) {
    if (z[i] === '-- ' || z[i] === '--') { z = z.slice(0, i); break; }
  }
  for (var k = z.length - 1; k > 0; k--) {
    var l = z[k].trim();
    if (AW_GRUSS.test(l) && !AW_ANREDE.test(l)) {
      if (z.slice(k + 1).filter(function (x) { return x.trim() !== ''; }).length <= 10) z = z.slice(0, k);
      break;
    }
  }
  return z.join('\n').replace(/\s+$/, '');
}

// Kontaktangaben -> Platzhalter. Reihenfolge: Mail, IBAN, Telefon, Anschrift, PLZ/Ort.
function maskiereKontakt(text) {
  var s = String(text == null ? '' : text);
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<EMAIL>');
  s = s.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, '<IBAN>');
  s = s.replace(/(?:\+\d{1,3}[ \t\-\/]*(?:\(0\)[ \t]*)?|\(0\d{1,5}\)[ \t\-\/]*|\b0\d{1,5}[ \t\-\/]*)\d(?:[ \t\-\/]?\d){4,}/g, '<TELEFON>');
  s = s.replace(/\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer)\s+\d+\s?[a-zA-Z]?\b/g, '<ANSCHRIFT>');
  s = s.replace(/\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+)*/g, '<PLZ_ORT>');
  return s;
}

// Text fuer Claude -> { text, gekuerzt }. Ist er leer, ordnet der Workflow nicht ein (wie eine fehlende KI-Antwort).
function fuerKi(text) {
  var t = String(text == null ? '' : text);
  t = ohneZitat(t); // Sicherung Datensparsamkeit Zitat
  t = ohneSignatur(t); // Sicherung Datensparsamkeit Signatur
  t = maskiereKontakt(t); // Sicherung Datensparsamkeit Kontakt
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > 2000) return { text: t.slice(0, 2000), gekuerzt: true };
  return { text: t, gekuerzt: false };
}

function textFuerWortliste(text) {
  return ohneZitat(text);
}

// Unzustellbar wird vor Abwesenheit geprueft (gemessene Koepfe: beide koennen Auto-Submitted tragen).
function artDerNachricht(msg) {
  var von = awKopf(msg, 'From').toLowerCase();
  var typ = String((msg && msg.payload && msg.payload.mimeType) || '').toLowerCase();
  if (/mailer-daemon|postmaster/.test(von) || typ === 'multipart/report'
    || /report-type=delivery-status/.test(awKopf(msg, 'Content-Type').toLowerCase())) return 'unzustellbar';
  var auto = awKopf(msg, 'Auto-Submitted').trim().toLowerCase();
  if ((auto && auto !== 'no') || awKopf(msg, 'X-Autoreply') || /auto[_-]reply/.test(awKopf(msg, 'Precedence').toLowerCase())
    || /^(?:automatische antwort|abwesenheit|out of office|autoreply|auto-reply)/i.test(awKopf(msg, 'Subject'))) return 'abwesenheit';
  return 'antwort';
}

// thread (threads.get) -> { erste_eigene_ms, antworten: [{ id, internalDate, art }] } nach internalDate aufsteigend.
// abMs (Teil B, 27.09.2026): Untergrenze fuer einen Thread OHNE eigene Mail, den die Vorgangssuche gefunden hat (Abmeldung per
// Klick, neue Mail mit dem Vorgang im Betreff) - die erste eigene Mail des gespeicherten Threads. Ohne abMs wie bisher: nichts.
function antwortenImThread(thread, abMs) {
  var ms = (thread && thread.messages) || [];
  var lab = function (m) { return (m && m.labelIds) || []; };
  var eigene = ms.filter(function (m) { return lab(m).indexOf('SENT') >= 0 && lab(m).indexOf('DRAFT') < 0; })
    .map(function (m) { return Number(m.internalDate); });
  var erste;
  if (eigene.length) erste = Math.min.apply(null, eigene);
  else if (typeof abMs === 'number' && isFinite(abMs)) erste = abMs; // Sicherung Untergrenze Nebenthread
  else return { erste_eigene_ms: null, antworten: [] };
  var antworten = ms.filter(function (m) {
    if (lab(m).indexOf('SENT') >= 0) return false; // Sicherung eigene Mail ausgenommen
    return lab(m).indexOf('DRAFT') < 0 && Number(m.internalDate) > erste;
  }).map(function (m) { return { id: m.id, internalDate: Number(m.internalDate), art: artDerNachricht(m) }; })
    .sort(function (a, b) { return a.internalDate - b.internalDate; }); // Sicherung Reihenfolge internalDate
  return { erste_eigene_ms: erste, antworten: antworten };
}

// Betreff einer Gmail-Nachricht (Teil B: die Wortliste prueft auch ihn - "Abmelden <Vorgang>" aus List-Unsubscribe).
function betreffDerNachricht(msg) {
  return awKopf(msg, 'Subject');
}

// Antworten eines Threads nach der Einordnung (je { gmail_id, internalDate, datum, art, klasse, eingeordnet, gesperrt })
// -> Stand der Anlage fuer planeLauf, oder null. Vorrang: Antwort vor Unzustellbar vor Abwesenheit; innerhalb der Art
// zaehlt die neueste nach internalDate - die Eingabe kommt in beliebiger Reihenfolge (Befund Baustein 1). Eine nicht
// eingeordnete oder gesperrte Antwort gilt fuer die ganze Anlage.
function antwortStand(liste) {
  var l = (liste || []).filter(function (x) { return x && x.art; }).slice()
    .sort(function (a, b) { return Number(a.internalDate) - Number(b.internalDate); }); // Sicherung Reihenfolge Antwortstand
  var art = ['antwort', 'unzustellbar', 'abwesenheit'].filter(function (t) {
    return l.some(function (x) { return x.art === t; });
  })[0];
  if (!art) return null;
  var neueste = l.filter(function (x) { return x.art === art; }).pop();
  var antw = l.filter(function (x) { return x.art === 'antwort'; });
  return { art: art, klasse: neueste.klasse || '', datum: neueste.datum || '',
    eingeordnet: antw.every(function (x) { return x.eingeordnet === true; }),
    gesperrt: antw.some(function (x) { return x.gesperrt === true; }), anzahl: l.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dekodiere, textAusNachricht, htmlZuText, ohneZitat, ohneSignatur, maskiereKontakt, fuerKi, textFuerWortliste,
    artDerNachricht, antwortenImThread, antwortStand, betreffDerNachricht,
  };
}
