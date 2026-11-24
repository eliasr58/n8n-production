# Stand festgeschrieben 21.09.2026 (9cv): vorher standen hier `caddy:2` und
# `--with github.com/mholt/caddy-ratelimit` ohne Version - ein Neubau nach
# einem Ausfall haette eine andere Caddy- und Plugin-Fassung ergeben als die,
# gegen die C118 gemessen ist. Die Versionen sind aus dem LAUFENDEN Binary
# gelesen (`caddy version`, `caddy build-info`), nicht aus der Doku.
FROM caddy:2.11.4-builder AS builder
RUN xcaddy build v2.11.4 --with github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:2.11.4
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
