// Bewertungsantworten, Kernlogik: Hauptlauf in den Modi trocken (Baustein 6) und test (Baustein 8) (BAUPLAN c; E2, E7, E10, E13, E37).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Setzt die Bausteine der anderen Module zu einem Lauf zusammen:
// Aufbau pruefen (fail-closed, vor jedem Schreiben), Loeschfrist als eigener Schreibschritt, Entwurfsplan mit Mengenbremse VOR
// dem Aufruf von "Entwurf schreiben", Blattplan (neue Zeilen, Aenderungen, Freigaben ohne Veroeffentlichen), Protokoll und Daten
// der Sammelmeldung - beide ohne Bewertungstext, Entwurf oder Name. Baustein 8: im Modus test die Data Table (abgebrochene
// Reservierungen, "Versandstatus klären", S21) und je Antwort Schritt 1-7 (neu lesen und neu entscheiden, Reservierung S20,
// Ergebnis des Zieladapters). Funktionen anderer Module kommen ueber k herein (tabelle.js, zeit.js, einstellungen.js,
// bausteine.js, abgleich.js, freigabe.js, sperre.js, hash.js, leitplanken.js).
// Wurftexte ohne ": " (der Code-Knoten kuerzt bis dorthin).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var HP_BLAETTER = ['Bewertungen', 'Einstellungen', 'Textbausteine', 'Protokoll'];

function hpText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function hpKopf(zeile, spalten) {
  var k = (zeile || []).map(hpText);
  return k.length === spalten.length && k.every(function (s, i) { return s === spalten[i]; });
}

function hpEinmal(l) {
  return l.filter(function (x, i) { return x && l.indexOf(x) === i; });
}

// Gebaut sind trocken (E10, Baustein 6) und test (Baustein 8): veroeffentlicht wird nur mit Quelle und Ziel test (S17). scharf
// bleibt gesperrt (hier und in pruefeEinstellungen).
function pruefeLaufModus(e) {
  var m = hpText((e || {}).modus);
  if (m !== 'trocken' && m !== 'test') throw new Error('Hauptlauf – Modus ' + (m || 'leer') + ' – gebaut sind nur trocken und test, scharf bleibt gesperrt'); // Sicherung nur trocken und test
  if (m === 'test' && hpText(e.quelle) !== 'test') throw new Error('Hauptlauf – Modus test verlangt Quelle und Ziel test – nichts geschrieben'); // Sicherung test nur mit Ziel test
}

// "Stichtag (nur Test)" ersetzt "heute" in trocken und test (BAUPLAN b); "jetzt" rueckt auf den Stichtag, gleiche Uhrzeit Berlin.
function laufJetzt(modus, stichtagTest, jetztUtc, k) {
  var b = k.berlinZeit(jetztUtc);
  var s = k.bestimmeStichtag(modus, stichtagTest, b.datum);
  if (s.stichtag === b.datum) return { jetzt_utc: jetztUtc, heute: b.datum, hinweis: s.hinweis };
  return { jetzt_utc: k.berlinZuUtc(s.stichtag, b.text.slice(11, 16)), heute: s.stichtag, hinweis: 'Stichtag ' + s.stichtag + ' (nur Test) statt ' + b.datum }; // Sicherung Stichtag nur Test
}

// S23 fuer alle Blaetter des Betriebs (die Testquelle prueft "Bewertungen lesen"). p = { blaetter: [Titel], werte: { Blatt: values } }.
function pruefeAufbau(p, k) {
  var bl = ((p && p.blaetter) || []).map(hpText);
  var w = (p && p.werte) || {};
  var f = [];
  HP_BLAETTER.forEach(function (b) { if (bl.indexOf(b) < 0) f.push('Blatt ' + b + ' fehlt'); }); // Sicherung Blatt fehlt
  if (f.length) return { ok: false, fehler: f };
  if (!hpKopf((w.Einstellungen || [])[0], k.EI_SPALTEN)) f.push('Kopfzeile Einstellungen weicht ab'); // Sicherung Kopfzeile Einstellungen
  if (!k.leseBewertungen(w.Bewertungen || []).ok) f.push('Kopfzeile Bewertungen weicht ab'); // Sicherung Kopfzeile Bewertungen
  var tb = k.leseTextbausteine(w.Textbausteine || []);
  if (!tb.ok) f = f.concat(tb.fehler); // Sicherung Textbausteine gueltig
  if (!hpKopf((w.Protokoll || [])[0], k.PR_SPALTEN)) f.push('Kopfzeile Protokoll weicht ab'); // Sicherung Kopfzeile Protokoll
  return { ok: f.length === 0, fehler: f };
}

// c 2, S26: Loeschfrist vor allem anderen, eigener Schreibvorgang (ein spaeterer Fehler haelt sie nicht auf).
function loeschSchritt(zeilen, fristTage, jetztUtc, k) {
  var nach = {};
  (zeilen || []).forEach(function (z) { nach[z.zeile] = z; });
  var auftraege = k.loeschAuftraege(zeilen, fristTage, jetztUtc, k);
  var data = [];
  auftraege.forEach(function (a) { data = data.concat(k.zellen(a.zeile, a.felder)); });
  return { data: data, eintraege: auftraege.map(function (a) {
    return { zeile: a.zeile, bewertung_id: nach[a.zeile].bewertung_id, sterne: nach[a.zeile].sterne, status: a.felder.Status };
  }) };
}

// c 4-6: Abgleich, dann hoechstens "Hoechstzahl Entwuerfe je Lauf" (aelteste zuerst) an "Entwurf schreiben". Der Eingang traegt
// keine Bewertungs-ID (Vertrag 3); die Zuordnung laeuft ueber die Reihenfolge (ziele).
function entwurfPlan(x, k) {
  var e = x.einstellungen || {};
  var ab = k.abgleichen({ zeilen: x.zeilen, quelle: x.quelle, sperrzeilen: x.sperrzeilen || [], seit_utc: x.seit_utc }, k);
  var b = k.begrenzeEntwuerfe(ab.entwurf_noetig, e.hoechstzahl_entwuerfe);
  var jetzt = b.jetzt; // Sicherung Mengenbremse vor dem Aufruf
  var imLauf = {};
  jetzt.forEach(function (z) { if (z.zeile) imLauf[z.zeile] = true; });
  return {
    eingang: { einstellungen: { betrieb: e.betrieb, signatur: e.signatur, kontaktweg: e.kontaktweg, domain: e.domain, hoechstlaenge: e.hoechstlaenge,
      verboten: e.verboten, hoechstzahl_entwuerfe: e.hoechstzahl_entwuerfe }, bausteine: x.bausteine,
      bewertungen: jetzt.map(function (z) { return { sterne: z.bewertung.sterne, text: z.bewertung.text, anzeigename: z.bewertung.anzeigename }; }) },
    ziele: jetzt.map(function (z) { return { bewertung_id: z.bewertung.bewertung_id, grund: z.grund, zeile: z.zeile, antwort_ersetzen: !!z.antwort_ersetzen }; }),
    // Eine geaenderte Bewertung ausserhalb der Hoechstzahl bleibt ganz liegen - schriebe der Lauf ihren neuen Stand, erkennte der
    // naechste die Aenderung nicht mehr.
    abgleich: { aenderungen: ab.aenderungen.filter(function (a) { return !Object.prototype.hasOwnProperty.call(a.felder, 'Stand (UTC)') || imLauf[a.zeile]; }), // Sicherung Aenderung wartet mit dem Entwurf
      neu_ohne_entwurf: ab.neu_ohne_entwurf, neu_beantwortet: ab.neu_beantwortet || [], nachziehen: ab.nachziehen, meldungen: ab.meldungen, alarme: ab.alarme },
    spaeter: b.spaeter.length, hinweis: b.hinweis };
}

function hpStatus(r) {
  return r.status === 'ok' ? 'Entwurf bereit' : 'selbst lesen';
}

// Hinweise einer Zeile: Freigabe-Hinweise dieses Laufs ersetzen die des letzten, alle anderen bleiben.
function hpHinweisZelle(basis, freigabe) {
  var alt = String(basis || '').split('; ').filter(function (s) { return s && s.indexOf('Freigabe') !== 0; });
  return hpEinmal(alt.concat(freigabe.map(function (h) { return h.indexOf('Freigabe') === 0 ? h : 'Freigabe: ' + h; }))).join('; ');
}

// c 7-12 im Modus trocken. x = { modus, lauf: { id, zeit_utc, zeit_berlin, start }, einstellungen, zeilen (leseBewertungen),
// items: { ID: Vertrag-1-Item }, plan (entwurfPlan), ergebnisse (Ausgabe von "Entwurf schreiben"), loesch (loeschSchritt) }
// -> { data (RAW-Schreibauftrag), protokoll: [[8 Spalten]], meldung (Daten fuer baueSammelmeldung), neue_zeilen, zaehler }.
function blattPlan(x, k) {
  var p = x.plan;
  var L = x.lauf;
  var erg = (x.ergebnisse || []).filter(function (j) { return j && j.art === 'entwurf'; });
  if (erg.length !== p.ziele.length) throw new Error('Hauptlauf – Entwurf schreiben lieferte ' + erg.length + ' statt ' + p.ziele.length + ' Ergebnisse'); // Sicherung Ergebnisse gleich viele
  var zeilen = x.zeilen || [];
  var nachZeile = {};
  zeilen.forEach(function (z) { nachZeile[z.zeile] = z; });
  var zellen = {};
  var setze = function (zeile, felder) { zellen[zeile] = Object.assign(zellen[zeile] || {}, felder); };
  var letzte = Math.max.apply(null, [1].concat(zeilen.map(function (z) { return z.zeile; })));
  var neu = [];
  var prot = [];
  var pz = function (id, aktion, grund, hash) { prot.push([L.zeit_utc, L.zeit_berlin, L.id, x.modus, id, aktion, grund || '', hash || '']); };
  var m = { eintraege: [], veroeffentlicht: [], wartet: [], abgelehnt: [], geloescht: [], frist_abgelaufen: [], alarme: [].concat(p.abgleich.alarme || []),
    wuerde: [], hinweise: [].concat(p.abgleich.meldungen || []).concat(p.hinweis ? [p.hinweis] : []) };
  var z = { neu: 0, geaendert: 0, aenderungen: 0, wuerde: 0, freigabe_hinweise: 0, ki_fehler: 0, frist: 0 };
  ((x.loesch || {}).eintraege || []).forEach(function (l) {
    pz(l.bewertung_id, 'frist_abgelaufen', l.status);
    m.frist_abgelaufen.push({ zeile: l.zeile, sterne: l.sterne });
    z.frist++;
  });
  // Abgleich: geloescht, schon beantwortet, Moderation, geaenderte Bewertung (Zellen des Entwurfs folgen unten)
  p.abgleich.aenderungen.forEach(function (a) {
    var alt = nachZeile[a.zeile] || {};
    setze(a.zeile, a.felder);
    var extra = a.hinweise.concat(a.aufgaben);
    if (extra.length) setze(a.zeile, { Hinweise: hpEinmal(extra).join('; ') });
    if (Object.prototype.hasOwnProperty.call(a.felder, 'Stand (UTC)')) { z.geaendert++; return; }
    z.aenderungen++;
    var s = a.felder.Status;
    var ein = { zeile: a.zeile, sterne: alt.sterne, status: s };
    pz(alt.bewertung_id, 'status', s);
    if (s === 'Bewertung gelöscht') m.geloescht.push(ein);
    else if (s === 'wartet auf Google') m.wartet.push(ein);
    else if (s === 'veröffentlicht') m.veroeffentlicht.push(ein);
    else if (s === 'von Google abgelehnt') m.abgelehnt.push(Object.assign(ein, { verstoss: ((x.items || {})[alt.bewertung_id] || {}).antwort_verstoss }));
    else m.eintraege.push(Object.assign(ein, { aufgabe: a.aufgaben[0] || '' }));
  });
  // Entwuerfe
  p.ziele.forEach(function (ziel, i) {
    var r = erg[i];
    var status = hpStatus(r);
    if (r.status === 'ki_fehler') z.ki_fehler++;
    var hinweise = hpEinmal((r.hinweise || []).concat(r.aufgaben || []));
    var eintrag = { sterne: 0, kategorie: r.kategorie, status: status, hinweise: r.hinweise || [],
      aufgabe: (r.aufgaben || [])[0] || (r.status === 'ok' ? 'Entwurf lesen und freigeben' : r.status === 'ki_fehler' ? 'selbst lesen (KI-Fehler)' : 'selbst lesen') };
    var hash = r.entwurf ? k.textHash(r.entwurf) : '';
    if (ziel.grund === 'neu') {
      var b = (x.items || {})[ziel.bewertung_id] || {};
      var nr = letzte + neu.length + 1;
      neu.push({ zeile: nr, bewertung_id: ziel.bewertung_id, werte: [ziel.bewertung_id, b.erstellt_utc ? k.berlinZeit(b.erstellt_utc).text : '', b.geaendert_utc,
        b.sterne === null || b.sterne === undefined ? '' : b.sterne, b.text, r.kategorie, hinweise.join('; '), r.entwurf, r.antwort, '', status, '', ''] });
      eintrag.zeile = nr;
      eintrag.sterne = b.sterne;
      pz(ziel.bewertung_id, 'entwurf', r.status + (r.grund ? ' ' + r.grund : ''), hash);
      z.neu++;
    } else {
      var basis = (zellen[ziel.zeile] || {}).Hinweise;
      var felder = { Kategorie: r.kategorie, Entwurf: r.entwurf, Status: status, Hinweise: hpEinmal(String(basis || '').split('; ').concat(hinweise)).join('; ') };
      if (ziel.antwort_ersetzen) felder.Antwort = r.antwort; // Sicherung Antwort des Betriebs bleibt
      setze(ziel.zeile, felder);
      eintrag.zeile = ziel.zeile;
      eintrag.sterne = (nachZeile[ziel.zeile] || {}).sterne;
      pz(ziel.bewertung_id, 'entwurf_neu', r.status + (r.grund ? ' ' + r.grund : ''), hash);
    }
    m.eintraege.push(eintrag);
  });
  // Neue Bewertungen, die der Parser nicht lesen konnte: Zeile ohne Entwurf, selbst lesen
  p.abgleich.neu_ohne_entwurf.forEach(function (n) {
    var b = n.bewertung;
    var nr = letzte + neu.length + 1;
    neu.push({ zeile: nr, bewertung_id: b.bewertung_id, werte: [b.bewertung_id, b.erstellt_utc ? k.berlinZeit(b.erstellt_utc).text : '', b.geaendert_utc,
      b.sterne === null || b.sterne === undefined ? '' : b.sterne, b.text, '', n.hinweise.join('; '), '', '', '', 'selbst lesen', '', ''] });
    m.eintraege.push({ zeile: nr, sterne: b.sterne, kategorie: '', status: 'selbst lesen', aufgabe: 'Bewertung in Google selbst lesen', hinweise: [] });
    pz(b.bewertung_id, 'unlesbar', n.hinweise.join('; '));
    z.neu++;
  });
  // Neue Bewertungen mit Antwort in der Quelle (von Hand oder von anderer Stelle): Zeile ohne Entwurf, schon beantwortet (c 6, S05)
  (p.abgleich.neu_beantwortet || []).forEach(function (n) {
    var b = n.bewertung;
    var nr = letzte + neu.length + 1;
    neu.push({ zeile: nr, bewertung_id: b.bewertung_id, werte: [b.bewertung_id, b.erstellt_utc ? k.berlinZeit(b.erstellt_utc).text : '', b.geaendert_utc,
      b.sterne === null || b.sterne === undefined ? '' : b.sterne, b.text, '', '', '', '', '', 'schon beantwortet', '', ''] });
    pz(b.bewertung_id, 'schon_beantwortet', b.antwort_status || '');
    z.neu++;
  });
  // Data Table (nur test, S21): "Versandstatus klären", nachgezogene eigene Antworten, abgebrochene Reservierungen - vor den Freigaben
  var sperr = x.modus === 'trocken' ? [] : (x.sperrzeilen || []); // Sicherung trocken ohne Data Table
  var spl = x.modus === 'trocken' ? { dt: [], zellen: [], alarme: [], protokoll: [] }
    : sperrPlan({ zeilen: zeilen, items: x.items || {}, sperrzeilen: sperr, lauf: L, nachziehen: p.abgleich.nachziehen || [] }, k);
  spl.erledigt = spl.erledigt || {};
  spl.zellen.forEach(function (c) {
    setze(c.zeile, c.felder);
    if (c.hinweise.length) {
      var basis = Object.prototype.hasOwnProperty.call(zellen[c.zeile] || {}, 'Hinweise') ? zellen[c.zeile].Hinweise : (nachZeile[c.zeile] || {}).hinweise;
      setze(c.zeile, { Hinweise: hpEinmal(String(basis || '').split('; ').concat(c.hinweise)).join('; ') });
    }
  });
  spl.protokoll.forEach(function (q) { pz(q[0], q[1], q[2], q[3]); });
  m.alarme = m.alarme.concat(spl.alarme);
  // Freigaben (c 8) - im Modus trocken nur geplant: "waere veroeffentlicht", keine Zelle, kein Schreiben ans Ziel; im Modus test die
  // Liste fuer Schritt 10 (je Antwort neu lesen, reservieren, veroeffentlichen)
  // Ein Schluessel, den die Data Table in diesem Lauf erledigt hat, plant keine Freigabe mehr (sonst ein zweiter, falscher Hinweis).
  var fz = zeilen.filter(function (zl) { return !spl.erledigt || !spl.erledigt[hpSchluessel(zl, k)]; }); // Sicherung erledigt plant nicht
  var fr = k.planeFreigaben(fz, x.items || {}, sperr, { modus: x.modus, einstellungen: x.einstellungen, lauf: { id: L.id, start: L.start } }, k);
  m.alarme = m.alarme.concat(fr.alarme);
  var veroeff = [];
  fr.veroeffentlichen.forEach(function (d) {
    var alt = nachZeile[d.zeile] || {};
    if (x.modus !== 'trocken') { veroeff.push(Object.assign({}, d, { sterne: alt.sterne, kategorie: alt.kategorie })); return; } // Sicherung test veroeffentlicht erst in Schritt 10
    m.wuerde.push({ zeile: d.zeile, sterne: alt.sterne, kategorie: alt.kategorie, status: alt.status });
    pz(d.bewertung_id, 'wuerde_veroeffentlichen', d.schreiben ? 'schreiben' : 'trocken', d.text_hash); // Sicherung trocken nur geplant
    z.wuerde++;
  });
  fr.zeilen.forEach(function (d) {
    var alt = nachZeile[d.zeile] || {};
    setze(d.zeile, d.felder);
    if (d.hinweise.length) {
      var basis = Object.prototype.hasOwnProperty.call(zellen[d.zeile] || {}, 'Hinweise') ? zellen[d.zeile].Hinweise : alt.hinweise;
      setze(d.zeile, { Hinweise: hpHinweisZelle(basis, d.hinweise) });
      z.freigabe_hinweise++;
    }
    m.eintraege.push({ zeile: d.zeile, sterne: alt.sterne, kategorie: alt.kategorie, status: d.felder.Status || alt.status, aufgabe: d.hinweise[0] || '', hinweise: [] });
    pz(alt.bewertung_id, 'freigabe', d.felder.Status || d.hinweise[0] || '');
  });
  if (z.ki_fehler) m.alarme.push('KI-Fehler bei ' + z.ki_fehler + (z.ki_fehler > 1 ? ' Bewertungen' : ' Bewertung') + ' – keine Einordnung, selbst lesen');
  var data = [];
  Object.keys(zellen).forEach(function (zl) { data = data.concat(k.zellen(Number(zl), zellen[zl])); });
  neu.forEach(function (n) { data.push({ range: "'Bewertungen'!A" + n.zeile + ':M' + n.zeile, values: [n.werte] }); });
  return { data: k.rawSchreibauftrag(data), protokoll: prot, meldung: m, neue_zeilen: neu.map(function (n) { return { zeile: n.zeile, bewertung_id: n.bewertung_id }; }),
    zaehler: z, veroeffentlichen: veroeff, dt: spl.dt };
}

function hpSchluessel(z, k) {
  try { return k.sperrSchluessel(z.bewertung_id, z.stand_utc); } catch (e) { return ''; }
}

function hpMitHash(item, k) {
  return item ? Object.assign({}, item, { antwort_hash: item.antwort_vorhanden ? k.textHash(item.antwort_text || '') : '' }) : null;
}

function hpStatusAntwort(zustand) {
  return { APPROVED: 'veröffentlicht', PENDING: 'wartet auf Google', REJECTED: 'von Google abgelehnt' }[hpText(zustand)] || '';
}

// S21 im Modus test, vor den Freigaben: x = { zeilen, items, sperrzeilen (Data Table, Laufbeginn), lauf, nachziehen (abgleichen) }
// -> { dt: [Zeilen fuer die Data Table], zellen: [{ zeile, felder, hinweise }], alarme, protokoll: [[id, aktion, grund, hash]] }.
// Reihenfolge: "Versandstatus klären" (Betrieb), eigene Antworten ueber den Hash (abgleichen), abgebrochene Reservierungen. Je
// Schluessel hoechstens ein Eintrag in diesem Lauf.
function sperrPlan(x, k) {
  var erledigt = {};
  var aus = { dt: [], zellen: [], alarme: [], protokoll: [], erledigt: erledigt };
  var L = x.lauf;
  var nachId = {};
  (x.zeilen || []).forEach(function (z) { nachId[z.bewertung_id] = z; });
  var proSchluessel = {};
  (x.sperrzeilen || []).forEach(function (r) { if (r && hpText(r.schluessel)) (proSchluessel[hpText(r.schluessel)] = proSchluessel[hpText(r.schluessel)] || []).push(r); });
  var eintrag = function (schluessel, aktion, bewertungId, hash, grund) {
    if (erledigt[schluessel]) return false; // Sicherung je Schluessel ein Eintrag
    erledigt[schluessel] = true;
    aus.dt.push(k.datenZeile(schluessel, aktion, { id: L.id, zeit: L.zeit_utc }, { bewertung_id: bewertungId, text_hash: hash, grund: grund }));
    aus.protokoll.push([bewertungId, aktion === 'veroeffentlicht' ? 'nachgezogen' : aktion === 'unklar' ? 'unklar' : 'versandstatus_geklaert', grund, hash]);
    return true;
  };
  var antwortFelder = function (it) {
    var f = { Freigabe: '' };
    var s = hpStatusAntwort(it && it.antwort_status);
    if (s) f.Status = s;
    if (it && hpText(it.antwort_geaendert_utc)) f['veröffentlicht am'] = k.berlinZeit(it.antwort_geaendert_utc).text;
    return f;
  };
  // 1. "Versandstatus klären" (S21): veroeffentlicht -> nachziehen, wenn die Quelle die Antwort zeigt; nicht veroeffentlicht ->
  // zurueckgegeben, der Betrieb gibt neu frei; sonst Hinweis, die Zelle bleibt.
  (x.zeilen || []).forEach(function (z) {
    if (!hpText(z.versandstatus_klaeren) || !hpText(z.stand_utc)) return;
    var sl = k.sperrSchluessel(z.bewertung_id, z.stand_utc);
    var it = hpMitHash((x.items || {})[z.bewertung_id], k);
    var r = k.klaereVersandstatus(z.versandstatus_klaeren, proSchluessel[sl] || [], L.id, L.start, it || {}, '');
    if (!r) return;
    if (r.aktion === 'hinweis') { aus.zellen.push({ zeile: z.zeile, felder: {}, hinweise: [r.grund] }); return; }
    var hash = r.aktion === 'veroeffentlicht' ? it.antwort_hash : ((proSchluessel[sl] || []).filter(function (q) { return hpText(q.text_hash); }).slice(-1)[0] || {}).text_hash;
    eintrag(sl, r.aktion, z.bewertung_id, hash || '', r.grund);
    var f = r.aktion === 'veroeffentlicht' ? antwortFelder(it) : { Status: 'Entwurf bereit', Freigabe: '' }; // Sicherung nicht veroeffentlicht gibt neu frei
    f['Versandstatus klären'] = '';
    aus.zellen.push({ zeile: z.zeile, felder: f, hinweise: [r.aktion === 'veroeffentlicht' ? r.grund : r.grund + ' – bitte neu freigeben'] });
  });
  // 2. Eigene Antwort in der Quelle ueber den Hash (abgleichen, S21): "veroeffentlicht" nachtragen. Status setzt der Abgleich.
  (x.nachziehen || []).forEach(function (n) {
    var it = (x.items || {})[n.bewertung_id];
    if (!eintrag(n.schluessel, 'veroeffentlicht', n.bewertung_id, n.text_hash, 'nachgezogen über den Hash')) return;
    var z = nachId[n.bewertung_id];
    if (z && it && hpText(it.antwort_geaendert_utc)) aus.zellen.push({ zeile: z.zeile, felder: { 'veröffentlicht am': k.berlinZeit(it.antwort_geaendert_utc).text, Freigabe: '' }, hinweise: [] });
  });
  // 3. Reservierung eines abgebrochenen Laufs (anderer Lauf, vor dem eigenen Beginn): nie blind wiederholen - Antwort mit gleichem
  // Hash in der Quelle -> nachgezogen, sonst "unklar", Status "Versandstatus unklar", Alarm.
  Object.keys(proSchluessel).forEach(function (sl) {
    if (erledigt[sl]) return;
    var s = k.sperreEntscheid(proSchluessel[sl], L.id, L.start);
    if (!s.tot) return;
    var id = hpText(s.tot.bewertung_id) || sl.split('|')[1];
    var it = hpMitHash((x.items || {})[id], k);
    var r = k.abgebrochenNachziehen(it, s.tot.text_hash); // Sicherung abgebrochen nie blind wiederholen
    var z = nachId[id];
    eintrag(sl, r.aktion, id, hpText(s.tot.text_hash), r.grund + ' (Lauf ' + s.tot.lauf_id + ')');
    if (r.aktion === 'veroeffentlicht') { if (z) aus.zellen.push({ zeile: z.zeile, felder: antwortFelder(it), hinweise: [] }); return; }
    if (z) aus.zellen.push({ zeile: z.zeile, felder: { Status: 'Versandstatus unklar', Freigabe: '' }, hinweise: ['Veröffentlichung nicht bestätigt – Versandstatus klären'] });
    aus.alarme.push('Reservierung eines abgebrochenen Laufs (Lauf ' + s.tot.lauf_id + ') – Zeile ' + (z ? z.zeile : '?') + ' – Antwort in der Quelle nicht bestätigt, nicht erneut veröffentlicht; bitte „Versandstatus klären“ setzen');
  });
  return aus;
}

// ---------------------------------------------------------------- Schritt 10: je Antwort (Unterlauf "Freigabe veroeffentlichen")

// Schritt 1-2 (S02, E37): Blatt "Bewertungen" frisch gelesen, Zeile ueber die ID (nicht ueber die Nummer), Freigabe nur fuer den
// Stand der Planung, Leitplanken am endgueltigen Text aus "Antwort", Hash gleich der Planung. Die Data Table prueft Schritt 3.
// p = { http, werte (values mit Kopfzeile), geplant (blattPlan.veroeffentlichen[i]), item (Vertrag 1), ctx } -> Entscheidung.
function freigabeNeuLesen(p, k) {
  if (p.http !== 200) throw new Error('Hauptlauf – Zeile neu lesen abgelehnt, HTTP ' + p.http + ' – nichts veröffentlicht');
  var b = k.leseBewertungen(p.werte || []);
  if (!b.ok) throw new Error('Tabellenaufbau falsch – Kopfzeile Bewertungen weicht ab – nichts veröffentlicht');
  var g = p.geplant;
  var z = b.zeilen.filter(function (r) { return r.bewertung_id === g.bewertung_id; });
  var alt = { zeile_jetzt: g.zeile, sterne: g.sterne, kategorie: g.kategorie, hinweise_alt: '' };
  if (z.length !== 1) return Object.assign({ aktion: 'nichts', felder: {}, hinweise: ['Zeile nicht mehr eindeutig – nicht veröffentlicht'] }, alt); // Sicherung Zeile ueber die ID
  var d = k.neuEntscheiden({ zeile: z[0], item: p.item, sperrzeilen: [], ctx: p.ctx, geplant: g }, k);
  return Object.assign(d, { zeile_jetzt: z[0].zeile, sterne: z[0].sterne, kategorie: z[0].kategorie, hinweise_alt: z[0].hinweise, bewertung_id: g.bewertung_id,
    schluessel: d.schluessel || g.schluessel, text_hash: d.text_hash || g.text_hash });
}

// Schritt 3 (S20): Reservierung ohne Text; lauf = { id, zeit } (Zeitpunkt der Reservierung).
function reservierungsZeile(d, lauf, k) {
  return k.datenZeile(d.schluessel, 'reserviert', lauf, { bewertung_id: d.bewertung_id, text_hash: d.text_hash });
}

// Schritt 3 nach dem Zuruecklesen: nur die frueheste Reservierung schreibt, "veroeffentlicht"/"unklar" gewinnen, eine Reservierung
// eines abgebrochenen Laufs wird nie blind wiederholt. Die eigene Zeile muss zurueckgelesen sein.
function sperreNachReservierung(zeilen, d, lauf, k) {
  var z = (zeilen || []).filter(function (r) { return r && hpText(r.schluessel) === d.schluessel; });
  if (!z.some(function (r) { return r.aktion === 'reserviert' && String(r.lauf_id) === String(lauf.id); })) {
    throw new Error('Hauptlauf – Reservierung nicht zurückgelesen – ' + d.bewertung_id + ' – nichts veröffentlicht'); // Sicherung Reservierung zurueckgelesen
  }
  var s = k.sperreEntscheid(z, lauf.id, lauf.start);
  return { schreiben: s.weiter === true, grund: s.weiter ? '' : s.grund }; // Sicherung nur mit eigener Reservierung schreiben
}

// E48 (Befund 6, Baustein 9, Lauf 7599/7600): der Zieladapter meldet einen Fehler selbst (errorWorkflow) nur, wenn er lief. Dass er lief,
// zeigt nur seine eigene Meldung ("Antwort veröffentlichen – …", veroeffentlichen.js) oder ein Code-Fehler mit Zeilenangabe aus seinem
// Lauf. Alles andere - "Workflow is not active and cannot be executed.", nicht gefunden, Aufruf gescheitert, ohne Meldung - heisst:
// er startete nicht, niemand hat gemeldet. Im Zweifel also Alarm (eher zwei als keiner).
function hpUnterlaufGelaufen(meldung) {
  var m = hpText(meldung);
  return /^Antwort veröffentlichen – /.test(m) || /\[line \d+\]$/.test(m); // Sicherung Unterlauf lief nur mit eigener Meldung
}

var HP_VORBEDINGUNG = {
  geloescht: { felder: { Status: 'Bewertung gelöscht', Freigabe: '' }, hinweis: 'Bewertung beim Veröffentlichen nicht mehr in der Quelle' },
  geaendert: { felder: { Freigabe: '' }, hinweis: 'Bewertung beim Veröffentlichen geändert – Freigabe verfällt' },
  schon_beantwortet: { felder: { Status: 'schon beantwortet', Freigabe: '' }, hinweis: 'beim Veröffentlichen schon beantwortet – nichts überschrieben' },
  text_ungueltig: { felder: { Status: 'blockiert' }, hinweis: 'Antwort leer oder länger als 4 096 Byte' },
};

// Schritt 7: x = { lauf: { id, zeit_utc, zeit_berlin }, modus, d (freigabeNeuLesen), sperre (sperreNachReservierung oder null),
// ergebnis (Vertrag 2, genau ein Status-Item, oder null), unterlauf_fehler (Meldung eines abgefangenen Fehlers oder null) }
// -> { dt (Zeile oder null), data (RAW-Bereiche), protokoll (8 Spalten), meldung ({ liste, eintrag } oder null), alarm, hinweis }.
function nachbereiten(x, k) {
  var d = x.d;
  var L = x.lauf;
  var zl = d.zeile_jetzt;
  var aus = { dt: null, data: [], protokoll: null, meldung: null, alarm: '', hinweis: '' };
  var prot = function (aktion, grund, hash) { aus.protokoll = [L.zeit_utc, L.zeit_berlin, L.id, x.modus, d.bewertung_id, aktion, grund || '', hash || '']; };
  var ein = function (status, aufgabe) { return { zeile: zl, sterne: d.sterne, kategorie: d.kategorie, status: status, aufgabe: aufgabe || '', hinweise: [] }; };
  // Hinweise: Freigabe-Hinweise (Schritt 1-2) ersetzen die des letzten Laufs; Ergebnisse des Veroeffentlichens kommen dazu.
  var zellen = function (felder, hinweise) {
    var f = Object.assign({}, felder);
    if (hinweise && hinweise.length) {
      f.Hinweise = d.aktion !== 'veroeffentlichen' ? hpHinweisZelle(d.hinweise_alt, hinweise) : hpEinmal(String(d.hinweise_alt || '').split('; ').concat(hinweise)).join('; ');
    }
    if (Object.keys(f).length) aus.data = k.zellen(zl, f);
  };
  if (d.aktion !== 'veroeffentlichen') { // Schritt 1-2: nichts
    zellen(d.felder || {}, d.hinweise || []);
    var g = (d.felder || {}).Status || (d.hinweise || [])[0] || 'Freigabe seit der Planung entfallen';
    prot('freigabe', g);
    if (!Object.keys(d.felder || {}).length && !(d.hinweise || []).length) { // Sicherung entfallene Freigabe kein Zu tun
      aus.hinweis = 'Zeile ' + zl + ' nicht veröffentlicht – Freigabe seit der Planung entfallen';
      return aus;
    }
    aus.meldung = { liste: 'eintraege', eintrag: ein((d.felder || {}).Status || '', (d.hinweise || [])[0] || '') };
    return aus;
  }
  if (!x.sperre || !x.sperre.schreiben) { // Schritt 3: anderer Lauf, erledigt oder abgebrochen - dieser Lauf schreibt nichts
    prot('uebersprungen', (x.sperre || {}).grund || 'keine Reservierung');
    aus.hinweis = 'Zeile ' + zl + ' nicht veröffentlicht – ' + ((x.sperre || {}).grund || 'keine Reservierung');
    return aus;
  }
  var s = x.unterlauf_fehler ? { status: 'fehler', grund: 'Fehler im Unterlauf – ' + String(x.unterlauf_fehler).slice(0, 160), geschrieben: true } : x.ergebnis; // Sicherung Unterlauf-Fehler vielleicht geschrieben
  var aktion = k.ergebnisAktion(s);
  if (aktion === null) throw new Error('Hauptlauf – Antwort veröffentlichen meldete ' + (s && s.status) + ' im Modus ' + x.modus + ' – ' + d.bewertung_id);
  aus.dt = k.datenZeile(d.schluessel, aktion, { id: L.id, zeit: L.zeit_utc }, { bewertung_id: d.bewertung_id, text_hash: d.text_hash, grund: s.status === 'veroeffentlicht' ? s.antwort_status : s.grund });
  if (aktion === 'veroeffentlicht') {
    var st = hpStatusAntwort(s.antwort_status);
    var f = { Status: st, 'veröffentlicht am': k.berlinZeit(s.antwort_geaendert_utc).text, Freigabe: '' };
    var auf = s.antwort_status === 'REJECTED' ? ['Von Google abgelehnt (' + (hpText(s.antwort_verstoss) || 'ohne Angabe') + ') – in Google von Hand antworten'] : []; // Sicherung abgelehnt Aufgabe
    zellen(f, auf);
    prot('veroeffentlicht', s.antwort_status, d.text_hash);
    var e = ein(st, auf[0]);
    if (s.antwort_status === 'REJECTED') e.verstoss = hpText(s.antwort_verstoss) || 'ohne Angabe';
    aus.meldung = { liste: { APPROVED: 'veroeffentlicht', PENDING: 'wartet', REJECTED: 'abgelehnt' }[s.antwort_status], eintrag: e };
    return aus;
  }
  if (aktion === 'unklar') { // vielleicht geschrieben: nie erneut, der Betrieb klaert (S21)
    var h = 'Veröffentlichung nicht bestätigt (' + s.grund + ') – Versandstatus klären';
    zellen({ Status: 'Versandstatus unklar', Freigabe: '' }, [h]);
    prot('unklar', s.grund, d.text_hash);
    // E48 (Befund 6): "dort gemeldet" nur, wenn der Zieladapter lief und sich selbst meldet; startete er nicht, alarmiert dieser Lauf.
    var gemeldet = !!x.unterlauf_fehler && hpUnterlaufGelaufen(x.unterlauf_fehler);
    var nichtGestartet = !!x.unterlauf_fehler && !gemeldet;
    aus.meldung = { liste: 'eintraege', eintrag: ein('Versandstatus unklar', gemeldet ? 'Versandstatus klären (Fehler im Unterlauf, dort gemeldet)'
      : nichtGestartet ? 'Versandstatus klären (Zieladapter nicht gestartet, Alarm gesendet)' : 'Versandstatus klären') };
    if (!gemeldet) { // Sicherung ein Alarm je Fehler Unterlauf
      aus.alarm = 'Veröffentlichung nicht bestätigt – Zeile ' + zl + ' – ' + (nichtGestartet ? 'Zieladapter nicht gestartet (' + hpText(x.unterlauf_fehler).slice(0, 160) + ')'
        : s.grund) + ' – nicht erneut veröffentlicht; bitte „Versandstatus klären“ setzen';
    }
    return aus;
  }
  // zurueckgegeben: sicher nichts geschrieben
  if (s.status === 'vorbedingung_verletzt' && HP_VORBEDINGUNG[s.grund]) {
    var v = HP_VORBEDINGUNG[s.grund];
    zellen(v.felder, [v.hinweis]);
    prot('zurueckgegeben', s.grund);
    aus.meldung = { liste: 'eintraege', eintrag: ein(v.felder.Status || '', v.hinweis) };
    return aus;
  }
  var w = 'Veröffentlichen gescheitert (' + (s.status === 'ziel_nicht_gebaut' ? 'Ziel nicht gebaut' : s.grund || s.status) + ') – nichts geschrieben, der nächste Lauf entscheidet neu';
  zellen({}, [w]);
  prot('zurueckgegeben', s.grund || s.status);
  aus.alarm = 'Zeile ' + zl + ' – ' + w;
  return aus;
}

// Sammelmeldung: Ergebnisse je Antwort in die Daten von baueSammelmeldung (ohne Text, S18).
function fuegeVeroeffentlichungEin(m, ergebnisse) {
  var r = Object.assign({}, m);
  ['eintraege', 'veroeffentlicht', 'wartet', 'abgelehnt', 'alarme', 'hinweise'].forEach(function (n) { r[n] = [].concat(m[n] || []); });
  (ergebnisse || []).forEach(function (e) {
    if (e.meldung && r[e.meldung.liste]) r[e.meldung.liste].push(e.meldung.eintrag);
    if (e.alarm) r.alarme.push(e.alarm);
    if (e.hinweis) r.hinweise.push(e.hinweis);
  });
  return r;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeLaufModus, laufJetzt, pruefeAufbau, loeschSchritt, entwurfPlan, blattPlan, sperrPlan, freigabeNeuLesen, reservierungsZeile,
    sperreNachReservierung, nachbereiten, fuegeVeroeffentlichungEin };
}
