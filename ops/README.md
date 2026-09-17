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
| `roehrner-backup.timer` | nächtlich, `Persistent=true` | `pg_dumpall` beider Datenbanken, n8n-Volume und die Konfiguration einschließlich des Schlüssels, ohne den wiederhergestellte Credentials wertlos sind — AES-256, Größenprüfung, 14 Tage Retention |
| `roehrner-loeschfrist.timer` | nächtlich, nach dem Backup | Kontaktanfragen älter als sechs Monate löschen |

`Persistent=true` ist wichtig: Ohne die Option fällt ein Lauf ersatzlos aus, wenn
der Server zur Timer-Zeit neu startet.

Seit dem 21.08.2026 spiegelt der Backup-Lauf zusätzlich auf eine **Storage Box
in einem anderen Rechenzentrum** als dem des Servers — `rsync -a --delete` über
SSH, mit `BatchMode=yes`, damit ein fehlender Schlüssel den Lauf abbrechen lässt,
statt ihn auf eine Passworteingabe warten zu lassen. Der Block sitzt **nach** der
lokalen Retention, damit gelöschte Archive im selben Lauf auch drüben
verschwinden. Gegen ein versehentliches oder böswilliges Leerräumen stehen die
täglichen Snapshots der Box — sie liegen außerhalb der `--delete`-Logik.

Der Restore wurde einmal vollständig durchgespielt — null Fehler, Hash des
Encryption Keys nach der Wiederherstellung identisch. Der Restore **von der Box**
wurde separat geprobt, ebenso der Fehlerfall: mit verfälschtem Zielhost bricht
der Dienst mit Exit-Code 1 ab.

## Alarmweg

Backup und Löschfrist sind über ein Drop-in am jeweiligen Dienst mit
`OnFailure=alarm-mail@%n.service` verknüpft
(`roehrner-backup.service.d-onfailure.conf`,
`roehrner-loeschfrist.service.d-onfailure.conf`). Die Template-Unit
`alarm-mail@.service` ruft `alarm-mail.sh` auf, das per msmtp eine Mail mit den
letzten dreißig Journalzeilen der fehlgeschlagenen Unit verschickt. Vorher stand
ein Fehlschlag nur im Journal.

**Der Alarmweg wird selbst überwacht.** Eine Alarmmail, die nicht rausgeht,
meldet sonst niemand — genau so war der Weg einmal tagelang still, weil das
SMTP-Passwort ungültig geworden war.

| Teil | Dateien | Tut |
|---|---|---|
| Sofortmeldung | `alarm-mail@.service.d-onfailure.conf` → `alarmweg-fail@.service` → `alarmweg-melden.sh` | scheitert eine Alarmmail, geht eine `/fail`-Meldung an den externen Ping-Dienst — **ohne** Mailversand, also unabhängig vom kaputten Weg |
| Selbsttest | `alarmweg-test.timer` (wöchentlich, `Persistent=true`) → `alarmweg-test.service` → `alarmweg-test.sh` | schickt über dasselbe msmtp-Konto eine Testmail; Erfolg → Ping, Fehler → `/fail` mit dem msmtp-Exitcode |

Der Ping-Dienst schlägt Alarm, wenn `/fail` kommt oder der wöchentliche Ping
ausbleibt. `alarm-mail@` selbst wird für den Test nicht benutzt — sein Betreff
ist fest ein Alarm.

Nachgewiesen wurde beides mit echten Fehlern, ohne die Produktivkonfiguration
anzufassen: ein Testlauf mit einer nur für diesen Lauf eingebundenen
msmtp-Konfiguration mit falschem Passwort, und eine absichtlich scheiternde
Instanz von `alarm-mail@`, deren `OnFailure` die Fehlermeldung auslöste.

Das SMTP-Passwort liegt in einer eigenen Datei mit Rechten `600`; die
msmtp-Konfiguration verweist über `passwordeval` darauf und enthält selbst kein
Geheimnis. Gegengeprüft wurde beides: Im Fehlerfall kommt die Mail, im
Erfolgsfall bleibt das msmtp-Log unverändert.

## Dead-man-Switch

`OnFailure` meldet, dass ein Lauf **fehlgeschlagen** ist. Ein Lauf, der gar nicht
stattfindet, erzeugt dagegen keine Meldung — ein stehender Server schweigt
zuverlässig. Deshalb meldet das Backup-Skript am Ende jedes erfolgreichen
Durchgangs an einen externen Ping-Dienst; bleibt die Meldung aus, schlägt der
Dienst Alarm. Der Aufruf steht bewusst als letzte Zeile: `set -e` bricht vorher
ab, das Ausbleiben des Pings ist dann selbst das Signal.

## Workflow-Versionierung

n8n hält in dieser Installation nur den aktuellen Stand eines Workflows. Die
Definitionen werden deshalb täglich in ein lokales git-Repository geschrieben:

| Unit | Zeit | Aufgabe |
|---|---|---|
| `roehrner-workflow-export.timer` | täglich 04:00, nach Backup und Löschfrist, `Persistent=true` | `roehrner-workflow-export.sh`: eine **lesende** Abfrage an Postgres (Transaktion erzwungen read-only, kein zweiter n8n-Prozess, kein API-Schlüssel), je Workflow eine sortierte JSON-Datei, Commit nur bei Änderung |

- Das Repository liegt im Datenverzeichnis von n8n, gehört `root` mit Rechten
  `700` und hat **kein Remote** — Nodes können Zugangsdaten im Klartext tragen.
  Über das Datenverzeichnis ist es Teil der nächtlichen Sicherung.
- Nicht exportiert werden `pinData`, `staticData` und Felder, die sich ohne
  inhaltliche Änderung ändern (Zeitstempel, Versions-IDs, Zähler). Sonst gäbe
  es jede Nacht einen Commit ohne Inhalt.
- Nachgewiesen: Anlegen, Ändern (genau ein neuer Node im Diff), Archivieren und
  Löschen eines Test-Workflows erzeugen je genau einen Commit mit genau dieser
  Datei; ein Lauf ohne Änderung erzeugt keinen.
- Der Dienst hängt wie Backup und Löschfrist am Alarmweg
  (`roehrner-workflow-export.service.d-onfailure.conf`).

## Zugang zum Server

Anmeldung ausschließlich per SSH-Schlüssel, Passwortanmeldung und
X11-Weiterleitung sind abgeschaltet. `ufw` lässt nur 22, 80 und 443 durch; n8n
lauscht auf der Loopback-Adresse, Postgres ausschließlich im Docker-Netz.
`fail2ban` sperrt wiederholt fehlschlagende Anmeldeversuche über dieselbe
Firewall, statt an ihr vorbei eigene Regeln zu schreiben.

> Die Skriptdateien liegen auf dem Server. Zum Übernehmen ins Repository:
> `tools/server-artefakte-holen.sh`.
