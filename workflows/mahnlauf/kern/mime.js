// Mahnlauf, Kernlogik: Kundenmail als RFC-5322/MIME-Nachricht (Nachbau Teil B 1 und B 6, 25.09.2026).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Direkter Versand (messages.send) und Entwurf
// (drafts.create) bekommen DIESELBE Nachricht - damit ist der Absender auf beiden Wegen gleich. Gemessen
// (Lauf 5939): Der Gmail-Knoten 2.2 setzt beim Senden "Name <Adresse>" ohne Anfuehrungszeichen, und der
// Zusatz "(Test)" ging als Kommentar verloren; ein Entwurf des Gmail-Knotens traegt gar keinen Namen, Gmail
// setzt dann den Namen des Kontoinhabers ein.
//
// Regeln: Anzeigename in ASCII -> quoted-string ("..." mit \" und \\); sonst RFC 2047, UTF-8, B-Kodierung,
// jedes Wort hoechstens 75 Zeichen. Betreff genauso (ASCII bleibt unveraendert). Text als text/plain UTF-8
// in base64 mit CRLF. Anhang als eigener Teil von multipart/mixed. Die fertige Nachricht ist reines ASCII.
// Ein Zeilenumbruch in Name oder Betreff wirft (Kopfinjektion), ebenso ein ungueltiger Empfaenger.

var MI_GRENZE = '=_Mahnlauf_Teil_=';   // "=_" kommt in base64 nie vor
var MI_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function miText(v) {
  return v === undefined || v === null ? '' : String(v);
}

function miUtf8(s) {
  var aus = [];
  var t = miText(s);
  for (var i = 0; i < t.length; i++) {
    var c = t.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) aus.push(c);
    else if (c < 0x800) aus.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) aus.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else aus.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return aus;
}

function miBase64(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i];
    var b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var n = (a << 16) | (b << 8) | c;
    s += MI_B64[(n >> 18) & 63] + MI_B64[(n >> 12) & 63] + (i + 1 < bytes.length ? MI_B64[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? MI_B64[n & 63] : '=');
  }
  return s;
}

function miZeilen(b64) {
  var z = [];
  for (var i = 0; i < b64.length; i += 76) z.push(b64.slice(i, i + 76));
  return z.join('\r\n');
}

function miAscii(s) {
  return /^[\x20-\x7e]*$/.test(s);
}

function miOhneUmbruch(s, was) {
  if (/[\r\n]/.test(miText(s))) throw new Error('Mail - Zeilenumbruch in ' + was);
  return miText(s);
}

// Text -> RFC-2047-Woerter (UTF-8, B), je Wort hoechstens 45 Byte = 60 base64-Zeichen = 72 Zeichen gesamt.
// Geteilt wird nur zwischen ganzen Zeichen.
function miWoerter(s) {
  var woerter = [];
  var stueck = [];
  var t = miText(s);
  for (var i = 0; i < t.length; i++) {
    var c = t.codePointAt(i);
    var z = String.fromCodePoint(c);
    if (c > 0xffff) i++;
    var b = miUtf8(z);
    if (stueck.length + b.length > 45) {
      woerter.push('=?UTF-8?B?' + miBase64(stueck) + '?=');
      stueck = [];
    }
    stueck = stueck.concat(b);
  }
  if (stueck.length) woerter.push('=?UTF-8?B?' + miBase64(stueck) + '?=');
  return woerter;
}

function mimeAdresse(name, adresse) {
  var n = miOhneUmbruch(name, 'Absendername').trim();
  var a = miText(adresse).trim();
  if (!n) return a;
  if (miAscii(n)) return '"' + n.replace(/[\\"]/g, '\\$&') + '" <' + a + '>';
  return miWoerter(n).join('\r\n ') + ' <' + a + '>';
}

function mimeBetreff(s) {
  var t = miOhneUmbruch(s, 'Betreff');
  return miAscii(t) ? t : miWoerter(t).join('\r\n ');
}

function miMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(miText(s).trim());
}

// Rechnungsnummer -> Dateiname des Anhangs, nur [A-Za-z0-9._-].
function mimeDateiname(rechnungsnr) {
  var s = miText(rechnungsnr).trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return (s || 'Rechnung') + '.pdf';
}

// m = { von_name, von_adresse, an, antwort_an, betreff, text, anhaenge: [{ name, typ, base64 }] } -> Nachricht (CRLF)
function baueMime(m) {
  if (!miMailOk(m.von_adresse)) throw new Error('Mail - Absenderadresse ungültig');
  if (!miMailOk(m.an)) throw new Error('Mail - Empfänger ungültig');
  var kopf = ['From: ' + mimeAdresse(m.von_name, m.von_adresse), 'To: ' + miText(m.an).trim()];
  if (miText(m.antwort_an).trim()) {
    if (!miMailOk(m.antwort_an)) throw new Error('Mail - Antwort-an ungültig');
    kopf.push('Reply-To: ' + miText(m.antwort_an).trim());
  }
  kopf.push('Subject: ' + mimeBetreff(m.betreff), 'MIME-Version: 1.0');
  var text = miZeilen(miBase64(miUtf8(miText(m.text).replace(/\r?\n/g, '\r\n'))));
  var anh = m.anhaenge || [];
  if (!anh.length) {
    return kopf.concat(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', text, '']).join('\r\n');
  }
  var z = kopf.concat(['Content-Type: multipart/mixed; boundary="' + MI_GRENZE + '"', '', '--' + MI_GRENZE,
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', text]);
  anh.forEach(function (a) {
    var name = miOhneUmbruch(a.name, 'Dateiname').replace(/["\\]/g, '_');
    if (!miAscii(name) || !name) throw new Error('Mail - Dateiname nicht ASCII');
    z.push('--' + MI_GRENZE, 'Content-Type: ' + miText(a.typ || 'application/octet-stream') + '; name="' + name + '"',
      'Content-Disposition: attachment; filename="' + name + '"', 'Content-Transfer-Encoding: base64', '',
      miZeilen(miText(a.base64).replace(/[^A-Za-z0-9+/=]/g, '')));
  });
  z.push('--' + MI_GRENZE + '--', '');
  return z.join('\r\n');
}

// Nachricht -> Feld "raw" der Gmail-API (base64url ohne Auffuellung).
function mimeRaw(nachricht) {
  var s = miText(nachricht);
  if (!/^[\x00-\x7f]*$/.test(s)) throw new Error('Mail - Nachricht nicht ASCII');
  var b = [];
  for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i));
  return miBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mimeAdresse, mimeBetreff, mimeDateiname, baueMime, mimeRaw };
}
