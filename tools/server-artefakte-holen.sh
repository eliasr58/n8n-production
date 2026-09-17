#!/usr/bin/env bash
# Holt Backup-Skript, Loeschjob, Alarmweg, Workflow-Export und ihre
# systemd-Units vom Server ins Repository.
# Rein lesend auf der Serverseite. Jede Datei geht durch tools/sanitize.py,
# bevor sie ins Repository geschrieben wird; meldet der Sanitizer auch nur bei
# einer Datei einen Restverdacht, wird NICHTS nach ops/ geschrieben.
#
#   ./tools/server-artefakte-holen.sh <benutzer>@<SERVER_IP>

set -euo pipefail

HOST="${1:?Ziel angeben, z. B. benutzer@server}"
WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
ZIEL="$WURZEL/ops"
SANITIZE="$WURZEL/tools/sanitize.py"

ROH=$(mktemp -d)
SAUBER=$(mktemp -d)
trap 'rm -rf "$ROH" "$SAUBER"' EXIT

for datei in \
  /usr/local/bin/roehrner-backup.sh \
  /usr/local/bin/roehrner-loeschfrist.sh \
  /etc/systemd/system/roehrner-backup.service \
  /etc/systemd/system/roehrner-backup.timer \
  /etc/systemd/system/roehrner-loeschfrist.service \
  /etc/systemd/system/roehrner-loeschfrist.timer \
  /usr/local/bin/alarm-mail.sh \
  /etc/systemd/system/alarm-mail@.service \
  /etc/systemd/system/alarm-mail@.service.d/onfailure.conf \
  /usr/local/bin/alarmweg-melden.sh \
  /usr/local/bin/alarmweg-test.sh \
  /etc/systemd/system/alarmweg-fail@.service \
  /etc/systemd/system/alarmweg-test.service \
  /etc/systemd/system/alarmweg-test.timer \
  /usr/local/bin/roehrner-workflow-export.sh \
  /etc/systemd/system/roehrner-workflow-export.service \
  /etc/systemd/system/roehrner-workflow-export.service.d/onfailure.conf \
  /etc/systemd/system/roehrner-workflow-export.timer
do
  # Drop-ins heissen alle onfailure.conf; der Verzeichnisname haelt sie in
  # ops/ auseinander (alarm-mail@.service.d-onfailure.conf).
  eltern=$(basename "$(dirname "$datei")")
  case "$eltern" in
    (*.d) name="$eltern-$(basename "$datei")" ;;
    (*)   name=$(basename "$datei") ;;
  esac
  if scp -q "$HOST:$datei" "$ROH/$name" 2>/dev/null; then
    echo "geholt: $name"
  else
    echo "fehlt:  $datei" >&2
  fi
done

# Erst alles bereinigen, dann schreiben. Ein Abbruch mitten in der Schleife
# darf keinen halb bereinigten Stand in ops/ hinterlassen.
fehler=0
for roh in "$ROH"/*; do
  [ -e "$roh" ] || continue
  if ! python3 "$SANITIZE" "$roh" "$SAUBER/$(basename "$roh")" >/dev/null; then
    echo "SANITIZER-VERDACHT: $(basename "$roh")" >&2
    fehler=1
  fi
done
if [ "$fehler" -ne 0 ]; then
  echo "ABGEBROCHEN: nichts nach ops/ geschrieben." >&2
  exit 1
fi

for sauber in "$SAUBER"/*; do
  [ -e "$sauber" ] || continue
  cp "$sauber" "$ZIEL/$(basename "$sauber")"
  echo "geschrieben: ops/$(basename "$sauber")"
done

echo
echo "Trotzdem durchsehen: Zielverzeichnisse und Pfade. Der Sanitizer ersetzt"
echo "Muster, er versteht keinen Zusammenhang."
