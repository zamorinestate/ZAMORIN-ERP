# Production Dockerfile — Zamorin Cafe ERP (v1.2.0)
#
# NOTE: directory names are lowercase (`backend/`, `frontend/`). A previous
# revision used `Backend/` / `Frontend/`, which only built on case-insensitive
# filesystems (macOS/Windows) and failed on Linux with:
#   COPY failed: file not found in build context or excluded by .dockerignore: backend/package.json
#
# Scope: this image runs the API only. The web UI is served as static files by
# the separate caddy container defined in docker-compose.yml.

# ---------- Stage 1: install production dependencies ----------
FROM node:24-alpine AS deps

WORKDIR /app/backend

# Alpine ships no tzdata, so the TZ=Asia/Kolkata below would silently resolve
# to UTC. The backend schedules daily closes, GST periods and payroll on IST
# dates, so the zone data has to actually be present.
RUN apk add --no-cache tzdata

COPY backend/package.json backend/package-lock.json ./

# `--only=production` is deprecated in npm 7+; `--omit=dev` is the supported form.
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: runtime image ----------
FROM node:24-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache tzdata \
    && addgroup -S zamorin && adduser -S -G zamorin zamorin

COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY backend ./backend

# companyIdentityService.js reads this SVG at runtime for official letterheads.
# It is guarded by fs.existsSync with an inline fallback, but shipping the real
# asset keeps branded exports intact. Only the one file is needed, not the
# ~15MB of frontend assets.
COPY frontend/src/assets/zamorin-logo-horizontal.svg ./frontend/src/assets/zamorin-logo-horizontal.svg

# LOCAL storage driver (PRIVATE_STORAGE_DRIVER=local) writes uploads here.
RUN mkdir -p /app/backend/uploads && chown -R zamorin:zamorin /app

ENV NODE_ENV=production \
    PORT=4000 \
    TZ=Asia/Kolkata

USER zamorin

# API only — the 3000 port belongs to the caddy frontend container.
EXPOSE 4000

# /health/live is DB-independent, so a Mongo blip does not kill the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/src/scripts/startProd.js"]
