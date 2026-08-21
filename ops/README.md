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

## Alarmierung

Beide Timer sind über ein Drop-in mit `OnFailure=alarm-mail@%n.service`
verknüpft. Die Template-Unit ruft `/usr/local/bin/alarm-mail.sh` auf, das per
msmtp eine Mail mit den letzten dreißig Journalzeilen der fehlgeschlagenen Unit
verschickt. Vorher stand ein Fehlschlag nur im Journal.

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

## Zugang zum Server

Anmeldung ausschließlich per SSH-Schlüssel, Passwortanmeldung und
X11-Weiterleitung sind abgeschaltet. `ufw` lässt nur 22, 80 und 443 durch; n8n
lauscht auf der Loopback-Adresse, Postgres ausschließlich im Docker-Netz.
`fail2ban` sperrt wiederholt fehlschlagende Anmeldeversuche über dieselbe
Firewall, statt an ihr vorbei eigene Regeln zu schreiben.

> Die Skriptdateien liegen auf dem Server. Zum Übernehmen ins Repository:
> `tools/server-artefakte-holen.sh`.
