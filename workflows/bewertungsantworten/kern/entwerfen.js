// Bewertungsantworten, Kernlogik: Unterworkflow "Entwurf schreiben" (PLAN-QUELLEN Vertrag 3; Baustein 5).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Die Entscheidung je Bewertung trifft entwurfEntscheiden (entwurf.js,
// Baustein 2): ohne Text -> Baustein, Wortliste "heikel" -> selbst lesen, beides ohne KI; sonst Anfrage mit maskiertem, gekuerztem
// Text; die Antwort prueft der Code (Schema, Kategorie, Leitplanken). Dieses Modul macht daraus einen Stapel: Eingang pruefen,
// KI-Liste bauen, Antworten zuordnen, je Bewertung ein Ergebnis mit Status. Ein KI-Fehler ist ein Status (ki_fehler mit Grund),
// kein Wurf - der Alarm kommt im Hauptlauf. Geworfen wird nur bei Aufruffehlern und Unerwartetem. Wurftexte ohne ": ".
// Funktionen anderer Module kommen ueber k (maskierung.js, leitplanken.js, bausteine.js, entwurfEntscheiden).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var EN_ARTEN = ['ohne Text 1', 'ohne Text 2', 'ohne Text 3', 'ohne Text 4', 'ohne Text 5', 'unfair'];

function enFehler(t) {
  throw new Error('Entwurf schreiben – ' + t);
}

function enText(v) {
  return typeof v === 'string' && v.trim() !== '';
}

// Eingang = alle Items des Aufrufs; genau eines: { einstellungen: { betrieb, signatur, kontaktweg, domain, hoechstlaenge, verboten,
// hoechstzahl_entwuerfe }, bausteine: { Art: Text } (leseTextbausteine), bewertungen: [{ sterne, text, anzeigename }] }.
// Keine Bewertungs-ID (Vertrag 3): die Ergebnisse kommen in derselben Reihenfolge zurueck (nr = Position).
function pruefeEingangEntwurf(items) {
  var l = items || [];
  if (l.length !== 1) enFehler('genau ein Eingang erwartet, gekommen ' + l.length); // Sicherung genau ein Eingang
  var x = l[0];
  if (!x || typeof x !== 'object') enFehler('Eingang fehlt');
  var e = x.einstellungen;
  if (!e || !enText(e.betrieb) || !enText(e.signatur) || !enText(e.kontaktweg) || typeof e.domain !== 'string' || typeof e.verboten !== 'string'
    || !Number.isInteger(e.hoechstlaenge) || e.hoechstlaenge < 1 || e.hoechstlaenge > 4096 || !Number.isInteger(e.hoechstzahl_entwuerfe)) {
    enFehler('Einstellungen unvollständig oder ungültig'); // Sicherung Einstellungen vollstaendig
  }
  var b = x.bausteine;
  if (!b || EN_ARTEN.some(function (a) { return !enText(b[a]); })) enFehler('Textbausteine unvollständig'); // Sicherung Bausteine vollstaendig
  var bw = x.bewertungen;
  if (!Array.isArray(bw)) enFehler('bewertungen fehlt');
  if (bw.length > e.hoechstzahl_entwuerfe) enFehler('mehr Bewertungen (' + bw.length + ') als Höchstzahl Entwürfe je Lauf (' + e.hoechstzahl_entwuerfe + ')'); // Sicherung Mengenbremse
  bw.forEach(function (r, i) {
    if (!r || typeof r.text !== 'string' || typeof r.anzeigename !== 'string') enFehler('Bewertung ' + i + ' ohne text oder anzeigename');
  });
  return { einstellungen: e, bausteine: b, bewertungen: bw };
}

// -> { vorlaeufig: [{ nr, ki_noetig, r, gekuerzt }], ki_liste: [{ nr, anfrage }] }. Die Anfrage enthaelt nur, was kiAnfrage baut
// (Sterne, maskierter Text, Betrieb) - keine Nummer, keine ID, kein Anzeigename.
function entwurfVorbereiten(e, k) {
  var vorlaeufig = [];
  var ki_liste = [];
  var erlaubt = [e.einstellungen.betrieb, e.einstellungen.signatur, e.einstellungen.kontaktweg].join(' ');
  e.bewertungen.forEach(function (b, nr) {
    if (!Number.isInteger(b.sterne) || b.sterne < 1 || b.sterne > 5) { // Sicherung Sterne 1-5
      vorlaeufig.push({ nr: nr, ki_noetig: false, r: null, gekuerzt: false });
      return;
    }
    var r = k.entwurfEntscheiden({ text: b.text, sterne: b.sterne, anzeigename: b.anzeigename, einstellungen: e.einstellungen, bausteine: e.bausteine, ki: null }, k);
    var gekuerzt = r.ki_noetig ? k.fuerKi(b.text, b.anzeigename, erlaubt).gekuerzt : false;
    vorlaeufig.push({ nr: nr, ki_noetig: r.ki_noetig, r: r, gekuerzt: gekuerzt });
    if (r.ki_noetig) ki_liste.push({ nr: nr, anfrage: r.anfrage });
  });
  return { vorlaeufig: vorlaeufig, ki_liste: ki_liste };
}

function enGrund(r, ki) {
  if (r.alarm && r.alarm.indexOf('KI-Fehler: ') === 0) return { status: 'ki_fehler', grund: r.alarm.slice('KI-Fehler: '.length) }; // Sicherung KI-Fehler als Status
  if (r.status === 'Entwurf bereit') return { status: 'ok', grund: '' };
  if (r.alarm) return { status: 'selbst_lesen', grund: r.alarm };
  if (r.kategorie === 'heikel') return { status: 'selbst_lesen', grund: ki ? 'KI heikel' : 'Wortliste heikel' };
  if (r.hinweise.indexOf('KI-Antwort widersprüchlich: Kategorie ohne Entwurf') >= 0) return { status: 'selbst_lesen', grund: 'Kategorie ohne Entwurf' };
  return { status: 'selbst_lesen', grund: 'selbst lesen' };
}

// antworten = Ausgaben von "Claude fragen" in der Reihenfolge der KI-Liste (httpRequest 4.5, Never Error, continueRegularOutput:
// je Anfrage genau ein Item, auch bei Zeitueberschreitung). -> [Status-Item, je Bewertung ein Ergebnis in Eingangsreihenfolge].
function entwurfAbschliessen(e, vorlaeufig, antworten, k) {
  var ki_nr = vorlaeufig.filter(function (v) { return v.ki_noetig; }).map(function (v) { return v.nr; });
  var a = antworten || [];
  if (a.length !== ki_nr.length) enFehler('KI-Liste und Antworten ungleich viele (' + ki_nr.length + ' / ' + a.length + ')'); // Sicherung Antworten gleich viele
  var zu = {};
  ki_nr.forEach(function (nr, i) { zu[nr] = a[i]; });
  var st = { art: 'status', anzahl: vorlaeufig.length, ok: 0, selbst_lesen: 0, ki_fehler: 0, ki_aufrufe: ki_nr.length, tokens_ein: 0, tokens_aus: 0,
    modell: ((vorlaeufig.filter(function (v) { return v.ki_noetig; })[0] || { r: { anfrage: {} } }).r.anfrage || {}).model || '' };
  var aus = vorlaeufig.map(function (v) {
    var b = e.bewertungen[v.nr];
    var ki = v.ki_noetig ? zu[v.nr] : null;
    var r = v.r;
    if (r && ki) r = k.entwurfEntscheiden({ text: b.text, sterne: b.sterne, anzeigename: b.anzeigename, einstellungen: e.einstellungen, bausteine: e.bausteine, ki: ki }, k);
    var g = r ? enGrund(r, !!ki) : { status: 'selbst_lesen', grund: 'Sterne ohne Wert' };
    var body = (ki && ki.body) || {};
    var u = body.usage || {};
    var o = { art: 'entwurf', nr: v.nr, status: g.status, grund: g.grund, ki_aufruf: !!ki, kategorie: r ? r.kategorie : '', sicher: r ? r.sicher : null,
      gruende: r ? r.gruende : [], entwurf: r ? r.entwurf : '', antwort: r ? r.antwort : '', hinweise: r ? r.hinweise : ['Sterne ohne Wert'],
      aufgaben: r ? r.aufgaben : [], gekuerzt: v.gekuerzt, http_status: ki && typeof ki.statusCode === 'number' ? ki.statusCode : '',
      stop_reason: body.stop_reason || '', tokens_ein: Number(u.input_tokens) || 0, tokens_aus: Number(u.output_tokens) || 0 };
    st[o.status] += 1;
    st.tokens_ein += o.tokens_ein;
    st.tokens_aus += o.tokens_aus;
    return o;
  });
  return [st].concat(aus); // Sicherung Status zuerst
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeEingangEntwurf, entwurfVorbereiten, entwurfAbschliessen };
}
