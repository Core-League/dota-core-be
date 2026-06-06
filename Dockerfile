# syntax=docker/dockerfile:1
#
# App image for migrate / api-v1 / api-v2 (one build emits both entry points).
# Prod-only deps, dist only — no dev deps, no src. The `migrate` service reuses
# this same image and runs migrations from compiled .js via the prod `typeorm`
# bin, so nothing here needs ts-node.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
# Copy only what `nest build` reads, so editing docs/compose/etc. doesn't bust
# this layer and force a recompile. Add a COPY line if a new build input appears
# at the repo root (e.g. another tsconfig.*).
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Overridden per-service in docker-compose.yml.
CMD ["node", "dist/entry-points/http/api-v1/main"]
