#!/bin/zsh
# Abnahme der Drossel — historischer Stand vom 17.08.2026.
#
# EINORDNUNG: Dieses Skript prueft den Webhook noch direkt ueber die
# n8n-Subdomain. Genau dieser Weg ist seit der Haertung geschlossen
# (`handle /webhook/kontakt { respond 404 }` im Caddyfile) — der Kundenpfad
# laeuft ausschliesslich ueber roehrner.eu/api/kontakt. Das Skript bleibt im
# Repository, weil es dokumentiert, WIE der Nachweis gefuehrt wurde: Es war
# der Lauf, der gezeigt hat, dass ein erfundener X-Forwarded-For den Zaehler
# zuruecksetzt. Fuer den heutigen Pfad ist die Ziel-URL auf
# https://roehrner.eu/api/kontakt zu aendern.
#
# Weist zwei Dinge auf einmal nach:
#
#   1. Ein erfundener X-Forwarded-For setzt den Zaehler nicht mehr zurueck.
#   2. Die Auto-Antwort geht hoechstens einmal pro Stunde an dieselbe Adresse.
#
# Aufruf:  zsh ops/smoke-test.sh

URL="https://n8n.roehrner.eu/webhook/kontakt"
ZIEL="<TEST_EMPFAENGER>"

anfrage() {   # $1 = Name, $2 = X-Forwarded-For (optional)
  local xff=()
  [[ -n "$2" ]] && xff=(-H "X-Forwarded-For: $2")
  curl -s -X POST "$URL" -H 'Content-Type: application/json' "${xff[@]}" \
    -d "{\"name\":\"$1\",\"betrieb\":\"Test\",\"telefon\":\"08543 12345\",\"email\":\"$ZIEL\",\"nachricht\":\"$1 - Abnahme nach dem Fix. Kein echter Kunde.\",\"einwilligung\":\"on\",\"quelle\":\"sicherheitstest\"}"
}

echo "Warte auf ein freies Fenster (hoechstens 12 Minuten)."
versuch=0
while true; do
  versuch=$((versuch+1))
  a=$(anfrage "SONDE $versuch")
  echo "  $(date '+%H:%M:%S')  Sonde $versuch: $a"
  [[ "$a" != *"rate-limit"* ]] && { echo "  Frei. Die Sonde belegt Platz 1 von 3."; break; }
  (( versuch >= 12 )) && { echo "  Immer noch gesperrt — das sollte nach dem Fix nicht passieren."; exit 1; }
  sleep 60
done

echo
echo "Fuenf Anfragen mit erfundenen Absender-IPs, Start: $(date '+%H:%M:%S')"
DURCH=0
for i in 1 2 3 4 5; do
  a=$(anfrage "XFF-ABNAHME $i" "203.0.113.$i")
  echo "  $i (erfunden 203.0.113.$i): $a"
  [[ "$a" != *"rate-limit"* ]] && DURCH=$((DURCH+1))
done

echo
echo "Durchgelassen: $DURCH von 5"
echo "  0 bis 2  -> richtig. Alle fuenf landen auf derselben echten IP,"
echo "              nach Platz 3 ist Schluss."
echo "  5        -> der erfundene Header wirkt noch; Zeile 79 im Code pruefen."
echo
echo "Zweiter Nachweis, im Postfach:"
echo "  Jede durchgelassene Anfrage erzeugt eine Benachrichtigung an kontakt@."
echo "  Auto-Antworten an $ZIEL darf es aber nur EINE geben — alle Anfragen"
echo "  dieses Laufs nennen dieselbe Adresse."
