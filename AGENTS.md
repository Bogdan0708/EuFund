# Repository Guidelines

## Project Structure & Module Organization
Primary application code lives in `app/` (Next.js + TypeScript).
- `app/src/app/`: App Router pages, layouts, and API routes (`api/**/route.ts`).
- `app/src/components/`: UI and feature components.
- `app/src/lib/`: business logic (AI, integrations, auth, DB, validation).
- `app/tests/` and `app/src/__tests__/`: Vitest test suites.
- `app/drizzle/` and `app/src/lib/db/migrations/`: schema and migration SQL.

Operational assets are at repo root: `scripts/` (deploy/security utilities), `infrastructure/` (Docker, Terraform, K8s), `monitoring/`, and `docs/`.

## Build, Test, and Development Commands
Run app commands from `app/`:
- `npm run dev`: start local dev server on port 3000.
- `npm run build` / `npm run start`: production build and runtime check.
- `npm run lint`: Next.js ESLint checks.
- `npm run typecheck`: strict TypeScript validation (`noEmit`).
- `npm test` or `npm run test:watch`: run Vitest once or watch mode.
- `npm run db:generate && npm run db:push`: generate and apply Drizzle schema updates.

Repo-level helpers:
- `./scripts/security-audit.sh`: security audit workflow.
- `docker compose up -d`: local multi-service stack.

## Coding Style & Naming Conventions
Use TypeScript with strict types and 2-space indentation.
- Follow ESLint config: `next/core-web-vitals` + `next/typescript`.
- Keep reusable logic in `src/lib/*`; keep routes thin.
- Use `PascalCase` for React component files (e.g., `ProposalWizard.tsx`).
- Use kebab-case for utility/service modules (e.g., `rate-limit.ts`).
- Preserve Next.js naming (`page.tsx`, `layout.tsx`, `route.ts`).

## Testing Guidelines
Vitest is the default framework (`app/vitest.config.ts`, Node environment).
- Name tests `*.test.ts` or `*.test.tsx`.
- Place integration coverage in `app/tests/integration` or `app/tests/integrations`.
- Add/adjust tests for each behavior change; include API and validation edge cases.
- Run `npm test`, `npm run lint`, and `npm run typecheck` before opening a PR.

## Commit & Pull Request Guidelines
Commit style in history follows Conventional Commits:
- `feat(scope): ...`, `fix(scope): ...`, `test: ...`, `chore: ...`.
- Keep commits focused and atomic; include schema/migration changes in the same PR when required.

PRs should include:
- clear summary, impact, and rollback notes;
- linked issue/task;
- test evidence (command outputs) and screenshots for UI changes;
- explicit callouts for env vars, secrets, or migration steps.

## Security & Configuration Tips
- Never commit secrets; use `.env.example` and `app/.env.example` as templates.
- Pre-commit gitleaks is configured via `.pre-commit-config.yaml`; run hooks locally before pushing.
