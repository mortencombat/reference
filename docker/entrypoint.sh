#!/bin/sh
# Serve the active release with nginx and keep it in sync with /config and /data.
set -eu

node /app/docker/bin/watch.mjs &
WATCH_PID=$!

nginx -c /etc/nginx/nginx.conf -e stderr -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
    kill -TERM "$WATCH_PID" 2>/dev/null || true
    nginx -c /etc/nginx/nginx.conf -e stderr -s quit 2>/dev/null || true
    wait "$WATCH_PID" "$NGINX_PID" 2>/dev/null || true
    exit 0
}
trap shutdown TERM INT

# Exit (and let the orchestrator restart us) if either process dies.
while kill -0 "$NGINX_PID" 2>/dev/null && kill -0 "$WATCH_PID" 2>/dev/null; do
    sleep 2 &
    wait $!
done
echo "[reference] nginx or the watcher exited; shutting down" >&2
shutdown
