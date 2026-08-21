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
   │  · Drossel: 3 pro IP / 10 min, zusätzlich 60 pro Stunde für diesen Pfad
   │  · rewrite → /webhook/kontakt, reverse_proxy n8n:5678
   ▼
n8n · Webhook (responseMode: responseNode)
   ▼
Code-Node „Validieren & Normalisieren"
   │  Pflichtfelder · E-Mail-Format · Steuerzeichen entfernen
   │  Honeypot serverseitig nachgeprüft (der Zeit-Check bleibt clientseitig)
   ▼
IF „Gültig?"
   ├── false → Antwort 400   (bei erkanntem Spam: stiller 200)
   └── true  → drei parallele Zweige
        ├── Benachrichtigung an mich    → Antwort 200
        ├── IF „Auto-Antwort erlaubt?"  → Auto-Antwort an den Absender
        └── Postgres INSERT             (onError: continueErrorOutput, retryOnFail)
```

Der wichtigste Zug ist die **Entkopplung am Ende**. Die drei Zweige hängen am
selben Ausgang; n8n arbeitet sie bei `executionOrder: v1` nacheinander ab, nicht
echt gleichzeitig. Entscheidend ist deshalb nicht die Reihenfolge, sondern
`onError: continueErrorOutput` am Postgres-Node: Ein Datenbankfehler beendet die
Ausführung nicht, sondern verlässt den Node über einen zweiten Ausgang. Er kostet
schlimmstenfalls eine Datenbankzeile — nie die Anfrage selbst. Für einen Betrieb,
der von eingehenden Anfragen lebt, ist das die richtige Richtung: Der Mensch
erfährt davon, auch wenn die Technik daneben hustet.

Die Antwort an den Browser kommt aus einem eigenen Response-Node am Ausgang der
Benachrichtigung. Damit ist der Statuscode unabhängig davon, was die Datenbank
tut — nicht aber vom Mailversand: Fällt SMTP aus, bekommt der Browser keine
Antwort. Das ist die verbleibende Kopplung, und sie ist bewusst so herum gewählt,
weil eine Anfrage ohne Benachrichtigung schlimmer wäre als eine ohne Bestätigung
im Browser.

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

Den Zähler im Code-Node habe ich als zweite Linie stehen lassen, für den Fall,
dass Caddy einmal ohne Plugin startet. Er hat unterwegs selbst einen Fehler
gehabt: Anfangs zählte er *jeden* Versuch, auch die abgewiesenen — dadurch schob
jeder Aufruf das Fenster weiter und die Sperre endete nie. Nachgemessen am
17.08.2026 zwischen 01:14 und 01:28. Seitdem zählt er nur angenommene Anfragen;
der Vermerk dazu steht im Node.

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
jetzt 404. Die übrigen Webhooks bekamen dieselbe Body-Grenze von 32 KB und
eigene Drosselzonen — bewusst großzügiger als der Formularpfad, weil dort meine
eigenen Auslöser anklopfen: 10 Anfragen je IP in 10 Minuten und 120 pro Stunde
für die Instanz. Die Oberfläche liegt hinter `basic_auth` und ist zusätzlich nur
an localhost gebunden. Die Messwerte
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
| Kontaktanfragen | 6 Monate ab Eingang | Cron-Job, nächtlich |
| Verschlüsselte Sicherungen | 14 Tage | Retention im Backup-Skript |

Über der Log-Direktive im Caddyfile steht ein Kommentar, dass eine Änderung dort
die Datenschutzerklärung mitziehen muss. Genau das vergisst man sonst, und dann
steht in einem Rechtstext eine Zahl, die das System nicht einhält.

---

## 7 · Backup, einmal ernsthaft geprobt

Nächtlich per systemd-Timer mit `Persistent=true` — ohne diese Option
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

Seit dem 21.08.2026 liegt die Sicherung zusätzlich außerhalb des Servers: eine
Storage Box, gespiegelt per `rsync` über SSH direkt nach der lokalen Retention —
was hier wegfällt, verschwindet drüben im selben Lauf. Der Standort ist bewusst
ein anderes Rechenzentrum als das des Servers; ein Backup am selben Ort hilft
gegen einen Standortausfall nicht.

Weil `--delete` auch Löschungen spiegelt, wäre ein leergeräumtes lokales
Verzeichnis binnen eines Laufs auch drüben leer. Dagegen stehen die täglichen
Snapshots der Box, die außerhalb dieser Logik liegen.

Nachgewiesen wurde in beide Richtungen. Ein Archiv von der Box geholt,
entschlüsselt, Inhalt gelistet — und danach der Hostname der Box absichtlich
verfälscht, um zu belegen, dass der Lauf dann **mit Fehler abbricht** statt still
durchzulaufen. Der zweite Test ist der wichtigere: Ein Backup, das im Fehlerfall
Erfolg meldet, ist schlimmer als keines.

Fehlgeschlagene Läufe melden sich seitdem selbst. `OnFailure=` verweist auf eine
Template-Unit, die per msmtp eine Mail mit den letzten dreißig Journalzeilen
schickt. Vorher stand ein Fehlschlag ausschließlich im Journal, und dorthin
schaut niemand freiwillig — derselbe Fehler wie ein unverbundener Error-Ausgang
im Workflow, nur eine Ebene tiefer. Das SMTP-Passwort liegt in einer eigenen
Datei; die Konfiguration verweist über `passwordeval` darauf und enthält selbst
kein Geheimnis.

Das deckt allerdings nur den Fall ab, dass ein Lauf **fehlschlägt**. Ein Lauf,
der gar nicht erst stattfindet — weil der Server steht —, erzeugt auch keine
Fehlermeldung. Deshalb meldet das Skript am Ende jedes erfolgreichen Durchgangs
an einen externen Dienst. Bleibt diese Meldung aus, schlägt der Dienst Alarm.
Die beiden Wege ergänzen sich: Der eine meldet, dass etwas schiefging, der
andere, dass nichts passiert ist.

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

Die Aufrufe oben nutzen `-sI` und lesen nur den Statuscode, da ist eine
Weiterleitung genau das, was geprüft wird. Sobald aber der *Inhalt* einer Antwort
durchsucht wird, gehört `-L` dazu: Ohne Redirect-Verfolgung durchsucht ein
nachgeschaltetes `grep` die Weiterleitungsseite statt des Ziels und meldet
fälschlich Erfolg. Zweimal hat mir das einen stillen Fehlschlag verdeckt; in
[`tools/n8n-export.py`](../tools/n8n-export.py) steht der Hinweis deshalb direkt
am Aufruf.

Ein zweites Abnahmeskript ([`ops/smoke-test.sh`](../ops/smoke-test.sh)) weist
nach, dass ein selbst gesetzter `X-Forwarded-For` den Zähler nicht mehr
zurücksetzt: Fünf Anfragen mit erfundenen Absender-IPs müssen an derselben echten
IP hängenbleiben.

---

## 9 · Der Fehlerausgang bekommt eine Stimme

Der Postgres-Node fängt seinen Fehler seit jeher ab — nur wusste davon niemand.
Ein fehlgeschlagener Insert lief in einen unverbundenen Ausgang, die
Benachrichtigungsmail kam trotzdem, und die Anfrage war weg. Seit dem 19.08.2026
hängt dort ein Mail-Node, dessen eigentlicher Wert nicht die Meldung ist, sondern
die **Nutzlast**: Die Alarmmail enthält die vollständige Anfrage. Fällt die
Datenbank aus, liegt der Kunde trotzdem im Postfach, nicht im Nirgendwo.

Der Node läuft selbst mit `onError: continue` — eine Störung im Alarmpfad darf
keine zweite erzeugen.

**Ausgelöst wurde er auch.** Ein Alarm, der nie gefeuert hat, ist eine Vermutung.
Zum Nachweis stand der Tabellenname im Node kurz auf einem nicht existierenden
Wert; die Mail kam, und mit ihr zwei Fehler in meiner eigenen Konfiguration:

1. Betreff und Text begannen sichtbar mit `=`. n8n setzt dieses Zeichen selbst,
   sobald ein Feld im Expression-Modus ist — eingetippt hatte ich es ein zweites
   Mal.
2. Die Fehlerzeile enthielt statt einer Meldung das gesamte Fehlerobjekt, zwei
   Bildschirmseiten lang. `error.message` existiert bei diesem Node nicht; die
   lesbare Meldung steht unter `error.description`. Der Fallback
   `JSON.stringify` griff und schüttete alles aus.

Beides ließ sich nur finden, weil der Alarm einmal echt gelaufen ist. Danach kam
der Schritt, den man am leichtesten vergisst: der Rückbau des Tabellennamens —
und ein zweiter Durchlauf als Beleg, dass der Insert wieder greift und **keine**
Alarmmail mehr kommt.

---

## 10 · Was offen ist

Ein Portfolio ohne offene Punkte ist entweder gelogen oder unbenutzt.

1. **429 als JSON beantworten.** Die Drossel liefert Caddys Standardseite; das
   Formular wertet nur den Statuscode aus und kann dem Besucher deshalb nichts
   Brauchbares sagen.
2. **Ressourcengrenzen für die Container.** Alle drei teilen sich einen Host
   ohne Speicher- oder Prozesslimit; ein durchgehender Container trifft damit
   auch die anderen.
