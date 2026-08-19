#!/usr/bin/env bash
# Holt Backup-Skript, Loeschjob und die systemd-Units vom Server ins Repository
# und ersetzt dabei die Server-IP. Rein lesend auf der Serverseite.
#
#   ./tools/server-artefakte-holen.sh <benutzer>@<SERVER_IP>

set -euo pipefail

HOST="${1:?Ziel angeben, z. B. benutzer@server}"
ZIEL="$(cd "$(dirname "$0")/.." && pwd)/ops"

for datei in \
  /usr/local/bin/roehrner-backup.sh \
  /usr/local/bin/roehrner-loeschfrist.sh \
  /etc/systemd/system/roehrner-backup.service \
  /etc/systemd/system/roehrner-backup.timer \
  /etc/systemd/system/roehrner-loeschfrist.service \
  /etc/systemd/system/roehrner-loeschfrist.timer
do
  name=$(basename "$datei")
  if scp -q "$HOST:$datei" "$ZIEL/$name" 2>/dev/null; then
    echo "geholt: $name"
  else
    echo "fehlt:  $datei" >&2
  fi
done

# IP und Passphrase-Pfad neutralisieren.
python3 - "$ZIEL" <<'PY'
import pathlib, re, sys
ziel = pathlib.Path(sys.argv[1])
for p in ziel.iterdir():
    if p.suffix in (".sh", ".service", ".timer"):
        t = p.read_text(encoding="utf-8", errors="replace")
        neu = re.sub(r"\b\d{1,3}(\.\d{1,3}){3}\b", "<SERVER_IP>", t)
        if neu != t:
            p.write_text(neu, encoding="utf-8")
            print("IP ersetzt in", p.name)
PY

echo
echo "Jetzt haendisch durchsehen: Passphrase-Pfade, Zielverzeichnisse,"
echo "Mailadressen fuer Alarme. Das Skript ersetzt nur IP-Adressen."
