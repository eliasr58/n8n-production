#!/usr/bin/env python3
"""Tests fuer tools/sanitize.py, ohne Abhaengigkeiten.

    python3 -m unittest discover -s tools/tests -v

n8n-interne IDs (Node, Bedingung, Zuweisung) werden am Ort erkannt, nicht an der
Form: dieselbe UUID ausserhalb dieser Orte wird weiter ersetzt.
"""
import copy, json, os, pathlib, sys, tempfile, unittest

WURZEL = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(WURZEL / "tools"))
import sanitize  # noqa: E402

# Der IF-Knoten aus "Mahnlauf – Offene Posten lesen", wie ihn die API liefert (26.09.2026).
IF_KNOTEN = {
    "parameters": {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [
                {
                    "id": "5a0f6c1e-0b1d-4d7e-9a53-2f1c0d6b9e01",
                    "leftValue": "={{ $json.weiter }}",
                    "rightValue": "",
                    "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                }
            ],
            "combinator": "and",
        },
        "options": {},
    },
    "name": "Quelle Sheet?",
    "type": "n8n-nodes-base.if",
    "typeVersion": 2.2,
    "position": [500, 300],
    "id": "8e7af461-dfbd-4a66-8651-9a5bc9a628a2",
}

# Ein Set-Knoten (Edit Fields) mit Zuweisung, IDs erfunden.
SET_KNOTEN = {
    "parameters": {
        "assignments": {
            "assignments": [
                {"id": "0c9d2a4e-6f1b-4c3d-8e7f-1a2b3c4d5e6f", "name": "stufe", "value": "={{ 1 }}",
                 "type": "number"}
            ]
        },
        "options": {},
    },
    "name": "Stufe setzen",
    "type": "n8n-nodes-base.set",
    "typeVersion": 3.4,
    "position": [700, 300],
    "id": "2f4e6d8c-1b3a-4957-8d6c-0e1f2a3b4c5d",
}

# Dieselbe Form an einem anderen Ort: eine Notion-Seite in einer URL.
NOTION_UUID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
HTTP_KNOTEN = {
    "parameters": {"url": f"https://api.notion.com/v1/pages/{NOTION_UUID}", "options": {}},
    "name": "Seite lesen",
    "type": "n8n-nodes-base.httpRequest",
    "typeVersion": 4.2,
    "position": [900, 300],
    "id": "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
}


def workflow(*knoten):
    return {"name": "Test", "nodes": [copy.deepcopy(k) for k in knoten], "connections": {}, "settings": {}}


class Bereinigen(unittest.TestCase):
    def lauf(self, wf):
        """Wie tools/n8n-export.py: Datei hinein, Datei heraus. Gibt Exit und Ergebnis (oder None) zurueck."""
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = os.path.join(tmp, "roh.json"), os.path.join(tmp, "aus.json")
            with open(src, "w", encoding="utf-8") as f:
                json.dump(wf, f)
            exit_ = sanitize.main([src, dst])
            if not os.path.exists(dst):
                return exit_, None
            with open(dst, encoding="utf-8") as f:
                return exit_, json.load(f)

    def test_bedingungs_id_des_if_knotens_bleibt(self):
        exit_, aus = self.lauf(workflow(IF_KNOTEN))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0]["parameters"]["conditions"]["conditions"][0]["id"],
                         "5a0f6c1e-0b1d-4d7e-9a53-2f1c0d6b9e01")

    def test_if_knoten_unveraendert(self):
        exit_, aus = self.lauf(workflow(IF_KNOTEN))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0], IF_KNOTEN)

    def test_zuweisungs_id_bleibt(self):
        exit_, aus = self.lauf(workflow(SET_KNOTEN))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0], SET_KNOTEN)

    def test_node_id_bleibt(self):
        exit_, aus = self.lauf(workflow(HTTP_KNOTEN))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0]["id"], HTTP_KNOTEN["id"])

    def test_dieselbe_form_an_anderem_ort_wird_ersetzt(self):
        # Gegenprobe: die Ausnahme haengt am Ort, nicht an der UUID-Form.
        exit_, aus = self.lauf(workflow(HTTP_KNOTEN))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0]["parameters"]["url"], "https://api.notion.com/v1/pages/<NOTION_ID>")
        self.assertNotIn(NOTION_UUID, json.dumps(aus))

    def test_id_feld_ausserhalb_der_liste_wird_ersetzt(self):
        # Eine "id" im Knoten, die nicht in conditions.conditions[] oder assignments.assignments[] steht.
        k = copy.deepcopy(HTTP_KNOTEN)
        k["parameters"]["options"] = {"id": NOTION_UUID}
        exit_, aus = self.lauf(workflow(k))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0]["parameters"]["options"]["id"], "<NOTION_ID>")

    def test_geheimnis_am_id_ort_wird_nie_geschrieben(self):
        # Die Ortsausnahme darf die Restpruefung nicht aushebeln: entweder ersetzt oder nicht geschrieben.
        # Zur Laufzeit zusammengesetzt, damit kein schluesselfoermiges Literal im Repository steht.
        falsch = "sk-" + "ant-api03-" + "ERFUNDENx" * 3 + "0123"
        k = copy.deepcopy(IF_KNOTEN)
        k["parameters"]["conditions"]["conditions"][0]["id"] = falsch
        exit_, aus = self.lauf(workflow(k))
        self.assertTrue(aus is None or falsch not in json.dumps(aus))


# Nacharbeit 27.09.2026 (Pruefung durch Cowork): der eigene n8n-Host stand unter betrieb/, eine Rufnummer in
# betrieb/ops/smoke-test.sh. Rufnummern hier nur aus dem Bereich, den die Bundesnetzagentur fuer Film und Fernsehen
# vergibt (030 23125 xxx) - Form einer echten Nummer, keine echte.
KORPUS = WURZEL / "tools" / "tests" / "fixtures" / "korpus.json"
# Der echte Host zur Laufzeit zusammengesetzt, damit er im Repository nicht als Literal steht.
HOST = "n8n." + sanitize.EIGENE_DOMAIN
FIKTIV = ["030 23125777", "030/23125777", "030-23125 777", "(030) 23125 778", "+49 30 23125779", "+4930 23125779",
          "+49 (0)30 23125 780", "+49 30/23125-781"]
PLATZHALTER = ["0000 000000", "+49 000 0000011", "(0000) 000 033", "0000/0000022"]
KEINE_NUMMER = ["Lauf um 09:33:07 Uhr", "am 01.10.2025", "Stand 2026-09-27", "n8n 2.34.4", "Port 5678",
                "Zeitplan 0 8 * * 1-5", "IBAN DE00 0000 0000 0000 0000 00", "Rechnung RE-2025-9001", "Anlage W-9001/2026-10",
                "PLZ 00000 Musterstadt", "Version 0.8.18"]


class HostUndRufnummer(unittest.TestCase):
    def test_eigener_n8n_host_wird_ersetzt(self):
        self.assertEqual(sanitize.text_scrub("curl -sI https://" + HOST + "/"), "curl -sI https://n8n.example.eu/")
        self.assertEqual(sanitize.text_scrub("#   DOMAIN        " + HOST), "#   DOMAIN        n8n.example.eu")
        self.assertEqual(sanitize.text_scrub("DOMAIN n8n-alt.roehrner.eu"), "DOMAIN n8n-alt.example.eu")

    def test_oeffentliche_namen_bleiben(self):
        for t in ("https://www.roehrner.eu", "stats.roehrner.eu", "roehrner.eu/api/kontakt", "kontakt@roehrner.eu",
                  "/usr/local/bin/roehrner-backup.sh"):
            self.assertEqual(sanitize.text_scrub(t), t)
            self.assertEqual(sanitize.restpruefung(t, "x"), [])

    def test_restpruefung_meldet_eigenen_n8n_host(self):
        self.assertEqual(len(sanitize.restpruefung("URL=https://" + HOST + "/webhook/REDACTED", "x")), 1)

    def test_deutsche_rufnummer_wird_ersetzt(self):
        for t in FIKTIV:
            self.assertEqual(sanitize.text_scrub("Tel. " + t + " (Test)"), "Tel. <TELEFON> (Test)", t)

    def test_restpruefung_meldet_rufnummer(self):
        for t in FIKTIV:
            self.assertEqual(len(sanitize.restpruefung("Tel. " + t, "x")), 1, t)

    def test_platzhalter_bleiben(self):
        for t in PLATZHALTER:
            self.assertEqual(sanitize.text_scrub("Tel. " + t), "Tel. " + t)
            self.assertEqual(sanitize.restpruefung("Tel. " + t, "x"), [], t)

    def test_keine_fehltreffer(self):
        for t in KEINE_NUMMER:
            self.assertEqual(sanitize.text_scrub(t), t)
            self.assertEqual(sanitize.restpruefung(t, "x"), [], t)

    def test_korpus_ohne_eigenen_host_und_nummer(self):
        with tempfile.TemporaryDirectory() as tmp:
            dst = os.path.join(tmp, "aus.json")
            self.assertEqual(sanitize.main([str(KORPUS), dst]), 0)
            aus = open(dst, encoding="utf-8").read()
        self.assertNotIn("n8n-test." + sanitize.EIGENE_DOMAIN, aus)
        self.assertNotIn("n8n-alt.roehrner.eu", aus)
        self.assertNotIn("23125", aus)
        self.assertIn("+49 000 0000011", aus)
        self.assertIn("stats.roehrner.eu", aus)


# Nacharbeit 29.09.2026 (Befund 1 aus Baustein 10 der Bewertungsantworten): Ein Inline-Unterlauf (executeWorkflow, Quelle
# "Define Below") steht als JSON-Zeichenkette in parameters.workflowJson. Der Bereiniger sah darin nur Text: Credential-IDs
# blieben stehen, Bedingungs-IDs wurden <NOTION_ID>. Er wird jetzt geparst und wie ein Workflow bereinigt.
BLATT_KNOTEN = {
    "parameters": {"operation": "update", "options": {}},
    "name": "Zellen schreiben",
    "type": "n8n-nodes-base.googleSheets",
    "typeVersion": 4.7,
    "position": [300, 300],
    "id": "3c2b1a0f-9e8d-4c7b-8a6f-5e4d3c2b1a0f",
    "credentials": {"googleSheetsOAuth2Api": {"id": "ErfundenCred0001", "name": "Google Sheets Test"}},
}
# Ein Knoten ohne UUID und ohne Credential: am Inline-JSON gibt es nichts zu ersetzen.
WARTEN_KNOTEN = {"parameters": {"amount": 1}, "name": "Warten", "type": "n8n-nodes-base.wait", "typeVersion": 1.1,
                 "position": [0, 0], "id": "warten-1"}


def kompakt(o):
    """So legt n8n den Unterlauf in den Bewertungsantworten ab."""
    return json.dumps(o, ensure_ascii=False)


def inline_knoten(workflow_json):
    return {"parameters": {"source": "parameter", "workflowJson": workflow_json, "options": {}},
            "name": "Freigabe veröffentlichen", "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.3,
            "position": [1100, 300], "id": "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d"}


def unterlauf(aus):
    return json.loads(aus["nodes"][0]["parameters"]["workflowJson"])


class EingebetteterUnterlauf(unittest.TestCase):
    lauf = Bereinigen.lauf

    def test_bedingungs_id_im_inline_json_bleibt(self):
        exit_, aus = self.lauf(workflow(inline_knoten(kompakt({"nodes": [IF_KNOTEN], "connections": {}}))))
        self.assertEqual(exit_, 0)
        self.assertEqual(unterlauf(aus)["nodes"][0]["parameters"]["conditions"]["conditions"][0]["id"],
                         "5a0f6c1e-0b1d-4d7e-9a53-2f1c0d6b9e01")

    def test_credential_id_im_inline_json_wird_ersetzt(self):
        exit_, aus = self.lauf(workflow(inline_knoten(kompakt({"nodes": [BLATT_KNOTEN], "connections": {}}))))
        self.assertEqual(exit_, 0)
        self.assertEqual(unterlauf(aus)["nodes"][0]["credentials"]["googleSheetsOAuth2Api"]["id"], "<CREDENTIAL_ID>")
        self.assertNotIn("ErfundenCred0001", json.dumps(aus))

    def test_andere_uuid_im_inline_json_wird_ersetzt(self):
        # Kontrolle: die Ortsregel gilt im Unterlauf wie im Workflow, dieselbe Form an anderem Ort wird ersetzt.
        exit_, aus = self.lauf(workflow(inline_knoten(kompakt({"nodes": [HTTP_KNOTEN], "connections": {}}))))
        self.assertEqual(exit_, 0)
        self.assertEqual(unterlauf(aus)["nodes"][0]["parameters"]["url"], "https://api.notion.com/v1/pages/<NOTION_ID>")
        self.assertNotIn(NOTION_UUID, json.dumps(aus))

    def test_form_des_inline_json_bleibt(self):
        # Kontrolle: ohne Ersetzung bleibt die Zeichenkette byte-gleich, kompakt wie eingerueckt.
        for s in (kompakt({"nodes": [WARTEN_KNOTEN], "connections": {}}),
                  json.dumps({"nodes": [WARTEN_KNOTEN], "connections": {}}, ensure_ascii=False, indent=2)):
            exit_, aus = self.lauf(workflow(inline_knoten(s)))
            self.assertEqual(exit_, 0)
            self.assertEqual(aus["nodes"][0]["parameters"]["workflowJson"], s)

    def test_unlesbares_inline_json_wie_bisher(self):
        # Kontrolle: laesst es sich nicht parsen, wird es wie bisher als Text bereinigt; die Restpruefung bleibt dahinter.
        s = "{ kaputt https://hc-ping.com/abc-def"
        exit_, aus = self.lauf(workflow(inline_knoten(s)))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0]["parameters"]["workflowJson"], "{ kaputt <HC_PING_URL>")


# Nacharbeit 29.09.2026 (Befund 2 aus Baustein 10 der Bewertungsantworten): der Kommentar aus maskierung.js nennt ein
# erfundenes Strassenbeispiel; der Bereiniger ersetzte es als Anschrift. Strassennamen mit "Muster" oder "Beispiel" sind
# Platzhalter wie die Beispiel-Domains; jede andere Anschrift wird weiter ersetzt, auch in einem Kommentar.
KOMMENTAR = ('// "am Musterweg 1 war" wurde "am <ANSCHRIFT>war"). Kontakt -> Platzhalter, Reihenfolge Mail, IBAN, Telefon, '
             'Anschrift, PLZ/Ort.\nvar x = 1;')


def code_knoten(js):
    return {"parameters": {"jsCode": js}, "name": "Eingang prüfen", "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [200, 300], "id": "6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b"}


class Strassenbeispiel(unittest.TestCase):
    lauf = Bereinigen.lauf

    def test_strassenbeispiel_im_kommentar_bleibt(self):
        exit_, aus = self.lauf(workflow(code_knoten(KOMMENTAR)))
        self.assertEqual(exit_, 0)
        self.assertEqual(aus["nodes"][0]["parameters"]["jsCode"], KOMMENTAR)

    def test_platzhalter_strassen_bleiben(self):
        for t in ("Musterstraße 12, 12345 Musterstadt", "Beispielweg 3a", "am Musterplatz 7 vorbei"):
            self.assertEqual(sanitize.text_scrub(t), t)

    def test_echte_anschrift_wird_ersetzt(self):
        self.assertEqual(sanitize.text_scrub("Lieferung an Hauptstraße 5, 12345 Neustadt"),
                         "Lieferung an <ANSCHRIFT>, <PLZ_ORT>")

    def test_echte_anschrift_im_kommentar_wird_ersetzt(self):
        exit_, aus = self.lauf(workflow(code_knoten("// an Hauptstraße 5 liefern\nvar x = 1;")))
        self.assertEqual(exit_, 0)
        self.assertNotIn("Hauptstraße", aus["nodes"][0]["parameters"]["jsCode"])
        self.assertIn("<ANSCHRIFT>", aus["nodes"][0]["parameters"]["jsCode"])


if __name__ == "__main__":
    unittest.main()
