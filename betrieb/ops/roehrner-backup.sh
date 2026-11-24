#!/usr/bin/env bash
set -euo pipefail
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
ZIEL=/var/backups/roehrner
PASS=/root/.backup_passphrase
WORK=$(mkdir -p /var/tmp/roehrner-backup && mktemp -d -p /var/tmp/roehrner-backup)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$ZIEL"
docker exec n8n-postgres-1 pg_dumpall -U n8n --clean --if-exists > "$WORK/postgres-alle-datenbanken.sql"
tar cf "$WORK/konfiguration.tar" -C /opt/n8n n8n-data .env docker-compose.yml Caddyfile caddy-build site
# 27.10.2026 (CJ-2710, Auftrag Elias): `opt/whisper/Dockerfile` und
# `opt/n8n/sms-signatur.js` sind aus der Liste genommen - beide gehoerten nur
# zur alten Telefon-/SMS-Annahme und sind geloescht.
# Rueckweg: /root/backups/<SICHERUNG>
tar cf "$WORK/system.tar" -C / \
  usr/local/bin/roehrner-backup.sh \
  usr/local/bin/roehrner-loeschfrist.sh \
  usr/local/bin/roehrner-monitor.sh \
  etc/systemd/system/roehrner-backup.service \
  etc/systemd/system/roehrner-backup.timer \
  etc/systemd/system/roehrner-loeschfrist.service \
  etc/systemd/system/roehrner-loeschfrist.timer \
  etc/systemd/system/roehrner-backup.service.d \
  etc/systemd/system/roehrner-loeschfrist.service.d \
  etc/systemd/system/roehrner-monitor.service \
  etc/systemd/system/roehrner-monitor.timer \
  usr/local/bin/alarm-mail.sh \
  usr/local/bin/alarmweg-melden.sh \
  usr/local/bin/alarmweg-test.sh \
  etc/systemd/system/alarm-mail@.service \
  etc/systemd/system/alarm-mail@.service.d \
  etc/systemd/system/alarmweg-fail@.service \
  etc/systemd/system/alarmweg-test.service \
  etc/systemd/system/alarmweg-test.timer \
  usr/local/bin/roehrner-workflow-export.sh \
  etc/systemd/system/roehrner-workflow-export.service \
  etc/systemd/system/roehrner-workflow-export.timer \
  etc/systemd/system/roehrner-workflow-export.service.d \
  etc/fail2ban/jail.local \
  etc/ufw/user.rules \
  etc/docker/daemon.json \
  etc/ufw/user6.rules \
  etc/systemd/journald.conf.d/9dr2-frist.conf \
  etc/logrotate.d/rsyslog \
  etc/logrotate.d/ufw \
  etc/logrotate.d/fail2ban \
  etc/logrotate.d/msmtp \
  etc/msmtprc \
  etc/aliases \
  etc/cron.d/9dr2-log-frist \
  usr/local/sbin/9dr2-dmesg-frist \
  root/git/<REPO>.git root/git/<REPO>.git
find "$ZIEL" -name 'roehrner-*.tar.gz.enc' -mtime +14 -print -delete
tar czf - -C "$WORK" postgres-alle-datenbanken.sql konfiguration.tar system.tar \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:"$PASS" \
  > "$ZIEL/roehrner-$STAMP.tar.gz.enc"
# --- WAECHTER ---
GROESSE=$(stat -c%s "$ZIEL/roehrner-$STAMP.tar.gz.enc")
# Vorlauf: die Groesse des juengsten ANDEREN Archivs in $ZIEL. Bestimmt erst
# hier, nach dem Schreiben des eigenen - die Retention weiter oben
# (find -mtime +14) loescht nie das juengste, der Vergleichswert ist also da,
# solange ueberhaupt einer da ist.
# Das `|| true` ist Pflicht und keine Vorsicht: mit `set -euo pipefail` (Z. 2)
# bricht eine leere Fundmenge sonst den ganzen Lauf ab, und "kein Vorlauf" ist
# kein Fehler, sondern der erste Lauf.
VORLAUF=$(find "$ZIEL" -maxdepth 1 -name 'roehrner-*.tar.gz.enc' \
  ! -name "roehrner-$STAMP.tar.gz.enc" -printf '%T@ %s\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2 || true)
if [ "$GROESSE" -lt 100000 ]; then
  echo "FEHLER: Archiv nur $GROESSE Bytes gross" >&2
  exit 1
fi
# Warum die Haelfte (C80, 21.09.2026): Die feste Grenze 100000 ist bei einer
# Ist-Groesse um 36 Mio. Byte Faktor 360 - ein Archiv, das auf ein halbes
# Prozent einbricht, kam bisher durch, wurde gespiegelt und pingte gruen.
# Genau das ist passiert: 07.09. bis 11.09. von 1,26 G auf 21 M, Faktor 60,
# ueber vier Laeufe, ohne dass etwas anschlug. Die letzten sieben Archive
# liegen zwischen 29.573.056 und 36.964.944 Byte, der kleinste Schritt von
# einem zum naechsten ist also Faktor 0,8 - die Haelfte laesst normales
# Schwanken durch und faengt einen Einbruch.
# Warum der Abbruch VOR der Off-Site-Kopie steht (wie schon die feste Grenze):
# Das kleine Archiv bleibt lokal liegen und ist am naechsten Tag selbst der
# Vorlauf. Der Folgelauf vergleicht also gegen den kleinen Wert und laeuft
# wieder durch - die Sperre heilt sich, sie blockiert nicht dauerhaft.
if [ -n "$VORLAUF" ] && [ "$((GROESSE * 2))" -lt "$VORLAUF" ]; then
  echo "FEHLER: Archiv $GROESSE Bytes, Vorlauf $VORLAUF Bytes (unter der Haelfte)" >&2
  exit 1
fi
# --- WAECHTER ENDE ---

# --- Off-Site-Kopie auf die Storage Box ----------------------------------
# Laeuft nach der lokalen Retention: was hier weg ist, verschwindet drueben
# im selben Lauf. Schutz gegen Leerraeumen sind die Snapshots der Box.
BOX="<STORAGEBOX_ZUGANG>"
BOX_ZIEL="n8n-server/"

if rsync -a --delete --delete-after --exclude=/.ssh/ \
      -e 'ssh -p23 -o BatchMode=yes -o StrictHostKeyChecking=accept-new' \
      "$ZIEL"/ "$BOX:$BOX_ZIEL"; then
  echo "Off-Site-Kopie ok"
else
  echo "Off-Site-Kopie FEHLGESCHLAGEN" >&2
  exit 1
fi
echo "OK $STAMP $GROESSE Bytes"

# --- Dead-man-Switch ------------------------------------------------------
# Wird nur erreicht, wenn alles davor durchgelaufen ist: set -e bricht vorher
# ab, und der fehlende Ping ist dann selbst das Signal. Meldet also nicht
# "Fehler passiert", sondern "Lauf hat stattgefunden".
curl -fsS -m 10 --retry 3 "$(cat /root/.healthcheck-url)" > /dev/null && echo "Dead-man-Ping ok"
