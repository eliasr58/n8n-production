# Betrieb

## `smoke-test.sh`

Entstanden am 17.08.2026 als Nachweis für **eine** konkrete Korrektur, nicht als
allgemeine Abnahmeliste. Das Skript weist zwei Dinge nach:

1. **Ein selbst gesetzter `X-Forwarded-For` setzt den Zähler nicht mehr zurück.**
   Es schickt fünf Anfragen mit erfundenen Absender-IPs; durchkommen dürfen
   höchstens zwei, weil alle an derselben echten IP hängen.
2. **Die Auto-Antwort geht höchstens einmal pro Stunde an dieselbe Adresse.**
   Alle Anfragen des Laufs nennen denselben Empfänger — im Postfach darf trotzdem
   nur eine Auto-Antwort ankommen.

Vorher wartet es in Minutenschritten auf ein freies Drosselfenster, damit der
eigentliche Test nicht schon an einer Restsperre scheitert.

> **Einordnung:** Das Skript spricht `n8n.roehrner.eu/webhook/kontakt` direkt an.
> Genau dieser Weg ist seit der Härtung geschlossen (404), der Kundenpfad läuft
> über `roehrner.eu/api/kontakt`. Für einen erneuten Lauf ist die Ziel-URL im
> Skript anzupassen. Es bleibt hier, weil es dokumentiert, **wie** der Nachweis
> geführt wurde.

Die übrigen Abnahmeschritte — 301 auf den Alt-Routen, 401 auf der Oberfläche,
429 beim vierten POST, Abweisung eines übergroßen Body — laufen als
`curl`-Einzeiler von Hand; sie stehen in
[der Case-Study](../docs/case-study-kontaktformular.md#8--abnahme).

## Backup und Löschfristen

Beide laufen als systemd-Timer auf dem Server:

| Unit | Zeit | Aufgabe |
|---|---|---|
| `roehrner-backup.timer` | täglich 03:15, `Persistent=true` | `pg_dumpall` beider Datenbanken, n8n-Volume und die Konfiguration einschließlich des Schlüssels, ohne den wiederhergestellte Credentials wertlos sind — AES-256, Größenprüfung, 14 Tage Retention |
| `roehrner-loeschfrist.timer` | täglich 03:45 | Kontaktanfragen älter als sechs Monate löschen |

`Persistent=true` ist wichtig: Ohne die Option fällt ein Lauf ersatzlos aus, wenn
der Server zur Timer-Zeit neu startet.

Der Restore wurde einmal vollständig durchgespielt — null Fehler, Hash des
Encryption Keys nach der Wiederherstellung identisch.

> Die Skriptdateien liegen auf dem Server. Zum Übernehmen ins Repository:
> `tools/server-artefakte-holen.sh`.
