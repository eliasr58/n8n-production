#!/usr/bin/env python3
"""Bereinigt n8n-Workflow-Exporte, Skripte und Configs fuer die Veroeffentlichung.

Ersetzt bzw. entfernt: Credential-IDs, Server-IP (IPv4 und IPv6), lokale Pfade,
Tokens und API-Keys (JWT, Bearer/Basic, Anbieter-Praefixe), Werte hinter
geheimen Schluesselnamen, Passwoerter in Connection-Strings, lange Hex-Werte,
Healthchecks-Ping-URLs, Storage-Box-Zugaenge, private Mailadressen,
Notion-IDs, Plausible-Script-ID, Impressumsangaben, n8n-Laufzeitfelder.

Fail-closed: Nach der Ersetzung prueft ein zweiter, breiter gefasster Satz von
Mustern das Ergebnis. Bleibt ein Verdacht, wird NICHTS geschrieben, die
Fundstelle (Datei:Zeile, Wert maskiert) geht nach stderr, Exit 1.

Aufruf:  python3 tools/sanitize.py <quelle> <ziel>
         python3 tools/sanitize.py --pruefen <datei> [<datei> ...]
Dateien mit Endung .json werden als n8n-JSON behandelt, alle anderen als Text.
Exit: 0 sauber, 1 Restverdacht, 2 Aufruf- oder Lesefehler.
"""
import json, re, sys

# Generisches Muster statt fester Adresse: eine hier eingetragene IP stuende
# im Klartext in genau dem Repository, das sie entfernen soll.
# Private Bereiche und Loopback bleiben stehen, sie dokumentieren die Bindung.
BEHALTEN = re.compile(r"^(127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)")
IPV4 = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")

# IPv6 mit optionalem Praefix. Die Lookarounds verhindern Treffer in
# Uhrzeiten (09:33:07 hat weder acht Gruppen noch "::") und in "std::x".
_H = r"[0-9A-Fa-f]{1,4}"
IPV6 = re.compile(
    rf"(?<![\w:.])(?:(?:{_H}:){{7}}{_H}|(?:{_H}:){{1,7}}:(?:{_H}(?::{_H}){{0,6}})?"
    rf"|:(?::{_H}){{1,7}})(?:/\d{{1,3}})?(?![\w:])")
IPV6_BEHALTEN = {"::", "::1"}

# Mailadressen, die ohnehin oeffentlich sind, im Wortlaut von roehrner.eu
# (Impressum und Datenschutz, abgerufen 17.09.2026). Jede andere Adresse unter
# roehrner.eu wird ersetzt. Dazu reine Beispiel-Domains.
FREIE_ADRESSEN = {"kontakt@roehrner.eu"}
FREIE_DOMAINS = {"example.org", "example.com", "example.net", "example.eu"}
EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b")

# Schluesselnamen, deren Wert nie veroeffentlicht wird. Endung statt Teilwort:
# "accessToken" ja, "tokenType" und "maxTokens" nein.
GEHEIMER_SCHLUESSEL = re.compile(
    r"(?i)(passwor[dt]|passwd|secret|token|api[_-]?key|authorization|"
    r"private[_-]?key|passphrase|access[_-]?key)$")

# key=value / key: 'value' in Text und in Code-Strings. Unquotierte Werte nur,
# wenn sie keinen Punkt tragen (sonst waere `token = response.data.token`
# betroffen) und eine Ziffer enthalten.
KV = re.compile(
    r"(?i)(?P<k>\b[\w.-]*(?:passwor[dt]|passwd|secret|token|api[_-]?key|passphrase|"
    r"private[_-]?key|access[_-]?key))(?P<sep>[\"']?\s*[:=]\s*)"
    r"(?:(?P<q>[\"'])(?P<vq>[^\"'\n]{4,}?)(?P=q)|(?P<vu>[A-Za-z0-9_+/=~!-]{8,})(?![\w.]))")


def _literal(v):
    """Ein Ausdruck, eine Variable, ein Pfad oder ein Platzhalter ist kein Geheimnis."""
    v = v.strip()
    return len(v) >= 4 and not v.startswith(("=", "{{", "$", "<", "/"))


def _kv(m):
    if m.group("vq") is not None:
        if not _literal(m.group("vq")):
            return m.group(0)
        return f"{m.group('k')}{m.group('sep')}{m.group('q')}<GEHEIM>{m.group('q')}"
    v = m.group("vu")
    if not _literal(v) or not re.search(r"\d", v):
        return m.group(0)
    return f"{m.group('k')}{m.group('sep')}<GEHEIM>"


def _ip(m):
    return m.group(0) if BEHALTEN.match(m.group(0)) else "<SERVER_IP>"


def _ip6(m):
    return m.group(0) if m.group(0) in IPV6_BEHALTEN else "<IPV6>"


def _mail_frei(m):
    return m.group(0).lower() in FREIE_ADRESSEN or m.group(1).lower() in FREIE_DOMAINS


def _mail(m):
    return m.group(0) if _mail_frei(m) else "<EMAIL>"


def _conn(m):
    return m.group(0) if not _literal(m.group(2)) else f"{m.group(1)}:<PASSWORT>@"


# Reihenfolge ist Absicht: URL- und Hostmuster vor UUID/E-Mail, JWT vor Bearer.
SUBS = [
    # Ganze URL, auch wenn ein frueherer Lauf die UUID schon als <NOTION_ID>
    # ersetzt hatte (so im Kontaktformular-Export vom 16.09.2026).
    (re.compile(r"https?://hc-ping\.com/[^\s\"')]+"), "<HC_PING_URL>"),
    (re.compile(r"\b[\w.-]+@u\d{5,}(?:-sub\d+)?\.your-storagebox\.de\b"), "<STORAGEBOX_ZUGANG>"),
    (re.compile(r"\bu\d{5,}(?:-sub\d+)?\.your-storagebox\.de\b"), "<STORAGEBOX_HOST>"),
    (re.compile(r"\bu\d{5,}(?:-sub\d+)?(?=@)"), "<STORAGEBOX_USER>"),
    (re.compile(r"\b([a-z][a-z0-9+.-]*://[^/\s:@<>\"']+):([^@\s/<>\"']+)@"), _conn),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?"), "<JWT>"),
    (re.compile(r"(?i)\b(Bearer|Basic)(\s+)(?=[A-Za-z0-9._~+/=-]*[0-9+/=])[A-Za-z0-9._~+/=-]{8,}"),
     r"\1\2<TOKEN>"),
    (re.compile(r"\b(?:n8n_api_|hv_)[A-Za-z0-9]{16,}"), "<API_KEY>"),
    (re.compile(r"\b(?:ghp_|github_pat_|glpat-|xox[abpr]-)[A-Za-z0-9_-]{16,}"), "<API_KEY>"),
    (IPV4, _ip),
    (IPV6, _ip6),
    (re.compile(r"/Users/[^/\s\"']+/"), "<LOKALER_PFAD>/"),
    (re.compile(r"pa-[A-Za-z0-9_-]{18,}"), "<PLAUSIBLE_SCRIPT_ID>"),
    # 32 Hex-Zeichen klein = Notion-ID (bisherige Bezeichnung). Lookarounds
    # statt \b: "_" ist ein Wortzeichen, "id_<hex>" hatte keine Wortgrenze.
    (re.compile(r"(?<![0-9A-Fa-f])[0-9a-f]{32}(?![0-9A-Fa-f])"), "<NOTION_ID>"),
    (re.compile(r"(?<![0-9A-Fa-f])[0-9a-fA-F]{32,}(?![0-9A-Fa-f])"), "<HEX_WERT>"),
    # Notion-IDs treten auch in Bindestrich-Schreibweise auf, etwa in
    # Fehlermeldungen. n8n-eigene Node-IDs haben dieselbe Form und werden
    # weiter unten gezielt ausgenommen, sonst waeren sie hier mit erfasst.
    (re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"),
     "<NOTION_ID>"),
    (re.compile(r"(secret_|ntn_)[A-Za-z0-9]{20,}"), "<NOTION_TOKEN>"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), "<API_KEY>"),
    (EMAIL, _mail),
    (KV, _kv),
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

ZUFALL = re.compile(
    r"(?<![A-Za-z0-9_+/=-])(?=[A-Za-z0-9_+/=-]{32,})(?=[A-Za-z0-9_+/=-]*[A-Z])"
    r"(?=[A-Za-z0-9_+/=-]*[a-z])(?=[A-Za-z0-9_+/=-]*\d)[A-Za-z0-9_+/=-]{32,}")
ZUMEISUNG = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(?!=)(.*)$")

# Restpruefung. Absichtlich BREITER als SUBS: ein Pruefer, der nur die eigenen
# Ersetzungen wiedererkennt, meldet nach jedem Lauf "sauber" (Arbeitsregel 25).
VERDACHT = [
    ("privater Schluessel", re.compile(r"-{5}BEGIN [A-Z ]*PRIVATE KEY")),
    ("JWT", re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
    ("Auth-Header", re.compile(r"(?i)\b(?:bearer|basic)\s+(?!<)(?=\S*\d)[A-Za-z0-9._~+/=-]{12,}")),
    ("Zugangsdaten in URL", re.compile(r"[a-z][a-z0-9+.-]*://[^/\s:@<>\"']+:(?!<)[^@\s/<>\"'{$]+@")),
    ("Healthchecks-URL", re.compile(r"hc-ping\.com/")),
    ("Storage Box", re.compile(r"your-storagebox\.de|\bu\d{5,}(?:-sub\d+)?@")),
    ("Anbieter-Praefix", re.compile(
        r"\b(?:n8n_api_|hv_|sk-|ntn_|secret_|ghp_|github_pat_|glpat-|xox[abpr]-|AKIA|AIza|"
        r"rk_live_|sk_live_|pk_live_|whsec_)[A-Za-z0-9_-]{12,}")),
    ("Hex-Wert", re.compile(r"(?<![0-9A-Fa-f])[0-9a-fA-F]{32,}(?![0-9A-Fa-f])")),
    ("Zufallswert", ZUFALL),
    ("IPv4", IPV4),
    ("IPv6", IPV6),
    ("E-Mail", EMAIL),
    ("Wert hinter geheimem Schluessel", KV),
]


def _harmlos(name, m):
    t = m.group(0)
    if name == "IPv4":
        return bool(BEHALTEN.match(t))
    if name == "IPv6":
        return t in IPV6_BEHALTEN
    if name == "E-Mail":
        return _mail_frei(m)
    if name == "Wert hinter geheimem Schluessel":
        return _kv(m) == t
    if name == "Zufallswert":
        # NAME=wert: nur der Wert zaehlt. Sonst ergeben Grossbuchstaben im
        # Namen und Ziffern im Wert zusammen einen "Zufallswert" — gemessen an
        # REPO=/opt/n8n/n8n-data/workflow-historie. Ein Wert, der mit "/"
        # beginnt, ist ein Pfad.
        z = ZUMEISUNG.match(t)
        wert = z.group(2) if z else t
        return wert.startswith("/") or not ZUFALL.fullmatch(wert)
    return False


def _maske(m):
    """Nur Lage und Laenge — auch die ersten Zeichen eines Geheimnisses sind eines."""
    return f"Spalte {m.start() + 1}, {len(m.group(0))} Zeichen"


def restpruefung(text, datei):
    funde = []
    for nr, zeile in enumerate(text.splitlines(), 1):
        for name, pat in VERDACHT:
            for m in pat.finditer(zeile):
                if not _harmlos(name, m):
                    funde.append(f"{datei}:{nr}: {name}: {_maske(m)}")
    return funde


def text_scrub(s):
    for pat, rep in SUBS:
        s = pat.sub(rep, s)
    return s


def _ist_node(d):
    """Ein n8n-Node hat immer type und position. Seine id ist instanzintern
    und harmlos — sie darf nicht als Notion-ID missverstanden werden."""
    return isinstance(d, dict) and "type" in d and "position" in d


def scrub(o):
    if isinstance(o, dict):
        node = _ist_node(o)
        # Name/Wert-Paare (Header, Query-Parameter): der Name entscheidet.
        paar = (isinstance(o.get("name"), str) and isinstance(o.get("value"), str)
                and GEHEIMER_SCHLUESSEL.search(o["name"]) and _literal(o["value"]))
        out = {}
        for k, v in o.items():
            if node and k == "id":
                out[k] = v
                continue
            if k == "credentials" and isinstance(v, dict):
                out[k] = {ct: {"name": cv.get("name", ct), "id": "<CREDENTIAL_ID>"}
                          for ct, cv in v.items()}
                continue
            if k == "webhookId":
                out[k] = "<WEBHOOK_ID>"
                continue
            if isinstance(v, str) and _literal(v) and (
                    GEHEIMER_SCHLUESSEL.search(k) or (paar and k == "value")):
                out[k] = "<GEHEIM>"
                continue
            out[k] = scrub(v)
        return out
    if isinstance(o, list):
        return [scrub(x) for x in o]
    if isinstance(o, str):
        return text_scrub(o)
    return o


def bereinigen(src):
    """Gibt den bereinigten Text zurueck."""
    roh = open(src, encoding="utf-8").read()
    if src.endswith(".json"):
        d = json.loads(roh)
        if isinstance(d, dict):
            d = {k: v for k, v in d.items() if k not in DROP_TOP}
        # Ohne Schlusszeilenumbruch, wie die bisherigen Exporte im Repo.
        return json.dumps(scrub(d), ensure_ascii=False, indent=2)
    return text_scrub(roh)


def main(argv):
    if len(argv) >= 2 and argv[0] == "--pruefen":
        funde = []
        for datei in argv[1:]:
            funde += restpruefung(open(datei, encoding="utf-8").read(), datei)
        for f in funde:
            print(f, file=sys.stderr)
        print(f"{len(argv) - 1} Datei(en) geprueft, {len(funde)} Verdacht")
        return 1 if funde else 0
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src, dst = argv
    try:
        neu = bereinigen(src)
    except (OSError, ValueError) as e:
        print(f"{src}: nicht lesbar: {e.__class__.__name__}", file=sys.stderr)
        return 2
    funde = restpruefung(neu, dst)
    if funde:
        for f in funde:
            print(f, file=sys.stderr)
        print(f"ABGEBROCHEN: {len(funde)} Verdacht nach der Bereinigung, {dst} nicht geschrieben",
              file=sys.stderr)
        return 1
    with open(dst, "w", encoding="utf-8") as f:
        f.write(neu)
    print(f"{src} -> {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
