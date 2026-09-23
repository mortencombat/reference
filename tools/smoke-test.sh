#!/usr/bin/env bash
# Start the image, check it serves the default site, then mount a config, a
# custom post and an icon and check that the container rebuilds and serves
# them, keeps serving through an invalid config, and recovers.
#
#   tools/smoke-test.sh IMAGE
set -euo pipefail

image="${1:?usage: smoke-test.sh IMAGE}"
port="${SMOKE_PORT:-18080}"
base="http://127.0.0.1:${port}"
work="$(mktemp -d)"
name="reference-smoke-$$"

cleanup() {
  echo "-- container log (tail)"
  docker logs "$name" 2>&1 | grep -v 'GET /' | tail -30 || true
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Fetch into a variable first: piping curl straight into grep -q makes curl
# fail with SIGPIPE on large pages once grep has seen its match.
fetch() { curl -fsS "$1" 2>/dev/null; }
status() { curl -sS -o /dev/null -w '%{http_code}' "$1"; }

expect_has() {
  local url="$1" pattern="$2" body
  body="$(fetch "$url")" || fail "GET $url failed"
  grep -q -- "$pattern" <<<"$body" || fail "expected '$pattern' in $url (title: $(grep -o '<title>[^<]*' <<<"$body" | head -1))"
}

expect_lacks() {
  local url="$1" pattern="$2" body
  body="$(fetch "$url")" || fail "GET $url failed"
  grep -q -- "$pattern" <<<"$body" && fail "did not expect '$pattern' in $url" || true
}

expect_status() {
  local url="$1" want="$2" got
  got="$(status "$url")"
  [ "$got" = "$want" ] || fail "expected HTTP $want for $url, got $got"
}

wait_for() {
  local url="$1" pattern="$2" tries="${3:-30}" body
  for _ in $(seq "$tries"); do
    body="$(fetch "$url")" || body=""
    if grep -q -- "$pattern" <<<"$body"; then return 0; fi
    sleep 2
  done
  fail "timed out waiting for '$pattern' at $url"
}

mkdir -p "$work/config" "$work/data/posts" "$work/data/icons"
chmod -R a+rX "$work"

docker run -d --name "$name" -p "${port}:8080" --read-only --tmpfs /tmp \
  -v "$work/config:/config:ro" -v "$work/data:/data:ro" "$image" >/dev/null

echo "-- default site"
wait_for "$base/healthz" '<title>Reference'
expect_has "$base/" '<title>Reference'
expect_has "$base/bash.html" 'Bash'
expect_has "$base/bash" 'Bash'
expect_status "$base/does-not-exist" 404
expect_has "$base/search.json" '"/apex-legends.html"'

echo "-- custom config, post and icon"
cat > "$work/config/site.yml" <<'YAML'
title: Smoke Test Sheets
theme_config:
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
cat > "$work/data/icons/smoke.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" id="smoke-icon"/></svg>
SVG
wait_for "$base/" '<title>Smoke Test Sheets' 60
expect_has "$base/smoke.html" 'Hello from the smoke test'
expect_has "$base/" 'smoke-icon'
expect_status "$base/apex-legends.html" 404
expect_lacks "$base/search.json" '"/apex-legends.html"'
expect_lacks "$base/sitemap.xml" 'apex-legends'
expect_has "$base/search.json" '"/smoke.html"'

echo "-- invalid config keeps the current site"
printf 'title: 42\n' > "$work/config/site.yml"
sleep 15
expect_has "$base/" '<title>Smoke Test Sheets'
docker logs "$name" 2>&1 | grep -qE 'build [0-9a-f]{16} failed' || fail "expected a recorded build failure in the log"
docker exec "$name" node docker/bin/rebuild.mjs --force >/dev/null 2>&1 && fail "rebuild --force should fail on an invalid config" || true

echo "-- recovery"
printf 'title: Recovered Sheets\n' > "$work/config/site.yml"
wait_for "$base/" '<title>Recovered Sheets' 60
expect_status "$base/healthz" 200

echo "-- shutdown"
start=$(date +%s)
docker stop -t 15 "$name" >/dev/null
[ $(( $(date +%s) - start )) -le 15 ] || fail "container took too long to stop"
docker rm -f "$name" >/dev/null

echo "-- arbitrary uid, bind-mounted /srv, seeded first start"
mkdir -p "$work/srv" && chmod 0777 "$work/srv"
printf 'title: Seeded Sheets\n' > "$work/config/site.yml"
docker run -d --name "$name" -p "${port}:8080" --read-only --tmpfs /tmp --user 12345:12345 \
  -v "$work/config:/config:ro" -v "$work/data:/data:ro" -v "$work/srv:/srv" "$image" >/dev/null
wait_for "$base/healthz" '<title>Reference' 10
docker logs "$name" 2>&1 | grep -q 'seeded release' || fail "expected the image release to be seeded into /srv"
wait_for "$base/" '<title>Seeded Sheets' 60
[ -d "$work/srv/releases" ] || fail "expected releases under the bind-mounted /srv"

echo "smoke test passed"
