#!/usr/bin/env bash
set -euo pipefail
UNIT="$1"
EMPF="<EMAIL>"
{
  printf 'Subject: [ALARM] %s fehlgeschlagen\n' "$UNIT"
  printf 'From: <EMAIL>\n'
  printf 'To: %s\n' "$EMPF"
  printf '\n'
  printf 'Die Unit %s ist auf n8n-server fehlgeschlagen.\n\n' "$UNIT"
  printf 'Letzte Journalzeilen:\n\n'
  journalctl -u "$UNIT" -n 30 --no-pager
} | msmtp -a roehrner "$EMPF"
