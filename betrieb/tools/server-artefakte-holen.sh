#!/usr/bin/env bash
# Holt Backup-Skript, Loeschjob, Alarmweg, Workflow-Export und ihre
# systemd-Units vom Server nach betrieb/ops/.
# Rein lesend auf der Serverseite. Jede Datei geht durch tools/sanitize.py
# (im Wurzelverzeichnis des Repositorys),
# bevor sie ins Repository geschrieben wird; meldet der Sanitizer auch nur bei
# einer Datei einen Restverdacht, wird NICHTS nach betrieb/ops/ geschrieben.
#
#   ./betrieb/tools/server-artefakte-holen.sh <benutzer>@<SERVER_IP>
#
# Ein anderer Sanitizer laesst sich per Umgebungsvariable SANITIZE=... setzen.
#
# Nur die Nachpruefung eines Ordners (ohne Server), z. B. fuer einen Test:
#   NUR_NACHPRUEFEN=<ordner> ./betrieb/tools/server-artefakte-holen.sh

set -euo pipefail

BETRIEB="$(cd "$(dirname "$0")/.." && pwd)"
WURZEL="$(cd "$BETRIEB/.." && pwd)"
ZIEL="$BETRIEB/ops"
SANITIZE="${SANITIZE:-$WURZEL/tools/sanitize.py}"
[ -f "$SANITIZE" ] || { echo "sanitize.py nicht gefunden: $SANITIZE (SANITIZE=... setzen)" >&2; exit 2; }

# Eigene Domain (Nacharbeit 27.09.2026): Ein n8n-Host darunter gehoert nicht ins Repository. tools/sanitize.py ersetzt
# ihn durch n8n.example.eu; hier die zweite, unabhaengige Pruefung mit /usr/bin/grep (Arbeitsregel 31: LC_ALL=C, -a,
# stdin, -n -o, eine Positivkontrolle durch denselben Aufruf). Domain, www. und stats. sind oeffentlich.
EIGENE_DOMAIN="${EIGENE_DOMAIN:-roehrner.eu}"
HOSTMUSTER="(^|[^A-Za-z0-9.-])n8n[A-Za-z0-9-]*\\.${EIGENE_DOMAIN//./\\.}"

host_treffer() {   # stdin -> Anzahl Treffer
  LC_ALL=C /usr/bin/grep -a -n -o -i -E -e "$HOSTMUSTER" | wc -l | tr -d ' '
}

nachpruefen() {   # $1 = Ordner mit bereinigten Dateien. Exit 0 sauber, 1 Treffer oder Restverdacht, 2 Kontrolle ungueltig
  local k n datei fehler=0
  k=$(printf 'Kontrolle \344 https://n8n.%s/\n' "$EIGENE_DOMAIN" | host_treffer)
  if [ "$k" != "1" ]; then
    echo "NACHPRUEFUNG UNGUELTIG: Positivkontrolle eigener n8n-Host schlaegt nicht an ($k)" >&2
    return 2
  fi
  for datei in "$1"/*; do
    [ -e "$datei" ] || continue
    n=$(host_treffer < "$datei")
    if [ "$n" != "0" ]; then
      echo "EIGENER N8N-HOST: $(basename "$datei") ($n)" >&2
      fehler=1
    fi
    python3 "$SANITIZE" --pruefen "$datei" >/dev/null || fehler=1
  done
  return "$fehler"
}

if [ -n "${NUR_NACHPRUEFEN:-}" ]; then
  if nachpruefen "$NUR_NACHPRUEFEN"; then echo "Nachpruefung sauber: $NUR_NACHPRUEFEN"; exit 0; else exit $?; fi
fi

HOST="${1:?Ziel angeben, z. B. benutzer@server}"

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
  /etc/systemd/system/roehrner-backup.service.d/onfailure.conf \
  /etc/systemd/system/roehrner-loeschfrist.service.d/onfailure.conf \
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
if ! nachpruefen "$SAUBER"; then
  echo "ABGEBROCHEN nach der Nachpruefung: nichts nach ops/ geschrieben." >&2
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
