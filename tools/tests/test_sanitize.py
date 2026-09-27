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
FIKTIV = ["030 23125777", "030/23125777", "030-23125 777", "(030) 23125 778", "+49 30 23125779", "+4930 23125779",
          "+49 (0)30 23125 780", "+49 30/23125-781"]
PLATZHALTER = ["0000 000000", "+49 000 0000011", "(0000) 000 033", "0000/0000022"]
KEINE_NUMMER = ["Lauf um 09:33:07 Uhr", "am 01.10.2025", "Stand 2026-09-27", "n8n 2.34.4", "Port 5678",
                "Zeitplan 0 8 * * 1-5", "IBAN DE00 0000 0000 0000 0000 00", "Rechnung RE-2025-9001", "Anlage W-9001/2026-10",
                "PLZ 00000 Musterstadt", "Version 0.8.18"]


class HostUndRufnummer(unittest.TestCase):
    def test_eigener_n8n_host_wird_ersetzt(self):
        self.assertEqual(sanitize.text_scrub("curl -sI https://n8n.roehrner.eu/"), "curl -sI https://n8n.example.eu/")
        self.assertEqual(sanitize.text_scrub("#   DOMAIN        n8n.roehrner.eu"), "#   DOMAIN        n8n.example.eu")
        self.assertEqual(sanitize.text_scrub("DOMAIN n8n-alt.roehrner.eu"), "DOMAIN n8n-alt.example.eu")

    def test_oeffentliche_namen_bleiben(self):
        for t in ("https://www.roehrner.eu", "stats.roehrner.eu", "roehrner.eu/api/kontakt", "kontakt@roehrner.eu",
                  "/usr/local/bin/roehrner-backup.sh"):
            self.assertEqual(sanitize.text_scrub(t), t)
            self.assertEqual(sanitize.restpruefung(t, "x"), [])

    def test_restpruefung_meldet_eigenen_n8n_host(self):
        self.assertEqual(len(sanitize.restpruefung("URL=https://n8n.roehrner.eu/webhook/REDACTED", "x")), 1)

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
        self.assertNotIn("n8n.roehrner.eu", aus)
        self.assertNotIn("n8n-alt.roehrner.eu", aus)
        self.assertNotIn("23125", aus)
        self.assertIn("+49 000 0000011", aus)
        self.assertIn("stats.roehrner.eu", aus)


if __name__ == "__main__":
    unittest.main()
