# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FondEU (PlatformaFinantare.eu) — AI-powered platform for Romanian organizations to prepare EU funding applications. Built with Next.js 14 App Router, TypeScript, Drizzle ORM + PostgreSQL, NextAuth v5 beta, next-intl (ro/en).

## Commands

All commands run from the `app/` directory:

```bash
# Development
npm run dev              # Start dev server (port 3000)
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint (next lint)
npm run typecheck        # tsc --noEmit

# Tests (Vitest)
npm run test             # Run all tests once
npm run test:watch       # Watch mode
npx vitest run path/to/file.test.ts  # Single test file

# Database (Drizzle ORM)
npm run db:generate      # Generate migration from schema changes
npm run db:push          # Push schema directly (dev)
npm run db:migrate       # Run migrations (production, uses .env.production)
npm run db:studio        # Visual DB editor
npm run db:seed          # Seed data (dev, uses .env.local)

# Docker
npm run docker:build     # Build production image
npm run docker:run       # Run container (port 8080)
```

## Architecture

### Directory Layout

```
app/src/
├── app/
│   ├── [locale]/           # i18n wrapper (ro/en)
│   │   ├── (auth)/         # Public auth pages (autentificare, inregistrare, resetare-parola)
│   │   ├── (dashboard)/    # Protected app pages (panou, proiecte, finantari, etc.)
│   │   └── layout.tsx      # Root locale layout (NextIntlClientProvider, CSP nonce)
│   └── api/
│       ├── auth/           # NextAuth + register, verify-email, forgot/reset-password
│       ├── ai/             # AI endpoints (generate-proposal, match-grants, chat, etc.)
│       ├── billing/        # Stripe (checkout, portal, pricing, info)
│       ├── v1/             # REST resources (organizations, projects, work-packages)
│       ├── integrations/   # External APIs (eurlex, cordis, eurostat, onrc, qes)
│       └── webhooks/       # Stripe webhook handler
├── lib/
│   ├── db/schema.ts        # Drizzle schema (all tables, enums, relations)
│   ├── db/index.ts         # DB connection (exports `db`, `schema`)
│   ├── auth/index.ts       # NextAuth config (Credentials provider, JWT strategy)
│   ├── auth/edge.ts        # Edge-safe session decode (manual JWT, no eval)
│   ├── auth/session.ts     # getUser(), requireUser(), getUserOrganizations()
│   ├── ai/                 # AI modules (client, orchestrator, generators, analyzers)
│   ├── errors/index.ts     # FondEUError class with bilingual messages
│   ├── middleware/          # auth.ts (withAIAuth), rate-limit.ts, tier-gate.ts
│   ├── email/              # Nodemailer transporter, templates, verification, reset
│   ├── redis/client.ts     # ioredis connection
│   ├── security/nonce.ts   # getNonce() for server components
│   ├── legal/audit.ts      # logAudit() — GDPR audit trail
│   ├── integrations/       # External API clients (eurlex, cordis, onrc, stripe, mysmis)
│   └── i18n.ts             # next-intl config (locales: ro, en; default: ro)
├── components/             # React components organized by domain
├── messages/               # ro.json, en.json (i18n strings)
└── middleware.ts            # Global edge middleware (CSP, CSRF, auth gates)
```

### Key Patterns

**Error handling**: Use `FondEUError` from `@/lib/errors`. Factory methods: `Errors.validation()`, `Errors.notFound()`, etc. Convert to response with `.toResponse(locale)`.

**API route auth**: AI endpoints use `withAIAuth()` HOF which checks session, user tier, and Redis-based rate limits. Generic routes use `withRateLimit()`.

**CSRF**: Double-submit cookie pattern. Middleware sets `csrf-token` httpOnly cookie and `X-CSRF-Token` response header. Clients send token back in `X-CSRF-Token` request header.

**CSP nonce**: Middleware generates `crypto.randomUUID()`, passes via `x-nonce` request header. Server components read via `getNonce()` from `@/lib/security/nonce`. Layout injects it into `NextIntlClientProvider`.

**Audit logging**: `logAudit()` from `@/lib/legal/audit` for GDPR compliance. Track: userId, action, resource, resourceId, ipAddress, userAgent.

**Password hashing**: bcryptjs with cost factor 12.

**Token TTLs**: Email verification = 24h, password reset = 1h.

**Redis rate limiting**: Fail-closed for AI endpoints (503 if Redis unavailable), preventing unmetered AI usage. Check `isRedisAvailable()` in `@/lib/middleware/auth.ts`.

### Routing Conventions

- Romanian page paths: `/ro/autentificare`, `/ro/inregistrare`, `/ro/resetare-parola`, `/ro/panou`, `/ro/proiecte`
- Page routes use Romanian names in `(dashboard)` group: `panou` (dashboard), `proiecte` (projects), `finantari` (funding), `documente` (documents), `legislatie` (legislation), `setari` (settings)
- API routes use English: `/api/ai/*`, `/api/auth/*`, `/api/v1/*`
- Public paths must be listed in `middleware.ts` `publicPaths` array (both locale variants and API routes)

### Database

- Schema in `app/src/lib/db/schema.ts` — PostgreSQL enums use Romanian values (e.g., `'ciorna'`, `'in_lucru'`, `'deschis'`)
- All IDs are UUID with `defaultRandom()`
- Soft deletes via `deletedAt` timestamp where applicable
- Path alias: `@/*` maps to `app/src/*`

### i18n

- Locales: `ro` (default), `en`
- Messages in `app/src/messages/ro.json` and `en.json`
- Server components use `useTranslations()` from next-intl
- All user-facing error messages must be bilingual (messageRo + messageEn in FondEUError)

### AI Providers

Multi-provider setup: OpenAI (primary generation/analysis), Anthropic (alternative), Google (alternative). Configuration in `app/src/lib/ai/config.ts`. Rate limits per feature (proposals: 10/day, docs: 20/day, grants: 50/day).

### External Integrations

EU data: EurLex, CORDIS, Eurostat, EC Portal. Romanian: ONRC (company registry), ANAF (tax), MySMIS (project management system with XML export). All clients in `app/src/lib/integrations/`.
