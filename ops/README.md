# Betrieb

## `smoke-test.sh`

Abnahme nach jeder Änderung an Caddy oder am Stack. Jede Prüfung entspricht einem
Fehler, der tatsächlich aufgetreten ist — die Datei ist als Regressionsliste
gewachsen, nicht als Checkliste erdacht.

Geprüft werden unter anderem:

- echte 301 statt Meta-Refresh auf den vier Alt-Routen
- 401 auf der n8n-Oberfläche (Zugang zu)
- 404 auf `/webhook/kontakt` über die Subdomain (Umgehung der Drossel geschlossen)
- 429 beim vierten Formular-POST innerhalb von zehn Minuten
- Abweisung eines übergroßen Request-Body

`curl` läuft dabei mit `-L`: ohne Redirect-Verfolgung meldet ein nachgeschaltetes
`grep` fälschlich Erfolg, weil es die Weiterleitungsseite durchsucht statt das Ziel.

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
