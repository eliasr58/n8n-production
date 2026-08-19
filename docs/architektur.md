# Architektur

Ein Hetzner-Server, alles in Docker Compose, kein Dienst direkt auf dem Host.
`systemctl status caddy` ist deshalb irreführend — dort gibt es keinen
Caddy-Dienst.

```mermaid
flowchart TB
    B["Browser<br/>roehrner.eu"]

    subgraph Server["Hetzner · Ubuntu · Docker Compose"]
        C["Caddy<br/>eigenes Image mit Rate-Limit-Plugin<br/>:80 :443"]
        N["n8n<br/>nur 127.0.0.1:5678"]
        P[("Postgres 16<br/>DB n8n · DB crm")]
        S["Statische Site<br/>/srv/site (Astro-Build)"]
        PL["Plausible<br/>self-hosted"]
    end

    EXT["Notion · SMTP"]

    B -- "POST /api/kontakt<br/>max 32 KB · 3 pro IP / 10 min" --> C
    B -- "GET /" --> C
    C --> S
    C -- "rewrite /webhook/kontakt" --> N
    C -- "/js/* · /api/event" --> PL
    N --> P
    N <--> EXT

    T1["systemd-Timer 03:15<br/>Backup AES-256 · 14 Tage"] -.-> P
    T2["systemd-Timer 03:45<br/>Anfragen > 6 Monate löschen"] -.-> P
```

## Warum das Formular über `roehrner.eu` läuft und nicht über die n8n-Subdomain

Drei Gründe, in dieser Reihenfolge:

1. **Gleiche Herkunft.** Der Browser spricht ausschließlich mit `roehrner.eu`.
   CORS entfällt vollständig, und es gibt keine Preflight-Anfrage, die schiefgehen
   kann.
2. **Die Grenzen greifen wirklich.** Wären beide Wege offen, ließe sich die
   Drossel auf `/api/kontakt` einfach über die Subdomain umgehen — genau das war
   am 17.08.2026 der Fall, siehe
   [Case-Study](case-study-kontaktformular.md#3--der-befund-der-die-härtung-wertlos-gemacht-hätte).
3. **Die Subdomain war bei Safe Browsing gelistet.** Sie kommt im Kundenpfad
   nicht mehr vor, damit ist eine Listung für Besucher folgenlos.

## Trennung der Datenbanken

`n8n` und `crm` liegen in derselben Postgres-Instanz, aber in getrennten
Datenbanken mit getrennten Rollen. Die Rolle, mit der n8n auf die Kundenanfragen
zugreift, darf ausschließlich lesen und einfügen — kein `DELETE`, kein
Schema-Zugriff. Das Aufräumen nach Ablauf der Frist erledigt ein Cron-Job mit
eigenen Rechten.
