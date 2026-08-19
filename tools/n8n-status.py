#!/usr/bin/env python3
"""Ist-Stand der n8n-Instanz: Welche Workflows gibt es, welche sind aktiv,
wann liefen sie zuletzt und mit welchem Ergebnis.

Rein lesend. Der API-Schluessel wird verdeckt abgefragt und landet weder in
der Shell-History noch auf dem Bildschirm.

    python3 tools/n8n-status.py https://n8n.example.eu
"""
import base64, getpass, json, os, pathlib, sys, urllib.error, urllib.request
from datetime import datetime, timezone

# Vor der n8n-Oberflaeche steht in Caddy ein basic_auth. Die Public API liegt
# hinter derselben Schranke — ohne diesen Header kommt nur ein 401 zurueck.
BASIC = {"wert": None}

def _basic_setzen():
    if BASIC["wert"] is not None:
        return
    benutzer = os.environ.get("N8N_UI_USER")
    passwort = os.environ.get("N8N_UI_PASS")
    if not benutzer:
        print("\nDie Instanz verlangt zusaetzlich basic_auth (Caddy).")
        benutzer = input("  Benutzername: ").strip()
    if not passwort:
        passwort = getpass.getpass("  Passwort: ")
    roh = f"{benutzer}:{passwort}".encode("utf-8")
    BASIC["wert"] = "Basic " + base64.b64encode(roh).decode("ascii")

def hole(basis, pfad, key, _zweiter_versuch=False):
    kopf = {"X-N8N-API-KEY": key, "Accept": "application/json"}
    if BASIC["wert"]:
        kopf["Authorization"] = BASIC["wert"]
    req = urllib.request.Request(basis.rstrip("/") + pfad, headers=kopf)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # Wer weist ab? Caddy schickt bei basic_auth einen WWW-Authenticate-
        # Header, n8n bei fehlendem API-Schluessel nicht. Ohne diese
        # Unterscheidung sucht man den Fehler auf der falschen Ebene.
        auth_kopf = e.headers.get("WWW-Authenticate", "")
        if e.code == 401 and auth_kopf and not _zweiter_versuch:
            _basic_setzen()
            return hole(basis, pfad, key, _zweiter_versuch=True)
        leib = e.read().decode("utf-8", "replace")[:200]
        if e.code == 401:
            if auth_kopf:
                print("\n  401 von Caddy (basic_auth). Benutzername oder "
                      "Passwort stimmen nicht.", file=sys.stderr)
            else:
                print("\n  401 von n8n selbst — basic_auth ist also passiert.\n"
                      "  Der API-Schluessel fehlt, ist leer oder ungueltig.",
                      file=sys.stderr)
        else:
            print(f"  HTTP {e.code} auf {pfad}: {leib}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  Fehler auf {pfad}: {e}", file=sys.stderr)
        return None

def alter(iso):
    if not iso:
        return "—"
    try:
        t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    d = datetime.now(timezone.utc) - t
    s = int(d.total_seconds())
    if s < 3600:   return f"vor {s//60} min"
    if s < 86400:  return f"vor {s//3600} h"
    return f"vor {s//86400} Tagen"

def main():
    if len(sys.argv) < 2:
        sys.exit("Basis-URL angeben, z. B. https://n8n.example.eu")
    basis = sys.argv[1]
    key = os.environ.get("N8N_API_KEY") or getpass.getpass("n8n-API-Schluessel: ")
    if not key.strip():
        sys.exit("Kein Schluessel eingegeben. In n8n unter Settings -> n8n API "
                 "einen erzeugen.")

    roh = pathlib.Path(__file__).resolve().parent.parent / ".rohdaten"
    roh.mkdir(exist_ok=True)

    wf = hole(basis, "/api/v1/workflows?limit=250", key)
    if wf is None:
        sys.exit("Abruf fehlgeschlagen. Schluessel und URL pruefen.")
    liste = wf.get("data", [])
    (roh / "workflows-roh.json").write_text(
        json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{len(liste)} Workflows auf {basis}\n")
    print(f"{'Workflow':<34} {'aktiv':<6} {'Trigger':<22} {'letzter Lauf':<16} Ergebnis")
    print("-" * 100)

    befund = []
    for w in sorted(liste, key=lambda x: (not x.get("active"), x.get("name", ""))):
        wid = w.get("id")
        name = (w.get("name") or "")[:33]
        aktiv = "ja" if w.get("active") else "NEIN"
        trigger = ", ".join(sorted({
            n.get("type", "").replace("n8n-nodes-base.", "")
            for n in w.get("nodes", [])
            if any(t in n.get("type", "").lower()
                   for t in ("webhook", "trigger", "cron", "schedule"))
        })) or "—"

        ex = hole(basis, f"/api/v1/executions?workflowId={wid}&limit=5&includeData=false", key)
        laeufe = (ex or {}).get("data", [])
        if laeufe:
            l = laeufe[0]
            status = l.get("status") or ("beendet" if l.get("finished") else "offen")
            wann = alter(l.get("startedAt") or l.get("createdAt"))
            fehler = sum(1 for x in laeufe if x.get("status") == "error")
            ergebnis = status + (f"  ({fehler}/{len(laeufe)} Fehler)" if fehler else "")
        else:
            wann, ergebnis = "—", "nie ausgefuehrt"

        print(f"{name:<34} {aktiv:<6} {trigger[:21]:<22} {wann:<16} {ergebnis}")
        befund.append({"id": wid, "name": w.get("name"), "aktiv": w.get("active"),
                       "letzter_lauf": wann, "ergebnis": ergebnis})

    (roh / "status.json").write_text(
        json.dumps(befund, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nRohdaten in .rohdaten/ (nicht versioniert).")

if __name__ == "__main__":
    main()
