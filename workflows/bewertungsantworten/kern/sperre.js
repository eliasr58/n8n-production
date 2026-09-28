// Bewertungsantworten, Kernlogik: Sperrschluessel und Reservierung in der Data Table "bewertung-sperre" (BAUPLAN b, c 10, d
// S20/S21; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Je Fassung einer Bewertung hoechstens eine Veroeffentlichung:
// frueheste Reservierung gewinnt, "veroeffentlicht" gewinnt immer, eine Reservierung eines abgebrochenen Laufs wird nie blind
// wiederholt. Die Blöcke unten kommen aus der Wartungserinnerung (dort aus Mahnlauf bau/kern/versand.js, Commit 61022e4).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Nach Wartungserinnerung bau/kern/versand.js VS_ERLEDIGT (Commit 42b4f08); angepasst 27.09.2026: erledigt ist ein Schluessel mit
// "veroeffentlicht" oder "unklar" (S21: vielleicht geschrieben -> nie erneut). sperreEntscheid liest die Liste unveraendert.
// Sicherung unklar sperrt (Mutation: 'unklar' aus der Liste nehmen)
var VS_ERLEDIGT = ['veroeffentlicht', 'unklar'];

// Übernommen aus Wartungserinnerung bau/kern/versand.js (Commit 42b4f08), unverändert: VS_NEUBEGINN vsText sperreEntscheid

var VS_NEUBEGINN = ['verworfen', 'zurueckgegeben'];

function vsText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function sperreEntscheid(zeilen, laufId, laufStart) {
  var z = (zeilen || []).slice().sort(function (a, b) { return Number(a.id) - Number(b.id); });
  var neu = -1;
  z.forEach(function (r, i) { if (VS_NEUBEGINN.indexOf(r.aktion) >= 0) neu = i; });
  z = z.slice(neu + 1);
  var erledigt = z.filter(function (r) { return VS_ERLEDIGT.indexOf(r.aktion) >= 0; })[0] || null;
  if (erledigt) return { weiter: false, grund: 'schon ' + erledigt.aktion, erledigt: erledigt };
  var res = z.filter(function (r) { return r.aktion === 'reserviert'; });
  if (!res.length) return { weiter: false, grund: 'keine Reservierung', erledigt: null };
  var start = vsText(laufStart);
  var tot = !start ? [] : res.filter(function (r) {
    return String(r.lauf_id) !== String(laufId) && vsText(r.zeit_utc) !== '' && vsText(r.zeit_utc) < start;
  });
  if (tot.length) return { weiter: false, grund: 'Reservierung eines abgebrochenen Laufs', erledigt: null, tot: tot[0] }; // Sicherung abgebrochene Reservierung
  if (String(res[0].lauf_id) !== String(laufId)) return { weiter: false, grund: 'übersprungen, anderer Lauf', erledigt: null }; // Sicherung Sperre
  return { weiter: true, grund: '', erledigt: null };
}

var SP_AKTIONEN = ['reserviert', 'veroeffentlicht', 'zurueckgegeben', 'unklar'];
var SP_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// Schluessel je Fassung der Bewertung (BAUPLAN b): antwort|<Bewertungs-ID>|<Stand UTC>.
function sperrSchluessel(bewertungId, standUtc) {
  if (!vsText(bewertungId) || !SP_ZEIT.test(vsText(standUtc))) throw new Error('Sperre - Schlüssel ohne Bewertungs-ID oder Stand');
  return 'antwort|' + vsText(bewertungId) + '|' + vsText(standUtc);
}

// Zeile der Data Table "bewertung-sperre": genau sieben Spalten, nie ein Text, nie ein Name (BAUPLAN b).
function datenZeile(schluessel, aktion, lauf, x) {
  if (SP_AKTIONEN.indexOf(aktion) < 0) throw new Error('Sperre - Aktion unbekannt ' + aktion);
  var q = x || {};
  return { schluessel: vsText(schluessel), aktion: aktion, lauf_id: vsText(lauf && lauf.id), bewertung_id: vsText(q.bewertung_id), // Sicherung Data Table ohne Text
    text_hash: vsText(q.text_hash), zeit_utc: vsText(lauf && lauf.zeit), grund: vsText(q.grund) };
}

// S21: Ergebnis von "Antwort veroeffentlichen" (Vertrag 2) -> Eintrag in der Data Table. geschrieben entscheidet: sicher nichts
// geschrieben -> zurueckgegeben (Schluessel frei), vielleicht geschrieben -> unklar (nie erneut). trocken -> kein Eintrag.
function ergebnisAktion(s) {
  if (!s || typeof s !== 'object') return 'unklar';
  if (s.status === 'veroeffentlicht') return 'veroeffentlicht';
  if (s.status === 'wuerde_veroeffentlichen') return null;
  if (s.geschrieben === true) return 'unklar'; // Sicherung vielleicht geschrieben -> unklar
  return 'zurueckgegeben';
}

// S21: Reservierung eines abgebrochenen Laufs - nachziehen nur, wenn die Quelle eine Antwort mit genau diesem Hash zeigt;
// sonst unklar mit Alarm. Nie blind erneut veroeffentlichen.
function abgebrochenNachziehen(item, textHash) {
  var q = item || {};
  if (q.antwort_vorhanden && vsText(q.antwort_hash) !== '' && vsText(q.antwort_hash) === vsText(textHash)) { // Sicherung Nachziehen nur mit gleichem Hash
    return { aktion: 'veroeffentlicht', grund: 'nachgezogen über den Hash' };
  }
  return { aktion: 'unklar', grund: 'abgebrochener Lauf – Antwort in der Quelle nicht bestätigt' };
}

// S21 Spalte "Versandstatus klären" (nach dem Muster von klaereVersandstatusWartung, Wartung versand.js 42b4f08):
// veroeffentlicht -> nachziehen, wenn die Quelle die Antwort mit diesem Hash zeigt; nicht veroeffentlicht -> zurueckgegeben;
// ohne offene Reservierung eines abgebrochenen Laufs -> Hinweis, nichts geaendert. -> null (Zelle leer) oder { aktion, grund }
// Baustein 8: offen ist auch ein Schluessel mit "unklar" (Fehler nach dem Schreibaufruf) - sonst liesse er sich nie klaeren;
// ohne textHash gilt der Hash der offenen Zeile.
function klaereVersandstatus(wert, zeilen, laufId, laufStart, item, textHash) {
  var w = vsText(wert).toLowerCase();
  if (!w) return null;
  if (w !== 'veröffentlicht' && w !== 'nicht veröffentlicht') {
    return { aktion: 'hinweis', grund: 'Versandstatus klären: Wert „' + vsText(wert) + '“ unbekannt (erlaubt: veröffentlicht, nicht veröffentlicht)' };
  }
  var s = sperreEntscheid(zeilen, laufId, laufStart);
  var offen = s.tot || (s.erledigt && s.erledigt.aktion === 'unklar' ? s.erledigt : null); // Sicherung unklar klaerbar
  if (!offen) return { aktion: 'hinweis', grund: 'Versandstatus klären ohne offene Reservierung – nichts geändert' }; // Sicherung Versandstatus ohne Reservierung
  var gleich = abgebrochenNachziehen(item, vsText(textHash) || vsText(offen.text_hash)).aktion === 'veroeffentlicht';
  if (w === 'veröffentlicht') {
    return gleich ? { aktion: 'veroeffentlicht', grund: 'Versandstatus geklärt: veröffentlicht – nachgezogen' }
      : { aktion: 'hinweis', grund: 'Versandstatus klären: die Quelle zeigt keine Antwort mit diesem Text – nichts geändert' };
  }
  if (gleich) return { aktion: 'hinweis', grund: 'Versandstatus klären „nicht veröffentlicht“ widerspricht der Quelle – nichts geändert' };
  return { aktion: 'zurueckgegeben', grund: 'Versandstatus geklärt: nicht veröffentlicht – Reservierung zurückgegeben' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sperreEntscheid, sperrSchluessel, datenZeile, ergebnisAktion, abgebrochenNachziehen, klaereVersandstatus };
}
