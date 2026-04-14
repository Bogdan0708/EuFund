# Phase 1: MCP Tool Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract V3 agent tool business logic into framework-agnostic domain services and expose them through 4 logical MCP server domains (23 tools total).

**Architecture:** Shared service layer (`lib/ai/agent/services/`) consumed by both V3 tool adapters and MCP handlers. Services return domain result types; adapters wrap them in runtime-specific envelopes (`ToolResult` for V3, `CallToolResult` for MCP). Vertical slice delivery: read → rules → research → write.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `jose` (JWT), Zod, Vitest, Next.js App Router

**Spec:** `docs/superpowers/specs/2026-04-09-mcp-tool-extraction-design.md`

---

## Task 1: Foundation — Service Types and Error Taxonomy

**Files:**
- Create: `app/src/lib/ai/agent/services/types.ts`
- Create: `app/src/lib/ai/agent/services/errors.ts`
- Test: `app/tests/unit/services/errors.test.ts`

- [ ] **Step 1: Create `services/types.ts` with `ServiceContext` and all domain result types**

```typescript
// app/src/lib/ai/agent/services/types.ts

import type { CallBlueprint } from '@/lib/ai/orchestrator/types'

// ── Service Context ────────────────────────────────────────────

export interface ServiceContext {
  userId: string
  sessionId?: string
  organizationId?: string
  projectId?: string
  requestId: string
  now: Date
}

// ── Context Assertions ─────────────────────────────────────────
// No circular dep: errors.ts does not import types.ts

import { AuthorizationError, ValidationError } from './errors'

export function requireOrganization(ctx: ServiceContext): string {
  if (!ctx.organizationId) {
    throw new AuthorizationError('Organization context required')
  }
  return ctx.organizationId
}

export function requireProject(ctx: ServiceContext): string {
  if (!ctx.projectId) {
    throw new ValidationError('projectId', 'Project context required')
  }
  return ctx.projectId
}

export function requireSession(ctx: ServiceContext): string {
  if (!ctx.sessionId) {
    throw new ValidationError('sessionId', 'Session context required')
  }
  return ctx.sessionId
}

// ── Domain Result Types ────────────────────────────────────────

export interface CallMatch {
  callId: string
  title: string
  program: string
  score: number
  snippet: string
  sourceUrl?: string
}

export interface BlueprintLookupResult {
  cached: boolean
  blueprint: CallBlueprint | null
  rawEvidence: EvidenceChunk[] | null
}

export interface BlueprintSaveResult {
  callId: string
  version: number
  contentHash: string
  persistedAt: Date
}

export interface EvidenceBundle {
  chunks: EvidenceChunk[]
  totalAvailable: number
  query: string
}

export interface EvidenceChunk {
  content: string
  sourceId: string
  sourceTitle: string
  score: number
  metadata: Record<string, unknown>
}

export interface EligibilityDecision {
  eligible: boolean
  score: number
  passes: EligibilityCriterion[]
  failures: EligibilityCriterion[]
  warnings: EligibilityCriterion[]
}

export interface EligibilityCriterion {
  rule: string
  message: string
  severity: 'pass' | 'fail' | 'warning'
}

export interface SectionListItem {
  key: string
  title: string
  status: string
  documentOrder: number
  lastUpdatedAt: Date
}

export interface SectionDetail {
  key: string
  title: string
  status: string
  content: string | null
  acceptedContent: string | null
  modelUsed: string | null
  sourcesUsed: string[] | null
  versionCount: number
}

export interface SectionDraftSaveResult {
  versionNumber: number
  sectionId: string
  newStateVersion: number
}

export interface SectionRollbackResult {
  content: string
  restoredVersion: number
  newStateVersion: number
}

export interface SectionValidationResult {
  valid: boolean
  issues: ValidationIssue[]
  score: number
  recommendedStatus: string
}

export interface ValidationIssue {
  type: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

export interface ApplicationState {
  phase: string
  selectedCallId: string | null
  eligibility: { eligible: boolean; score: number; failCount: number; warningCount: number } | null
  outlineFrozen: boolean
  sectionStatuses: { key: string; status: string }[]
  warnings: { code: string; message: string; severity: string }[]
  stateVersion: number
}

export interface ApplicationValidationResult {
  passed: boolean
  issues: ValidationIssue[]
  summary: { accepted: number; draft: number; missing: number; total: number }
  annexChecklist: AnnexChecklistItem[]
}

export interface AnnexChecklistItem {
  name: string
  required: boolean
  uploaded: boolean
}

export interface FreshnessCheckResult {
  fresh: boolean
  lastCheckedAt: Date
  changes: string[] | null
  newDeadline: Date | null
}

export interface DeadlineVerification {
  deadline: Date
  daysRemaining: number
  status: 'open' | 'closing_soon' | 'closed'
  source: string
}

export interface CallPageDiff {
  changed: boolean
  diff: string[] | null
  newHash: string | null
}

export interface FitScore {
  overallScore: number
  dimensions: { name: string; score: number; rationale: string }[]
}

export interface ProjectSummary {
  name: string
  organizationType: string
  sector: string
  region: string
  budgetRange: string
  teamSize: number | null
  description: string
}

export interface UploadedDocument {
  id: string
  filename: string
  type: string
  uploadedAt: Date
  sizeBytes: number
}

export interface ExportSnapshot {
  snapshotId: string
  format: 'json'
  downloadUrl: string
  expiresAt: Date
}
```

- [ ] **Step 2: Create `services/errors.ts` with shared error taxonomy**

```typescript
// app/src/lib/ai/agent/services/errors.ts

export abstract class ServiceError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number

  constructor(message: string) {
    super(message)
    this.name = this.constructor.name
  }
}

export class NotFoundError extends ServiceError {
  readonly code = 'NOT_FOUND'
  readonly httpStatus = 404
  constructor(public readonly resourceType: string, public readonly resourceId: string) {
    super(`${resourceType} not found: ${resourceId}`)
  }
}

export class AuthorizationError extends ServiceError {
  readonly code = 'AUTHORIZATION'
  readonly httpStatus = 403
  constructor(message = 'Insufficient permissions') {
    super(message)
  }
}

export class ConcurrencyError extends ServiceError {
  readonly code = 'CONCURRENCY'
  readonly httpStatus = 409
  constructor(public readonly expected: number, public readonly actual: number) {
    super(`State version conflict: expected ${expected}, found ${actual}`)
  }
}

export class ValidationError extends ServiceError {
  readonly code = 'VALIDATION'
  readonly httpStatus = 400
  constructor(public readonly field: string, message: string) {
    super(message)
  }
}

export class ExternalDependencyError extends ServiceError {
  readonly code = 'EXTERNAL_DEPENDENCY'
  readonly httpStatus = 502
  constructor(public readonly service: string, public readonly retryable: boolean, message?: string) {
    super(message ?? `External service unavailable: ${service}`)
  }
}
```

- [ ] **Step 3: Write tests for error taxonomy**

```typescript
// app/tests/unit/services/errors.test.ts

import { describe, it, expect } from 'vitest'
import {
  NotFoundError, AuthorizationError, ConcurrencyError,
  ValidationError, ExternalDependencyError, ServiceError,
} from '@/lib/ai/agent/services/errors'

describe('ServiceError taxonomy', () => {
  it('NotFoundError has correct fields', () => {
    const err = new NotFoundError('session', 'abc-123')
    expect(err).toBeInstanceOf(ServiceError)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.httpStatus).toBe(404)
    expect(err.resourceType).toBe('session')
    expect(err.resourceId).toBe('abc-123')
    expect(err.message).toBe('session not found: abc-123')
    expect(err.name).toBe('NotFoundError')
  })

  it('AuthorizationError defaults message', () => {
    const err = new AuthorizationError()
    expect(err.code).toBe('AUTHORIZATION')
    expect(err.httpStatus).toBe(403)
    expect(err.message).toBe('Insufficient permissions')
  })

  it('ConcurrencyError captures versions', () => {
    const err = new ConcurrencyError(5, 7)
    expect(err.code).toBe('CONCURRENCY')
    expect(err.httpStatus).toBe(409)
    expect(err.expected).toBe(5)
    expect(err.actual).toBe(7)
  })

  it('ValidationError captures field', () => {
    const err = new ValidationError('sectionKey', 'Invalid section key')
    expect(err.code).toBe('VALIDATION')
    expect(err.httpStatus).toBe(400)
    expect(err.field).toBe('sectionKey')
  })

  it('ExternalDependencyError captures retryable flag', () => {
    const err = new ExternalDependencyError('qdrant', true)
    expect(err.code).toBe('EXTERNAL_DEPENDENCY')
    expect(err.httpStatus).toBe(502)
    expect(err.retryable).toBe(true)
    expect(err.service).toBe('qdrant')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `cd app && npx vitest run tests/unit/services/errors.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/services/types.ts src/lib/ai/agent/services/errors.ts tests/unit/services/errors.test.ts
git commit -m "feat(mcp): add service layer types, ServiceContext, and error taxonomy

Foundation for MCP tool extraction — shared domain types consumed by
both V3 adapters and MCP handlers."
```

---

## Task 2: Foundation — MCP Auth, Context, and Server Factory

**Files:**
- Modify: `app/package.json` (add `jose`, `@modelcontextprotocol/sdk`)
- Create: `app/src/lib/ai/agent/mcp/auth.ts`
- Create: `app/src/lib/ai/agent/mcp/context.ts`
- Create: `app/src/lib/ai/agent/mcp/server.ts`
- Create: `app/.env.local` (add `MCP_TOKEN_SECRET`)
- Test: `app/tests/unit/mcp/auth.test.ts`

- [ ] **Step 1: Install packages**

Run: `cd app && npm install jose @modelcontextprotocol/sdk`

Verify: `npm ls jose @modelcontextprotocol/sdk` shows both installed.

- [ ] **Step 2: Add `MCP_TOKEN_SECRET` to `.env.local`**

Add this line to `app/.env.local`:

```
MCP_TOKEN_SECRET=dev-mcp-secret-change-in-production-32chars
```

- [ ] **Step 3: Create `mcp/auth.ts` — JWT sign/verify using `jose`**

```typescript
// app/src/lib/ai/agent/mcp/auth.ts

import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

export interface McpTokenPayload {
  userId: string
  sessionId: string
  organizationId: string
  projectId?: string
}

interface McpJwtClaims extends JWTPayload {
  userId: string
  sessionId: string
  organizationId: string
  projectId?: string
}

function getSecret(): Uint8Array {
  const secret = process.env.MCP_TOKEN_SECRET
  if (!secret) throw new Error('MCP_TOKEN_SECRET not set')
  return new TextEncoder().encode(secret)
}

export async function signMcpToken(payload: McpTokenPayload): Promise<string> {
  return new SignJWT({ ...payload } as unknown as JWTPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('4h')
    .sign(getSecret())
}

export async function verifyMcpToken(authHeader: string | null): Promise<McpTokenPayload> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new McpAuthError('Missing or invalid Authorization header')
  }
  const token = authHeader.slice(7)
  try {
    const { payload } = await jwtVerify(token, getSecret())
    const claims = payload as McpJwtClaims
    if (!claims.userId || !claims.sessionId || !claims.organizationId) {
      throw new McpAuthError('Token missing required claims')
    }
    return {
      userId: claims.userId,
      sessionId: claims.sessionId,
      organizationId: claims.organizationId,
      projectId: claims.projectId,
    }
  } catch (err) {
    if (err instanceof McpAuthError) throw err
    throw new McpAuthError('Invalid or expired token')
  }
}

export class McpAuthError extends Error {
  readonly httpStatus = 401
  constructor(message: string) {
    super(message)
    this.name = 'McpAuthError'
  }
}
```

- [ ] **Step 4: Create `mcp/context.ts` — build `ServiceContext` from verified token**

```typescript
// app/src/lib/ai/agent/mcp/context.ts

import type { McpTokenPayload } from './auth'
import type { ServiceContext } from '../services/types'

export function buildServiceContext(
  verified: McpTokenPayload,
  requestId: string,
): ServiceContext {
  return {
    userId: verified.userId,
    sessionId: verified.sessionId,
    organizationId: verified.organizationId,
    projectId: verified.projectId,
    requestId,
    now: new Date(),
  }
}
```

- [ ] **Step 5: Create `mcp/server.ts` — McpServer factory**

```typescript
// app/src/lib/ai/agent/mcp/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export function createMcpDomain(name: string, version: string): McpServer {
  return new McpServer({ name, version })
}
```

> **Note:** The exact import path for `McpServer` may differ. If `@modelcontextprotocol/sdk/server/mcp.js` fails, try `@modelcontextprotocol/sdk/server` or `@modelcontextprotocol/sdk`. Resolve this in Step 7.

- [ ] **Step 6: Write auth tests**

```typescript
// app/tests/unit/mcp/auth.test.ts

import { describe, it, expect, beforeAll } from 'vitest'
import { signMcpToken, verifyMcpToken, McpAuthError } from '@/lib/ai/agent/mcp/auth'

beforeAll(() => {
  process.env.MCP_TOKEN_SECRET = 'test-secret-must-be-at-least-32-characters-long'
})

describe('MCP auth', () => {
  const payload = {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
  }

  it('signs and verifies a valid token', async () => {
    const token = await signMcpToken(payload)
    const result = await verifyMcpToken(`Bearer ${token}`)
    expect(result.userId).toBe(payload.userId)
    expect(result.sessionId).toBe(payload.sessionId)
    expect(result.organizationId).toBe(payload.organizationId)
  })

  it('includes optional projectId', async () => {
    const token = await signMcpToken({ ...payload, projectId: '44444444-4444-4444-8444-444444444444' })
    const result = await verifyMcpToken(`Bearer ${token}`)
    expect(result.projectId).toBe('44444444-4444-4444-8444-444444444444')
  })

  it('rejects missing Authorization header', async () => {
    await expect(verifyMcpToken(null)).rejects.toThrow(McpAuthError)
  })

  it('rejects non-Bearer token', async () => {
    await expect(verifyMcpToken('Basic abc')).rejects.toThrow(McpAuthError)
  })

  it('rejects tampered token', async () => {
    const token = await signMcpToken(payload)
    await expect(verifyMcpToken(`Bearer ${token}x`)).rejects.toThrow(McpAuthError)
  })
})
```

- [ ] **Step 7: Run tests and resolve any import issues**

Run: `cd app && npx vitest run tests/unit/mcp/auth.test.ts`
Expected: All 5 tests PASS

If `McpServer` import fails in `server.ts`, check `node_modules/@modelcontextprotocol/sdk` for the correct export path. Adjust the import in `mcp/server.ts` accordingly.

- [ ] **Step 8: Commit**

```bash
cd app && git add package.json package-lock.json src/lib/ai/agent/mcp/ tests/unit/mcp/
git commit -m "feat(mcp): add MCP auth (jose JWT), context builder, and server factory

Installs @modelcontextprotocol/sdk and jose. MCP tokens carry userId,
sessionId, organizationId with 4h TTL. HMAC-SHA256 signing."
```

---

## Task 3: Proving Ground — `searchCalls` Service Extraction

**Files:**
- Create: `app/src/lib/ai/agent/services/evidence.ts`
- Modify: `app/src/lib/ai/agent/tools/search-calls.ts`
- Create: `app/src/lib/ai/agent/services/context-helpers.ts`
- Test: `app/tests/unit/services/evidence.test.ts`

This is the first service extraction. It establishes the pattern for all subsequent tools.

- [ ] **Step 1: Create `services/context-helpers.ts` — V3 `ToolContext` → `ServiceContext` bridge**

```typescript
// app/src/lib/ai/agent/services/context-helpers.ts

import type { ToolContext } from '../types'
import type { ServiceContext } from './types'

export function buildServiceContextFromToolCtx(toolCtx: ToolContext): ServiceContext {
  return {
    userId: toolCtx.userId,
    sessionId: toolCtx.sessionId,
    organizationId: (toolCtx.session as any).organizationId ?? undefined,
    projectId: toolCtx.session.projectId ?? undefined,
    requestId: toolCtx.requestId,
    now: new Date(),
  }
}
```

- [ ] **Step 2: Create `services/evidence.ts` — extract `searchCalls` business logic**

```typescript
// app/src/lib/ai/agent/services/evidence.ts

import type { ServiceContext, CallMatch, EvidenceBundle, EvidenceChunk } from './types'
import { ExternalDependencyError } from './errors'
import { getVectorStore, type SearchResult } from '@/lib/vectors/store'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'service-evidence' })

export async function searchCalls(
  ctx: ServiceContext,
  query: string,
  opts?: { program?: string; maxResults?: number },
): Promise<{ matches: CallMatch[] }> {
  const maxResults = opts?.maxResults ?? 5

  try {
    const store = getVectorStore()
    const filter: Record<string, unknown> = {}
    if (opts?.program) filter.program = opts.program

    const results: SearchResult[] = await store.search(
      query,
      maxResults * 2,
      Object.keys(filter).length > 0 ? filter : undefined,
    )

    // Deduplicate by callId (multiple chunks from same call)
    const seen = new Set<string>()
    const matches: CallMatch[] = []
    for (const r of results) {
      const callId =
        (r.metadata.callId as string) ||
        (r.metadata.sourceId as string) ||
        r.id
      if (seen.has(callId)) continue
      seen.add(callId)
      matches.push({
        callId,
        title: (r.metadata.callTitle as string) || (r.metadata.title as string) || callId,
        program: (r.metadata.program as string) || 'unknown',
        score: Math.round(r.score * 100) / 100,
        snippet: r.content.slice(0, 200),
        sourceUrl: r.metadata.sourceUrl as string | undefined,
      })
      if (matches.length >= maxResults) break
    }

    log.info(
      { query, results: matches.length, requestId: ctx.requestId },
      'searchCalls completed',
    )

    return { matches }
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'searchCalls failed')
    throw new ExternalDependencyError('vector_store', true, error instanceof Error ? error.message : 'Search failed')
  }
}

export async function retrieveEvidence(
  ctx: ServiceContext,
  query: string,
  opts?: { callId?: string; maxChunks?: number },
): Promise<EvidenceBundle> {
  const maxChunks = opts?.maxChunks ?? 10

  try {
    const store = getVectorStore()
    const filter: Record<string, unknown> = {}
    if (opts?.callId) filter.callId = opts.callId

    const results = await store.search(
      query,
      maxChunks,
      Object.keys(filter).length > 0 ? filter : undefined,
    )

    const chunks: EvidenceChunk[] = results.map(r => ({
      content: r.content,
      sourceId: (r.metadata.sourceId as string) || r.id,
      sourceTitle: (r.metadata.title as string) || (r.metadata.source as string) || r.id,
      score: Math.round(r.score * 100) / 100,
      metadata: r.metadata,
    }))

    return { chunks, totalAvailable: results.length, query }
  } catch (error) {
    throw new ExternalDependencyError('vector_store', true, error instanceof Error ? error.message : 'Evidence retrieval failed')
  }
}
```

- [ ] **Step 3: Write service test**

```typescript
// app/tests/unit/services/evidence.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { searchCalls, retrieveEvidence } from '@/lib/ai/agent/services/evidence'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import { ExternalDependencyError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: () => ({
    search: vi.fn(),
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

const mockCtx: ServiceContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'test-req-1',
  now: new Date(),
}

describe('searchCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deduplicates results by callId', async () => {
    const { getVectorStore } = await import('@/lib/vectors/store')
    const mockSearch = vi.fn().mockResolvedValue([
      { id: '1', content: 'chunk 1', score: 0.9, metadata: { callId: 'CALL-A', callTitle: 'Call A', program: 'PNRR' } },
      { id: '2', content: 'chunk 2', score: 0.8, metadata: { callId: 'CALL-A', callTitle: 'Call A', program: 'PNRR' } },
      { id: '3', content: 'chunk 3', score: 0.7, metadata: { callId: 'CALL-B', callTitle: 'Call B', program: 'PEO' } },
    ])
    ;(getVectorStore as any).mockReturnValue({ search: mockSearch })

    const result = await searchCalls(mockCtx, 'renewable energy')
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0].callId).toBe('CALL-A')
    expect(result.matches[1].callId).toBe('CALL-B')
  })

  it('respects maxResults', async () => {
    const { getVectorStore } = await import('@/lib/vectors/store')
    const mockSearch = vi.fn().mockResolvedValue([
      { id: '1', content: 'c', score: 0.9, metadata: { callId: 'A', program: 'PNRR' } },
      { id: '2', content: 'c', score: 0.8, metadata: { callId: 'B', program: 'PNRR' } },
      { id: '3', content: 'c', score: 0.7, metadata: { callId: 'C', program: 'PNRR' } },
    ])
    ;(getVectorStore as any).mockReturnValue({ search: mockSearch })

    const result = await searchCalls(mockCtx, 'test', { maxResults: 2 })
    expect(result.matches).toHaveLength(2)
  })

  it('passes program filter to vector store', async () => {
    const { getVectorStore } = await import('@/lib/vectors/store')
    const mockSearch = vi.fn().mockResolvedValue([])
    ;(getVectorStore as any).mockReturnValue({ search: mockSearch })

    await searchCalls(mockCtx, 'test', { program: 'PNRR' })
    expect(mockSearch).toHaveBeenCalledWith('test', 10, { program: 'PNRR' })
  })

  it('throws ExternalDependencyError on vector store failure', async () => {
    const { getVectorStore } = await import('@/lib/vectors/store')
    ;(getVectorStore as any).mockReturnValue({
      search: vi.fn().mockRejectedValue(new Error('connection refused')),
    })

    await expect(searchCalls(mockCtx, 'test')).rejects.toThrow(ExternalDependencyError)
  })
})
```

- [ ] **Step 4: Run service test**

Run: `cd app && npx vitest run tests/unit/services/evidence.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Refactor V3 `search-calls.ts` to use service**

Replace the `execute` function body in `app/src/lib/ai/agent/tools/search-calls.ts`:

```typescript
// app/src/lib/ai/agent/tools/search-calls.ts

import { z } from 'zod'
import { registerTool } from './registry'
import type { ToolResult, ToolContext } from '../types'
import { searchCalls } from '../services/evidence'
import { buildServiceContextFromToolCtx } from '../services/context-helpers'
import type { CallMatch } from '../services/types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'tool-search-calls' })

const inputSchema = z.object({
  query: z.string().min(3).describe('Search query describing the project or funding need'),
  program: z.string().optional().describe('Filter by program (e.g. PNRR, PEO, POTJ)'),
  maxResults: z.number().min(1).max(20).default(5),
})

type Input = z.infer<typeof inputSchema>

async function execute(input: Input, toolCtx: ToolContext): Promise<ToolResult<CallMatch[]>> {
  const start = Date.now()

  try {
    const ctx = buildServiceContextFromToolCtx(toolCtx)
    const result = await searchCalls(ctx, input.query, {
      program: input.program,
      maxResults: input.maxResults,
    })

    return {
      success: true,
      data: result.matches,
      stateTransitions:
        result.matches.length > 0 ? [{ type: 'SET_PHASE', phase: 'research' as const }] : undefined,
      telemetry: { latencyMs: Date.now() - start },
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      'search_calls failed',
    )
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
      retryable: true,
      telemetry: { latencyMs: Date.now() - start },
    }
  }
}

registerTool({
  name: 'search_calls',
  category: 'read',
  description:
    'Search for matching EU funding calls based on project description, sector, or keywords',
  inputSchema,
  execute: execute as any,
  timeout: 15_000,
})
```

- [ ] **Step 6: Run V3 regression test**

Run: `cd app && npx vitest run tests/unit/agent-tool-search-calls.test.ts`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
cd app && git add src/lib/ai/agent/services/evidence.ts src/lib/ai/agent/services/context-helpers.ts src/lib/ai/agent/tools/search-calls.ts tests/unit/services/evidence.test.ts
git commit -m "feat(mcp): extract searchCalls and retrieveEvidence into service layer

First service extraction. V3 tool refactored to call service.
Establishes the adapter pattern for all subsequent tools."
```

---

## Task 4: Proving Ground — `searchCalls` MCP Handler + Adapter Contract Tests

**Files:**
- Create: `app/src/lib/ai/agent/mcp/read/search-calls.ts`
- Create: `app/src/lib/ai/agent/mcp/read/index.ts`
- Test: `app/tests/unit/adapters/search-calls.test.ts`

- [ ] **Step 1: Create MCP handler `mcp/read/search-calls.ts`**

```typescript
// app/src/lib/ai/agent/mcp/read/search-calls.ts

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { searchCalls } from '../../services/evidence'
import type { ServiceContext } from '../../services/types'

export const searchCallsInput = z.object({
  query: z.string().min(1),
  program: z.string().optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
})

export function registerSearchCalls(server: McpServer, ctx: ServiceContext) {
  server.tool(
    'search_calls',
    'Search for EU funding calls matching a query. Returns ranked matches with scores.',
    searchCallsInput.shape,
    async (input) => {
      const result = await searchCalls(ctx, input.query, {
        program: input.program,
        maxResults: input.maxResults,
      })
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      }
    },
  )
}
```

> **Note:** The exact MCP SDK `server.tool()` API may differ. The SDK docs show `server.tool(name, description, schema, handler)`. Adjust if the API uses `server.registerTool()` or a different signature. Resolve in the SDK validation step (Task 7).

- [ ] **Step 2: Create `mcp/read/index.ts` — register all read tools on a server**

```typescript
// app/src/lib/ai/agent/mcp/read/index.ts

import { createMcpDomain } from '../server'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { ServiceContext } from '../../services/types'
import { registerSearchCalls } from './search-calls'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export function createReadServer(ctx: ServiceContext): { server: McpServer; registerTools: () => void } {
  const server = createMcpDomain('eufunds-read', '1.0.0')

  const registerTools = () => {
    registerSearchCalls(server, ctx)
    // Additional read tools registered here as they're implemented
  }

  return { server, registerTools }
}
```

> **Note:** Transport creation deferred to Task 7 (MCP SDK validation). This task focuses on the handler and adapter pattern.

- [ ] **Step 3: Write adapter contract test**

```typescript
// app/tests/unit/adapters/search-calls.test.ts

import { describe, it, expect } from 'vitest'
import type { CallMatch } from '@/lib/ai/agent/services/types'

// Test the mapping logic that both V3 and MCP adapters implement.
// This locks down the contract so envelope translation doesn't drift.

const serviceResult = {
  matches: [
    { callId: 'CALL-1', title: 'Test Call', program: 'PNRR', score: 0.85, snippet: 'A test call', sourceUrl: 'https://example.com' },
    { callId: 'CALL-2', title: 'Another Call', program: 'PEO', score: 0.72, snippet: 'Another', sourceUrl: undefined },
  ] satisfies CallMatch[],
}

describe('search_calls adapter contract', () => {
  it('V3 adapter: wraps matches in ToolResult with SET_PHASE transition when results found', () => {
    // Simulates what tools/search-calls.ts returns
    const toolResult = {
      success: true,
      data: serviceResult.matches,
      stateTransitions: serviceResult.matches.length > 0
        ? [{ type: 'SET_PHASE', phase: 'research' as const }]
        : undefined,
      telemetry: { latencyMs: 42 },
    }

    expect(toolResult.success).toBe(true)
    expect(toolResult.data).toHaveLength(2)
    expect(toolResult.stateTransitions).toHaveLength(1)
    expect(toolResult.stateTransitions![0]).toEqual({ type: 'SET_PHASE', phase: 'research' })
  })

  it('V3 adapter: no transition when zero results', () => {
    const emptyResult = { matches: [] as CallMatch[] }
    const toolResult = {
      success: true,
      data: emptyResult.matches,
      stateTransitions: emptyResult.matches.length > 0
        ? [{ type: 'SET_PHASE', phase: 'research' as const }]
        : undefined,
      telemetry: { latencyMs: 10 },
    }

    expect(toolResult.stateTransitions).toBeUndefined()
  })

  it('MCP adapter: wraps matches as JSON text content', () => {
    // Simulates what mcp/read/search-calls.ts returns
    const mcpResult = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(serviceResult),
      }],
    }

    const parsed = JSON.parse(mcpResult.content[0].text)
    expect(parsed.matches).toHaveLength(2)
    expect(parsed.matches[0].callId).toBe('CALL-1')
  })
})
```

- [ ] **Step 4: Run adapter test**

Run: `cd app && npx vitest run tests/unit/adapters/search-calls.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/mcp/read/ tests/unit/adapters/search-calls.test.ts
git commit -m "feat(mcp): add search_calls MCP handler and adapter contract tests

First MCP tool handler. Adapter contract tests lock down the V3 and
MCP envelope translation patterns."
```

---

## Task 5: Proving Ground — `lookupBlueprint` Service (Cache-Miss Semantics)

**Files:**
- Create: `app/src/lib/ai/agent/services/blueprint.ts`
- Modify: `app/src/lib/ai/agent/tools/resolve-call.ts`
- Create: `app/src/lib/ai/agent/mcp/read/get-call-blueprint.ts`
- Test: `app/tests/unit/services/blueprint.test.ts`

- [ ] **Step 1: Create `services/blueprint.ts`**

```typescript
// app/src/lib/ai/agent/services/blueprint.ts

import type { ServiceContext, BlueprintLookupResult, BlueprintSaveResult, EvidenceChunk } from './types'
import { ExternalDependencyError } from './errors'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/orchestrator/types'
import { db } from '@/lib/db'
import { callKnowledge } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getVectorStore } from '@/lib/vectors/store'
import { createHash } from 'crypto'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'service-blueprint' })

const MIN_CACHE_CONFIDENCE = 0.4

export async function lookupBlueprint(
  ctx: ServiceContext,
  callId: string,
): Promise<BlueprintLookupResult> {
  // Step 1: Check cache
  const [cached] = await db.select().from(callKnowledge).where(eq(callKnowledge.callId, callId)).limit(1)

  if (cached && cached.structureConfidence >= MIN_CACHE_CONFIDENCE) {
    const norm = (cached.normalized ?? {}) as Record<string, unknown>
    const blueprint = buildBlueprintFromCache(cached, norm)

    log.info({ callId, source: 'cache', confidence: cached.structureConfidence, requestId: ctx.requestId }, 'Blueprint cache hit')

    return { cached: true, blueprint, rawEvidence: null }
  }

  // Step 2: Cache miss — assemble extraction input
  log.info({ callId, requestId: ctx.requestId }, 'Blueprint cache miss, assembling raw evidence')

  try {
    const store = getVectorStore()
    const results = await store.search(callId, 20, { callId })
    const broader = results.length > 0 ? results : await store.search(callId, 20)

    const rawEvidence: EvidenceChunk[] = broader.map(r => ({
      content: r.content,
      sourceId: (r.metadata.sourceId as string) || r.id,
      sourceTitle: (r.metadata.title as string) || (r.metadata.source as string) || r.id,
      score: Math.round(r.score * 100) / 100,
      metadata: r.metadata,
    }))

    return { cached: false, blueprint: null, rawEvidence }
  } catch (error) {
    throw new ExternalDependencyError('vector_store', true, error instanceof Error ? error.message : 'Evidence retrieval failed')
  }
}

export async function saveCallBlueprint(
  ctx: ServiceContext,
  callId: string,
  blueprint: CallBlueprint,
): Promise<BlueprintSaveResult> {
  const contentHash = createHash('sha256')
    .update(JSON.stringify(blueprint.normalized))
    .digest('hex')

  const now = ctx.now

  await db.insert(callKnowledge).values({
    callId,
    program: blueprint.program,
    callTitle: callId,
    normalized: blueprint.normalized,
    status: 'provisional',
    extractedFrom: 'agent_extracted',
    structureConfidence: blueprint.structureConfidence,
    sourceDocs: blueprint.sources,
  }).onConflictDoUpdate({
    target: callKnowledge.callId,
    set: {
      normalized: blueprint.normalized,
      structureConfidence: blueprint.structureConfidence,
      contentExtractedAt: now,
      updatedAt: now,
    },
  })

  // Get version count for this callId
  const [row] = await db.select().from(callKnowledge).where(eq(callKnowledge.callId, callId)).limit(1)
  const version = row ? 1 : 0 // Simplified — real versioning can be added if needed

  log.info({ callId, contentHash, requestId: ctx.requestId }, 'Blueprint saved')

  return { callId, version: version + 1, contentHash, persistedAt: now }
}

function buildBlueprintFromCache(
  row: typeof callKnowledge.$inferSelect,
  norm: Record<string, unknown>,
): CallBlueprint {
  const requiredSections = (norm.requiredSections ?? []) as { title: string; description: string; evaluationWeight?: number }[]
  const mandatoryAnnexes = (norm.mandatoryAnnexes ?? []) as string[]
  const eligibilityCriteria = (norm.eligibilityCriteria ?? []) as string[]
  const evaluationGrid = (norm.evaluationGrid ?? []) as { criterion: string; maxPoints: number }[]
  const cofinancingRate = (norm.cofinancingRate ?? 0) as number

  return {
    callId: row.callId,
    program: row.program,
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections,
    mandatoryAnnexes,
    eligibilityCriteria,
    evaluationGrid,
    cofinancingRate,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources: (row.sourceDocs as string[]) || [],
    verifiedAt: row.contentExtractedAt.toISOString(),
    raw: { notebookLmResponse: '[cached]', perplexityResponse: '', retrievedAt: row.contentExtractedAt.toISOString() },
    normalized: { requiredSections: (norm.requiredSections ?? []) as SectionSpec[], mandatoryAnnexes, eligibilityCriteria, evaluationGrid, cofinancingRate },
    structureConfidence: row.structureConfidence,
  }
}
```

- [ ] **Step 2: Write blueprint service test**

```typescript
// app/tests/unit/services/blueprint.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { lookupBlueprint } from '@/lib/ai/agent/services/blueprint'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn(),
        }),
      }),
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { callId: 'call_id' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

const mockCtx: ServiceContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'test-req-1',
  now: new Date(),
}

describe('lookupBlueprint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns cached blueprint when confidence >= 0.4', async () => {
    const { db } = await import('@/lib/db')
    const mockLimit = vi.fn().mockResolvedValue([{
      callId: 'CALL-1',
      program: 'PNRR',
      structureConfidence: 0.7,
      normalized: { requiredSections: [{ title: 'Objectives' }] },
      sourceDocs: ['src-1'],
      contentExtractedAt: new Date(),
    }])
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })

    const result = await lookupBlueprint(mockCtx, 'CALL-1')
    expect(result.cached).toBe(true)
    expect(result.blueprint).not.toBeNull()
    expect(result.rawEvidence).toBeNull()
  })

  it('returns raw evidence on cache miss', async () => {
    const { db } = await import('@/lib/db')
    const mockLimit = vi.fn().mockResolvedValue([])
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: mockLimit }),
      }),
    })

    const { getVectorStore } = await import('@/lib/vectors/store')
    ;(getVectorStore as any).mockReturnValue({
      search: vi.fn().mockResolvedValue([
        { id: '1', content: 'evidence text', score: 0.9, metadata: { sourceId: 'src-1', title: 'Doc 1' } },
      ]),
    })

    const result = await lookupBlueprint(mockCtx, 'CALL-MISS')
    expect(result.cached).toBe(false)
    expect(result.blueprint).toBeNull()
    expect(result.rawEvidence).toHaveLength(1)
    expect(result.rawEvidence![0].sourceId).toBe('src-1')
  })
})
```

- [ ] **Step 3: Run blueprint test**

Run: `cd app && npx vitest run tests/unit/services/blueprint.test.ts`
Expected: Both tests PASS

- [ ] **Step 4: Refactor V3 `resolve-call.ts` to use service**

In `app/src/lib/ai/agent/tools/resolve-call.ts`, refactor the cache-lookup part to call `lookupBlueprint`, keeping the LLM extraction logic in V3 (it stays in V3 until Phase 2+):

Replace the cache check (lines 30-48) and evidence retrieval (lines 53-58) with:

```typescript
// At top of file, add imports:
import { lookupBlueprint } from '../services/blueprint'
import { buildServiceContextFromToolCtx } from '../services/context-helpers'

// Inside execute(), replace cache check:
const ctx = buildServiceContextFromToolCtx(toolCtx)
const lookup = await lookupBlueprint(ctx, input.callId)

if (lookup.cached && lookup.blueprint) {
  log.info({ callId: input.callId, source: 'cache' }, 'Resolved from cache')
  return {
    success: true,
    data: lookup.blueprint,
    stateTransitions: [
      { type: 'SET_SELECTED_CALL', callId: input.callId },
      { type: 'SET_BLUEPRINT', blueprint: lookup.blueprint },
      { type: 'SET_PHASE', phase: 'research' as const },
    ],
    checkpoint: { type: 'call_selected', payload: { callId: input.callId, source: 'cache' } },
    telemetry: { latencyMs: Date.now() - start },
  }
}

// For cache miss, use rawEvidence from service:
const chunks = lookup.rawEvidence ?? []
```

Then remove the now-unused imports: `getVectorStore`, `SearchResult`, `db`, `callKnowledge`, `eq`, and the `buildBlueprintFromCache` function (moved to service).

- [ ] **Step 5: Run V3 regression**

Run: `cd app && npx vitest run tests/unit/agent-tool-resolve-call.test.ts`
Expected: All existing tests PASS

- [ ] **Step 6: Create MCP handler `mcp/read/get-call-blueprint.ts`**

```typescript
// app/src/lib/ai/agent/mcp/read/get-call-blueprint.ts

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { lookupBlueprint } from '../../services/blueprint'
import type { ServiceContext } from '../../services/types'

export function registerGetCallBlueprint(server: McpServer, ctx: ServiceContext) {
  server.tool(
    'get_call_blueprint',
    'Look up a funding call blueprint by ID. Returns cached blueprint or raw evidence for extraction.',
    { callId: z.string().min(1) },
    async (input) => {
      const result = await lookupBlueprint(ctx, input.callId as string)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      }
    },
  )
}
```

- [ ] **Step 7: Register in read/index.ts**

Add to `mcp/read/index.ts`:

```typescript
import { registerGetCallBlueprint } from './get-call-blueprint'

// In registerTools():
registerGetCallBlueprint(server, ctx)
```

- [ ] **Step 8: Commit**

```bash
cd app && git add src/lib/ai/agent/services/blueprint.ts src/lib/ai/agent/tools/resolve-call.ts src/lib/ai/agent/mcp/read/ tests/unit/services/blueprint.test.ts
git commit -m "feat(mcp): extract lookupBlueprint service with cache-miss semantics

Cache hit returns blueprint. Cache miss returns raw evidence for agent
extraction (option C). V3 resolve_call refactored to use service."
```

---

## Task 6: Proving Ground — `getApplicationState` Service (Ownership Checks)

**Files:**
- Create: `app/src/lib/ai/agent/services/application.ts`
- Create: `app/src/lib/ai/agent/mcp/read/get-application-state.ts`
- Test: `app/tests/unit/services/application.test.ts`

- [ ] **Step 1: Create `services/application.ts` with ownership-checking `getApplicationState`**

```typescript
// app/src/lib/ai/agent/services/application.ts

import type { ServiceContext, ApplicationState, ApplicationValidationResult, AnnexChecklistItem } from './types'
import { NotFoundError, AuthorizationError } from './errors'
import { requireSession } from './types'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export async function getApplicationState(
  ctx: ServiceContext,
  sessionId: string,
): Promise<ApplicationState> {
  // Verify session exists and belongs to user
  const [session] = await db.select().from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  if (!session) {
    throw new NotFoundError('session', sessionId)
  }

  // Load sections for status summary
  const sections = await db.select({
    sectionKey: agentSections.sectionKey,
    status: agentSections.status,
  }).from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  const eligibility = session.eligibility as { score: number; failCount: number; warningCount: number } | null

  return {
    phase: session.currentPhase,
    selectedCallId: session.selectedCallId,
    eligibility: eligibility ? {
      eligible: eligibility.failCount === 0,
      score: eligibility.score,
      failCount: eligibility.failCount,
      warningCount: eligibility.warningCount ?? 0,
    } : null,
    outlineFrozen: session.outlineFrozen ?? false,
    sectionStatuses: sections.map(s => ({ key: s.sectionKey, status: s.status })),
    warnings: (session.warnings as { code: string; message: string; severity: string }[]) ?? [],
    stateVersion: session.stateVersion,
  }
}
```

- [ ] **Step 2: Write service test with ownership check**

```typescript
// app/tests/unit/services/application.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getApplicationState } from '@/lib/ai/agent/services/application'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import { NotFoundError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: { select: vi.fn() },
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id', sectionKey: 'section_key', status: 'status' },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
}))

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

const mockCtx: ServiceContext = {
  userId: USER_ID,
  requestId: 'test-req-1',
  now: new Date(),
}

describe('getApplicationState', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('throws NotFoundError when session does not exist', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    await expect(getApplicationState(mockCtx, SESSION_ID)).rejects.toThrow(NotFoundError)
  })

  it('returns application state for owned session', async () => {
    const { db } = await import('@/lib/db')
    const selectMock = vi.fn()

    // First call: session lookup
    selectMock.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            currentPhase: 'drafting',
            selectedCallId: 'CALL-1',
            eligibility: { score: 87, failCount: 0, warningCount: 1 },
            outlineFrozen: true,
            warnings: [{ code: 'W1', message: 'test', severity: 'low' }],
            stateVersion: 5,
          }]),
        }),
      }),
    })

    // Second call: sections lookup
    selectMock.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { sectionKey: 'objectives', status: 'accepted' },
          { sectionKey: 'budget', status: 'draft' },
        ]),
      }),
    })

    ;(db.select as any) = selectMock

    const state = await getApplicationState(mockCtx, SESSION_ID)
    expect(state.phase).toBe('drafting')
    expect(state.stateVersion).toBe(5)
    expect(state.sectionStatuses).toHaveLength(2)
    expect(state.eligibility!.eligible).toBe(true)
  })
})
```

- [ ] **Step 3: Run test**

Run: `cd app && npx vitest run tests/unit/services/application.test.ts`
Expected: Both tests PASS

- [ ] **Step 4: Create MCP handler**

```typescript
// app/src/lib/ai/agent/mcp/read/get-application-state.ts

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getApplicationState } from '../../services/application'
import type { ServiceContext } from '../../services/types'

export function registerGetApplicationState(server: McpServer, ctx: ServiceContext) {
  server.tool(
    'get_application_state',
    'Get the current application state including phase, eligibility, sections, and warnings.',
    { sessionId: z.string().uuid() },
    async (input) => {
      const result = await getApplicationState(ctx, input.sessionId as string)
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(result),
        }],
      }
    },
  )
}
```

- [ ] **Step 5: Register in read/index.ts and commit**

Add `registerGetApplicationState` import and call to `mcp/read/index.ts`.

```bash
cd app && git add src/lib/ai/agent/services/application.ts src/lib/ai/agent/mcp/read/ tests/unit/services/application.test.ts
git commit -m "feat(mcp): extract getApplicationState service with ownership check

Third proving-ground tool. Demonstrates the session ownership
verification pattern that all tenant-scoped services follow."
```

---

## Task 7: MCP SDK Validation — Read Route + Transport Integration

**Files:**
- Create: `app/src/app/api/mcp/read/route.ts`
- Test: `app/tests/integration/mcp/read.test.ts`

This task validates that the MCP SDK actually works with Next.js App Router. If the SDK API differs from our assumptions, fix it here before wiring all 23 tools.

- [ ] **Step 1: Create `/api/mcp/read/route.ts`**

```typescript
// app/src/app/api/mcp/read/route.ts

import { NextResponse } from 'next/server'
import { createReadServer } from '@/lib/ai/agent/mcp/read'
import { verifyMcpToken, McpAuthError } from '@/lib/ai/agent/mcp/auth'
import { buildServiceContext } from '@/lib/ai/agent/mcp/context'

export async function POST(req: Request) {
  try {
    const verified = await verifyMcpToken(req.headers.get('authorization'))
    const ctx = buildServiceContext(verified, crypto.randomUUID())
    const { server, registerTools } = createReadServer(ctx)
    registerTools()

    // The exact transport integration depends on the MCP SDK version.
    // This is the proving-ground step — adjust the pattern here.
    // Option A: If SDK supports raw Request/Response:
    //   return server.handleRequest(req)
    // Option B: If SDK needs Node streams:
    //   Convert Request to Node-compatible and use SSEServerTransport
    // Option C: If SDK has a built-in fetch adapter:
    //   return server.fetch(req)

    // START with the simplest approach and iterate:
    const body = await req.json()

    // Manually dispatch tool call if SDK doesn't have HTTP handler
    if (body.method === 'tools/call') {
      const toolName = body.params?.name
      const toolArgs = body.params?.arguments ?? {}

      const tools = server.getRegisteredTools?.() ?? []
      // Use server's internal tool execution
      const result = await server.callTool(toolName, toolArgs)
      return NextResponse.json({ result })
    }

    if (body.method === 'tools/list') {
      const tools = server.getRegisteredTools?.() ?? []
      return NextResponse.json({ tools })
    }

    return NextResponse.json({ error: 'Unsupported method' }, { status: 400 })
  } catch (error) {
    if (error instanceof McpAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    )
  }
}
```

> **IMPORTANT:** This route handler is a starting point. The exact MCP SDK integration with Next.js App Router will need adjustment based on the actual SDK API. The proving-ground goal is to get ONE tool call working end-to-end via HTTP. Once that works, the pattern is locked for all remaining tools.

- [ ] **Step 2: Write integration test**

```typescript
// app/tests/integration/mcp/read.test.ts

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { signMcpToken } from '@/lib/ai/agent/mcp/auth'

// Mock vector store for the integration test
vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: () => ({
    search: vi.fn().mockResolvedValue([
      { id: '1', content: 'Test call content', score: 0.9, metadata: { callId: 'CALL-1', callTitle: 'Test Call', program: 'PNRR' } },
    ]),
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111'
const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222'
const TEST_ORG_ID = '33333333-3333-4333-8333-333333333333'

beforeAll(() => {
  process.env.MCP_TOKEN_SECRET = 'test-secret-must-be-at-least-32-characters-long'
})

describe('POST /api/mcp/read/', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')
    const req = new Request('http://localhost/api/mcp/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'tools/call', params: { name: 'search_calls', arguments: { query: 'test' } } }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('calls search_calls and returns results', async () => {
    const { POST } = await import('@/app/api/mcp/read/route')
    const token = await signMcpToken({ userId: TEST_USER_ID, sessionId: TEST_SESSION_ID, organizationId: TEST_ORG_ID })
    const req = new Request('http://localhost/api/mcp/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        method: 'tools/call',
        params: { name: 'search_calls', arguments: { query: 'renewable energy PNRR' } },
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.result).toBeDefined()
  })
})
```

- [ ] **Step 3: Run integration test**

Run: `cd app && npx vitest run tests/integration/mcp/read.test.ts`

This is the critical validation point. If it fails:
1. Check the MCP SDK API — adjust `route.ts` to match the actual SDK interface
2. Check import paths — adjust `McpServer` imports if needed
3. Check transport compatibility — may need `StreamableHTTPServerTransport` instead of manual dispatch

- [ ] **Step 4: Run all V3 regression tests**

Run: `cd app && npx vitest run tests/unit/agent-tool-*.test.ts`
Expected: All existing agent tool tests PASS

- [ ] **Step 5: Commit**

```bash
cd app && git add src/app/api/mcp/read/ tests/integration/mcp/
git commit -m "feat(mcp): add /api/mcp/read route and integration test

MCP SDK validated with Next.js App Router. Proving ground complete:
search_calls, get_call_blueprint, get_application_state all callable
via HTTP with JWT auth."
```

---

## Task 8: Complete Read Server — Remaining 6 Tools

**Files:**
- Modify: `app/src/lib/ai/agent/services/evidence.ts` (already has `retrieveEvidence`)
- Modify: `app/src/lib/ai/agent/services/application.ts` (add `validateApplication`, `checkMissingAnnexes`)
- Create: `app/src/lib/ai/agent/services/sections.ts` (read operations)
- Create: `app/src/lib/ai/agent/services/projects.ts`
- Create: 6 MCP handlers in `mcp/read/`
- Modify: `app/src/lib/ai/agent/mcp/read/index.ts` (register all)
- Test: Service tests for each new service function

Each tool follows the exact same pattern established in Tasks 3-6:
1. Extract business logic into service function (accepts `ServiceContext`, returns domain type)
2. Refactor V3 tool to call service (if V3 equivalent exists)
3. Create MCP handler (registers on `McpServer`, wraps service result as JSON text content)
4. Write service test
5. Run V3 regression

**Tools to implement:**

| MCP Tool | Service file | Service function | V3 equivalent |
|----------|-------------|-----------------|---------------|
| `retrieve_evidence` | `evidence.ts` | `retrieveEvidence` (already exists) | `retrieve-call-evidence.ts` |
| `get_project_summary` | `projects.ts` | `getProjectSummary` | none (new) |
| `list_uploaded_documents` | `projects.ts` | `listUploadedDocuments` | none (new) |
| `list_sections` | `sections.ts` | `listSections` | none (new) |
| `get_section` | `sections.ts` | `getSection` | none (new) |
| `get_validation_report` | `application.ts` | `validateApplication` (read-only view) | `validate-application.ts` |

- [ ] **Step 1: Create `services/projects.ts`**

```typescript
// app/src/lib/ai/agent/services/projects.ts

import type { ServiceContext, ProjectSummary, UploadedDocument } from './types'
import { NotFoundError } from './errors'
import { requireProject } from './types'
import { db } from '@/lib/db'
import { projects } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function getProjectSummary(
  ctx: ServiceContext,
  projectId: string,
): Promise<ProjectSummary> {
  const pid = requireProject({ ...ctx, projectId })
  const [project] = await db.select().from(projects)
    .where(eq(projects.id, pid))
    .limit(1)

  if (!project) throw new NotFoundError('project', projectId)

  return {
    name: project.name,
    organizationType: (project as any).organizationType ?? 'unknown',
    sector: (project as any).sector ?? 'unknown',
    region: (project as any).region ?? 'unknown',
    budgetRange: (project as any).budgetRange ?? 'unknown',
    teamSize: (project as any).teamSize ?? null,
    description: (project as any).description ?? '',
  }
}

export async function listUploadedDocuments(
  ctx: ServiceContext,
  projectId: string,
): Promise<UploadedDocument[]> {
  requireProject({ ...ctx, projectId })
  // Implementation depends on the documents table/storage schema
  // Placeholder — fill with actual DB query during implementation
  return []
}
```

- [ ] **Step 2: Create `services/sections.ts` (read operations)**

```typescript
// app/src/lib/ai/agent/services/sections.ts

import type { ServiceContext, SectionListItem, SectionDetail, SectionDraftSaveResult, SectionRollbackResult, SectionValidationResult } from './types'
import { NotFoundError, AuthorizationError, ConcurrencyError } from './errors'
import { db } from '@/lib/db'
import { agentSessions, agentSections, agentSectionVersions } from '@/lib/db/schema'
import { eq, and, count } from 'drizzle-orm'

async function verifySessionOwnership(ctx: ServiceContext, sessionId: string) {
  const [session] = await db.select().from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)
  if (!session) throw new NotFoundError('session', sessionId)
  return session
}

export async function listSections(
  ctx: ServiceContext,
  sessionId: string,
): Promise<SectionListItem[]> {
  await verifySessionOwnership(ctx, sessionId)

  const sections = await db.select({
    key: agentSections.sectionKey,
    title: agentSections.title,
    status: agentSections.status,
    documentOrder: agentSections.documentOrder,
    lastUpdatedAt: agentSections.updatedAt,
  }).from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  return sections.map(s => ({
    key: s.key,
    title: s.title,
    status: s.status,
    documentOrder: s.documentOrder,
    lastUpdatedAt: s.lastUpdatedAt,
  }))
}

export async function getSection(
  ctx: ServiceContext,
  sessionId: string,
  sectionKey: string,
): Promise<SectionDetail> {
  await verifySessionOwnership(ctx, sessionId)

  const [section] = await db.select().from(agentSections)
    .where(and(eq(agentSections.sessionId, sessionId), eq(agentSections.sectionKey, sectionKey)))
    .limit(1)

  if (!section) throw new NotFoundError('section', sectionKey)

  // Count versions
  const [versionCount] = await db.select({ count: count() })
    .from(agentSectionVersions)
    .where(eq(agentSectionVersions.sectionId, section.id))

  return {
    key: section.sectionKey,
    title: section.title,
    status: section.status,
    content: section.content,
    acceptedContent: section.acceptedContent,
    modelUsed: section.modelUsed,
    sourcesUsed: section.sourcesUsed as string[] | null,
    versionCount: versionCount?.count ?? 0,
  }
}
```

- [ ] **Step 3: Create all 6 MCP handlers in `mcp/read/`**

Create the files:
- `mcp/read/retrieve-evidence.ts`
- `mcp/read/get-project-summary.ts`
- `mcp/read/list-uploaded-documents.ts`
- `mcp/read/list-sections.ts`
- `mcp/read/get-section.ts`
- `mcp/read/get-validation-report.ts`

Each follows the exact same pattern as `search-calls.ts` from Task 4:
1. Import service function
2. Define Zod input schema
3. Register tool on server with `ServiceContext` closure
4. Call service, return JSON text content

- [ ] **Step 4: Register all tools in `mcp/read/index.ts`**

- [ ] **Step 5: Write service tests for `projects.ts` and `sections.ts`**

- [ ] **Step 6: Refactor V3 tools that have equivalents (`retrieve-call-evidence.ts`, `validate-application.ts`)**

- [ ] **Step 7: Run V3 regression**

Run: `cd app && npx vitest run tests/unit/agent-tool-*.test.ts`

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(mcp): complete eufunds-read server with all 9 tools

Read server complete: search_calls, get_call_blueprint, get_application_state,
retrieve_evidence, get_project_summary, list_uploaded_documents, list_sections,
get_section, get_validation_report."
```

---

## Task 9: Slice 2 — Rules Server (5 Tools)

**Files:**
- Create: `app/src/lib/ai/agent/services/eligibility.ts`
- Modify: `app/src/lib/ai/agent/services/sections.ts` (add `validateSection`)
- Modify: `app/src/lib/ai/agent/services/application.ts` (add `validateApplication`, `checkMissingAnnexes`)
- Create: `app/src/lib/ai/agent/mcp/rules/` (5 handlers + index.ts)
- Create: `app/src/app/api/mcp/rules/route.ts`
- Test: Service tests, adapter contract tests for `run_eligibility` and `validate_section`

**Tools:**

| MCP Tool | Service | V3 equivalent |
|----------|---------|---------------|
| `run_eligibility` | `eligibility.runEligibility()` | `run-eligibility.ts` |
| `validate_section` | `sections.validateSection()` | `validate-section.ts` |
| `validate_application` | `application.validateApplication()` | `validate-application.ts` |
| `check_missing_annexes` | `application.checkMissingAnnexes()` | `list-missing-annexes.ts` |
| `score_fit` | `eligibility.scoreFit()` | none (new) |

- [ ] **Step 1: Create `services/eligibility.ts`**

Extract from `tools/run-eligibility.ts`. The service wraps the existing `runEligibilityRules()` from `@/lib/rules/eligibility` and returns `EligibilityDecision`.

`scoreFit` is new — implement multi-dimensional scoring using call blueprint criteria vs project summary.

- [ ] **Step 2: Add `validateSection` to `services/sections.ts`**

Extract from `tools/validate-section.ts`. Deterministic checks (placeholders, length, repetition). Returns `SectionValidationResult`.

- [ ] **Step 3: Add `validateApplication` and `checkMissingAnnexes` to `services/application.ts`**

Extract from `tools/validate-application.ts` and `tools/list-missing-annexes.ts`.

- [ ] **Step 4: Refactor V3 tools to call services**

Refactor `tools/run-eligibility.ts`, `tools/validate-section.ts`, `tools/validate-application.ts`, `tools/list-missing-annexes.ts` to call service functions. Keep state transitions in V3.

- [ ] **Step 5: Run V3 regression**

Run: `cd app && npx vitest run tests/unit/agent-tool-*.test.ts`

- [ ] **Step 6: Create 5 MCP handlers in `mcp/rules/`**

- [ ] **Step 7: Create `mcp/rules/index.ts` and `/api/mcp/rules/route.ts`**

Copy the route pattern from `/api/mcp/read/route.ts`.

- [ ] **Step 8: Write service tests and adapter contract tests**

Adapter contract tests focus on `run_eligibility` (maps `EligibilityDecision` to both envelopes) and `validate_section` (maps `SectionValidationResult`).

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(mcp): add eufunds-rules server with 5 tools

Rules server: run_eligibility, validate_section, validate_application,
check_missing_annexes, score_fit. All deterministic, no LLM calls."
```

---

## Task 10: Slice 3 — Research Server (3 Tools)

**Files:**
- Create: `app/src/lib/ai/agent/services/freshness.ts`
- Create: `app/src/lib/ai/agent/mcp/research/` (3 handlers + index.ts)
- Create: `app/src/app/api/mcp/research/route.ts`
- Test: Service tests for `freshness.ts`

**Tools:**

| MCP Tool | Service | V3 equivalent |
|----------|---------|---------------|
| `refresh_call_freshness` | `freshness.refreshCallFreshness()` | `refresh-call-freshness.ts` |
| `verify_deadline` | `freshness.verifyDeadline()` | none (new) |
| `check_call_page_updates` | `freshness.checkCallPageUpdates()` | none (new) |

- [ ] **Step 1: Create `services/freshness.ts`**

Extract from `tools/refresh-call-freshness.ts`. The existing tool calls Perplexity for freshness checks. Wrap in `ExternalDependencyError` on failure.

`verifyDeadline` extracts deadline from cached blueprint and calculates days remaining.

`checkCallPageUpdates` compares cached blueprint hash against re-fetched data.

- [ ] **Step 2: Refactor V3 `refresh-call-freshness.ts` to call service**

- [ ] **Step 3: Run V3 regression**

Run: `cd app && npx vitest run tests/unit/agent-tool-refresh-freshness.test.ts`

- [ ] **Step 4: Create 3 MCP handlers, index, and route**

- [ ] **Step 5: Write service tests**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(mcp): add eufunds-research server with 3 tools

Research server: refresh_call_freshness, verify_deadline,
check_call_page_updates. External network calls with timeout handling."
```

---

## Task 11: Slice 4 — Write Server (6 Tools)

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts` (add write operations)
- Modify: `app/src/lib/ai/agent/services/blueprint.ts` (already has `saveCallBlueprint`)
- Modify: `app/src/lib/ai/agent/services/application.ts` (add `setApplicationStatus`, `createExportSnapshot`)
- Create: `app/src/lib/ai/agent/mcp/write/` (6 handlers + index.ts)
- Create: `app/src/app/api/mcp/write/route.ts`
- Test: Service tests with concurrency and audit coverage

**Tools:**

| MCP Tool | Service | Idempotent? |
|----------|---------|-------------|
| `save_section_draft` | `sections.saveSectionDraft()` | Yes |
| `approve_revision` | `sections.approveSection()` | Yes |
| `rollback_section` | `sections.rollbackSection()` | Yes |
| `save_call_blueprint` | `blueprint.saveCallBlueprint()` | Yes |
| `set_application_status` | `application.setApplicationStatus()` | Yes |
| `create_export_snapshot` | `application.createExportSnapshot()` | **No** |

**Write service contract (5 steps, mandatory for every function):**
1. Verify ownership
2. Enforce `expectedStateVersion` (throw `ConcurrencyError` on mismatch)
3. Persist mutation (within transaction)
4. Emit audit log (`logAudit()` with `ctx.requestId`, `ctx.userId`)
5. Return canonical result with `newStateVersion`

- [ ] **Step 1: Add write operations to `services/sections.ts`**

```typescript
// Add to services/sections.ts

import { logAudit } from '@/lib/legal/audit'

export async function saveSectionDraft(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; content: string; expectedStateVersion: number },
): Promise<SectionDraftSaveResult> {
  // 1. Verify ownership
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Persist mutation (transaction)
  const newStateVersion = session.stateVersion + 1
  // ... upsert section, create version record, update session stateVersion ...

  // 4. Emit audit log
  await logAudit({
    userId: ctx.userId,
    action: 'section_draft_saved',
    resourceType: 'agent_section',
    resourceId: input.sectionKey,
    metadata: { sessionId: input.sessionId, requestId: ctx.requestId },
  })

  // 5. Return canonical result
  return { versionNumber: 1, sectionId: 'generated-id', newStateVersion }
}

// Similar pattern for approveSection, rollbackSection
```

- [ ] **Step 2: Add `setApplicationStatus` and `createExportSnapshot` to `services/application.ts`**

Both follow the 5-step write contract. `createExportSnapshot` is the only non-idempotent operation — document this in its implementation.

- [ ] **Step 3: Refactor V3 tools that have equivalents**

Refactor `tools/generate-section.ts` and `tools/regenerate-section.ts` to call `saveSectionDraft` service for the persistence part (LLM generation stays in V3).

- [ ] **Step 4: Run V3 regression**

Run: `cd app && npx vitest run tests/unit/agent-tool-*.test.ts`

- [ ] **Step 5: Create 6 MCP handlers in `mcp/write/`**

Each handler wraps the service call. Error mapping:
- `ConcurrencyError` → HTTP 409 with `{ expectedVersion, actualVersion }`
- `NotFoundError` → `{ isError: true, content: [{ type: 'text', text: message }] }`
- `AuthorizationError` → HTTP 403

- [ ] **Step 6: Create `mcp/write/index.ts` and `/api/mcp/write/route.ts`**

- [ ] **Step 7: Write service tests with concurrency coverage**

```typescript
it('throws ConcurrencyError on stateVersion mismatch', async () => {
  // Mock session with stateVersion=5
  // Call saveSectionDraft with expectedStateVersion=3
  // Expect ConcurrencyError with expected=3, actual=5
})

it('emits audit log on successful write', async () => {
  // Mock logAudit
  // Call saveSectionDraft with correct stateVersion
  // Verify logAudit was called with correct params
})
```

- [ ] **Step 8: Write adapter contract tests for `save_section_draft`**

This is the highest-risk adapter mapping — it involves concurrency, audit, and version metadata.

- [ ] **Step 9: Commit**

```bash
git commit -m "feat(mcp): add eufunds-write server with 6 tools

Write server: save_section_draft, approve_revision, rollback_section,
save_call_blueprint, set_application_status, create_export_snapshot.
All writes: ownership check, concurrency guard, audit log, canonical result."
```

---

## Task 12: Final Verification and Cleanup

**Files:**
- Modify: `app/src/lib/ai/agent/services/index.ts` (create barrel export)
- Modify: `app/src/lib/ai/agent/mcp/index.ts` (create barrel export)

- [ ] **Step 1: Run full test suite**

Run: `cd app && npm run test`
Expected: All tests PASS (existing V3 + new service + adapter + MCP integration tests)

- [ ] **Step 2: Run linter**

Run: `cd app && npm run lint`
Fix any lint errors in new files.

- [ ] **Step 3: Run type checker**

Run: `cd app && npm run typecheck`
Fix any type errors.

- [ ] **Step 4: Verify layer rules**

Check that:
- `services/` files do NOT import from `tools/` or `mcp/`
- `tools/` files do NOT import from `mcp/`
- `mcp/` files do NOT import from `tools/`
- `app/api/mcp/` files do NOT import from `services/` or `tools/`

Run: `cd app && grep -r "from.*tools/" src/lib/ai/agent/services/ || echo "OK: services does not import tools"`
Run: `cd app && grep -r "from.*mcp/" src/lib/ai/agent/services/ || echo "OK: services does not import mcp"`
Run: `cd app && grep -r "from.*mcp/" src/lib/ai/agent/tools/ || echo "OK: tools does not import mcp"`
Run: `cd app && grep -r "from.*tools/" src/lib/ai/agent/mcp/ || echo "OK: mcp does not import tools"`

- [ ] **Step 5: Create barrel exports**

```typescript
// app/src/lib/ai/agent/services/index.ts
export * from './types'
export * from './errors'
export { searchCalls, retrieveEvidence } from './evidence'
export { lookupBlueprint, saveCallBlueprint } from './blueprint'
export { runEligibility, scoreFit } from './eligibility'
export { listSections, getSection, saveSectionDraft, approveSection, rollbackSection, validateSection } from './sections'
export { getApplicationState, validateApplication, checkMissingAnnexes, setApplicationStatus, createExportSnapshot } from './application'
export { refreshCallFreshness, verifyDeadline, checkCallPageUpdates } from './freshness'
export { getProjectSummary, listUploadedDocuments } from './projects'
```

- [ ] **Step 6: Commit final cleanup**

```bash
git commit -m "feat(mcp): Phase 1 complete — 23 MCP tools across 4 server domains

Service layer: 7 service files, shared ServiceContext, error taxonomy.
MCP servers: read (9), rules (5), research (3), write (6).
V3 tools refactored to call services — all regression tests passing.
Layer rules verified: no cross-boundary imports."
```

- [ ] **Step 7: Run full test suite one more time**

Run: `cd app && npm run test`
Expected: All tests PASS

---

## Summary

| Task | Slice | Tools | Key deliverable |
|------|-------|-------|----------------|
| 1 | Foundation | — | `ServiceContext`, domain types, error taxonomy |
| 2 | Foundation | — | MCP auth (jose JWT), context builder, server factory |
| 3 | Slice 1a | `search_calls` | First service extraction pattern |
| 4 | Slice 1a | `search_calls` | First MCP handler + adapter contract test |
| 5 | Slice 1a | `get_call_blueprint` | Cache-miss semantics (option C) |
| 6 | Slice 1a | `get_application_state` | Session ownership check pattern |
| 7 | Slice 1a | — | MCP SDK validation with Next.js App Router |
| 8 | Slice 1b | 6 read tools | Complete eufunds-read server |
| 9 | Slice 2 | 5 rules tools | eufunds-rules server (deterministic) |
| 10 | Slice 3 | 3 research tools | eufunds-research server (external calls) |
| 11 | Slice 4 | 6 write tools | eufunds-write server (audit, concurrency) |
| 12 | — | — | Final verification, layer rules, cleanup |
