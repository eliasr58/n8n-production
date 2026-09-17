#!/usr/bin/env bash
# Meldet den Zustand des Alarmwegs an Healthchecks ("Röhrner - Alarmweg").
# Aufruf: alarmweg-melden.sh ok|fail [Text]. Verschickt keine Mail.
set -euo pipefail
umask 077

PING_DATEI=/root/.healthcheck-alarmweg-url
ART="${1:-}"
TEXT="${2:-Alarmweg}"

[ -r "$PING_DATEI" ] || { echo "Ping-URL fehlt: $PING_DATEI" >&2; exit 1; }
PING=$(cat "$PING_DATEI")

case "$ART" in
  ok)   ZIEL="$PING" ;;
  fail) ZIEL="${PING}/fail" ;;
  *)    echo "Aufruf: $0 ok|fail [Text]" >&2; exit 2 ;;
esac

curl -fsS -m 10 --retry 3 --data-raw "${TEXT}, $(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ZIEL" > /dev/null
echo "Alarmweg-Meldung $ART gesendet"
