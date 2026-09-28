// Bewertungsantworten, Kernlogik: Freigabe-Entscheidung, Neu-Entscheiden vor dem Schreiben, Vorbedingung und Nachlesen des
// Zieladapters (BAUPLAN c 8, 10; d S01-S08, S17, S22; PLAN-QUELLEN Vertrag 2; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Funktionen anderer Module kommen als Parameter k herein
// (leitplanken.js, sperre.js, hash.js). Veroeffentlicht wird nur der Text aus "Antwort", nur bei gueltiger Freigabe, nur fuer
// die Fassung der Bewertung, auf der die Freigabe beruht, nie ueber eine vorhandene Antwort, nie mit hartem Treffer.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var FG_WERTE = ['freigeben', 'freigeben trotz Hinweis', 'ablehnen', 'selbst beantwortet'];
var FG_ENDE = ['veröffentlicht', 'wartet auf Google', 'von Google abgelehnt', 'Versandstatus unklar', 'Frist abgelaufen', 'Bewertung gelöscht',
  'schon beantwortet', 'abgelehnt', 'selbst beantwortet'];
var ABSTAND_MS = 7000; // S22: mindestens 7 s zwischen zwei Veroeffentlichungen (Google: 10 Bearbeitungen je Minute)

function fgText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function fgBytes(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
  }
  return n;
}

// zeile (leseBewertungen), item (Vertrag 1, frisch; null = nicht in der Quelle), sperrzeilen (Data Table), ctx = { modus,
// einstellungen, lauf } -> { aktion: 'veroeffentlichen' | 'nichts', felder, hinweise, schluessel, text, text_hash, schreiben }
function entscheideFreigabe(zeile, item, sperrzeilen, ctx, k) {
  var z = zeile || {};
  var f = fgText(z.freigabe);
  var nichts = function (h, felder) { return { aktion: 'nichts', felder: felder || {}, hinweise: h ? [].concat(h) : [] }; };
  if (!f) return nichts();
  // Sicherung Freigabe nur gueltige Werte: Anfang
  if (FG_WERTE.indexOf(f) < 0) return nichts('Freigabe ungültig: „' + f + '“ (erlaubt: ' + FG_WERTE.join(', ') + ')');
  // Sicherung Freigabe nur gueltige Werte: Ende
  if (f === 'ablehnen') return nichts('', { Status: 'abgelehnt', Freigabe: '' });
  if (f === 'selbst beantwortet') return nichts('', { Status: 'selbst beantwortet', Freigabe: '' });
  if (FG_ENDE.indexOf(fgText(z.status)) >= 0) return nichts(); // Sicherung Status ohne Veroeffentlichung
  if (!item) return nichts('Bewertung nicht mehr in der Quelle'); // Sicherung geloeschte Bewertung
  if (fgText(item.geaendert_utc) !== fgText(z.stand_utc)) return nichts('Bewertung geändert – Freigabe verfällt'); // Sicherung Freigabe an Stand gebunden
  if (item.antwort_vorhanden) return nichts('schon beantwortet'); // Sicherung vorhandene Antwort nie ueberschreiben
  var schluessel = k.sperrSchluessel(z.bewertung_id, z.stand_utc);
  var s = k.sperreEntscheid((sperrzeilen || []).filter(function (r) { return r && fgText(r.schluessel) === schluessel; }),
    (ctx.lauf || {}).id, (ctx.lauf || {}).start);
  if (s.erledigt) return nichts(); // Sicherung Data Table erledigt
  if (s.tot) return nichts('Reservierung eines abgebrochenen Laufs – Versandstatus klären');
  var e = ctx.einstellungen || {};
  var text = String(z.antwort == null ? '' : z.antwort);
  var r = k.pruefeText(text, { anzeigename: item.anzeigename, bewertungstext: item.text, betrieb: { name: e.betrieb, signatur: e.signatur,
    kontaktweg: e.kontaktweg, domain: e.domain }, hoechstlaenge: e.hoechstlaenge,
    verboten: String(e.verboten || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean) });
  var h = k.hinweiseFuerBlatt(r);
  if (r.hart.length) return nichts(h.filter(function (x) { return x.indexOf('hart: ') === 0; }), { Status: 'blockiert' }); // Sicherung hart blockiert immer
  if (r.weich.length && f !== 'freigeben trotz Hinweis') { // Sicherung weich verlangt trotz Hinweis
    return nichts(h.map(function (x) { return x + ' – „freigeben trotz Hinweis“ nötig'; }));
  }
  return { aktion: 'veroeffentlichen', felder: {}, hinweise: [], schluessel: schluessel, bewertung_id: z.bewertung_id, zeile: z.zeile,
    stand_utc: z.stand_utc, text: text, text_hash: k.textHash(text), schreiben: ctx.modus !== 'trocken' }; // Sicherung trocken schreibt nicht
}

// c 8: alle Zeilen -> { veroeffentlichen, zeilen: [{ zeile, felder, hinweise }], alarme }. Mehr als die Hoechstzahl -> keine.
function planeFreigaben(zeilen, items, sperrzeilen, ctx, k) {
  var aus = { veroeffentlichen: [], zeilen: [], alarme: [] };
  (zeilen || []).forEach(function (z) {
    var d = entscheideFreigabe(z, (items || {})[z.bewertung_id] || null, sperrzeilen, ctx, k);
    if (d.aktion === 'veroeffentlichen') aus.veroeffentlichen.push(d);
    else if (Object.keys(d.felder).length || d.hinweise.length) aus.zeilen.push({ zeile: z.zeile, felder: d.felder, hinweise: d.hinweise });
  });
  var max = Number((ctx.einstellungen || {}).hoechstzahl_veroeffentlichungen);
  // Sicherung Mengenbremse: Anfang
  if (aus.veroeffentlichen.length > max) {
    aus.alarme.push('Mengenbremse: ' + aus.veroeffentlichen.length + ' Freigaben, Höchstzahl ' + max + ' – nichts veröffentlicht');
    aus.veroeffentlichen = [];
  }
  // Sicherung Mengenbremse: Ende
  return aus;
}

// c 10.1 (S02): unmittelbar vor dem Schreiben Zeile, Quelle und Data Table NEU lesen und neu entscheiden. Nur wenn die frische
// Entscheidung gleich der Planung ist (Schluessel und Hash des Texts), wird veroeffentlicht.
function neuEntscheiden(p, k) {
  var d = entscheideFreigabe(p.zeile, p.item, p.sperrzeilen, p.ctx, k);
  if (d.aktion !== 'veroeffentlichen') return d;
  if (d.schluessel !== p.geplant.schluessel) return { aktion: 'nichts', felder: {}, hinweise: ['Stand seit der Planung geändert – nicht veröffentlicht'] };
  if (d.text_hash !== p.geplant.text_hash) return { aktion: 'nichts', felder: {}, hinweise: ['Antwort seit der Planung geändert – nicht veröffentlicht'] }; // Sicherung neu entscheiden Hash
  return d;
}

// Vertrag 2 Schritt 1: Vorbedingung am Ziel, unmittelbar vor dem Schreibaufruf (zweite Verteidigung) -> '' oder Grund.
function vorbedingungZiel(item, erwartetStand, text) {
  if (!item) return 'geloescht'; // Sicherung Ziel geloescht
  if (fgText(item.geaendert_utc) !== fgText(erwartetStand)) return 'geaendert'; // Sicherung Ziel geaendert
  if (item.antwort_vorhanden) return 'schon_beantwortet'; // Sicherung Ziel schon beantwortet
  var t = String(text == null ? '' : text);
  if (!t.trim() || fgBytes(t) > 4096) return 'text_ungueltig'; // Sicherung Ziel Textlaenge
  return '';
}

// Vertrag 2 Schritt 4 (S06): Text gleich (Zeilenenden normalisiert) und Zustand PENDING, APPROVED oder REJECTED. Baustein 8
// (Auftrag Schritt 6): REJECTED heisst geschrieben und von Google abgelehnt - bestaetigt, Schluessel "veroeffentlicht", Aufgabe
// (S25); jeder andere Zustand -> fehler, vielleicht geschrieben.
function nachlesenOk(text, item) {
  var n = function (s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n'); };
  return !!item && n(item.antwort_text) === n(text) && ['PENDING', 'APPROVED', 'REJECTED'].indexOf(fgText(item.antwort_status)) >= 0; // Sicherung Nachlesen
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ABSTAND_MS, entscheideFreigabe, planeFreigaben, neuEntscheiden, vorbedingungZiel, nachlesenOk };
}
