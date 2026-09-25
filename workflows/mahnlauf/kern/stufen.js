// Mahnlauf, Kernlogik: Stufen, Fristen und Sicherungen (BAUPLAN c und e), Version 1.
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. "heute" gibt es hier
// nicht - nur den Parameter stichtag (JJJJ-MM-TT, Europe/Berlin gemeint).
// Betraege in ganzen Cent. Version 1: kein Verzug, keine Zinsen, keine Pauschale.
//
// Die Sicherungen stehen je an EINER markierten Stelle ("Sicherung ..."), damit
// die Gegenprobe durch Auskommentieren sie gezielt treffen kann.

var STUFEN_PFLICHTSPALTEN = [
  'Rechnungsnr.', 'Kunde', 'Kundentyp', 'E-Mail', 'Rechnungsdatum', 'Fälligkeit',
  'Betrag brutto', 'bezahlt bis jetzt', 'Verzugshinweis auf Rechnung', 'Mahnsperre',
  'Mahnsperre Grund', 'aktuelle Stufe', 'Datum letzte Stufe', 'Link zur Rechnungs-PDF',
  'Protokoll', 'Status', 'Freigabe', 'Entwurf-ID', 'Entwurf-Restbetrag', 'Versandstatus klären',
];

// Aktionen, die beim Kunden ankommen oder einen Kundenentwurf erzeugen.
var STUFEN_VERSAND = ['senden', 'entwurf_anlegen', 'entwurf_senden', 'entwurf_ersetzen'];

var STUFEN_NAME = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: 'letzte Mahnung', 4: 'Übergabe' };

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

function pruefeKopfzeile(kopf, pflichtspalten) {
  var k = (kopf || []).map(function (s) { return String(s).trim(); });
  var fehlend = (pflichtspalten || []).filter(function (s) { return k.indexOf(s) < 0; });
  return { ok: fehlend.length === 0, fehlend: fehlend };
}

function pruefeFrische(auszugStand, stichtag, maxAlterTage) {
  if (!auszugStand) return { frisch: false, alter_tage: null, grund: 'kein lesbarer Kontoauszug' };
  if (!stufenIstDatum(auszugStand)) return { frisch: false, alter_tage: null, grund: 'Stand des Kontoauszugs unlesbar' };
  if (!Number.isInteger(maxAlterTage) || maxAlterTage < 0) return { frisch: false, alter_tage: null, grund: 'Max. Alter Kontoauszug ungültig' };
  var alter = tageZwischen(auszugStand, stichtag);
  if (alter < 0) return { frisch: false, alter_tage: alter, grund: 'Stand des Kontoauszugs liegt nach dem Stichtag' };
  if (alter > maxAlterTage) {
    return { frisch: false, alter_tage: alter, grund: 'Kontoauszug ' + alter + ' Tage alt, erlaubt ' + maxAlterTage };
  }
  return { frisch: true, alter_tage: alter, grund: '' };
}

// Ja nur bei ausdruecklichem "ja" - eine unklare Freigabe ist keine.
function stufenFreigabe(v) {
  return v === true || String(v == null ? '' : v).trim().toLowerCase() === 'ja';
}

// Sperre bei allem ausser leer/"nein" - eine unklare Sperre sperrt.
function stufenSperre(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  var s = String(v).trim().toLowerCase();
  return s !== '' && s !== 'nein' && s !== 'false' && s !== '0';
}

function stufenStufe(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : NaN;
}

function stufenMailOk(s) {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(String(s == null ? '' : s).trim());
}

function stufenIntervall(e, stufe) {
  if (stufe === 1) return e.intervall_erinnerung;
  if (stufe === 2) return e.intervall_mahnung1;
  if (stufe === 3) return e.intervall_letzte_mahnung;
  if (stufe === 4) return e.intervall_uebergabe;
  return NaN;
}

function stufenFreigabemodus(e, stufe) {
  if (stufe === 1) return e.freigabemodus_erinnerung;
  if (stufe === 2) return e.freigabemodus_mahnung1;
  if (stufe === 3) return e.freigabemodus_letzte_mahnung;
  return 'Meldung';
}

function stufenPruefeEinstellungen(e) {
  var fehler = [];
  ['intervall_erinnerung', 'intervall_mahnung1', 'intervall_letzte_mahnung', 'intervall_uebergabe',
    'max_alter_auszug', 'mindestbetrag_cent', 'hoechstzahl_mails'].forEach(function (k) {
    if (!Number.isInteger(e[k]) || e[k] < 0) fehler.push(k);
  });
  ['freigabemodus_erinnerung', 'freigabemodus_mahnung1', 'freigabemodus_letzte_mahnung'].forEach(function (k) {
    if (e[k] !== 'automatisch' && e[k] !== 'Entwurf') fehler.push(k);
  });
  if (fehler.length) throw new Error('Einstellung ungültig: ' + fehler.join(', '));
}

// Naechste faellige Stufe oder null. Hoechstens eine Stufe je Lauf, keine
// wird uebersprungen: es gibt immer nur die naechste.
function faelligeStufe(rechnung, einstellungen, stichtag) {
  var s = stufenStufe(rechnung.aktuelle_stufe);
  if (!(s >= 0 && s <= 3)) return null;
  var basis = s === 0 ? rechnung.faelligkeit : rechnung.datum_letzte_stufe;
  var ab = datumPlusTage(basis, stufenIntervall(einstellungen, s + 1));
  return tageZwischen(ab, stichtag) >= 0 ? { stufe: s + 1, faellig_ab: ab } : null;
}

function stufenZeilenmangel(r, stufe) {
  if (!(stufe >= 0 && stufe <= 4)) return 'aktuelle Stufe';
  if (r.kundentyp !== 'B2B' && r.kundentyp !== 'B2C') return 'Kundentyp';
  if (!stufenIstDatum(r.faelligkeit)) return 'Fälligkeit';
  if (stufe >= 1 && !stufenIstDatum(r.datum_letzte_stufe)) return 'Datum letzte Stufe';
  if (r.status === undefined || r.status === 'unbekannt' || r.status === 'ungültig') return 'Betrag brutto oder Zahlstand';
  if (r.status !== 'Dublette' && !Number.isInteger(r.rest_cent)) return 'Zahlstand';
  return '';
}

// Entscheidung fuer EINE Rechnung. Reihenfolge nach BAUPLAN e: bezahlt ->
// Mahnsperre -> Klaerfall-Halt -> Entwurf -> Faelligkeit -> Mindestbetrag.
// Frische und Mengenbremse gelten fuer den ganzen Lauf (planeLauf).
function entscheide(rechnung, einstellungen, stichtag) {
  var r = rechnung;
  var e = einstellungen;
  var stufe = stufenStufe(r.aktuelle_stufe);
  var d = {
    rechnungsnr: r.rechnungsnr,
    aktion: 'keine',
    stufe: null,
    stufe_vorher: stufe,
    rest_cent: r.rest_cent,
    grund: '',
    freigabe_leeren: false,
    meldungen: [],
  };
  var ergebnis = function (aktion, grund, extra) {
    d.aktion = aktion;
    d.grund = grund;
    if (extra) Object.keys(extra).forEach(function (k) { d[k] = extra[k]; });
    if (STUFEN_VERSAND.indexOf(aktion) >= 0 && !stufenMailOk(r.email)) {
      d.aktion_geplant = aktion;
      d.aktion = 'keine_email';
      d.grund = 'E-Mail fehlt oder ungültig';
      d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'E-Mail fehlt oder ungültig, keine Mail' });
    }
    return d;
  };

  var mangel = stufenZeilenmangel(r, stufe);
  if (mangel) {
    d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'ungültige Zeile: ' + mangel });
    return ergebnis('ungueltig', 'ungültige Zeile: ' + mangel);
  }
  if (stufenIstDatum(r.rechnungsdatum) && tageZwischen(r.rechnungsdatum, r.faelligkeit) < 0) {
    d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'Fälligkeit liegt vor dem Rechnungsdatum' });
  }
  if (r.dublette === true || r.status === 'Dublette') return ergebnis('gesperrt', 'Dublette');

  // Spalte "Versandstatus klaeren" (Baustein 10 Teil A 4): Die Klaerung rechnet der Hauptlauf aus der Data Table
  // (versand.js klaereVersandstatus). Steht ein Wert ohne Klaerung, wird die Zeile nie versendet.
  // Sicherung Versandstatus klären: Anfang
  if (String(r.versandstatus_klaeren == null ? '' : r.versandstatus_klaeren).trim() !== '') {
    var kl = r.versandstatus_klaerung;
    if (kl && (kl.aktion === 'versandstatus_versendet' || kl.aktion === 'versandstatus_zurueck')) {
      d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: kl.grund });
      return ergebnis(kl.aktion, kl.grund, { stufe: kl.stufe, klaerung: kl });
    }
    var kg = kl && kl.grund ? kl.grund : 'Versandstatus klären gesetzt, nicht verarbeitet';
    d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: kg });
    return ergebnis('hinweis', kg);
  }
  // Sicherung Versandstatus klären: Ende

  var hatEntwurf = String(r.entwurf_id == null ? '' : r.entwurf_id).trim() !== '';
  if (r.status === 'bezahlt' || r.status === 'überzahlt') {
    return hatEntwurf ? ergebnis('entwurf_verwerfen', 'Entwurf verworfen', { stufe: stufe + 1 }) : ergebnis('keine', r.status);
  }

  if (Array.isArray(r.hinweise) && r.hinweise.length) return ergebnis('hinweis', 'Zeile mit Hinweis: ' + r.hinweise.join(', ')); // Sicherung Hinweis
  if (stufenSperre(r.mahnsperre)) return stufenGesperrt(d, r, ergebnis); // Sicherung Mahnsperre
  if (r.klaerfall_halt === true) return ergebnis('klaerfall_halt', 'Klärfall-Halt'); // Sicherung Klärfall-Halt

  if (hatEntwurf) {
    var eStufe = stufe + 1;
    if (!Number.isInteger(r.entwurf_rest_cent)) return ergebnis('ungueltig', 'Entwurf-Restbetrag fehlt', { stufe: eStufe });
    if (r.entwurf_rest_cent !== r.rest_cent) {
      if (r.rest_cent < e.mindestbetrag_cent) {
        return ergebnis('entwurf_verwerfen', 'Entwurf verworfen', { stufe: eStufe, freigabe_leeren: true });
      }
      return ergebnis('entwurf_ersetzen', 'Entwurf verworfen, Restbetrag geändert', { stufe: eStufe, freigabe_leeren: true });
    }
    if (r.rest_cent < e.mindestbetrag_cent) return ergebnis('unter_mindestbetrag', 'unter Mindestbetrag', { stufe: eStufe });
    if (stufenFreigabe(r.freigabe)) return ergebnis('entwurf_senden', STUFEN_NAME[eStufe] + ' freigegeben', { stufe: eStufe });
    if (stufenIstDatum(r.entwurf_datum) && tageZwischen(r.entwurf_datum, stichtag) > stufenIntervall(e, eStufe)) {
      d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'Entwurf wartet zu lange auf Freigabe' });
    }
    return ergebnis('wartet', 'wartet auf Freigabe', { stufe: eStufe });
  }

  var f = faelligeStufe(r, e, stichtag);
  if (!f) return ergebnis('keine', stufe >= 4 ? 'übergeben' : 'noch nicht fällig');
  if (r.rest_cent < e.mindestbetrag_cent) {
    d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'Restbetrag unter Mindestbetrag, nicht angemahnt' });
    return ergebnis('unter_mindestbetrag', 'unter Mindestbetrag', { stufe: f.stufe });
  }
  if (f.stufe === 4) {
    d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'Übergabe an den Betrieb' });
    return ergebnis('uebergabe', 'Übergabe an den Betrieb', { stufe: 4 });
  }
  var modus = stufenFreigabemodus(e, f.stufe);
  if (modus === 'automatisch') return ergebnis('senden', STUFEN_NAME[f.stufe] + ' fällig', { stufe: f.stufe });
  return ergebnis('entwurf_anlegen', STUFEN_NAME[f.stufe] + ' fällig, Entwurf zur Freigabe', { stufe: f.stufe });
}

function stufenGesperrt(d, r, ergebnis) {
  if (String(r.mahnsperre_grund == null ? '' : r.mahnsperre_grund).trim() === '') {
    d.meldungen.push({ rechnungsnr: r.rechnungsnr, text: 'Mahnsperre ohne Grund - Sperre bleibt wirksam' });
  }
  return ergebnis('gesperrt', 'gesperrt');
}

// Zeilen aus "Offene Posten" + Ergebnis von ordneZahlungenZu (rechnungen, gleiche
// Reihenfolge) -> Zeilen mit Zahlstand. Passt ein Eintrag nicht, bleibt der
// Zahlstand unbekannt und die Zeile wird nicht angemahnt.
function mitZahlstand(zeilen, rechnungenZahlstand) {
  var stand = rechnungenZahlstand || [];
  return (zeilen || []).map(function (z, i) {
    var aus = Object.assign({}, z);
    var s = stand[i];
    if (!s || s.rechnungsnr !== z.rechnungsnr) {
      aus.status = 'unbekannt';
      return aus;
    }
    aus.bezahlt_cent = s.bezahlt_cent;
    aus.rest_cent = s.rest_cent;
    aus.status = s.status;
    aus.ueberschuss_cent = s.ueberschuss_cent;
    aus.klaerfall_halt = s.klaerfall_halt;
    aus.dublette = s.dublette;
    return aus;
  });
}

// Plan fuer einen Lauf. p = { kopfzeile, rechnungen (mit Zahlstand), einstellungen,
// stichtag, auszugStand, textbausteine_fehler (pruefeTextbausteine, platzhalter.js) }. Wirft bei
// falschem Tabellenaufbau oder ungueltigen Einstellungen (fail-closed: Abbruch vor jedem Versand, T13 b).
// Ungueltige Textbausteine (Teil A 9) sperren jeden Versand des Laufs mit Alarm, wie die Mengenbremse.
function planeLauf(p) {
  var e = p.einstellungen || {};
  var k = pruefeKopfzeile(p.kopfzeile, STUFEN_PFLICHTSPALTEN);
  if (!k.ok) throw new Error('Tabellenaufbau falsch, Spalte fehlt: ' + k.fehlend.join(', '));
  stufenPruefeEinstellungen(e);
  stufenTag(p.stichtag);
  var stichtag = p.stichtag;
  var plan = {
    stichtag: stichtag,
    entscheidungen: [],
    versand: [],
    frische: null,
    mengenbremse: { gerissen: false, anzahl: 0, hoechstzahl: e.hoechstzahl_mails },
    alarme: [],
    meldungen: [],
    protokoll: [],
  };
  var rechnungen = p.rechnungen || [];
  if (!rechnungen.length) plan.protokoll.push({ rechnungsnr: '', aktion: 'keine', grund: '0 offene Posten' });

  plan.frische = pruefeFrische(p.auszugStand, stichtag, e.max_alter_auszug);
  rechnungen.forEach(function (r) {
    var d = entscheide(r, e, stichtag);
    plan.entscheidungen.push(d);
    d.meldungen.forEach(function (m) { plan.meldungen.push(m); });
  });

  // Sicherung Frische: Anfang
  if (!plan.frische.frisch) {
    var betroffen = 0;
    plan.entscheidungen.forEach(function (d) {
      if (STUFEN_VERSAND.indexOf(d.aktion) >= 0 || d.aktion === 'uebergabe') {
        d.aktion_geplant = d.aktion;
        d.aktion = 'zu_alt';
        d.grund = 'zu alt';
        betroffen++;
      }
    });
    plan.alarme.push({ art: 'Kontoauszug zu alt', text: plan.frische.grund, betroffen: betroffen });
  }
  // Sicherung Frische: Ende

  var tbFehler = p.textbausteine_fehler || [];
  // Sicherung Textbausteine: Anfang
  if (tbFehler.length) {
    plan.entscheidungen.forEach(function (d) {
      if (STUFEN_VERSAND.indexOf(d.aktion) >= 0) {
        d.aktion_geplant = d.aktion;
        d.aktion = 'textbausteine';
        d.grund = 'Textbausteine ungültig';
      }
    });
    plan.alarme.push({ art: 'Textbausteine ungültig', text: tbFehler.join('; ') });
  }
  // Sicherung Textbausteine: Ende

  var anzahl = plan.entscheidungen.filter(function (d) { return STUFEN_VERSAND.indexOf(d.aktion) >= 0; }).length;
  plan.mengenbremse.anzahl = anzahl;
  // Sicherung Mengenbremse: Anfang
  if (anzahl > e.hoechstzahl_mails) {
    plan.mengenbremse.gerissen = true;
    plan.entscheidungen.forEach(function (d) {
      if (STUFEN_VERSAND.indexOf(d.aktion) >= 0) {
        d.aktion_geplant = d.aktion;
        d.aktion = 'mengenbremse';
        d.grund = 'Mengenbremse';
      }
    });
    plan.alarme.push({ art: 'Mengenbremse', text: anzahl + ' Vorgänge fällig, Höchstzahl ' + e.hoechstzahl_mails });
  }
  // Sicherung Mengenbremse: Ende

  plan.versand = plan.entscheidungen.filter(function (d) { return STUFEN_VERSAND.indexOf(d.aktion) >= 0; });
  plan.entscheidungen.forEach(function (d) {
    plan.protokoll.push({
      rechnungsnr: d.rechnungsnr,
      aktion: d.aktion,
      stufe_vorher: d.stufe_vorher,
      stufe_nachher: d.stufe,
      rest_cent: d.rest_cent,
      grund: d.grund,
    });
  });
  return plan;
}

// Idempotenzsperre (BAUPLAN e 6.4). protokoll: Zeilen in Blattreihenfolge,
// { schluessel: "Rechnungsnr.|Stufe", aktion, lauf_id }. Gesendet wird nur, wenn
// es noch kein "versendet" gibt UND die frueheste "reserviert"-Zeile die eigene ist.
function darfSenden(protokoll, rechnungsnr, stufe, laufId) {
  var schl = String(rechnungsnr) + '|' + String(stufe);
  var zeilen = (protokoll || []).filter(function (z) { return z && z.schluessel === schl; });
  if (zeilen.some(function (z) { return z.aktion === 'versendet'; })) return { senden: false, grund: 'schon versendet' };
  var res = zeilen.filter(function (z) { return z.aktion === 'reserviert'; });
  if (!res.length) return { senden: false, grund: 'keine Reservierung' };
  if (String(res[0].lauf_id) !== String(laufId)) return { senden: false, grund: 'übersprungen, anderer Lauf' };
  return { senden: true, grund: '' };
}

// Empfaenger nach Modus. test: IMMER der Testempfaenger (im Code erzwungen),
// trocken: kein Gmail-Aufruf, scharf: Kundenadresse. Alles andere: kein Versand.
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

// Stichtag aus dem Einstellungsblatt gilt nur in test/trocken. heute kommt als
// Parameter (im Code-Node aus der Uhr in Europe/Berlin berechnet, nie hier).
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STUFEN_PFLICHTSPALTEN, datumPlusTage, tageZwischen, pruefeKopfzeile, pruefeFrische,
    faelligeStufe, entscheide, mitZahlstand, planeLauf, darfSenden, waehleEmpfaenger, bestimmeStichtag,
  };
}
