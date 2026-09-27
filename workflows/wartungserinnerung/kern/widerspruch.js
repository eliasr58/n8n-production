// Wartungserinnerung, Kernlogik: Widerspruch erkennen und Antworten einordnen (BAUPLAN c 4, d, e; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Reihenfolge: zuerst die Wortliste, OHNE KI - so haengt die
// Sperre nicht an der Erreichbarkeit der API. Nur ohne Treffer fragt der Workflow Claude (kiAnfrage; Antwortform mit
// Structured Outputs gemessen in Baustein 1, Lauf 6600). Im Zweifel am Widerspruch wird gesperrt: fehlende oder
// ungueltige Einordnung und jeder Widerspruchsverdacht; unsicher nur zwischen den anderen Klassen wird zurueckgestellt. Die KI-Antwort ist ein Schema aus drei Feldern und erreicht nie
// einen Mailtext. Der Text, der hier ankommt, ist schon gekuerzt und maskiert (antwort.js).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Derselbe Wortlaut steht in textbausteine.js (dort setzt ihn der Code in jede Mail). Arbeitsstand, keine Rechtsberatung.
var WIDERSPRUCH_ABSATZ = 'Sie können der Verwendung Ihrer E-Mail-Adresse für Angebote dieser Art jederzeit widersprechen. Eine kurze Antwort auf diese Mail genügt; dafür entstehen Ihnen keine anderen als die Übermittlungskosten nach den Basistarifen.';

var WI_MUSTER = [
  ['widersprechen', /widerspr/],
  ['keine Werbung/Mails', /keine\s+(?:weitere[nr]?\s+)?(?:werbung|werbemails?|e-?mails?|mails?|nachrichten|angebote|zusendungen)\b/],
  ['abmelden', /\b(?:abmelden|abbestellen|austragen|unsubscribe)\b|melden\s+sie\s+mich\s+(?:bitte\s+)?ab\b|tragen\s+sie\s+mich\s+(?:bitte\s+)?aus\b/],
  ['nicht mehr schreiben', /nicht\s+mehr\s+(?:an)?(?:schreiben|kontaktieren|mailen|zuschicken|schicken)\b/],
  ['nicht mehr kontaktieren', /(?:kontaktieren|anschreiben|schreiben|mailen)\s+sie\s+(?:mich|mir)\s+(?:bitte\s+)?(?:nicht|nie)\s+mehr/],
  ['Daten löschen', /(?:daten|adresse)\s+(?:bitte\s+)?loeschen|loeschen\s+sie\s+(?:bitte\s+)?(?:meine|mich)/],
];

// Teil A 2 (Entscheidung Elias 26.09.2026): feste Modellfassung statt Alias - die Tests und Messungen gelten fuer genau
// diese Fassung; ein Alias koennte ohne Zutun auf eine neue zeigen (README, Abschnitt Modell).
var KI_MODELL = 'claude-haiku-4-5-20251001';

var KI_KATEGORIEN = ['termin', 'rueckfrage', 'kein_interesse', 'widerspruch'];
var KI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kategorie', 'sicher', 'widerspruch_moeglich'],
  properties: {
    kategorie: { type: 'string', enum: ['termin', 'rueckfrage', 'kein_interesse', 'widerspruch'] },
    sicher: { type: 'boolean' },
    widerspruch_moeglich: { type: 'boolean' },
  },
};
var KI_SYSTEM = 'Du ordnest die Antwort eines Kunden auf ein Wartungsangebot eines Heizungsbetriebs ein. Klassen: '
  + 'termin (der Kunde möchte einen Termin), rueckfrage (eine Frage zum Angebot), kein_interesse (lehnt dieses Angebot ab), '
  + 'widerspruch (will keine Werbung oder keine Mails mehr). sicher = false, wenn die Einordnung nicht eindeutig ist. '
  + 'widerspruch_moeglich = true, wenn der Text auch als Widerspruch gegen Werbung verstanden werden kann.';

function wiNorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
}

// -> Liste der getroffenen Muster (leer = kein Treffer). Der eigene Widerspruchshinweis zaehlt nicht.
function pruefeWortliste(text) {
  var t = wiNorm(text);
  t = t.split(wiNorm(WIDERSPRUCH_ABSATZ)).join(' '); // Sicherung eigener Hinweis ausgenommen
  return WI_MUSTER.filter(function (m) { return m[1].test(t); }).map(function (m) { return m[0]; });
}

function kiAnfrage(text) {
  var t = String(text == null ? '' : text).trim();
  if (!t) throw new Error('kein Antworttext fuer die Einordnung');
  return {
    model: KI_MODELL, max_tokens: 200, system: KI_SYSTEM, messages: [{ role: 'user', content: t }],
    output_config: { format: { type: 'json_schema', schema: JSON.parse(JSON.stringify(KI_SCHEMA)) } },
  };
}

// r: Ausgabe eines httpRequest 4.5 mit fullResponse/neverError ({statusCode, body}) oder ein Fehler-Item ({error}).
function pruefeKiAntwort(r) {
  var nein = function (g) { return { ok: false, kategorie: '', sicher: false, widerspruch_moeglich: true, grund: g }; };
  if (!r || typeof r !== 'object') return nein('keine Antwort');
  if (r.error) return nein('Verbindungsfehler');
  if (r.statusCode !== 200) return nein('HTTP ' + r.statusCode);
  var b = r.body || {};
  if (b.type !== 'message') return nein('keine Nachricht');
  if (b.stop_reason !== 'end_turn') return nein('stop_reason ' + b.stop_reason);
  var c = b.content || [];
  if (c.length !== 1 || !c[0] || c[0].type !== 'text') return nein('nicht genau ein Textblock');
  var j;
  try { j = JSON.parse(c[0].text); } catch (x) { return nein('kein JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return nein('kein Objekt');
  var felder = Object.keys(j).sort().join(',');
  if (felder !== 'kategorie,sicher,widerspruch_moeglich') return nein('Felder ' + felder);
  if (KI_KATEGORIEN.indexOf(j.kategorie) < 0) return nein('Kategorie unbekannt');
  if (typeof j.sicher !== 'boolean' || typeof j.widerspruch_moeglich !== 'boolean') return nein('Feldtyp');
  return { ok: true, kategorie: j.kategorie, sicher: j.sicher, widerspruch_moeglich: j.widerspruch_moeglich, grund: '' };
}

// x = { text: Text fuer die Wortliste (ohne Zitat), ki_an: Einstellung "KI-Einordnung" = an, ki: Antwort oder null }
// -> { gesperrt, grund (Antwort | Wortliste | Zweifel | ''), klasse, ki_noetig }
function ordneEin(x) {
  var treffer = pruefeWortliste(x.text);
  // Sicherung Wortliste vor der KI: Anfang
  if (treffer.length) return { gesperrt: true, grund: 'Wortliste', klasse: 'widerspruch', ki_noetig: false };
  // Sicherung Wortliste vor der KI: Ende
  if (!x.ki_an) return { gesperrt: false, grund: '', klasse: 'bitte lesen', ki_noetig: false };
  if (x.ki === null || x.ki === undefined) return { gesperrt: false, grund: '', klasse: '', ki_noetig: true };
  var k = pruefeKiAntwort(x.ki);
  if (!k.ok) return { gesperrt: true, grund: 'Zweifel', klasse: 'nicht eingeordnet', ki_noetig: false, ki_fehler: true, ki_grund: k.grund }; // Sicherung KI fehlt
  if (k.kategorie === 'widerspruch') return { gesperrt: true, grund: 'Antwort', klasse: 'widerspruch', ki_noetig: false }; // Sicherung Klasse Widerspruch
  if (k.widerspruch_moeglich) return { gesperrt: true, grund: 'Zweifel', klasse: k.kategorie, ki_noetig: false }; // Sicherung im Zweifel sperren
  // Teil A 27.09.2026 (Elias): "im Zweifel sperren" gilt nur fuer Zweifel am Widerspruch. Unsicher nur zwischen termin,
  // rueckfrage und kein_interesse -> zurueckgestellt: keine Sperre, Aufgabe "bitte lesen"; bis "Antwort erledigt" = ja geht
  // keine automatische Mail an den Kunden (Sicherung offene Antwort in entscheidung.js).
  if (!k.sicher) return { gesperrt: false, grund: '', klasse: 'unklar', ki_klasse: k.kategorie, ki_noetig: false }; // Sicherung unsicher zurueckstellen
  return { gesperrt: false, grund: '', klasse: k.kategorie, ki_noetig: false };
}

// Aufgabe fuer die Sammelmeldung (E7: ein Widerspruch wird vom Betrieb bestaetigt, nie automatisch).
function aufgabe(klasse) {
  if (klasse === 'termin') return 'Termin gewünscht – Kunde anrufen und Termin vereinbaren';
  if (klasse === 'rueckfrage') return 'Rückfrage – beantworten';
  if (klasse === 'kein_interesse') return 'kein Interesse – zur Kenntnis';
  if (klasse === 'widerspruch') return 'Widerspruch – gesperrt; dem Kunden den Widerspruch schriftlich bestätigen (Art. 12 Abs. 3 DSGVO, innerhalb eines Monats)';
  if (klasse === 'unklar') return 'Antwort unklar – bitte lesen und selbst einordnen; bis „Antwort erledigt“ = ja keine automatische Mail an den Kunden';
  return 'Antwort bitte lesen und selbst einordnen';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WIDERSPRUCH_ABSATZ, KI_MODELL, KI_SCHEMA, KI_SYSTEM, pruefeWortliste, kiAnfrage, pruefeKiAntwort, ordneEin, aufgabe };
}
