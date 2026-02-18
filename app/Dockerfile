# ═══════════════════════════════════════════════════════════════════
# FondEU Platform — Production Dockerfile
# ═══════════════════════════════════════════════════════════════════
FROM node:22-alpine AS base
WORKDIR /app

# ── Dependencies ──
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ── Builder ──
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Dummy DATABASE_URL for build-time (Drizzle needs it at import)
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── Production ──
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy drizzle migrations for runtime
COPY --from=builder /app/src/lib/db/migrations ./src/lib/db/migrations

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
