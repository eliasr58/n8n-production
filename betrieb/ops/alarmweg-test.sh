#!/usr/bin/env bash
# Woechentlicher Selbsttest des Alarmwegs: Testmail ueber dasselbe Konto wie
# alarm-mail.sh (msmtp -a roehrner, /etc/msmtprc), Ergebnis an Healthchecks.
# alarm-mail@ wird bewusst nicht benutzt (fester [ALARM]-Betreff).
set -uo pipefail
umask 077

EMPF="<EMAIL>"
JETZT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

{
  printf 'Subject: [Alarmweg-Test] %s\n' "$JETZT"
  printf 'From: <EMAIL>\n'
  printf 'To: %s\n' "$EMPF"
  printf '\n'
  printf 'Selbsttest des Alarmwegs (msmtp -a roehrner) auf n8n-server, %s.\n' "$JETZT"
  printf 'Kommt diese Mail an, kann auch eine Alarmmail ankommen.\n'
} | msmtp -a roehrner "$EMPF"
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "Testmail ok"
  /usr/local/bin/alarmweg-melden.sh ok "Alarmweg-Test ok"
  exit $?
fi

echo "Testmail FEHLGESCHLAGEN, msmtp exit $rc" >&2
/usr/local/bin/alarmweg-melden.sh fail "Alarmweg-Test fehlgeschlagen, msmtp exit $rc" || true
exit "$rc"
