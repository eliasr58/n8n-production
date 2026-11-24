#!/usr/bin/env python3
"""Prueft, dass die Kernlogik in kern/ byte-gleich in den Code-Nodes der Exporte steht.

    python3 tools/pruefe-kern.py [workflows-ordner]

Fuer jeden Ordner workflows/<name>/ mit kern/*.js werden alle Exporte workflows/<name>/workflows/*.json gelesen,
auch die inline eingebetteten Unterlaeufe (executeWorkflow mit source "parameter"). Ein Code-Node mit der Marke
"// ==== Treiber, nicht Teil des Kerns" traegt vor der Marke eine Folge ganzer Kernmodule, mit "\\n" verbunden.

Geprueft wird in beide Richtungen:
  1. Jeder Kernteil eines Code-Nodes besteht genau aus ganzen Modulen von kern/ (sonst: Abweichung im Node).
  2. Jedes Modul in kern/ steht in mindestens einem Code-Node (sonst: Modul fehlt in den Exporten).
Ein Workflow mit kern/, aber ohne Code-Node mit Marke, gilt als Fehler: ohne Gegenstand meldet ein Pruefer sonst gruen.

Exit 0: alles gleich. Exit 1: mindestens eine Abweichung, ein fehlendes Modul oder ein Ordner ohne Pruefgegenstand.
"""
import json, pathlib, sys

MARKE = "\n// ==== Treiber, nicht Teil des Kerns"


def zerlege(teil, module):
    """Kernteil -> Liste der Modulnamen, oder None, wenn er nicht genau aus ganzen Modulen besteht."""
    aus, pos = [], 0
    while pos < len(teil):
        treffer = [n for n, t in module.items() if teil.startswith(t, pos)]
        if not treffer:
            return None
        n = max(treffer, key=lambda x: len(module[x]))
        aus.append(n)
        pos += len(module[n])
        if pos < len(teil):
            if teil[pos] != "\n":
                return None
            pos += 1
    return aus


def code_nodes(nodes, pfad):
    for n in nodes:
        typ = n.get("type", "")
        par = n.get("parameters", {})
        if typ.endswith(".code") and MARKE in par.get("jsCode", ""):
            yield pfad + " / " + n["name"], par["jsCode"].split(MARKE)[0]
        if typ.endswith(".executeWorkflow") and par.get("source") == "parameter":
            sub = json.loads(par["workflowJson"])
            yield from code_nodes(sub.get("nodes", []), pfad + " / " + n["name"] + " (inline)")


def pruefe(ordner):
    """Gibt (zeilen, fehler) fuer einen Workflow-Ordner zurueck."""
    module = {p.name: p.read_bytes().decode("utf-8") for p in sorted((ordner / "kern").glob("*.js"))}
    zeilen, fehler, benutzt, anzahl = [], 0, set(), 0
    leer = [n for n, t in module.items() if not t]
    for n in leer:
        zeilen.append(f"  FEHLER leeres Modul: kern/{n}")
        fehler += 1
    module = {n: t for n, t in module.items() if t}
    for export in sorted((ordner / "workflows").glob("*.json")):
        wf = json.loads(export.read_text(encoding="utf-8"))
        for pfad, teil in code_nodes(wf.get("nodes", []), export.name):
            anzahl += 1
            liste = zerlege(teil, module)
            if liste is None:
                zeilen.append(f"  UNGLEICH {pfad}: Kernteil besteht nicht aus ganzen Modulen von kern/")
                fehler += 1
            else:
                benutzt.update(liste)
                zeilen.append(f"  gleich   {pfad}: {', '.join(liste)}")
    if anzahl == 0:
        zeilen.append("  FEHLER kein Code-Node mit Kernteil in workflows/*.json")
        fehler += 1
    for n in sorted(set(module) - benutzt):
        zeilen.append(f"  FEHLT    kern/{n} steht in keinem Code-Node")
        fehler += 1
    zeilen.append(f"  {len(module)} Module, {len(benutzt)} in Code-Nodes, {anzahl} Code-Nodes mit Kernteil, "
                  f"{fehler} Fehler")
    return zeilen, fehler


def main(argv):
    wurzel = pathlib.Path(argv[0]) if argv else pathlib.Path(__file__).resolve().parent.parent / "workflows"
    ordner = sorted(p for p in wurzel.iterdir() if (p / "kern").is_dir())
    if not ordner:
        print(f"Kein Workflow mit kern/ unter {wurzel}", file=sys.stderr)
        return 1
    gesamt = 0
    for o in ordner:
        zeilen, fehler = pruefe(o)
        print(o.name)
        print("\n".join(zeilen))
        gesamt += fehler
    print(f"{len(ordner)} Workflows mit kern/ geprueft, {gesamt} Fehler")
    return 1 if gesamt else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
