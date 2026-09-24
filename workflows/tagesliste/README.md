# Tagesliste: ein Modell im Arbeitsablauf, nicht als Show

**Status:** nicht aktiv seit 30.08.2026 (abgeschaltet und in n8n gelöscht) · 10 Nodes · **mit n8n 2.34.4 nicht getestet** —
der Export stammt vom 21.08.2026, und ein Lauf auf 2.34.4 ist nicht belegt

Die Datei stammt aus der Zeit, in der der Workflow lief — daher steht in ihr noch `"active": true`.

## Problem

Aus einem Aufgaben-Backlog in Notion soll jeden Morgen eine kurze, begründete Tagesauswahl entstehen, ohne dass jemand die
Liste von Hand sortiert. Ein Sprachmodell kann das gut — aber seine Antwort darf nie ungeprüft in eine schreibende Schnittstelle
laufen.

## Ablauf

Der Workflow holt die offenen Aufgaben aus Notion, lässt Claude eine Tagesauswahl treffen und schreibt Rang und Status zurück.
Interessant sind nicht die Modellaufrufe, sondern die Stellen, an denen der Antwort nicht geglaubt wird.

**Nur Textblöcke auswerten.** Die Antwort der Anthropic-API ist eine Liste von Blöcken, und nicht jeder trägt Text —
Thinking-Blöcke haben kein `.text`. Wer blind über `content` mappt, klebt `undefined` in die Zeichenkette und wundert sich über
kaputtes JSON.

```js
const raw = ($input.first().json.content || [])
  .filter(c => c.type === 'text')
  .map(c => c.text || '')
  .join('\n');
```

**JSON aus Fließtext herausschneiden.** Modelle liefern die Struktur mal nackt, mal in einem Codeblock, mal mit einem Satz
davor. Der Parser nimmt zuerst den Codeblock, sonst alles zwischen der ersten `{` und der letzten `}`.

```js
function extractJson(s) {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : s;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch (e) { return null; }
}
```

**Kein brauchbares Ergebnis → Regel statt Abbruch.** Ist die Antwort unlesbar oder fehlt die erwartete Liste, greift eine
deterministische Auswahl nach Priorität. Der Workflow bricht nicht ab und schreibt vor allem keinen Müll nach Notion.

**Erfundene IDs werden verworfen.**

```js
const gueltig = new Set(prep.tasks.map(t => t.id));
out.auswahl = out.auswahl
  .map(a => ({ ...a, id: String(a.id).replace(/-/g, '').toLowerCase() }))
  .filter(a => gueltig.has(a.id))
  .slice(0, 5);
```

Die Auswahl wird gegen die Menge tatsächlich existierender Aufgaben gefiltert. Eine halluzinierte Seiten-ID erreicht die
Notion-API nie. Dass Notion-IDs mal mit und mal ohne Bindestriche auftreten, ist an jeder Vergleichsstelle normalisiert — sonst
schlägt der Abgleich still fehl und die Liste bleibt leer, ohne dass irgendwo ein Fehler auftaucht.

**Dieselbe Prüfung an der Schnittstelle, nicht nur am Modell.** Seit dem 21.08.2026 gilt die Whitelist auch für die abgehakten
Aufgaben aus dem Request-Body. Vorher wurde nur die Auswahl des Modells gegen echte IDs gefiltert — die IDs aus dem Body wanderten
ungeprüft als `page_id` in einen schreibenden Aufruf. Zwei Wege in dieselbe Funktion, nur einer war abgesichert.

## Benötigte Konnektoren

| Konnektor | Wofür |
|---|---|
| Webhook mit Header-Authentifizierung | Auslöser |
| HTTP Request → Notion-API | Backlog lesen, Rang und Status zurückschreiben |
| HTTP Request → Anthropic-API | Tagesauswahl |

## Einrichtung

1. *Workflows → Import from File* → `workflow.json`.
2. Die Header-Credentials für Webhook, Notion und Anthropic neu anlegen und zuordnen (`<CREDENTIAL_ID>`).
3. Die Notion-Datenbank-ID eintragen (`<NOTION_ID>`); die Eigenschaften der Datenbank müssen zu den Feldern im Code passen.

## Grenzen

- Der Webhook nahm zunächst Anfragen ohne Authentifizierung an; über den Request-Body ließ sich ein Modellaufruf erzwingen.
  Seit dem 19.08.2026 prüft er einen Header.
- Abgelöst hat ihn eine geplante Aufgabe ohne eigenen Server-Anteil, die dieselbe Auswahl rein lesend trifft. Beim Löschen war
  der Nachweis ein `POST` auf den Webhook-Pfad, der vorher `403` und danach `404` lieferte.
- Der Export bleibt als Arbeitsprobe: Fallback und ID-Filter sind unabhängig davon, ob der Workflow gerade läuft.
