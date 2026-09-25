# CSV-Testdaten Mahnlauf

Alle Werte erfunden (BAUPLAN j): Tischlerei Beispiel GmbH, Kunden „Kunde Beispiel NN“,
IBANs `DE00 …` mit absichtlich falscher Prüfziffer, Rechnungsnummern im 9000er-Bereich.
Keine Datei stammt aus einem echten Konto.

| Datei | Zeichensatz | Zweck |
|---|---|---|
| `vorspann-soll-haben-iso.csv` | ISO-8859-1 | Vorspann (Kopfzeile in Zeile 5), Soll/Haben-Spalte, Tausenderpunkt, Umlaute, Feld mit `;` in Anführungszeichen |
| `vorzeichen-utf8.csv` | UTF-8 | ohne Vorspann, Vorzeichen im Betrag, Dezimalpunkt, ISO-Datum, Bankreferenz |
| `kaputt-trennzeichen.csv` | UTF-8 | T12: Komma statt Semikolon |
| `kaputt-spalte-fehlt.csv` | UTF-8 | T12: Spalte „Zweck“ fehlt |
| `kaputt-betrag.csv` | UTF-8 | T12: Betrag „12,3x“ in Zeile 3 |
| `kaputt-betrag-kontrolle.csv` | UTF-8 | Kontrolle zu `kaputt-betrag.csv`, nur der Betrag lesbar |
| `kaputt-umlaut-iso.csv` | ISO-8859-1 | T12: Umlaut in ISO-8859-1, gelesen mit Einstellung UTF-8 |
