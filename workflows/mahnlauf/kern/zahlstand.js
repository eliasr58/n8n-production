// Mahnlauf, Kernlogik: Unterworkflow "Zahlstand lesen", Quelle Sheet (BAUPLAN d, e, g; Baustein 5).
//
// Ohne Abhaengigkeit, 1:1 in einen n8n-Code-Node kopierbar. Das Zusammenspiel aus Buch
// (zahlungseingaenge.js), Parsern, Zuordnung (zuordnung.js) und Frische (stufen.js). Die Funktionen
// der anderen Module kommen als Parameter k herein - im Code-Node stehen sie im selben Rumpf, in den
// Tests kommen sie per require.
//
// Regel (BAUPLAN h): Erwartbares kommt als Status bzw. Meldung zurueck (unlesbare CSV, Datei im
// anderen Format, keine Datei, Ordner fehlt). Geworfen wird nur bei Unerwartetem.
// Belastungen (Lastschriften, Abbuchungen) sind keine Meldung an den Betrieb, sie gehen still ins Protokoll
// (Entscheidung Elias 25.09.2026, Baustein 10 Teil A 2); Klaerfall bleiben Storno und Ruecklastschrift.

var ZS_STILL = ['Belastungen nicht gezählt'];

function zsText(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function zsIstDatum(s) {
  var r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!r) return false;
  var d = new Date(Date.UTC(+r[1], +r[2] - 1, +r[3]));
  return d.getUTCFullYear() === +r[1] && d.getUTCMonth() === +r[2] - 1 && d.getUTCDate() === +r[3];
}

// Eingang { quelle, stichtag, posten, schreiben }. posten: Items von "Offene Posten lesen" (art
// posten). schreiben: true schreibt das Buch fort, false (Modus trocken) rechnet nur.
function pruefeEingangZahlstand(e) {
  if (!e || typeof e !== 'object') throw new Error('Zahlstand lesen - Eingang fehlt');
  var q = e.quelle;
  if (!q || typeof q !== 'object' || !zsText(q.art)) throw new Error('Zahlstand lesen - Eingang ohne quelle.art');
  if (!zsIstDatum(e.stichtag)) throw new Error('Zahlstand lesen - Stichtag nicht im Format JJJJ-MM-TT');
  if (!Array.isArray(e.posten)) throw new Error('Zahlstand lesen - Eingang ohne posten');
  if (typeof e.schreiben !== 'boolean') throw new Error('Zahlstand lesen - Eingang ohne schreiben (true oder false)');
  if (q.art !== 'Sheet') {
    return { weiter: false, status: 'quelle_nicht_gebaut', quelle: q, stichtag: e.stichtag, schreiben: e.schreiben,
      meldung: 'Quelle "' + zsText(q.art) + '" ist vorbereitet, nicht gebaut' };
  }
  if (!zsText(q.tabelle_id)) throw new Error('Zahlstand lesen - Eingang ohne quelle.tabelle_id');
  return { weiter: true, status: '', quelle: q, stichtag: e.stichtag, schreiben: e.schreiben, tabelle_id: zsText(q.tabelle_id),
    posten: e.posten };
}

// Antwort von Drive files.list -> Dateien { id, name, mimeType }, nach Namen sortiert. Ordner und
// Google-eigene Dokumente sind keine Kontoauszuege.
function dateienAusDrive(body) {
  return ((body && body.files) || [])
    .filter(function (f) { return String(f.mimeType || '').indexOf('application/vnd.google-apps.') !== 0; })
    .map(function (f) { return { id: f.id, name: f.name, mimeType: f.mimeType || '' }; })
    .sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
}

// p = { einstellungen (Kernform), bestand (Zeilen aus leseZahlungseingaenge), dateien: [{ datei,
//       format, ergebnis }], gemeldet: [{ datei, grund }], posten, stichtag }
// k = { ordneZahlungenZu, pruefeFrische, schreibeFort, zuordnungsEingabe, schreibauftrag }
// -> { status: {...}, zahlstand: [je Posten], auftrag: { berechnet, neu } }
function berechneZahlstand(p, k) {
  var e = p.einstellungen || {};
  var meldungen = [];
  var protokoll = [];
  var stand = null;
  var gelesen = [];
  (p.dateien || []).forEach(function (d) {
    var r = d.ergebnis || {};
    if (!r.ok) {
      var f = r.fehler || {};
      meldungen.push({ art: 'Kontoauszug unlesbar', datei: d.datei, zeile: f.zeile, text: f.grund });
      return;
    }
    gelesen.push(d);
    if (r.stand && (stand === null || r.stand > stand)) stand = r.stand;
    (r.hinweise || []).forEach(function (h) {
      if (ZS_STILL.indexOf(h.art) >= 0) protokoll.push({ aktion: h.art, grund: 'Datei ' + d.datei + ' · ' + h.anzahl });
      else meldungen.push({ art: h.art, datei: d.datei, text: String(h.anzahl) });
    });
  });
  (p.gemeldet || []).forEach(function (g) { meldungen.push({ art: 'Datei nicht gelesen', datei: g.datei, text: g.grund }); });
  var frische = k.pruefeFrische(stand, p.stichtag, e.max_alter_auszug);
  var fort = k.schreibeFort(p.bestand || [], gelesen);
  var alle = (p.bestand || []).concat(fort.neu);
  var ein = k.zuordnungsEingabe(alle);
  var rechnungen = (p.posten || []).map(function (x) {
    return { rechnungsnr: x.rechnungsnr, kunde: x.kunde, betrag_brutto_cent: x.betrag_brutto_cent, mahnsperre: x.mahnsperre };
  });
  var zuo = k.ordneZahlungenZu({ rechnungen: rechnungen, zahlungen: ein.zahlungen, klaerfaelle: ein.klaerfaelle,
    manuell: ein.manuell, muster: e.muster });
  zuo.meldungen.forEach(function (m) { meldungen.push(m); });
  var auftrag = k.schreibauftrag((p.bestand || []).length, alle, zuo);
  return {
    status: {
      status: 'ok',
      auszug_stand: stand,
      auszug_frisch: frische.frisch,
      frische_grund: frische.grund,
      auszugsformat: zsText(e.auszugsformat),
      dateien: (p.dateien || []).map(function (d) {
        var r = d.ergebnis || {};
        return { datei: d.datei, format: d.format, ok: !!r.ok, stand: r.ok ? r.stand : null };
      }),
      neu: fort.neu.length,
      schon_im_buch: fort.schon_im_buch,
      buch_zeilen: alle.length,
      meldungen: meldungen,
      protokoll: protokoll,
    },
    zahlstand: zuo.rechnungen.map(function (r) {
      return {
        rechnungsnr: r.rechnungsnr, bezahlt_cent: r.bezahlt_cent, rest_cent: r.rest_cent, status: r.status,
        ueberschuss_cent: r.ueberschuss_cent, klaerfall_halt: r.klaerfall_halt, klaerfall_schluessel: r.klaerfall_schluessel,
        dublette: r.dublette, stand_datum: stand, stand_quelle: 'Zahlungseingänge',
      };
    }),
    auftrag: auftrag,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pruefeEingangZahlstand, dateienAusDrive, berechneZahlstand };
}
