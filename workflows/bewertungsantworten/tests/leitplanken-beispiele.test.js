'use strict';
// TESTKATALOG i, „Nur im Kern“: Leitplanken mit mindestens 60 Positiv- und Negativbeispielen je Klasse - gelesen als je
// Trefferklasse hart (S07) und weich (S08); dazu die bekannten Fehlgriffe („Termine halten ist uns wichtig“, „Herr der Lage“).
// Alle Beispiele erfunden; Rufnummern 0000 …, Domains .example/.invalid.
const test = require('node:test');
const assert = require('node:assert/strict');
const lp = require('../kern/leitplanken.js');
const FIX = require('./testdaten/b1-fixtures.json');

const B = FIX.betrieb;
const ctx = (abw) => Object.assign({ anzeigename: 'Petra Musterfrau', bewertungstext: 'Herr Beispielmann und Frau Dr. Erika Mustermann waren super.',
  betrieb: B, hoechstlaenge: 800, verboten: ['Rabatt', 'Gutschein'] }, abw || {});
const klasse = (d) => (/^nicht deutsch/.test(d) ? 'Antwort nicht deutsch' : /^Kundenbeziehung angedeutet/.test(d) ? 'Kundenbeziehung angedeutet'
  : /^verbotener Begriff/.test(d) ? 'verbotener Begriff' : d.split(' ')[0]);

// [Text, erwartete Klasse]
const HART = [
  ['Rufen Sie 0000 111111 an.', 'Telefon'], ['Tel. 0000/222222', 'Telefon'], ['unter +49 000 1234567', 'Telefon'], ['(0000) 333 444', 'Telefon'],
  ['Mobil 0000 55 66 77', 'Telefon'], ['0000-888888 gern', 'Telefon'], ['Fax: 0000 999999', 'Telefon'], ['+49 (0) 000 7777777', 'Telefon'],
  ['0000 1234567 bitte', 'Telefon'], ['Tel: 00001 23456', 'Telefon'],
  ['info@example.invalid', 'Mail'], ['kunde-01@example.invalid', 'Mail'], ['a.b@beispiel.invalid schreiben', 'Mail'],
  ['an team@konkurrenz-beispiel.example', 'Mail'], ['x_y@example.invalid', 'Mail'], ['service+rueckfrage@example.invalid', 'Mail'],
  ['www.konkurrenz-beispiel.example', 'URL'], ['https://konkurrenz-beispiel.example/aktion', 'URL'], ['http://beispiel.example', 'URL'],
  ['besuchen Sie dach-portal.example', 'URL'], ['mehr auf bewertung.example/xy', 'URL'], ['www.example.invalid', 'URL'],
  ['https://zimmerei-beispiel.example.falle.example', 'URL'], ['unter angebot.dachportal.example.', 'URL'],
  ['DE00 1234 5678 9012 3456 78', 'IBAN'], ['DE00123456789012345678', 'IBAN'], ['AT00 1234 5678 9012 3456', 'IBAN'], ['IBAN: CH00 0000 0000 0000 0000 0', 'IBAN'],
  ['Danke, Petra!', 'Name'], ['Liebe Frau Musterfrau,', 'Name'], ['Hallo petra,', 'Name'], ['Grüße an Herrn Beispielmann', 'Name'],
  ['Danke, Erika!', 'Name'], ['Frau Mustermann war toll', 'Name'], ['MUSTERFRAU', 'Name'], ['Beispielmann hat recht', 'Name'],
  ['Danke, Herr <NAME>!', 'Platzhalter'], ['unter < TELEFON >', 'Platzhalter'], ['an <email>', 'Platzhalter'], ['{betrieb} dankt', 'Platzhalter'],
  ['{ signatur }', 'Platzhalter'], ['<PLZ_ORT> ist schön', 'Platzhalter'], ['<ANSCHRIFT>', 'Platzhalter'], ['{kunde}', 'Platzhalter'],
  ['Da Sie nicht Kunde bei uns waren, …', 'Kundenbeziehung'], ['Als Kundin wissen Sie das.', 'Kundenbeziehung'],
  ['Sie haben keine Erfahrung mit uns gemacht.', 'Kundenbeziehung'], ['Ihre Erfahrungen bei uns freuen uns.', 'Kundenbeziehung'],
  ['Sie waren nie bei uns.', 'Kundenbeziehung'], ['Sie haben noch nie mit uns gearbeitet.', 'Kundenbeziehung'],
  ['Wir haben für Sie gerne gearbeitet.', 'Kundenbeziehung'], ['Wir durften bei Ihnen das Dach decken und haben bei Ihnen saniert.', 'Kundenbeziehung'],
  ['dass wir Ihnen eine gute Arbeit leisten konnten', 'Kundenbeziehung'], ['Ihr Auftrag war uns wichtig.', 'Kundenbeziehung'],
  ['Ihre Baustelle war sauber.', 'Kundenbeziehung'], ['Ihr Dachfenster sitzt.', 'Kundenbeziehung'], ['Sie haben uns beauftragt.', 'Kundenbeziehung'],
  ['Danke, dass Sie uns die Gelegenheit gegeben haben.', 'Kundenbeziehung'], ['das Vertrauen, das Sie uns geschenkt haben', 'Kundenbeziehung'],
  ['Ihren Termin holen wir nach.', 'Kundenbeziehung'], ['Unsere Kundenbeziehung ist uns wichtig.', 'Kundenbeziehung'],
  ['x'.repeat(801), 'Länge'], ['ä'.repeat(801), 'Länge'], ['   ', 'leer'], ['', 'leer'],
  ['Wir geben Ihnen Rabatt.', 'verbotener Begriff'], ['Ein Gutschein folgt.', 'verbotener Begriff'],
];

const WEICH = [
  ['Die 120 € erstatten wir.', 'Betrag'], ['4.800 € sind viel.', 'Betrag'], ['1.234,50 € offen', 'Betrag'], ['€ 99 Anfahrt', 'Betrag'],
  ['12 EUR Gebühr', 'Betrag'], ['300 Euro Nachlass', 'Betrag'], ['2.300€ gesamt', 'Betrag'], ['80 Euro Anfahrt', 'Betrag'],
  ['12 eur mehr', 'Betrag'], ['Das kostete 5,50 €.', 'Betrag'],
  ['bis 12.10. erledigt', 'Datum/Zeit'], ['am 12.10.2026 fertig', 'Datum/Zeit'], ['ab 1. 2. geht es', 'Datum/Zeit'], ['um 14:30 kommen', 'Datum/Zeit'],
  ['8:15 Uhr passt', 'Datum/Zeit'], ['im Oktober fertig', 'Datum/Zeit'], ['Ende März vorbei', 'Datum/Zeit'], ['im Mai erledigt', 'Datum/Zeit'],
  ['am 3.4.26 geprüft', 'Datum/Zeit'], ['gegen 07:45 da', 'Datum/Zeit'],
  ['in 00000 gewesen', 'Ort'], ['am Musterweg', 'Ort'], ['in der Hauptstraße', 'Ort'], ['am Marktplatz gearbeitet', 'Ort'],
  ['die Lindenallee entlang', 'Ort'], ['an der Ringstraße', 'Ort'], ['in 12345 Musterstadt', 'Ort'], ['Bahnhofstr. vorbei', 'Ort'],
  ['der Auftrag lief gut', 'Vorgang'], ['alle Aufträge erledigt', 'Vorgang'], ['die Rechnung stimmt', 'Vorgang'], ['das Angebot kam', 'Vorgang'],
  ['die Baustelle war sauber', 'Vorgang'], ['gern wieder bei Ihnen', 'Vorgang'], ['wir können das nicht zuordnen', 'Vorgang'],
  ['der Rechnungsbetrag', 'Vorgang'], ['die Angebotserstellung', 'Vorgang'], ['die Auftragsnummer', 'Vorgang'],
  ['Den Termin holen wir nach.', 'Termin'], ['Der neue Termin passt.', 'Termin'], ['Die Verschiebung des Starttermins tut uns leid.', 'Termin'],
  ['Wir bieten einen Termin am Montag an.', 'Termin'], ['Termin um 9 geht.', 'Termin'], ['Am 5. ist ein Termin frei.', 'Termin'],
  ['Mit dem Termin klappt es.', 'Termin'], ['Unser Termin steht.', 'Termin'], ['Diesen Termin halten wir.', 'Termin'], ['Termin am 12.10. bestätigt.', 'Termin'],
  ['Danke für Ihr Vertrauen.', 'Kundenbeziehung angedeutet'], ['Ihr Vertrauen freut uns.', 'Kundenbeziehung angedeutet'],
  ['Mit Ihrem Vertrauen arbeiten wir gern.', 'Kundenbeziehung angedeutet'],
  // Entscheidung Elias 27.09.2026: Bestätigung, dass der Betrieb für die Person gearbeitet hat (vorher erlaubt)
  ['Es freut uns, dass Sie mit unserer Arbeit zufrieden sind.', 'Kundenbeziehung angedeutet'], ['Das Vertrauen in unsere Arbeit freut uns.', 'Kundenbeziehung angedeutet'],
  ['Wir hoffen, Sie bleiben zufrieden.', 'Kundenbeziehung angedeutet'], ['Wir geben Ihr Lob an das Team weiter.', 'Kundenbeziehung angedeutet'],
  ['Schön, dass Sie mit dem Ergebnis zufrieden sind.', 'Kundenbeziehung angedeutet'], ['Es tut uns leid, dass Sie mit dem Ergebnis nicht zufrieden sind.', 'Kundenbeziehung angedeutet'],
  ['Danke für das Lob für unsere Arbeit.', 'Kundenbeziehung angedeutet'], ['Danke für das Lob zur handwerklichen Ausführung.', 'Kundenbeziehung angedeutet'],
  ['Vielen Dank für Ihr Feedback zur Qualität unserer Arbeit.', 'Kundenbeziehung angedeutet'], ['dass die Arbeit zu Ihrer Zufriedenheit war', 'Kundenbeziehung angedeutet'],
  ['Wir kommen gern wieder zu Ihnen vor Ort.', 'Kundenbeziehung angedeutet'], ['Unser Team bei Ihnen hat gern gearbeitet.', 'Kundenbeziehung angedeutet'],
  ['Schön, dass Sie sich bei uns gut aufgehoben gefühlt haben.', 'Kundenbeziehung angedeutet'], ['Dass Sie zufrieden sind, freut uns.', 'Kundenbeziehung angedeutet'],
  ['Thank you for your review!', 'Antwort nicht deutsch'], ['We are glad you like our work.', 'Antwort nicht deutsch'],
  ['Thanks, we appreciate it.', 'Antwort nicht deutsch'], ['Your feedback is very welcome.', 'Antwort nicht deutsch'],
  ['We are sorry and thank you.', 'Antwort nicht deutsch'], ['Thank you and see you.', 'Antwort nicht deutsch'],
  ['Our team is glad.', 'Antwort nicht deutsch'], ['You are very kind, thanks.', 'Antwort nicht deutsch'],
  ['Thank you for the stars.', 'Antwort nicht deutsch'], ['We appreciate your words.', 'Antwort nicht deutsch'],
];

const NEGATIV = [
  'Guten Tag,', 'Vielen Dank für Ihre freundliche Bewertung!',
  'Termine halten ist uns wichtig.', 'Er war stets Herr der Lage.', 'Unsere Kunden liegen uns am Herzen.',
  'Wir bedauern, dass es bei der Terminplanung nicht geklappt hat.', 'Die Terminverschiebung tut uns leid.', 'Sachliche Kritik nehmen wir ernst.',
  B.kontaktweg, B.signatur, 'Mehr unter www.zimmerei-beispiel.example.', 'Wir arbeiten daran, unsere Abläufe zu verbessern.',
  'Vier Sterne freuen uns sehr.', 'Wir freuen uns über 5 Sterne.', 'Das Team gibt jeden Tag sein Bestes.', 'Wir nehmen Ihre Anmerkung ernst.',
  'Ihre Rückmeldung hilft uns.', 'Ihr Hinweis hilft uns, besser zu werden.', 'Ihre Kritik ist berechtigt.', 'Wir wünschen Ihnen alles Gute.',
  'Es tut uns leid, dass Sie unzufrieden sind.', 'Wir bemühen uns stets um Termintreue.', 'Verlässlichkeit bei Terminen ist uns wichtig.',
  'Gern sprechen wir persönlich mit Ihnen.', 'Wir laden Sie herzlich zu einem Gespräch ein.', 'Qualität steht bei uns an erster Stelle.',
  'Sauberkeit ist für uns selbstverständlich.', 'Wir haben Ihre Bewertung gelesen.', 'Danke für die Empfehlung!', 'Es freut uns, dass das Dach dicht ist.',
  'Die handwerkliche Qualität liegt uns am Herzen.', 'Wir entschuldigen uns für die Unannehmlichkeiten.', 'Das entspricht nicht unserem Anspruch.',
  'Das hätte nicht passieren dürfen, das ist bei uns nicht üblich.', 'Wir bedauern, dass Sie mit uns unzufrieden sind.',
  'Wir bedauern, dass Sie von negativen Erfahrungen anderer gehört haben.', 'Wir bleiben gerne für Sie da.', 'Terminverschiebungen sind ärgerlich.',
  'Es tut uns leid, dass es mit den Terminen nicht geklappt hat.', 'Ihr Lob freut das ganze Team.', 'Ihre Worte motivieren uns.',
  'Wir freuen uns, von Ihnen zu hören.', 'Ihre Zufriedenheit ist unser Ziel.', 'Der Fachbetrieb dankt für die Worte.', 'Die Kommunikation verbessern wir.',
  'Wir prüfen unsere Abläufe intern.', 'Pünktlichkeit ist uns wichtig.', 'Rückfragen beantworten wir gern.',
  'Wir melden uns gern zurück.', 'Wir nehmen das zum Anlass, besser zu werden.', 'Ein sauberes Ergebnis ist unser Anspruch.',
  'Danke, dass Sie sich die Zeit genommen haben.', 'Wir freuen uns über jede Rückmeldung.', 'Das hören wir gern.',
  'Sprechen Sie uns jederzeit an.', 'Freundliche Grüße aus der Werkstatt.', 'Wir sind für Fragen erreichbar.',
  // Entscheidung Elias 27.09.2026: Dank für die Rückmeldung selbst, ohne Bestätigung einer Leistung
  'Über Ihre Rückmeldung freuen wir uns.', 'Danke, dass Sie Ihre Eindrücke teilen.', 'Ihre Bewertung lesen wir aufmerksam.',
  'Vielen Dank für Ihre offenen Worte.', 'Jede Rückmeldung hilft uns weiter.', 'Wir freuen uns über Ihre Bewertung.',
  'Danke für Ihre freundlichen Zeilen.', 'Ihre Rückmeldung nehmen wir gern auf.', 'Schön, von Ihnen zu lesen.',
  'Wir bedanken uns für Ihre Zeit.', 'Es tut uns leid, dass Sie unzufrieden sind.', 'Ihre Zufriedenheit ist unser Ziel.',
];

// Bekannter Fehlgriff der Plan-Liste S08, gewollt weich (gefunden 27.09.2026 beim Aufbau dieser Tabelle): „Wir melden uns gern
// bei Ihnen zurück“ trifft „bei Ihnen“. Die Liste bleibt, wie sie im BAUPLAN steht; die Prüfung ersetzt das Lesen nicht.
test('bekannter Fehlgriff: „bei Ihnen“ trifft auch „wir melden uns bei Ihnen“ (weich, Plan-Liste S08)', () => {
  assert.ok(lp.pruefeText('Wir melden uns gern bei Ihnen zurück.', ctx()).weich.includes('Vorgang bei Ihnen'));
});

test('Umfang: je mindestens 60 Positivbeispiele hart und weich, 60 Negativbeispiele; jede Einzelklasse vertreten', () => {
  assert.ok(HART.length >= 60, 'hart ' + HART.length);
  assert.ok(WEICH.length >= 60, 'weich ' + WEICH.length);
  assert.ok(NEGATIV.length >= 60, 'negativ ' + NEGATIV.length);
  const k = new Set(HART.map((x) => x[1]).concat(WEICH.map((x) => x[1])));
  for (const c of ['Telefon', 'Mail', 'URL', 'IBAN', 'Name', 'Platzhalter', 'Kundenbeziehung', 'Länge', 'leer', 'verbotener Begriff', 'Betrag',
    'Datum/Zeit', 'Ort', 'Vorgang', 'Termin', 'Kundenbeziehung angedeutet', 'Antwort nicht deutsch']) assert.ok(k.has(c), c);
});

test('Positiv hart: jedes Beispiel trifft seine Klasse als harten Treffer', () => {
  const falsch = HART.filter(([t, c]) => !lp.pruefeText(t, ctx()).hart.map(klasse).includes(c));
  assert.deepEqual(falsch, []);
});

test('Positiv weich: jedes Beispiel trifft seine Klasse als weichen Treffer', () => {
  const falsch = WEICH.filter(([t, c]) => !lp.pruefeText(t, ctx()).weich.map(klasse).includes(c));
  assert.deepEqual(falsch, []);
});

test('Negativ: kein Beispiel trifft, weder hart noch weich (auch nicht die bekannten Fehlgriffe)', () => {
  const falsch = NEGATIV.map((t) => [t, lp.pruefeText(t, ctx())]).filter(([, r]) => r.hart.length || r.weich.length).map(([t, r]) => t + ' → ' + r.hart.concat(r.weich).join('; '));
  assert.deepEqual(falsch, []);
});
