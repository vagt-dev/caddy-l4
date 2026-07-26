FROM caddy:2.11.2-builder AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-l4 \
    --with github.com/pberkel/caddy-storage-redis

FROM caddy:2.11.2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
