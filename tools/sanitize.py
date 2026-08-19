#!/usr/bin/env python3
"""Bereinigt n8n-Workflow-Exporte und Configs fuer die Veroeffentlichung.

Ersetzt bzw. entfernt: Credential-IDs, Server-IP, lokale Pfade, API-Keys,
Notion-Datenbank-IDs, Plausible-Script-ID, n8n-interne Laufzeitfelder.

Aufruf:  python3 tools/sanitize.py <quelle.json> <ziel.json>
"""
import json, re, sys

# Generisches Muster statt fester Adresse: eine hier eingetragene IP stuende
# im Klartext in genau dem Repository, das sie entfernen soll.
# Private Bereiche und Loopback bleiben stehen, sie dokumentieren die Bindung.
BEHALTEN = re.compile(r"^(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)")

def _ip(m):
    return m.group(0) if BEHALTEN.match(m.group(0)) else "<SERVER_IP>"

SUBS = [
    (re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b"), _ip),
    (re.compile(r"/Users/[^/\s\"']+/"), "<LOKALER_PFAD>/"),
    (re.compile(r"pa-[A-Za-z0-9_-]{18,}"), "<PLAUSIBLE_SCRIPT_ID>"),
    (re.compile(r"\b[0-9a-f]{32}\b"), "<NOTION_ID>"),
    # Notion-IDs treten auch in Bindestrich-Schreibweise auf, etwa in
    # Fehlermeldungen. n8n-eigene Node-IDs haben dieselbe Form und werden
    # weiter unten gezielt ausgenommen, sonst waeren sie hier mit erfasst.
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"),
     "<NOTION_ID>"),
    (re.compile(r"(secret_|ntn_)[A-Za-z0-9]{20,}"), "<NOTION_TOKEN>"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), "<API_KEY>"),
    # Impressumsangaben aus Mailsignaturen. Sie sind nicht geheim, aber in
    # einem oeffentlichen Repository sind Anschrift, Mobilnummer und
    # USt-IdNr zusammen genau das Buendel, mit dem im Namen der Firma
    # gefaelschte Rechnungen gebaut werden. Fuer die Bauweise des Workflows
    # tragen sie nichts bei. Bewusst als Muster formuliert, nicht als feste
    # Werte — sonst stuenden die Daten in genau dem Skript, das sie
    # entfernen soll.
    (re.compile(r"\+\d{1,3}[\s/-]?[\d\s/-]{6,}\d"), "<TELEFON>"),
    (re.compile(r"\bDE\s?\d{9}\b"), "<UST_IDNR>"),
    # Getrennte Schreibweise ("<ANSCHRIFT>" wie "<ANSCHRIFT>") mit einem
    # optionalen Leerzeichen vor dem Grundwort.
    (re.compile(r"\b[A-ZÄÖÜ][\wäöüß-]*\s?(?:[Ss]tra(?:ss|ß)e|[Ss]tr\.|[Ww]eg|[Gg]asse|"
                r"[Pp]latz|[Aa]llee|[Rr]ing)\s+\d+\s?[a-z]?\b"),
     "<ANSCHRIFT>"),
    # Nur die PLZ, die direkt hinter einer erkannten Anschrift steht. Eine
    # freistehende fuenfstellige Zahl vor einem grossgeschriebenen Wort ist
    # sonst nicht von einer Postleitzahl zu unterscheiden — nachgewiesen an
    # einem Fehlalarm auf eine Byte-Angabe.
    (re.compile(r"(<ANSCHRIFT>[,\s]*)\d{5}\s+[A-ZÄÖÜ][a-zäöüß-]+\b"), r"\1<PLZ_ORT>"),
]
DROP_TOP = {"shared", "versionId", "activeVersionId", "versionCounter",
            "triggerCount", "sourceWorkflowId", "activeVersion", "staticData",
            "pinData", "isArchived", "meta", "createdAt", "updatedAt"}

def _ist_node(d):
    """Ein n8n-Node hat immer type und position. Seine id ist instanzintern
    und harmlos — sie darf nicht als Notion-ID missverstanden werden."""
    return isinstance(d, dict) and "type" in d and "position" in d

def scrub(o):
    if isinstance(o, dict):
        node = _ist_node(o)
        out = {}
        for k, v in o.items():
            if node and k == "id":
                out[k] = v
                continue
            if k == "credentials":
                out[k] = {ct: {"name": cv.get("name", ct), "id": "<CREDENTIAL_ID>"}
                          for ct, cv in v.items()}
                continue
            if k == "webhookId":
                out[k] = "<WEBHOOK_ID>"
                continue
            out[k] = scrub(v)
        return out
    if isinstance(o, list):
        return [scrub(x) for x in o]
    if isinstance(o, str):
        s = o
        for pat, rep in SUBS:
            s = pat.sub(rep, s)
        return s
    return o

def main(src, dst):
    d = json.load(open(src, encoding="utf-8"))
    if isinstance(d, dict):
        d = {k: v for k, v in d.items() if k not in DROP_TOP}
    d = scrub(d)
    json.dump(d, open(dst, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"{src} -> {dst}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
