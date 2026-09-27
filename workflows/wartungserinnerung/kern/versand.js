// Wartungserinnerung, Kernlogik: Versand EINER Mail (Angebot oder Erinnerung) - BAUPLAN c 7, d; Baustein 6, Auftrag 27.09.2026.
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Die Funktionen der anderen Module kommen als Parameter k herein
// (Mahnlauf-Muster). Reihenfolge je Mail (wie Mahnlauf Baustein 7/10): Zeile, Einstellungen, Textbausteine und Sperrliste NEU
// lesen -> neu entscheiden (planeLauf auf dem frischen Stand) und mit der Planung vergleichen -> Sperrschluessel reservieren,
// frueheste Reservierung gewinnt, "versendet" gewinnt immer, eine Reservierung eines abgebrochenen Laufs wird nie erneut
// gesendet -> senden -> Nachpruefung im Gesendet-Ordner -> "versendet" in die Data Table -> erst dann die Zellen.
// Modus test: Empfaenger ist IMMER der Testempfaenger (waehleEmpfaenger). Teil B (27.09.2026): jede Mail traegt
// List-Unsubscribe mit mailto an "Antwort an" und dem Vorgang im Betreff - so erreicht ein Widerspruch per Klick den
// Workflow, der ihn ueber die Vorgangssuche findet und wie ein Wortlisten-Widerspruch sperrt. Eine Erinnerung geht mit
// threadId, In-Reply-To und References der ersten eigenen Mail in den Thread des Angebots.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var VS_ARTEN_W = { angebot: 'Angebot', erinnerung: 'Erinnerung' };
var VS_STATUS_W = { angebot: 'Angebot versendet', erinnerung: 'Erinnerung versendet' };

// Übernommen aus Mahnlauf bau/kern/versand.js (Commit 61022e4), unverändert: VS_ERLEDIGT VS_NEUBEGINN vsText sperreEntscheid vsMailOk vsAdressen vsKopf nachpruefung handVersandAuswerten vsSpalte vsSerial
var VS_ERLEDIGT = ['versendet', 'angelegt', 'erledigt'];

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

function vsMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(vsText(s));
}

function vsAdressen(to) {
  return String(to || '').split(',').map(function (s) {
    var m = /<([^>]+)>/.exec(s);
    return vsText(m ? m[1] : s).toLowerCase();
  }).filter(function (s) { return s; });
}

function vsKopf(headers, name) {
  var h = (headers || []).filter(function (x) { return String(x.name).toLowerCase() === name.toLowerCase(); })[0];
  return h ? String(h.value) : '';
}

function nachpruefung(antwort, empfaenger) {
  if (!antwort || antwort.statusCode !== 200) return { im_gesendet: false, to_gleich_empfaenger: false, to_anzahl: 0 };
  var b = antwort.body || {};
  var to = vsAdressen(vsKopf(b.payload && b.payload.headers, 'To'));
  return { im_gesendet: (b.labelIds || []).indexOf('SENT') >= 0,
    to_gleich_empfaenger: to.length === 1 && to[0] === vsText(empfaenger).toLowerCase(), to_anzahl: to.length };
}

function handVersandAuswerten(liste, nachricht, k) {
  if (!liste || liste.statusCode !== 200) throw new Error('Versand - Gesendet-Suche abgelehnt, HTTP ' + (liste && liste.statusCode));
  var ids = ((liste.body && liste.body.messages) || []).map(function (m) { return m.id; });
  if (!ids.length) return { gefunden: false, gmail_id: '', datum: '' };
  if (!nachricht || nachricht.statusCode !== 200) throw new Error('Versand - Nachricht lesen abgelehnt, HTTP ' + (nachricht && nachricht.statusCode));
  var ms = Number(nachricht.body.internalDate);
  return { gefunden: true, gmail_id: String(nachricht.body.id), datum: k.berlinZeit(new Date(ms).toISOString()).datum };
}

function vsSpalte(i) {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function vsSerial(iso) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return (Date.UTC(+r[1], +r[2] - 1, +r[3]) - Date.UTC(1899, 11, 30)) / 86400000;
}

function versandSchluessel(aktion, anlagenId, faelligkeit) {
  if (!VS_ARTEN_W[aktion]) throw new Error('Versand - Aktion unbekannt ' + aktion);
  if (!vsText(anlagenId) || !/^\d{4}-\d{2}-\d{2}$/.test(vsText(faelligkeit))) throw new Error('Versand - Schlüssel ohne Anlagen-ID oder Fälligkeit');
  return aktion + '|' + vsText(anlagenId) + '|' + vsText(faelligkeit);
}

// Teil B: Widerspruch mit einem Klick (§ 7 Abs. 3 UWG, Arbeitsstand). Gmail schickt dann eine Mail an "Antwort an" mit diesem
// Betreff; die Vorgangssuche in "Antworten einordnen" findet sie, die Wortliste ("abmelden") sperrt.
function abmeldeKopf(antwortAn, vorgang) {
  if (!vsMailOk(antwortAn)) throw new Error('Versand - Antwort-an ungültig');
  if (!vsText(vorgang)) throw new Error('Versand - Abmeldung ohne Vorgang');
  return 'List-Unsubscribe: <mailto:' + vsText(antwortAn) + '?subject=' + encodeURIComponent('Abmelden ' + vsText(vorgang)) + '>';
}

// Kopfzeilen vor "MIME-Version: 1.0" einer Nachricht aus baueMime (mime.js bleibt byte-gleich mit dem Mahnlauf).
function kopfEinfuegen(nachricht, zeilen) {
  var n = String(nachricht);
  var ende = n.indexOf('\r\n\r\n');
  var pos = n.indexOf('\r\nMIME-Version: 1.0\r\n');
  if (ende < 0 || pos < 0 || pos > ende) throw new Error('Versand - Nachricht ohne Kopf');
  (zeilen || []).forEach(function (z) {
    if (!/^[A-Za-z][A-Za-z0-9-]*: [\x20-\x7e]+$/.test(String(z))) throw new Error('Versand - Kopfzeile ungültig'); // Sicherung Kopfinjektion
  });
  return n.slice(0, pos) + (zeilen.length ? '\r\n' + zeilen.join('\r\n') : '') + n.slice(pos);
}

// Antwort von threads.get (format metadata, Message-ID) -> { thread_id, message_id } der fruehesten eigenen Mail, sonst null.
function referenzAusThread(r) {
  if (!r || r.statusCode !== 200 || !r.body) return null;
  var eigene = (r.body.messages || []).filter(function (m) {
    var l = m.labelIds || [];
    return l.indexOf('SENT') >= 0 && l.indexOf('DRAFT') < 0;
  }).sort(function (a, b) { return Number(a.internalDate) - Number(b.internalDate); });
  if (!eigene.length) return null;
  var mid = vsKopf(eigene[0].payload && eigene[0].payload.headers, 'Message-ID');
  if (!/^<[^<>\s]+>$/.test(mid)) return null;
  return { thread_id: vsText(r.body.id), message_id: mid };
}

// p = { eingang: { modus, stichtag, anlagen_id, aktion, faelligkeit, vorgang, antworten, antworten_gelesen },
//       werte: { einstellungen, anlagen, textbausteine } (Rohwerte, frisch gelesen), sperrzeilen: Data Table (frisch) }
// -> { schritt: 'senden' | 'nichts', grund, d (frische Entscheidung), anlage }
function neuEntscheidenVersand(p, k) {
  var e = p.eingang;
  var nichts = function (g) { return { schritt: 'nichts', grund: g, d: null, anlage: null }; };
  var ei = k.leseEinstellungen(p.werte.einstellungen);
  if (!ei.ok) return nichts('Einstellungen unvollständig – ' + ei.fehlend.join(', '));
  // Sicherung Modus frisch: Anfang
  if (ei.kern.modus !== e.modus) return nichts('Modus geändert seit Laufbeginn – jetzt ' + (ei.kern.modus || 'leer'));
  // Sicherung Modus frisch: Ende
  var an = k.leseAnlagen(p.werte.anlagen);
  if (!an.ok) return nichts('Tabellenaufbau falsch – Blatt Anlagen');
  var tb = k.pruefeTextbausteine(p.werte.textbausteine);
  var plan = k.planeLauf({ einstellungen: ei.kern, stichtag: e.stichtag, anlagen: an.anlagen, sperrzeilen: p.sperrzeilen || [],
    antworten: e.antworten || {}, antworten_gelesen: e.antworten_gelesen === true, textbausteine_fehler: tb.fehler || [],
    heute_versendet: k.heuteVersendet ? k.heuteVersendet(p.sperrzeilen || [], an.anlagen, e.stichtag) : [] }); // A1: Tagesgrenze frisch
  var d = plan.entscheidungen.filter(function (x) { return x.anlagen_id === e.anlagen_id; });
  if (d.length !== 1) return nichts(d.length ? 'Anlagen-ID doppelt' : 'Zeile nicht mehr in der Tabelle');
  var v = k.vergleichePlanung({ aktion: e.aktion, faelligkeit: e.faelligkeit, vorgang: e.vorgang }, d[0]);
  if (!v.gleich) return nichts(v.grund);
  var anl = an.anlagen.filter(function (a) { return a.anlagen_id === e.anlagen_id; })[0];
  return { schritt: 'senden', grund: '', d: d[0], anlage: anl };
}

// x = { werte_einstellungen (Rohwerte), modus, anlage (leseAnlagen), aktion, faelligkeit, textbausteine (Rohwerte),
//       referenz: referenzAusThread(...) oder null } -> { ok, fehler } oder { ok, an, betreff, text, raw, thread_id, vorgang }
function baueKundenmail(x, k) {
  var nein = function (f) { return { ok: false, fehler: [].concat(f) }; };
  var ei = k.leseEinstellungen(x.werte_einstellungen);
  if (!ei.ok) return nein('Einstellungen unvollständig');
  var ad = k.leseAdressenWartung(x.werte_einstellungen);
  var emp = k.waehleEmpfaenger(x.modus, x.anlage.email, ad.testempfaenger);
  if (!emp.senden) return nein(emp.grund);
  if (!vsMailOk(ad.absenderadresse)) return nein('Absenderadresse fehlt oder ungültig');
  if (!vsMailOk(ad.antwort_an)) return nein('Antwort an fehlt oder ungültig');
  var art = VS_ARTEN_W[x.aktion];
  if (!art) return nein('Aktion unbekannt ' + x.aktion);
  var vorgang = k.vorgangNummer(x.anlage.anlagen_id, x.faelligkeit);
  var m = k.baueMail(art, { kunde: x.anlage.kunde, anlage: x.anlage.anlage, faellig_monat: k.faelligMonat(x.faelligkeit), vorgang: vorgang,
    firma: ei.kern.firma, telefon: ei.kern.telefon, signatur: ei.kern.signatur }, x.textbausteine);
  if (!m.ok) return nein(m.fehler);
  var zeilen = [];
  var thread = '';
  if (x.aktion === 'erinnerung') {
    // Sicherung Erinnerung im Thread: Anfang
    if (!x.referenz || !x.referenz.message_id || !x.referenz.thread_id) return nein('Erinnerung ohne erste eigene Mail im Thread – nicht versendet');
    zeilen.push('In-Reply-To: ' + x.referenz.message_id, 'References: ' + x.referenz.message_id);
    thread = x.referenz.thread_id;
    // Sicherung Erinnerung im Thread: Ende
  }
  zeilen.push(abmeldeKopf(ad.antwort_an, vorgang)); // Sicherung Abmeldung per Klick
  var n = kopfEinfuegen(k.baueMime({ von_name: ei.kern.absendername, von_adresse: ad.absenderadresse, an: emp.an, antwort_an: ad.antwort_an,
    betreff: m.betreff, text: m.text }), zeilen);
  return { ok: true, an: emp.an, betreff: m.betreff, text: m.text, raw: k.mimeRaw(n), thread_id: thread, vorgang: vorgang };
}

// x = { zeile, aktion, datum (JJJJ-MM-TT, Versandtag Berlin), thread_id } -> Bereiche fuer values:batchUpdate (RAW), Spalten nach
// Namen. Die Erinnerung laesst die Thread-ID des Angebots stehen (dort liegt die erste Mail, die Vorgangssuche findet den Rest).
function zellenNachVersand(x, kopf) {
  var k = (kopf || []).map(vsText);
  var i = function (s) {
    var n = k.indexOf(s);
    if (n < 0) throw new Error('Versand - Spalte fehlt ' + s);
    return n;
  };
  if (k[0] !== 'Anlagen-ID') throw new Error('Versand - Kopfzeile Anlagen ungültig');
  var z = Number(x.zeile);
  if (!Number.isInteger(z) || z < 2) throw new Error('Versand - Zeile ungültig');
  var r = function (s, v) { return { range: "'Anlagen'!" + vsSpalte(i(s)) + z, values: [[v]] }; };
  if (x.aktion === 'angebot') return [r('Angebot am', vsSerial(x.datum)), r('Thread-ID', vsText(x.thread_id)), r('Status', VS_STATUS_W.angebot)];
  if (x.aktion === 'erinnerung') return [r('Erinnerung am', vsSerial(x.datum)), r('Status', VS_STATUS_W.erinnerung)];
  throw new Error('Versand - Aktion unbekannt ' + x.aktion);
}

// A3 (Auftrag 27.09.2026 nachmittags): Spalte "Versandstatus klären" - nach Mahnlauf bau/kern/versand.js klaereVersandstatus
// (Commit 61022e4), angepasst: Schluessel "aktion|Anlagen-ID|Faelligkeit" statt "Rechnungsnr.|Stufe", ohne Stufenpruefung, dazu die
// Thread-ID einer vorhandenen Versandbestaetigung. Nicht byte-gleich (andere Signatur); die Entscheidung ist dieselbe:
// - versendet + Reservierung eines abgebrochenen Laufs -> nachziehen mit dem Stichtag dieses Laufs, Eintrag "versendet";
//   steht "versendet" schon in der Data Table (Blatt damals nicht geschrieben) -> nachziehen mit dem Datum von dort, kein Eintrag.
// - nicht versendet + offene Reservierung -> Eintrag "zurueckgegeben", der naechste Lauf entscheidet neu. Ohne Reservierung nur
//   die Zelle leeren. Widerspricht einer Versandbestaetigung -> Hinweis.
// - alles andere -> Hinweis, nichts geaendert, die Zelle bleibt (die Mail bleibt angehalten).
// -> null (Zelle leer) oder { aktion, schluessel, datum, thread_id, grund, eintrag }
function klaereVersandstatusWartung(wert, schluessel, zeilen, laufId, laufStart, stichtag) {
  var w = vsText(wert).toLowerCase();
  if (!w) return null;
  var aus = function (aktion, grund, datum, eintrag, thread) {
    return { aktion: aktion, schluessel: schluessel, datum: datum || '', thread_id: thread || '', grund: grund, eintrag: eintrag || null };
  };
  if (w !== 'versendet' && w !== 'nicht versendet') {
    return aus('hinweis', 'Versandstatus klären: Wert „' + vsText(wert) + '“ unbekannt (erlaubt: versendet, nicht versendet)');
  }
  var eigene = (zeilen || []).filter(function (r) { return r && vsText(r.schluessel) === schluessel; });
  var s = sperreEntscheid(eigene, laufId, laufStart);
  var bestaetigt = s.erledigt && s.erledigt.aktion === 'versendet';
  if (w === 'versendet') {
    if (s.tot) return aus('versandstatus_versendet', 'Versandstatus geklärt: versendet – nachgezogen', stichtag, { aktion: 'versendet', datum: stichtag });
    if (bestaetigt) {
      var d = /^\d{4}-\d{2}-\d{2}$/.test(vsText(s.erledigt.datum)) ? vsText(s.erledigt.datum) : stichtag;
      return aus('versandstatus_versendet', 'Versandstatus geklärt: versendet – nachgezogen', d, null, vsText(s.erledigt.thread_id));
    }
    return aus('hinweis', 'Versandstatus klären ohne offene Reservierung – nichts geändert'); // Sicherung Versandstatus ohne Reservierung
  }
  if (s.tot) {
    return aus('versandstatus_zurueck', 'Versandstatus geklärt: nicht versendet – Reservierung zurückgegeben, nächster Lauf entscheidet neu', stichtag,
      { aktion: 'zurueckgegeben', datum: stichtag });
  }
  if (bestaetigt) return aus('hinweis', 'Versandstatus klären „nicht versendet“ widerspricht der Versandbestätigung – nichts geändert');
  if (s.grund === 'keine Reservierung') {
    return aus('versandstatus_zurueck', 'Versandstatus geklärt: nicht versendet – keine offene Reservierung, Zelle geleert', stichtag, null);
  }
  return aus('hinweis', 'Versandstatus klären: Reservierung eines laufenden Laufs – im nächsten Lauf erneut');
}

// A3: Suche im Gesendet-Ordner nach einer Reservierung eines abgebrochenen Laufs - ueber die Vorgangsnummer (jeder Betreff traegt
// {vorgang}), ab 60 s vor der Reservierung. Gefunden -> nachziehen; nicht gefunden -> versand_unklar. Nie erneut senden.
function gesendetSuche(vorgang, totZeit) {
  var v = vsText(vorgang).replace(/"/g, '');
  var ms = Date.parse(vsText(totZeit));
  if (!v || !isFinite(ms)) throw new Error('Versand - Gesendet-Suche ohne Vorgang oder Zeitpunkt');
  return 'in:sent subject:"' + v + '" after:' + (Math.floor(ms / 1000) - 60);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { klaereVersandstatusWartung, gesendetSuche, versandSchluessel, sperreEntscheid, abmeldeKopf, kopfEinfuegen, referenzAusThread, neuEntscheidenVersand, baueKundenmail,
    nachpruefung, handVersandAuswerten, zellenNachVersand };
}
