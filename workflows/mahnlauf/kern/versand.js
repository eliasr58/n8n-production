// Mahnlauf, Kernlogik: Versand EINER Rechnung (BAUPLAN c und e 6; Baustein 7).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Der Unterworkflow "Versand" bekommt je
// Rechnung die geplante Aktion des Hauptlaufs und entscheidet UNMITTELBAR vor dem Versand neu, aus
// frisch gelesener Tabelle (Zeile, Buch "Zahlungseingaenge", Textbausteine, Einstellungen). Die
// Funktionen der anderen Module kommen als Parameter k herein - im Code-Node stehen sie im selben
// Rumpf, in den Tests kommen sie per require.
//
// Reihenfolge je Versand (BAUPLAN e 6): neu lesen -> Sperre/Klaerfall-Halt/Mindestbetrag (entscheide)
// -> Sperre in der Data Table (Reservierung, frueheste id gewinnt) -> senden -> Nachpruefung im
// Gesendet-Ordner -> "versendet" in die Data Table -> erst dann Stufe und Datum in "Offene Posten".
// Modus test: Empfaenger ist IMMER der Testempfaenger (waehleEmpfaenger, stufen.js); ein Entwurf, der
// einen anderen Empfaenger traegt, wird nicht gesendet.
//
// Nachbau 25.09.2026 (Auftrag Elias, Teil B):
// - B 1: Absendername und -adresse kommen aus dem Einstellungsblatt; die Nachricht baut mime.js, fuer den
//   direkten Versand und den Entwurf gleich.
// - B 4: Eine Reservierung eines abgebrochenen Laufs (anderer Lauf, zeit_utc vor dem Beginn dieses Laufs, kein
//   "versendet") wird nie ueberschrieben: Versand -> Suche im Gesendet-Ordner ab der Reservierung (gefunden:
//   nachziehen; nicht gefunden: Klaerfall "Versandstatus unklar", nie erneut senden); Entwurf -> Suche in den
//   Entwuerfen. "zurueckgegeben" gibt einen Schluessel frei, wenn feststeht, dass nichts versendet wurde.
// - B 6: PDF anhaengen = ja -> die Drive-ID aus dem Link; fehlt oder scheitert die PDF, wird nicht versendet.

var VS_AKTIONEN = ['senden', 'entwurf_anlegen', 'entwurf_ersetzen', 'entwurf_senden', 'entwurf_verwerfen', 'wartet', 'uebergabe'];
var VS_ERLEDIGT = ['versendet', 'angelegt', 'erledigt'];
var VS_NEUBEGINN = ['verworfen', 'zurueckgegeben'];
var VS_STUFENNAME = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: 'letzte Mahnung', 4: 'Übergabe' };

function vsText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// Eingang { tabelle_id, lauf_id, lauf_start, modus, stichtag, sperre_tabelle_id, rechnungsnr, quelle_id, aktion, stufe }.
// Ein fehlendes Feld ist ein Fehler des Aufrufers (unerwartet) -> Wurf, ohne ": " (Code-Node kuerzt).
function pruefeEingangVersand(e) {
  if (!e || typeof e !== 'object') throw new Error('Versand - Eingang fehlt');
  ['tabelle_id', 'lauf_id', 'lauf_start', 'stichtag', 'sperre_tabelle_id', 'rechnungsnr'].forEach(function (f) {
    if (!vsText(e[f])) throw new Error('Versand - Eingang ohne ' + f);
  });
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(vsText(e.lauf_start))) throw new Error('Versand - lauf_start nicht im Format ISO UTC');
  if (e.modus === 'trocken') throw new Error('Versand im Modus trocken aufgerufen - Aufruffehler');
  if (e.modus !== 'test' && e.modus !== 'scharf') throw new Error('Versand - Modus unbekannt ' + e.modus);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vsText(e.stichtag))) throw new Error('Versand - Stichtag nicht im Format JJJJ-MM-TT');
  if (!Number.isInteger(e.quelle_id) || e.quelle_id < 2) throw new Error('Versand - quelle_id muss Blattzeile ab 2 sein');
  if (VS_AKTIONEN.indexOf(e.aktion) < 0) throw new Error('Versand - Aktion unbekannt ' + e.aktion);
  if (!Number.isInteger(e.stufe) || e.stufe < 1 || e.stufe > 4) throw new Error('Versand - Stufe ungültig ' + e.stufe);
  return Object.assign({}, e, { tabelle_id: vsText(e.tabelle_id), lauf_id: vsText(e.lauf_id), rechnungsnr: vsText(e.rechnungsnr) });
}

// Sperrschluessel je Vorgang. Versand an den Kunden: "Rechnungsnr.|Stufe" (BAUPLAN e 6.4). Einen
// Entwurf anzulegen ist ein eigener Vorgang (sonst saehe der Versand danach "schon erledigt");
// ersetzen haengt die alte Entwurf-ID an, damit jede Ersetzung ihren eigenen Schluessel hat.
function sperrSchluessel(schritt, rechnungsnr, stufe, alteEntwurfId) {
  var basis = vsText(rechnungsnr) + '|' + String(stufe);
  if (schritt === 'senden' || schritt === 'entwurf_senden' || schritt === 'uebergabe') return basis;
  if (schritt === 'entwurf_anlegen' || schritt === 'entwurf_verwerfen') return basis + '|entwurf';
  if (schritt === 'entwurf_ersetzen') return basis + '|entwurf|' + vsText(alteEntwurfId);
  return '';
}

// zeilen: Data-Table-Zeilen EINES Schluessels. Sortiert wird hier nach id (die Lesung sortiert auch;
// doppelt haelt). Eine Zeile "verworfen" oder "zurueckgegeben" beginnt den Schluessel neu: gezaehlt wird nur,
// was danach kam (sonst bliebe nach einem verworfenen Entwurf jeder neue Entwurf derselben Stufe "schon angelegt").
// laufStart (B 4): Beginn dieses Laufs (ISO UTC). Eine Reservierung eines anderen Laufs mit zeit_utc davor ist die
// eines abgebrochenen Laufs (tot); eine gleichzeitige (T10 b) liegt danach. Ohne laufStart keine Pruefung auf tot.
// -> { weiter, grund, erledigt[, tot] }
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

function vsSuchtext(s) {
  return vsText(s).replace(/"/g, '');
}

// Entscheidung nach der Sperre (vorher im Code-Node "Sperre prüfen"). n: Ergebnis von neuEntscheiden, s: sperreEntscheid.
function schrittNachSperre(n, s) {
  var aus = Object.assign({}, n, { sperre: { weiter: s.weiter, grund: s.grund } });
  if (s.weiter) return aus;
  var x = s.erledigt;
  var versand = n.schritt === 'senden' || n.schritt === 'entwurf_senden';
  var entwurf = n.schritt === 'entwurf_anlegen' || n.schritt === 'entwurf_ersetzen';
  if (x && x.aktion === 'versendet' && versand) {
    return Object.assign(aus, { schritt: 'nachziehen', grund: 'schon versendet – Stufe nachgezogen', erledigt: { gmail_id: x.gmail_id, datum: x.datum } });
  }
  if (x && x.aktion === 'erledigt' && n.schritt === 'uebergabe') {
    return Object.assign(aus, { schritt: 'nachziehen', grund: 'Übergabe schon erledigt – nachgezogen', erledigt: { gmail_id: '', datum: x.datum } });
  }
  if (x && x.aktion === 'angelegt' && entwurf) {
    return Object.assign(aus, { schritt: 'nachziehen_entwurf', grund: 'Entwurf schon angelegt – nachgezogen', erledigt: { gmail_id: x.gmail_id, datum: x.datum } });
  }
  if (s.tot) {
    var lauf = vsText(s.tot.lauf_id);
    var ab = Math.floor(Date.parse(s.tot.zeit_utc) / 1000) - 60;
    if (versand) {
      return Object.assign(aus, { schritt: 'versand_klaeren', grund: 'Reservierung eines abgebrochenen Laufs (Lauf ' + lauf + ') – im Gesendet-Ordner suchen',
        tot_lauf: lauf, tot_zeit: s.tot.zeit_utc, such_q: 'in:sent subject:"' + vsSuchtext(n.such_betreff) + '" after:' + ab });
    }
    if (n.schritt === 'uebergabe') {
      return Object.assign(aus, { sperre: { weiter: true, grund: 'Reservierung eines abgebrochenen Laufs übergangen – Übergabe ohne Mail' } });
    }
    if (entwurf) {
      return Object.assign(aus, { schritt: 'entwurf_klaeren', grund: 'Reservierung eines abgebrochenen Laufs (Lauf ' + lauf + ') – Entwürfe suchen',
        tot_lauf: lauf, tot_zeit: s.tot.zeit_utc, such_q: 'subject:"' + vsSuchtext(n.such_betreff) + '"' });
    }
  }
  return Object.assign(aus, { schritt: 'nichts', grund: s.grund, alarm: s.grund === 'keine Reservierung' });
}

// Antwort von drafts.list?q=subject:"…" -> { gefunden, entwurf_id }
function entwurfSucheAuswerten(antwort) {
  if (!antwort || antwort.statusCode !== 200) throw new Error('Versand - Entwurf-Suche abgelehnt, HTTP ' + (antwort && antwort.statusCode));
  var d = (antwort.body && antwort.body.drafts) || [];
  return d.length ? { gefunden: true, entwurf_id: String(d[0].id) } : { gefunden: false, entwurf_id: '' };
}

// B 6: Drive-ID aus einem Link (…/file/d/<ID>/…, …?id=<ID>) oder der blanken ID.
function pdfIdAusLink(link) {
  var s = vsText(link);
  if (!s) return '';
  var m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}

// Antwort von Drive files.get (fields id,name,mimeType,size,trashed; Never Error) -> { ok, grund[, name, bytes] }
function pdfMetaPruefen(antwort, maxBytes) {
  var st = antwort && antwort.statusCode;
  if (st === 404) return { ok: false, grund: 'PDF nicht gefunden' };
  if (st !== 200) return { ok: false, grund: 'PDF nicht lesbar, HTTP ' + st };
  var b = antwort.body || {};
  if (b.trashed === true) return { ok: false, grund: 'PDF im Papierkorb' };
  if (b.mimeType !== 'application/pdf') return { ok: false, grund: 'Datei ist keine PDF (' + vsText(b.mimeType) + ')' };
  var g = Number(b.size);
  if (!(g > 0)) return { ok: false, grund: 'PDF leer' };
  if (g > maxBytes) return { ok: false, grund: 'PDF zu groß (' + g + ' Byte, erlaubt ' + maxBytes + ')' };
  return { ok: true, grund: '', name: vsText(b.name), bytes: g };
}

// Geladene Bytes (Buffer oder Array) -> { ok, grund }. Eine PDF beginnt mit "%PDF-".
function pdfInhaltPruefen(bytes, maxBytes) {
  var b = bytes || [];
  if (!b.length) return { ok: false, grund: 'PDF leer' };
  if (b.length > maxBytes) return { ok: false, grund: 'PDF zu groß (' + b.length + ' Byte, erlaubt ' + maxBytes + ')' };
  if (String.fromCharCode(b[0], b[1], b[2], b[3], b[4]) !== '%PDF-') return { ok: false, grund: 'Datei beginnt nicht mit %PDF-' };
  return { ok: true, grund: '' };
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

// Antwort von drafts.get (format metadata, Never Error) -> { status, to }
function entwurfAuswerten(antwort) {
  var st = antwort && antwort.statusCode;
  if (st === 404) return { status: 404, to: [] };
  if (st !== 200) throw new Error('Versand - Entwurf lesen abgelehnt, HTTP ' + st);
  var m = (antwort.body && antwort.body.message) || {};
  return { status: 200, to: vsAdressen(vsKopf(m.payload && m.payload.headers, 'To')) };
}

function vsTextbaustein(werte, stufe, kundentyp) {
  var w = werte || [];
  var kopf = (w[0] || []).map(vsText);
  var i = { stufe: kopf.indexOf('Stufe'), typ: kopf.indexOf('Kundentyp'), betreff: kopf.indexOf('Betreff'), text: kopf.indexOf('Text') };
  if (i.stufe < 0 || i.typ < 0 || i.betreff < 0 || i.text < 0) return { fehler: 'Blatt Textbausteine ohne Spalte Stufe/Kundentyp/Betreff/Text' };
  var treffer = w.slice(1).filter(function (z) {
    return Number(vsText(z[i.stufe])) === stufe && vsText(z[i.typ]).toUpperCase() === kundentyp;
  });
  if (treffer.length !== 1) return { fehler: 'Textbaustein Stufe ' + stufe + ' ' + kundentyp + (treffer.length ? ' mehrfach' : ' fehlt') };
  return { betreff: treffer[0][i.betreff], text: treffer[0][i.text] };
}

function vsPlatzhalterFehler(f) {
  var unbekannt = f.filter(function (x) { return x.grund === 'unbekannt'; }).map(function (x) { return x.platzhalter; });
  var leer = f.filter(function (x) { return x.grund === 'leer'; }).map(function (x) { return x.platzhalter; });
  var sonst = f.filter(function (x) { return x.grund !== 'unbekannt' && x.grund !== 'leer'; }).map(function (x) { return x.grund; });
  var t = [];
  if (unbekannt.length) t.push('Platzhalter unbekannt: ' + unbekannt.join(', '));
  if (leer.length) t.push('Platzhalter leer: ' + leer.join(', '));
  if (sonst.length) t.push('Klammer ' + sonst.join(', '));
  return t.join('; ');
}

// p = { eingang (geprueft), werte: { einstellungen, offene_posten, buch, textbausteine } (Rohwerte),
//       entwurf: Ergebnis von entwurfAuswerten oder null (nicht gelesen) }
// k = Funktionen aus einstellungen, offene-posten, zahlungseingaenge, zuordnung, stufen, hauptlauf,
//     platzhalter, meldung.
// -> { schritt, grund, alarm, meldungen, zeile, rechnungsnr, stufe, empfaenger, betreff, text,
//      sperre_schluessel, entwurf_id, alte_entwurf_id, rest_cent, status_zahlstand }
function neuEntscheiden(p, k) {
  var e = p.eingang;
  var w = p.werte || {};
  var aus = { schritt: 'nichts', grund: '', alarm: false, meldungen: [], zeile: e.quelle_id, rechnungsnr: e.rechnungsnr, stufe: e.stufe,
    empfaenger: '', betreff: '', text: '', sperre_schluessel: '', entwurf_id: '', alte_entwurf_id: '', rest_cent: null, status_zahlstand: '',
    von_name: '', von_adresse: '', antwort_an: '', such_betreff: '', pdf_id: '' };
  var nichts = function (grund, alarm) { aus.schritt = 'nichts'; aus.grund = grund; aus.alarm = !!alarm; return aus; };

  var einst = k.leseEinstellungen(w.einstellungen);
  if (!einst.ok) return nichts('Einstellungen unvollständig – fehlt ' + einst.fehlend.join(', '), true);
  var adressen = k.leseAdressen(w.einstellungen);
  aus.von_name = vsText(einst.kern.absendername);
  aus.von_adresse = vsText(adressen.absenderadresse);
  aus.antwort_an = vsMailOk(adressen.antwort_an) ? vsText(adressen.antwort_an) : '';
  var op = k.leseOffenePosten({ blaetter: ['Offene Posten', 'Einstellungen', 'Zahlungseingänge', 'Protokoll', 'Textbausteine'],
    zeitzone: 'Europe/Berlin', werte: w.offene_posten, quelle: { art: 'Sheet' }, stichtag: e.stichtag });
  if (op.status !== 'ok') return nichts('Tabellenaufbau falsch (Offene Posten)', true);
  var buch = k.leseZahlungseingaenge(w.buch);
  if (!buch.ok) return nichts('Tabellenaufbau falsch (Zahlungseingänge)', true);
  var ein = k.zuordnungsEingabe(buch.zeilen);
  var zuo = k.ordneZahlungenZu({ rechnungen: op.posten.map(function (x) {
    return { rechnungsnr: x.rechnungsnr, kunde: x.kunde, betrag_brutto_cent: x.betrag_brutto_cent, mahnsperre: x.mahnsperre };
  }), zahlungen: ein.zahlungen, klaerfaelle: ein.klaerfaelle, manuell: ein.manuell, muster: einst.kern.muster });
  var rechnungen = k.mitZahlstand(k.baueRechnungen(op.posten, k.leseZustand(w.offene_posten)), zuo.rechnungen);
  var idx = -1;
  op.posten.forEach(function (x, i) { if (x.quelle_id === e.quelle_id) idx = i; });
  if (idx < 0) return nichts('Zeile verschoben – Zeile ' + e.quelle_id + ' ist leer');
  var r = rechnungen[idx];
  if (vsText(r.rechnungsnr) !== e.rechnungsnr) return nichts('Zeile verschoben – an Zeile ' + e.quelle_id + ' steht ' + vsText(r.rechnungsnr));
  aus.rest_cent = r.rest_cent;
  aus.status_zahlstand = r.status;
  var hatEntwurf = vsText(r.entwurf_id) !== '';
  aus.entwurf_id = vsText(r.entwurf_id);
  var kundentyp = vsText(r.kundentyp).toUpperCase();

  var texte = function (stufe) {
    var tb = vsTextbaustein(w.textbausteine, stufe, kundentyp);
    if (tb.fehler) return { fehler: tb.fehler };
    var werte = k.bauePlatzhalterWerte(r, einst.kern, e.stichtag);
    var b = k.fuellePlatzhalter(tb.betreff, werte);
    var t = k.fuellePlatzhalter(tb.text, werte);
    var f = (b.ok ? [] : b.fehler).concat(t.ok ? [] : t.fehler);
    if (f.length) return { fehler: vsPlatzhalterFehler(f), baustein: 'Textbaustein Stufe ' + stufe + ' ' + kundentyp };
    return { betreff: b.text, text: t.text };
  };

  var mitMail = ['senden', 'entwurf_anlegen', 'entwurf_ersetzen', 'entwurf_senden', 'wartet'].indexOf(e.aktion) >= 0;
  if (mitMail) {
    var tbp = k.pruefeTextbausteine(w.textbausteine);
    if (!tbp.ok) return nichts('Textbausteine ungültig – ' + tbp.fehler.join('; '), true); // Sicherung Textbausteine im Versand
  }

  // T18: Entwurf von Hand versendet? Die Zeile traegt eine Entwurf-ID, den Entwurf gibt es nicht mehr.
  if (hatEntwurf && p.entwurf && p.entwurf.status === 404) {
    var st = (Number.isInteger(r.aktuelle_stufe) ? r.aktuelle_stufe : Number(r.aktuelle_stufe)) + 1;
    var tx = texte(st);
    aus.stufe = st;
    if (tx.fehler) return nichts('Entwurf fehlt; Betreff zum Suchen nicht baubar – ' + tx.fehler, true);
    aus.schritt = 'hand_versand_suchen';
    aus.grund = 'Entwurf fehlt – im Gesendet-Ordner suchen';
    aus.betreff = tx.betreff;
    aus.such_betreff = tx.betreff;
    return aus;
  }

  var d = k.entscheide(r, einst.kern, e.stichtag);
  if (d.aktion !== e.aktion || d.stufe !== e.stufe) return nichts('geändert seit Laufbeginn: ' + d.aktion); // Sicherung Neu entscheiden
  if (e.aktion === 'wartet') return nichts('wartet auf Freigabe');

  var emp = k.waehleEmpfaenger(e.modus, r.email, adressen.testempfaenger);
  if (!emp.senden && e.aktion !== 'entwurf_verwerfen' && e.aktion !== 'uebergabe') return nichts(emp.grund, true);
  aus.empfaenger = emp.an || '';

  var neueMail = e.aktion === 'senden' || e.aktion === 'entwurf_anlegen' || e.aktion === 'entwurf_ersetzen';
  if (neueMail && !vsMailOk(aus.von_adresse)) return nichts('Absenderadresse fehlt oder ungültig', true);
  if (neueMail) {
    var t3 = texte(e.stufe);
    if (t3.fehler) {
      aus.meldungen.push({ rechnungsnr: e.rechnungsnr, text: (t3.baustein || 'Textbaustein') + ': ' + t3.fehler + ' – keine Mail' });
      return nichts(t3.fehler);
    }
    aus.betreff = t3.betreff;
    aus.text = t3.text;
    aus.such_betreff = t3.betreff;
    var pdfModus = vsText(einst.kern.pdf_anhaengen).toLowerCase();
    if (pdfModus !== 'ja' && pdfModus !== 'nein' && pdfModus !== '') return nichts('Einstellung PDF anhängen ungültig – ' + pdfModus, true);
    // Sicherung PDF anhängen: Anfang
    if (pdfModus === 'ja') {
      var link = vsText(op.posten[idx].pdf_ref);
      var pdfFehler = !link ? 'PDF fehlt – Link zur Rechnungs-PDF leer' : (!pdfIdAusLink(link) ? 'PDF-Link unlesbar' : '');
      if (pdfFehler) {
        aus.meldungen.push({ rechnungsnr: e.rechnungsnr, text: pdfFehler + ' – keine Mail' });
        return nichts(pdfFehler);
      }
      aus.pdf_id = pdfIdAusLink(link);
    }
    // Sicherung PDF anhängen: Ende
  }
  if (e.aktion === 'entwurf_senden') {
    var t4 = texte(e.stufe);
    aus.such_betreff = t4.fehler ? '' : t4.betreff;
    if (!p.entwurf || p.entwurf.status !== 200) return nichts('Entwurf nicht gelesen', true);
    if (e.modus === 'test' && !(p.entwurf.to.length === 1 && p.entwurf.to[0] === String(adressen.testempfaenger).trim().toLowerCase())) {
      return nichts('Modus test: Entwurf hat einen anderen Empfänger als den Testempfänger', true); // Sicherung Testempfänger Entwurf
    }
  }
  if (e.aktion === 'entwurf_ersetzen') aus.alte_entwurf_id = aus.entwurf_id;
  aus.schritt = e.aktion;
  aus.grund = d.grund;
  aus.sperre_schluessel = sperrSchluessel(e.aktion, e.rechnungsnr, e.stufe, aus.alte_entwurf_id);
  return aus;
}

// Antworten von messages.list (in:sent, Betreff) und messages.get (metadata) -> Versanddatum in Berlin.
function handVersandAuswerten(liste, nachricht, k) {
  if (!liste || liste.statusCode !== 200) throw new Error('Versand - Gesendet-Suche abgelehnt, HTTP ' + (liste && liste.statusCode));
  var ids = ((liste.body && liste.body.messages) || []).map(function (m) { return m.id; });
  if (!ids.length) return { gefunden: false, gmail_id: '', datum: '' };
  if (!nachricht || nachricht.statusCode !== 200) throw new Error('Versand - Nachricht lesen abgelehnt, HTTP ' + (nachricht && nachricht.statusCode));
  var ms = Number(nachricht.body.internalDate);
  return { gefunden: true, gmail_id: String(nachricht.body.id), datum: k.berlinZeit(new Date(ms).toISOString()).datum };
}

// Antwort von messages.get (metadata, To) nach dem Versand -> liegt die Nachricht im Gesendet-Ordner
// (Label SENT), und ist To genau der erwartete Empfaenger?
function nachpruefung(antwort, empfaenger) {
  if (!antwort || antwort.statusCode !== 200) return { im_gesendet: false, to_gleich_empfaenger: false, to_anzahl: 0 };
  var b = antwort.body || {};
  var to = vsAdressen(vsKopf(b.payload && b.payload.headers, 'To'));
  return { im_gesendet: (b.labelIds || []).indexOf('SENT') >= 0,
    to_gleich_empfaenger: to.length === 1 && to[0] === vsText(empfaenger).toLowerCase(), to_anzahl: to.length };
}

function vsSpalte(i) {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function vsSerial(iso) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return (Date.UTC(+r[1], +r[2] - 1, +r[3]) - Date.UTC(1899, 11, 30)) / 86400000;
}

function vsDatum(iso) {
  var t = String(iso).split('-');
  return t[2] + '.' + t[1] + '.' + t[0];
}

// e = { ergebnis, stufe, datum (JJJJ-MM-TT), zeile, entwurf_id, rest_cent, status }, kopf = Kopfzeile "Offene Posten"
// -> Bereiche fuer values:batchUpdate (RAW). Spalten nach Namen, nie nach fester Stelle.
function zustandNachVersand(e, kopf) {
  var k = (kopf || []).map(vsText);
  var zelle = function (name, wert) {
    var i = k.indexOf(name);
    if (i < 0) throw new Error('Versand - Spalte fehlt ' + name);
    return { range: "'Offene Posten'!" + vsSpalte(i) + e.zeile, values: [[wert]] };
  };
  var name = VS_STUFENNAME[e.stufe] || ('Stufe ' + e.stufe);
  var versendet = function (text) {
    return [zelle('aktuelle Stufe', e.stufe), zelle('Datum letzte Stufe', vsSerial(e.datum)), zelle('Protokoll', text),
      zelle('Status', e.stufe >= 4 ? 'übergeben' : 'offen'), zelle('Freigabe', ''), zelle('Entwurf-ID', ''), zelle('Entwurf-Restbetrag', '')];
  };
  if (e.ergebnis === 'versendet') return versendet(name + ' versendet ' + vsDatum(e.datum));
  if (e.ergebnis === 'hand_versendet') return versendet(name + ' von Hand versendet ' + vsDatum(e.datum));
  if (e.ergebnis === 'nachgezogen') return versendet(name + ' versendet ' + vsDatum(e.datum) + ' (nachgezogen)');
  if (e.ergebnis === 'entwurf_angelegt') {
    return [zelle('Protokoll', name + ' Entwurf angelegt ' + vsDatum(e.datum)), zelle('Status', 'wartet auf Freigabe'),
      zelle('Freigabe', ''), zelle('Entwurf-ID', e.entwurf_id), zelle('Entwurf-Restbetrag', e.rest_cent / 100)];
  }
  if (e.ergebnis === 'entwurf_verworfen') {
    return [zelle('Protokoll', 'Entwurf verworfen ' + vsDatum(e.datum)), zelle('Status', vsText(e.status) || 'offen'),
      zelle('Freigabe', ''), zelle('Entwurf-ID', ''), zelle('Entwurf-Restbetrag', '')];
  }
  if (e.ergebnis === 'versand_unklar') {
    return [zelle('Protokoll', 'Versandstatus unklar – ' + name + ' nicht bestätigt ' + vsDatum(e.datum) + ' – bitte „Versandstatus klären“ setzen'),
      zelle('Status', 'Klärfall')];
  }
  if (e.ergebnis === 'uebergeben') {
    return [zelle('aktuelle Stufe', 4), zelle('Datum letzte Stufe', vsSerial(e.datum)),
      zelle('Protokoll', 'Übergabe an den Betrieb ' + vsDatum(e.datum)), zelle('Status', 'übergeben')];
  }
  return [];
}

// Spalte "Versandstatus klaeren" (Entscheidung Elias 25.09.2026, Baustein 10 Teil A 4): leer / versendet / nicht versendet.
// Sie loest einen "Versandstatus unklar" auf (Reservierung eines abgebrochenen Laufs, im Gesendet-Ordner nicht gefunden).
// Geprueft wird der Schluessel der naechsten Stufe ("Rechnungsnr.|Stufe", wie beim Versand) in der Data Table:
// - versendet + offene Reservierung eines abgebrochenen Laufs -> Stufe und Datum nachziehen, Datum = Stichtag des Laufs,
//   der den Eintrag verarbeitet (die Sheets-API kennt kein Bearbeitungsdatum je Zelle; Rueckfrage Elias 25.09.2026);
//   Eintrag "versendet" in die Data Table. Steht "versendet" dort schon (Blatt damals nicht geschrieben): nachziehen mit
//   dem Datum von dort, kein zweiter Eintrag.
// - nicht versendet + offene Reservierung -> Eintrag "zurueckgegeben" (Neubeginn des Schluessels), der naechste Lauf
//   entscheidet normal. Ohne Reservierung nur die Zelle leeren.
// - alles andere -> Hinweis, nichts geaendert, die Zelle bleibt stehen (die Zeile wird nicht versendet, stufen.js).
// -> null (Zelle leer) oder { aktion, stufe, schluessel, datum, grund, eintrag }
function klaereVersandstatus(wert, aktuelleStufe, rechnungsnr, zeilen, laufId, laufStart, stichtag) {
  var w = vsText(wert).toLowerCase();
  if (!w) return null;
  var stufe = Number(aktuelleStufe) + 1;
  var schluessel = vsText(rechnungsnr) + '|' + stufe;
  var aus = function (aktion, grund, datum, eintrag) {
    return { aktion: aktion, stufe: stufe, schluessel: schluessel, datum: datum || '', grund: grund, eintrag: eintrag || null };
  };
  if (w !== 'versendet' && w !== 'nicht versendet') {
    return aus('hinweis', 'Versandstatus klären: Wert „' + vsText(wert) + '“ unbekannt (erlaubt: versendet, nicht versendet)');
  }
  if (!(stufe >= 1 && stufe <= 3)) return aus('hinweis', 'Versandstatus klären nur für Stufe 1 bis 3');
  var eigene = (zeilen || []).filter(function (r) { return r && vsText(r.schluessel) === schluessel; });
  var s = sperreEntscheid(eigene, laufId, laufStart);
  var bestaetigt = s.erledigt && s.erledigt.aktion === 'versendet';
  if (w === 'versendet') {
    if (s.tot) return aus('versandstatus_versendet', 'Versandstatus geklärt: versendet – Stufe nachgezogen', stichtag, { aktion: 'versendet', datum: stichtag });
    if (bestaetigt) {
      var d = /^\d{4}-\d{2}-\d{2}$/.test(vsText(s.erledigt.datum)) ? vsText(s.erledigt.datum) : stichtag;
      return aus('versandstatus_versendet', 'Versandstatus geklärt: versendet – Stufe nachgezogen', d, null);
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

// rechnungen (baueRechnungen), zeilen: alle Zeilen der Data Table oder null (Modus trocken, keine Data Table)
// -> neue Rechnungen; jede mit Wert in "Versandstatus klaeren" traegt versandstatus_klaerung.
function versandstatusKlaerungen(rechnungen, zeilen, laufId, laufStart, stichtag) {
  return (rechnungen || []).map(function (r) {
    if (vsText(r.versandstatus_klaeren) === '') return r;
    var kl = zeilen === null ? { aktion: 'hinweis', grund: 'Versandstatus klären: im Modus trocken nicht verarbeitet' }
      : klaereVersandstatus(r.versandstatus_klaeren, r.aktuelle_stufe, r.rechnungsnr, zeilen, laufId, laufStart, stichtag);
    return Object.assign({}, r, { versandstatus_klaerung: kl });
  });
}

// posten (quelle_id = Blattzeile) und entscheidungen in derselben Reihenfolge, kopf = Kopfzeile "Offene Posten"
// -> { data: Bereiche fuer values:batchUpdate (RAW, zusammen mit H und Status), eintraege: Zeilen fuer die Data Table }.
// Status (P) schreibt bezahltUndStatus (hauptlauf.js).
function versandstatusAuftrag(posten, entscheidungen, kopf, laufId) {
  var k = (kopf || []).map(vsText);
  var data = [];
  var eintraege = [];
  (entscheidungen || []).forEach(function (d, i) {
    if (d.aktion !== 'versandstatus_versendet' && d.aktion !== 'versandstatus_zurueck') return;
    var kl = d.klaerung || {};
    var zeile = posten[i].quelle_id;
    var zelle = function (name, wert) {
      var j = k.indexOf(name);
      if (j < 0) throw new Error('Hauptlauf - Spalte fehlt ' + name);
      return { range: "'Offene Posten'!" + vsSpalte(j) + zeile, values: [[wert]] };
    };
    if (d.aktion === 'versandstatus_versendet') {
      data.push(zelle('aktuelle Stufe', kl.stufe), zelle('Datum letzte Stufe', vsSerial(kl.datum)),
        zelle('Protokoll', (VS_STUFENNAME[kl.stufe] || 'Stufe ' + kl.stufe) + ' versendet ' + vsDatum(kl.datum) + ' (Versandstatus geklärt)'),
        zelle('Freigabe', ''), zelle('Entwurf-ID', ''), zelle('Entwurf-Restbetrag', ''), zelle('Versandstatus klären', ''));
    } else {
      data.push(zelle('Protokoll', 'Versandstatus geklärt: nicht versendet ' + vsDatum(kl.datum) + ' – nächster Lauf entscheidet neu'),
        zelle('Versandstatus klären', ''));
    }
    if (kl.eintrag) {
      eintraege.push({ schluessel: kl.schluessel, aktion: kl.eintrag.aktion, lauf_id: String(laufId), rechnungsnr: d.rechnungsnr,
        stufe: kl.stufe, gmail_id: '', datum: kl.eintrag.datum });
    }
  });
  return { data: data, eintraege: eintraege };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeEingangVersand, sperrSchluessel, sperreEntscheid, schrittNachSperre, entwurfSucheAuswerten, pdfIdAusLink,
    pdfMetaPruefen, pdfInhaltPruefen, entwurfAuswerten, neuEntscheiden, handVersandAuswerten, nachpruefung, zustandNachVersand,
    klaereVersandstatus, versandstatusKlaerungen, versandstatusAuftrag };
}
