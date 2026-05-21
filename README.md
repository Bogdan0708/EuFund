<!--
  Save this file as README.md at the root of github.com/Bogdan0708/EuFund
  (replace the current 466-byte placeholder).
-->

# EuFund · PlatformaFinantare.eu

> AI-powered EU funding & project-management platform for Romanian SMEs and municipalities. Multi-agent discovery, eligibility, drafting, and compliance review on a deterministic workflow spine.

<p>
  <img alt="status: active development" src="https://img.shields.io/badge/status-active%20development-8A9A7B?style=flat-square" />
  <img alt="stack: next.js 14" src="https://img.shields.io/badge/Next.js-14-000?style=flat-square&logo=next.js" />
  <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="postgres" src="https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql&logoColor=white" />
  <img alt="qdrant" src="https://img.shields.io/badge/Qdrant-1.12-DC382D?style=flat-square" />
  <img alt="docker" src="https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img alt="deploy: cloud run" src="https://img.shields.io/badge/Deploy-Cloud%20Run-4285F4?style=flat-square&logo=googlecloud&logoColor=white" />
</p>

---

## What it does

EuFund automates the work a Romanian SME or municipality currently outsources to a consultant: **finding** relevant EU and national funding programmes, **qualifying** projects against eligibility rules with cited evidence, **drafting** proposal sections from approved organisational context, and **reviewing** the result against budget and call requirements before submission.

It is not a chat product. It is a four-stage pipeline that produces structured, citable artefacts a human can sign.

```
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────────┐
   │ DISCOVERY   │ →  │ ELIGIBILITY │ →  │ DRAFTING    │ →  │ COMPLIANCE   │
   │ RAG over    │    │ Structured  │    │ Section-by- │    │ Cross-checks │
   │ EU + nat'l  │    │ checklist + │    │ section gen │    │ vs. call +   │
   │ programmes  │    │ evidence    │    │ + retrieval │    │ budget       │
   └─────────────┘    └─────────────┘    └─────────────┘    └──────────────┘
```

---

## Table of contents

- [Architecture](#architecture)
- [Stack](#stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Security](#security)
- [Testing](#testing)
- [Design decisions](#design-decisions)
- [Case study](#case-study)
- [Author](#author)

---

## Architecture

```
                        ┌──────────────────────────────────────────────┐
                        │                Next.js 14 UI                 │
                        │   App Router · RSC · streaming · next-intl   │
                        └────────────────────┬─────────────────────────┘
                                             │ Server Actions + REST + SSE
                                             ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │                       Next.js server runtime                        │
        │                                                                     │
        │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
        │  │  Workflow state  │  │  LLM orchestrator│  │  Retrieval layer │  │
        │  │  (deterministic) │  │  (multi-provider)│  │  (Qdrant + SQL)  │  │
        │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
        │           │                     │                     │            │
        │           ▼                     ▼                     ▼            │
        │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
        │  │  PostgreSQL 16   │  │  Claude · OpenAI │  │  Qdrant 1.12     │  │
        │  │  + RLS + Drizzle │  │  Gemini · MCP    │  │  (vector store)  │  │
        │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
        │                                                                     │
        │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
        │  │  Redis           │  │  Structured-out  │  │  Sentry          │  │
        │  │  (jobs, cache)   │  │  validator + Zod │  │  (observability) │  │
        │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
        └─────────────────────────────────────────────────────────────────────┘
                                             │
                                             ▼
                              Docker · Cloud Build · Cloud Run
```

### Why this shape

- **Deterministic workflow spine, LLM-driven reasoning.** The pipeline is state-machine, not free-roaming agent. The model decides *content*; the system controls *flow*. Reliable, debuggable, and the only thing an auditor will accept on compliance work.
- **Structured outputs as a contract.** Every stage that produces structured data is validated against a Zod schema; the orchestrator retries with the validator error appended on failure.
- **Citation enforcement at the schema level.** Eligibility claims and compliance findings ship with span pointers to source documents. Outputs without citations are rejected at validation.
- **Multi-provider routing.** Each stage declares a primary provider and an explicit fallback. One adapter normalises retries, token accounting, and structured-output validation across Claude, OpenAI, Gemini, and local models.
- **Romanian-first.** UX, prompts, retrieval corpora, and evaluation sets are Romanian-native. English is a translation layer, not the primary surface.

---

## Stack

### Frontend
- **Next.js 14** (App Router) · **TypeScript** · **Tailwind** · **shadcn/ui** (Radix primitives)
- **next-auth v5** for authentication, **next-intl** for i18n (RO + EN)
- **TanStack Query** for client-side data, **Vercel AI SDK** (`ai`, `@ai-sdk/react`) for streaming responses

### LLM & AI
- **Anthropic Claude** (`@anthropic-ai/sdk`) — primary for citation-heavy work
- **OpenAI** (`openai`, `@ai-sdk/openai`) — structured outputs, embeddings
- **Google Gemini** (`@google/generative-ai`) — discovery ranking, classification
- **Model Context Protocol** (`@modelcontextprotocol/sdk`) — agent tooling layer
- Multi-provider router with cost-aware fallback (configured per stage)

### Data layer
- **PostgreSQL 16** with Romanian locale (`ro_RO.utf8`)
- **Drizzle ORM** + `drizzle-kit` for migrations and Studio
- **Row-Level Security** (`src/lib/db/rls.sql`) enforced at the database, not the application
- **Qdrant 1.12** for vector search
- **Redis 7** (via `ioredis`) for jobs and cache
- `lru-cache` for in-process memoisation

### Document processing
- `pdf-parse` for EU programme PDFs
- `mammoth` for DOCX ingestion
- `docxtemplater` for proposal export
- `cheerio` for HTML programme pages

### Security
- `bcryptjs` · `jose` for JWT · `isomorphic-dompurify` for sanitisation
- `gitleaks` pre-commit secret scanning (`.gitleaks.toml`)
- `pre-commit` hooks
- **Sentry** (`@sentry/nextjs`) for production error tracking and performance

### Testing
- **Vitest** — unit + integration
- **Playwright** — end-to-end (configured in `playwright.config.ts`)

### Deployment
- **Docker** + multi-stage `Dockerfile`
- **Google Cloud Build** (`cloudbuild.yaml`, `cloudbuild.production.yaml`)
- **Google Cloud Run** with Cloud SQL (Postgres) and Memorystore (Redis)
- Health check at `/api/health`

### Agent harness
- Separate Python package under `app/agent-harness/fondeu/` for offline agent development, evals, and corpus tooling. The runtime is TypeScript; Python is the lab.

---

## Project structure

```
.
├── app/                          Next.js application (TypeScript)
│   ├── src/
│   │   ├── app/                  App Router routes, layouts, server actions
│   │   ├── components/           UI components (shadcn/ui + custom)
│   │   ├── hooks/                React hooks
│   │   ├── lib/                  Domain logic
│   │   │   └── db/               Drizzle schema, RLS policies, seeds
│   │   ├── messages/             next-intl translation files (RO, EN)
│   │   ├── styles/
│   │   ├── types/
│   │   ├── instrumentation.ts    Sentry / observability hooks
│   │   └── middleware.ts         Auth + locale middleware
│   ├── agent-harness/            Python: offline agent dev + evals (fondeu)
│   ├── drizzle/                  Migration files
│   ├── e2e/                      Playwright specs
│   ├── tests/                    Vitest unit tests
│   ├── scripts/                  Build / migrate / seed / smoke-test helpers
│   ├── docs/                     App-level docs
│   ├── public/
│   ├── Dockerfile
│   ├── drizzle.config.ts
│   ├── next.config.mjs
│   ├── playwright.config.ts
│   ├── vitest.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── compliance/                   Compliance reference material
├── docs/                         Repo-wide docs and architecture notes
├── infrastructure/               Terraform / HCL (cloud infra)
├── monitoring/                   Alerts, dashboards
├── scripts/                      Top-level deploy + security scripts
├── test-results/                 Playwright artefacts
│
├── docker-compose.yml            Local dev: app + postgres + redis + qdrant
├── cloudbuild.yaml               GCP build pipeline
├── cloudbuild.production.yaml    Production build pipeline
├── trigger-config.json           Cloud Build trigger config
│
├── AGENTS.md                     Agent system reference
├── CLAUDE.md                     Project context for Claude Code
├── GEMINI.md                     Project context for Gemini CLI
├── .env.example
├── .gitleaks.toml                Secret scanning config
└── README.md                     ← you are here
```

---

## Getting started

### Prerequisites

- **Node.js ≥ 20**
- **Docker** + **Docker Compose**
- **Google Cloud SDK** (for deployment only)
- API keys for at least one LLM provider (Anthropic, OpenAI, or Gemini)

### Local development

```bash
# 1. Clone and install
git clone https://github.com/Bogdan0708/EuFund.git
cd EuFund/app
npm install

# 2. Configure environment
cp .env.example .env.local
# fill in: DATABASE_URL, REDIS_URL, QDRANT_URL, LLM API keys, NEXTAUTH_SECRET

# 3. Bring up infra (Postgres + Redis + Qdrant)
cd ..
cp .env.example .env.docker
docker compose up -d postgres redis qdrant

# 4. Run migrations and seed
cd app
npm run db:push
npm run db:seed

# 5. Start the dev server
npm run dev
# → http://localhost:3000
```

### Verifying the AI stack

```bash
# Smoke-test the LLM providers
npm run smoke:ai

# Health check
npm run health:check
```

---

## Scripts

| Command                         | What it does                                                       |
| ------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                   | Next.js dev server with hot reload                                 |
| `npm run build`                 | Production build (runs `prebuild:safe` first)                      |
| `npm run start`                 | Run the production build                                           |
| `npm run typecheck`             | TypeScript strict check, no emit                                   |
| `npm run lint`                  | ESLint                                                             |
| `npm run test`                  | Vitest unit suite                                                  |
| `npm run test:watch`            | Vitest in watch mode                                               |
| `npm run test:e2e`              | Playwright E2E suite                                               |
| `npm run test:e2e:ui`           | Playwright UI mode (interactive debugger)                          |
| `npm run db:generate`           | Generate Drizzle migrations from schema                            |
| `npm run db:push`               | Apply schema to dev DB (skip migrations, fast loop)                |
| `npm run db:migrate`            | Run migrations                                                     |
| `npm run db:studio`             | Open Drizzle Studio (DB GUI)                                       |
| `npm run db:seed` / `:seed:prod`| Seed dev / production data                                         |
| `npm run smoke:ai`              | Smoke-test the LLM provider chain                                  |
| `npm run audit:security`        | Run the repo's security audit script                               |
| `npm run audit:prod`            | `npm audit` over production deps                                   |
| `npm run docker:build`          | Build the production Docker image                                  |
| `npm run docker:run`            | Run the production image locally                                   |
| `npm run deploy:gcp`            | Deploy to Google Cloud Run via the repo's deploy script            |
| `npm run analyze`               | Build with bundle analyzer enabled                                 |

---

## Deployment

The default deployment target is **Google Cloud Run**, behind a Cloud Build pipeline.

```bash
# From the app/ directory:
npm run deploy:gcp
```

The pipeline (`cloudbuild.production.yaml`):
1. Lints, typechecks, and runs the unit suite.
2. Builds the Docker image with the production Dockerfile.
3. Pushes to Artifact Registry.
4. Deploys to Cloud Run with traffic-splitting and rollback on health-check failure.
5. Runs `smoke:ai` against the live deployment.

Infrastructure provisioning lives under `infrastructure/` (Terraform). Monitoring dashboards and alerts live under `monitoring/`.

---

## Security

EuFund runs against sensitive applicant data (organisation profiles, financials, IDs). The security posture is:

- **Row-Level Security** at the Postgres layer. Tenant isolation is enforced by the database, not by application code. See `app/src/lib/db/rls.sql`.
- **Secret scanning** via `gitleaks` on every commit (pre-commit hook + `.gitleaks.toml`).
- **Sentry** for error and performance monitoring.
- **Sanitised output** with `isomorphic-dompurify` for any HTML rendered from model output.
- **No autonomous submission.** The system drafts and surfaces; humans submit. There is no path by which the platform can file an application on a user's behalf.
- **Audit log.** Every LLM call is logged with provider, latency, cost, retrieved evidence, and the workflow stage that produced it.

---

## Testing

```bash
npm run test            # unit (Vitest)
npm run test:e2e        # end-to-end (Playwright)
```

The eval harness lives under `app/agent-harness/fondeu/`. It covers:

1. **Retrieval quality** — recall@k on a labelled set of eligibility questions.
2. **Structured-output schema pass rate** — per stage, per provider.
3. **End-to-end "did the draft pass compliance review"** — LLM-as-judge using a different provider from the one that produced the draft.

---

## Design decisions

A few opinionated choices that anyone reading the code should understand up front:

- **Server-first.** Next.js App Router with React Server Components is the default. Client components are used only where interactivity demands them.
- **Drizzle over Prisma.** Drizzle's SQL-first model is a better fit for a system where we lean on Postgres features (RLS, full-text, JSONB) and want type safety without an ORM-imposed query language.
- **Qdrant over pgvector.** Qdrant gives us payload filtering, hybrid search, and named vector spaces per stage (eligibility vs. drafting use different embedding profiles). We accept the operational cost of running a separate service in exchange for retrieval quality.
- **Vercel AI SDK at the edge.** The streaming surface uses `ai` / `@ai-sdk/react`; the deeper orchestration is plain server actions with our own multi-provider router so we can swap providers per stage without rewriting frontend code.
- **MCP for tool use.** The agent layer exposes its tools over the Model Context Protocol so that the same tool surface can be reused by an in-house orchestrator or by external clients (e.g. Claude Desktop) when needed.
- **No fine-tuning yet.** RAG + structured prompting + provider rotation has outperformed early fine-tuning experiments and removed an entire ops surface. Fine-tuning is a future-quarter decision, not a current one.

---

## Case study

A long-form (5-page) case study covering the problem, solution, architecture, technical challenges, business impact, and lessons learned is available alongside this repo: **[`EuFund_Case_Study.pdf`](../EuFund_Case_Study.pdf)**.

Recommended reading order for evaluators:

1. This README (system overview, stack, code structure).
2. The case study (design rationale, trade-offs, "what I'd do differently").
3. `app/src/lib/` (domain logic) and `app/src/app/` (UI surface) if you want to read code.

---

## Author

**Vasile Bogdan Godja** — Applied AI Engineer · founder, sole engineer.

- 📍 London, UK
- 🌐 [Portfolio](https://github.com/Bogdan0708) · [LinkedIn](https://www.linkedin.com/in/vasile-godja-6488051a5)
- 📧 godjabogdan@gmail.com

Background: 10+ years running operations end-to-end across UK hospitality (Marylebone Hotel, London Business School, Fuller's, Mosaic Pub & Dining) and Romanian heritage restoration, including €500K+ in EU-funded projects with full-lifecycle ownership through audit. EuFund is the system I wish I'd had as a consultant ten years ago.

---

<p align="center">
  <sub>EuFund · PlatformaFinantare.eu · © 2026 Vasile Bogdan Godja</sub>
</p>
