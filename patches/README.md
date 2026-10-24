# Patches to Caddy

Applied in order to the Caddy release tag the base image names, by the
`Dockerfile`. A patch that no longer applies fails the build.

## 0001: retire connections on a stopped server

On a config reload `net/http`'s `Server.Shutdown` closes the old server's
listeners and then starts the HTTP/2 graceful shutdown asynchronously, and
`x/net/http2` sends a GOAWAY only to the connections registered with it at that
moment. A connection the old server accepted whose TLS handshake was still in
flight registers afterwards, never receives a GOAWAY, and keeps answering every
request from the superseded config for as long as the client holds it open. A
CDN that pools origin connections can hold one for weeks, and each leaked
connection also keeps the old server's `Shutdown` waiting. A `grace_period`
does not help: once it expires `Shutdown` stops waiting, but nothing closes the
connection.

The patch marks a server as stopping before `Shutdown` and has it answer any
HTTP/2 request with `Connection: close`, which `x/net/http2` turns into a
GOAWAY for that connection. The leaked connection serves the request already
sent on it and then closes, so the client's next request reaches the live
config. No in-flight request is cut short.

`test/reload-retires-connections.mjs` reproduces the race deterministically:
it fails against an unpatched build and passes against this one.

Drop the patch once Caddy or `x/net/http2` retires late-registered connections
itself, which the test will show.
