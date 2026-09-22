#!/usr/bin/env bash
# Replace the upstream-owned content directories with the versions from
# Fechin/reference. Only cheat sheets, their icons and preview images and the
# embedded widgets are synced; the theme, config and tooling belong to this fork.
#
#   tools/sync-upstream.sh [upstream-ref]     default: upstream/main
#
# Expects a git remote named "upstream" (added if missing). Leaves the
# changes staged; prints the upstream commit and the changed files.
set -euo pipefail

UPSTREAM_URL="https://github.com/Fechin/reference.git"
REF="${1:-upstream/main}"
PATHS=(source/_posts source/assets/icon source/assets/image source/widget)
# Upstream files that this fork intentionally does not ship. Keep this in
# sync with the deletions on main; anything listed here is removed again
# after every sync.
EXCLUDE=(
  # affiliate logos
  source/assets/icon/tableconvert.png
  source/assets/icon/dorefer.png
  source/assets/icon/fionaai.png
  # X (Twitter)
  source/_posts/twitter.md
  source/assets/icon/twitter.svg
  source/assets/icon/x.svg
  source/assets/image/twitter-preview.png
)

cd "$(git rev-parse --show-toplevel)"

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi
git fetch --quiet upstream main

sha="$(git rev-parse "$REF")"
git rm -rq --ignore-unmatch --cached "${PATHS[@]}"
rm -rf "${PATHS[@]}"
for p in "${PATHS[@]}"; do
  # A directory upstream no longer has is simply dropped here too.
  if git cat-file -e "$sha:$p" 2>/dev/null; then
    git checkout --quiet "$sha" -- "$p"
  else
    echo "note: $p does not exist upstream at $sha" >&2
  fi
done
git rm -qf --ignore-unmatch "${EXCLUDE[@]}"
# Record the last upstream commit that touched the synced paths, so that
# upstream commits elsewhere do not produce empty syncs.
git log -1 --format=%H "$sha" -- "${PATHS[@]}" > UPSTREAM_COMMIT
git add -A "${PATHS[@]}" UPSTREAM_COMMIT

echo "upstream commit: $(cat UPSTREAM_COMMIT)"
git diff --cached --name-status
