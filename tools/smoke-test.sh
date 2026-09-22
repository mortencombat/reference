#!/usr/bin/env bash
# Start the image, check it serves the default site, then mount a config and
# a custom post and check that the container rebuilds and serves them.
#
#   tools/smoke-test.sh IMAGE
set -euo pipefail

image="${1:?usage: smoke-test.sh IMAGE}"
port="${SMOKE_PORT:-18080}"
work="$(mktemp -d)"
name="reference-smoke-$$"

cleanup() {
  docker logs "$name" 2>&1 | tail -40 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -p "$work/config" "$work/data/posts"
chmod -R a+rX "$work"

docker run -d --name "$name" -p "${port}:8080" \
  -v "$work/config:/config:ro" -v "$work/data:/data:ro" "$image" >/dev/null

# Fetch into a variable first: piping curl straight into grep -q makes curl
# fail with SIGPIPE on large pages once grep has seen its match.
has() {
  local url="$1" pattern="$2" body
  body="$(curl -fsS "$url" 2>/dev/null)" || return 1
  grep -q "$pattern" <<<"$body"
}

status() {
  curl -sS -o /dev/null -w '%{http_code}' "$1"
}

wait_for() {
  local url="$1" pattern="$2" tries="${3:-30}"
  for _ in $(seq "$tries"); do
    if has "$url" "$pattern"; then return 0; fi
    sleep 2
  done
  echo "timed out waiting for $pattern at $url" >&2
  return 1
}

echo "-- default site"
wait_for "http://127.0.0.1:${port}/healthz" '^ok'
wait_for "http://127.0.0.1:${port}/" '<title>Reference'
has "http://127.0.0.1:${port}/bash.html" 'Bash'
has "http://127.0.0.1:${port}/bash" 'Bash'
[ "$(status "http://127.0.0.1:${port}/does-not-exist")" = 404 ]

echo "-- custom config and post"
cat > "$work/config/site.yml" <<'YAML'
title: Smoke Test Sheets
exclude_posts: [apex-legends]
YAML
cat > "$work/data/posts/smoke.md" <<'MD'
---
title: Smoke
date: 2026-01-01
tags: [smoke]
categories: [Other]
intro: Added during the smoke test.
---

## Section

### Item

Hello from the smoke test.
MD
wait_for "http://127.0.0.1:${port}/" '<title>Smoke Test Sheets' 60
has "http://127.0.0.1:${port}/smoke.html" 'Hello from the smoke test'
[ "$(status "http://127.0.0.1:${port}/apex-legends.html")" = 404 ]

echo "-- invalid config keeps the current site"
printf 'title: 42\n' > "$work/config/site.yml"
sleep 15
has "http://127.0.0.1:${port}/" '<title>Smoke Test Sheets'
docker logs "$name" 2>&1 | grep -q 'failed'

echo "smoke test passed"
