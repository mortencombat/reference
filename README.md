# 📖 Reference, self-hosted

[![License](https://img.shields.io/github/license/mortencombat/reference)](LICENSE)
[![CI](https://github.com/mortencombat/reference/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mortencombat/reference/actions/workflows/ci.yml)
[![Publish image](https://github.com/mortencombat/reference/actions/workflows/release.yml/badge.svg)](https://github.com/mortencombat/reference/actions/workflows/release.yml)
[![Container image](https://img.shields.io/github/v/release/mortencombat/reference?label=ghcr.io%20reference&logo=docker&logoColor=white&color=2496ed)](https://github.com/mortencombat/reference/pkgs/container/reference)
[![Built on Fechin/reference](https://img.shields.io/badge/built%20on-Fechin%2Freference-3fb950?logo=github&logoColor=white)](https://github.com/Fechin/reference)

Cheat sheets for developers, packaged as a Docker image you can run on your own infrastructure.

This is a fork of [Fechin/reference](https://github.com/Fechin/reference), the project behind
[cheatsheets.zip](https://cheatsheets.zip). The cheat sheets are the upstream project's work, written by
[Fechin](https://github.com/Fechin) and many contributors. This fork only changes how the site is packaged: it removes
advertisements, affiliate links and trackers, makes the branding configurable, serves the result with nginx and
rebuilds it inside the container when you change the configuration or add your own cheat sheets.

**If you find the cheat sheets useful, please [sponsor Fechin](https://github.com/sponsors/Fechin)**, or buy them a
[coffee](https://buymeacoffee.com/fechin). Contributions to the cheat sheets themselves belong
[upstream](https://github.com/Fechin/reference), where every instance benefits from them.

## Quick start

```bash
docker run -d --name reference -p 8080:8080 ghcr.io/mortencombat/reference:latest
```

Open http://localhost:8080. That is the upstream collection with the default configuration.

To customise it, mount a config file and a data directory:

```bash
mkdir -p config data/posts data/icons
cp config/site.example.yml config/site.yml   # then edit it
docker run -d --name reference -p 8080:8080 \
  -v "$PWD/config:/config:ro" \
  -v "$PWD/data:/data:ro" \
  ghcr.io/mortencombat/reference:latest
```

Or use the [compose.yml](compose.yml) in this repository.

| Mount               | Purpose                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `/config/site.yml`  | Site configuration. See `config/site.example.yml`.                                        |
| `/data/posts/*.md`  | Your own cheat sheets. Same format as the upstream sheets.                                |
| `/data/icons/*.svg` | Icons for your cheat sheets, named after the post slug.                                   |
| `/srv` (optional)   | Built releases and build state. Mount a volume or directory to keep them across restarts. |

Mount the directories rather than single files: editors save by replacing the file, and a single-file bind mount
keeps pointing at the old copy. The mounts must be readable by the container's user, uid 1000 by default; any
other uid works with `user:` as long as it owns the `/srv` mount. The image writes only to `/srv` and `/tmp`, so it
runs with a read-only root filesystem and a tmpfs on `/tmp`, as `compose.yml` shows. On first start with an empty
`/srv`, the release baked into the image is copied in, so the site is served immediately.

Image tags: `latest` for the current build of `main`; `1`, `1.4` and `1.4.2` for releases; `sha-<commit>` and a
`YYYY.MM.DD` date tag for every build. Images are built for `linux/amd64` and `linux/arm64`.

## Configuration

`config/site.example.yml` documents every setting with its default. The file is merged over the built-in Hexo
configuration, so anything Hexo understands can be set there, but the settings meant for operators are:

- **Identity**: `title`, `subtitle` (browser tab title of the home page), `description` (meta description and link
  previews), `author` (author meta tag) and `url` (the public address, used for the sitemap and canonical links). The
  interface is English only.
- **Content**: `theme_config.categories` lists the sections on the home page, in order, and decides which
  cheat sheets exist at all: a sheet is built only if one of its categories admits it, otherwise it has no page, no
  search entry and no sitemap entry. An entry is a category name, or an object that adjusts it: `include` adds
  sheets from anywhere, `except` removes some, `only` sets the exact membership, and `sort` orders the section
  (`date`, `-date`, `title`, `-title`, or `listed` for the order of an `only` list). A new name with `include` or
  `only` is a category of your own. `theme_config.sort_posts` sets the default order for all sections.
  `theme_config.featured_posts` picks the sheets shown at the top of the home page; they are always built.
  `theme_config.exclude_posts` drops individual sheets from every category.
- **Hero**: `theme_config.hero` sets the headline (multi-line allowed), the tagline paragraph under it and optional
  buttons on the home page.
- **Header**: `theme_config.header.links` are the icon buttons next to the dark mode toggle, by default a link to
  this repository and the About page.
- **Features**: `theme_config.features.share` enables the share menu, `livecodes` enables "run code" buttons (loads
  the LiveCodes playground from a CDN), `contribute` toggles the "See something missing?" section.
- **Footer**: `theme_config.footer.credit: true` keeps the line crediting the upstream project. Please leave it on.

The container validates the file against a schema. A typo produces one clear error in the container log and the
running site is left untouched.

## Your own cheat sheets

Drop Markdown files into `/data/posts`. The format is the upstream one: YAML front matter followed by `##` sections
that become cards and `###` subsections that become card items. The smallest useful file:

```markdown
---
title: Team Onboarding
date: 2026-01-01
background: bg-[#0f766e]
tags: [team]
categories: [Other]
intro: Where to find things on your first day.
---

## First day

### Accounts

Ask in #it-support for your SSO account.
```

The `categories` value must match one of `theme_config.categories`, otherwise the sheet is not built at all
(unless it is listed in `featured_posts`).
Add your own category to that list if you want a section of your own. A file with the same name as an upstream sheet
replaces it, which is the way to patch a sheet locally.

The upstream cheat sheets show how to use tables, columns, code blocks and the other layout helpers:
[source/\_posts](source/_posts).

> [!TIP]
> To link out without cluttering the text, write the link as `[[Tooltip text]](https://example.com/page)`: a link
> whose text is a single bracketed token. The build renders it as a small external-link icon with that text as the
> tooltip. `[[source]]`, `[[src]]` and `[[s]]` are shorthand for a "Source" tooltip.

## How rebuilding works

The container serves a site that was built into the image, so it responds immediately after start. A watcher then
polls `/config` and `/data` every ten seconds (and reacts to file system events where the mount delivers them).

1. The config (with comments and key order ignored), your posts and icons, and the image build id are hashed into a
   release id.
2. If a release with that id already exists, it is activated at once. Switching back to an earlier configuration is
   instant.
3. Otherwise the site is built into a staging directory. That takes roughly fifteen seconds.
4. The result is verified, moved into place, and nginx's document root symlink is swapped atomically. Visitors never
   see a half-built site.
5. If the build fails, the previous release keeps serving. The failure is recorded under `/srv/state/failed` and the
   same inputs are not retried until they change. A config that does not parse, an unreadable file, or two files that
   would map to the same name count as failures too.

The last three releases are kept (`REFERENCE_KEEP_RELEASES`). `/healthz` answers 200 only while a release is being
served. To retry inputs that failed before:

```bash
docker exec reference node docker/bin/rebuild.mjs --force
```

Environment variables: `REFERENCE_WATCH_INTERVAL` (seconds, default 10), `REFERENCE_KEEP_RELEASES` (default 3),
`REFERENCE_CONFIG` (default `/config/site.yml`), `REFERENCE_DATA` (default `/data`).

## Deployment notes

- **User and mounts.** The container runs as uid 1000 by default. `/config` and `/data` must be readable by that
  uid, and `/srv` writable. Either give the mounted directories that owner, or set `user:` in compose to the owner
  you already use; the image has no dependency on a particular uid. The log's first lines say which uid it runs as
  and whether each mount is usable.
- **Hardening.** The image writes only to `/srv` and `/tmp`, so `read_only: true` with a tmpfs on `/tmp` works, as
  `compose.yml` shows. No capabilities and no network access are needed; the run-code feature, if enabled, loads in
  the visitor's browser.
- **First start.** With an empty `/srv`, bind mount or volume, the release built into the image is copied in before
  anything else, so the site serves immediately and `compose up --wait` does not wait for a build. A build only
  runs when `/config` or `/data` contain something.
- **Reverse proxy.** Serve it behind whatever terminates TLS for you and set `url` in the config to the public
  address, so the sitemap and canonical links are right. To serve under a sub-path, set `url` and `root` together.
- **Health and status.** `/healthz` returns 200 with a one-line body only while a release is served, 503 otherwise. `/status.json` reports the served
  release id, the image build id and when the release was built and activated.
- **After a failure.** A build failure keeps the previous release and is logged with the reason; the same inputs
  are retried on the next container start, or immediately with `rebuild.mjs --force`.
- **Tags.** `latest` follows `main`. Releases are cut from the commit history with semantic versions: `1`,
  `1.4` and `1.4.2` style tags, a `v1.4.2` git tag and a GitHub release with the changelog. A major bump means the
  configuration changed incompatibly; the release notes say what to update. `sha-<commit>` and the `YYYY.MM.DD`
  date tags identify any build, including the nightly content syncs between releases.

## Keeping up with upstream

A scheduled workflow fetches `source/_posts`, `source/assets/icon`, `source/assets/image` and `source/widget` from
Fechin/reference
every night and opens a pull request when anything changed. CI builds the site and the image and runs a smoke test
against the container; the pull request is merged automatically once those checks pass. A merge to `main` publishes
a new image. The theme, configuration and tooling are never synced, so upstream content changes cannot conflict with
this fork. A short exclusion list in `tools/sync-upstream.sh` names the upstream files this fork does not ship.

Dependency updates (npm packages, GitHub Actions, and the Node and pnpm versions pinned in the Dockerfile) come from
Renovate, weekly, grouped, and merged automatically for non-major updates once CI passes. The
[Renovate GitHub app](https://github.com/apps/renovate) must be installed on the repository for this to run. The image
is also rebuilt every Monday without the layer cache, so it picks up Alpine and nginx updates even when nothing in
the repository changed.

The sync workflow needs a repository secret `UPSTREAM_SYNC_TOKEN` (a fine-grained personal access token with contents and
pull request write permission), because pull requests created with the default workflow token do not trigger CI.

## Development

Requires Node 22 or newer and pnpm.

```bash
pnpm install
pnpm run dev        # Hexo dev server
pnpm run build      # full production build into public/
node tools/check-site.mjs public
docker build -t reference:dev .
tools/smoke-test.sh reference:dev
```

The Docker build pipeline can also be exercised without Docker by pointing it at scratch directories:

```bash
REFERENCE_APP=$PWD REFERENCE_CONFIG=/tmp/ref/config/site.yml REFERENCE_DATA=/tmp/ref/data \
REFERENCE_RELEASES=/tmp/ref/releases REFERENCE_STATE=/tmp/ref/state REFERENCE_WWW=/tmp/ref/www \
node docker/bin/rebuild.mjs
```

## License

GPL-3.0, the same as upstream. See [LICENSE](LICENSE). Copyright for the cheat sheets remains with their authors.
