'use strict';
// antwort.js: Antworten im Gmail-Thread erkennen und für die Einordnung kürzen (BAUPLAN c 3-4).
// Form der Nachrichten wie gemessen in Baustein 1 (Lauf 6602, threads.get format=full): eigene Mail mit Label SENT,
// eingefügte Antworten ohne Label; Reihenfolge im Thread NICHT nach internalDate (R5 vor R4).
// Alle Texte erfunden; Kontaktangaben offenkundig falsch.
const test = require('node:test');
const assert = require('node:assert/strict');
const aw = require('../kern/antwort.js');

const b64u = (s, enc) => Buffer.from(s, enc || 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const kopf = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const teil = (mime, text, headers, enc) => ({ mimeType: mime, headers: kopf(headers || {}), body: { data: b64u(text, enc), size: text.length } });
const nachricht = (id, ms, labels, headers, payload) => ({ id, internalDate: String(ms), labelIds: labels,
  payload: Object.assign({ headers: kopf(headers) }, payload) });

// ---- Dekodieren und Text gewinnen ---------------------------------------------------------------------------

test('base64url → UTF-8 mit Umlauten', () => {
  assert.equal(aw.dekodiere(b64u('Grüße aus Straßkirchen – €'), 'utf-8'), 'Grüße aus Straßkirchen – €');
});

test('Zeichensatz aus dem Teil: ISO-8859-1 und windows-1252 (Outlook), unbekannt wie UTF-8', () => {
  assert.equal(aw.dekodiere(b64u('Grüße', 'latin1'), 'iso-8859-1'), 'Grüße');
  const bytes = Buffer.from([0x80, 0x20, 0x93, 0x6f, 0x6b, 0x94, 0x20, 0xe4]).toString('base64');
  assert.equal(aw.dekodiere(bytes.replace(/\+/g, '-').replace(/\//g, '_'), 'windows-1252'), '€ “ok” ä');
  assert.equal(aw.dekodiere(b64u('Grüße'), ''), 'Grüße');
});

test('textAusNachricht: text/plain direkt; multipart/alternative bevorzugt text/plain', () => {
  const einfach = nachricht('a', 1, [], {}, { mimeType: 'text/plain', body: { data: b64u('Hallo') } });
  assert.deepEqual(aw.textAusNachricht(einfach), { text: 'Hallo', quelle: 'plain' });
  const alt = nachricht('b', 1, [], {}, { mimeType: 'multipart/alternative', parts: [
    teil('text/plain', 'Nur Text', { 'Content-Type': 'text/plain; charset="UTF-8"' }),
    teil('text/html', '<p>HTML</p>', { 'Content-Type': 'text/html; charset="UTF-8"' })] });
  assert.equal(aw.textAusNachricht(alt).text, 'Nur Text');
});

test('textAusNachricht: nur HTML → Text; verschachtelt mit Anhang; Zeichensatz des Teils', () => {
  const html = nachricht('c', 1, [], {}, { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [teil('text/html', '<div>Gr&uuml;&szlig;e<br>Zeile&nbsp;2</div>', { 'Content-Type': 'text/html; charset=utf-8' })] },
    { mimeType: 'application/pdf', filename: 'x.pdf', body: { attachmentId: 'A1', size: 10 } }] });
  assert.deepEqual(aw.textAusNachricht(html), { text: 'Grüße\nZeile 2', quelle: 'html' });
  const latin = nachricht('d', 1, [], {}, { mimeType: 'text/plain',
    headers: kopf({ 'Content-Type': 'text/plain; charset=ISO-8859-1' }), body: { data: b64u('Grüße', 'latin1') } });
  latin.payload.headers = kopf({ 'Content-Type': 'text/plain; charset=ISO-8859-1' });
  assert.equal(aw.textAusNachricht(latin).text, 'Grüße');
  assert.deepEqual(aw.textAusNachricht(nachricht('e', 1, [], {}, { mimeType: 'application/pdf' })), { text: '', quelle: null });
});

test('htmlZuText: Absätze, Entitäten, Gmail-Zitat und blockquote entfernt, style/script entfernt', () => {
  const h = '<style>p{color:red}</style><p>Termin gern &amp; bald.</p><p>Gru&szlig;</p>'
    + '<div class="gmail_quote">Am … schrieb …:<blockquote>Alt</blockquote></div><script>x()</script>';
  assert.equal(aw.htmlZuText(h), 'Termin gern & bald.\nGruß');
  assert.equal(aw.htmlZuText('A<blockquote type="cite">zitiert</blockquote>B'), 'A\nB');
  assert.equal(aw.htmlZuText('&lt;x&gt; &quot;y&quot; &#39;z&#39; &#8364;'), '<x> "y" \'z\' €');
});

// ---- Zitat und Signatur abtrennen ---------------------------------------------------------------------------

const ANTWORT = 'Guten Tag,\n\ngern, rufen Sie mich nächste Woche an.';
const ZITATE = {
  'Gmail deutsch': 'Am Fr., 26. Sept. 2026 um 10:00 Uhr schrieb Heizung & Sanitär Beispiel GmbH <info@example.invalid>:\n> Guten Tag,\n> Ihre Anlage ist fällig.',
  'Gmail umbrochen': 'Am Fr., 26. Sept. 2026 um 10:00 Uhr schrieb Heizung & Sanitär Beispiel GmbH\n<info@example.invalid>:\n> Alt',
  'Apple Mail': 'Am 26.09.2026 um 10:00 schrieb Heizung & Sanitär Beispiel GmbH <info@example.invalid>:\n\n> Alt',
  'englisch': 'On Fri, Sep 26, 2026 at 10:00 AM Heizung <info@example.invalid> wrote:\n> Old',
  'Outlook Strichzeile': '-----Ursprüngliche Nachricht-----\nVon: Heizung <info@example.invalid>\nGesendet: Freitag, 26. September 2026 10:00\nBetreff: Wartung',
  'Outlook ohne Strich': '________________________________\nVon: Heizung & Sanitär Beispiel GmbH <info@example.invalid>\nGesendet: Freitag, 26. September 2026 10:00\nAn: Kunde\nBetreff: Wartung',
  'Outlook englisch': 'From: Heizung <info@example.invalid>\nSent: Friday, September 26, 2026 10:00 AM\nSubject: Wartung',
  'nur Zitatzeilen': '> Guten Tag,\n> Ihre Anlage ist fällig.',
};

test('ohneZitat: alle Formen werden abgeschnitten', () => {
  for (const [name, z] of Object.entries(ZITATE)) assert.equal(aw.ohneZitat(ANTWORT + '\n\n' + z), ANTWORT, name);
});

test('ohneZitat: Kontrolle — Text ohne Zitat bleibt, „Am Montag schreibe ich …“ ist kein Zitatkopf', () => {
  assert.equal(aw.ohneZitat(ANTWORT), ANTWORT);
  const t = 'Am Montag schreibe ich Ihnen die Zeiten.\nVon: bis ist mir egal.';
  assert.equal(aw.ohneZitat(t), t);
});

test('ohneSignatur: Trenner „-- “ und Grußblock werden abgeschnitten; Kontrolle ohne Signatur unverändert', () => {
  assert.equal(aw.ohneSignatur(ANTWORT + '\n\n-- \nKunde Beispiel 01\nMusterweg 1'), ANTWORT);
  assert.equal(aw.ohneSignatur(ANTWORT + '\n\nMit freundlichen Grüßen\nKunde Beispiel 01\nMusterweg 1\n00000 Musterstadt\nTel. 0000 000000'), ANTWORT);
  assert.equal(aw.ohneSignatur(ANTWORT + '\n\nViele Grüße\nK. Beispiel'), ANTWORT);
  assert.equal(aw.ohneSignatur(ANTWORT), ANTWORT);
});

test('ohneSignatur: „Grüß Gott“ als Anrede ist kein Schlussgruß; ein Gruß in der ersten Zeile schneidet nie ab', () => {
  assert.equal(aw.ohneSignatur('Grüß Gott,\nbitte rufen Sie mich an.'), 'Grüß Gott,\nbitte rufen Sie mich an.');
  assert.equal(aw.ohneSignatur('Grüss Gott\nTermin gern.\n\nViele Grüße\nK.'), 'Grüss Gott\nTermin gern.');
  assert.equal(aw.ohneSignatur('Viele Grüße\nund bitte Termin im Oktober.'), 'Viele Grüße\nund bitte Termin im Oktober.');
});

test('ohneSignatur: ein Gruß mitten im Text schneidet nicht ab (mehr als zehn Zeilen danach)', () => {
  const t = 'Viele Grüße an Ihren Monteur!\n' + Array.from({ length: 12 }, (_, i) => 'Zeile ' + i).join('\n');
  assert.equal(aw.ohneSignatur(t), t);
});

test('maskiereKontakt: Telefon, Mail, IBAN, Anschrift, PLZ/Ort; Kontrolle Datum und Uhrzeit bleiben', () => {
  const t = 'Tel. +49 000 0000011, mobil 0000/0000022, Festnetz (0000) 000 033, Fax 0000 000000\n'
    + 'Mail: kunde-01@example.invalid\nIBAN DE00 1234 5678 9012 3456 78\nHauptstraße 12a, 00000 Musterstadt\nMusterweg 1';
  const m = aw.maskiereKontakt(t);
  for (const x of ['0000011', '0000022', '000 033', '0000 000000', 'example.invalid', 'DE00', 'Hauptstraße', 'Musterweg', '00000']) {
    assert.ok(!m.includes(x), x + ' in: ' + m);
  }
  for (const p of ['<TELEFON>', '<EMAIL>', '<IBAN>', '<ANSCHRIFT>', '<PLZ_ORT>']) assert.ok(m.includes(p), p);
  const k = 'Termin am 12.10.2026 um 14:30 Uhr, Anlage von 2018, 3 Heizkörper.';
  assert.equal(aw.maskiereKontakt(k), k);
});

test('W09: fuerKi — nur der gekürzte, maskierte Antworttext, höchstens 2000 Zeichen', () => {
  const roh = 'Guten Tag,\n\ngern Termin, rufen Sie 0000 0000044 an.\n\nMit freundlichen Grüßen\nKunde Beispiel 01\nMusterweg 1\n'
    + '00000 Musterstadt\n\n' + ZITATE['Gmail deutsch'];
  const r = aw.fuerKi(roh);
  assert.equal(r.text, 'Guten Tag,\n\ngern Termin, rufen Sie <TELEFON> an.');
  assert.equal(r.gekuerzt, false);
  const lang = aw.fuerKi('x'.repeat(2500));
  assert.equal(lang.text.length, 2000);
  assert.equal(lang.gekuerzt, true);
});

test('W09: fuerKi ohne Grußblock — das Zitat allein wird trotzdem entfernt (eigener Text geht nicht an Claude)', () => {
  const r = aw.fuerKi('Termin gern im Oktober.\n\n' + ZITATE['Gmail deutsch']);
  assert.equal(r.text, 'Termin gern im Oktober.');
  const o = aw.fuerKi('Termin gern.\n> Ihre Anlage ist fällig.\n> Widerspruch: …');
  assert.equal(o.text, 'Termin gern.');
});

test('textFuerWortliste: ohne Zitat, aber MIT Signaturbereich (ein Widerspruch nach dem Gruß zählt)', () => {
  const roh = 'Danke.\n\nViele Grüße\nK. Beispiel\nPS: bitte keine Werbung mehr\n\n' + ZITATE['nur Zitatzeilen'];
  const t = aw.textFuerWortliste(roh);
  assert.ok(t.includes('keine Werbung'));
  assert.ok(!t.includes('Ihre Anlage ist fällig'));
});

// ---- Art der Nachricht und Thread ------------------------------------------------------------------------------

test('artDerNachricht: Unzustellbar vor Abwesenheit (gemessene Köpfe R4, R5), sonst Antwort', () => {
  const r4 = nachricht('r4', 3, [], { From: '"Kunde Beispiel 01" <kunde-01@example.invalid>', 'Auto-Submitted': 'auto-replied', 'X-Autoreply': 'yes', Precedence: 'auto_reply' }, { mimeType: 'text/plain' });
  const r5 = nachricht('r5', 4, [], { From: '"Mail Delivery Subsystem" <mailer-daemon@example.invalid>', 'Auto-Submitted': 'auto-replied' }, { mimeType: 'text/plain' });
  const dsn = nachricht('d', 4, [], { From: 'postmaster@example.invalid' }, { mimeType: 'multipart/report' });
  const r1 = nachricht('r1', 2, [], { From: '"Kunde Beispiel 01" <kunde-01@example.invalid>' }, { mimeType: 'text/plain' });
  const nein = nachricht('n', 2, [], { From: 'kunde-01@example.invalid', 'Auto-Submitted': 'no' }, { mimeType: 'text/plain' });
  const betreff = nachricht('b', 2, [], { From: 'kunde-01@example.invalid', Subject: 'Automatische Antwort: Wartung' }, { mimeType: 'text/plain' });
  assert.equal(aw.artDerNachricht(r4), 'abwesenheit');
  assert.equal(aw.artDerNachricht(r5), 'unzustellbar');
  assert.equal(aw.artDerNachricht(dsn), 'unzustellbar');
  assert.equal(aw.artDerNachricht(r1), 'antwort');
  assert.equal(aw.artDerNachricht(nein), 'antwort');
  assert.equal(aw.artDerNachricht(betreff), 'abwesenheit');
});

test('antwortenImThread: eigene Mail = SENT; Antworten nach der ersten eigenen, nach internalDate sortiert', () => {
  const t = { id: 'T', messages: [
    nachricht('m0', 1000, ['SENT'], { From: 'x' }, { mimeType: 'text/plain' }),
    nachricht('r1', 2000, [], { From: 'kunde-01@example.invalid' }, { mimeType: 'text/plain' }),
    nachricht('r5', 4000, [], { From: 'mailer-daemon@example.invalid' }, { mimeType: 'text/plain' }),
    nachricht('r4', 3000, ['INBOX', 'UNREAD'], { From: 'kunde-01@example.invalid', 'Auto-Submitted': 'auto-replied' }, { mimeType: 'text/plain' }),
    nachricht('m1', 5000, ['SENT'], { From: 'x' }, { mimeType: 'text/plain' }),
    nachricht('e1', 6000, ['DRAFT'], { From: 'x' }, { mimeType: 'text/plain' }),
  ] };
  const r = aw.antwortenImThread(t);
  assert.equal(r.erste_eigene_ms, 1000);
  assert.deepEqual(r.antworten.map((a) => [a.id, a.art]), [['r1', 'antwort'], ['r4', 'abwesenheit'], ['r5', 'unzustellbar']]);
});

test('antwortenImThread: Kontrolle — nur eigene Mail → keine Antwort; Nachricht vor der eigenen zählt nicht; ohne eigene Mail kein Ergebnis', () => {
  const nurEigen = { messages: [nachricht('m0', 1000, ['SENT'], {}, { mimeType: 'text/plain' })] };
  assert.deepEqual(aw.antwortenImThread(nurEigen).antworten, []);
  const vorher = { messages: [nachricht('alt', 500, ['INBOX'], {}, { mimeType: 'text/plain' }), nachricht('m0', 1000, ['SENT'], {}, { mimeType: 'text/plain' })] };
  assert.deepEqual(aw.antwortenImThread(vorher).antworten, []);
  const ohne = { messages: [nachricht('x', 500, ['INBOX'], {}, { mimeType: 'text/plain' })] };
  assert.deepEqual(aw.antwortenImThread(ohne), { erste_eigene_ms: null, antworten: [] });
  assert.deepEqual(aw.antwortenImThread(null), { erste_eigene_ms: null, antworten: [] });
});

test('Teil B: antwortenImThread mit Untergrenze — Thread ohne eigene Mail (Abmeldung per Klick) zählt ab der ersten eigenen Mail des Angebots', () => {
  const t = { messages: [nachricht('alt', 500, ['INBOX'], { From: 'kunde-01@example.invalid' }, { mimeType: 'text/plain' }),
    nachricht('ab', 2000, ['INBOX'], { From: 'kunde-01@example.invalid', Subject: 'Abmelden W-9001/2026-10' }, { mimeType: 'text/plain' })] };
  const r = aw.antwortenImThread(t, 1000);
  assert.deepEqual(r.antworten.map((a) => [a.id, a.art]), [['ab', 'antwort']]);
  assert.equal(r.erste_eigene_ms, 1000);
  assert.deepEqual(aw.antwortenImThread(t).antworten, []);
  const mitEigener = { messages: [nachricht('m0', 3000, ['SENT'], {}, { mimeType: 'text/plain' }), nachricht('r', 2500, [], {}, { mimeType: 'text/plain' })] };
  assert.deepEqual(aw.antwortenImThread(mitEigener, 1000).antworten, []);
  assert.equal(aw.betreffDerNachricht(t.messages[1]), 'Abmelden W-9001/2026-10');
  assert.equal(aw.betreffDerNachricht(t.messages[0]), '');
});

test('Befund Baustein 1: threads.get sortiert nicht nach internalDate — ganzer Thread rückwärts ergibt dasselbe', () => {
  const vor = [
    nachricht('m0', 1000, ['SENT'], { From: 'x' }, { mimeType: 'text/plain' }),
    nachricht('r1', 2000, [], { From: 'kunde-01@example.invalid' }, { mimeType: 'text/plain' }),
    nachricht('r4', 3000, [], { From: 'kunde-01@example.invalid', 'Auto-Submitted': 'auto-replied' }, { mimeType: 'text/plain' }),
    nachricht('r5', 4000, [], { From: 'mailer-daemon@example.invalid' }, { mimeType: 'text/plain' }),
  ];
  const a = aw.antwortenImThread({ messages: vor });
  const b = aw.antwortenImThread({ messages: vor.slice().reverse() });
  assert.deepEqual(b, a);
  assert.deepEqual(b.antworten.map((x) => x.id), ['r1', 'r4', 'r5']);
  assert.equal(b.erste_eigene_ms, 1000);
});

// Antwortstand je Anlage aus den eingeordneten Antworten ihres Threads (Hauptlauf -> planeLauf).
const ea = (id, ms, art, klasse, abw) => Object.assign({ gmail_id: id, internalDate: ms, datum: '2026-09-' + String(10 + ms / 1000),
  art, klasse: klasse || '', eingeordnet: true, gesperrt: false }, abw || {});

test('antwortStand: neueste Antwort bestimmt Klasse und Datum, unabhängig von der Reihenfolge der Eingabe', () => {
  const liste = [ea('r1', 1000, 'antwort', 'rueckfrage'), ea('r2', 3000, 'antwort', 'termin'), ea('r3', 2000, 'abwesenheit')];
  const s = aw.antwortStand(liste);
  assert.deepEqual(s, { art: 'antwort', klasse: 'termin', datum: '2026-09-13', eingeordnet: true, gesperrt: false, anzahl: 3 });
  assert.deepEqual(aw.antwortStand(liste.slice().reverse()), s);
});

test('antwortStand: Antwort vor Unzustellbar vor Abwesenheit; eine nicht eingeordnete oder gesperrte Antwort zählt', () => {
  assert.equal(aw.antwortStand([ea('a', 1000, 'abwesenheit'), ea('u', 2000, 'unzustellbar')]).art, 'unzustellbar');
  assert.equal(aw.antwortStand([ea('a', 2000, 'abwesenheit')]).art, 'abwesenheit');
  const offen = aw.antwortStand([ea('r1', 1000, 'antwort', 'termin'), ea('r2', 2000, 'antwort', '', { eingeordnet: false })]);
  assert.equal(offen.eingeordnet, false);
  assert.equal(aw.antwortStand([ea('r1', 1000, 'antwort', 'widerspruch', { gesperrt: true }), ea('r2', 2000, 'antwort', 'termin')]).gesperrt, true);
  assert.equal(aw.antwortStand([]), null);
});
