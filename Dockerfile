# syntax=docker/dockerfile:1
#
# Self-hosted Reference: cheat sheets for developers, served by nginx.
#
# The final image carries the site generator so that a mounted config
# (/config/site.yml) and user posts (/data/posts) can be built into a new
# release inside the container. See docker/lib/site.mjs.

ARG NODE_VERSION=26
ARG PNPM_VERSION=10.34.5

# --- Build the default site --------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
RUN npm install -g "pnpm@${PNPM_VERSION}"
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
# CI passes the commit sha. A local build gets a hash of the site inputs, so
# that a rebuilt image never reuses releases cached on a mounted /srv.
ARG BUILD_ID=
ENV NODE_ENV=production
RUN if [ -n "${BUILD_ID}" ]; then echo "${BUILD_ID}" > BUILD_ID; \
    else find source themes _config.yml package.json docker tools -type f | sort | xargs cat | sha256sum | cut -c1-16 > BUILD_ID; fi \
    && node tools/vendor.mjs \
    && node docker/bin/rebuild.mjs \
    && node tools/check-site.mjs /srv/www \
    && rm -rf public db.json _multiconfig.yml

# --- Runtime -----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine
RUN apk add --no-cache nginx \
    && mkdir -p /config /data/posts /data/icons /srv \
    && chown -R node:node /config /data /srv

COPY --from=build --chown=node:node /app /app
COPY --from=build --chown=node:node /srv /srv
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx-headers.conf /etc/nginx/reference-headers.conf

ENV NODE_ENV=production \
    REFERENCE_CONFIG=/config/site.yml \
    REFERENCE_DATA=/data \
    REFERENCE_WATCH_INTERVAL=10 \
    REFERENCE_KEEP_RELEASES=3

USER node
WORKDIR /app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

ENTRYPOINT ["/app/docker/entrypoint.sh"]
