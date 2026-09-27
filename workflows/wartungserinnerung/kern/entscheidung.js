// Wartungserinnerung, Kernlogik: Faelligkeit, Zyklus, Sperre und Plan eines Laufs (BAUPLAN b, c 5-6, d; Baustein 2).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. "heute" gibt es hier nicht - nur den Parameter stichtag
// (JJJJ-MM-TT, Europe/Berlin gemeint). Eingaben sind schon gelesen: Anlagen aus anlagen.js, Einstellungen aus
// einstellungen.js, Sperrzeilen aus der Data Table "wartung-sperre", Antworten aus antwort.js/widerspruch.js.
// Mails verschickt nur der Versand; hier entsteht nur der Plan. Ein Zyklus ist Anlagen-ID + naechste Faelligkeit.
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ..."), damit die Gegenprobe durch Auskommentieren
// sie gezielt treffen kann. Fehlermeldungen ohne ": " vor dem Kern (der Code-Node kuerzt bis zum ersten ": ").

var EN_MAIL = ['angebot', 'erinnerung'];
var EN_LEISTUNGEN = ['Einbau', 'Wartung', 'Reparatur'];
var EN_SPERRGRUENDE = ['Antwort', 'Wortliste', 'Zweifel', 'Betrieb'];
var EN_MODI = ['trocken', 'test', 'scharf'];

// Übernommen aus Mahnlauf bau/kern/stufen.js (Commit 61022e4), unverändert: stufenTag stufenIstDatum datumPlusTage tageZwischen stufenMailOk waehleEmpfaenger bestimmeStichtag
function stufenTag(d) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d));
  if (!r) throw new Error('Datum nicht im Format JJJJ-MM-TT: ' + d);
  var j = +r[1];
  var m = +r[2];
  var t = +r[3];
  var ms = Date.UTC(j, m - 1, t);
  var x = new Date(ms);
  if (x.getUTCFullYear() !== j || x.getUTCMonth() !== m - 1 || x.getUTCDate() !== t) {
    throw new Error('kein Kalenderdatum: ' + d);
  }
  return ms / 86400000;
}

function stufenIstDatum(d) {
  try { stufenTag(d); return true; } catch (e) { return false; }
}

function datumPlusTage(datum, tage) {
  if (!Number.isInteger(tage)) throw new Error('Tage muss ganze Zahl sein: ' + tage);
  var x = new Date((stufenTag(datum) + tage) * 86400000);
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  return x.getUTCFullYear() + '-' + z(x.getUTCMonth() + 1) + '-' + z(x.getUTCDate());
}

function tageZwischen(von, bis) {
  return stufenTag(bis) - stufenTag(von);
}

function stufenMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(String(s == null ? '' : s).trim());
}

function waehleEmpfaenger(modus, kundenEmail, testempfaenger) {
  if (modus === 'trocken') return { senden: false, an: null, grund: 'Modus trocken' };
  // Sicherung Testempfänger: Anfang
  if (modus === 'test') {
    if (!stufenMailOk(testempfaenger)) return { senden: false, an: null, grund: 'Modus test ohne gültigen Testempfänger' };
    return { senden: true, an: String(testempfaenger).trim(), grund: 'Modus test: Testempfänger erzwungen' };
  }
  // Sicherung Testempfänger: Ende
  if (modus === 'scharf') {
    if (!stufenMailOk(kundenEmail)) return { senden: false, an: null, grund: 'E-Mail fehlt oder ungültig' };
    return { senden: true, an: String(kundenEmail).trim(), grund: '' };
  }
  return { senden: false, an: null, grund: 'Modus unbekannt: ' + modus };
}

function bestimmeStichtag(modus, stichtagEinstellung, heute) {
  stufenTag(heute);
  var s = String(stichtagEinstellung == null ? '' : stichtagEinstellung).trim();
  if (!s) return { stichtag: heute, hinweis: '' };
  if (modus === 'test' || modus === 'trocken') {
    stufenTag(s);
    return { stichtag: s, hinweis: '' };
  }
  return { stichtag: heute, hinweis: 'Stichtag im Modus ' + modus + ' ignoriert' };
}

function enText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function normalisiereMail(s) {
  return enText(s).toLowerCase();
}

// Kalendermonate addieren; faellt der Tag weg, gilt der Monatsletzte (31.01. + 1 = 28./29.02.).
function plusMonate(iso, monate) {
  stufenTag(iso);
  if (!Number.isInteger(monate)) throw new Error('Monate muss ganze Zahl sein – ' + monate);
  var t = String(iso).split('-');
  var m = +t[1] - 1 + monate;
  var jahr = +t[0] + Math.floor(m / 12);
  var monat = ((m % 12) + 12) % 12;
  var letzter = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  return jahr + '-' + z(monat + 1) + '-' + z(Math.min(+t[2], letzter));
}

// Basis ist die letzte Wartung, sonst das Einbaudatum; Intervall der Anlage, leer -> Standardintervall; 1-60 Monate.
function naechsteFaelligkeit(a, standardintervall) {
  var iv = a.intervall === null || a.intervall === undefined || a.intervall === '' ? standardintervall : a.intervall;
  if (!Number.isInteger(iv) || iv < 1 || iv > 60) return { ok: false, grund: 'Intervall ungültig (' + a.intervall + ')' };
  var name = a.letzte_wartung ? 'letzte Wartung' : 'Einbaudatum';
  var basis = a.letzte_wartung ? a.letzte_wartung : a.einbaudatum;
  if (!basis) return { ok: false, grund: 'weder letzte Wartung noch Einbaudatum' };
  if (!stufenIstDatum(basis)) return { ok: false, grund: name + ' unlesbar' };
  return { ok: true, faelligkeit: plusMonate(basis, iv), basis: name };
}

function vorgangNummer(anlagenId, faelligkeit) {
  return enText(anlagenId) + '/' + String(faelligkeit).slice(0, 7);
}

// Zwei Zeilen fuer die Data Table: die Sperre gilt je Kunde UND je Adresse.
function sperrZeilen(kundenId, email, grund) {
  if (EN_SPERRGRUENDE.indexOf(grund) < 0) throw new Error('Sperrgrund unbekannt – ' + grund);
  var z = [];
  if (enText(kundenId)) z.push({ schluessel: 'widerspruch|kunde|' + enText(kundenId), aktion: 'gesperrt', grund: grund });
  if (normalisiereMail(email)) z.push({ schluessel: 'widerspruch|mail|' + normalisiereMail(email), aktion: 'gesperrt', grund: grund });
  return z;
}

// Data-Table-Zeilen nach id: "gesperrt" sperrt, "aufgehoben" hebt auf, die spaetere Zeile gewinnt.
function sperrZustand(zeilen) {
  var z = { kunden: {}, mails: {} };
  (zeilen || []).filter(function (r) { return r && typeof r.schluessel === 'string'; }).slice()
    .sort(function (a, b) { return Number(a.id) - Number(b.id); })
    .forEach(function (r) {
      var m = /^widerspruch\|(kunde|mail)\|(.+)$/.exec(r.schluessel);
      if (!m) return;
      var ziel = m[1] === 'kunde' ? z.kunden : z.mails;
      var k = m[1] === 'mail' ? normalisiereMail(m[2]) : m[2];
      if (r.aktion === 'gesperrt') ziel[k] = { grund: enText(r.grund) };
      else if (r.aktion === 'aufgehoben') delete ziel[k];
    });
  return z;
}

function istGesperrt(a, sperre) {
  var s = sperre || { kunden: {}, mails: {} };
  var ueber = [];
  if (a.kunden_id && s.kunden[a.kunden_id]) ueber.push('kunde'); // Sicherung Sperre Kunden-ID
  if (normalisiereMail(a.email) && s.mails[normalisiereMail(a.email)]) ueber.push('mail'); // Sicherung Sperre E-Mail
  var zelle = false;
  if (a.werbewiderspruch === true) zelle = true; // Sicherung Sperre Zelle
  return { gesperrt: ueber.length > 0 || zelle, data_table: ueber.length > 0, zelle: zelle, ueber: ueber };
}

// § 7 Abs. 3 UWG (BAUPLAN e): Kundenbeziehung, eigene aehnliche Leistung, Hinweis bei Erhebung; dazu eine gueltige Adresse.
function pflichtFehlt(a, stichtag) {
  var f = [];
  if (EN_LEISTUNGEN.indexOf(enText(a.leistung)) < 0) f.push('Leistung des Betriebs');
  if (!enText(a.erhoben_bei)) f.push('Adresse erhoben bei');
  if (!stufenIstDatum(a.hinweis_erhebung) || tageZwischen(a.hinweis_erhebung, stichtag) < 0) f.push('Widerspruchshinweis bei Erhebung');
  if (!stufenMailOk(a.email)) f.push('E-Mail');
  return f;
}

// a: Anlage aus anlagen.js; k: { e: Einstellungen, stichtag, sperre: sperrZustand(...), antwort: null | { art, klasse, datum } }
function entscheideAnlage(a, k) {
  var e = k.e;
  var stichtag = k.stichtag;
  var d = {
    anlagen_id: a.anlagen_id, kunden_id: a.kunden_id, email_norm: normalisiereMail(a.email), zeile: a.zeile,
    aktion: '', grund: '', faelligkeit: '', vorgang: '', zyklus_neu: false, sperre_nachtragen: false, zelle_nachtragen: false,
    aufheben: null, antwort: null, antwort_offen: false, hinweise: [],
  };
  var neu = k.antwort || null;
  // Teil A 7: offen ist eine Antwort aus diesem Lauf (auch nicht eingeordnet) oder eine eingetragene ohne "Antwort erledigt";
  // ein neuer Zyklus schliesst die eingetragene (unten). Frueh endende Pfade behalten den Wert (sperrt, nie umgekehrt).
  d.antwort_offen = !!(neu && neu.art === 'antwort')
    || ((enText(a.antwort) !== '' || a.status === 'beantwortet') && a.antwort_erledigt !== true);
  var sp = istGesperrt(a, k.sperre);
  if (a.widerspruch_aufheben) {
    if (!sp.gesperrt) d.hinweise.push('Widerspruch aufheben ohne bestehende Sperre');
    else if (a.widerspruch_aufheben.length < 10) d.hinweise.push('Widerspruch aufheben – Grund fehlt oder ist zu kurz');
    else d.aufheben = { grund: a.widerspruch_aufheben };
  }
  if (sp.gesperrt) {
    d.aktion = 'gesperrt';
    d.grund = 'Werbewiderspruch';
    d.zelle_nachtragen = sp.data_table && !sp.zelle;
    d.sperre_nachtragen = sp.zelle && !sp.data_table;
    return d;
  }
  // Sicherung Pause: Anfang
  if (a.pause) {
    d.aktion = 'pausiert';
    d.grund = a.pause_grund || 'Pause';
    if (!a.pause_grund) d.hinweise.push('Pause ohne Grund');
    return d;
  }
  // Sicherung Pause: Ende
  var fehlt = pflichtFehlt(a, stichtag);
  // Sicherung Pflichtangaben: Anfang
  if (fehlt.length) {
    d.aktion = 'pflichtangabe';
    d.grund = fehlt.join(', ');
    d.hinweise.push('Pflichtangabe fehlt – ' + d.grund);
    return d;
  }
  // Sicherung Pflichtangaben: Ende
  if ((a.mangel || []).length) {
    d.aktion = 'mangel';
    d.grund = a.mangel.join(', ');
    d.hinweise.push(d.grund);
    return d;
  }
  var f = naechsteFaelligkeit(a, e.standardintervall);
  if (!f.ok) {
    d.aktion = 'mangel';
    d.grund = f.grund;
    d.hinweise.push(f.grund);
    return d;
  }
  d.faelligkeit = f.faelligkeit;
  d.vorgang = vorgangNummer(a.anlagen_id, f.faelligkeit);
  var z = { angebot_am: a.angebot_am, erinnerung_am: a.erinnerung_am, antwort: a.antwort, status: a.status };
  if (a.faelligkeit_zelle && a.faelligkeit_zelle !== f.faelligkeit && (z.angebot_am || z.erinnerung_am || z.antwort || z.status)) {
    d.zyklus_neu = true;
    z = { angebot_am: '', erinnerung_am: '', antwort: '', status: '' };
    d.antwort_offen = !!(neu && neu.art === 'antwort');
  }
  if ((z.angebot_am && !stufenIstDatum(z.angebot_am)) || (z.erinnerung_am && !stufenIstDatum(z.erinnerung_am))) {
    d.aktion = 'mangel';
    d.grund = 'Angebot am oder Erinnerung am unlesbar';
    d.hinweise.push(d.grund);
    return d;
  }
  if (neu && neu.art === 'unzustellbar') {
    d.aktion = 'unzustellbar';
    d.antwort = neu;
    d.hinweise.push('Mail unzustellbar – Adresse prüfen');
    return d;
  }
  if (neu && neu.art === 'antwort') {
    d.aktion = 'beantwortet';
    d.antwort = neu;
    return d;
  }
  if (neu && neu.art === 'abwesenheit') d.hinweise.push('Abwesenheitsnotiz vom ' + enText(neu.datum));
  if (z.status === 'unzustellbar') { d.aktion = 'unzustellbar'; return d; }
  if (z.status === 'beantwortet' || z.antwort) { d.aktion = 'beantwortet'; return d; }
  if (!z.angebot_am) {
    if (tageZwischen(stichtag, f.faelligkeit) > e.vorlauf) d.aktion = 'nicht_faellig';
    else if (tageZwischen(f.faelligkeit, stichtag) > e.nachlauf) {
      d.aktion = 'verpasst';
      d.hinweise.push('Fälligkeit ' + f.faelligkeit + ' verpasst – kein Angebot mehr, der Betrieb entscheidet');
    } else d.aktion = 'angebot';
    return d;
  }
  if (!z.erinnerung_am) {
    d.aktion = tageZwischen(z.angebot_am, stichtag) >= e.erinnerung_nach ? 'erinnerung' : 'wartet';
    return d;
  }
  if (tageZwischen(z.erinnerung_am, stichtag) >= e.antwortfenster) {
    d.aktion = 'abgeschlossen';
    if (tageZwischen(plusMonate(f.faelligkeit, 12), stichtag) >= 0) {
      d.hinweise.push('seit zwölf Monaten nach der Fälligkeit kein Wartungsdatum eingetragen');
    }
    return d;
  }
  d.aktion = 'wartet';
  return d;
}

function enStopp(d, aktion, grund) {
  d.aktion_geplant = d.aktion;
  d.aktion = aktion;
  d.grund = grund;
}

// p = { einstellungen, stichtag, anlagen, sperrzeilen, antworten: { Anlagen-ID: {art, klasse, datum} },
//       antworten_gelesen: true nur, wenn JEDER zu lesende Thread gelesen wurde, textbausteine_fehler: [Text] }
function planeLauf(p) {
  var e = p.einstellungen || {};
  [['vorlauf', 0, 365], ['nachlauf', 0, 365], ['erinnerung_nach', 1, 365], ['antwortfenster', 1, 365],
    ['antworten_lesen_bis', 1, 3650], ['standardintervall', 1, 60], ['hoechstzahl_mails', 0, 1000]].forEach(function (g) {
    var v = e[g[0]];
    if (!Number.isInteger(v) || v < g[1] || v > g[2]) throw new Error('Einstellung ungültig – ' + g[0]);
  });
  if (EN_MODI.indexOf(e.modus) < 0) throw new Error('Einstellung ungültig – Modus');
  stufenTag(p.stichtag);
  var sperre = sperrZustand(p.sperrzeilen);
  var antworten = p.antworten || {};
  var plan = { entscheidungen: [], versand: [], alarme: [], hinweise: [],
    mengenbremse: { gerissen: false, anzahl: 0, hoechstzahl: e.hoechstzahl_mails } };
  (p.anlagen || []).forEach(function (a) {
    var d = entscheideAnlage(a, { e: e, stichtag: p.stichtag, sperre: sperre, antwort: antworten[a.anlagen_id] || null });
    plan.entscheidungen.push(d);
    d.hinweise.forEach(function (h) { plan.hinweise.push({ anlagen_id: d.anlagen_id, text: h }); });
  });
  var mail = function (d) { return EN_MAIL.indexOf(d.aktion) >= 0; };

  // A3: ein Wert in "Versandstatus klären" haelt die anstehende Mail an; der Hauptlauf klaert mit der Data Table (klaerungsAuftrag).
  var anlMap = {};
  (p.anlagen || []).forEach(function (a) { if (!anlMap[a.anlagen_id]) anlMap[a.anlagen_id] = a; });
  plan.entscheidungen.forEach(function (d) {
    var w = enText((anlMap[d.anlagen_id] || {}).versandstatus_klaeren);
    if (!w || !mail(d)) return;
    d.klaer_schluessel = d.aktion + '|' + d.anlagen_id + '|' + d.faelligkeit;
    d.klaer_wert = w;
    enStopp(d, 'versandstatus', 'Versandstatus klären „' + w + '“ – kein Versand in diesem Lauf'); // Sicherung Versandstatus haelt an
  });

  // Sicherung Antwortstand frisch: Anfang
  if (p.antworten_gelesen !== true) {
    var n1 = 0;
    plan.entscheidungen.forEach(function (d) {
      if (mail(d)) { enStopp(d, 'antworten_ungelesen', 'Antworten nicht vollständig gelesen'); n1++; }
    });
    plan.alarme.push({ art: 'Antworten nicht gelesen', text: 'kein Versand in diesem Lauf, ' + n1 + ' Vorgänge zurückgestellt' });
  }
  // Sicherung Antwortstand frisch: Ende

  var tbf = p.textbausteine_fehler || [];
  // Sicherung Textbausteine: Anfang
  if (tbf.length) {
    plan.entscheidungen.forEach(function (d) { if (mail(d)) enStopp(d, 'textbausteine', 'Textbausteine ungültig'); });
    plan.alarme.push({ art: 'Textbausteine ungültig', text: tbf.join('; ') });
  }
  // Sicherung Textbausteine: Ende

  // Sicherung offene Antwort: Anfang
  var offenK = {};
  var offenM = {};
  plan.entscheidungen.forEach(function (d) {
    if (!d.antwort_offen) return;
    if (d.kunden_id) offenK[d.kunden_id] = d.anlagen_id;
    if (d.email_norm) offenM[d.email_norm] = d.anlagen_id;
  });
  plan.entscheidungen.forEach(function (d) {
    var bei = (d.kunden_id && offenK[d.kunden_id]) || (d.email_norm && offenM[d.email_norm]);
    if (mail(d) && bei) enStopp(d, 'antwort_offen', 'offene Antwort des Kunden (' + bei + ') – erst „Antwort erledigt“ = ja');
  });
  // Sicherung offene Antwort: Ende

  // Sicherung eine Mail je Kunde: Anfang
  var kunden = {};
  var adressen = {};
  // Auftrag 27.09.2026 nachmittags (A1): E6 gilt je Kalendertag (Europe/Berlin) - wer heute schon eine Mail bekam (Data Table,
  // heuteVersendet), bekommt keine zweite; die naechste Anlage kommt am naechsten Werktag. Im Modus trocken (ohne Data Table) je Lauf.
  // Sicherung Tagesgrenze: Anfang
  (p.heute_versendet || []).forEach(function (h) {
    if (enText(h.kunden_id)) kunden[enText(h.kunden_id)] = 'heute';
    if (normalisiereMail(h.email_norm)) adressen[normalisiereMail(h.email_norm)] = 'heute';
  });
  // Sicherung Tagesgrenze: Ende
  plan.entscheidungen.filter(mail).slice().sort(function (x, y) {
    if (x.faelligkeit !== y.faelligkeit) return x.faelligkeit < y.faelligkeit ? -1 : 1;
    return x.anlagen_id < y.anlagen_id ? -1 : x.anlagen_id > y.anlagen_id ? 1 : 0;
  }).forEach(function (d) {
    var schon = (d.kunden_id && kunden[d.kunden_id]) || (d.email_norm && adressen[d.email_norm]);
    if (schon) {
      enStopp(d, 'naechster_werktag', schon === 'heute' ? 'höchstens eine Mail je Kunde und Tag – heute schon eine Mail an diesen Kunden'
        : 'höchstens eine Mail je Kunde und Tag');
      return;
    }
    kunden[d.kunden_id] = true;
    adressen[d.email_norm] = true;
  });
  // Sicherung eine Mail je Kunde: Ende

  var anzahl = plan.entscheidungen.filter(mail).length;
  plan.mengenbremse.anzahl = anzahl;
  // Sicherung Mengenbremse: Anfang
  if (anzahl > e.hoechstzahl_mails) {
    plan.mengenbremse.gerissen = true;
    plan.entscheidungen.forEach(function (d) { if (mail(d)) enStopp(d, 'mengenbremse', 'Mengenbremse'); });
    plan.alarme.push({ art: 'Mengenbremse', text: anzahl + ' Mails fällig, Höchstzahl ' + e.hoechstzahl_mails });
  }
  // Sicherung Mengenbremse: Ende

  plan.versand = plan.entscheidungen.filter(mail);
  return plan;
}

// Baustein 5: Threads, deren Antworten dieser Lauf liest - nicht gesperrt (der Text eines gesperrten Kunden geht nicht mehr an
// die KI, Art. 21 Abs. 3 DSGVO), letzte eigene Mail hoechstens "Antworten lesen bis" Tage zurueck; ohne lesbares Datum wird
// gelesen (ein spaeter Widerspruch muss wirken). Teil B: je Eintrag der Vorgang fuer die Vorgangssuche (leer ohne Faelligkeit).
// Auftrag 27.09. nachmittags: Angebot ohne Thread-ID (etwa nach "Versandstatus klären") -> nur_suche mit Untergrenze ab_ms;
// alte Vorgaenge (A2) - versendet laut Data Table (zeilen), Versand hoechstens "Antworten lesen bis" Tage zurueck, und der
// gespeicherte Thread, wenn der Zyklus in diesem Lauf wechselt - mit alt: true (dort zaehlt nur ein Widerspruch).
function zuLesendeThreads(anlagen, sperre, stichtag, e, zeilen) {
  var aus = [];
  (anlagen || []).forEach(function (a) {
    if (istGesperrt(a, sperre).gesperrt) return; // Sicherung gesperrt nicht lesen
    var basis = { anlagen_id: a.anlagen_id, kunden_id: a.kunden_id, email_norm: normalisiereMail(a.email) };
    var f = naechsteFaelligkeit(a, e.standardintervall);
    var vorgang = f.ok ? vorgangNummer(a.anlagen_id, f.faelligkeit) : '';
    var wechsel = f.ok && stufenIstDatum(a.faelligkeit_zelle) && a.faelligkeit_zelle !== f.faelligkeit;
    var d = [a.angebot_am, a.erinnerung_am].filter(stufenIstDatum).sort();
    var frisch = !d.length || tageZwischen(d[d.length - 1], stichtag) <= e.antworten_lesen_bis;
    var t = enText(a.thread_id);
    var gesehen = {};
    if (t && frisch) {
      gesehen[t] = true;
      if (wechsel) aus.push(Object.assign({}, basis, { thread_id: t, vorgang: vorgangNummer(a.anlagen_id, a.faelligkeit_zelle), alt: true }));
      else aus.push(Object.assign({}, basis, { thread_id: t, vorgang: vorgang }));
    } else if (!t && d.length && frisch && vorgang && !wechsel) {
      var r0 = d[0].split('-');
      aus.push(Object.assign({}, basis, { thread_id: '', vorgang: vorgang, nur_suche: true, ab_ms: Date.UTC(+r0[0], +r0[1] - 1, +r0[2]) - 2 * 3600e3 }));
    }
    // Sicherung alte Vorgaenge lesen: Anfang
    (zeilen || []).forEach(function (r) {
      var m = r && typeof r.schluessel === 'string' ? /^(?:angebot|erinnerung)\|([^|]+)\|(\d{4}-\d{2}-\d{2})$/.exec(r.schluessel) : null;
      if (!m || m[1] !== a.anlagen_id || r.aktion !== 'versendet' || !enText(r.thread_id) || gesehen[enText(r.thread_id)]) return;
      var v = vorgangNummer(a.anlagen_id, m[2]);
      if (v === vorgang && !wechsel) return;
      if (!stufenIstDatum(r.datum) || tageZwischen(r.datum, stichtag) > e.antworten_lesen_bis) return;
      gesehen[enText(r.thread_id)] = true;
      aus.push(Object.assign({}, basis, { thread_id: enText(r.thread_id), vorgang: v, alt: true }));
    });
    // Sicherung alte Vorgaenge lesen: Ende
  });
  return aus;
}

// A1: Anlagen, an deren Kunden heute (Stichtag des Laufs) schon eine Mail ging oder reserviert ist - aus der Data Table.
function heuteVersendet(zeilen, anlagen, stichtag) {
  var anl = {};
  (anlagen || []).forEach(function (a) { if (!anl[a.anlagen_id]) anl[a.anlagen_id] = a; });
  var aus = [];
  var gesehen = {};
  (zeilen || []).forEach(function (r) {
    var m = r && typeof r.schluessel === 'string' ? /^(?:angebot|erinnerung)\|([^|]+)\|/.exec(r.schluessel) : null;
    if (!m || (r.aktion !== 'versendet' && r.aktion !== 'reserviert') || enText(r.datum) !== stichtag || gesehen[m[1]]) return;
    gesehen[m[1]] = true;
    var a = anl[m[1]] || {};
    aus.push({ anlagen_id: m[1], kunden_id: enText(a.kunden_id || r.kunden_id), email_norm: normalisiereMail(a.email) });
  });
  return aus;
}

// Vor dem Versand: die Zeile wurde neu gelesen und neu entschieden. Nur wenn das Ergebnis der Planung gleicht, wird gesendet.
function vergleichePlanung(geplant, frisch) {
  if (!geplant || !frisch) return { gleich: false, grund: 'keine frische Entscheidung' };
  if (frisch.aktion !== geplant.aktion || frisch.faelligkeit !== geplant.faelligkeit || frisch.vorgang !== geplant.vorgang) return { gleich: false, grund: 'geändert seit Laufbeginn – geplant ' + geplant.aktion + ', jetzt ' + frisch.aktion }; // Sicherung Neu entscheiden
  return { gleich: true, grund: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    plusMonate, naechsteFaelligkeit, vorgangNummer, normalisiereMail, sperrZeilen, sperrZustand, istGesperrt,
    entscheideAnlage, planeLauf, vergleichePlanung, zuLesendeThreads, heuteVersendet, datumPlusTage, tageZwischen, waehleEmpfaenger, bestimmeStichtag,
  };
}
