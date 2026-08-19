# Case-Study: Ein Kontaktformular, das man ernst nehmen kann

**Produktiv seit 18.08.2026** · Stand dieser Fassung: 19.08.2026

Ich verkaufe Handwerksbetrieben, dass ihnen keine Anfrage mehr verlorengeht.
Dann darf meiner eigenen Website das erst recht nicht passieren. Ein Formular,
das eine Mail auslöst, ist dafür zu wenig: Mail landet im Spam, ein SMTP-Ausfall
verschluckt die Anfrage rückstandslos, und nach sechs Monaten weiß niemand mehr,
wie viele Anfragen es überhaupt gab.

Diese Case-Study beschreibt, wie die Pipeline gebaut ist — und vor allem, an
welchen Stellen ich zuerst danebenlag.

---

## 1 · Der Weg einer Anfrage

```
Browser (roehrner.eu)
   │  POST /api/kontakt        gleiche Herkunft, kein CORS
   ▼
Caddy
   │  · nur POST, sonst 405
   │  · Body höchstens 32 KB
   │  · Drossel: 3 pro IP / 10 min, zusätzlich 60 pro Stunde je Instanz
   │  · rewrite → /webhook/kontakt, reverse_proxy n8n:5678
   ▼
n8n · Webhook (responseMode: responseNode)
   ▼
Code-Node „Validieren & Normalisieren"
   │  Pflichtfelder · E-Mail-Format · Steuerzeichen entfernen
   │  Honeypot und Zeitmessung serverseitig nachgeprüft
   ▼
IF „Gültig?"
   ├── false → Antwort 400   (bei erkanntem Spam: stiller 200)
   └── true  → drei parallele Zweige
        ├── Benachrichtigung an mich    → Antwort 200
        ├── IF „Auto-Antwort erlaubt?"  → Auto-Antwort an den Absender
        └── Postgres INSERT             (onError: continueErrorOutput, retryOnFail)
```

Der wichtigste Zug ist die **Parallelität am Ende**. In Reihe geschaltet würde ein
Datenbankfehler die Benachrichtigung verhindern. So kostet er schlimmstenfalls
eine Datenbankzeile — nie die Anfrage selbst. Für einen Betrieb, der von
eingehenden Anfragen lebt, ist das die richtige Richtung: Der Mensch erfährt
davon, auch wenn die Technik daneben hustet.

Der Webhook antwortet dem Browser über einen eigenen Response-Node. Sonst hinge
der Statuscode davon ab, welcher Zweig zufällig zuletzt fertig wird.

---

## 2 · Warum die Drossel in Caddy sitzt und nicht in n8n

Mein erster Entwurf zählte die Anfragen in einem n8n-Code-Node. Das ist
verlockend, weil alles an einem Ort bleibt — funktioniert aber nicht: n8n
schreibt `staticData` erst **am Ende** einer Ausführung zurück. Zehn gleichzeitige
Anfragen lesen denselben Zählerstand und kommen alle durch.

Die Begrenzung gehört deshalb vor n8n, dorthin, wo sie greift, bevor überhaupt
eine Ausführung startet. Das Standard-Image kennt die Direktive `rate_limit`
nicht, also baue ich Caddy selbst:

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit
FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

Den Code-Node habe ich als zweite Linie stehen lassen — für den Fall, dass Caddy
einmal ohne Plugin startet — mit einem Kommentar, warum er allein nicht reicht.
Eine Verteidigung, von der man weiß, dass sie schwach ist, ist etwas anderes als
eine, die man für stark hält.

---

## 3 · Der Befund, der die ganze Härtung wertlos gemacht hätte

Am 17.08.2026 habe ich die Absicherung nicht gelesen, sondern gemessen. Gegen den
laufenden Server, nicht gegen die Konfigurationsdatei im Repository:

| Test | Erwartet | Tatsächlich |
|---|---|---|
| `POST n8n.roehrner.eu/webhook/kontakt` mit `{}` | 404, Pfad gesperrt | **400 — Endpunkt offen** |
| Derselbe Pfad mit 200 KB Nutzlast | Abweisung | **400 — Nutzlast verarbeitet** |
| `GET n8n.roehrner.eu/` | 401 | **200 — Oberfläche öffentlich** |

Sämtliche Grenzen auf `roehrner.eu/api/kontakt` waren über die n8n-Subdomain
vollständig umgehbar: zehn statt drei Anfragen pro zehn Minuten, kein
Stundenlimit, keine Größengrenze — dazu ein offenes Login-Formular im Netz.

Behoben: `/webhook/kontakt` und `/webhook-test/kontakt` liefern auf der Subdomain
jetzt 404, die übrigen Webhooks bekommen dieselben Grenzen, die Oberfläche liegt
hinter `basic_auth` und ist zusätzlich nur an localhost gebunden. Die Messwerte
stehen als Kommentar im Caddyfile — wer die Datei liest, sieht, wogegen sie
schützt.

Die Regel, die daraus wurde: **Vor jedem Serverschritt den Ist-Zustand messen,
nicht aus der Dokumentation ableiten.** Am selben Tag waren zwei weitere Annahmen
falsch — eine vermutete Draft/Published-Trennung in n8n, die es dort nicht gibt,
und das Array-Format des Postgres-Nodes, der ein echtes JavaScript-Array erwartet
und kein `{a,b}`-Literal.

---

## 4 · Wie ich prüfe, was tatsächlich läuft

Aus derselben Regel sind drei kleine Werkzeuge entstanden, die in
[`tools/`](../tools/) liegen. Sie fragen die n8n Public API rein lesend ab:

| Werkzeug | Antwortet auf |
|---|---|
| `n8n-status.py` | Welche Workflows gibt es, welche sind aktiv, wann liefen sie zuletzt, wie viele der letzten fünf Läufe schlugen fehl |
| `n8n-fehler.py` | Welcher Node ist gescheitert und mit welcher Meldung |
| `n8n-export.py` | Zieht den Ist-Stand und schickt ihn durch den Sanitizer |

Zwei Dinge waren dabei lehrreich.

**Der 401 sagt nicht, wer ablehnt.** Vor der n8n-Oberfläche steht ein
`basic_auth` in Caddy, dahinter prüft n8n den API-Schlüssel. Beide antworten mit
401. Unterscheiden lässt sich das nur am `WWW-Authenticate`-Header, den Caddy
mitschickt und n8n nicht. Ohne diese Unterscheidung sucht man den Fehler auf der
falschen Ebene — was ich prompt getan habe.

**Ausführungsdaten liegen im `flatted`-Format.** n8n speichert sie als flache
Liste, in der jeder String innerhalb eines Objekts ein Index auf dieselbe Liste
ist. Wer das nicht auflöst, sieht statt der Fehlermeldung nur Zahlen:

```python
def entflachten(arr):
    cache = {}
    def bau(i):
        if i in cache: return cache[i]
        v = arr[i]
        if isinstance(v, dict):
            out = {}; cache[i] = out
            for k, val in v.items():
                out[k] = bau(int(val)) if isinstance(val, str) and val.lstrip("-").isdigit() else val
            return out
        ...
```

Der erste Lauf dieser Werkzeuge hat gleich etwas zutage gefördert: Die lokal
gespeicherte Fassung des Kontaktformulars enthielt die Fehlerbehandlung am
Postgres-Node überhaupt nicht, die produktiv längst gesetzt war. Hätte ich das
Repository aus meinen lokalen Dateien gefüllt, stünde dort seit Wochen etwas
Falsches.

---

## 5 · Datenbank mit den kleinstmöglichen Rechten

Die Kundenanfragen liegen in einer eigenen Datenbank, getrennt von der
Betriebsdatenbank von n8n:

| Rolle | Rechte |
|---|---|
| `crm_owner` | Eigentümer des Schemas, **NOLOGIN** |
| `crm_app` | LOGIN, nur `SELECT` und `INSERT` auf `kontaktanfragen` — **kein DELETE** |

Die Zugangsdaten, die in n8n hinterlegt sind, können also nichts löschen. Selbst
wenn jemand über einen kompromittierten Workflow an sie käme, bleibt der Schaden
auf Lesen und Einfügen begrenzt. Das Aufräumen abgelaufener Anfragen erledigt ein
eigener Cron-Job mit anderen Rechten.

Die drei übrigen Webhooks der Instanz prüfen einen Header, bevor sie
überhaupt etwas tun. Das war zunächst nicht so: Zwei von ihnen lösten
schreibende Operationen aus, einer davon kostenpflichtige Modellaufrufe, und
beide waren mit einem simplen POST erreichbar. Aufgefallen ist das erst, als ich
die Workflows für dieses Repository veröffentlicht habe — der Pfad steht im
Export, und damit wurde aus einem unwahrscheinlichen Fund ein naheliegender.
Der Kontakt-Webhook braucht keinen Header, weil ihn Caddy auf der n8n-Subdomain
mit 404 beantwortet und nur über `roehrner.eu/api/kontakt` durchreicht.

Zusätzlich sperrt der Stack den Zugriff auf Umgebungsvariablen aus Code-Nodes
heraus (`N8N_BLOCK_ENV_ACCESS_IN_NODE`). Ohne diese Sperre liest ein einziger
Code-Node den Encryption Key, das Postgres-Passwort und die SMTP-Daten aus
`process.env`. Zusammen mit einer offenen Oberfläche wäre das die vollständige
Kette vom Login zum Totalverlust.

---

## 6 · Löschfristen, technisch erzwungen

Vier Fristen, alle in der Datenschutzerklärung genannt und alle im System
durchgesetzt statt bloß behauptet:

| Daten | Frist | Durchsetzung |
|---|---|---|
| Server-Logs (Caddy) | 7 Tage | `roll_keep_for 168h` |
| n8n-Ausführungsprotokolle | 7 Tage | `EXECUTIONS_DATA_MAX_AGE=168` |
| Kontaktanfragen | 6 Monate ab Eingang | Cron-Job, täglich 03:45 |
| Verschlüsselte Sicherungen | 14 Tage | Retention im Backup-Skript |

Über der Log-Direktive im Caddyfile steht ein Kommentar, dass eine Änderung dort
die Datenschutzerklärung mitziehen muss. Genau das vergisst man sonst, und dann
steht in einem Rechtstext eine Zahl, die das System nicht einhält.

---

## 7 · Backup, einmal ernsthaft geprobt

Täglich um 03:15 per systemd-Timer mit `Persistent=true` — ohne diese Option
fällt ein Lauf ersatzlos aus, wenn der Server zur Timer-Zeit gerade neu startet.

Gesichert werden `pg_dumpall` über beide Datenbanken, das n8n-Datenvolumen, die
`.env` **einschließlich `N8N_ENCRYPTION_KEY`**, Compose-Datei und Caddyfile.
AES-256 verschlüsselt, mit Größenprüfung gegen stille Nullbyte-Dumps und 14 Tagen
Aufbewahrung.

Der Encryption Key ist der Punkt, an dem Backups gern scheitern: Ohne ihn sind
alle wiederhergestellten Credentials unbrauchbar, und das merkt man erst im
Ernstfall. Der Restore wurde deshalb einmal vollständig durchgespielt — null
Fehler, und der Hash des Schlüssels war nach der Wiederherstellung identisch. Ein
Backup, das nie zurückgespielt wurde, ist eine Vermutung.

---

## 8 · Abnahme

Nach jeder Änderung läuft dieselbe Prüfliste. Jede Zeile darin entspricht einem
Fehler, der tatsächlich aufgetreten ist — sie ist gewachsen, nicht erdacht:

```bash
curl -sI https://roehrner.eu/leistungen        # 301, kein Meta-Refresh
curl -sI https://n8n.roehrner.eu/              # 401, Oberfläche zu
for i in 1 2 3 4; do                           # der vierte Aufruf muss 429 sein
  curl -s -o /dev/null -w "$i: %{http_code}\n" \
    -X POST https://roehrner.eu/api/kontakt \
    -H 'Content-Type: application/json' -d '{}'
done
```

Dazu einmal das Formular echt absenden und prüfen, dass Benachrichtigung,
Auto-Antwort **und** Datenbankzeile ankommen.

`curl` läuft dabei mit `-L`. Ohne Redirect-Verfolgung durchsucht ein
nachgeschaltetes `grep` die Weiterleitungsseite statt des Ziels und meldet
fälschlich Erfolg — ein Fehler, der zweimal einen stillen Fehlschlag verdeckt hat.

Ein zweites Abnahmeskript ([`ops/smoke-test.sh`](../ops/smoke-test.sh)) weist
nach, dass ein selbst gesetzter `X-Forwarded-For` den Zähler nicht mehr
zurücksetzt: Fünf Anfragen mit erfundenen Absender-IPs müssen an derselben echten
IP hängenbleiben.

---

## 9 · Was offen ist

Ein Portfolio ohne offene Punkte ist entweder gelogen oder unbenutzt.

1. **Alarmierung am Fehlerausgang des Postgres-Nodes.** Der Ausgang existiert und
   fängt den Fehler ab, aber niemand wird benachrichtigt. Ein fehlgeschlagener
   Insert bleibt derzeit unbemerkt.
2. **429 als JSON beantworten.** Die Drossel liefert Caddys Standardseite; das
   Formular wertet nur den Statuscode aus und kann dem Besucher deshalb nichts
   Brauchbares sagen.
3. **Off-Site-Backup.** Die Sicherung liegt bisher auf demselben Server. Geplant
   ist eine Storage Box mit gleicher Aufbewahrungsfrist und eigenem Restore-Test.
4. **Rotation der Zugangsdaten**, die während der Einrichtung entstanden sind —
   Teil der Hausaufgaben, die kein Feature sind und trotzdem gemacht gehören.
