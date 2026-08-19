# Caddy mit Rate-Limit-Plugin.
# Das offizielle caddy:2-Image kennt die Direktive `rate_limit` nicht und
# weigert sich, eine Konfiguration zu laden, die sie verwendet.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
