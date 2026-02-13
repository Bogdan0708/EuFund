# Technical Architecture Review – FondEU Platform

**Reviewer:** Codex (GPT-5.2) | **Date:** 2026-02-13  
**Scope:** Architecture, performance, integration, implementation gaps  
**Verdict:** 🟡 **Solid foundation with actionable gaps** — the architecture is well-thought-out and production-viable, but needs hardening in error handling, testing, deployment config, and a few schema optimizations before build begins.

---

## Table of Contents

1. [Database Design](#1-database-design)
2. [Vector Database Integration](#2-vector-database-integration)
3. [API Design Patterns](#3-api-design-patterns)
4. [Frontend Architecture](#4-frontend-architecture)
5. [AI Components Integration](#5-ai-components-integration)
6. [Performance & Scalability](#6-performance--scalability)
7. [Integration Challenges](#7-integration-challenges)
8. [Implementation Gaps](#8-implementation-gaps)
9. [Priority Action Items](#9-priority-action-items)

---

## 1. Database Design

### ✅ Strengths

- **UUID primary keys** — good for distributed systems and no sequential ID leakage
- **Row-Level Security (RLS)** — correct approach for multi-tenant org isolation
- **Soft deletes** via `deleted_at` — GDPR-friendly, allows recovery
- **JSONB for flexible sections** (project builder) — pragmatic choice for varying project schemas per funding program
- **GIN indexes** on array columns (`eligible_regions`, `relevance_tags`) — correct index type
- **Audit log** with old/new values — essential for compliance

### ⚠️ Issues & Recommendations

#### 1.1 Missing indexes on critical query paths

```sql
-- Users: login lookup is the hottest path
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;

-- Projects: most queries will filter by org + status
CREATE INDEX idx_projects_org_status ON projects(org_id, status) WHERE deleted_at IS NULL;

-- Audit log will grow fast — partition by month
CREATE TABLE audit_log (
    ...
    created_at TIMESTAMPTZ DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Create monthly partitions automatically via pg_partman
-- or manually:
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
```

#### 1.2 Romanian enum values will cause pain

Using Romanian strings in PostgreSQL ENUMs (`'ciornă'`, `'în_lucru'`, `'mică'`) creates encoding issues and makes the codebase harder to maintain internationally.

**Recommendation:** Use English enum values in the database, map to Romanian in the application layer:

```sql
-- Instead of:
CREATE TYPE project_status AS ENUM ('ciornă', 'în_lucru', ...);

-- Use:
CREATE TYPE project_status AS ENUM ('draft', 'in_progress', 'review', 'completed', 'submitted', 'approved', 'rejected', 'archived');

-- Map in TypeScript:
const STATUS_LABELS: Record<ProjectStatus, Record<Locale, string>> = {
  draft: { ro: 'Ciornă', en: 'Draft' },
  in_progress: { ro: 'În lucru', en: 'In Progress' },
  // ...
};
```

#### 1.3 Project sections stored as individual columns is fragile

The current schema has `section_summary TEXT`, `section_context TEXT`, `section_objectives JSONB`, etc. as individual columns. When a new funding program requires a different section, you need a schema migration.

**Recommendation:** Consider a hybrid approach — keep the most common sections as columns (for query performance), but add a `sections JSONB` catch-all:

```sql
-- Or better yet, use a separate sections table for version-tracked content:
CREATE TABLE project_sections (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id),
    section_key VARCHAR(50) NOT NULL,  -- 'context', 'objectives', 'budget', etc.
    content     JSONB NOT NULL,
    version     INTEGER DEFAULT 1,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, section_key)
);
```

This allows per-section versioning and avoids massive row updates when editing one section.

#### 1.4 Missing `updated_at` trigger

The schema defines `updated_at` but never sets up auto-update:

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at:
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
-- ... etc.
```

#### 1.5 Compliance reports lack foreign key back-reference

`projects.compliance_report_id` references nothing in the schema. Add:

```sql
ALTER TABLE projects ADD CONSTRAINT fk_compliance_report
    FOREIGN KEY (compliance_report_id) REFERENCES compliance_reports(id);
```

#### 1.6 `documents` table has circular reference issue

`calls_for_proposals.guide_doc_id REFERENCES documents(id)` but `documents` also references `projects` which references `calls_for_proposals`. This creates a circular dependency that complicates migrations.

**Recommendation:** Use a join table or make `guide_doc_id` nullable with deferred constraints:

```sql
ALTER TABLE calls_for_proposals
    ADD CONSTRAINT fk_guide_doc FOREIGN KEY (guide_doc_id)
    REFERENCES documents(id) DEFERRABLE INITIALLY DEFERRED;
```

---

## 2. Vector Database Integration

### ✅ Strengths

- **Qdrant** is a solid choice — open-source, Rust-based, performant, self-hostable (EU data residency ✓)
- **Collection separation** by document type (eu_regulations, ro_legislation, applicant_guides) — good for filtered searches and different update cadences
- **Metadata-rich payloads** — enables hybrid search (vector + filter)
- **Chunk size 512 tokens, overlap 64** — reasonable defaults

### ⚠️ Issues & Recommendations

#### 2.1 Embedding model mismatch with Qdrant vector size

The schema specifies `"size": 768` for vectors, but `text-multilingual-embedding-002` (Google) outputs **768 dimensions** ✓. However, `multilingual-e5-large` outputs **1024 dimensions** ❌.

**Fix:** Either:
- Use `multilingual-e5-base` (768 dims) as fallback, or
- Create collections with named vectors to support both:

```python
# Qdrant collection with named vectors
client.create_collection(
    collection_name="eu_regulations",
    vectors_config={
        "google": models.VectorParams(size=768, distance=models.Distance.COSINE),
        "e5": models.VectorParams(size=1024, distance=models.Distance.COSINE),
    }
)
```

#### 2.2 Missing re-indexing strategy

When the embedding model changes (and it will), all vectors need re-embedding. The docs don't address this.

**Recommendation:** Add an `embedding_model` field to each point's payload and implement a background re-indexing pipeline:

```typescript
// Track which model generated each vector
const point = {
  id: chunkId,
  vector: embedding,
  payload: {
    ...metadata,
    embedding_model: 'text-multilingual-embedding-002',
    embedded_at: new Date().toISOString(),
  }
};

// Re-index job: query points with old model, re-embed, upsert
```

#### 2.3 No quantization configured

For ~115K chunks across all collections, raw float32 vectors at 768 dims = ~335MB. Manageable now, but will grow.

**Recommendation:** Enable scalar quantization for production:

```python
client.update_collection(
    collection_name="eu_regulations",
    quantization_config=models.ScalarQuantization(
        scalar=models.ScalarQuantizationConfig(
            type=models.ScalarType.INT8,
            quantile=0.99,
            always_ram=True,
        )
    )
)
```

This halves memory usage with minimal recall loss.

#### 2.4 Consider Qdrant over Weaviate/Pinecone

The PRD mentions Weaviate/Pinecone, but the architecture correctly chose Qdrant. **Stick with Qdrant.** Reasons:
- Self-hostable in EU (Hetzner) — no data leaves the region
- No vendor lock-in or per-query pricing (Pinecone)
- Excellent filtering performance for metadata-heavy legal docs
- Rust-based = lower resource consumption than Weaviate (Go/Java)

---

## 3. API Design Patterns

### ✅ Strengths

- **RESTful with versioning** (`/api/v1/`) — correct
- **Consistent resource naming** — plural nouns, nested resources where appropriate
- **Standard envelope** with `success`, `data`, `meta`, `errors` — good DX
- **Bilingual error messages** (`message_ro`, `message_en`) — excellent for the target audience
- **Reasonable rate limits** (100/min per IP, 1000/min per user)

### ⚠️ Issues & Recommendations

#### 3.1 Missing pagination on list endpoints

The API docs show `GET /api/v1/projects` but don't specify pagination parameters.

**Recommendation:** Standardize cursor-based pagination (better than offset for large datasets):

```typescript
// Request
GET /api/v1/projects?cursor=eyJpZCI6IjEyMyJ9&limit=20&sort=updated_at:desc

// Response meta
{
  "meta": {
    "cursor_next": "eyJpZCI6IjE0MyJ9",
    "cursor_prev": "eyJpZCI6IjEyMyJ9",
    "has_more": true,
    "total": 156
  }
}
```

#### 3.2 AI endpoints need streaming support

`POST /api/v1/ai/generate` and `/ai/chat` will take 5-20 seconds. Without streaming, users see a blank loading state.

**Recommendation:** Add SSE (Server-Sent Events) streaming:

```typescript
// Client
const response = await fetch('/api/v1/ai/chat', {
  method: 'POST',
  body: JSON.stringify({ message, project_id }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // Parse SSE: "data: {\"token\": \"text chunk\"}\n\n"
  appendToUI(chunk);
}
```

```typescript
// Server (Fastify)
fastify.post('/api/v1/ai/chat', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  for await (const chunk of llmStream(request.body)) {
    reply.raw.write(`data: ${JSON.stringify({ token: chunk })}\n\n`);
  }
  reply.raw.write(`data: ${JSON.stringify({ done: true, sources })}\n\n`);
  reply.raw.end();
});
```

#### 3.3 Missing idempotency keys for mutations

For operations like project creation or AI compliance checks, network retries can cause duplicates.

```typescript
// Client sends idempotency key
POST /api/v1/projects
Headers: { "Idempotency-Key": "uuid-v4-from-client" }

// Server checks Redis before processing
const existing = await redis.get(`idempotency:${key}`);
if (existing) return JSON.parse(existing);
```

#### 3.4 No webhook/callback pattern for long-running AI tasks

Compliance checks and document analysis can take 15+ seconds. The current synchronous request/response pattern will hit timeout issues.

**Recommendation:** Implement async job pattern:

```typescript
// Submit job
POST /api/v1/ai/compliance-check
Response: { "job_id": "uuid", "status": "queued", "poll_url": "/api/v1/jobs/uuid" }

// Poll (or use WebSocket/SSE)
GET /api/v1/jobs/:id
Response: { "status": "processing", "progress": 45 }
// ... later ...
Response: { "status": "completed", "result": { ... } }
```

#### 3.5 Missing HATEOAS or resource links

For a complex domain like this, API responses should include navigational links:

```json
{
  "data": {
    "id": "project-uuid",
    "title": "...",
    "_links": {
      "self": "/api/v1/projects/project-uuid",
      "compliance": "/api/v1/projects/project-uuid/compliance",
      "export": "/api/v1/projects/project-uuid/export",
      "call": "/api/v1/calls/call-uuid"
    }
  }
}
```

---

## 4. Frontend Architecture

### ✅ Strengths

- **Next.js 14 App Router** — correct choice for SSR/SEO (important for the marketing pages)
- **next-intl** for i18n — best-in-class for App Router, handles plural forms
- **Romanian URL slugs** (`/ro/proiecte`, `/ro/finanțări`) — excellent UX for Romanian users and SEO
- **Zustand + TanStack Query** — light and cache-efficient, avoids Redux overhead
- **shadcn/ui** — composable, accessible, customizable
- **Zod validation with Romanian messages** — consistent client/server validation
- **Component structure** is well-organized and domain-driven

### ⚠️ Issues & Recommendations

#### 4.1 Romanian URL slugs with diacritics are problematic

`/ro/finanțări/` and `/ro/legislație/` contain special characters. While technically valid (IRIs), they cause issues with:
- Copy-paste (gets URL-encoded to `%C8%9B`)
- Analytics tools
- Some CDN/proxy configurations

**Recommendation:** Use transliterated slugs:

```
/ro/finantari/     instead of /ro/finanțări/
/ro/legislatie/    instead of /ro/legislație/
/ro/inregistrare/  instead of /ro/înregistrare/
```

#### 4.2 Missing error boundary strategy

No `error.tsx` or `not-found.tsx` files mentioned in the component structure.

**Recommendation:** Add at every route segment:

```typescript
// src/app/[locale]/(dashboard)/proiecte/error.tsx
'use client';
import { useTranslations } from 'next-intl';

export default function ProjectsError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');
  return (
    <div className="flex flex-col items-center gap-4 py-16">
      <h2>{t('somethingWentWrong')}</h2>
      <p className="text-muted-foreground">{t('tryAgain')}</p>
      <Button onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
```

#### 4.3 No loading states defined

The App Router requires explicit `loading.tsx` files for streaming/suspense.

```typescript
// src/app/[locale]/(dashboard)/proiecte/loading.tsx
import { ProjectListSkeleton } from '@/components/proiect/skeletons';
export default function Loading() {
  return <ProjectListSkeleton count={6} />;
}
```

#### 4.4 Bundle optimization for i18n

With `ro.json` and `en.json` translation files, both will be loaded unless you configure message splitting:

```typescript
// next-intl.config.ts — load only the active locale's messages
export default getRequestConfig(async ({ locale }) => ({
  messages: (await import(`./messages/${locale}.json`)).default,
}));

// Split large translation files by namespace:
// messages/ro/common.json, messages/ro/project.json, etc.
// Load per-page:
export default async function ProjectsPage() {
  const messages = await getMessages(['common', 'project']);
  // ...
}
```

#### 4.5 Missing accessibility considerations

WCAG 2.1 AA is listed as a requirement but no implementation details:

- All `shadcn/ui` components need `aria-label` for Romanian context
- Form validation errors need `aria-describedby` linking
- Color contrast must account for the compliance badges (✅⚠️❌)
- Keyboard navigation for the project builder wizard

---

## 5. AI Components Integration

### ✅ Strengths

- **RAG architecture is well-designed** — chunking → embedding → retrieval → LLM generation with sources
- **Model routing by task** — cost-efficient (Haiku for summaries, Sonnet for compliance)
- **AI safety measures** — disclaimers, source citations, hallucination filtering, rate limits, audit logging
- **Compliance check chain** — multi-step (per-section → cross-section → compile) is the correct approach
- **Prompt engineering** — Romanian-specific, structured, with clear rules

### ⚠️ Issues & Recommendations

#### 5.1 No prompt versioning or A/B testing

Prompts are hardcoded in the docs. In production, prompts evolve constantly.

**Recommendation:** Implement prompt management:

```typescript
// Prompt registry with versioning
interface PromptTemplate {
  id: string;
  version: number;
  template: string;
  model: string;
  temperature: number;
  isActive: boolean;
  metrics: { avgScore: number; avgLatency: number; errorRate: number };
}

// Store in DB, cache in Redis
const prompt = await promptRegistry.getActive('compliance-check');
const rendered = prompt.render({ guide_chunks, legislation_chunks, project_section });

// Log which prompt version was used for each AI call
await aiMessages.create({
  ...messageData,
  prompt_version: prompt.version,
});
```

#### 5.2 Hallucination detection is underspecified

The docs mention "cross-reference output with chunks retrieved" but don't specify how.

**Recommendation:** Implement citation verification:

```typescript
async function verifyAIOutput(output: string, retrievedChunks: Chunk[]): VerificationResult {
  // 1. Extract all citations from AI output
  const citations = extractCitations(output); // regex for article refs

  // 2. For each citation, verify it exists in retrieved chunks
  const verified = citations.map(cite => ({
    citation: cite,
    found: retrievedChunks.some(chunk =>
      chunk.metadata.article_number === cite.article &&
      chunk.text.includes(cite.quotedText)
    ),
  }));

  // 3. Flag unverifiable claims
  const unverified = verified.filter(v => !v.found);

  // 4. If >20% citations unverifiable, regenerate with stricter prompt
  if (unverified.length / verified.length > 0.2) {
    return { status: 'needs_regeneration', unverified };
  }

  return { status: 'verified', citations: verified };
}
```

#### 5.3 Missing fallback chain for LLM failures

If Claude Sonnet is down, the system has no defined fallback.

```typescript
const MODEL_FALLBACK_CHAINS: Record<string, string[]> = {
  'compliance-check': ['claude-sonnet-4', 'gpt-4.1', 'claude-haiku'],
  'generation': ['claude-sonnet-4', 'gpt-4.1'],
  'matching': ['gpt-4.1-mini', 'claude-haiku'],
  'summarization': ['claude-haiku', 'gpt-4.1-mini'],
};

async function callLLMWithFallback(task: string, prompt: string): Promise<LLMResponse> {
  const chain = MODEL_FALLBACK_CHAINS[task];
  for (const model of chain) {
    try {
      return await callLLM(model, prompt, { timeout: 30_000 });
    } catch (err) {
      logger.warn(`Model ${model} failed for ${task}, trying next`, { err });
      continue;
    }
  }
  throw new Error(`All models failed for task: ${task}`);
}
```

#### 5.4 Chunk retrieval needs hybrid search

Pure vector similarity will miss exact legal article references. Users will search for "Art. 5 alin. 3 din OUG 66/2011" — this needs keyword matching.

```typescript
// Hybrid search: vector + BM25
async function hybridSearch(query: string, collection: string, filters: Filter) {
  // 1. Vector search
  const vectorResults = await qdrant.search(collection, {
    vector: await embed(query),
    filter: filters,
    limit: 20,
  });

  // 2. BM25/keyword search (PostgreSQL FTS)
  const keywordResults = await db.query(`
    SELECT id, ts_rank(search_vector, plainto_tsquery('romanian', $1)) as rank
    FROM legislation_chunks
    WHERE search_vector @@ plainto_tsquery('romanian', $1)
    ORDER BY rank DESC LIMIT 20
  `, [query]);

  // 3. Reciprocal Rank Fusion
  return reciprocalRankFusion(vectorResults, keywordResults, { k: 60 });
}
```

#### 5.5 `bert-base-romanian-cased-v1` role is unclear

The research report mentions this model, but the architecture uses Google's multilingual embedding model instead. Clarify: `bert-base-romanian-cased-v1` could be useful for:
- **NER** (Named Entity Recognition) — extracting organization names, CAEN codes, legal references from uploaded documents
- **Classification** — categorizing legislation by topic
- **NOT for embeddings** — it's not trained for semantic similarity; use the multilingual models instead

---

## 6. Performance & Scalability

### 6.1 Database Query Optimization

**Concern:** The `projects` table stores full section content (TEXT/JSONB columns). A `SELECT *` on projects will fetch megabytes per row.

```sql
-- BAD: listing projects fetches all section content
SELECT * FROM projects WHERE org_id = $1;

-- GOOD: select only what the list view needs
SELECT id, title, acronym, status, compliance_score, match_score,
       total_budget, updated_at
FROM projects
WHERE org_id = $1 AND deleted_at IS NULL
ORDER BY updated_at DESC;

-- Create a materialized view for the dashboard
CREATE MATERIALIZED VIEW project_dashboard AS
SELECT p.id, p.title, p.status, p.compliance_score,
       c.title_ro as call_title, c.submission_end as deadline,
       o.name as org_name
FROM projects p
LEFT JOIN calls_for_proposals c ON p.call_id = c.id
LEFT JOIN organizations o ON p.org_id = o.id
WHERE p.deleted_at IS NULL;

-- Refresh on write (or periodic)
REFRESH MATERIALIZED VIEW CONCURRENTLY project_dashboard;
```

### 6.2 Caching Strategy

```typescript
// Redis caching layers
const CACHE_CONFIG = {
  // Hot data — changes rarely
  'funding_programs': { ttl: 86400 },      // 24h — programs don't change daily
  'calls:active': { ttl: 3600 },           // 1h — new calls appear daily
  'legislation:index': { ttl: 3600 },      // 1h
  'bnr:exchange_rate': { ttl: 86400 },     // 24h — BNR updates daily

  // Warm data — user-specific
  'user:session': { ttl: 1800 },           // 30min
  'project:list:{org_id}': { ttl: 300 },   // 5min — invalidate on project CRUD

  // AI results — expensive to recompute
  'compliance:{project_id}:{version}': { ttl: 0 },  // permanent until version changes
  'grant_match:{org_id}': { ttl: 3600 },             // 1h

  // Vector search results
  'search:{hash(query+filters)}': { ttl: 600 },     // 10min
};

// Cache invalidation pattern
async function invalidateProjectCache(orgId: string) {
  await redis.del(`project:list:${orgId}`);
  // Don't invalidate compliance — it's version-keyed
}
```

### 6.3 Vector Search Performance

At ~115K chunks with 768-dim vectors:
- **Cold query:** ~50-100ms (acceptable)
- **With metadata filters:** ~20-50ms (Qdrant handles filters well)

**Optimization for Romanian language:**
- Pre-compute embeddings for common queries ("eligibilitate IMM", "cheltuieli eligibile", "ajutor de stat")
- Use Qdrant's payload indexes on `programs` and `tags` fields — these are the most common filters

```python
# Create payload indexes for fast filtering
client.create_payload_index(
    collection_name="ro_legislation",
    field_name="tags",
    field_schema=models.PayloadSchemaType.KEYWORD,
)
client.create_payload_index(
    collection_name="ro_legislation",
    field_name="is_active",
    field_schema=models.PayloadSchemaType.BOOL,
)
```

### 6.4 Frontend Bundle Optimization

```typescript
// next.config.ts
const config: NextConfig = {
  // Split chunks aggressively
  experimental: {
    optimizePackageImports: [
      'recharts', '@tiptap/react', 'date-fns', 'zod',
    ],
  },
  // Only load the locale user needs
  i18n: undefined, // Handled by next-intl middleware

  // Analyze bundle
  ...(process.env.ANALYZE && {
    webpack: (config) => {
      const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
      config.plugins.push(new BundleAnalyzerPlugin({ analyzerMode: 'static' }));
      return config;
    },
  }),
};
```

Key optimizations:
- **Lazy load TipTap editor** — it's ~200KB, only needed on project edit pages
- **Lazy load Recharts** — only on dashboard
- **Lazy load react-pdf** — only on document viewer
- **Use `next/dynamic`** with SSR disabled for heavy client components

```typescript
const TipTapEditor = dynamic(() => import('@/components/proiect/section-editor'), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
```

---

## 7. Integration Challenges

### 7.1 EUR-Lex SPARQL API

**Risks:**
- Rate limits are undocumented — anecdotally ~100 req/min
- SPARQL endpoint has intermittent downtime
- Response times vary wildly (500ms to 30s)

**Mitigations:**

```typescript
// 1. Aggressive caching — EUR-Lex data changes slowly
const eurLexCache = new Map<string, { data: any; fetchedAt: Date }>();

// 2. Retry with exponential backoff
async function queryEurLex(sparql: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(EURLEX_SPARQL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sparql-query', 'Accept': 'application/json' },
        body: sparql,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        await sleep(Math.pow(2, i) * 2000);
        continue;
      }
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(Math.pow(2, i) * 1000);
    }
  }
}

// 3. Nightly batch sync instead of real-time queries
// Cron job: fetch all new/updated regulations since last sync
// Store locally in PostgreSQL + re-embed changed chunks
```

### 7.2 Romanian Government APIs

**Risks:**
- `data.gov.ro` lacks HTTPS and CORS (per research report)
- No API key auth — could change without notice
- Data quality inconsistent

**Mitigations:**

```typescript
// 1. Proxy through backend (bypasses CORS)
// 2. Use HTTP (not HTTPS) — accept the risk for public data
// 3. Validate all incoming data aggressively

const govDataSchema = z.object({
  datasets: z.array(z.object({
    id: z.string(),
    title: z.string().optional().default('Untitled'),
    // ... defensive schemas with defaults
  })),
});

// 4. For ONRC/ANAF: these don't have public APIs
// Use web scraping as fallback with headless browser
// Or partner with a data provider (e.g., Termene.ro, ListaFirme.ro)
```

### 7.3 Romanian BERT Model Integration

`bert-base-romanian-cased-v1` — use for NER and classification, not embeddings:

```python
# NER pipeline for extracting legal references from documents
from transformers import pipeline

ner = pipeline("ner", model="dumitrescustefan/bert-base-romanian-cased-v1",
               aggregation_strategy="simple")

# Fine-tune for legal entity extraction:
# Labels: ORG, LAW_REF, CAEN_CODE, BUDGET_AMOUNT, DATE, NUTS_REGION
# Training data: annotated Romanian legal documents
```

### 7.4 Cross-Language Search (RO/EN)

The multilingual embedding model handles this natively, but needs testing:

```typescript
// Test: Romanian query should find English EU regulation content
const roQuery = "cheltuieli eligibile pentru digitalizare IMM";
const results = await qdrant.search("eu_regulations", {
  vector: await embed(roQuery),  // multilingual model
  filter: { must: [{ key: "text_en", match: { exists: true } }] },
  limit: 5,
});
// Verify: results should include ERDF regulation articles on eligible expenditure

// Recommendation: store both ro and en text in payload
// Return the version matching user's locale
```

---

## 8. Implementation Gaps

### 8.1 Missing Error Handling Patterns

**Current state:** No error handling strategy documented.

**Recommendation:** Define a global error taxonomy:

```typescript
// Shared error codes
enum ErrorCode {
  // Auth
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  SESSION_EXPIRED = 'SESSION_EXPIRED',

  // Validation
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_CUI = 'INVALID_CUI',
  INVALID_CAEN = 'INVALID_CAEN',

  // Business logic
  PROJECT_LOCKED = 'PROJECT_LOCKED',
  CALL_CLOSED = 'CALL_CLOSED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',

  // AI
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
  AI_GENERATION_FAILED = 'AI_GENERATION_FAILED',
  AI_RATE_LIMITED = 'AI_RATE_LIMITED',

  // External
  EURLEX_UNAVAILABLE = 'EURLEX_UNAVAILABLE',
  ONRC_UNAVAILABLE = 'ONRC_UNAVAILABLE',

  // System
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// Fastify error handler
fastify.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode || 500;
  const code = error.code || ErrorCode.INTERNAL_ERROR;

  // Log with correlation ID
  request.log.error({ err: error, correlationId: request.id });

  reply.status(statusCode).send({
    success: false,
    errors: [{
      code,
      message_ro: getErrorMessageRo(code, error.details),
      message_en: getErrorMessageEn(code, error.details),
      field: error.field,
    }],
  });
});
```

### 8.2 Incomplete API Documentation

**Current state:** Endpoints listed but no OpenAPI spec.

**Recommendation:** Generate from Fastify schemas:

```typescript
// Use @fastify/swagger + @fastify/swagger-ui
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'FondEU API',
      version: '1.0.0',
      description: 'API platformă finanțări europene',
    },
    servers: [{ url: 'https://api.fondeu.ro/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
});

// Each route gets a schema (Zod → JSON Schema via zod-to-json-schema)
fastify.post('/api/v1/projects', {
  schema: {
    body: zodToJsonSchema(createProjectSchema),
    response: { 200: zodToJsonSchema(projectResponseSchema) },
    tags: ['Projects'],
    summary: 'Creare proiect nou',
  },
  handler: createProjectHandler,
});
```

### 8.3 Inadequate Testing Strategy for AI Components

**Current state:** Golden set of 50 projects mentioned but no details on:
- How to create/maintain the golden set
- AI regression testing
- Cost management for test runs

**Recommendation:**

```typescript
// 1. Snapshot-based AI testing
describe('AI Compliance Engine', () => {
  // Use recorded LLM responses for deterministic tests
  beforeAll(() => {
    vi.mock('./llm-client', () => ({
      callLLM: vi.fn().mockImplementation(async (model, prompt) => {
        const hash = createHash('md5').update(prompt).digest('hex');
        const snapshot = await readSnapshot(`ai-snapshots/${hash}.json`);
        if (snapshot) return snapshot;
        // In CI: fail if no snapshot
        // In dev: call real API and save snapshot
        if (process.env.CI) throw new Error(`Missing AI snapshot: ${hash}`);
        const result = await realCallLLM(model, prompt);
        await saveSnapshot(`ai-snapshots/${hash}.json`, result);
        return result;
      }),
    }));
  });

  // 2. Evaluation metrics (run weekly, not in CI)
  describe.skipIf(process.env.CI)('AI Quality Metrics', () => {
    it('compliance accuracy > 85% on golden set', async () => {
      const results = await runGoldenSet();
      expect(results.accuracy).toBeGreaterThan(0.85);
      expect(results.falseNegativeRate).toBeLessThan(0.1); // Don't miss real issues
    });
  });
});

// 3. Cost tracking
afterAll(() => {
  const totalTokens = testMetrics.totalTokens;
  const estimatedCost = totalTokens * COST_PER_TOKEN;
  console.log(`AI test cost: $${estimatedCost.toFixed(2)} (${totalTokens} tokens)`);
});
```

### 8.4 Missing Deployment Configuration

**Current state:** Architecture mentions k3s on Hetzner, but no actual configs.

**Essential files needed:**

```
deploy/
├── docker/
│   ├── Dockerfile.frontend      # Multi-stage Next.js build
│   ├── Dockerfile.service       # Shared for all Node.js microservices
│   ├── Dockerfile.ingestion     # Python FastAPI service
│   └── docker-compose.yml       # Local dev environment
├── k8s/
│   ├── base/
│   │   ├── kustomization.yaml
│   │   ├── namespace.yaml
│   │   ├── frontend-deployment.yaml
│   │   ├── auth-service.yaml
│   │   ├── project-service.yaml
│   │   ├── ai-service.yaml
│   │   ├── grants-service.yaml
│   │   ├── qdrant-statefulset.yaml
│   │   ├── redis-deployment.yaml
│   │   └── ingress.yaml          # Traefik IngressRoute
│   ├── overlays/
│   │   ├── staging/
│   │   │   └── kustomization.yaml
│   │   └── production/
│   │       └── kustomization.yaml
│   └── sealed-secrets/           # Encrypted secrets for git
├── terraform/
│   ├── main.tf                   # Hetzner Cloud resources
│   ├── k3s.tf                    # k3s cluster setup
│   ├── database.tf               # Managed PostgreSQL
│   └── dns.tf                    # Cloudflare DNS records
└── scripts/
    ├── setup-dev.sh              # One-command dev setup
    ├── seed-data.sh              # Load programs, CAEN codes, regions
    └── backup-db.sh              # Automated backup script
```

**Docker Compose for local dev (minimum viable):**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: fondeu
      POSTGRES_USER: fondeu
      POSTGRES_PASSWORD: dev_password
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./deploy/sql/init.sql:/docker-entrypoint-initdb.d/init.sql

  qdrant:
    image: qdrant/qdrant:v1.12.0
    ports: ["6333:6333", "6334:6334"]
    volumes:
      - qdrant_data:/qdrant/storage

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin

volumes:
  pgdata:
  qdrant_data:
```

---

## 9. Priority Action Items

### 🔴 Critical (Before Development Starts)

| # | Item | Effort |
|---|------|--------|
| 1 | Switch Romanian enum values to English in DB schema | 2h |
| 2 | Add `docker-compose.yml` for local dev | 2h |
| 3 | Define error handling patterns and error codes | 4h |
| 4 | Fix embedding dimension mismatch (fallback model) | 1h |
| 5 | Generate OpenAPI spec from Zod schemas | 4h |

### 🟡 Important (During MVP — Weeks 1-4)

| # | Item | Effort |
|---|------|--------|
| 6 | Add SSE streaming for AI endpoints | 8h |
| 7 | Implement cursor-based pagination | 4h |
| 8 | Add `updated_at` triggers | 1h |
| 9 | Transliterate Romanian URL slugs | 2h |
| 10 | Add `error.tsx` and `loading.tsx` for all routes | 4h |
| 11 | Implement prompt versioning system | 8h |
| 12 | Set up hybrid search (vector + BM25) | 8h |
| 13 | Partition audit_log table | 2h |

### 🟢 Nice to Have (Before Launch)

| # | Item | Effort |
|---|------|--------|
| 14 | Implement idempotency keys | 4h |
| 15 | Add LLM fallback chains | 4h |
| 16 | Set up AI snapshot testing | 8h |
| 17 | Configure Qdrant quantization | 2h |
| 18 | Create Terraform configs for Hetzner | 16h |
| 19 | WCAG 2.1 AA audit and fixes | 16h |
| 20 | Add HATEOAS links to API responses | 4h |

---

## Summary

The FondEU architecture is **production-viable** and shows strong domain understanding. The tech stack choices are well-justified (Qdrant over Pinecone for EU data residency, Fastify for performance, next-intl for Romanian i18n). The AI pipeline design — multi-step compliance checking with source citations — is the right approach for legal compliance work.

**Top 3 risks:**
1. **Romanian government APIs are fragile** — build with the assumption they'll break; have fallback data sources
2. **AI quality for Romanian legal text** — invest early in the golden test set and evaluation metrics
3. **No deployment config** — the gap between architecture docs and runnable code is the biggest risk to timeline

The 8-week MVP timeline is aggressive but achievable if deployment infrastructure (Docker Compose + CI/CD) is set up in Week 1.
