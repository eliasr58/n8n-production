// Bewertungsantworten, Kernlogik: Sammelmeldung und Alarm (BAUPLAN c 12, f, d S18/S19; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Empfaengerwahl, Fehlerform und "ein Alarm je Fehler" kommen aus
// der Wartungserinnerung (dort aus Mahnlauf bau/kern/meldung.js, Commit 61022e4).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

// Übernommen aus Wartungserinnerung bau/kern/meldung.js (Commit 391232c), unverändert: meText meMailOk meAn waehleMeldeempfaenger waehleAlarmempfaenger meDatei leseFehler alarmNoetig
function meText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function meMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(meText(s));
}

function meAn(adresse, grundOk, grundFehlt) {
  if (!meMailOk(adresse)) return { senden: false, an: null, grund: grundFehlt };
  return { senden: true, an: meText(adresse), grund: grundOk };
}

function waehleMeldeempfaenger(adressen) {
  return meAn((adressen || {}).meldeadresse, 'Meldeadresse', 'Meldeadresse fehlt oder ungültig');
}

function waehleAlarmempfaenger(adressen) {
  var a = adressen || {};
  if (meMailOk(a.meldeadresse)) return meAn(a.meldeadresse, '', '');
  // Sicherung Alarm an Absenderadresse: Anfang
  if (meMailOk(a.absenderadresse)) return meAn(a.absenderadresse, 'Meldeadresse fehlt oder ungültig – Alarm an die Absenderadresse', '');
  // Sicherung Alarm an Absenderadresse: Ende
  return { senden: false, an: null, grund: 'Meldeadresse und Absenderadresse fehlen oder ungültig' };
}

function meDatei(meldung) {
  var m = /Datei (.+?) – /.exec(meText(meldung)) || /Datei (\S+)/.exec(meText(meldung));
  return m ? m[1] : '';
}

function leseFehler(j) {
  var e = (j && j.execution) || {};
  var t = (j && j.trigger) || {};
  var w = (j && j.workflow) || {};
  var meldung = meText((e.error && e.error.message) || (t.error && t.error.message));
  return {
    workflow_id: meText(w.id), workflow_name: meText(w.name), lauf_id: meText(e.id), modus: meText(e.mode || t.mode),
    letzter_knoten: meText(e.lastNodeExecuted), meldung: meldung, datei: meDatei(meldung),
    unterlauf_lauf: meText(e.error && e.error.executionId), unterlauf_workflow: meText(e.error && e.error.workflowId),
  };
}

function alarmNoetig(f) {
  // Sicherung ein Alarm je Fehler: Anfang
  if (f.unterlauf_lauf && f.unterlauf_lauf !== f.lauf_id) {
    return { noetig: false, grund: 'Fehler aus Unterlauf ' + f.unterlauf_lauf + ' (Workflow ' + (f.unterlauf_workflow || '?') + ') – dort gemeldet' };
  }
  // Sicherung ein Alarm je Fehler: Ende
  return { noetig: true, grund: '' };
}

var ME_ADRESSEN_B = { 'Meldeadresse': 'meldeadresse', 'Absenderadresse': 'absenderadresse' };

// werte: Rohwerte des Blatts "Einstellungen" -> die zwei Adressen (erste Zeile je Schluessel). Nur hier und am Versandschritt.
function leseAdressenBewertung(werte) {
  var aus = { meldeadresse: '', absenderadresse: '' };
  var gesehen = {};
  (werte || []).forEach(function (z) {
    var k = meText(z && z[0]);
    if (!Object.prototype.hasOwnProperty.call(ME_ADRESSEN_B, k) || gesehen[k]) return;
    gesehen[k] = true;
    aus[ME_ADRESSEN_B[k]] = meText(z.length > 1 ? z[1] : '');
  });
  return aus;
}

// Nach Wartungserinnerung bau/kern/meldung.js meldeAbsenderWartung (Commit 391232c), angepasst: Name des Projekts.
function meldeAbsender(betrieb, adresse) {
  var n = 'Bewertungsantworten' + (meText(betrieb) ? ' · ' + meText(betrieb) : '');
  return '"' + n.replace(/[\r\n]/g, ' ').replace(/[\\"]/g, '\\$&') + '" <' + meText(adresse) + '>';
}

// S18: aus einem Eintrag gehen nur Zeile, Sterne, Kategorie, Status, Aufgabe und Hinweis-Klassen in die Meldung - nie ein
// Bewertungstext, Entwurf, Antworttext oder Name, auch wenn der Aufrufer sie mitgibt.
function meEintrag(e) {
  var x = e || {};
  return { zeile: x.zeile, sterne: x.sterne, kategorie: meText(x.kategorie), status: meText(x.status), aufgabe: meText(x.aufgabe), // Sicherung Sammelmeldung ohne Text
    hinweise: (x.hinweise || []).filter(function (h) { return /^(?:hart|weich): [\wÄÖÜäöüß/ -]{1,40}$/.test(String(h)); }) };
}

function meZeile(e) {
  var s = 'Zeile ' + e.zeile + (e.sterne ? ' · ' + e.sterne + (Number(e.sterne) === 1 ? ' Stern' : ' Sterne') : '');
  return s + (e.kategorie ? ' · ' + e.kategorie : '') + (e.status ? ' · ' + e.status : '') + (e.aufgabe ? ' – ' + e.aufgabe : '')
    + (e.hinweise && e.hinweise.length ? ' (' + e.hinweise.join(', ') + ')' : '');
}

// c 12: Sammelmeldung, immer (auch ohne Neues). x = { modus, betrieb, lauf_id, zeit, link, eintraege, veroeffentlicht, wartet,
// abgelehnt: [{zeile, sterne, verstoss}], geloescht, frist_abgelaufen, alarme: [Text], wuerde, hinweise: [Text des Codes] } -> { betreff, text }
function baueSammelmeldung(x) {
  var liste = function (l) { return (l || []).map(meEintrag); };
  var ein = liste(x.eintraege);
  var abschnitte = [];
  var abschnitt = function (titel, zeilen) { if (zeilen.length) abschnitte.push(titel + '\n' + zeilen.map(function (z) { return '- ' + z; }).join('\n')); };
  abschnitt('ALARM', (x.alarme || []).map(meText));
  abschnitt('Zu tun', ein.map(meZeile));
  abschnitt('Hinweise', (x.hinweise || []).map(meText));
  abschnitt('Veröffentlicht', liste(x.veroeffentlicht).map(meZeile));
  abschnitt('Wartet auf Google (Moderation)', liste(x.wartet).map(meZeile));
  abschnitt('Von Google abgelehnt – in Google von Hand antworten', (x.abgelehnt || []).map(function (a) {
    return meZeile(meEintrag(a)) + ' – ' + (meText(a.verstoss) || 'ohne Angabe');
  }));
  abschnitt('Bewertung gelöscht', liste(x.geloescht).map(meZeile));
  abschnitt('Frist abgelaufen (Texte geleert)', liste(x.frist_abgelaufen).map(meZeile));
  if (x.modus === 'trocken') abschnitt('Wäre veröffentlicht worden (Modus trocken)', liste(x.wuerde).map(meZeile));
  var text = [
    'Bewertungsantworten ' + meText(x.betrieb) + ' – Lauf ' + meText(x.lauf_id) + ', ' + meText(x.zeit),
    '',
    abschnitte.length ? abschnitte.join('\n\n') : 'Keine neuen oder offenen Bewertungen.',
    '',
    'Blatt: ' + meText(x.link),
    'Diese Meldung enthält keinen Bewertungstext, keinen Entwurf und keinen Namen (Datenschutz).',
  ].join('\n');
  var betreff = (x.alarme && x.alarme.length ? 'ALARM – ' : '') + (x.modus === 'trocken' ? '[TROCKEN – nichts veröffentlicht] ' : '')
    + 'Bewertungsantworten ' + meText(x.betrieb) + ' – ' + (ein.length ? ein.length + ' zu tun' : 'nichts zu tun');
  return { betreff: betreff, text: text };
}

// Nach Wartungserinnerung bau/kern/meldung.js baueAlarmWartung (Commit 391232c), angepasst: Name des Projekts, Folge im Text.
function baueAlarm(f, betrieb, zeitUtc) {
  var betreff = 'ALARM – Bewertungsantworten ' + meText(betrieb) + ' – Lauf abgebrochen – '
    + (f.workflow_name || (f.workflow_id ? 'Workflow ' + f.workflow_id : 'unbekannter Workflow'));
  var text = [
    'Ein Lauf der Bewertungsantworten ist abgebrochen. Was dieser Lauf noch veröffentlichen sollte, ist nicht veröffentlicht; eine',
    'Veröffentlichung ohne Bestätigung wird nie wiederholt, sondern als „Versandstatus unklar“ gemeldet.',
    '',
    'Meldung: ' + (f.meldung || '(keine)'),
    '',
    'Workflow ' + (f.workflow_name || '?') + ' (' + (f.workflow_id || '?') + ') · Lauf ' + (f.lauf_id || '?') + ' · Modus ' + (f.modus || '?')
      + ' · letzter Knoten „' + (f.letzter_knoten || '?') + '“',
    'Zeit (UTC): ' + meText(zeitUtc),
    '',
    'Automatische Meldung des Fehler-Workflows.',
  ].join('\n');
  return { betreff: betreff, text: text };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { waehleMeldeempfaenger, waehleAlarmempfaenger, leseFehler, alarmNoetig, leseAdressenBewertung, meldeAbsender, baueSammelmeldung, baueAlarm };
}
