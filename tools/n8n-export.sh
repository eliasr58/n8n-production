#!/usr/bin/env bash
# Zieht den Ist-Stand aller Workflows ueber die n8n Public API und schickt
# jeden durch den Sanitizer. Rein lesend.
#
#   export N8N_API_KEY='...'          # n8n -> Settings -> API
#   ./tools/n8n-export.sh https://n8n.example.eu
#
# Warum ueber die API und nicht per Copy-Paste aus der Oberflaeche: der Export
# soll den Zustand abbilden, der laeuft, nicht den, an den man sich erinnert.

set -euo pipefail

BASE="${1:?Basis-URL angeben, z. B. https://n8n.example.eu}"
: "${N8N_API_KEY:?N8N_API_KEY nicht gesetzt}"

ZIEL="$(cd "$(dirname "$0")/.." && pwd)/workflows"
ROH="$(cd "$(dirname "$0")/.." && pwd)/.rohdaten"
mkdir -p "$ROH"

# -L ist Absicht: ohne Redirect-Verfolgung landet man bei einer Weiterleitung
# auf einer HTML-Seite und jq scheitert mit einer irrefuehrenden Meldung.
curl -sSL -H "X-N8N-API-KEY: $N8N_API_KEY" "$BASE/api/v1/workflows?limit=250" \
  > "$ROH/alle.json"

anzahl=$(jq '.data | length' < "$ROH/alle.json")
echo "$anzahl Workflows gefunden."

jq -c '.data[]' < "$ROH/alle.json" | while read -r wf; do
  id=$(jq -r '.id'   <<<"$wf")
  name=$(jq -r '.name' <<<"$wf" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-')
  echo "$wf" > "$ROH/$name-$id.json"
  python3 "$(dirname "$0")/sanitize.py" "$ROH/$name-$id.json" "$ZIEL/$name.json"
done

echo
echo "Vor dem Commit pruefen:"
echo "  grep -rInE '(api[-_]?key|token|secret|password|bearer)' workflows/"
