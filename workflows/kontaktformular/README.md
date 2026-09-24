# Kontaktformular

**Status:** aktiv, produktiv seit 18.08.2026 · Fassung vom 24.09.2026 · 11 Nodes · **getestet mit n8n 2.34.4**

## Problem

Ein Handwerksbetrieb lebt von eingehenden Anfragen. Ein Formular, das nur eine Mail auslöst, reicht dafür nicht: Die Mail
landet im Spam, ein SMTP-Ausfall verschluckt die Anfrage spurlos, und nach sechs Monaten weiß niemand mehr, wie viele Anfragen
es gab. Dieser Workflow nimmt die Anfrage an, prüft sie serverseitig, benachrichtigt, antwortet dem Absender, speichert — und
meldet sich, wenn einer dieser Schritte scheitert.

## Ablauf

```
Webhook (hinter Caddy: roehrner.eu/api/kontakt, gleiche Herkunft, Drossel davor)
  ▼
Validieren & Normalisieren   Pflichtfelder · E-Mail-Format · Honeypot · Link-Spam · Rate-Limit als zweite Linie
  ▼                          IP nur pseudonymisiert (SHA-256 mit Tages-Salt)
Gültig?
  ├── nein → Antwort 400                  (erkannter Spam: stiller 200, damit die Abwehr nicht verraten wird)
  └── ja   → drei Zweige
       ├── Benachrichtigung an mich ─────────────→ Antwort 200
       │        └─ Fehlerausgang → Alarm: Mailversand ─→ Antwort 200
       ├── Auto-Antwort erlaubt? → Auto-Antwort an Absender
       │        └─ Fehlerausgang → Alarm: Mailversand
       └── In Postgres speichern (retryOnFail)
                └─ Fehlerausgang → Alarm: Insert fehlgeschlagen   (Mail mit der vollständigen Anfrage)
```

- **Auto-Antwort gebremst:** höchstens eine je Empfänger und Stunde, dazu höchstens zwölf je Stunde insgesamt. Sonst ließe sich
  der Endpunkt benutzen, um über die eigene Domain Fremde anzuschreiben.
- **Die Alarm-Mail trägt die Anfrage selbst.** Fällt die Datenbank aus, liegt der Kunde trotzdem im Postfach.
- **Der Mailversand-Alarm läuft nicht über SMTP**, sondern als Fail-Ping an einen externen Überwachungsdienst — ein kaputter
  Mailweg kann seinen eigenen Alarm also nicht verschlucken.

## Fehlerausgänge unter n8n 2.34.4 — gemessen, nicht angenommen

`onError: continueErrorOutput` wird in n8n 2.34.4 **je Node-Typ unterschiedlich** bedient. Am 24.09.2026 an einer Kopie dieses
Workflows gemessen, Fehler jeweils echt erzwungen:

| Node | erzwungener Fehler | Ergebnis |
|---|---|---|
| Postgres 2.5 | Insert auf eine nicht vorhandene Tabelle | Item auf dem Fehlerausgang, Alarm-Mail kam an |
| E-Mail senden 2.1 | SMTP-Host, der nicht auflöst | Item auf dem Fehlerausgang, Alarm lief — der Browser bekam trotzdem `200` |
| HTTP Request 4.5 (anderer Workflow, 11.09.2026) | Host, der nicht auflöst | Item auf dem **Erfolgs**ausgang, der Alarm am Fehlerausgang lief **nicht** |

Dieselbe Fehlerart — ein Host, der nicht auflöst — führt also je nach Node-Typ auf verschiedene Ausgänge. In allen Fällen meldet
die Ausführung `success`, und der Error-Workflow der Instanz feuert nicht. Wer einen Alarm an einen Fehlerausgang hängt, misst
deshalb vorher an genau diesem Node-Typ, ob er dort ankommt.

## Benötigte Konnektoren

| Konnektor | Wofür |
|---|---|
| Webhook | Eingang, `responseMode: responseNode` |
| SMTP | Benachrichtigung, Auto-Antwort, Alarm-Mail |
| Postgres | Tabelle `kontaktanfragen` in einer eigenen Datenbank |
| HTTP Request | Fail-Ping an einen Überwachungsdienst (z. B. Healthchecks) |

## Einrichtung

1. In n8n: *Workflows → Import from File* → `workflow.json`.
2. Credentials für SMTP und Postgres neu zuordnen — die IDs sind im Export absichtlich entfernt (`<CREDENTIAL_ID>`).
3. Im Webhook-Node einen eigenen Pfad setzen (im Export `REDACTED`) und `allowedOrigins` auf die eigene Domain stellen.
4. In `Alarm: Mailversand` die eigene Fail-URL eintragen (`<HC_PING_URL>`).
5. Absender, Empfänger und den Text der Auto-Antwort anpassen; Signaturangaben sind im Export durch Platzhalter ersetzt.
6. Tabelle anlegen:

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

`anliegen` ist bewusst ein echtes Array; der Postgres-Node erwartet dort ein JavaScript-Array, kein `{a,b}`-Literal. Die Rolle,
mit der n8n schreibt, bekommt nur `SELECT` und `INSERT` — gelöscht wird nach Ablauf der Frist von einem eigenen Job mit anderen
Rechten.

Die Drossel gehört **vor** n8n (Reverse Proxy), nicht in den Workflow: n8n schreibt `staticData` erst am Ende einer Ausführung
zurück, parallele Anfragen lesen denselben Zählerstand. Der Zähler im Code-Node ist nur die zweite Linie. Die Caddy-Konfiguration
dazu liegt in [`betrieb/infra/Caddyfile`](../../betrieb/infra/Caddyfile).

## Grenzen

- Der Mailversand-Alarm nennt als Knoten immer „Mailversand“: Bei diesem Node-Typ ist der Fehler ein Text ohne Knotenangabe.
  Welcher der beiden Mail-Nodes ausfiel, steht nicht im Alarm.
- Beide Mail-Zweige münden in denselben Alarm; fallen beide aus, kommt er zweimal.
- Rate-Limit und Auto-Antwort-Bremse im Code-Node liegen in `staticData` und sind bei gleichzeitigen Anfragen nicht exakt.

Ausführlich, mit den Stellen, an denen ich zuerst danebenlag: [Case-Study](../../docs/case-study-kontaktformular.md).
