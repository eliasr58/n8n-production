#!/usr/bin/env bash
# Versioniert die n8n-Workflow-Definitionen in einem lokalen git-Repo.
# Liest nur (read-only-Transaktion in Postgres), startet keinen n8n-Prozess.
# pinData/staticData und Felder, die sich ohne inhaltliche Aenderung aendern
# (createdAt, updatedAt, versionId, versionCounter, activeVersionId,
# triggerCount), werden nicht exportiert. Commit nur bei Aenderung.
set -euo pipefail
umask 077

REPO=/opt/n8n/n8n-data/workflow-historie
JETZT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec 9>/run/roehrner-workflow-export.lock
flock -n 9 || { echo "Export laeuft bereits" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- Export: eine Abfrage, ein Schnappschuss ------------------------------
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' n8n-postgres-1 \
  psql -U n8n -d n8n -At -v ON_ERROR_STOP=1 > "$WORK/export.json" <<'SQL'
select json_build_object(
  'anzahl', (select count(*) from workflow_entity),
  'workflows', coalesce((
    select json_agg(t order by t.id) from (
      select w.id, w.name, w.active, w."isArchived", w.description,
             w."parentFolderId", w.nodes, w.connections, w.settings, w.meta,
             w."nodeGroups",
             coalesce((select json_agg(tg.name order by tg.name)
                         from workflows_tags wt
                         join tag_entity tg on tg.id = wt."tagId"
                        where wt."workflowId" = w.id), '[]'::json) as tags
        from workflow_entity w
    ) t), '[]'::json)
);
SQL

# --- Dateien: <id>_<slug>.json, stabil sortiert ---------------------------
python3 - "$WORK/export.json" "$WORK/neu" <<'PY'
import json, os, re, sys, unicodedata

quelle, ziel = sys.argv[1:3]
daten = json.load(open(quelle, encoding="utf-8"))
wfs = daten["workflows"]
if not wfs or daten["anzahl"] != len(wfs):
    sys.exit(f"Export unvollstaendig: {len(wfs)} von {daten['anzahl']}")

def slug(name):
    s = name.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60].strip("-") or "ohne-name"

os.makedirs(ziel)
namen = set()
for w in wfs:
    for feld in ("pinData", "staticData"):
        if feld in w:
            sys.exit(f"Feld {feld} im Export")
    datei = f"{w['id']}_{slug(w['name'])}.json"
    if not re.fullmatch(r"[A-Za-z0-9_-]+\.json", datei) or datei in namen:
        sys.exit(f"ungueltiger oder doppelter Dateiname: {datei}")
    namen.add(datei)
    with open(os.path.join(ziel, datei), "w", encoding="utf-8") as f:
        json.dump(w, f, sort_keys=True, indent=2, ensure_ascii=False)
        f.write("\n")
print(f"{len(namen)} Workflows exportiert")
PY

# --- Repo ------------------------------------------------------------------
if [ ! -d "$REPO/.git" ]; then
  install -d -m 700 -o root -g root "$REPO"
  git -C "$REPO" init -q -b main
  git -C "$REPO" config user.name "workflow-export"
  git -C "$REPO" config user.email "root@n8n-server"
fi

find "$REPO" -maxdepth 1 -name '*.json' -delete
cp "$WORK"/neu/*.json "$REPO"/
git -C "$REPO" add -A

if git -C "$REPO" diff --cached --quiet; then
  echo "Workflow-Export $JETZT: keine Aenderung"
  exit 0
fi

AENDERUNGEN=$(git -C "$REPO" diff --cached --name-status -M)
ANZAHL=$(printf '%s\n' "$AENDERUNGEN" | wc -l)
git -C "$REPO" commit -q -F - <<MSG
Workflow-Export $JETZT: $ANZAHL geaendert

$AENDERUNGEN
MSG
echo "Workflow-Export $JETZT: Commit $(git -C "$REPO" rev-parse --short HEAD), $ANZAHL geaendert"
printf '%s\n' "$AENDERUNGEN"
