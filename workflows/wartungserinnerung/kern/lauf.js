// Wartungserinnerung, Kernlogik: "Antworten einordnen" (Baustein 4) und Hauptlauf (Baustein 5) - Antworten eines Threads
// aufbereiten und nach der KI abschliessen, Eingang fuer planeLauf, Protokollzeilen, Sammelmeldung.
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Die Funktionen der anderen Module (antwort.js, widerspruch.js,
// entscheidung.js) kommen als Parameter k herein - im Code-Node stehen sie im selben Rumpf, in den Tests kommen sie per
// require (Muster aus Mahnlauf versand.js). Antworttexte verlassen "Antworten einordnen" nie:
// einordnungAbschliessen gibt nur Klasse, Sperre, Datum und IDs heraus (BAUPLAN c 4.6, d Datensparsamkeit).
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ...") fuer die Gegenprobe durch Mutation.

var LA_THREAD_LINK = 'https://mail.google.com/mail/u/0/#all/';
var LA_SPERR_ID0 = 1e12;

// Übernommen aus Mahnlauf bau/kern/hauptlauf.js (Commit 61022e4), unverändert: hlZwei hlLetzterSonntag berlinZeit
function hlZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

function hlLetzterSonntag(jahr, monat) {
  var t = new Date(Date.UTC(jahr, monat, 0));
  return t.getUTCDate() - t.getUTCDay();
}

function berlinZeit(isoUtc) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(String(isoUtc));
  if (!m) throw new Error('Zeitpunkt nicht im Format JJJJ-MM-TTThh:mm:ssZ');
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  var j = +m[1];
  var sommer = ms >= Date.UTC(j, 2, hlLetzterSonntag(j, 3), 1) && ms < Date.UTC(j, 9, hlLetzterSonntag(j, 10), 1);
  var b = new Date(ms + (sommer ? 2 : 1) * 3600000);
  var datum = b.getUTCFullYear() + '-' + hlZwei(b.getUTCMonth() + 1) + '-' + hlZwei(b.getUTCDate());
  return { datum: datum, text: hlZwei(b.getUTCDate()) + '.' + hlZwei(b.getUTCMonth() + 1) + '.' + b.getUTCFullYear() + ' '
    + hlZwei(b.getUTCHours()) + ':' + hlZwei(b.getUTCMinutes()) + ':' + hlZwei(b.getUTCSeconds()) };
}

function laDatum(iso) {
  var t = String(iso || '').split('-');
  return t.length === 3 ? t[2] + '.' + t[1] + '.' + t[0] : String(iso || '');
}

// eingang: { anlagen_id, kunden_id, email_norm, thread_id, bekannt: [Gmail-ID], ki_an }; r: Ausgabe von threads.get
// (httpRequest 4.5, fullResponse, neverError); abMs: Untergrenze fuer einen Nebenthread ohne eigene Mail (Teil B).
// -> { gelesen, status, erste_eigene_ms, antworten: [...] }; Texte nur fuer die naechsten Knoten.
function antwortenAufbereiten(eingang, r, k, abMs) {
  var aus = { gelesen: false, status: r && r.statusCode !== undefined ? r.statusCode : 0, erste_eigene_ms: null, antworten: [] };
  if (!r || r.error || r.statusCode !== 200 || !r.body) return aus;
  aus.gelesen = true;
  var th = r.body;
  var bekannt = eingang.bekannt || [];
  var at = k.antwortenImThread(th, abMs);
  aus.erste_eigene_ms = at.erste_eigene_ms;
  at.antworten.forEach(function (x) {
    if (bekannt.indexOf(x.id) >= 0) return;
    var msg = (th.messages || []).filter(function (m) { return m.id === x.id; })[0];
    var a = { anlagen_id: eingang.anlagen_id, kunden_id: eingang.kunden_id, email_norm: eingang.email_norm,
      thread_id: eingang.thread_id, gmail_id: x.id, internalDate: x.internalDate,
      datum: berlinZeit(new Date(x.internalDate).toISOString()).datum, art: x.art,
      text_wortliste: '', ki_text: '', treffer: [], ki_noetig: false, alt: eingang.alt === true };
    if (x.art === 'antwort') {
      var t = k.textAusNachricht(msg).text;
      a.text_wortliste = k.textFuerWortliste(t);
      a.treffer = k.pruefeWortliste(a.text_wortliste);
      // Teil B: Abmeldung per Klick (List-Unsubscribe) kommt als "Abmelden <Vorgang>" mit einem Text von Gmail
      k.pruefeWortliste(k.betreffDerNachricht(msg)).forEach(function (w) { if (a.treffer.indexOf(w) < 0) a.treffer.push(w); }); // Sicherung Wortliste im Betreff
      a.ki_text = k.fuerKi(t).text;
      a.ki_noetig = eingang.ki_an === true && a.treffer.length === 0 && a.ki_text !== '';
    }
    aus.antworten.push(a);
  });
  return aus;
}

// a: eine Antwort aus antwortenAufbereiten; ki: Ausgabe des Aufrufs an Claude oder null; kiAn: Einstellung "KI-Einordnung".
// -> Ergebnis OHNE Text: { IDs, datum, art, klasse, gesperrt, grund, eingeordnet, ki_aufruf, ki_grund, aufgabe }
function einordnungAbschliessen(a, ki, kiAn, k) {
  var e = { anlagen_id: a.anlagen_id, kunden_id: a.kunden_id, email_norm: a.email_norm, thread_id: a.thread_id,
    gmail_id: a.gmail_id, internalDate: a.internalDate, datum: a.datum, art: a.art, klasse: '', gesperrt: false, grund: '',
    eingeordnet: true, ki_aufruf: !!ki, ki_grund: '', aufgabe: '', alt: a.alt === true };
  if (a.uebersprungen) {
    e.klasse = 'anderer Lauf';
    e.eingeordnet = false;
    e.aufgabe = 'Antwort wird in einem gleichzeitigen Lauf eingeordnet';
    return e;
  }
  if (a.art !== 'antwort') {
    if (a.alt) { e.klasse = 'ignoriert (alter Vorgang)'; return e; }
    if (a.art === 'unzustellbar') e.aufgabe = 'Mail unzustellbar – Adresse prüfen';
    return e;
  }
  var o;
  // Sicherung leerer Text sperrt: Anfang
  if (kiAn && (a.treffer || []).length === 0 && a.ki_text === '') {
    o = { gesperrt: true, grund: 'Zweifel', klasse: 'nicht eingeordnet', ki_grund: 'kein Text nach dem Kürzen' };
  }
  // Sicherung leerer Text sperrt: Ende
  // Teil B: ein Treffer aus dem Aufbereiten (auch im Betreff, z. B. "Abmelden <Vorgang>") sperrt wie die Wortliste, ohne KI.
  if (!o && (a.treffer || []).length) o = { gesperrt: true, grund: 'Wortliste', klasse: 'widerspruch' }; // Sicherung Treffer sperrt
  // Baustein 6: Reservierung eines abgebrochenen Laufs - der Text ging vielleicht schon an Claude; nicht erneut, der Betrieb liest.
  if (!o && a.ohne_ki) {
    o = k.ordneEin({ text: a.text_wortliste, ki_an: false, ki: null });
    o.ki_grund = 'Reservierung eines abgebrochenen Laufs – nicht erneut an die KI';
  }
  if (!o) {
    o = k.ordneEin({ text: a.text_wortliste, ki_an: kiAn, ki: ki });
    if (o.ki_noetig) o = k.ordneEin({ text: a.text_wortliste, ki_an: kiAn, ki: { error: 'keine KI-Antwort' } });
  }
  // A2 (Auftrag 27.09.2026 nachmittags): eine Antwort auf einen ALTEN Vorgang zaehlt nur als Widerspruch. Im Zweifel am Widerspruch
  // sperren (auch KI aus oder ohne Einordnung); jede andere Antwort wird ignoriert - keine Aufgabe, kein Antwortstand.
  // Sicherung alter Vorgang nur Widerspruch: Anfang
  if (a.alt && !o.gesperrt) {
    if (!kiAn || o.klasse === 'bitte lesen' || o.klasse === 'nicht eingeordnet') o = { gesperrt: true, grund: 'Zweifel', klasse: 'nicht eingeordnet', ki_grund: o.ki_grund || (!kiAn ? 'KI-Einordnung aus' : '') };
    else o = { gesperrt: false, grund: '', klasse: 'ignoriert (alter Vorgang)', ki_grund: o.ki_grund || '' };
  }
  // Sicherung alter Vorgang nur Widerspruch: Ende
  e.klasse = o.klasse;
  e.gesperrt = o.gesperrt;
  e.grund = o.grund;
  e.ki_grund = o.ki_grund || '';
  e.aufgabe = o.klasse === 'ignoriert (alter Vorgang)' ? '' : k.aufgabe(o.klasse);
  return e;
}

// ergebnisse: Ausgaben von einordnungAbschliessen; anlagen: aus leseAnlagen.
// -> { antworten: { Anlagen-ID: antwortStand }, sperrzeilen: neue Zeilen dieses Laufs, aufgaben: [...] }
function antwortenFuerPlan(ergebnisse, anlagen, k) {
  var je = {};
  var zeilen = [];
  var aufgaben = [];
  var anl = {};
  (anlagen || []).forEach(function (a) { if (!anl[a.anlagen_id]) anl[a.anlagen_id] = a; });
  (ergebnisse || []).forEach(function (x) {
    if (x.alt && !x.gesperrt) return; // A2: ignoriert
    if (!x.alt) (je[x.anlagen_id] = je[x.anlagen_id] || []).push(x);
    var a = anl[x.anlagen_id] || { kunden_id: x.kunden_id, email: x.email_norm, kunde: '', anlage: '' };
    if (x.gesperrt) {
      // Sicherung Sperre aus Antwort: Anfang
      k.sperrZeilen(a.kunden_id, a.email, x.grund).forEach(function (z) {
        z.id = LA_SPERR_ID0 + zeilen.length;
        zeilen.push(z);
      });
      // Sicherung Sperre aus Antwort: Ende
    }
    if (x.art === 'antwort') {
      aufgaben.push({ anlagen_id: x.anlagen_id, kunde: a.kunde, anlage: a.anlage, klasse: x.klasse, aufgabe: x.aufgabe,
        datum: x.datum, gesperrt: x.gesperrt, grund: x.grund, link: LA_THREAD_LINK + x.thread_id });
    }
  });
  var antworten = {};
  Object.keys(je).forEach(function (id) { antworten[id] = k.antwortStand(je[id]); });
  return { antworten: antworten, sperrzeilen: zeilen, aufgaben: aufgaben };
}

// Blatt "Protokoll": Zeitpunkt UTC, Zeitpunkt Berlin, Lauf-ID, Modus, Anlagen-ID, Aktion, Zyklus, Grund, Gmail-ID.
function protokollZeilen(plan, ergebnisse, lauf, versand) {
  var k = [lauf.zeit_utc, lauf.zeit_berlin, lauf.lauf_id, lauf.modus];
  var z = (plan.entscheidungen || []).map(function (d) {
    return k.concat([d.anlagen_id, d.aktion, d.vorgang || '', d.grund || '', '']);
  });
  (ergebnisse || []).forEach(function (x) {
    z.push(k.concat([x.anlagen_id, x.art === 'antwort' ? 'Antwort eingeordnet: ' + x.klasse : 'Nachricht erkannt: ' + x.art, '',
      x.gesperrt ? 'gesperrt (' + x.grund + ')' : '', x.gmail_id]));
  });
  (versand || []).forEach(function (v) {
    z.push(k.concat([v.anlagen_id, 'Versand ' + v.aktion + ': ' + v.ergebnis, v.vorgang || '', v.grund || '', v.gmail_id || '']));
  });
  return z;
}

// x: { firma, modus, stichtag, lauf_id, plan, aufgaben, anlagen } -> { betreff, text, alarm }. Nie ein Antworttext.
function baueSammelmeldung(x) {
  var anl = {};
  (x.anlagen || []).forEach(function (a) { if (!anl[a.anlagen_id]) anl[a.anlagen_id] = a; });
  var wer = function (id) { var a = anl[id] || {}; return (a.kunde || '?') + ', ' + (a.anlage || '?'); };
  var p = x.plan || {};
  var ve = Array.isArray(x.versand_ergebnisse) ? x.versand_ergebnisse : null;
  var alarme = (p.alarme || []).concat((ve || []).filter(function (v) { return v.ergebnis === 'versand_unklar'; }).map(function (v) {
    return { art: 'Versandstatus unklar', text: v.anlagen_id + ' (' + wer(v.anlagen_id) + ') – Vorgang ' + v.vorgang + ' – ' + v.grund };
  }));
  var trocken = x.modus === 'trocken';
  var betreff = (trocken ? '[TROCKEN – nichts versendet] ' : '') + (alarme.length ? 'ALARM – ' : '') + 'Wartungserinnerung '
    + x.firma + ' – ' + laDatum(x.stichtag);
  var t = ['Wartungserinnerung, Lauf ' + x.lauf_id + ', Modus ' + x.modus + ', Stichtag ' + laDatum(x.stichtag), ''];
  if (alarme.length) {
    t.push('ALARM:');
    alarme.forEach(function (a) { t.push('- ' + a.art + ': ' + a.text); });
    t.push('');
  }
  var mails = ve ? [] : (p.versand || []);
  var art = function (a) { return a === 'angebot' ? 'Angebot' : 'Erinnerung'; };
  var ja = (ve || []).filter(function (v) { return v.ergebnis === 'versendet'; });
  var nach = (ve || []).filter(function (v) { return v.ergebnis === 'nachgezogen' || v.ergebnis === 'schon versendet'; });
  var nein = (ve || []).filter(function (v) { return v.ergebnis !== 'versendet' && nach.indexOf(v) < 0; });
  if (ja.length) {
    t.push(x.modus === 'test' ? 'Versendet (Modus test: an den Testempfänger):' : 'Versendet:');
    ja.forEach(function (v) { t.push('- ' + art(v.aktion) + ' ' + v.anlagen_id + ' (' + wer(v.anlagen_id) + ') – Vorgang ' + v.vorgang); });
    t.push('');
  }
  if (nach.length) {
    t.push('Nachgezogen (war schon versendet, nicht erneut gesendet):');
    nach.forEach(function (v) { t.push('- ' + art(v.aktion) + ' ' + v.anlagen_id + ' (' + wer(v.anlagen_id) + ') – ' + v.grund); });
    t.push('');
  }
  if (nein.length) {
    t.push('Nicht versendet:');
    nein.forEach(function (v) { t.push('- ' + art(v.aktion) + ' ' + v.anlagen_id + ' (' + wer(v.anlagen_id) + ') – ' + v.grund); });
    t.push('');
  }
  if (mails.length) {
    t.push(trocken ? 'Geplant (nicht versendet):' : 'Mails:');
    mails.forEach(function (d) {
      t.push('- ' + (d.aktion === 'angebot' ? 'Angebot' : 'Erinnerung') + ' ' + d.anlagen_id + ' (' + wer(d.anlagen_id) + ') – Vorgang ' + d.vorgang);
    });
    t.push('');
  }
  // Teil A 7: zurueckgestellte Mails mit Grund - bei offener Antwort muss der Betrieb "Antwort erledigt" setzen, sonst bleibt der
  // Kunde ohne Mail; ohne diese Zeilen saehe er nicht, warum.
  var zur = (p.entscheidungen || []).filter(function (d) { return d.aktion_geplant === 'angebot' || d.aktion_geplant === 'erinnerung'; });
  if (zur.length) {
    t.push('Zurückgestellt (keine Mail in diesem Lauf):');
    zur.forEach(function (d) {
      t.push('- ' + (d.aktion_geplant === 'angebot' ? 'Angebot' : 'Erinnerung') + ' ' + d.anlagen_id + ' (' + wer(d.anlagen_id) + ') – ' + d.grund);
    });
    t.push('');
  }
  var auf = x.aufgaben || [];
  if (auf.length) {
    t.push('Aufgaben aus Antworten:');
    auf.forEach(function (a) {
      // Befund Lauf 6638: eine Sperre aus Zweifel traegt eine sichere Klasse ("termin") - ohne diesen Zusatz sieht der Betrieb sie nicht.
      var sp = a.gesperrt ? ' – gesperrt (' + a.grund + ')' + (a.grund === 'Zweifel'
        ? '; ist es kein Widerspruch, in der Zeile „Widerspruch aufheben“ den Grund eintragen' : '') : '';
      t.push('- ' + a.aufgabe + sp + ' – ' + wer(a.anlagen_id) + ' (' + a.anlagen_id + '), Antwort vom ' + laDatum(a.datum) + ' – ' + a.link);
    });
    t.push('');
  }
  var hin = (p.hinweise || []).concat(x.zusatz_hinweise || []);
  if (hin.length) {
    t.push('Hinweise:');
    hin.forEach(function (h) { t.push('- ' + h.anlagen_id + ': ' + h.text); });
    t.push('');
  }
  if (!alarme.length && !mails.length && !ja.length && !nach.length && !nein.length && !zur.length && !auf.length && !hin.length) t.push('Keine Vorgänge in diesem Lauf.');
  return { betreff: betreff, text: t.join('\n').replace(/\n+$/, '') + '\n', alarm: alarme.length > 0 };
}

// ---- Teil B / Baustein 6 (Auftrag 27.09.2026): Vorgangssuche, Datenhaltung, Zustand des Blatts ----------------------------

function laText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

// eingaenge: je Anlage { ..., thread_id, vorgang }; suchen: je Eingang die Antwort von threads.list?q=subject:"<Vorgang>"
// (includeSpamTrash) oder null ohne Vorgang. -> { threads: [Eingang + { thread_id, haupt }], suche: [je Anlage] }.
// Der gespeicherte Thread steht je Anlage zuerst (seine erste eigene Mail ist die Untergrenze der Nebenthreads).
function threadListe(eingaenge, suchen) {
  var e = eingaenge || [];
  var s = suchen || [];
  if (e.length !== s.length) throw new Error('Antworten einordnen - Eingänge und Suchen ungleich viele');
  var threads = [];
  var suche = [];
  e.forEach(function (x, i) {
    var ohne = x.nur_suche === true || !laText(x.thread_id);
    if (!ohne) threads.push(Object.assign({}, x, { haupt: true, eingang_nr: i }));
    if (!laText(x.vorgang)) {
      suche.push({ anlagen_id: x.anlagen_id, status: 0, gefunden: 0, haupt_gefunden: false, ohne_vorgang: true });
      return;
    }
    var r = s[i];
    var st = r && r.statusCode !== undefined ? r.statusCode : 0;
    var ids = st === 200 ? ((r.body && r.body.threads) || []).map(function (t) { return String(t.id); }) : [];
    var su = { anlagen_id: x.anlagen_id, status: st, gefunden: ids.length, haupt_gefunden: !ohne && ids.indexOf(x.thread_id) >= 0 };
    if (ohne) su.ohne_haupt = true;
    suche.push(su);
    var gesehen = {};
    if (!ohne) gesehen[x.thread_id] = true;
    ids.forEach(function (id) {
      if (gesehen[id]) return;
      gesehen[id] = true;
      threads.push(Object.assign({}, x, { thread_id: id, haupt: false, eingang_nr: i }));
    });
  });
  return { threads: threads, suche: suche };
}

// liste: threadListe(...); lesungen: je Thread die Antwort von threads.get. -> { status, antworten } (Texte nur fuer die
// naechsten Knoten). Nicht gelesen ist ein Lauf, wenn ein Thread oder eine Suche scheitert oder die Suche keinen einzigen
// gespeicherten Thread wiederfindet (Positivkontrolle: dann sucht sie falsch, und eine Abmeldung bliebe unbemerkt).
function antwortenSammeln(liste, lesungen, k) {
  var th = liste.threads;
  var le = lesungen || [];
  if (th.length !== le.length) throw new Error('Antworten einordnen - Threads und Lesungen ungleich viele');
  var status = { typ: 'status', threads: liste.suche.length, gelesen: 0, threads_gelesen: 0, fehler: [], gelesen_alle: true, suche_kontrolle: true,
    suche_hinweise: [] };
  var antworten = [];
  var ab = {};
  var gesehen = {};
  liste.suche.forEach(function (s) { if (s.ohne_haupt && s.status === 200) status.gelesen++; });
  // Untergrenze eines Nebenthreads: erste eigene Mail des gespeicherten Threads; ohne gespeicherten Thread (nur_suche) ab_ms.
  th.forEach(function (t, i) {
    var nr = t.eingang_nr;
    var grenze;
    if (!t.haupt) grenze = t.nur_suche ? (typeof t.ab_ms === 'number' ? t.ab_ms : undefined) : (ab[nr] === null ? undefined : ab[nr]);
    var x = antwortenAufbereiten(t, le[i], k, grenze);
    if (x.gelesen) {
      status.threads_gelesen++;
      if (t.haupt) { status.gelesen++; ab[nr] = x.erste_eigene_ms; }
    } else status.fehler.push({ anlagen_id: t.anlagen_id, status: x.status, art: 'thread' });
    x.antworten.forEach(function (a) {
      if (gesehen[a.gmail_id]) return;
      gesehen[a.gmail_id] = true;
      antworten.push(a);
    });
  });
  var gesucht = [];
  liste.suche.forEach(function (s) {
    if (s.ohne_vorgang) return;
    if (s.status !== 200) { status.fehler.push({ anlagen_id: s.anlagen_id, status: s.status, art: 'suche' }); return; }
    if (s.ohne_haupt) return;
    gesucht.push(s);
    if (!s.haupt_gefunden) status.suche_hinweise.push({ anlagen_id: s.anlagen_id, text: 'Vorgangssuche fand den gespeicherten Thread nicht – Betreff geändert?' });
  });
  // Sicherung Positivkontrolle Vorgangssuche: Anfang
  if (gesucht.length && !gesucht.some(function (s) { return s.haupt_gefunden; })) {
    status.suche_kontrolle = false;
    status.fehler.push({ anlagen_id: '', status: 0, art: 'suche_kontrolle' });
  }
  // Sicherung Positivkontrolle Vorgangssuche: Ende
  status.gelesen_alle = status.fehler.length === 0;
  return { status: status, antworten: antworten };
}

// Data Table "wartung-sperre", Schluessel antwort|<Gmail-ID>. Frueheste Reservierung gewinnt; "eingeordnet" nie wieder.
// Eine Reservierung eines abgebrochenen Laufs (anderer Lauf, zeit_utc vor dem Beginn dieses Laufs): dieser Lauf uebernimmt,
// aber ohne KI - der Text ging vielleicht schon an Claude (jede Antwort hoechstens einmal, BAUPLAN b).
function antwortReservierung(zeilen, gmailId, laufId, laufStart) {
  var z = (zeilen || []).filter(function (r) { return r && r.schluessel === 'antwort|' + gmailId; }).slice()
    .sort(function (a, b) { return Number(a.id) - Number(b.id); });
  if (z.some(function (r) { return r.aktion === 'eingeordnet'; })) return { weiter: false, ohne_ki: false, grund: 'schon eingeordnet' };
  var res = z.filter(function (r) { return r.aktion === 'reserviert'; });
  if (!res.length) return { weiter: false, ohne_ki: false, grund: 'keine Reservierung' };
  var r0 = res[0];
  if (String(r0.lauf_id) === String(laufId)) return { weiter: true, ohne_ki: false, grund: '' };
  // Sicherung abgebrochene Antwort nicht erneut an die KI: Anfang
  if (laText(laufStart) && laText(r0.zeit_utc) && laText(r0.zeit_utc) < laText(laufStart)) {
    return { weiter: true, ohne_ki: true, grund: 'Reservierung eines abgebrochenen Laufs (Lauf ' + r0.lauf_id + ') – nicht erneut an die KI' };
  }
  // Sicherung abgebrochene Antwort nicht erneut an die KI: Ende
  return { weiter: false, ohne_ki: false, grund: 'übersprungen, anderer Lauf' };
}

// Eine Zeile der Data Table; nie ein Antworttext.
function datenZeile(schluessel, aktion, x, lauf, grund) {
  return { schluessel: schluessel, aktion: aktion, lauf_id: String(lauf.lauf_id), anlagen_id: laText(x.anlagen_id), kunden_id: laText(x.kunden_id),
    gmail_id: laText(x.gmail_id), datum: laText(lauf.stichtag), zeit_utc: laText(lauf.zeit_utc), grund: laText(grund) };
}

function reservierungsZeilen(antworten, lauf) {
  return (antworten || []).map(function (a) { return datenZeile('antwort|' + a.gmail_id, 'reserviert', a, lauf, ''); });
}

// Sperren aus Antworten schreibt "Antworten einordnen" sofort, VOR dem Blatt und vor jedem Versand (ein Abbruch danach
// verliert keinen Widerspruch).
function sperrDatenZeilen(ergebnisse, lauf, k) {
  var z = [];
  (ergebnisse || []).forEach(function (x) {
    if (!x.gesperrt) return;
    k.sperrZeilen(x.kunden_id, x.email_norm, x.grund).forEach(function (s) { z.push(datenZeile(s.schluessel, 'gesperrt', x, lauf, s.grund)); });
  });
  return z;
}

// Nach dem Schreiben des Blatts (Hauptlauf): eingeordnet mit Klasse; Zelle "Werbewiderspruch" ohne Sperrzeile -> Sperre
// (Grund Betrieb); "Widerspruch aufheben" mit Grund -> aufgehoben (E4, nur der Betrieb hebt auf).
function nachtragZeilen(plan, ergebnisse, lauf, k) {
  var z = [];
  (ergebnisse || []).forEach(function (x) {
    if (x.eingeordnet === false) return;
    z.push(datenZeile('antwort|' + x.gmail_id, 'eingeordnet', x, lauf, x.art === 'antwort' ? x.klasse : x.art));
  });
  ((plan && plan.entscheidungen) || []).forEach(function (d) {
    if (d.sperre_nachtragen) k.sperrZeilen(d.kunden_id, d.email_norm, 'Betrieb').forEach(function (s) { z.push(datenZeile(s.schluessel, 'gesperrt', d, lauf, 'Betrieb')); });
    if (d.aufheben) k.sperrZeilen(d.kunden_id, d.email_norm, 'Betrieb').forEach(function (s) { z.push(datenZeile(s.schluessel, 'aufgehoben', d, lauf, d.aufheben.grund)); });
  });
  return z;
}

var LA_STATUS = { nicht_faellig: 'nicht fällig', beantwortet: 'beantwortet', abgeschlossen: 'ohne Antwort abgeschlossen', verpasst: 'verpasst',
  gesperrt: 'gesperrt', pausiert: 'pausiert', pflichtangabe: 'Hinweis', mangel: 'Hinweis', unzustellbar: 'unzustellbar' };
var LA_KLASSE = { termin: 'Termin gewünscht', rueckfrage: 'Rückfrage', kein_interesse: 'kein Interesse', widerspruch: 'Widerspruch',
  unklar: 'unklar – bitte lesen', 'bitte lesen': 'bitte lesen', 'nicht eingeordnet': 'nicht eingeordnet', 'anderer Lauf': 'in anderem Lauf' };

function laSpalte(i) {
  return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));
}

function laSerial(iso) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!r) throw new Error('Zustand - Datum nicht JJJJ-MM-TT');
  return (Date.UTC(+r[1], +r[2] - 1, +r[3]) - Date.UTC(1899, 11, 30)) / 86400000;
}

// Zustand des Blatts VOR dem Versand, ein Schreibvorgang (RAW): naechste Faelligkeit, Status (nicht bei geplanten oder
// zurueckgestellten Mails - die schreibt der Versand), Zyklus neu leert, Antwort mit Klasse und Datum (Antwort erledigt leer),
// Werbewiderspruch, Protokoll. -> { data: Bereiche fuer values:batchUpdate, hinweise }. Spalten nach Namen.
// neueSperrzeilen: Sperrzeilen DIESES Laufs - eine Zelle, die nur deshalb gesetzt wird, ist kein Hinweis wert.
function zustandZellen(plan, antworten, anlagen, kopf, lauf, neueSperrzeilen) {
  var neu = {};
  (neueSperrzeilen || []).forEach(function (z) { neu[z.schluessel] = true; });
  var k = (kopf || []).map(laText);
  if (k[0] !== 'Anlagen-ID') throw new Error('Zustand - Kopfzeile Anlagen ungültig');
  var sp = function (s) {
    var n = k.indexOf(s);
    if (n < 0) throw new Error('Zustand - Spalte fehlt ' + s);
    return laSpalte(n);
  };
  var anl = {};
  (anlagen || []).forEach(function (a) { if (!anl[a.anlagen_id]) anl[a.anlagen_id] = a; });
  var an = antworten || {};
  var data = [];
  var hinweise = [];
  var akt = { angebot: 'Angebot', erinnerung: 'Erinnerung' };
  // E4 (Befund Vorhersage G2, 27.09.2026): Aufheben gilt fuer den Kunden - die Zelle jeder seiner Anlagen (Kunden-ID oder E-Mail)
  // wird geleert, sonst traegt der naechste Lauf die Sperre aus der Zelle einer zweiten Anlage wieder nach.
  var aufK = {};
  var aufM = {};
  ((plan && plan.entscheidungen) || []).forEach(function (d) {
    if (!d.aufheben) return;
    if (laText(d.kunden_id)) aufK[laText(d.kunden_id)] = true;
    if (laText(d.email_norm)) aufM[laText(d.email_norm)] = true;
  });
  ((plan && plan.entscheidungen) || []).forEach(function (d) {
    var z = d.zeile;
    if (!Number.isInteger(z) || z < 2) return;
    var set = function (s, v) { data.push({ range: "'Anlagen'!" + sp(s) + z, values: [[v]] }); };
    var a = anl[d.anlagen_id] || {};
    if (d.faelligkeit) set('nächste Fälligkeit', laSerial(d.faelligkeit));
    if (d.zyklus_neu) {
      ['Angebot am', 'Erinnerung am', 'Thread-ID', 'Antwort', 'Antwort erledigt'].forEach(function (s) { set(s, ''); });
      hinweise.push({ anlagen_id: d.anlagen_id, text: 'neuer Zyklus – Angebot am, Erinnerung am, Thread-ID und Antwort geleert' });
    }
    var mail = !!akt[d.aktion];
    var status = d.aktion === 'wartet' ? (a.erinnerung_am ? 'Erinnerung versendet' : 'Angebot versendet') : LA_STATUS[d.aktion];
    if (!mail && !d.aktion_geplant && status) set('Status', status);
    var n = an[d.anlagen_id];
    if (n && n.art === 'antwort') {
      set('Antwort', (LA_KLASSE[n.klasse] || n.klasse || 'Antwort') + ', ' + laDatum(n.datum));
      set('Antwort erledigt', '');
    }
    if (d.aufheben) {
      set('Werbewiderspruch', '');
      set('Widerspruch aufheben', '');
      hinweise.push({ anlagen_id: d.anlagen_id, text: 'Widerspruch aufgehoben – ' + d.aufheben.grund });
    } else if (d.aktion === 'gesperrt' && (aufK[laText(d.kunden_id)] || aufM[laText(d.email_norm)])) { // Sicherung Aufheben je Kunde
      set('Werbewiderspruch', '');
    } else if (d.aktion === 'gesperrt') {
      set('Werbewiderspruch', 'ja');
      var ausDiesemLauf = neu['widerspruch|kunde|' + laText(d.kunden_id)] || neu['widerspruch|mail|' + laText(d.email_norm)];
      if (d.zelle_nachtragen && !ausDiesemLauf) hinweise.push({ anlagen_id: d.anlagen_id, text: 'Zelle „Werbewiderspruch“ neu gesetzt – die Sperre steht in der Sperrliste' });
    }
    if (d.sperre_nachtragen) hinweise.push({ anlagen_id: d.anlagen_id, text: 'Werbewiderspruch aus der Zelle in die Sperrliste übernommen (Grund Betrieb)' });
    if (!mail) {
      var was = d.aktion_geplant ? 'zurückgestellt (' + (akt[d.aktion_geplant] || d.aktion_geplant) + ')' : (LA_STATUS[d.aktion] || d.aktion);
      set('Protokoll', laDatum(lauf.stichtag) + ': ' + was + (d.grund ? ' – ' + d.grund : ''));
    }
  });
  return { data: data, hinweise: hinweise };
}

// W10 (BAUPLAN f): Anthropic ohne 2xx oder Schema verletzt -> Alarm in der Sammelmeldung; der Kunde ist aus Zweifel gesperrt.
function alarmeAusAntworten(status) {
  var n = Number((status || {}).ki_fehler) || 0;
  if (n <= 0) return []; // Sicherung KI-Fehler alarmiert
  return [{ art: 'KI-Einordnung fehlgeschlagen', text: n + ' Antworten ohne Einordnung – aus Zweifel gesperrt; bitte lesen und bei Bedarf „Widerspruch aufheben“' }];
}

// A3: Spalte "Versandstatus klären" (Auftrag 27.09.2026 nachmittags, Muster Mahnlauf versandstatusAuftrag). zeilen = alle Zeilen der
// Data Table oder null (Modus trocken). -> { data (Bereiche, mit dem Zustand VOR dem Versand geschrieben), eintraege (Data Table,
// mit dem Nachtrag), hinweise }. Die Mail bleibt in diesem Lauf angehalten (planeLauf); der naechste Lauf entscheidet.
function klaerungsAuftrag(plan, anlagen, zeilen, kopf, lauf, k) {
  var kp = (kopf || []).map(laText);
  var sp = function (s) {
    var n = kp.indexOf(s);
    if (n < 0) throw new Error('Zustand - Spalte fehlt ' + s);
    return laSpalte(n);
  };
  var dm = {};
  ((plan && plan.entscheidungen) || []).forEach(function (d) { if (!dm[d.anlagen_id]) dm[d.anlagen_id] = d; });
  var aus = { data: [], eintraege: [], hinweise: [] };
  (anlagen || []).forEach(function (a) {
    var w = laText(a.versandstatus_klaeren);
    if (!w) return;
    var d = dm[a.anlagen_id] || {};
    var h = function (text) { aus.hinweise.push({ anlagen_id: a.anlagen_id, text: text }); };
    if (zeilen === null) { h('Versandstatus klären: im Modus trocken nicht verarbeitet'); return; }
    if (d.aktion !== 'versandstatus' || !d.klaer_schluessel) { h('Versandstatus klären ohne anstehende Mail – nichts geändert'); return; }
    var kl = k.klaereVersandstatusWartung(w, d.klaer_schluessel, zeilen, lauf.lauf_id, lauf.lauf_start, lauf.stichtag);
    h(kl.grund);
    var set = function (s, v) { aus.data.push({ range: "'Anlagen'!" + sp(s) + a.zeile, values: [[v]] }); };
    var angebot = d.aktion_geplant === 'angebot';
    if (kl.aktion === 'versandstatus_versendet') {
      set(angebot ? 'Angebot am' : 'Erinnerung am', laSerial(kl.datum));
      set('Status', angebot ? 'Angebot versendet' : 'Erinnerung versendet');
      if (angebot && kl.thread_id) set('Thread-ID', kl.thread_id);
      set('Versandstatus klären', '');
    } else if (kl.aktion === 'versandstatus_zurueck') set('Versandstatus klären', '');
    if (kl.eintrag) {
      aus.eintraege.push({ schluessel: kl.schluessel, aktion: kl.eintrag.aktion, lauf_id: String(lauf.lauf_id), anlagen_id: a.anlagen_id,
        kunden_id: laText(a.kunden_id), gmail_id: '', thread_id: '', datum: kl.eintrag.datum, zeit_utc: laText(lauf.zeit_utc), grund: 'Versandstatus klären' });
    }
  });
  return aus;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { alarmeAusAntworten, klaerungsAuftrag, berlinZeit, antwortenAufbereiten, einordnungAbschliessen, antwortenFuerPlan, protokollZeilen, baueSammelmeldung,
    threadListe, antwortenSammeln, antwortReservierung, reservierungsZeilen, sperrDatenZeilen, nachtragZeilen, zustandZellen };
}
