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
  etc/fail2ban/jail.local \
  etc/ufw/user.rules \
  etc/ufw/user6.rules
find "$ZIEL" -name 'roehrner-*.tar.gz.enc' -mtime +14 -delete
tar czf - -C "$WORK" postgres-alle-datenbanken.sql konfiguration.tar system.tar \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:"$PASS" \
  > "$ZIEL/roehrner-$STAMP.tar.gz.enc"
GROESSE=$(stat -c%s "$ZIEL/roehrner-$STAMP.tar.gz.enc")
if [ "$GROESSE" -lt 100000 ]; then
  echo "FEHLER: Archiv nur $GROESSE Bytes gross" >&2
  exit 1
fi

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
