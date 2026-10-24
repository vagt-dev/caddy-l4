#!/bin/sh
# Runs test/*.mjs against a built image: ./test/run.sh <image>
set -eu
IMAGE="$1"
DIR=$(cd "$(dirname "$0")" && pwd)
NET=caddy-l4-test
NAME=caddy-under-test
INIT='{"admin":{"listen":"0.0.0.0:2019","origins":["caddy-under-test:2019","http://caddy-under-test:2019"]}}'

cleanup() {
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null

status=0
for test in "$DIR"/*.mjs; do
	echo "== $(basename "$test")"
	docker rm -f "$NAME" >/dev/null 2>&1 || true
	docker run -d --name "$NAME" --network "$NET" -e INIT="$INIT" --entrypoint sh "$IMAGE" \
		-c 'printf "%s" "$INIT" > /tmp/init.json && exec caddy run --config /tmp/init.json' >/dev/null
	# The client runs inside the network so the server accepts the TCP
	# connection at connect time, not when a port forwarder sees the first byte.
	docker run --rm --network "$NET" -e CADDY_HOST="$NAME" -e TEST_SCRIPT="$(cat "$test")" node:24-alpine \
		sh -c 'printf "%s" "$TEST_SCRIPT" > /test.mjs && exec node /test.mjs' || status=1
done
exit "$status"
