# n8n-Workflows aus dem Betrieb

**Röhrner Automation** — Automatisierung für Handwerksbetriebe und KMU. Dieses Repository zeigt Workflows, die auf meiner eigenen
n8n-Instanz gelaufen sind oder laufen, mit echten Use Cases: Anfragen annehmen, Rechnungen erfassen, ein Postfach sortieren,
Aufgaben priorisieren. Jeder Export kommt direkt aus der laufenden Instanz und ist um Zugangsdaten bereinigt. Kein
Tutorial-Nachbau: Wo ein Workflow abgeschaltet ist, steht es dabei, und wo etwas nicht gemessen ist, auch.

Der Serverbetrieb dahinter — Härtung, Backup, Löschfristen, Alarmweg — liegt in einem eigenen Repository:
**[n8n-betrieb](https://github.com/eliasr58/n8n-betrieb)**.

**Elias Röhrner** · Aldersbach, Niederbayern · [roehrner.eu](https://roehrner.eu) · kontakt@roehrner.eu

## Workflows

| Workflow | Use Case | Konnektoren | Status |
|---|---|---|---|
| [Kontaktformular](workflows/kontaktformular/) | Anfragen von der Website annehmen, serverseitig prüfen, benachrichtigen, dem Absender antworten, speichern — und alarmieren, wenn einer dieser Schritte scheitert | Webhook, SMTP, Postgres, HTTP (Überwachung) | **aktiv** seit 18.08.2026, getestet mit n8n 2.34.4 |
| [Eingangsrechnungen](workflows/eingangsrechnungen/) | PDF-Rechnungen aus dem Postfach auslesen, benennen, in Drive ablegen, in Notion erfassen — und alles liegen lassen, was nicht sicher erkannt ist | Gmail, Google Drive, Anthropic, Notion | nicht aktiv; lief auf n8n 2.34.4 |
| [Posteingang](workflows/posteingang/) | Geschäftspostfach nach festen Regeln und, wo keine greift, per Modell einordnen; labeln, nur bei Sicherheit archivieren, nie löschen | Gmail, Anthropic, Notion | nicht aktiv; lief auf n8n 2.34.4 |
| [Tagesliste](workflows/tagesliste/) | Aus einem Notion-Backlog eine Tagesauswahl treffen lassen, mit Fallback und Filter gegen erfundene IDs | Webhook, Notion, Anthropic | nicht aktiv seit 30.08.2026 |

Jeder Ordner enthält `workflow.json` zum Import und ein README mit Problem, Ablauf, Konnektoren, Einrichtung, Grenzen und Status.

Ausführlich: **[Case-Study Kontaktformular](docs/case-study-kontaktformular.md)** — die eine Pipeline von der Formulareingabe bis
zur Löschfrist, inklusive der Stellen, an denen ich zuerst danebenlag, und der Messung, dass n8n 2.34.4 Fehlerausgänge je Node-Typ
unterschiedlich behandelt.

### In Arbeit

| Workflow | Use Case | Status |
|---|---|---|
| Mahnlauf | Offene Rechnungen stufenweise nachfassen | in Arbeit |
| Wartungserinnerung | Kunden rechtzeitig an fällige Wartungen erinnern | in Arbeit |
| Bewertungsantworten | Antwortentwürfe auf Online-Bewertungen, Versand erst nach Freigabe | in Arbeit |
| Baustellenmappe | Fotos, Notizen und Unterlagen je Baustelle an einem Ort bündeln | in Arbeit |

## Wie ich arbeite

Claude ist bei mir kein Beiwerk, sondern die Art, wie ich baue: **Claude Code** für Server- und Frontend-Arbeit, **MCP** für
Werkzeugzugriff aus dem Modell heraus, die **Anthropic-API** direkt in n8n.

- **Dem Modell wird nicht geglaubt, sondern geprüft.** Unbrauchbares JSON fällt auf eine feste Regel zurück, zurückgegebene IDs
  werden gegen die tatsächlich vorhandenen gefiltert, und wo das Modell unsicher ist, passiert nichts
  ([Tagesliste](workflows/tagesliste/), [Eingangsrechnungen](workflows/eingangsrechnungen/), [Posteingang](workflows/posteingang/)).
- **Gemessen statt angenommen.** Jede Korrektur endet mit einem Nachweis, der ohne die Änderung fehlgeschlagen wäre. Ein Alarm,
  der nie ausgelöst wurde, gilt als Vermutung — deshalb werden Fehlerfälle echt erzwungen, inzwischen an einer Kopie des Workflows.
- **Regeln aus Fehlern.** Aus jedem Fehlschlag wird eine Arbeitsregel, die das Modell als Kontext mitbekommt, statt denselben
  Fehler ein zweites Mal zu machen.

Ein Modell beschleunigt das Bauen, aber es ersetzt die Abnahme nicht.

## Was hier nicht steht

Damit das Bild stimmt:

- **Vier Workflows, einer davon produktiv.** Drei sind abgeschaltet und stehen als Arbeitsproben hier, weil ihre Bauweise
  unabhängig davon trägt, ob sie gerade laufen. Das ist kein Betrieb mit Dutzenden Workflows.
- **Die Workflows der Digitalen Auftragsannahme** (Telefon, Transkription, SMS-Dialog) stehen nicht hier. Sie verarbeiten echte
  Anrufe und Personendaten.
- **Ein Webhook war anfangs offen.** Die Tagesliste nahm Anfragen ohne Authentifizierung an, und über den Request-Body ließ sich
  ein Modellaufruf erzwingen. Aufgefallen ist das erst beim Veröffentlichen hier. Der Webhook bekam daraufhin eine Header-Prüfung,
  am 30.08.2026 wurde der Workflow abgeschaltet.
- **Python** setze ich für Skripte und Datenaufbereitung ein, nicht für produktive Services.
- **Offene Punkte** stehen je Workflow unter „Grenzen“ und in der [Case-Study](docs/case-study-kontaktformular.md#10--was-offen-ist).
  Ein Portfolio ohne offene Punkte ist entweder gelogen oder unbenutzt.

## Aufbau des Repositorys

```
workflows/<name>/   workflow.json (Export, bereinigt) und README.md
docs/               Case-Study Kontaktformular
tools/              n8n-export.py / n8n-export.sh — Ist-Stand über die Public API ziehen
                    sanitize.py — macht Exporte veröffentlichungsfähig
                    tests/fixtures/ — Testkorpus mit ausschließlich erfundenen Werten
```

Die Bereinigung ist selbst versioniert: [`tools/sanitize.py`](tools/sanitize.py) ersetzt Credential-IDs, Server-IPs (IPv4 und
IPv6), Notion-IDs, Google-IDs (Drive-Ordner, Dateien, Tabellen), Webhook-IDs **und Webhook-Pfade** (der Pfad kann selbst das
Geheimnis sein), lokale Pfade, Tokens und API-Keys, Werte hinter Schlüsselnamen wie `password` oder `apiKey`, Passwörter in
Connection-Strings, Überwachungs-URLs und Impressumsangaben aus Mailsignaturen, und wirft n8n-interne Laufzeitfelder weg. Danach
prüft ein breiter gefasster Mustersatz das Ergebnis; bleibt ein Verdacht, wird nichts geschrieben (fail-closed).

## Export aktualisieren

```bash
# alle Workflows der Instanz, je nach workflows/<name>/workflow.json
python3 tools/n8n-export.py https://n8n.example.eu
# einen Workflow an eine feste Stelle
python3 tools/n8n-export.py https://n8n.example.eu --id <workflow-id> --ziel workflows/kontaktformular/workflow.json
```

Fragt Zugangsdaten verdeckt ab oder nimmt sie aus `N8N_API_KEY`, `N8N_UI_USER` und `N8N_UI_PASS`. Die ungereinigte Rohfassung
liegt nur während des Laufs in einem temporären Verzeichnis. `tools/n8n-export.sh` ist die ältere Shell-Fassung und schreibt noch
flach nach `workflows/<name>.json`.

Import in n8n: *Workflows → Import from File*, danach die Credentials neu zuordnen — die IDs sind absichtlich entfernt.

## Lizenz

MIT — siehe [LICENSE](LICENSE).
