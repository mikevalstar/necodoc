# syntax=docker/dockerfile:1
# ADR 0025: one Dockerfile, three runtime targets.
#   docker build --target api  -t necodoc-api .   # ROLE=api | worker | all
#   docker build --target app  -t necodoc-app .   # SPA + /api proxy
#   docker build --target site -t necodoc-site .  # marketing site

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS pnpm
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# Matches packageManager in package.json.
RUN npm install --global --allow-scripts=pnpm pnpm@12.5.1
WORKDIR /repo

# Every workspace dependency, fetched from the lockfile alone so this layer survives source edits.
FROM pnpm AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm patchedDependencies (pnpm-workspace.yaml) are part of the lockfile's inputs.
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline

FROM deps AS api-build
RUN pnpm --filter @necodoc/api build \
  && pnpm --filter @necodoc/api deploy --prod --legacy /out/api \
  && rm -rf /out/api/src /out/api/data \
  && cp -r apps/api/dist apps/api/drizzle /out/api/ \
  # playwright-core has no dependencies; copied alone so the Chromium layer caches across code changes.
  && cp -rL /out/api/node_modules/playwright-core /out/playwright-core

FROM deps AS app-build
RUN pnpm --filter @necodoc/app build

FROM deps AS site-build
RUN pnpm --filter @necodoc/web build

# --- api: the API and render worker (ADR 0020) ---
FROM node:${NODE_VERSION}-bookworm-slim AS api
ENV NODE_ENV=production \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  PORT=3000 \
  STORAGE_DIR=/data/files
# The Chromium headless shell revision this playwright-core expects, its libraries and fonts.
COPY --from=api-build /out/playwright-core /opt/playwright-core
RUN apt-get update \
  && apt-get install --yes --no-install-recommends tini \
  && node /opt/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /opt/playwright-core /var/lib/apt/lists/* \
  && mkdir -p /data/files && chown -R node:node /data
WORKDIR /app
COPY --from=api-build /out/api ./
COPY deploy/docker/migrate.mjs ./migrate.mjs
COPY deploy/docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["/usr/bin/tini", "--", "docker-entrypoint.sh"]
CMD ["serve"]

# --- app: the SPA, with /api proxied to the API ---
FROM nginxinc/nginx-unprivileged:1.29-alpine AS app
# NGINX_ENTRYPOINT_LOCAL_RESOLVERS: the image fills NGINX_LOCAL_RESOLVERS from /etc/resolv.conf.
ENV API_URL=http://api:3000 NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=app-build /repo/apps/app/dist /usr/share/nginx/html
EXPOSE 8080

# --- site: the static marketing site ---
FROM nginxinc/nginx-unprivileged:1.29-alpine AS site
COPY --from=site-build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
