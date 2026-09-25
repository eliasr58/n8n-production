// Mahnlauf, Kernlogik: Meldungen an den Betrieb (BAUPLAN h, Baustein 8).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Sammelmeldung des Hauptlaufs und Alarm
// des Fehler-Workflows gehen per emailSend (SMTP) hinaus - Betreff und Text entstehen hier, aus
// festen Saetzen; die KI formuliert nichts.
//
// Empfaenger (Entscheidung Elias 25.09.2026, Baustein 10 Teil A 1): Sammelmeldungen und Alarme gehen in JEDEM Modus
// an die Meldeadresse; nur Kundenmails werden im Modus test auf den Testempfaenger umgelenkt (waehleEmpfaenger,
// stufen.js). Ist die Meldeadresse ungueltig, geht der Alarm an die Absenderadresse (Teil A 3); die Sammelmeldung wirft
// dann (Hauptlauf), und der Faenger meldet es. Modus trocken (Teil A 1 vom 25.09., Schattenbetrieb beim Kunden vor dem
// Scharfschalten): die Sammelmeldung traegt das Praefix "[TROCKEN – nichts versendet]" und die Liste dessen, was der
// Lauf versendet haette. Die Sammelmeldung geht IMMER, auch bei 0 Vorgaengen (Teil A 3 vom 25.09.: ohne Healthchecks
// ist sie das einzige Lebenszeichen). Der Alarm-Betreff nennt den Modus nicht (Befund 2: der Faenger kennt nur den
// Modus zum Alarmzeitpunkt, nicht den des gescheiterten Laufs). Die Adressen stehen nur im Einstellungsblatt; dieses
// Modul liest sie aus den Rohwerten.

var ME_ADRESSEN = { 'Testempfänger': 'testempfaenger', 'Absenderadresse': 'absenderadresse', 'Antwort an': 'antwort_an',
  'Meldeadresse Betrieb': 'meldeadresse' };

function meText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function meMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(meText(s));
}

// werte: Rohwerte des Blatts "Einstellungen" (Spalte A Schluessel, B Wert) -> die vier Adressen.
function leseAdressen(werte) {
  var aus = { testempfaenger: '', absenderadresse: '', antwort_an: '', meldeadresse: '' };
  var gesehen = {};
  (werte || []).forEach(function (z) {
    var k = meText(z && z[0]);
    if (!Object.prototype.hasOwnProperty.call(ME_ADRESSEN, k) || gesehen[k]) return;
    gesehen[k] = true;
    aus[ME_ADRESSEN[k]] = meText(z.length > 1 ? z[1] : '');
  });
  return aus;
}

function meAn(adresse, grundOk, grundFehlt) {
  if (!meMailOk(adresse)) return { senden: false, an: null, grund: grundFehlt };
  return { senden: true, an: meText(adresse), grund: grundOk };
}

// Empfaenger der Sammelmeldung: die Meldeadresse, in jedem Modus.
function waehleMeldeempfaenger(adressen) {
  return meAn((adressen || {}).meldeadresse, 'Meldeadresse', 'Meldeadresse fehlt oder ungültig');
}

// Empfaenger eines Alarms aus dem Fehler-Workflow: die Meldeadresse, in jedem Modus; ist sie ungueltig, die
// Absenderadresse (Teil A 3) - ein Alarm soll ankommen, aber nie an eine fremde Adresse.
function waehleAlarmempfaenger(adressen) {
  var a = adressen || {};
  if (meMailOk(a.meldeadresse)) return meAn(a.meldeadresse, '', '');
  // Sicherung Alarm an Absenderadresse: Anfang
  if (meMailOk(a.absenderadresse)) return meAn(a.absenderadresse, 'Meldeadresse fehlt oder ungültig – Alarm an die Absenderadresse', '');
  // Sicherung Alarm an Absenderadresse: Ende
  return { senden: false, an: null, grund: 'Meldeadresse und Absenderadresse fehlen oder ungültig' };
}

function meBetrag(cent) {
  if (!Number.isInteger(cent)) return '';
  var s = String(Math.abs(cent));
  while (s.length < 3) s = '0' + s;
  return (cent < 0 ? '-' : '') + s.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + s.slice(-2) + ' €';
}

function meDatum(iso) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meText(iso));
  return r ? r[3] + '.' + r[2] + '.' + r[1] : meText(iso);
}

// Eine Meldung beliebiger Herkunft (Hauptlauf, Zuordnung, Zahlstand, Offene Posten) -> eine Zeile.
function meZeile(m) {
  if (!m || typeof m !== 'object') return meText(m);
  if (m.art === 'Klärfall') {
    return 'Klärfall ' + meText(m.schluessel) + ' über ' + meBetrag(m.betrag_cent) + ' · ' + meText(m.grund)
      + ' · Kandidaten ' + ((m.kandidaten || []).length ? m.kandidaten.join(', ') : 'keine');
  }
  if (m.art === 'Überzahlung') return meText(m.rechnungsnr) + ' · Überzahlung ' + meBetrag(m.ueberschuss_cent) + ', gemeldet, nicht verrechnet';
  var teile = [];
  if (m.rechnungsnr) teile.push(meText(m.rechnungsnr));
  if (m.art) teile.push(meText(m.art));
  if (m.datei) teile.push('Datei ' + meText(m.datei) + (m.zeile ? ' Zeile ' + m.zeile : ''));
  else if (m.zeile) teile.push('Zeile ' + m.zeile);
  if (m.text) teile.push(meText(m.text));
  return teile.join(' · ');
}

var ME_STUFE = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: 'letzte Mahnung', 4: 'Übergabe' };
var ME_GEPLANT = { senden: ' senden', entwurf_anlegen: ' als Entwurf anlegen', entwurf_ersetzen: ' Entwurf ersetzen',
  entwurf_senden: ' freigegebenen Entwurf senden' };

// p = { firma, modus, stichtag, lauf_id, alarme: [{art, text}], versand: [{rechnungsnr, stufe, ergebnis, grund}],
//       geplant: [{rechnungsnr, stufe, aktion}] (nur Modus trocken: was versendet worden waere), meldungen: [...] }
// -> { senden, alarm, betreff, text }. Gesendet wird immer; ohne Inhalt ist der Text genau eine Zeile.
function baueSammelmeldung(p) {
  var alarme = p.alarme || [];
  var versand = p.versand || [];
  var meldungen = p.meldungen || [];
  var trocken = p.modus === 'trocken';
  var geplant = trocken ? (p.geplant || []) : [];
  var alarm = alarme.length > 0;
  var betreff = (trocken ? '[TROCKEN – nichts versendet] ' : '') + (alarm ? 'ALARM – ' : '') + 'Mahnlauf ' + meText(p.firma) + ' – '
    + meDatum(p.stichtag) + ' – Lauf ' + meText(p.lauf_id) + (p.modus === 'test' ? ' (Modus test)' : '');
  var kopf = 'Mahnlauf ' + meText(p.firma) + ', Lauf ' + meText(p.lauf_id) + ', Stichtag ' + meDatum(p.stichtag) + ', Modus ' + meText(p.modus);
  if (!alarm && !versand.length && !geplant.length && !meldungen.length) {
    return { senden: true, alarm: false, betreff: betreff, text: kopf + ': keine Vorgänge, keine Hinweise.' };
  }
  var z = [];
  z.push(kopf + '.');
  if (alarm) {
    z.push('', 'ALARM');
    alarme.forEach(function (a) { z.push('- ' + meText(a.art) + ': ' + meText(a.text)); });
  }
  if (geplant.length) {
    z.push('', 'Hätte versendet (Modus trocken, nichts versendet)');
    geplant.forEach(function (g) {
      z.push('- ' + meText(g.rechnungsnr) + ' · Stufe ' + meText(g.stufe) + ' · ' + (ME_STUFE[g.stufe] || 'Stufe ' + g.stufe)
        + (ME_GEPLANT[g.aktion] || ' ' + meText(g.aktion)));
    });
  }
  if (versand.length) {
    z.push('', 'Versand');
    versand.forEach(function (v) {
      z.push('- ' + meText(v.rechnungsnr) + ' · Stufe ' + meText(v.stufe) + ' · ' + meText(v.ergebnis) + (meText(v.grund) ? ' · ' + meText(v.grund) : ''));
    });
  }
  if (meldungen.length) {
    z.push('', 'Hinweise');
    meldungen.forEach(function (m) { z.push('- ' + meZeile(m)); });
  }
  z.push('', 'Automatische Meldung des Mahnlaufs. Das vollständige Protokoll steht im Blatt „Protokoll“.');
  return { senden: true, alarm: alarm, betreff: betreff, text: z.join('\n') };
}

// Absender von Sammelmeldung und Alarm (Teil B 2): Anzeigename "Mahnlauf · <Firmenname>". emailSend reicht den
// Text an nodemailer weiter; der kodiert den Namen selbst (RFC 2047), hier nur quoted-string mit \" und \\.
function meldeAbsender(firma, adresse) {
  var n = 'Mahnlauf' + (meText(firma) ? ' · ' + meText(firma) : '');
  return '"' + n.replace(/[\r\n]/g, ' ').replace(/[\\"]/g, '\\$&') + '" <' + meText(adresse) + '>';
}

// Dateiname aus einer Meldung "… Datei <name> – …" (Kontoauszug unlesbar), sonst ''.
function meDatei(meldung) {
  var m = /Datei (.+?) – /.exec(meText(meldung)) || /Datei (\S+)/.exec(meText(meldung));
  return m ? m[1] : '';
}

// Eingangsdaten des Fehler-Triggers (errorTrigger) -> Kernform. Gemessen (Laeufe 5912 -> 5916): Scheitert ein
// Unterlauf, traegt der Fehler des Aufrufers executionId und workflowId des Unterlaufs.
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

// Teil B 3: genau ein Alarm je Fehler. Stammt der Fehler aus einem Unterlauf (eigene Ausfuehrung, executionId
// ungleich der eigenen), hat der Unterlauf ihn schon selbst gemeldet: jeder Mahnlauf-Workflow traegt den Faenger
// als errorWorkflow, ein Inline-Unterlauf laeuft unter den settings des Aufrufers (Lauf 5864 -> 5865).
function alarmNoetig(f) {
  // Sicherung ein Alarm je Fehler: Anfang
  if (f.unterlauf_lauf && f.unterlauf_lauf !== f.lauf_id) {
    return { noetig: false, grund: 'Fehler aus Unterlauf ' + f.unterlauf_lauf + ' (Workflow ' + (f.unterlauf_workflow || '?') + ') – dort gemeldet' };
  }
  // Sicherung ein Alarm je Fehler: Ende
  return { noetig: true, grund: '' };
}

// f: Ergebnis von leseFehler, zeitUtc: Zeitpunkt des Alarms -> { betreff, text }. Der Betreff nennt keinen Modus.
function baueAlarm(f, firma, zeitUtc) {
  var betreff = 'ALARM – Mahnlauf ' + meText(firma) + ' – Lauf abgebrochen – '
    + (f.workflow_name || (f.workflow_id ? 'Workflow ' + f.workflow_id : 'unbekannter Workflow'))
    + (f.datei ? ' – Datei ' + f.datei : '');
  var text = [
    'Ein Lauf des Mahnlaufs ist abgebrochen. Bis zur Klärung wird nichts versendet, was dieser Lauf versenden sollte.',
    '',
    'Meldung: ' + (f.meldung || '(keine)'),
  ].concat(f.datei ? ['Datei: ' + f.datei] : []).concat([
    '',
    'Workflow ' + (f.workflow_name || '?') + ' (' + (f.workflow_id || '?') + ') · Lauf ' + (f.lauf_id || '?') + ' · Modus ' + (f.modus || '?')
      + ' · letzter Knoten „' + (f.letzter_knoten || '?') + '“',
    'Zeit (UTC): ' + meText(zeitUtc),
    '',
    'Automatische Meldung des Fehler-Workflows.',
  ]).join('\n');
  return { betreff: betreff, text: text };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { leseAdressen, waehleMeldeempfaenger, waehleAlarmempfaenger, baueSammelmeldung, meldeAbsender, leseFehler, alarmNoetig,
    baueAlarm };
}
