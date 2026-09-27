// Wartungserinnerung, Kernlogik: Empfaenger und Text von Alarm und Absender der Sammelmeldung (BAUPLAN f; Baustein 7,
// Auftrag 27.09.2026).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Wie im Mahnlauf (Baustein 8/10): Sammelmeldung und Alarm
// gehen in JEDEM Modus an die Meldeadresse; ist sie ungueltig, geht der Alarm an die Absenderadresse, die Sammelmeldung
// wirft (dann meldet der Faenger). Genau ein Alarm je Fehler: stammt der Fehler aus einem Unterlauf, hat der ihn schon
// selbst gemeldet (jeder Wartungs-Workflow traegt den Faenger als errorWorkflow). Die Adressen stehen nur im
// Einstellungsblatt; dieses Modul liest sie aus den Rohwerten. Die KI formuliert nichts.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var ME_ADRESSEN_W = { 'Testempfänger': 'testempfaenger', 'Absenderadresse': 'absenderadresse', 'Antwort an': 'antwort_an', 'Meldeadresse': 'meldeadresse' };

// meText wie im Mahnlauf; herkunft.py findet den Block dort nicht einzeln (die mehrzeilige var ME_ADRESSEN davor endet
// eingerueckt und schluckt ihn), deshalb hier ohne Vermerk.
function meText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// Übernommen aus Mahnlauf bau/kern/meldung.js (Commit 61022e4), unverändert: meMailOk meAn waehleMeldeempfaenger waehleAlarmempfaenger meDatei leseFehler alarmNoetig
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

// werte: Rohwerte des Blatts "Einstellungen" (Spalte A Schluessel, B Wert) -> die vier Adressen (erste Zeile je Schluessel).
function leseAdressenWartung(werte) {
  var aus = { testempfaenger: '', absenderadresse: '', antwort_an: '', meldeadresse: '' };
  var gesehen = {};
  (werte || []).forEach(function (z) {
    var k = meText(z && z[0]);
    if (!Object.prototype.hasOwnProperty.call(ME_ADRESSEN_W, k) || gesehen[k]) return;
    gesehen[k] = true;
    aus[ME_ADRESSEN_W[k]] = meText(z.length > 1 ? z[1] : '');
  });
  return aus;
}

// Absender von Sammelmeldung und Alarm: Anzeigename "Wartungserinnerung · <Firmenname>" als quoted-string (emailSend reicht
// ihn an nodemailer weiter, der kodiert Nicht-ASCII selbst; Mahnlauf Teil B 2).
function meldeAbsenderWartung(firma, adresse) {
  var n = 'Wartungserinnerung' + (meText(firma) ? ' · ' + meText(firma) : '');
  return '"' + n.replace(/[\r\n]/g, ' ').replace(/[\\"]/g, '\\$&') + '" <' + meText(adresse) + '>';
}

// f: Ergebnis von leseFehler, zeitUtc: Zeitpunkt des Alarms -> { betreff, text }. Der Betreff nennt keinen Modus
// (der Faenger kennt nur den Modus zum Alarmzeitpunkt, Mahnlauf Befund 2).
function baueAlarmWartung(f, firma, zeitUtc) {
  var betreff = 'ALARM – Wartungserinnerung ' + meText(firma) + ' – Lauf abgebrochen – '
    + (f.workflow_name || (f.workflow_id ? 'Workflow ' + f.workflow_id : 'unbekannter Workflow'));
  var text = [
    'Ein Lauf der Wartungserinnerung ist abgebrochen. Was dieser Lauf noch versenden sollte, ist nicht versendet; ein Versand',
    'ohne Bestätigung wird nie wiederholt, sondern in der nächsten Sammelmeldung als „Versandstatus unklar“ genannt.',
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
  module.exports = { leseAdressenWartung, meldeAbsenderWartung, baueAlarmWartung, waehleMeldeempfaenger, waehleAlarmempfaenger, leseFehler,
    alarmNoetig };
}
