#!/usr/bin/env python3
"""Exportiert alle Workflows ueber die Public API und bereinigt sie.

Rein lesend. Der Ist-Stand landet in workflows/, die Rohfassung in .rohdaten/
(nicht versioniert).

    python3 tools/n8n-export.py https://n8n.example.eu
"""
import base64, getpass, json, os, pathlib, re, subprocess, sys
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

def main():
    if len(sys.argv) < 2:
        sys.exit("Basis-URL angeben.")
    basis = sys.argv[1]
    key = os.environ.get("N8N_API_KEY") or getpass.getpass("n8n-API-Schluessel: ")
    if not key.strip():
        sys.exit("Kein Schluessel eingegeben.")

    wurzel = pathlib.Path(__file__).resolve().parent.parent
    ziel, roh = wurzel / "workflows", wurzel / ".rohdaten"
    ziel.mkdir(exist_ok=True); roh.mkdir(exist_ok=True)

    antwort = hole(basis, "/api/v1/workflows?limit=250", key)
    if antwort is None:
        sys.exit("Abruf fehlgeschlagen.")
    liste = antwort.get("data", [])
    print(f"\n{len(liste)} Workflows gefunden.\n")

    for w in liste:
        name = dateiname(w.get("name") or w.get("id"))
        rohdatei = roh / f"{name}.json"
        rohdatei.write_text(json.dumps(w, ensure_ascii=False, indent=2), encoding="utf-8")
        subprocess.run([sys.executable, str(wurzel / "tools" / "sanitize.py"),
                        str(rohdatei), str(ziel / f"{name}.json")], check=True)

    print("\nJetzt pruefen, bevor committet wird:")
    print("  grep -rInE '(api[-_]?key|token|secret|password|bearer)' workflows/")

if __name__ == "__main__":
    main()
