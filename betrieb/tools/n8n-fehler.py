#!/usr/bin/env python3
"""Zeigt die fehlgeschlagenen Ausfuehrungen mit Node und Fehlermeldung.

Rein lesend. Zugangsdaten kommen aus der Umgebung (N8N_API_KEY, N8N_UI_USER,
N8N_UI_PASS) oder werden verdeckt abgefragt.

    python3 betrieb/tools/n8n-fehler.py https://n8n.example.eu [anzahl]
"""
import base64, getpass, json, os, pathlib, sys, urllib.error, urllib.request

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
    except Exception as e:
        print(f"  Fehler auf {pfad}: {e}", file=sys.stderr)
        return None

def entflachten(arr):
    """n8n legt Ausfuehrungsdaten im 'flatted'-Format ab: eine flache Liste,
    in der jeder String innerhalb eines Objekts ein Index auf diese Liste ist.
    Ohne diese Aufloesung sieht man nur Zahlen statt Fehlermeldungen."""
    cache = {}
    def bau(i):
        if i in cache:
            return cache[i]
        v = arr[i]
        if isinstance(v, dict):
            out = {}; cache[i] = out
            for k, val in v.items():
                out[k] = bau(int(val)) if isinstance(val, str) and val.lstrip("-").isdigit() else val
            return out
        if isinstance(v, list):
            out = []; cache[i] = out
            for val in v:
                out.append(bau(int(val)) if isinstance(val, str) and val.lstrip("-").isdigit() else val)
            return out
        cache[i] = v
        return v
    return bau(0)

def daten_lesen(d):
    if isinstance(d, str):
        try:
            d = json.loads(d)
        except json.JSONDecodeError:
            return None
    if isinstance(d, list) and d and isinstance(d[0], (dict, list)):
        try:
            return entflachten(d)
        except Exception:
            return None
    return d if isinstance(d, dict) else None

def main():
    if len(sys.argv) < 2:
        sys.exit("Basis-URL angeben.")
    basis = sys.argv[1]
    anzahl = int(sys.argv[2]) if len(sys.argv) > 2 else 15
    key = os.environ.get("N8N_API_KEY") or getpass.getpass("n8n-API-Schluessel: ")
    if not key.strip():
        sys.exit("Kein Schluessel eingegeben.")

    liste = hole(basis, f"/api/v1/executions?status=error&limit={anzahl}&includeData=false", key)
    if liste is None:
        sys.exit("Abruf fehlgeschlagen.")
    fehler = liste.get("data", [])
    if not fehler:
        print("\nKeine fehlgeschlagenen Ausfuehrungen im abgefragten Fenster.")
        return

    print(f"\n{len(fehler)} fehlgeschlagene Ausfuehrungen\n" + "=" * 78)
    sammlung = []
    for e in fehler:
        eid = e.get("id")
        detail = hole(basis, f"/api/v1/executions/{eid}?includeData=true", key) or {}
        d = daten_lesen(detail.get("data"))
        rd = (d or {}).get("resultData", {}) if isinstance(d, dict) else {}
        err = rd.get("error") or {}
        node = err.get("node")
        nodename = node.get("name") if isinstance(node, dict) else (rd.get("lastNodeExecuted") or "—")
        meldung = err.get("message") or "(keine Meldung im Datensatz)"
        beschreibung = err.get("description") or ""

        print(f"\n#{eid}  {e.get('workflowName') or e.get('workflowId')}")
        print(f"  Zeit:    {e.get('startedAt')}")
        print(f"  Node:    {nodename}")
        print(f"  Meldung: {str(meldung)[:400]}")
        if beschreibung:
            print(f"  Detail:  {str(beschreibung)[:300]}")
        sammlung.append({"id": eid, "workflow": e.get("workflowName"),
                         "node": nodename, "meldung": str(meldung)[:400]})

    roh = pathlib.Path(__file__).resolve().parent.parent / ".rohdaten"
    roh.mkdir(exist_ok=True)
    (roh / "fehler.json").write_text(json.dumps(sammlung, ensure_ascii=False, indent=2),
                                     encoding="utf-8")
    print(f"\n\nZusammenfassung nach Node:")
    nach = {}
    for s in sammlung:
        nach.setdefault((s["workflow"], s["node"]), []).append(s["meldung"])
    for (wf, nd), m in sorted(nach.items(), key=lambda x: -len(x[1])):
        print(f"  {len(m):>2}x  {wf} / {nd}")
        print(f"        {m[0][:150]}")

if __name__ == "__main__":
    main()
