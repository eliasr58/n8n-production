# n8n-Automation in Produktion — Arbeitsproben

Ich betreibe seit Frühjahr 2026 einen eigenen Hetzner-Server mit n8n, Postgres und
Caddy und automatisiere darauf die Abläufe meines Einzelunternehmens
([Röhrner Automation](https://roehrner.eu), Automatisierung für Handwerksbetriebe
und KMU). Dieses Repository enthält die tatsächlich laufenden Artefakte —
Workflow-Exporte, Serverkonfiguration, Betriebsskripte — bereinigt um Zugangsdaten.

Kein Tutorial-Nachbau. Alles hier läuft, hat mindestens einen echten Fehlerfall
hinter sich und ist entsprechend nachgebessert worden.

**Elias Röhrner** · Aldersbach, Niederbayern · kontakt@roehrner.eu

---

## Überblick

| Bereich | Was läuft | Datei |
|---|---|---|
| Kontaktformular | Webhook → serverseitige Validierung → Postgres → Benachrichtigung + Auto-Antwort, mit getrennten Antwortpfaden 200/400 | [`workflows/kontaktformular-roehrner-eu.json`](workflows/kontaktformular-roehrner-eu.json) |
| Aufgaben-Kuration mit Claude | Notion-Aufgaben von einem Modell priorisieren lassen — mit regelbasiertem Fallback und Filter gegen halluzinierte IDs | [`workflows/tagesliste.json`](workflows/tagesliste.json) |
| Privater Sync → Notion | Webhook liefert nur eine ID, der Datensatz kommt per Folge-Call mit `retryOnFail`, Dedup vor dem Anlegen | [`workflows/sync-privat-1.json`](workflows/sync-privat-1.json) |
| Privater Sync → Notion | Täglicher Upsert (suchen → anlegen *oder* aktualisieren), damit ein zweiter Lauf keine Dubletten erzeugt | [`workflows/sync-privat-2.json`](workflows/sync-privat-2.json) |
| Reverse Proxy | Caddy mit selbst gebautem Rate-Limit-Plugin, Body-Grenze, Security-Header, Same-Origin-Proxy fürs Formular | [`infra/Caddyfile`](infra/Caddyfile) |
| Container-Stack | n8n + Postgres + Caddy per Compose, Healthcheck-Abhängigkeit, n8n nur an localhost gebunden | [`infra/docker-compose.yml`](infra/docker-compose.yml) |
| Backup | pg_dumpall beider Datenbanken + n8n-Volume + Konfiguration, AES-256, systemd-Timer, Restore einmal vollständig geprobt | [`ops/`](ops/) |
| Löschfristen | Server-Logs 7 Tage, n8n-Ausführungen 7 Tage, Kontaktanfragen 6 Monate, Backups 14 Tage — technisch erzwungen, nicht nur dokumentiert | [`ops/`](ops/) |

Ausführlich: **[Case-Study Kontaktformular](docs/case-study-kontaktformular.md)** —
die eine Pipeline von der Formulareingabe bis zur Löschfrist, inklusive der Stellen,
an denen ich zuerst danebenlag.

---

## Drei Entscheidungen, die den Unterschied machen

**Die Drossel sitzt vor n8n, nicht darin.**
Mein erster Ansatz war ein Zähler im Code-Node. Er funktioniert nicht zuverlässig:
n8n schreibt `staticData` erst am Ende einer Ausführung zurück, parallele Anfragen
lesen also denselben Zählerstand. Die Begrenzung gehört deshalb in Caddy, wo sie
greift, bevor überhaupt eine Ausführung startet — drei Anfragen je IP in zehn
Minuten, zusätzlich 60 pro Stunde für die Instanz. Der Code-Node blieb als zweite
Linie erhalten, mit einem Kommentar, warum er allein nicht reicht.
Nachzulesen in [`infra/Caddyfile`](infra/Caddyfile) und
[`ops/smoke-test.sh`](ops/smoke-test.sh).

**Gemessen statt angenommen.**
Am 17.08.2026 habe ich die Härtung gegen den Live-Server geprüft statt gegen meine
Konfigurationsdatei. Ergebnis: Der Webhook war über die n8n-Subdomain vollständig
an allen Grenzen vorbei erreichbar — 200 KB Nutzlast wurden anstandslos verarbeitet,
die Oberfläche war öffentlich. Die Messwerte stehen als Kommentar im
[`Caddyfile`](infra/Caddyfile), damit nachvollziehbar bleibt, wogegen die
Konfiguration schützt. Seitdem schließe ich jede Korrektur mit einem Nachweis ab,
der ohne die Änderung fehlgeschlagen wäre.

**Ein Fehler in der Datenbank darf die Benachrichtigung nicht aufhalten.**
Im Kontakt-Workflow laufen Persistenz und Benachrichtigung parallel, nicht in
Reihe. Wenn Postgres klemmt, bekomme ich die Anfrage trotzdem per Mail — bei einem
Betrieb, der von eingehenden Anfragen lebt, ist eine verlorene Anfrage teurer als
eine fehlende Datenbankzeile. Der Webhook antwortet dem Browser über einen eigenen
Response-Node, damit der Statuscode nicht davon abhängt, welcher Zweig zuletzt
fertig wird.

---

## Wie ich mit KI arbeite

Claude ist bei mir kein Beiwerk, sondern die Art, wie ich baue. Konkret:

- **Claude Code** als Hauptwerkzeug für Server- und Frontend-Arbeit. Die Konfigurationen
  in diesem Repo sind so entstanden — inklusive der Kommentare, die begründen,
  *warum* etwas so dasteht.
- **MCP** für Werkzeugzugriff aus dem Modell heraus (Notion, Dateisystem, Browser).
- **Anthropic-API in n8n**, etwa in `tagesliste.json`: Das Modell priorisiert
  Aufgaben, aber seine Antwort wird nicht geglaubt. Unbrauchbares JSON fällt auf
  eine deterministische Regel zurück, und die zurückgegebenen IDs werden gegen die
  Menge tatsächlich existierender Aufgaben gefiltert — eine erfundene Seiten-ID
  erreicht die Notion-API nie.
- **Regeln aus Fehlern:** Ich pflege eine wachsende Liste von Arbeitsregeln, die aus
  konkreten Fehlschlägen stammen — etwa dass `curl` ohne `-L` keinem Redirect folgt
  und ein `grep` darauf fälschlich Erfolg meldet. Solche Regeln gebe ich dem Modell
  als Kontext mit, statt denselben Fehler ein zweites Mal zu machen.

Was ich dabei gelernt habe und für wichtiger halte als jedes Prompt-Detail: Ein
Modell beschleunigt das Bauen, aber es ersetzt die Abnahme nicht. Jede Änderung
in diesem Repo hat einen Nachweis, der vorher fehlgeschlagen ist.

---

## Was hier nicht steht

Damit das Bild stimmt:

- Das sind **vier Workflows**, kein Betrieb mit dutzenden. Was ich zeigen kann,
  ist der Betrieb selbst: Härtung, Backup mit geprobtem Restore, Löschfristen,
  Abnahmetests. Nicht die Menge.
- **Tagesliste und privater Sync sind stillgelegt.** Beide Webhooks nahmen
  Anfragen ohne Authentifizierung entgegen; bei der Tagesliste ließ sich über den
  Request-Body zusätzlich beeinflussen, welche Notion-Seiten geschrieben werden.
  Aufgefallen ist das erst, als ich dieses Repository selbst durchgesehen habe —
  die Pfade waren vorher nur durch Unkenntnis geschützt, und veröffentlicht habe
  ich sie hier eigenhändig. Beide bleiben aus, bis Header-Auth und eine Prüfung
  der übergebenen IDs stehen. Das Kontaktformular ist davon nicht betroffen.
- **Python** setze ich bisher für Skripte und Datenaufbereitung ein, nicht für
  produktive Services. FastAPI habe ich gelesen, aber nicht ausgeliefert.
- Der Fehlerausgang des Postgres-Nodes läuft derzeit **ins Leere**: Ein
  fehlgeschlagener Insert bleibt unbemerkt. Die Alarmmail steht als nächster Punkt
  auf meiner Liste. Ich schreibe das hin, weil ein Portfolio ohne offene Punkte
  entweder gelogen oder unbenutzt ist.
- Das **Off-Site-Backup** fehlt noch — die Sicherung liegt bisher auf demselben
  Server. Geplant ist eine Hetzner Storage Box mit gleicher Aufbewahrungsfrist.

---

## Aufbau des Repositorys

```
workflows/   n8n-Exporte, bereinigt (Credential-IDs, IDs, Server-IP ersetzt)
infra/       Caddyfile, docker-compose.yml, Dockerfile für Caddy mit Rate-Limit
ops/         Abnahme- und Betriebsskripte
docs/        Case-Study und Architektur
tools/       n8n-status.py  — welche Workflows laufen, wann zuletzt, mit welchem Ergebnis
             n8n-fehler.py  — fehlgeschlagene Ausführungen mit Node und Meldung
             n8n-export.py  — Ist-Stand über die Public API ziehen
             sanitize.py    — macht die Exporte veröffentlichungsfähig
```

Die Bereinigung ist selbst versioniert: [`tools/sanitize.py`](tools/sanitize.py)
ersetzt Credential-IDs, Server-IP, Notion-Datenbank-IDs, Webhook-IDs und lokale
Pfade und wirft n8n-interne Laufzeitfelder weg. Nachvollziehbar statt von Hand
zusammengestrichen.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
