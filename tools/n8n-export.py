#!/usr/bin/env python3
"""Exportiert Workflows ueber die Public API und bereinigt sie.

Rein lesend. Jeder Workflow landet bereinigt als workflows/<name>/workflow.json.
Die Rohfassung (sie kann Webhook-Pfade, Ping-URLs und Mailadressen tragen) liegt
nur in einem temporaeren Verzeichnis und ist nach dem Lauf geloescht.

    python3 tools/n8n-export.py https://n8n.example.eu
    python3 tools/n8n-export.py https://n8n.example.eu --id <workflow-id> \\
        --ziel workflows/kontaktformular/workflow.json

--id    nur diese Workflows (mehrfach moeglich); ohne --id alle der Instanz
--ziel  Basisordner, darunter <name>/workflow.json (Vorgabe: workflows);
        mit genau einer --id auch direkt der Dateipfad (Endung .json).
        Relative Angaben gelten ab der Wurzel des Repositorys.
"""
import argparse, base64, getpass, json, os, pathlib, re, subprocess, sys, tempfile
import urllib.error, urllib.request

BASIC = {"wert": None}

def _basic_setzen():
    if BASIC["wert"] is not None:
        return
    b = os.environ.get("N8N_UI_USER") or input("  basic_auth Benutzer: ").strip()
    p = os.environ.get("N8N_UI_PASS") or getpass.getpass("  basic_auth Passwort: ")
    BASIC["wert"] = "Basic " + base64.b64encode(f"{b}:{p}".encode()).decode("ascii")

def hole(basis, pfad, key, _zweiter=False):
    kopf = {"X-N8N-API-KEY": key, "Accept": "application/json"}
    if BASIC["wert"]:
        kopf["Authorization"] = BASIC["wert"]
    req = urllib.request.Request(basis.rstrip("/") + pfad, headers=kopf)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401 and e.headers.get("WWW-Authenticate") and not _zweiter:
            _basic_setzen()
            return hole(basis, pfad, key, _zweiter=True)
        print(f"  HTTP {e.code} auf {pfad}", file=sys.stderr)
        return None

def dateiname(name):
    s = name.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "workflow"

def zielpfade(liste, ziel, wurzel):
    """Ordnet jedem Workflow seine Zieldatei zu."""
    basis = pathlib.Path(ziel)
    if not basis.is_absolute():
        basis = wurzel / basis
    if basis.suffix == ".json":
        if len(liste) != 1:
            sys.exit("--ziel mit Dateiname geht nur mit genau einer --id.")
        return [(liste[0], basis)]
    return [(w, basis / dateiname(w.get("name") or w.get("id")) / "workflow.json") for w in liste]

def main():
    a = argparse.ArgumentParser(description="n8n-Workflows exportieren und bereinigen")
    a.add_argument("basis", help="Basis-URL der Instanz, z. B. https://n8n.example.eu")
    a.add_argument("--id", action="append", default=[], help="nur diesen Workflow (mehrfach moeglich)")
    a.add_argument("--ziel", default="workflows", help="Basisordner oder, mit einer --id, Zieldatei")
    arg = a.parse_args()

    key = os.environ.get("N8N_API_KEY") or getpass.getpass("n8n-API-Schluessel: ")
    if not key.strip():
        sys.exit("Kein Schluessel eingegeben.")

    wurzel = pathlib.Path(__file__).resolve().parent.parent
    antwort = hole(arg.basis, "/api/v1/workflows?limit=250", key)
    if antwort is None:
        sys.exit("Abruf fehlgeschlagen.")
    liste = antwort.get("data", [])
    if arg.id:
        gefunden = {w.get("id") for w in liste}
        fehlt = [i for i in arg.id if i not in gefunden]
        if fehlt:
            sys.exit("Nicht gefunden: " + ", ".join(fehlt))
        liste = [w for w in liste if w.get("id") in arg.id]
    print(f"\n{len(liste)} Workflow(s) zum Export.\n")

    # Die Rohfassung lebt nur so lange wie dieser Lauf (Arbeitsregel 17).
    with tempfile.TemporaryDirectory(prefix="n8n-export-") as roh:
        for w, datei in zielpfade(liste, arg.ziel, wurzel):
            rohdatei = pathlib.Path(roh) / "roh.json"
            rohdatei.write_text(json.dumps(w, ensure_ascii=False, indent=2), encoding="utf-8")
            datei.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run([sys.executable, str(wurzel / "tools" / "sanitize.py"),
                                str(rohdatei), str(datei)])
            rohdatei.unlink()
            if r.returncode != 0:
                sys.exit(f"Abgebrochen bei {w.get('id')}: Sanitizer meldet Restverdacht, nichts geschrieben.")

    print("\nJetzt pruefen, bevor committet wird:")
    print("  python3 tools/sanitize.py --pruefen workflows/*/workflow.json")

if __name__ == "__main__":
    main()
