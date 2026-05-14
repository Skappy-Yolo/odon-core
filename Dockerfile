# Multi-stage build. Builder compiles TypeScript; the runtime image is
# the slim node:22-alpine with only the production dependencies and the
# compiled JS. No tsx, no source files, no dev tooling in the final image.

FROM node:22-alpine AS builder
WORKDIR /app

# Install all deps (including dev) for the build.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source needed to compile.
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to dist/.
RUN npm run build


# --- runtime image ---
FROM node:22-alpine AS runtime
WORKDIR /app

# tini is the recommended PID 1 for Node containers; it forwards signals
# properly so SIGTERM from Fly reaches Fastify's graceful shutdown path.
RUN apk add --no-cache tini

# Only production deps in the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JavaScript.
COPY --from=builder /app/dist ./dist

# Migration SQL files. src/db/migrate.ts reads from `migrations/` relative
# to the compiled file location, so we put them next to dist/db/migrate.js.
COPY src/db/migrations ./dist/db/migrations

# Run as the unprivileged `node` user that the base image ships.
USER node

# Fly assigns PORT to the listening port via env (defaults to 8080).
# src/index.ts reads PORT from env, so this just documents intent.
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
