# Eingangsrechnungen

**Status:** nicht aktiv (zuletzt geändert am 04.09.2026) · 18 Nodes · lief auf **n8n 2.34.4** — am 30.08.2026 im
30-Minuten-Takt mit Status `success` protokolliert; seit der Abschaltung nicht erneut getestet. In n8n selbst sind keine
Ausführungen mehr gespeichert (Aufbewahrung 7 Tage).

## Problem

Rechnungen kommen als PDF-Anhang per Mail, von Dutzenden Anbietern, jede anders aufgebaut. Abzulegen, umzubenennen, in die
Buchhaltungsliste zu übertragen und dem richtigen Quartal zuzuordnen ist Routinearbeit, bei der ein einziger falsch gelesener
Betrag teurer ist als die ganze Zeitersparnis. Der Workflow erledigt die Routine und lässt alles liegen, was er nicht sicher weiß.

## Ablauf

```
alle 30 Minuten
  ▼
Gmail: PDF-Anhänge mit Rechnungsbezug, noch nicht verarbeitet, höchstens 10 je Lauf, letzte 90 Tage
  ▼
PDF finden → Text auslesen → Claude extrahiert Datum, Anbieter, Nummer, Leistung, Beträge
  ▼
Daten vollständig?
  ├── ja   → Google Drive (Dateiname nach fester Konvention) → Notion: Ausgabe anlegen ─┐
  └── nein ──────────────────────────────────────────────────────────────────────────────┤
                                                                                           ▼
                                                              Notion: Mail-Log (beide Fälle)
                                                                                           ▼
                                                  nur erfolgreiche: Gmail-Label „verarbeitet“ + Quartal
```

## Sicherungen

- **Nichts wird geraten.** Das Modell gibt `sicher: false` zurück, wenn Datum, Anbieter oder Betrag nicht zweifelsfrei im Text
  stehen. Dann passiert nichts außer einem Log-Eintrag mit Status *Vorgeschlagen*, und die Mail bleibt unmarkiert, damit sie von
  Hand erfasst wird.
- **Netto wird nie hochgerechnet.** Steht es nicht auf dem Beleg, bleibt das Feld leer.
- **Gutschriften** bekommen einen negativen Betrag.
- **Das Quartal kommt vom Rechnungsdatum**, nicht vom Empfangsdatum: Eine am 2. Oktober zugestellte September-Rechnung landet in Q3.
- **Nur Erfolgreiches wird markiert.** Scheitert ein Schritt, bleibt die Mail ohne Label und kommt im nächsten Lauf wieder.

## Benötigte Konnektoren

| Konnektor | Wofür |
|---|---|
| Gmail (OAuth2) | Suchen, Anhänge laden, Labels setzen |
| Google Drive (OAuth2) | PDF ablegen |
| HTTP Request → Anthropic-API | Rechnungsdaten auslesen (`claude-sonnet-4-5`) |
| HTTP Request → Notion-API (Header-Auth) | Ausgabe anlegen, Mail-Log schreiben |

## Einrichtung

1. *Workflows → Import from File* → `workflow.json`, Credentials neu zuordnen (`<CREDENTIAL_ID>`).
2. Drive-Zielordner eintragen (`<GOOGLE_ID>`) und die beiden Notion-Datenbanken (`<NOTION_ID>`): Ausgaben und Mail-Log. Die
   Eigenschaften müssen zu den Feldern im Code passen.
3. Die Gmail-Label-IDs in `Als verarbeitet markieren` auf die eigenen Labels umstellen; sie stehen dort fest im Ausdruck.
4. Den Suchausdruck in `Rechnungsmails suchen` an die eigenen Absender und Stichwörter anpassen.

## Grenzen

- Die **Kategorie** setzt der Workflow immer auf *Tools/Software*. Bei Hosting oder Hardware wird sie in Notion von Hand korrigiert.
- Die Quartals-Labels sind für 2026 Q2 bis Q4 fest hinterlegt; für spätere Quartale setzt der Workflow kein Quartals-Label.
- Nur PDF-Anhänge. Rechnungen im Mailtext oder als Bild werden nicht erkannt.
- Höchstens zehn Mails je Lauf, nur die letzten 90 Tage.
