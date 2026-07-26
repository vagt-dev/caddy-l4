FROM caddy:2.11.2-builder AS builder

# Plugins are version-pinned: unpinned, xcaddy resolves the latest, which both
# makes the binary irreproducible and breaks the build outright once a plugin
# requires a newer Caddy than the base image above. Raising either pin past the
# base's Caddy version means bumping the base in the same change.
RUN xcaddy build \
    --with github.com/mholt/caddy-l4@v0.1.0 \
    --with github.com/pberkel/caddy-storage-redis@v1.8.1

FROM caddy:2.11.2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
