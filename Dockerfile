# syntax=docker/dockerfile:1
#
# App image for api-v1 / api-v2 (one build emits both entry points). Prod-only
# deps, dist only — no dev deps, no src. Migrations run from a separate image
# (Dockerfile.migrate), so nothing here needs ts-node.

# ---- build ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
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
