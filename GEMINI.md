# 🇪🇺 PlatformaFinantare.eu - AI-Powered EU Funding Platform

## Project Overview
**PlatformaFinantare.eu** is a sophisticated, AI-driven platform designed to assist Romanian organizations in preparing and optimizing EU funding applications. It leverages a multi-provider AI architecture (Claude, GPT, Gemini) to provide high-quality document analysis, grant matching, and proposal generation with a specific focus on Romanian bureaucratic and legal context.

## Core Tech Stack
- **Frontend/Backend:** [Next.js 14](https://nextjs.org) (App Router) with TypeScript 5.x.
- **Styling:** TailwindCSS + shadcn/ui.
- **Database:** PostgreSQL 16 (via [Drizzle ORM](https://orm.drizzle.team)).
- **Vector Database:** Qdrant (for RAG pipeline).
- **Caching/State:** Redis 7 (Sessions, Rate Limiting) + Zustand + TanStack Query.
- **AI Integration:** [Vercel AI SDK](https://sdk.vercel.ai), OpenAI, Anthropic, Google Gemini.
- **Infrastructure:** Docker, Kubernetes (k3s), Terraform, GitHub Actions.

## Building and Running
The main application is located in the `app/` directory.

### Prerequisites
- Node.js >= 20.0.0
- Docker (for local database/services)

### Setup & Development
```bash
# Install dependencies
cd app
npm install

# Setup environment variables (refer to .env.example)
cp .env.example .env.local

# Database migrations
npm run db:generate
npm run db:push

# Start development server
npm run dev
```

### Testing & Validation
```bash
# Run tests (Vitest)
npm test

# Type checking
npm run typecheck

# Linting
npm run lint

# Security audit
../scripts/security-audit.sh
```

### Production Build
```bash
npm run build
npm run start
```

## AI Architecture & Migration Strategy
The project is currently undergoing a **Multi-Agent Migration** (Phase 3) to move 25+ AI modules to a multi-provider system for cost optimization and redundancy.

- **Multi-Provider System:** Dynamically routes tasks between Claude 3.5 Sonnet (Compliance), GPT-4 (Matching), and Gemini (Review/Quality).
- **RAG Pipeline:** Uses Qdrant to store embeddings of EU regulations, Romanian legislation, and applicant guides.
- **Romanian Specialization:** Custom logic for 100% Romanian detection accuracy and bureaucratic tone optimization.
- **Key Modules:**
    - `generateProposal`: Core logic for drafting funding applications.
    - `analyzeDocument`: OCR and semantic analysis of legal/technical docs.
    - `matchGrants`: Semantic matching between organization profiles and active funding calls.
    - `validateCompliance`: automated checks against EU and national eligibility criteria.

## Development Conventions
- **Strict Typing:** All new code must be fully typed with TypeScript.
- **Atomic Components:** Follow shadcn/ui patterns for UI components.
- **Validation:** Use `zod` for all input/output validation (API and Forms).
- **Testing:** New features require Vitest unit/integration tests.
- **Security:** AES-256 for data at rest, TLS 1.3 in transit, and strict CSP headers.

## Key Directory Structure
- `app/src/lib/ai/`: Multi-provider AI orchestration, providers, and specialized engines.
- `app/src/lib/rag/`: Retrieval-Augmented Generation logic and vector search.
- `app/src/lib/db/`: Database schema (Drizzle) and migration scripts.
- `docs/`: Comprehensive architectural, data model, and PRD documentation.
- `infrastructure/`: Terraform, Kubernetes, and Docker configuration files.
- `compliance/`: Legal and technical documentation for SEAP/GDPR compliance.
- `scripts/`: Utility scripts for deployment, security audits, and health checks.

## Current Focus (February 2026)
- **Phase A Migration:** Migrating `generateProposal`, `analyzeDocument`, and `matchGrants` to the multi-provider system.
- **Cost Optimization:** Targeting ~73% reduction in LLM costs while maintaining Romanian language accuracy.
- **Vector Indexing:** Scaling Qdrant collections for the 2021-2027 programming period documents.
