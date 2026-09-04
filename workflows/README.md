# Workflows

Exportiert mit [`../tools/n8n-export.py`](../tools/n8n-export.py) direkt über die
n8n Public API und bereinigt mit [`../tools/sanitize.py`](../tools/sanitize.py).
Ersetzt sind Credential-IDs, Webhook-IDs, Notion-Datenbank-IDs und die Server-IP.
Die Credential-*Struktur* bleibt stehen, damit erkennbar ist, welcher
Authentifizierungstyp an welchem Node hängt; n8n-eigene Node-IDs bleiben erhalten.

Der Export läuft gegen die laufende Instanz, nicht gegen eine lokale Kopie. Das
ist Absicht: Beim ersten Abgleich stellte sich heraus, dass die lokal
gespeicherte Fassung des Kontaktformulars die Fehlerbehandlung am Postgres-Node
noch gar nicht enthielt, die produktiv längst gesetzt war.

| Datei | Aktiv | Auth | Nodes | Kern |
|---|---|---|---|---|
| `kontaktformular-roehrner-eu.json` | ja | über Caddy | 9 | Serverseitige Validierung, drei parallele Zweige, getrennte Response-Nodes für 200 und 400. Der Postgres-Node läuft mit `onError: continueErrorOutput` und `retryOnFail` — ein Datenbankfehler hält die Benachrichtigung nicht auf. |
| `tagesliste.json` | nein, abgeloest 30.08.2026 | Header | 10 | Aufgaben aus Notion holen, von Claude priorisieren lassen, Auswahl gegen die realen IDs prüfen, Status zurückschreiben. Siehe unten. |

## Tagesliste: ein Modell im Arbeitsablauf, nicht als Show

Der Workflow holt die offenen Aufgaben aus Notion, lässt Claude eine Tagesauswahl
treffen und schreibt Rang und Status zurück. Interessant sind nicht die
Modellaufrufe, sondern die drei Stellen, an denen der Antwort nicht geglaubt wird.

**Nur Textblöcke auswerten.** Die Antwort der Anthropic-API ist eine Liste von
Blöcken, und nicht jeder trägt Text — Thinking-Blöcke haben kein `.text`. Wer
blind über `content` mappt, klebt `undefined` in die Zeichenkette und wundert
sich über kaputtes JSON.

```js
const raw = ($input.first().json.content || [])
  .filter(c => c.type === 'text')
  .map(c => c.text || '')
  .join('\n');
```

**JSON aus Fließtext herausschneiden.** Modelle liefern die Struktur mal nackt,
mal in einem Codeblock, mal mit einem Satz davor. Der Parser nimmt zuerst den
Codeblock, sonst alles zwischen der ersten `{` und der letzten `}`.

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

**Kein brauchbares Ergebnis → Regel statt Abbruch.** Ist die Antwort unlesbar
oder fehlt die erwartete Liste, greift eine deterministische Auswahl nach
Priorität. Der Workflow bricht nicht ab und schreibt vor allem keinen Müll nach
Notion.

**Erfundene IDs werden verworfen.**

```js
const gueltig = new Set(prep.tasks.map(t => t.id));
out.auswahl = out.auswahl
  .map(a => ({ ...a, id: String(a.id).replace(/-/g, '').toLowerCase() }))
  .filter(a => gueltig.has(a.id))
  .slice(0, 5);
```

Die Auswahl wird gegen die Menge tatsächlich existierender Aufgaben gefiltert.
Eine halluzinierte Seiten-ID erreicht die Notion-API nie. Dass Notion-IDs mal mit
und mal ohne Bindestriche auftreten, ist an jeder Vergleichsstelle normalisiert —
sonst schlägt der Abgleich still fehl und die Liste bleibt leer, ohne dass
irgendwo ein Fehler auftaucht.

**Stand:** am 30.08.2026 abgeschaltet und geloescht. Der Export bleibt als
Arbeitsprobe stehen — der Fallback-Mechanismus und der ID-Filter sind unabhaengig
davon, ob der Workflow scharf ist. Abgeloest hat ihn eine geplante Aufgabe ohne
eigenen Server-Anteil, die dieselbe Auswahl rein lesend trifft.

Der Webhook nahm zunaechst Anfragen ohne Authentifizierung an und prueft seit dem
19.08.2026 einen Header. Beim Loeschen war der Nachweis ein `POST` auf den
Webhook-Pfad, der vorher `403` und danach `404` lieferte.

Dieselbe Whitelist gilt seit dem 21.08.2026 auch für die abgehakten Aufgaben aus
dem Request-Body. Vorher wurde nur die Auswahl des Modells gegen echte IDs
gefiltert — die IDs aus dem Body wanderten ungeprüft als `page_id` in einen
schreibenden Aufruf. Zwei Wege in dieselbe Funktion, nur einer war abgesichert:
ein Muster, das man leicht übersieht, wenn man die Prüfung am Modell festmacht
statt an der Schnittstelle.

## Tabelle für das Kontaktformular

Der Postgres-Node verweist in seiner Notiz auf das Schema. Es ergibt sich aus dem
Spalten-Mapping des Nodes:

```sql
CREATE TABLE kontaktanfragen (
  id             bigserial PRIMARY KEY,
  eingegangen_am timestamptz NOT NULL DEFAULT now(),
  name           text,
  betrieb        text,
  telefon        text,
  email          text,
  nachricht      text,
  quelle         text,
  anliegen       text[]
);
```

`anliegen` ist bewusst ein echtes Array. Der Postgres-Node erwartet an dieser
Stelle ein JavaScript-Array — ein `{a,b}`-Literal, wie man es aus `psql` kennt,
funktioniert dort nicht.

Die Rolle, mit der n8n schreibt, hat ausschließlich `SELECT` und `INSERT` auf
dieser Tabelle, kein `DELETE`. Das Löschen nach Ablauf der Frist erledigt ein
eigener Job mit anderen Rechten.

## Import

In n8n: *Workflows → Import from File*. Danach die Credentials neu zuordnen — die
IDs sind absichtlich entfernt.

## Export aktualisieren

```bash
python3 tools/n8n-export.py https://n8n.example.eu
```

Fragt Zugangsdaten verdeckt ab oder nimmt sie aus `N8N_API_KEY`, `N8N_UI_USER`
und `N8N_UI_PASS`.
