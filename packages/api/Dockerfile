# ── Stage 1: Builder ────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache python3 make g++ sqlite-dev && \
    npm install --omit=dev
COPY src/ ./src/

# ── Stage 2: Runtime ───────────────────────────────────────
FROM node:20-alpine

ARG COCKPIT_VERSION=0.0.0
ARG COCKPIT_EDITION=ce
ARG DOCKER_GID=988

# OCI image labels
LABEL org.opencontainers.image.title="Lagoon Cockpit API"
LABEL org.opencontainers.image.description="Mobile-first Docker infrastructure management API"
LABEL org.opencontainers.image.version="${COCKPIT_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/Lagoon-Tech-Systems/lagoon-cockpit"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"
LABEL org.opencontainers.image.vendor="Lagoon Tech Systems"

WORKDIR /app

# Minimal runtime deps only. npm, npx, corepack and yarn are removed: the runtime only
# runs `node src/index.js`, and the base image's bundled npm carried most of the image's
# HIGH/CRITICAL findings (e.g. its own tar 6.2.1, CVE-2026-59873).
# `apk upgrade` pulls Alpine security fixes that the node base tag has not picked up yet
# (e.g. OpenSSL 3.5.6 -> 3.5.9 for CVE-2026-14456 and CVE-2026-45447).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* && \
    apk upgrade --no-cache && \
    apk add --no-cache sqlite wget && \
    addgroup -g ${DOCKER_GID} docker-host && \
    addgroup node docker-host && \
    mkdir -p /app/data /app/extensions && \
    chown -R node:node /app/data /app/extensions

# Copy only what's needed from builder (no build tools)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV COCKPIT_EDITION=${COCKPIT_EDITION}

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health | grep -q '"status":"ok"' || exit 1

CMD ["node", "src/index.js"]
