# Orchestrator V2 — Design Spec

**Date:** 2026-04-02
**Status:** Approved
**Branch:** TBD (new branch from feature/local-production-readiness)

## Problem Statement

The current 7-step AI orchestrator has three fundamental failures:

1. **Truncation waste** — The build agent (Step 7) asks Claude to output 11 proposal sections in a single 43KB JSON response. Claude hits the token limit, the JSON truncates, parseAIJson fails, and 44KB of paid content becomes a single useless blob called "Generated Proposal". Real money is wasted on every run.

2. **Web-only research** — The research agent uses Perplexity web search instead of querying the project's own knowledge base: 28K vectors in Qdrant, 620 notes in Obsidian, and 12 program-specific NotebookLM notebooks containing actual Ghiduri ale Solicitantului (applicant guides). The output is generic guidance, not the specific requirements of the matched call.

3. **Generic output structure** — The build prompt asks for generic sections ("Rezumat", "Buget", "Metodologie") instead of the exact section headings mandated by the call's applicant guide. A real Cerere de Finantare follows a program-specific template.

Additionally, the pipeline doesn't use GPT-5.4 at all (strong at enhancement and structured output) and reserves Claude Opus 4.6 for nothing (best reasoning and writing quality).

## Design Principles

Based on Google Research's "Towards a Science of Scaling Agent Systems" (180 agent configurations evaluated):

- **Centralized orchestrator** — engine.ts stays as the single coordinator. Centralized systems contain error amplification to 4.4x vs 17.2x for independent agents.
- **Sequential where dependencies exist** — Proposal sections depend on each other. Parallel generation would degrade quality by up to 70% per the sequential penalty finding.
- **No agents for the sake of it** — "More agents is all you need" is a myth. Each step has one agent with one job.
- **Simplicity over complexity** — Merging validate + research into one step is simpler and eliminates coordination overhead.

## Pipeline: 6 Steps

```
User Input (project idea)
    |
Step 1: ENHANCE (GPT-5.4)
    -> EnhancedIdea
    | auto-advance
Step 2: MATCH (Gemini 2.5 Flash + Qdrant RAG)
    -> MatchedCalls[] + CHECKPOINT (user selects call)
    | user selects
Step 3: RESEARCH & VALIDATE (NotebookLM + Perplexity + Eligibility Rules)
    -> CallBlueprint (stored to call_knowledge table)
    | auto-advance
Step 4: PLAN (Opus 4.6)
    -> ActionPlan + CHECKPOINT (user confirms)
    | user confirms
Step 5: BUILD (Opus 4.6 heavy + GPT-5.4 light, sequential per-section)
    -> ProjectSections[] (one call per section, no truncation)
    | done -> project persisted to DB
Step 6: EDIT (GPT-5.4, post-completion)
    -> User edits individual sections on demand
```

### Step-by-Step Detail

### Step 1: Enhance

**Model:** GPT-5.4
**Purpose:** Turn a raw project idea into a structured concept.
**Why GPT-5.4:** Best at enhancing and building up ideas. Currently Gemini does this adequately but GPT-5.4 produces richer, more actionable output.

**Input:** Raw user text (string)
**Output:** EnhancedIdea (unchanged from V1)

```typescript
{
  originalIdea: string
  refinedDescription: string
  sector: string
  region: string
  targetGroup: string
  estimatedBudget: string
  keyObjectives: string[]
}
```

**Checkpoint:** None (auto-advance to Step 2)

### Step 2: Match

**Model:** Gemini 2.5 Flash (scoring) + Perplexity Sonar Pro (web fallback)
**Purpose:** Find matching EU funding calls from Qdrant knowledge base, score them.
**No change from V1** except maxTokens already bumped to 16384.

**Input:** EnhancedIdea
**Output:** MatchedCall[] (0-5 results)
**Checkpoint:** User selects a call (stored as ctx.selectedCallId)

### Step 3: Research & Validate (merged)

**Models:** None for primary retrieval — uses NotebookLM MCP + Perplexity for verification
**Purpose:** Get the exact requirements for the selected call and verify it's still current.

This step replaces both the old validate agent (Step 3) and research agent (Step 4).

**Three operations in one agent:**

#### 3a. Knowledge retrieval (NotebookLM)

Check `call_knowledge` table first:
- If call_id exists AND verified_at < 7 days: skip NotebookLM, use cached data
- Otherwise: query the program-specific NotebookLM notebook

NotebookLM query (to the matched program's notebook, e.g., FondEU-PNRR):
```
For the call "[call title]" under [program], provide:
1. The required Cerere de Finantare section structure (exact headings)
2. Mandatory annexes and supporting documents
3. Eligibility criteria (who can apply, organization types, regions)
4. Evaluation grid (criteria and point weights)
5. Co-financing rate and budget constraints
6. Key deadlines
```

Returns cited answers from the actual Ghidul Solicitantului.

#### 3b. Freshness verification (Perplexity)

Perplexity Sonar query:
```
Is the call "[call title]" ([program]) still open for applications
as of [today's date]? Check for: deadline extensions, budget amendments,
corrigenda, or closure announcements on mfe.gov.ro and mysmis2021.gov.ro.
```

Returns: isOpen, amendments[], warnings[]

#### 3c. Eligibility check (deterministic)

Run `runEligibilityRules()` from `lib/rules/eligibility.ts`:
- Uses EnhancedIdea (sector, region, budget) + call requirements from 3a
- Returns pass/fail/warning per rule
- If hard failures: warn user in the stream (not a blocker, but flagged clearly)

**Output:** CallBlueprint

```typescript
interface CallBlueprint {
  callId: string
  program: string
  isOpen: boolean
  amendments: string[]
  warnings: string[]
  requiredSections: {
    title: string
    description: string
    evaluationWeight?: number
  }[]
  mandatoryAnnexes: string[]
  eligibilityCriteria: string[]
  evaluationGrid: {
    criterion: string
    maxPoints: number
  }[]
  cofinancingRate: number
  eligibilityResult: {
    score: number
    passCount: number
    failCount: number
    failures: string[]
    warnings: string[]
  }
  sources: string[]
  verifiedAt: string  // ISO timestamp
}
```

**Persistence:** After building the CallBlueprint, store/update it in `call_knowledge` table (see Database section below). This happens inline — no separate "knowledge step" needed.

**Checkpoint:** None (auto-advance to Step 4)

### Step 4: Plan

**Model:** Opus 4.6
**Purpose:** Create an action plan aligned to the actual call requirements.
**Why Opus:** Same model that builds the heavy sections — the plan is the architectural blueprint. A lower-quality plan produces lower-quality sections.

**Input:** EnhancedIdea + CallBlueprint + selectedCall
**Output:** ActionPlan (same structure as V1, but now informed by real requirements)

The plan prompt receives `callBlueprint.requiredSections` so the plan's steps map to actual deliverables, not generic ones. The `callBlueprint.evaluationGrid` informs which aspects to emphasize.

**Checkpoint:** User confirms plan (type: 'confirm')

### Step 5: Build (per-section, sequential)

**Models:** Opus 4.6 (heavy sections) + GPT-5.4 (template sections)
**Purpose:** Generate the complete project proposal, one section at a time.

This is the core reliability fix. Instead of one massive JSON call that truncates, the orchestrator loops through each required section individually.

#### Section source

The section list comes from `callBlueprint.requiredSections` (Step 3 output). If the Ghidul Solicitantului requires 9 sections, we generate 9. If it requires 14, we generate 14. No hardcoded list.

**Fallback:** If `requiredSections` is empty (NotebookLM didn't return structure), fall back to the standard 11 sections:

```
1. Rezumat / Summary
2. Context si justificare
3. Obiective
4. Grup tinta
5. Metodologie
6. Plan de implementare
7. Buget
8. Indicatori
9. Sustenabilitate
10. Capacitate institutionala
11. Parteneriat
```

#### Generation order

Sections are generated sequentially in dependency order, not document order. Rezumat is generated last because it summarizes everything:

```
Context/Justificare -> Obiective -> Metodologie ->
Plan implementare -> Grup tinta -> Buget ->
Indicatori -> Sustenabilitate -> Capacitate ->
Parteneriat -> Rezumat (last)
```

The final output reorders them by their `order` field for the document.

#### Per-section call

Each call receives:

```typescript
{
  system: buildSectionPrompt(ctx, sectionSpec, previousSections),
  messages: [{
    role: 'user',
    content: `Write section "${sectionSpec.title}" for the project proposal.`
  }],
  provider: isHeavySection(sectionSpec.title) ? 'anthropic' : 'openai',
  model: isHeavySection(sectionSpec.title) ? 'claude-opus-4-6' : 'gpt-5.4',
  maxTokens: 4000,
  temperature: 0.4
}
```

System prompt includes:
- Project concept (enhancedIdea)
- Action plan summary (actionPlan)
- Call requirements for this specific section (callBlueprint)
- Evaluation criteria and weight for this section
- All previously generated sections (for coherence)

Each call returns a simple object:

```typescript
{ title: string, content: string, order: number }
```

No array. No complex JSON. 2-4KB per section. Truncation risk massively reduced (not eliminated — a single section could still overflow if context grows too large, see Context Compaction below).

#### Model routing

**Opus 4.6 (heavy — need holistic reasoning):**
- Rezumat / Summary
- Context si justificare
- Obiective
- Metodologie
- Buget

**GPT-5.4 (light — template-driven, structured output):**
- Plan de implementare
- Grup tinta
- Indicatori
- Sustenabilitate
- Capacitate institutionala
- Parteneriat

Detection: data-driven from the SectionSpec (see below). Each SectionSpec carries a `modelHint` field set during Step 3 based on the section's evaluation weight and description. Sections with high evaluation weight or analytical requirements get `modelHint: 'heavy'`. Template/procedural sections get `modelHint: 'light'`. No keyword matching or position guessing.

#### Failure handling

- If a section call fails: retry once with same model
- If retry fails: try fallback model (Opus falls back to GPT-5.4, GPT-5.4 falls back to Claude Sonnet)
- If all fail: mark section as failed and continue

```typescript
{
  title: sectionSpec.title,
  content: "[Generarea acestei sectiuni a esuat. Editati manual sau regenerati din meniul de editare.]",
  order: sectionSpec.order,
  source: 'failed'
}
```

The user gets N-1 good sections instead of 0. Failed sections can be regenerated via Step 6 (Edit).

#### Progress streaming

The orchestrator emits progress events during the build loop:

```typescript
// Before each section
stream.send({ type: 'step_progress', step: 5, message: `Writing section ${i}/${total}: ${sectionSpec.title}...` })

// After each section
stream.send({ type: 'ai_chunk', step: 5, content: `## ${section.title}\n\n${section.content}\n\n---\n` })
```

The user sees sections appearing one by one in real time.

### Step 6: Edit (post-completion)

**Model:** GPT-5.4
**Purpose:** Regenerate or modify individual sections after project completion.
**No structural change from V1** — switch model from Claude Sonnet to GPT-5.4.

The edit agent receives the specific section to edit plus the full project context. Returns the updated section only.

## Database: call_knowledge Table

New table for caching call research results:

```sql
CREATE TABLE call_knowledge (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id         TEXT NOT NULL,
  program         TEXT NOT NULL,
  call_title      TEXT NOT NULL,
  sections        JSONB NOT NULL DEFAULT '[]',
  requirements    JSONB NOT NULL DEFAULT '{}',
  evaluation      JSONB NOT NULL DEFAULT '{}',
  eligibility     JSONB NOT NULL DEFAULT '{}',
  source          TEXT NOT NULL DEFAULT 'notebooklm',
  verified_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT call_knowledge_call_id_unique UNIQUE (call_id)
);

CREATE INDEX idx_call_knowledge_program ON call_knowledge (program);
CREATE INDEX idx_call_knowledge_verified ON call_knowledge (verified_at);
```

**JSONB column contents:**

`sections`:
```json
[
  { "title": "Rezumat", "description": "Max 2 pagini...", "evaluationWeight": 5 },
  { "title": "Relevanta proiectului", "description": "...", "evaluationWeight": 20 }
]
```

`requirements`:
```json
{
  "mandatoryAnnexes": ["Certificat de inregistrare fiscala", "..."],
  "eligibilityCriteria": ["Organizatie inregistrata in Romania", "..."],
  "cofinancingRate": 0.02,
  "maxBudget": 5000000,
  "currency": "EUR"
}
```

`evaluation`:
```json
{
  "grid": [
    { "criterion": "Relevanta", "maxPoints": 20 },
    { "criterion": "Metodologie", "maxPoints": 30 }
  ],
  "passingScore": 65
}
```

**Cache logic (in research agent):**

```
1. SELECT * FROM call_knowledge WHERE call_id = ?
2. IF found AND verified_at > NOW() - INTERVAL '7 days':
     -> Skip NotebookLM
     -> Only run Perplexity freshness check
     -> Update verified_at if still valid
3. IF found AND verified_at <= NOW() - INTERVAL '7 days':
     -> Re-query NotebookLM
     -> UPDATE record with new data + verified_at
4. IF not found:
     -> Full research (NotebookLM + Perplexity)
     -> INSERT new record
```

## Gateway Changes

### Add GPT-5.4

```typescript
case 'openai':
  clients[provider] = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
  break
```

GPT-5.4 is accessed via the standard OpenAI API with model name `gpt-5.4` (or whatever the actual model ID is — verify at implementation time).

### Updated Fallback Chain

```
perplexity  -> gemini-2.5-flash
opus-4.6    -> gpt-5.4
gpt-5.4     -> claude-sonnet-4.6
gemini      -> gpt-5.4
openai      -> gemini-2.5-flash
```

### Model Usage Summary

| Step | Model | Provider | Purpose |
|------|-------|----------|---------|
| 1. Enhance | gpt-5.4 | openai | Idea enhancement |
| 2. Match (RAG fallback) | sonar-pro | perplexity | Web search for calls |
| 2. Match (scoring) | gemini-2.5-flash | gemini | Score and rank calls |
| 3. Research | NotebookLM MCP | mcp | Knowledge retrieval |
| 3. Validate | sonar | perplexity | Freshness verification |
| 3. Eligibility | deterministic | local | Rule engine, no AI |
| 4. Plan | claude-opus-4-6 | anthropic | Action plan |
| 5. Build (heavy) | claude-opus-4-6 | anthropic | Core proposal sections |
| 5. Build (light) | gpt-5.4 | openai | Template sections |
| 6. Edit | gpt-5.4 | openai | Section edits |
| Embedding | text-embedding-3-small | openai | Vector search |

## Types Changes

### WorkflowContext (updated)

```typescript
interface WorkflowContext {
  sessionId: string
  userId: string
  locale: 'ro' | 'en'
  tier: string
  step: number                          // Now 1-5 (6 is post-completion edit)
  enhancedIdea: EnhancedIdea | null
  matchedCalls: MatchedCall[] | null
  selectedCallId: string | null
  callBlueprint: CallBlueprint | null   // NEW: replaces validationResults + researchResults
  actionPlan: ActionPlan | null
  projectSections: ProjectSection[] | null
  uploadedFiles: UploadedFile[]
}
```

**Removed:** validationResults, researchResults (merged into callBlueprint)
**Added:** callBlueprint

### CallBlueprint (new)

```typescript
interface CallBlueprint {
  callId: string
  program: string
  isOpen: boolean
  amendments: string[]
  warnings: string[]
  requiredSections: {
    title: string
    description: string
    evaluationWeight?: number
  }[]
  mandatoryAnnexes: string[]
  eligibilityCriteria: string[]
  evaluationGrid: {
    criterion: string
    maxPoints: number
  }[]
  cofinancingRate: number
  eligibilityResult: {
    score: number
    passCount: number
    failCount: number
    failures: string[]
    warnings: string[]
  }
  sources: string[]
  verifiedAt: string
}
```

### STEP_LABELS (updated)

```typescript
export const STEP_LABELS: Record<number, string> = {
  1: 'Enhancing your idea...',
  2: 'Matching with funding calls...',
  3: 'Researching call requirements...',
  4: 'Creating action plan...',
  5: 'Building your project...',
}
```

## Files Changed

### Deleted
- `agents/validate.ts` — merged into research
- `agents/knowledge.ts` — replaced by DB persistence in engine
- `prompts/validate.ts` — merged into research prompt

### New
- DB migration for `call_knowledge` table
- `prompts/build-section.ts` — per-section build prompt

### Modified
- `engine.ts` — 5 steps + edit, build loop, knowledge persistence, step renumbering
- `gateway.ts` — GPT-5.4 provider, updated fallback chain
- `types.ts` — CallBlueprint, updated WorkflowContext, 5 step labels
- `agents/enhance.ts` — GPT-5.4 instead of Gemini
- `agents/research.ts` — rewrite: NotebookLM + Perplexity + eligibility, call_knowledge cache
- `agents/plan.ts` — Opus 4.6, receives callBlueprint
- `agents/build.ts` — rewrite: per-section loop with model routing
- `agents/edit.ts` — GPT-5.4
- `prompts/enhance.ts` — updated for GPT-5.4 strengths
- `prompts/research.ts` — rewrite for NotebookLM + Perplexity dual query
- `prompts/plan.ts` — updated to use callBlueprint
- `prompts/build.ts` — split into per-section prompt

### Unchanged
- `agents/match.ts` — same logic, same model
- `prompts/match.ts` — unchanged
- `prompts/system.ts` — unchanged
- `utils.ts` — parseAIJson still used for match/research responses
- `pubsub.ts`, `stream.ts`, `cache.ts` — unchanged
- `sanitizer.ts` — unchanged
- RAG pipeline (`lib/rag/pipeline.ts`) — still used by match agent
- Eligibility rules (`lib/rules/eligibility.ts`) — now wired in, not modified

## Implementation Order

Work is sequential (each step depends on the previous):

1. **DB migration** — create `call_knowledge` table
2. **Types** — update WorkflowContext, add CallBlueprint, update step labels
3. **Gateway** — add GPT-5.4, update fallback chain
4. **Engine** — 5 steps, build loop, knowledge persistence
5. **Research agent** — NotebookLM + Perplexity + eligibility + call_knowledge cache
6. **Plan agent** — Opus 4.6, callBlueprint-aware prompt
7. **Build agent** — per-section loop, model routing, progress streaming
8. **Enhance agent** — GPT-5.4
9. **Edit agent** — GPT-5.4
10. **Prompts** — update all prompts for new context shape
11. **Delete old agents** — validate.ts, knowledge.ts, prompts/validate.ts
12. **Tests** — update unit tests for new step numbering and agents
13. **End-to-end test** — run full flow with real API keys

## Cost Estimate (per project run)

| Step | Model | Est. Tokens | Est. Cost |
|------|-------|-------------|-----------|
| 1. Enhance | GPT-5.4 | ~2K in + 1K out | ~$0.03 |
| 2. Match (Perplexity) | sonar-pro | ~2K in + 2K out | ~$0.01 |
| 2. Match (Gemini) | gemini-2.5-flash | ~4K in + 2K out | ~$0.01 |
| 3. Research (NotebookLM) | MCP | 1 query | free (quota) |
| 3. Validate (Perplexity) | sonar | ~1K in + 1K out | ~$0.005 |
| 4. Plan | opus-4.6 | ~4K in + 3K out | ~$0.30 |
| 5. Build (5 heavy) | opus-4.6 | ~5x(6K in + 3K out) | ~$1.50 |
| 5. Build (6 light) | gpt-5.4 | ~6x(5K in + 2K out) | ~$0.30 |
| **Total** | | | **~$2.15** |

Compare to V1: ~$1.50 but frequently produces unusable output (wasted). V2 costs ~40% more but every token produces usable content. Net cost per *usable* project is lower.

Second run for the same call: skip NotebookLM (~$0 savings, but faster).

## Hardening: SectionSpec Contract

Instead of implicit section metadata scattered across prompts and heuristics, each section is defined by a formal `SectionSpec`:

```typescript
interface SectionSpec {
  id: string                    // Stable identifier (e.g., 'rezumat', 'metodologie')
  title: string                 // Display title from Ghidul Solicitantului
  description: string           // What this section should contain
  order: number                 // Position in final document
  generationOrder: number       // Position in build sequence (Rezumat = last)
  importance: 'critical' | 'standard' | 'supplementary'
  expectedLength: 'short' | 'medium' | 'long'  // Guides maxTokens per call
  dependsOn: string[]           // Section IDs that must be generated first
  modelHint: 'heavy' | 'light'  // Opus vs GPT-5.4
  evaluationWeight?: number     // From call's evaluation grid
}
```

The research agent (Step 3) builds the `SectionSpec[]` from the CallBlueprint. If NotebookLM returns exact headings with evaluation weights, those drive the spec directly. If not, the fallback 11-section list provides defaults.

This makes model routing, generation order, and context inclusion all data-driven from one source of truth — no heuristics.

## Hardening: Context Compaction (Step 5)

The build loop must not become a "fat context" problem. As sections accumulate, passing all previous sections verbatim to every subsequent call would balloon the prompt.

**Strategy:**

For each section call, the context includes:
- **Full text** of the last 2 generated sections (most relevant for coherence)
- **Compressed summary** of all earlier sections (title + first 2 sentences each)
- **Full text** of any section listed in `dependsOn` for the current SectionSpec

This caps context growth at roughly: fixed project context (~3K tokens) + 2 full sections (~4K) + summaries (~2K) + dependencies (~2K) = ~11K input tokens per call, regardless of how many sections have been generated.

The compaction function:

```typescript
function compactPreviousSections(
  allSections: ProjectSection[],
  currentSpec: SectionSpec
): string {
  const dependencies = allSections.filter(s =>
    currentSpec.dependsOn.includes(s.id)
  )
  const recent = allSections.slice(-2)
  const older = allSections.slice(0, -2).filter(s =>
    !dependencies.some(d => d.id === s.id)
  )

  let context = ''
  if (dependencies.length > 0) {
    context += '### Key dependencies (full text):\n'
    for (const s of dependencies) context += `#### ${s.title}\n${s.content}\n\n`
  }
  if (recent.length > 0) {
    context += '### Recent sections (full text):\n'
    for (const s of recent) context += `#### ${s.title}\n${s.content}\n\n`
  }
  if (older.length > 0) {
    context += '### Earlier sections (summary):\n'
    for (const s of older) {
      const summary = s.content.split('. ').slice(0, 2).join('. ') + '.'
      context += `- **${s.title}**: ${summary}\n`
    }
  }
  return context
}
```

## Hardening: Section Metadata

Each generated section stores metadata alongside content for debugging, cost control, and regeneration:

```typescript
interface SectionResult {
  id: string              // From SectionSpec
  title: string
  content: string
  order: number
  source: 'generated' | 'edited' | 'failed'
  metadata: {
    model: string         // e.g., 'claude-opus-4-6'
    provider: string      // e.g., 'anthropic'
    tokensIn: number
    tokensOut: number
    latencyMs: number
    retryCount: number
    fallbackUsed: boolean
    generatedAt: string   // ISO timestamp
    checksum: string      // SHA-256 of content for change detection
  }
}
```

Stored in `project_documents.sections` JSONB. This enables:
- Per-section cost tracking (which sections are expensive?)
- Debugging failed sections (what model, how many retries?)
- Change detection on edit (did the content actually change?)
- Performance monitoring (which models are slow?)

## Hardening: CallBlueprint Raw/Normalized Layers

NotebookLM returns messy but valuable data. Instead of normalizing and losing the original, store both:

```typescript
interface CallBlueprint {
  // ... existing fields ...

  raw: {
    notebookLmResponse: string    // Exact text returned by NotebookLM
    perplexityResponse: string    // Exact text returned by Perplexity
    retrievedAt: string           // ISO timestamp
  }
  normalized: {
    requiredSections: SectionSpec[]
    mandatoryAnnexes: string[]
    eligibilityCriteria: string[]
    evaluationGrid: { criterion: string; maxPoints: number }[]
    cofinancingRate: number
  }
  structureConfidence: number     // 0.0 - 1.0, see below
}
```

The `raw` layer preserves exactly what came back. The `normalized` layer is the structured data the pipeline consumes. If normalization fails or is partial, the raw data is available for manual review or re-processing.

## Hardening: Template Confidence Gating

Not all NotebookLM responses are equally reliable. A `structureConfidence` score gates the pipeline:

**Scoring rules:**
- `requiredSections` has 5+ items with titles: +0.3
- `evaluationGrid` has 3+ criteria with point values: +0.25
- `mandatoryAnnexes` has 2+ items: +0.15
- `cofinancingRate` is a valid number > 0: +0.15
- `eligibilityCriteria` has 3+ items: +0.15

**Gating behavior:**
- **confidence >= 0.7**: Auto-advance to Step 4 (Plan). High confidence in call structure.
- **confidence 0.4-0.69**: Emit a checkpoint warning: "The call structure was partially retrieved. Some sections may use generic headings. Continue or review?" User can continue or edit the blueprint.
- **confidence < 0.4**: Fall back to the standard 11 sections AND emit a warning: "Could not retrieve the specific application structure for this call. Using standard EU proposal format." No blocking — the user already selected this call and should still get output.

This prevents the pipeline from confidently generating a misaligned application when the source data is weak.

## Hardening: Project Completion Status

Instead of treating every completed project equally, the final status reflects what actually happened:

```typescript
type ProjectCompletionStatus =
  | 'complete'              // All sections generated successfully
  | 'complete_with_gaps'    // Some sections failed, placeholders present
  | 'needs_review'          // Low structure confidence, generic sections used
  | 'blocked'               // Critical failure (e.g., plan generation failed)
```

Set at the end of Step 5:
- If all sections have `source: 'generated'` → `complete`
- If any sections have `source: 'failed'` → `complete_with_gaps`
- If `callBlueprint.structureConfidence < 0.4` → `needs_review`
- If plan or build loop failed entirely → `blocked`

Stored in `projects.completion_status` (new column) alongside the existing `status` field (`ciorna`, `in_lucru`, etc.).

The frontend can use this to show appropriate messaging:
- `complete`: "Your project proposal is ready for review."
- `complete_with_gaps`: "Your proposal is mostly complete. 2 sections need manual editing."
- `needs_review`: "Generated with standard format. Review section headings against the applicant guide."
- `blocked`: "Generation encountered errors. Please try again or contact support."

## Hardening: Cache Invalidation

The 7-day time-only cache policy is too coarse. Improve with change-aware validation:

**On cache hit (call_knowledge exists for this call_id):**
1. Run Perplexity freshness check (always — this is cheap)
2. If Perplexity reports amendments or corrigenda since `verified_at`:
   - Re-query NotebookLM for updated structure
   - Update `call_knowledge` record
   - Set `callBlueprint.amendments` with the changes found
3. If Perplexity reports no changes:
   - Update `verified_at` only
   - Use cached data

This means:
- Stable calls (no changes in months): one cheap Perplexity call, cached data reused
- Changed calls (corrigenda published): automatic re-research, user warned of amendments
- No arbitrary 7-day expiry — freshness is verified against reality, not a timer
