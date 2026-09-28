// Bewertungsantworten, Kernlogik: Abgleich des Blatts "Bewertungen" mit der Quelle (BAUPLAN c 2, 4, 5; b "Geaenderte
// Bewertung"; d S03-S05, S25-S27; E13; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Funktionen anderer Module kommen als Parameter k herein
// (sperre.js, zeit.js, hash.js). Reine Funktion: sie liest Zeilen, Quelle (Vertrag 1) und Data Table und liefert, was sich an
// welchen Zellen aendern soll und welche Bewertungen einen Entwurf brauchen; geschrieben wird im Hauptlauf (RAW).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var AB_ANTWORTSTATUS = { PENDING: 'wartet auf Google', APPROVED: 'veröffentlicht', REJECTED: 'von Google abgelehnt' };

// Eigene Antwort in der Quelle: fuer diese Bewertung steht "veroeffentlicht" in der Data Table, oder eine Zeile traegt den Hash
// genau dieses Antworttexts (abgebrochener Lauf, S21) - dann ist sie nachzuziehen.
function abEigen(id, item, sperrzeilen, k) {
  var eigene = (sperrzeilen || []).filter(function (r) { return String(r.schluessel).indexOf('antwort|' + id + '|') === 0; });
  if (eigene.some(function (r) { return r.aktion === 'veroeffentlicht'; })) return { eigen: true, nachziehen: null };
  var h = k.textHash(item.antwort_text || '');
  var z = eigene.filter(function (r) { return r.text_hash && r.text_hash === h; })[0]; // Sicherung eigene Antwort ueber den Hash
  return z ? { eigen: true, nachziehen: { schluessel: z.schluessel, text_hash: h } } : { eigen: false, nachziehen: null };
}

// x = { zeilen (leseBewertungen), quelle: { status, bewertungen } (Vertrag 1), sperrzeilen (Data Table), seit_utc }
// -> { aenderungen: [{ zeile, felder, hinweise, aufgaben }], entwurf_noetig: [{ bewertung, grund, zeile, antwort_ersetzen }],
//      neu_ohne_entwurf: [{ bewertung, hinweise }], neu_beantwortet: [{ bewertung }], nachziehen: [{ bewertung_id, schluessel, text_hash }],
//      meldungen, alarme }
function abgleichen(x, k) {
  var aus = { aenderungen: [], entwurf_noetig: [], neu_ohne_entwurf: [], neu_beantwortet: [], nachziehen: [], meldungen: [], alarme: [] };
  var st = (x.quelle && x.quelle.status) || {};
  if (st.status !== 'ok') { aus.alarme.push('Quelle nicht ok: ' + (st.status || 'unbekannt')); return aus; } // Sicherung Quelle nicht ok
  var bw = (x.quelle && x.quelle.bewertungen) || [];
  var items = {};
  bw.forEach(function (b) { items[b.bewertung_id] = b; });
  var zeilen = {};
  (x.zeilen || []).forEach(function (z) { zeilen[z.bewertung_id] = z; });
  bw.forEach(function (b) {
    if (zeilen[b.bewertung_id]) return;
    if ((b.mangel || []).length) {
      aus.neu_ohne_entwurf.push({ bewertung: b, hinweise: b.mangel.map(function (m) { return 'Bewertung unlesbar: ' + m; }) }); // Sicherung Mangel kein Entwurf
      return;
    }
    if (b.antwort_vorhanden) { aus.neu_beantwortet.push({ bewertung: b }); return; } // Sicherung neue Bewertung mit Antwort kein Entwurf
    aus.entwurf_noetig.push({ bewertung: b, grund: 'neu', zeile: null });
  });
  var geloeschtOffen = false;
  (x.zeilen || []).forEach(function (z) {
    var b = items[z.bewertung_id];
    var e = { zeile: z.zeile, felder: {}, hinweise: [], aufgaben: [] };
    if (!b) {
      if (z.status === 'Bewertung gelöscht' || !(z.stand_utc >= String(x.seit_utc || ''))) return;
      if (!st.vollstaendig) { geloeschtOffen = true; return; } // Sicherung geloescht nur bei vollstaendiger Liste
      e.felder = { Status: 'Bewertung gelöscht', Freigabe: '' };
      aus.aenderungen.push(e);
      return;
    }
    if (b.antwort_vorhanden) {
      var eg = abEigen(z.bewertung_id, b, x.sperrzeilen, k);
      if (eg.eigen) {
        if (eg.nachziehen) aus.nachziehen.push({ bewertung_id: z.bewertung_id, schluessel: eg.nachziehen.schluessel, text_hash: eg.nachziehen.text_hash });
        var s = AB_ANTWORTSTATUS[b.antwort_status];
        if (s && s !== z.status) {
          e.felder.Status = s;
          if (b.antwort_status === 'REJECTED') e.aufgaben.push('Von Google abgelehnt (' + (b.antwort_verstoss || 'ohne Angabe') + ') – in Google von Hand antworten'); // Sicherung abgelehnt kein neuer Versuch
          aus.aenderungen.push(e);
        }
        return;
      }
      if (z.status !== 'schon beantwortet') { e.felder = { Status: 'schon beantwortet', Freigabe: '' }; aus.aenderungen.push(e); } // Sicherung vorhandene Antwort
      return;
    }
    if (b.geaendert_utc !== z.stand_utc) {
      // Sicherung geaenderte Bewertung: Anfang
      e.felder = { 'Stand (UTC)': b.geaendert_utc, Bewertungstext: b.text, Freigabe: '', Status: '', Kategorie: '' };
      var ersetzen = String(z.antwort) === String(z.entwurf);
      if (!ersetzen) e.hinweise.push('Bewertung geändert – eigene Antwort prüfen');
      aus.entwurf_noetig.push({ bewertung: b, grund: 'geaendert', zeile: z.zeile, antwort_ersetzen: ersetzen });
      aus.aenderungen.push(e);
      // Sicherung geaenderte Bewertung: Ende
    }
  });
  if (geloeschtOffen) aus.meldungen.push('Quelle nicht vollständig gelesen – keine Zeile als gelöscht markiert');
  return aus;
}

// E13: hoechstens max Entwuerfe je Lauf, aelteste zuerst; der Rest im naechsten Lauf, mit Hinweis.
function begrenzeEntwuerfe(liste, max) {
  var l = (liste || []).slice().sort(function (a, b) {
    var x = String(a.bewertung.erstellt_utc), y = String(b.bewertung.erstellt_utc);
    return x < y ? -1 : x > y ? 1 : (a.bewertung.bewertung_id < b.bewertung.bewertung_id ? -1 : 1);
  });
  var n = Math.max(0, Number(max) || 0);
  var spaeter = l.slice(n); // Sicherung Hoechstzahl Entwuerfe
  return { jetzt: l.slice(0, n), spaeter: spaeter,
    hinweis: spaeter.length ? spaeter.length + (spaeter.length > 1 ? ' Entwürfe' : ' Entwurf') + ' im nächsten Lauf (Höchstzahl ' + n + ')' : '' };
}

// c 4: seit = spaeter von "Bewertungen ab" (Berlin 00:00) und jetzt minus Frist - aeltere haben im Blatt keinen Text mehr.
function leseFenster(bewertungenAb, fristTage, jetztUtc, k) {
  var a = k.berlinZuUtc(bewertungenAb, '00:00');
  var b = new Date(Date.parse(jetztUtc) - Number(fristTage) * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return a > b ? a : b;
}

// c 2, S26: Loeschfrist vor allem anderen - Zeilen mit Text, deren Frist bis zum naechsten planmaessigen Lauf ablaeuft.
function loeschAuftraege(zeilen, fristTage, jetztUtc, k) {
  return (zeilen || []).filter(function (z) {
    var hatText = [z.text, z.entwurf, z.antwort].some(function (v) { return String(v == null ? '' : v).trim() !== ''; });
    return hatText && k.loeschfristFaellig(z.stand_utc, fristTage, jetztUtc);
  }).map(function (z) {
    return { zeile: z.zeile, felder: { Bewertungstext: '', Entwurf: '', Antwort: '', Freigabe: '', // Sicherung Loeschfrist leert alle Texte
      Status: z.status === 'veröffentlicht' ? 'veröffentlicht' : 'Frist abgelaufen' } };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { abgleichen, begrenzeEntwuerfe, leseFenster, loeschAuftraege };
}
