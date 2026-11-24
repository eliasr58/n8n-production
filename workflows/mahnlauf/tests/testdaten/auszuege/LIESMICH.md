# Test-Kontoauszüge Mahnlauf (Baustein 5)

Je Fall ein Ordner. Alle Werte erfunden (BAUPLAN j). CSV in ISO-8859-1 mit Vorspann, Kopfzeile in Zeile 5 und Spalte Referenz; `t12*` in UTF-8 (gelesen mit Zeichensatz UTF-8), `t12d-umlaut-iso.csv` absichtlich ISO-8859-1. `camt-kaputt.xml`: ein schließendes Tag falsch (`</Betrag>` statt `</Amt>`). `t11-voll` und `t11-teil` (Baustein 7): Auszug `grund` plus eine volle bzw. teilweise Zahlung auf RE-2026-9013. `ruhig` (Baustein 9): eine Gutschrift auf RE-2026-9001, keine Belastung.

Ordner ohne eigenen Test im Kern; sie gehören zu Fällen, die in n8n gelaufen sind (Testkatalog im
[README](../../../README.md#testabdeckung)):

- `t05b`: zwei Rechnungen über gleichen Betrag (T05 b). Eine Zahlung über 250,00 ohne Rechnungsnummer; 9006 und 9007 werden
  beide angehalten, keine wird verbucht.
- `frisch-ohne-zahlung`: Mengenbremse (T19). Ein frischer Auszug ohne Zahlungseingang, nur eine Belastung; der Stand gilt als
  frisch, keine Rechnung wird bezahlt.
- `ref-a`, danach `ref-b`: dieselbe Bankreferenz zweimal in einer Datei ergibt zwei Klärfälle „Bankreferenz doppelt“. Nach
  manueller Zuordnung auf 9002 bringt `ref-b` die Referenz ein drittes Mal; sie wird als „Referenz bereits vorhanden“ gemeldet,
  9002 zählt die Zahlung einmal. `ref-b-allein` ist die Kontrolle: dieselbe Buchung ohne Vorlauf wird automatisch verbucht.
- `t12`: kaputte CSV (T12). Der Fall liest den Ordner ohne `t12-gueltig.csv`: vier Dateien unlesbar, je mit Datei und Zeile,
  kein frischer Stand. Die Kontrolle liest ihn mit `t12-gueltig.csv`: frisch, 9016 bezahlt 600,00, die vier weiter unlesbar.
- `camt`: CAMT-Sammelbuchung (T15), dazu eine CSV im selben Ordner, die bei Auszugsformat CAMT nicht gelesen wird.
- `doppelt`: dieselbe Datei zweimal im Ordner; jede Buchung zählt einmal.
