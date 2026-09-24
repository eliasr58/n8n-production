# Posteingang

**Status:** nicht aktiv (zuletzt geändert am 04.09.2026) · 23 Nodes · lief auf **n8n 2.34.4** — am 30.08.2026 im
15-Minuten-Takt mit Status `success` protokolliert; seit der Abschaltung nicht erneut getestet. In n8n selbst sind keine
Ausführungen mehr gespeichert (Aufbewahrung 7 Tage).

## Problem

Ein Geschäftspostfach mischt Kundenanfragen, Rechnungen, Behördenpost, Werkzeug-Benachrichtigungen und Werbung. Wer jede Mail
selbst sortiert, verliert täglich Zeit; wer es blind automatisiert, verliert irgendwann eine wichtige Mail. Der Workflow sortiert
nach festen Regeln, fragt das Modell nur, wo keine Regel greift, und handelt nur dort, wo er sich sicher ist.

## Ablauf

```
alle 15 Minuten
  ▼
Regeln aus Notion laden → schon protokollierte Mails ausfiltern → Labels holen → Posteingang lesen (30 je Lauf)
  ▼
Regeln anwenden (fest, ohne Modell)
  ▼
Braucht Claude?
  ├── ja   → Paket schnüren → Claude ordnet ein (Kategorie, Konfidenz) → Antwort prüfen ─┐
  └── nein ──────────────────────────────────────────────────────────────────────────────┤
                                                                                          ▼
                                    nur echte Entscheidungen → Label setzen → ggf. archivieren
                                                                                          ▼
                                                                     Notion: Mail-Log
```

**Kategorien:** Lead · Kunde · Eingangsrechnung · Behörde · Recht · Tool · Bewerbung · Werbung · Sonstiges. Eine Kategorie
außerhalb dieser Liste wird zu *Sonstiges*. Bei Leads extrahiert das Modell zusätzlich Firma, Gewerk, Ort und Anliegen für die
Weiterverarbeitung.

## Sicherungen

- **Es wird niemals gelöscht.** Eine Papierkorb-Regel aus der Regel-Datenbank wird automatisch zu „Archivieren“ herabgestuft.
- **Handeln nur bei Sicherheit:** Liegt die Konfidenz des Modells unter 0,9, passiert nichts — die Mail bleibt ungelabelt im
  Posteingang. Archivieren soll das Modell laut Anweisung nur Tool- und Werbemails; im Code erzwungen ist die Konfidenzgrenze,
  nicht die Kategorie. Regeln aus der Regel-Datenbank greifen ohne Modell.
- **Kein Doppelt-Verarbeiten:** Was schon im Mail-Log steht, wird übersprungen.
- **Modellwahl nach Schaden, nicht nach Preis:** Im Geschäftspostfach kostet eine Fehlentscheidung mehr als der Aufpreis für das
  größere Modell (`claude-sonnet-4-5`).

## Benötigte Konnektoren

| Konnektor | Wofür |
|---|---|
| Gmail (OAuth2) | Posteingang lesen, Labels holen und setzen, archivieren |
| HTTP Request → Anthropic-API | Einordnung, wo keine Regel greift |
| HTTP Request → Notion-API (Header-Auth) | Regel-Datenbank lesen, Mail-Log lesen und schreiben |

## Einrichtung

1. *Workflows → Import from File* → `workflow.json`, Credentials neu zuordnen (`<CREDENTIAL_ID>`).
2. Die Notion-Datenbanken eintragen (`<NOTION_ID>`): Regeln und Mail-Log. Die Regel-Datenbank bestimmt, welche Absender ohne
   Modell eingeordnet werden.
3. Die Postfach-Adresse in Hinweis und Code eintragen (im Export `<EMAIL>`).
4. Die Gmail-Labels anlegen, die zu den Kategorien passen; der Workflow löst sie über ihren Namen auf.

## Grenzen

- Höchstens 30 Mails je Lauf; bei größerem Rückstand braucht es mehrere Läufe.
- Rechnungen werden hier nur gelabelt. Ablage und Erfassung übernimmt der Workflow [Eingangsrechnungen](../eingangsrechnungen/).
- Der Lead-Pfad (Antwortentwurf, Termin) und ein Tagesüberblick sind nicht Teil dieses Workflows.
