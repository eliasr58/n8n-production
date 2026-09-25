// Mahnlauf, Kernlogik: CAMT.053-Kontoauszug lesen (BAUPLAN d, "CAMT.053-Parser").
//
// Ohne Abhaengigkeit: kein require, kein DOMParser. 1:1 in einen n8n-Code-Node
// kopierbar. Eingabe ist das JSON des Knotens `xml` 1 (xmlToJson), gemessen am
// 24.09.2026, Lauf 5474 (Beleg 2026-09-24_vormessung-baustein1.md):
//   - Standardoptionen (mergeAttrs: true, explicitArray: false): ein einzelnes
//     Element kommt als Objekt bzw. Text, mehrere als Array; Attribute stehen
//     neben dem Text: Amt = { _: '1234.56', Ccy: 'EUR' }; Namensraum als
//     Document.xmlns; alle Werte sind Texte.
//   - explicitArray: true: jedes Element und jedes Attribut ist ein Array.
// Beide Formen werden gelesen. Betraege nur in ganzen Cent, Daten als JJJJ-MM-TT
// (Berliner Kalendertag). Verworfen wird eine Datei nur bei Formatfehlern
// (unbekannte Variante, Pflichtfeld fehlt, Betrag/Datum/Richtung unlesbar) - dann
// die GANZE Datei. Inhaltliche Auffaelligkeiten eines Eintrags werden Klaerfall,
// die Datei bleibt gueltig (Teil A, 25.09.2026).
// Ergebnis wie beim CSV-Parser, dazu `klaerfaelle` (Storno, Fremdwaehrung,
// Bankreferenz doppelt, Summe der TxDtls abweichend, Sammelbuchung ohne
// Einzelbetrag, Belastung in einer Gutschrift):
//   { ok: true, zahlungen, stand, hinweise, klaerfaelle }
//   { ok: false, fehler: { datei, zeile, grund } }   (zeile: Nummer des Ntry)

var CAMT_VARIANTEN = {
  'urn:iso:std:iso:20022:tech:xsd:camt.053.001.02': '02',
  'urn:iso:std:iso:20022:tech:xsd:camt.053.001.08': '08',
};

// explicitArray: true verpackt alles in Arrays - ein Wert ist dann das erste Element.
function camtEins(x) {
  return Array.isArray(x) ? x[0] : x;
}

// Wiederholbares Element als Liste, egal ob es als Objekt, Array oder gar nicht kommt.
function camtListe(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

// Pfad lesen: camtWeg(o, 'RltdPties', 'Dbtr', 'Nm'), jede Stufe durch camtEins.
// Nur fuer Elemente, die hoechstens einmal vorkommen - Listen mit camtListe lesen.
function camtWeg(o) {
  var x = camtEins(o);
  for (var i = 1; i < arguments.length; i++) {
    if (x === undefined || x === null || typeof x !== 'object') return undefined;
    x = camtEins(x[arguments[i]]);
  }
  return x;
}

// Text eines Elements: '1234.56' oder { _: '1234.56', Ccy: 'EUR' } oder [..].
function camtText(x) {
  x = camtEins(x);
  if (x === undefined || x === null) return '';
  if (typeof x === 'object') return x._ === undefined ? '' : String(camtEins(x._));
  return String(x);
}

function camtAttribut(x, name) {
  x = camtEins(x);
  if (!x || typeof x !== 'object') return '';
  var v = camtEins(x[name]);
  return v === undefined || v === null ? '' : String(v);
}

// CAMT-Betraege: Punkt als Dezimalzeichen, hoechstens zwei Nachkommastellen,
// ohne Vorzeichen (die Richtung steht in CdtDbtInd). Gleitkomma wird nie benutzt.
function camtBetragCent(text) {
  var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  var nach = (m[2] || '') + '00';
  return parseInt(m[1], 10) * 100 + parseInt(nach.slice(0, 2), 10);
}

function camtZwei(n) {
  return (n < 10 ? '0' : '') + n;
}

// Letzter Sonntag eines Monats (UTC-Tag), fuer die Umstellung der Berliner Zeit.
function camtLetzterSonntag(jahr, monat) {
  var t = new Date(Date.UTC(jahr, monat, 0));
  return t.getUTCDate() - t.getUTCDay();
}

// Berliner Kalendertag zu einem Zeitpunkt. Nimmt 'JJJJ-MM-TT' unveraendert und
// 'JJJJ-MM-TTThh:mm:ss[.s](Z|+hh:mm|-hh:mm)'. Ohne Zonenangabe gilt die
// Uhrzeit als Berliner Ortszeit. Sommerzeit: letzter Sonntag im Maerz 01:00 UTC
// bis letzter Sonntag im Oktober 01:00 UTC.
function berlinerDatum(text) {
  var s = String(text == null ? '' : text).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(s);
  if (!m) return null;
  if (!m[7]) return m[1] + '-' + m[2] + '-' + m[3];
  var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7] !== 'Z') {
    var vz = m[7][0] === '-' ? -1 : 1;
    ms -= vz * (parseInt(m[7].slice(1, 3), 10) * 60 + parseInt(m[7].slice(4, 6), 10)) * 60000;
  }
  var d = new Date(ms);
  var j = d.getUTCFullYear();
  var beginn = Date.UTC(j, 2, camtLetzterSonntag(j, 3), 1);
  var ende = Date.UTC(j, 9, camtLetzterSonntag(j, 10), 1);
  var versatz = (ms >= beginn && ms < ende) ? 2 : 1;
  var b = new Date(ms + versatz * 3600000);
  return b.getUTCFullYear() + '-' + camtZwei(b.getUTCMonth() + 1) + '-' + camtZwei(b.getUTCDate());
}

// Status einer Buchung. .08: Sts/Cd, .02: Sts als Text.
function camtStatus(e) {
  var stsKnoten = camtWeg(e, 'Sts');
  return (stsKnoten && typeof stsKnoten === 'object' && !('_' in stsKnoten)) ? camtText(camtWeg(stsKnoten, 'Cd')) : camtText(stsKnoten);
}

function camtDatum(dtKnoten) {
  var dt = camtWeg(dtKnoten, 'Dt');
  if (dt !== undefined) return berlinerDatum(camtText(dt));
  var dtTm = camtWeg(dtKnoten, 'DtTm');
  if (dtTm !== undefined) return berlinerDatum(camtText(dtTm));
  return null;
}

// Bankreferenz-Platzhalter zaehlen als "keine Referenz": leer, NONREF,
// NOTPROVIDED, NOT PROVIDED, gross/klein egal. Dann gilt der Ersatzschluessel.
var CAMT_REF_PLATZHALTER = ['', 'NONREF', 'NOTPROVIDED'];

function camtEchteReferenz(r) {
  var s = String(r == null ? '' : r).trim();
  if (CAMT_REF_PLATZHALTER.indexOf(s.replace(/\s+/g, '').toUpperCase()) >= 0) return ''; // Sicherung Referenz-Platzhalter
  return s;
}

// Verschiedene, nicht leere Werte eines Feldes aller Teile, verbunden.
function camtVerbunden(teile, feld, trenner) {
  var aus = [];
  teile.forEach(function (p) {
    var v = String(p[feld] == null ? '' : p[feld]).trim();
    if (v && aus.indexOf(v) < 0) aus.push(v);
  });
  return aus.join(trenner);
}

function camtFnv(s, basis) {
  var h = basis >>> 0;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

// Verwendungszweck: mehrere Ustrd-Zeilen ohne Trenner zusammenfuegen - Banken
// schneiden an fester Laenge, auch mitten in einer Rechnungsnummer.
function camtZweck(rmtInf) {
  var r = camtEins(rmtInf);
  return camtListe(r && typeof r === 'object' ? r.Ustrd : undefined).map(camtText).join('').trim();
}

function camtStrukturRef(rmtInf) {
  var refs = [];
  var r = camtEins(rmtInf);
  camtListe(r && typeof r === 'object' ? r.Strd : undefined).forEach(function (strd) {
    var r = camtText(camtWeg(strd, 'CdtrRefInf', 'Ref'));
    if (r) refs.push(r.trim());
  });
  return refs.join(' ');
}

function camtAuftraggeber(tx) {
  // .08: RltdPties/Dbtr/Pty/Nm, .02: RltdPties/Dbtr/Nm
  var nm = camtText(camtWeg(tx, 'RltdPties', 'Dbtr', 'Pty', 'Nm'));
  if (!nm) nm = camtText(camtWeg(tx, 'RltdPties', 'Dbtr', 'Nm'));
  return nm.trim();
}

function camtTxBetrag(tx) {
  // .08: TxDtls/Amt, .02: TxDtls/AmtDtls/TxAmt/Amt
  var amt = camtWeg(tx, 'Amt');
  if (amt === undefined) amt = camtWeg(tx, 'AmtDtls', 'TxAmt', 'Amt');
  if (amt === undefined) return undefined;
  return { cent: camtBetragCent(camtText(amt)), waehrung: camtAttribut(amt, 'Ccy') };
}

function parseKontoauszugCamt(json, dateiname) {
  var datei = dateiname || '';
  var fehler = function (zeile, grund) {
    return { ok: false, fehler: { datei: datei, zeile: zeile, grund: grund } };
  };
  var doc = json && camtEins(json.Document);
  if (!doc || typeof doc !== 'object') return fehler(0, 'kein CAMT-Dokument (Element Document fehlt)');
  var ns = camtText(doc.xmlns);
  if (!CAMT_VARIANTEN[ns]) return fehler(0, 'unbekannte CAMT-Variante: "' + ns + '" (erlaubt: camt.053.001.02, camt.053.001.08)');
  var stmts = camtListe(camtWeg(doc, 'BkToCstmrStmt') && camtEins(doc.BkToCstmrStmt).Stmt);
  if (!stmts.length) return fehler(0, 'kein Stmt im Auszug');

  var zahlungen = [];
  var klaerfaelle = [];
  var stand = null;
  var vorgemerkt = 0;
  var belastungen = 0;
  var schluessel = {};
  var nr = 0;

  // Wie oft kommt jede echte Bankreferenz unter den verarbeiteten Buchungen (CRDT und
  // gebucht) vor? Mehrfach -> Klaerfall. Belastungen und vorgemerkte zaehlen nicht mit.
  var refAnzahl = {};
  stmts.forEach(function (st) {
    camtListe(camtEins(st).Ntry).forEach(function (en) {
      if (camtText(camtWeg(en, 'CdtDbtInd')) !== 'CRDT' || camtStatus(en) !== 'BOOK') return;
      var r = camtEchteReferenz(camtText(camtWeg(en, 'AcctSvcrRef')));
      if (r) refAnzahl[r] = (refAnzahl[r] || 0) + 1;
    });
  });

  for (var s = 0; s < stmts.length; s++) {
    var stmt = camtEins(stmts[s]);
    var bis = camtWeg(stmt, 'FrToDt', 'ToDtTm');
    var standStmt = bis !== undefined ? berlinerDatum(camtText(bis)) : null;
    var juengstes = null;
    var ntrys = camtListe(stmt.Ntry);
    for (var n = 0; n < ntrys.length; n++) {
      nr++;
      var e = camtEins(ntrys[n]);
      var amtN = camtWeg(e, 'Amt');
      var centN = camtBetragCent(camtText(amtN));
      if (centN === null) return fehler(nr, 'Betrag nicht lesbar: "' + camtText(amtN) + '"');
      var wN = camtAttribut(amtN, 'Ccy');
      var richtung = camtText(camtWeg(e, 'CdtDbtInd'));
      if (richtung !== 'CRDT' && richtung !== 'DBIT') return fehler(nr, 'CdtDbtInd nicht lesbar: "' + richtung + '"');
      var sts = camtStatus(e);
      var datum = camtDatum(camtWeg(e, 'BookgDt'));
      if (!datum) return fehler(nr, 'Buchungsdatum nicht lesbar');
      if (sts === 'BOOK' && (juengstes === null || datum > juengstes)) juengstes = datum;
      if (richtung === 'DBIT') { belastungen++; continue; }
      if (sts !== 'BOOK') { vorgemerkt++; continue; }
      var bankref = camtEchteReferenz(camtText(camtWeg(e, 'AcctSvcrRef')));
      var refDoppelt = false;
      if (bankref && refAnzahl[bankref] > 1) refDoppelt = true; // Sicherung Referenz doppelt
      var storno = camtText(camtWeg(e, 'RvslInd')).trim().toLowerCase() === 'true';
      var auffaellig = '';

      var ntryDtls = camtWeg(e, 'NtryDtls');
      var txs = camtListe(ntryDtls && typeof ntryDtls === 'object' ? ntryDtls.TxDtls : undefined);
      var teile = [];
      if (!txs.length) {
        teile.push({ cent: centN, waehrung: wN, auftraggeber: '', iban: '',
          zweck: camtText(camtWeg(e, 'AddtlNtryInf')).trim(), ref: '', e2e: '' });
      } else {
        var summe = 0;
        for (var t = 0; t < txs.length; t++) {
          var tx = camtEins(txs[t]);
          var b = camtTxBetrag(tx);
          if (b === undefined) {
            if (txs.length > 1) {
              if (!auffaellig) auffaellig = 'Sammelbuchung ohne Einzelbetrag in TxDtls ' + (t + 1);
              b = { cent: 0, waehrung: wN };
            } else {
              b = { cent: centN, waehrung: wN };
            }
          }
          if (b.cent === null) return fehler(nr, 'Betrag in TxDtls ' + (t + 1) + ' nicht lesbar');
          if (camtText(camtWeg(tx, 'CdtDbtInd')) === 'DBIT' && !auffaellig) {
            auffaellig = 'Belastung innerhalb einer Gutschrift (TxDtls ' + (t + 1) + ')';
          }
          summe += b.cent;
          var rmt = camtWeg(tx, 'RmtInf');
          teile.push({ cent: b.cent, waehrung: b.waehrung || wN,
            auftraggeber: camtAuftraggeber(tx),
            iban: camtText(camtWeg(tx, 'RltdPties', 'DbtrAcct', 'Id', 'IBAN')).trim(),
            zweck: camtZweck(rmt), ref: camtStrukturRef(rmt),
            e2e: camtText(camtWeg(tx, 'Refs', 'EndToEndId')).trim() });
        }
        if (!auffaellig && summe !== centN) {
          auffaellig = 'Summe der TxDtls (' + summe + ' Cent) ungleich Betrag der Buchung (' + centN + ' Cent)';
        }
        // Auffaelliger Eintrag: ein Klaerfall ueber den gebuchten Betrag, nicht aufgeteilt.
        if (auffaellig) {
          teile = [{ cent: centN, waehrung: wN,
            auftraggeber: camtVerbunden(teile, 'auftraggeber', ' | '),
            iban: camtVerbunden(teile, 'iban', ' | '),
            zweck: camtVerbunden(teile, 'zweck', ' | '),
            ref: camtVerbunden(teile, 'ref', ' '),
            e2e: camtVerbunden(teile, 'e2e', ' | ') }];
        }
      }

      for (var i = 0; i < teile.length; i++) {
        var p = teile[i];
        var sl;
        if (bankref && !refDoppelt) {
          sl = 'REF:' + bankref + (teile.length > 1 ? '#' + (i + 1) : '');
        } else {
          var h = [datum, p.cent, p.iban.replace(/\s+/g, '').toUpperCase(), p.zweck, p.e2e, nr, i + 1].join('|');
          sl = 'H:' + camtFnv(h, 0x811C9DC5) + camtFnv(h, 0x9DC5811C);
        }
        if (schluessel[sl]) return fehler(nr, 'Buchungsschlüssel doppelt: "' + sl + '"');
        schluessel[sl] = true;
        var z = {
          schluessel: sl,
          buchungsdatum: datum,
          betrag_cent: p.cent,
          waehrung: p.waehrung || '',
          auftraggeber: p.auftraggeber,
          iban: p.iban,
          verwendungszweck: p.zweck,
          referenz: p.ref,
          quelle: datei,
          bankreferenz: bankref,
          ende_zu_ende: p.e2e,
        };
        if (storno) klaerfaelle.push(Object.assign({ grund: 'Storno' }, z));
        else if (auffaellig) klaerfaelle.push(Object.assign({ grund: auffaellig }, z));
        else if (z.waehrung !== 'EUR') klaerfaelle.push(Object.assign({ grund: 'Fremdwährung' }, z));
        else if (refDoppelt) klaerfaelle.push(Object.assign({ grund: 'Bankreferenz doppelt: "' + bankref + '"' }, z));
        else zahlungen.push(z);
      }
    }
    var st = standStmt || juengstes;
    if (st && (stand === null || st > stand)) stand = st;
  }

  var hinweise = [];
  if (belastungen) hinweise.push({ art: 'Belastungen nicht gezählt', anzahl: belastungen, datei: datei });
  if (vorgemerkt) hinweise.push({ art: 'vorgemerkt nicht gezählt', anzahl: vorgemerkt, datei: datei });
  if (klaerfaelle.length) hinweise.push({ art: 'Klärfall aus dem Auszug', anzahl: klaerfaelle.length, datei: datei });
  return { ok: true, zahlungen: zahlungen, stand: stand, hinweise: hinweise, klaerfaelle: klaerfaelle };
}

// Vorpruefung vor dem n8n-Knoten `xml` (Baustein 5): Ist der Text wohlgeformtes XML? Der
// Knoten verschluckt ein Fehler-Item bei onError (Lauf 5407) und nennt ohne onError keinen
// Dateinamen - deshalb prueft der Code-Node vorher und wirft selbst, mit Dateiname. Geprueft:
// Tags paarweise, genau eine Wurzel, Attribute in Anfuehrungszeichen, "&" nur als Entitaet,
// Kommentare, CDATA, Verarbeitungsanweisungen. -> { ok, zeile (1-basiert, 0 = ganze Datei), grund }
var CAMT_XML_NAME = /[A-Za-z_:][A-Za-z0-9_.:\-]*/y;
var CAMT_XML_ENTITAET = /^&(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/;

function camtEntitaetFehler(t) {
  var i = t.indexOf('&');
  while (i >= 0) {
    if (!CAMT_XML_ENTITAET.test(t.slice(i, i + 12))) return 'ungültiges & (keine Entität)';
    i = t.indexOf('&', i + 1);
  }
  return '';
}

function camtXmlWohlgeformt(text) {
  var s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (!s.trim()) return { ok: false, zeile: 0, grund: 'Datei leer' };
  var n = s.length;
  var i = 0;
  var zeile = 1;
  var stapel = [];
  var elemente = 0;
  var fertig = false;
  var bis = function (ende) {
    for (var k = i; k < ende; k++) if (s.charCodeAt(k) === 10) zeile++;
    i = ende;
  };
  var fehler = function (grund) { return { ok: false, zeile: zeile, grund: grund }; };
  var name = function (ab) {
    CAMT_XML_NAME.lastIndex = ab;
    var m = CAMT_XML_NAME.exec(s);
    return m ? m[0] : '';
  };
  var leer = function (c) { return c === ' ' || c === '\t' || c === '\r' || c === '\n'; };
  while (i < n) {
    if (s[i] !== '<') {
      var e = s.indexOf('<', i);
      if (e < 0) e = n;
      var txt = s.slice(i, e);
      if (!stapel.length && txt.trim()) return fehler(fertig ? 'Text nach der Wurzel' : 'Text außerhalb der Wurzel (kein XML?)');
      var ef = camtEntitaetFehler(txt);
      if (ef) return fehler(ef);
      bis(e);
      continue;
    }
    var ende;
    if (s.startsWith('<?', i)) {
      ende = s.indexOf('?>', i + 2);
      if (ende < 0) return fehler('Verarbeitungsanweisung nicht geschlossen');
      bis(ende + 2);
      continue;
    }
    if (s.startsWith('<!--', i)) {
      ende = s.indexOf('-->', i + 4);
      if (ende < 0) return fehler('Kommentar nicht geschlossen');
      bis(ende + 3);
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      if (!stapel.length) return fehler('CDATA außerhalb der Wurzel');
      ende = s.indexOf(']]>', i + 9);
      if (ende < 0) return fehler('CDATA nicht geschlossen');
      bis(ende + 3);
      continue;
    }
    if (s.startsWith('<!', i)) {
      if (elemente) return fehler('Deklaration nach dem ersten Element');
      ende = s.indexOf('>', i + 2);
      if (ende < 0) return fehler('Deklaration nicht geschlossen');
      bis(ende + 1);
      continue;
    }
    var j;
    if (s[i + 1] === '/') {
      var zu = name(i + 2);
      if (!zu) return fehler('schließendes Tag ohne Namen');
      j = i + 2 + zu.length;
      while (j < n && leer(s[j])) j++;
      if (s[j] !== '>') return fehler('schließendes Tag </' + zu + ' nicht abgeschlossen');
      var offen = stapel.pop();
      if (offen !== zu) return fehler('schließendes Tag </' + zu + '> passt nicht zu <' + (offen || '') + '>');
      bis(j + 1);
      if (!stapel.length) fertig = true;
      continue;
    }
    var tag = name(i + 1);
    if (!tag) return fehler('Tag ohne Namen');
    if (fertig) return fehler('zweite Wurzel <' + tag + '>');
    j = i + 1 + tag.length;
    var attribute = {};
    for (;;) {
      var vorher = j;
      while (j < n && leer(s[j])) j++;
      if (j >= n) return fehler('Tag <' + tag + '> nicht abgeschlossen');
      if (s[j] === '>') { stapel.push(tag); elemente++; j++; break; }
      if (s[j] === '/' && s[j + 1] === '>') { elemente++; j += 2; if (!stapel.length) fertig = true; break; }
      if (j === vorher) return fehler('Attribut ohne Leerzeichen davor in <' + tag + '>');
      var a = name(j);
      if (!a) return fehler('Attribut in <' + tag + '> unlesbar');
      j += a.length;
      while (j < n && leer(s[j])) j++;
      if (s[j] !== '=') return fehler('Attribut ' + a + ' in <' + tag + '> ohne Wert');
      j++;
      while (j < n && leer(s[j])) j++;
      var q = s[j];
      if (q !== '"' && q !== "'") return fehler('Attribut ' + a + ' in <' + tag + '> ohne Anführungszeichen');
      var qe = s.indexOf(q, j + 1);
      if (qe < 0) return fehler('Attribut ' + a + ' in <' + tag + '> nicht geschlossen');
      var wert = s.slice(j + 1, qe);
      if (wert.indexOf('<') >= 0) return fehler('„<“ im Attribut ' + a + ' in <' + tag + '>');
      var af = camtEntitaetFehler(wert);
      if (af) return fehler(af + ' im Attribut ' + a);
      if (attribute[a]) return fehler('Attribut ' + a + ' doppelt in <' + tag + '>');
      attribute[a] = true;
      j = qe + 1;
    }
    bis(j);
  }
  if (stapel.length) return fehler('<' + stapel[stapel.length - 1] + '> nicht geschlossen');
  if (!elemente) return fehler('kein Element (kein XML?)');
  return { ok: true, zeile: 0, grund: '' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseKontoauszugCamt, camtBetragCent, berlinerDatum, camtXmlWohlgeformt };
}
