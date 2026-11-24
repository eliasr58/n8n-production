#!/usr/bin/env bash
umask 077

PING_DATEI=/root/.healthcheck-system-url
[ -r "$PING_DATEI" ] || { echo "Ping-URL fehlt"; logger -t roehrner-monitor "Ping-URL fehlt ($0), Exit 1"; exit 1; }
PING=$(cat "$PING_DATEI")

fehler=""

# Seit 27.10.2026 (CJ-2710, Entscheidung Elias): `whisper-dienst` und
# `sms-signatur` sind entfernt - sie gehoerten nur zur alten Telefon-/SMS-
# Annahme. Mit ihnen entfaellt die Funktionsprobe fuer sms-signatur.
# Rueckweg: /root/backups/<SICHERUNG>
for c in n8n-caddy-1 n8n-n8n-1 n8n-postgres-1; do
  status=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null) || status="nicht vorhanden"
  [ "$status" = "running" ] || fehler="${fehler}Container ${c}: ${status}. "
done

belegt=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "$belegt" -lt 85 ] || fehler="${fehler}Datentraeger zu ${belegt} Prozent belegt. "

frei=$(free -m | awk '/^Mem:/ {print $7}')
[ "$frei" -gt 200 ] || fehler="${fehler}Nur ${frei} MB Arbeitsspeicher verfuegbar. "

juengstes=$(find /var/backups/roehrner -name 'roehrner-*.tar.gz.enc' -mmin -1560 2>/dev/null | wc -l)
[ "$juengstes" -gt 0 ] || fehler="${fehler}Keine Sicherung der letzten 26 Stunden. "

# Haertung 10.10.2026 (Diagnose der Alarme vom 08.10.): Bis dahin schrieb dieses
# Skript "OK - alle Pruefungen bestanden" auch dann, wenn der Ping gar nicht
# ankam - das Ergebnis von curl wurde nie ausgewertet, und der Lauf endete mit 0.
# Am 08.10. um 18:06:52Z lief der erste Versuch in eine Zeitueberschreitung der
# Namensaufloesung; ob die Wiederholung ankam, war am Server nicht zu sehen.
# Jetzt: Erfolg nur bei curl-Exit 0 und HTTP 200, sonst Journal-Zeile (Tag
# roehrner-monitor, ohne URL) und Exit ungleich 0. --retry-all-errors, weil ein
# DNS-Fehler (curl 6) fuer --retry allein nicht als voruebergehend gilt.
# Exit-Codes: 0 OK und Ping angekommen · 1 Pruefung gescheitert, /fail angekommen ·
#             2 Pruefung gescheitert, /fail NICHT angekommen · 3 OK, Ping NICHT angekommen.
# $1 = Ziel, $2 = Text (optional; ohne Text ein GET wie bisher). Setzt rc und http.
melde() {
  local daten=()
  [ -n "${2:-}" ] && daten=(--data-raw "$2")
  http=$(curl -fs -o /dev/null -w '%{http_code}' -m 10 --retry 3 --retry-all-errors "${daten[@]}" "$1" 2>/dev/null)
  rc=$?
  # Bei Wiederholungen kann -w je Versuch schreiben - es zaehlt der letzte.
  http=$(printf '%s' "${http:-000}" | tail -c 3)
  [ "$rc" -eq 0 ] && [ "$http" = 200 ]
}

if [ -n "$fehler" ]; then
  if melde "${PING}/fail" "$fehler"; then
    echo "FEHLER: $fehler"
    exit 1
  fi
  logger -t roehrner-monitor "/fail-Ping NICHT angekommen: curl-Exit $rc, HTTP $http, Exit 2 ($0)"
  echo "FEHLER: $fehler /fail-Ping nicht angekommen (curl-Exit $rc, HTTP $http)."
  exit 2
fi

if melde "$PING"; then
  echo "OK - alle Pruefungen bestanden"
  exit 0
fi
logger -t roehrner-monitor "Ping NICHT angekommen: curl-Exit $rc, HTTP $http, Exit 3 ($0)"
echo "FEHLER: alle Pruefungen bestanden, aber Ping nicht angekommen (curl-Exit $rc, HTTP $http)."
exit 3
