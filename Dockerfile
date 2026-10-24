FROM caddy:2.11.2-builder AS builder

# Caddy itself is built from the release tag matching the base image
# (`CADDY_VERSION` is set by the builder image) with everything in patches/
# applied, so a patch that stops applying after a base bump fails the build
# rather than shipping an unpatched binary. See patches/README.md.
COPY patches/ /patches/
RUN git clone --depth 1 --branch "$CADDY_VERSION" https://github.com/caddyserver/caddy.git /caddy-src \
    && git -C /caddy-src apply --verbose /patches/*.patch

# Plugins are version-pinned: unpinned, xcaddy resolves the latest, which both
# makes the binary irreproducible and breaks the build outright once a plugin
# requires a newer Caddy than the base image above. Raising either pin past the
# base's Caddy version means bumping the base in the same change.
RUN xcaddy build \
    --replace github.com/caddyserver/caddy/v2=/caddy-src \
    --with github.com/mholt/caddy-l4@v0.1.0 \
    --with github.com/pberkel/caddy-storage-redis@v1.8.1

FROM caddy:2.11.2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
