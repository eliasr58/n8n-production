#!/usr/bin/env bash
set -euo pipefail
ANZAHL=$(docker exec n8n-postgres-1 psql -U n8n -d crm -tAc "with weg as (delete from kontaktanfragen where eingegangen_am < now() - interval '6 months' returning 1) select count(*) from weg")
echo "Geloescht: $ANZAHL Anfragen aelter als sechs Monate"
