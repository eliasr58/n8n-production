# n8n-Automation in Produktion — Arbeitsproben

Ich betreibe seit Frühjahr 2026 einen eigenen Hetzner-Server mit n8n, Postgres und Caddy und automatisiere darauf die Abläufe meines Einzelunternehmens ([Röhrner Automation](https://roehrner.eu), Automatisierung für Handwerksbetriebe und KMU). Dieses Repository enthält die tatsächlich laufenden Artefakte — Workflow-Exporte, Serverkonfiguration, Betriebsskripte — bereinigt um Zugangsdaten.

Kein Tutorial-Nachbau. Alles hier hat produktiv gelaufen, mindestens einen echten Fehlerfall hinter sich und ist entsprechend nachgebessert worden. Wo etwas inzwischen abgeschaltet ist, steht es dabei.

**Elias Röhrner** · Aldersbach, Niederbayern · kontakt@roehrner.eu

## Überblick

| Bereich | Was läuft | Datei |
|---|---|---|
| Kontaktformular | Webhook → serverseitige Validierung → Postgres → Benachrichtigung + Auto-Antwort, mit getrennten Antwortpfaden 200/400 | [`workflows/kontaktformular-roehrner-eu.json`](workflows/kontaktformular-roehrner-eu.json) |
| Aufgaben-Kuration mit Claude *(abgelöst 08/2026)* | Notion-Aufgaben von einem Modell priorisieren lassen — mit regelbasiertem Fallback und Filter gegen halluzinierte IDs. Läuft nicht mehr, siehe unten | [`workflows/tagesliste.json`](workflows/tagesliste.json) |
| Reverse Proxy | Caddy mit selbst gebautem Rate-Limit-Plugin, Body-Grenze, Security-Header, Same-Origin-Proxy fürs Formular | [`infra/Caddyfile`](infra/Caddyfile) |
| Container-Stack | n8n + Postgres + Caddy per Compose, Healthcheck-Abhängigkeit, n8n nur an localhost gebunden | [`infra/docker-compose.yml`](infra/docker-compose.yml) |
| Backup | pg_dumpall beider Datenbanken + n8n-Volume + Konfiguration, AES-256, systemd-Timer, Restore einmal vollständig geprobt | beschrieben in [`ops/`](ops/), Skripte auf dem Server |
| Löschfristen | Server-Logs 7 Tage, n8n-Ausführungen 7 Tage, Kontaktanfragen 6 Monate, Backups 14 Tage — technisch erzwungen, nicht nur dokumentiert | [`infra/`](infra/) und [`ops/`](ops/) |

Ausführlich: **[Case-Study Kontaktformular](docs/case-study-kontaktformular.md)** — die eine Pipeline von der Formulareingabe bis zur Löschfrist, inklusive der Stellen, an denen ich zuerst danebenlag.

## Drei Entscheidungen, die den Unterschied machen

**Die Drossel sitzt vor n8n, nicht darin.**
Mein erster Ansatz war ein Zähler im Code-Node. Er funktioniert nicht zuverlässig: n8n schreibt `staticData` erst am Ende einer Ausführung zurück, parallele Anfragen lesen also denselben Zählerstand. Die Begrenzung gehört deshalb in Caddy, wo sie greift, bevor überhaupt eine Ausführung startet — drei Anfragen je IP in zehn Minuten, zusätzlich 60 pro Stunde für diesen Pfad. Der Zähler im Code-Node blieb als zweite Linie erhalten; auch er hatte unterwegs einen eigenen Fehler, der am 17.08.2026 nachgemessen wurde. Nachzulesen in [`infra/Caddyfile`](infra/Caddyfile) und in der [Case-Study](docs/case-study-kontaktformular.md#2--warum-die-drossel-in-caddy-sitzt-und-nicht-in-n8n).

**Gemessen statt angenommen.**
Am 17.08.2026 habe ich die Härtung gegen den Live-Server geprüft statt gegen meine Konfigurationsdatei. Ergebnis: Der Webhook war über die n8n-Subdomain vollständig an allen Grenzen vorbei erreichbar — 200 KB Nutzlast wurden anstandslos verarbeitet, die Oberfläche war öffentlich. Die Messwerte stehen als Kommentar im [`Caddyfile`](infra/Caddyfile), damit nachvollziehbar bleibt, wogegen die Konfiguration schützt. Seitdem schließe ich jede Korrektur mit einem Nachweis ab, der ohne die Änderung fehlgeschlagen wäre.

**Ein Fehler in der Datenbank darf die Benachrichtigung nicht aufhalten.**
Im Kontakt-Workflow laufen Persistenz und Benachrichtigung parallel, nicht in Reihe. Wenn Postgres klemmt, bekomme ich die Anfrage trotzdem per Mail — bei einem Betrieb, der von eingehenden Anfragen lebt, ist eine verlorene Anfrage teurer als eine fehlende Datenbankzeile. Der Webhook antwortet dem Browser über einen eigenen Response-Node, damit der Statuscode nicht davon abhängt, welcher Zweig zuletzt fertig wird.

## Wie ich mit KI arbeite

Claude ist bei mir kein Beiwerk, sondern die Art, wie ich baue. Konkret:

- **Claude Code** als Hauptwerkzeug für Server- und Frontend-Arbeit. Die Konfigurationen in diesem Repo sind so entstanden — inklusive der Kommentare, die begründen, *warum* etwas so dasteht.
- **MCP** für Werkzeugzugriff aus dem Modell heraus (Notion, Dateisystem, Browser).
- **Anthropic-API in n8n**, etwa in `tagesliste.json`: Das Modell priorisiert Aufgaben, aber seine Antwort wird nicht geglaubt. Unbrauchbares JSON fällt auf eine deterministische Regel zurück, und die zurückgegebenen IDs werden gegen die Menge tatsächlich existierender Aufgaben gefiltert — eine erfundene Seiten-ID erreicht die Notion-API nie.
- **Regeln aus Fehlern:** Ich pflege eine wachsende Liste von Arbeitsregeln, die aus konkreten Fehlschlägen stammen — etwa dass `curl` ohne `-L` keinem Redirect folgt und ein `grep` darauf fälschlich Erfolg meldet. Solche Regeln gebe ich dem Modell als Kontext mit, statt denselben Fehler ein zweites Mal zu machen.

Was ich dabei gelernt habe und für wichtiger halte als jedes Prompt-Detail: Ein Modell beschleunigt das Bauen, aber es ersetzt die Abnahme nicht. Jede Änderung in diesem Repo hat einen Nachweis, der vorher fehlgeschlagen ist.

## Was hier nicht steht

Damit das Bild stimmt:

- Das ist **ein produktiver Workflow plus ein abgelöster Export**, kein Betrieb mit dutzenden. Was ich zeigen kann, ist der Betrieb selbst: Härtung, Backup mit geprobtem Restore, Löschfristen, Abnahmetests. Nicht die Menge.
- **Zwei Webhooks nahmen Anfragen ohne Authentifizierung entgegen** — Tagesliste und ein privater Sync. Bei der Tagesliste ließ sich über den Request-Body zusätzlich ein Modellaufruf erzwingen. Aufgefallen ist das erst, als ich dieses Repository durchgesehen habe: Die Pfade waren vorher nur durch Unkenntnis geschützt, und veröffentlicht habe ich sie hier eigenhändig. Beide bekamen daraufhin Header-Authentifizierung, die über den Body übergebenen Seiten-IDs werden seit dem 21.08.2026 gegen das geladene Backlog geprüft. **Am 30.08.2026 habe ich beide Workflows abgeschaltet und gelöscht** — die Tagesliste, weil eine geplante Aufgabe ohne eigenen Server-Anteil dieselbe Arbeit lesend erledigt, den Sync, weil er privat war und keinen Zweck mehr hatte. Der Rückbau ist derselbe Weg wie jede Korrektur hier: erst messen, dann löschen, dann nachweisen. Der Beleg war ein `POST` auf den Webhook-Pfad, der vorher `403` und danach `404` lieferte.
- **`tagesliste.json` bleibt als Arbeitsprobe stehen**, obwohl der Workflow nicht mehr läuft. Der Fallback-Mechanismus und der ID-Filter sind das, was ich daran zeigen will, und beides ist unabhängig davon, ob der Workflow gerade scharf ist.
- **Python** setze ich bisher für Skripte und Datenaufbereitung ein, nicht für produktive Services. FastAPI habe ich gelesen, aber nicht ausgeliefert.
- Ich schreibe offene Punkte hin, weil ein Portfolio ohne sie entweder gelogen oder unbenutzt ist. Offen ist derzeit eine JSON-Antwort auf die Drossel: Das Formular wertet nur den Statuscode aus und kann dem Besucher bei einer Abweisung nichts Brauchbares sagen.
- Das **Off-Site-Backup** steht seit dem 21.08.2026: gespiegelt auf eine Storage Box in einem anderen Rechenzentrum, Restore von dort einmal geprobt, Fehlerfall ebenfalls. Ein fehlgeschlagener Lauf meldet sich per Mail, ein ausgebliebener über einen externen Dienst — ein stillstehender Server fällt damit ebenfalls auf.

## Aufbau des Repositorys

```
workflows/   n8n-Exporte, bereinigt (Credential-IDs, IDs, Server-IP ersetzt)
infra/       Caddyfile, docker-compose.yml, Dockerfile für Caddy mit Rate-Limit
ops/         smoke-test.sh — Nachweis der Drossel gegen gefälschte Absender-IPs
             (Backup- und Löschskripte liegen auf dem Server, nicht hier)
docs/        Case-Study und Architektur
tools/       n8n-status.py  — welche Workflows laufen, wann zuletzt, mit welchem Ergebnis
             n8n-fehler.py  — fehlgeschlagene Ausführungen mit Node und Meldung
             n8n-export.py  — Ist-Stand über die Public API ziehen
             sanitize.py    — macht die Exporte veröffentlichungsfähig
             server-artefakte-holen.sh — Betriebsskripte vom Server ins Repo
```

Die Bereinigung ist selbst versioniert: [`tools/sanitize.py`](tools/sanitize.py) ersetzt Credential-IDs, Server-IPs (IPv4 und IPv6), Notion-IDs, Webhook-IDs **und Webhook-Pfade** (der Pfad kann selbst das Geheimnis sein — maskiert wird alles hinter `/webhook/` bzw. `/webhook-test/` sowie `parameters.path` eines Webhook-Nodes), lokale Pfade, Tokens und API-Keys, Werte hinter Schlüsselnamen wie `password` oder `apiKey`, Passwörter in Connection-Strings und Monitoring-URLs und wirft n8n-interne Laufzeitfelder weg. Danach prüft ein breiter gefasster Mustersatz das Ergebnis; bleibt ein Verdacht, wird nichts geschrieben (fail-closed). Der Testkorpus mit ausschließlich erfundenen Werten liegt unter [`tools/tests/fixtures/`](tools/tests/fixtures/). Nachvollziehbar statt von Hand zusammengestrichen.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
