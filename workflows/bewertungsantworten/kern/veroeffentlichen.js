// Bewertungsantworten, Kernlogik: Unterworkflow "Antwort veroeffentlichen" (PLAN-QUELLEN Vertrag 2; BAUPLAN c 10.3, d S03-S06;
// Baustein 8).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Reiner Zieladapter: liest das Ziel neu, schreibt nur bei unveraenderter
// Bewertung ohne Antwort, liest nach - schreibt nie ins Blatt "Bewertungen" und nie in die Data Table (das macht der Hauptlauf).
// Ziel test = Blatt "Testquelle" (nachgebautes Google-Profil, BAUPLAN b), Ziel google = ziel_nicht_gebaut ohne Wurf. Parser
// (tabelle.js leseTestquelle), berlinZuUtc (zeit.js), vorbedingungZiel und nachlesenOk (freigabe.js) kommen ueber k herein.
// Nach dem Muster von lesen.js: Erwartbares kommt als Status zurueck, geworfen wird nur bei einem Aufruffehler. Wurftexte ohne ": ".
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var VO_BLATT = 'Testquelle';
var VO_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
var VO_ZUSTAENDE = ['PENDING', 'APPROVED', 'REJECTED'];

function voText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function voOk(code) {
  return typeof code === 'number' && code >= 200 && code <= 299;
}

// Ausgabe nach Vertrag 2 (genau ein Item). antwort_verstoss ist eine Ergaenzung (S25: Aufgabe mit policyViolation).
function voStatus(status, grund, geschrieben, item) {
  var q = item || {};
  return { art: 'status', status: status, grund: grund || '', geschrieben: geschrieben === true, antwort_status: voText(q.antwort_status),
    antwort_geaendert_utc: voText(q.antwort_geaendert_utc), antwort_verstoss: voText(q.antwort_verstoss) };
}

// Eingang = alle Items des Aufrufs (json), genau eines: { ziel: { art, tabelle_id | konto_id, standort_id }, bewertung_id,
// erwartet_geaendert_utc, text, schreiben }. -> { weiter: true, ... } oder { weiter: false, ergebnis } (Art nicht gebaut).
function pruefeEingangVeroeffentlichen(items) {
  var l = items || [];
  if (l.length !== 1) throw new Error('Antwort veröffentlichen – genau ein Eingang erwartet, gekommen ' + l.length); // Sicherung genau ein Eingang Ziel
  var e = l[0] || {};
  var z = e.ziel;
  if (!z || typeof z !== 'object' || !voText(z.art)) throw new Error('Antwort veröffentlichen – Eingang ohne ziel.art');
  if (!voText(e.bewertung_id)) throw new Error('Antwort veröffentlichen – Eingang ohne bewertung_id');
  var st = voText(e.erwartet_geaendert_utc);
  if (!VO_ZEIT.test(st) || !isFinite(Date.parse(st))) throw new Error('Antwort veröffentlichen – erwartet_geaendert_utc nicht als Zeitpunkt UTC – ' + (st || 'leer'));
  if (typeof e.text !== 'string') throw new Error('Antwort veröffentlichen – text ist keine Zeichenkette');
  if (typeof e.schreiben !== 'boolean') throw new Error('Antwort veröffentlichen – schreiben ist kein Wahrheitswert');
  if (voText(z.art) !== 'test') return { weiter: false, ergebnis: voStatus('ziel_nicht_gebaut', '', false) }; // Sicherung anderes Ziel nicht gebaut
  if (!voText(z.tabelle_id)) throw new Error('Antwort veröffentlichen – Ziel test ohne tabelle_id');
  return { weiter: true, ziel: z, tabelle_id: voText(z.tabelle_id), bewertung_id: voText(e.bewertung_id), erwartet_geaendert_utc: st, text: e.text,
    schreiben: e.schreiben };
}

// Spalte "Moderation (Test)": leer = APPROVED; PENDING, APPROVED, REJECTED, bei REJECTED optional der Verstoss ("REJECTED
// PERSONAL_INFO"). -> { zustand, verstoss } oder null (unbekannt).
function voModeration(v) {
  var t = voText(v).toUpperCase().split(/\s+/).filter(Boolean);
  if (!t.length) return { zustand: 'APPROVED', verstoss: '' };
  if (VO_ZUSTAENDE.indexOf(t[0]) < 0 || t.length > 2) return null;
  if (t.length === 2 && (t[0] !== 'REJECTED' || !/^[A-Z_]+$/.test(t[1]))) return null;
  return { zustand: t[0], verstoss: t[1] || '' };
}

// Zeilen der Testquelle mit dieser reviewId (Blattzeile 1-basiert, Kopfzeile = 1).
function voZeilen(werte, id) {
  var aus = [];
  (werte || []).forEach(function (z, i) { if (i > 0 && voText((z || [])[0]) === id) aus.push(i + 1); });
  return aus;
}

// Vertrag 2 Schritt 1-3 (Art test). p = { eingang (pruefeEingangVeroeffentlichen), meta: Antwort spreadsheets.get, werte: Antwort
// values.get 'Testquelle' (UNFORMATTED_VALUE), jetzt_utc }. -> { weiter: false, ergebnis } oder { weiter: true, zeile, body }.
function zielVorbereiten(p, k) {
  var e = p.eingang;
  var meta = p.meta || {};
  var werte = p.werte || {};
  if (!voOk(meta.statusCode)) return { weiter: false, ergebnis: voStatus('fehler', 'Tabelle nicht lesbar, HTTP ' + meta.statusCode, false) };
  var blaetter = ((meta.body && meta.body.sheets) || []).map(function (s) { return voText(s && s.properties && s.properties.title); });
  if (blaetter.indexOf(VO_BLATT) < 0) return { weiter: false, ergebnis: voStatus('fehler', 'Blatt ' + VO_BLATT + ' fehlt', false) };
  if (!voOk(werte.statusCode)) return { weiter: false, ergebnis: voStatus('fehler', VO_BLATT + ' nicht lesbar, HTTP ' + werte.statusCode, false) };
  var zeilen = (werte.body && werte.body.values) || [];
  var r = k.leseTestquelle(zeilen, k);
  if (r.status.status !== 'ok') return { weiter: false, ergebnis: voStatus('fehler', 'Kopfzeile der Testquelle weicht ab', false) }; // Sicherung Kopfzeile Ziel
  var nr = voZeilen(zeilen, e.bewertung_id);
  if (nr.length > 1) return { weiter: false, ergebnis: voStatus('fehler', 'reviewId doppelt', false) }; // Sicherung reviewId doppelt Ziel
  var item = r.bewertungen.filter(function (b) { return b.bewertung_id === e.bewertung_id; })[0] || null;
  var grund = k.vorbedingungZiel(nr.length ? item : null, e.erwartet_geaendert_utc, e.text);
  if (grund) return { weiter: false, ergebnis: voStatus('vorbedingung_verletzt', grund, false, item) }; // Sicherung Vorbedingung vor dem Schreiben
  if (!e.schreiben) return { weiter: false, ergebnis: voStatus('wuerde_veroeffentlichen', '', false, item) }; // Sicherung schreiben false schreibt nicht
  var mz = (zeilen[nr[0] - 1] || [])[k.TQ_SPALTEN.indexOf('Moderation (Test)')];
  var m = voModeration(mz);
  if (!m) return { weiter: false, ergebnis: voStatus('fehler', 'Moderation (Test) unbekannt – ' + voText(mz), false) };
  // Schreiben: nur reviewReply.comment, .updateTime, .reviewReplyState, .policyViolation dieser einen Zeile (Spalten H-K), RAW.
  return { weiter: true, zeile: nr[0], body: { valueInputOption: 'RAW', data: [{ range: "'" + VO_BLATT + "'!H" + nr[0] + ':K' + nr[0], // Sicherung nur Antwortspalten
    values: [[e.text, voText(p.jetzt_utc), m.zustand, m.verstoss]] }] } };
}

// Vertrag 2 Schritt 4 (S06): p = { eingang, schreiben: Antwort values:batchUpdate, nachlesen: Antwort values.get 'Testquelle' }.
// Sobald ein Schreibaufruf abging, ist geschrieben true - auch wenn er scheiterte (vielleicht geschrieben -> unklar, nie erneut).
function zielAbschliessen(p, k) {
  var e = p.eingang;
  var s = p.schreiben || {};
  var n = p.nachlesen || {};
  if (!voOk(s.statusCode)) return voStatus('fehler', 'Schreiben HTTP ' + s.statusCode, true); // Sicherung Schreibfehler geschrieben true
  if (!voOk(n.statusCode)) return voStatus('fehler', 'Nachlesen HTTP ' + n.statusCode, true);
  var r = k.leseTestquelle((n.body && n.body.values) || [], k);
  var item = r.bewertungen.filter(function (b) { return b.bewertung_id === e.bewertung_id; })[0] || null;
  if (!k.nachlesenOk(e.text, item)) return voStatus('fehler', 'Nachlesen – Text oder Zustand weicht ab', true, item); // Sicherung Nachlesen Ziel
  return voStatus('veroeffentlicht', '', true, item);
}

function voAusgabe(ergebnis) {
  return [ergebnis];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeEingangVeroeffentlichen, zielVorbereiten, zielAbschliessen, voAusgabe };
}
