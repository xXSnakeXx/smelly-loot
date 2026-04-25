# syntax=docker/dockerfile:1.6
#
# Multi-stage Docker build for Smelly Loot.
#
# Stage layout:
#   - deps:    only resolves package.json + lockfile so this layer is
#              reused unless dependencies change.
#   - builder: builds the Next.js standalone output and prunes prod deps.
#   - runner:  slim production image with the standalone server, the
#              migrations folder, and a non-root user.
#
# The image is intentionally Alpine-based to keep the final size small;
# Next.js 16's standalone output ships with all required runtime deps so
# extra system libraries are not necessary.

ARG NODE_VERSION=20.20.2

############################
# Stage 1 — install deps   #
############################
FROM node:${NODE_VERSION}-alpine AS deps

# corepack ships with Node 20 and exposes the pnpm version pinned in
# package.json without polluting the global toolchain.
RUN corepack enable

WORKDIR /app

# Copy only the manifest + lockfile so this layer is cache-friendly.
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline


############################
# Stage 2 — build          #
############################
FROM node:${NODE_VERSION}-alpine AS builder

RUN corepack enable
WORKDIR /app

# Surface the full source tree on top of the resolved deps.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry inside the build container so no usage data
# leaves a self-hosted deployment.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build


############################
# Stage 3 — runtime        #
############################
FROM node:${NODE_VERSION}-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The official node:alpine image ships with a `node` user at uid/gid
# 1000, which matches the typical first non-root user on a Linux host
# and lets bind-mounted volumes (./data) work without chown gymnastics.

# Copy the assets that Next.js standalone *doesn't* bundle automatically.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# Migrations live alongside the standalone output so the instrumentation
# hook can apply them during server boot without any external tooling.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle

# Persistent state lives on a volume; pre-create the directory so a
# fresh deployment without a host bind mount still works.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

# Lightweight HTTP healthcheck. Uses 127.0.0.1 explicitly because
# `localhost` inside the container resolves to both `::1` and
# `127.0.0.1`, and busybox wget picks IPv6 first — but Next.js's
# standalone server binds to IPv4 only. Hits the default-locale page
# instead of `/` to avoid the 307 redirect that `--spider` rejects.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --quiet --tries=1 -O /dev/null http://127.0.0.1:3000/en || exit 1

# The Next.js standalone server runs migrations through the
# instrumentation hook before opening the HTTP listener, so a single
# foreground process is enough to bind the container's lifecycle to
# the application.
CMD ["node", "server.js"]
