# App-Owned Workflow — PR 4: Chat Tool-Surface Trim + Iteration Caps + Sonnet Downgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind a flag, narrow the chat tool surface to 16 tools (10 read + 5 rule + 1 scoped write), inject `sectionKey` into `save_section_draft` from request context, lower both runtimes' iteration cap to 3, and downgrade V3's chat model from Opus to Sonnet.

**Architecture:** Add `chat_tools_trimmed` flag. When on:
- Managed: `getManagedTools()` filters out navigation write tools and only keeps `save_section_draft` from the write set, plus all read + rule tools.
- V3: phase registry/tool selection filters the same set.
- `save_section_draft` tool schema sees only `{ content }`; backend injects `sectionKey` from the chat request's `focusedSectionKey` (validated against `session.outline`).
- Rule tools become read-only adapters that do not persist `session.eligibility` etc.; persistence stays exclusive to the PR 3 `/actions/run-eligibility` endpoint.
- Iteration cap → 3 for both runtimes; V3 model → Sonnet for chat.

**Tech Stack:** Next.js 14, TypeScript, Anthropic SDK, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-12-app-owned-workflow-design.md` §6

**Depends on:** PR 1, PR 2, PR 3 merged.

**Flag:** `chat_tools_trimmed` (default `false` everywhere).

---

## File Inventory

**Create:**
- `app/drizzle/0038_chat_tools_trimmed_flag.sql`
- `app/drizzle/meta/_journal.json` entry.
- `app/tests/integration/managed/managed-trimmed-tools.test.ts`
- `app/tests/integration/managed/save-section-draft-injection.test.ts`
- `app/tests/integration/agent-v3/v3-trimmed-tools.test.ts`

**Modify:**
- `app/src/lib/ai/agent/managed/tools.ts` — add new `CHAT_WRITE_TOOL_NAMES` set (just `save_section_draft`); `getManagedTools(allowWrites, trimmed?)` accepts the flag and filters accordingly. Modify `save_section_draft` JSON Schema to drop `sectionKey` when trimmed mode is on.
- `app/src/lib/ai/agent/managed/runtime.ts` — read `chat_tools_trimmed` (bypass cache), pass to `getManagedTools` + thread `focusedSectionKey`; lower iteration cap to 3 when flag on.
- `app/src/lib/ai/agent/managed/executor.ts` — when `save_section_draft` arrives with no `sectionKey`, inject `ctx.focusedSectionKey`; reject with `NO_SECTION_FOCUSED` if both missing.
- `app/src/lib/ai/agent/managed/translator.ts` — add `NO_SECTION_FOCUSED` and `INVALID_FOCUSED_SECTION` to known error prefixes (so they're scrubbed from assistant text).
- `app/src/lib/ai/agent/runtime.ts` — same: read flag, filter tool registry, lower iteration cap, switch model to Sonnet, accept `focusedSectionKey` and inject into save tool args.
- `app/src/app/api/ai/agent/route.ts` — accept `focusedSectionKey` from request body; validate it's in `session.outline` (or 400 `INVALID_FOCUSED_SECTION`); thread into runtime options.
- `app/src/lib/validation/schemas.ts` (or equivalent) — add `focusedSectionKey` to the agent request schema.
- `app/src/hooks/useAgent.ts` — accept `focusedSectionKey` (local state via UI setter) and include it in `sendMessage` POST body. Expose `setFocusedSectionKey(key)`.
- `app/src/components/agent/AgentWorkspace.tsx` — when a section is clicked/focused, call `setFocusedSectionKey(spec.id)`.
- `app/src/lib/monitoring/metrics.ts` — add `iteration_cap_hit_total{runtime}` counter.

---

## Task 1: Seed `chat_tools_trimmed` feature flag

**Files:**
- Create: `app/drizzle/0038_chat_tools_trimmed_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: SQL**

```sql
-- Seed the chat_tools_trimmed feature flag (default disabled).
-- When enabled, the chat tool surface (V3 + managed) is narrowed to
-- read + rule + a single scoped save_section_draft({ content }) tool.
-- Navigation write tools (save_call_blueprint, freeze_outline,
-- set_selected_call, approve_revision, reject_section, rollback_section,
-- mark_section_stale, set_application_status, create_export_snapshot)
-- are removed from the model's tool surface. Iteration caps drop to 3
-- and V3 model swaps from Opus to Sonnet for chat turns.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'chat_tools_trimmed',
  false,
  'Narrows chat tool surface to read+rule+scoped save; drops iteration caps to 3; swaps V3 chat model to Sonnet.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Journal entry**

```json
    {
      "idx": 38,
      "version": "7",
      "when": 1778803200002,
      "tag": "0038_chat_tools_trimmed_flag",
      "breakpoints": true
    }
```

- [ ] **Step 3: Migrate + commit**

```bash
cd app && npm run db:migrate
git add app/drizzle/0038_chat_tools_trimmed_flag.sql app/drizzle/meta/_journal.json
git commit -m "feat(flags): seed chat_tools_trimmed feature flag (off)"
```

---

## Task 2: Add `focusedSectionKey` to the agent request schema

**Files:**
- Modify: the agent request Zod schema (likely `app/src/lib/validation/schemas.ts`).

- [ ] **Step 1: Locate the schema**

```bash
grep -rn "AgentRequest\|agentRequestSchema\|focusedSection" /home/godja/Dev/EU-Funds/app/src/lib/validation /home/godja/Dev/EU-Funds/app/src/app/api/ai/agent | head -10
```

- [ ] **Step 2: Add the field**

In the agent request schema:

```ts
export const agentRequestSchema = z.object({
  sessionId: z.string().uuid().optional(),
  message: z.string().min(1).max(20_000).optional(),
  action: agentActionSchema.optional(),
  locale: z.enum(['ro', 'en']).optional(),
  focusedSectionKey: z.string().min(1).max(200).optional(),
})
```

If the existing schema has a different shape, add `focusedSectionKey` to the same object. Make optional so resume / preselect flows that haven't focused a section yet still work.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/validation/schemas.ts
git commit -m "feat(schema): focusedSectionKey on agent request body"
```

---

## Task 3: Route validates `focusedSectionKey` against `session.outline`

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts`

- [ ] **Step 1: Add the validation step**

After body parsing in `app/src/app/api/ai/agent/route.ts`, before dispatching to runtime:

```ts
// If focusedSectionKey provided, verify it belongs to the session's outline.
if (parsed.data.focusedSectionKey && session) {
  const outline = (session.outline ?? []) as { id: string }[]
  const found = outline.some(s => s.id === parsed.data.focusedSectionKey)
  if (!found) {
    return NextResponse.json(
      { error: { code: 'INVALID_FOCUSED_SECTION', messageRo: 'Secțiune invalidă pentru această sesiune.', messageEn: 'Invalid section for this session.' } },
      { status: 400 },
    )
  }
}
```

Place this after the session is loaded and before the V3 or managed runtime is invoked.

- [ ] **Step 2: Pass `focusedSectionKey` into runtime options**

The runtime entry points (`runAgentTurn` for V3, `runManagedAgent` for managed) take a `RuntimeOptions` object. Add the field:

```ts
// in route.ts when building options
const runtimeOptions = {
  // existing fields
  turnId: parsed.data.turnId ?? randomUUID(),
  focusedSectionKey: parsed.data.focusedSectionKey,
}
```

- [ ] **Step 3: Extend `RuntimeOptions` type**

Find `RuntimeOptions` (likely in `lib/ai/agent/types.ts` or `runtime.ts`) and add the optional field:

```ts
interface RuntimeOptions {
  // ... existing
  focusedSectionKey?: string
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/ai/agent/route.ts app/src/lib/ai/agent/types.ts
git commit -m "feat(agent): route validates focusedSectionKey against session.outline"
```

---

## Task 4: Trim the managed tool surface behind the flag

**Files:**
- Modify: `app/src/lib/ai/agent/managed/tools.ts`

- [ ] **Step 1: Define the trimmed write set**

In `app/src/lib/ai/agent/managed/tools.ts`, immediately after the existing `WRITE_TOOL_NAMES` set (line 191-201):

```ts
// Subset of writes that remain available to the model in chat after PR 4.
// All workflow navigation writes (save_call_blueprint, freeze_outline, etc.)
// are removed; only save_section_draft remains, scoped to the request's
// focusedSectionKey at executor dispatch time.
export const CHAT_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'save_section_draft',
])
```

- [ ] **Step 2: Extend `getManagedTools` with a `trimmed` parameter**

Replace lines 223-226:

```ts
export function getManagedTools(allowWrites: boolean, trimmed = false): Tool[] {
  if (!allowWrites) {
    return MANAGED_TOOLS.filter((t) => !WRITE_TOOL_NAMES.has(t.name))
  }
  if (trimmed) {
    return MANAGED_TOOLS.filter((t) =>
      !WRITE_TOOL_NAMES.has(t.name) || CHAT_WRITE_TOOL_NAMES.has(t.name)
    )
  }
  return MANAGED_TOOLS
}
```

- [ ] **Step 3: Update the `save_section_draft` JSON Schema to omit `sectionKey` in trimmed mode**

The simplest approach: keep a single tool definition that lists `content` as the only required field; backend ignores any `sectionKey` the model might send (defense in depth) and overrides with `ctx.focusedSectionKey`. Modify the existing schema for `save_section_draft` to:

```ts
{
  name: 'save_section_draft',
  description: 'Save the current focused section\'s draft content. The target section is selected by the user in the UI; you do not choose it.',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The full section draft content.' },
    },
    required: ['content'],
    additionalProperties: false,
  },
}
```

If your existing managed tool definitions live in separate files (one per tool), edit the one for `save_section_draft` directly.

- [ ] **Step 4: Run typecheck**

```bash
cd app && npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/managed/tools.ts
git commit -m "feat(managed): CHAT_WRITE_TOOL_NAMES + getManagedTools(allowWrites, trimmed)"
```

---

## Task 5: Managed executor injects `focusedSectionKey` into `save_section_draft`

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`
- Modify: `app/src/lib/ai/agent/managed/translator.ts`
- Test: `app/tests/integration/managed/save-section-draft-injection.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// app/tests/integration/managed/save-section-draft-injection.test.ts
import { describe, it, expect, vi } from 'vitest'

const saveSpy = vi.fn().mockResolvedValue({ version: 1, sectionKey: 'intro' })

vi.mock('@/lib/ai/agent/services/sections', () => ({
  saveSectionDraftService: saveSpy,
}))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

describe('managed executor save_section_draft injection', () => {
  it('uses ctx.focusedSectionKey when model omits sectionKey', async () => {
    const { dispatchTool } = await import('@/lib/ai/agent/managed/executor')
    await dispatchTool(
      'save_section_draft',
      { content: 'body' },
      {
        userId: 'u1', sessionId: 's1', requestId: 'r1', now: new Date(),
        allowWrites: true,
        focusedSectionKey: 'intro',
      } as never,
    )
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({ sectionKey: 'intro', content: 'body' }),
    )
  })

  it('rejects when focusedSectionKey is null and model omits sectionKey', async () => {
    const { dispatchTool } = await import('@/lib/ai/agent/managed/executor')
    await expect(dispatchTool(
      'save_section_draft',
      { content: 'body' },
      { userId: 'u1', sessionId: 's1', requestId: 'r1', now: new Date(), allowWrites: true } as never,
    )).rejects.toThrow(/NO_SECTION_FOCUSED/)
  })
})
```

Adapt the dispatch function name (`dispatchTool` or whatever the managed executor exports) and `ctx` shape to match the codebase. The key assertions: focused key wins; absent key throws `NO_SECTION_FOCUSED`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/integration/managed/save-section-draft-injection.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Extend the executor's `save_section_draft` case**

In `app/src/lib/ai/agent/managed/executor.ts`, locate the `save_section_draft` case (search for `'save_section_draft'`). Update it to inject `focusedSectionKey`:

```ts
case 'save_section_draft': {
  const i = input as { content: string; sectionKey?: string }
  const sectionKey = i.sectionKey ?? ctx.focusedSectionKey
  if (!sectionKey) {
    throw new ValidationError(
      'sectionKey',
      'No section is currently focused; ask the user to focus a section in the workspace first.',
      'NO_SECTION_FOCUSED',
    )
  }
  return await services.saveSectionDraft(ctx, {
    sessionId: ctx.sessionId,
    sectionKey,
    content: i.content,
    expectedStateVersion: ctx.expectedStateVersion,
  })
}
```

Extend the executor's `ctx` type to include `focusedSectionKey?: string`.

- [ ] **Step 4: Add `NO_SECTION_FOCUSED` and `INVALID_FOCUSED_SECTION` to translator scrub-prefixes**

In `app/src/lib/ai/agent/managed/translator.ts`, locate the known-error-prefix list (look for `CONCURRENCY:`, `VALIDATION:`, etc.) and add `NO_SECTION_FOCUSED:` and `INVALID_FOCUSED_SECTION:` to it. This keeps these codes from leaking into assistant text.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd app && npx vitest run tests/integration/managed/save-section-draft-injection.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/managed/executor.ts app/src/lib/ai/agent/managed/translator.ts app/tests/integration/managed/save-section-draft-injection.test.ts
git commit -m "feat(managed): save_section_draft inherits sectionKey from ctx.focusedSectionKey"
```

---

## Task 6: Thread `focusedSectionKey` and `trimmed` flag through managed runtime

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`

- [ ] **Step 1: Read the flag once per turn**

In `app/src/lib/ai/agent/managed/runtime.ts`, near the existing flag reads:

```ts
import { isFeatureEnabled } from '@/lib/feature-flags'

const chatToolsTrimmed = await isFeatureEnabled('chat_tools_trimmed', {
  userId: ctx.userId,
  bypassCache: true,
})
```

- [ ] **Step 2: Pass `trimmed` to `getManagedTools`**

Find the existing `getManagedTools(allowWrites)` call and update:

```ts
const tools = getManagedTools(allowWrites, chatToolsTrimmed)
```

- [ ] **Step 3: Thread `focusedSectionKey` into executor context**

The runtime builds an executor context (`ServiceContext` extended with `allowWrites`, etc.). Add `focusedSectionKey: options.focusedSectionKey ?? null` to that context wherever it is constructed.

- [ ] **Step 4: Lower iteration cap when flag is on**

Find the iteration cap constant (currently 8). Replace its hardcoded use with:

```ts
const MAX_ITER = chatToolsTrimmed ? 3 : 8
```

Use `MAX_ITER` in the loop condition.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts
git commit -m "feat(managed): thread focusedSectionKey + chat_tools_trimmed gating"
```

---

## Task 7: V3 runtime — same treatment

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts`
- Modify: phase-registry / tool-registry imports

- [ ] **Step 1: Read the flag once per turn**

```ts
const chatToolsTrimmed = await isFeatureEnabled('chat_tools_trimmed', {
  userId: ctx.userId,
  bypassCache: true,
})
```

- [ ] **Step 2: Filter the V3 tool registry**

V3 has phase-gated tool registry. Locate the function that produces the tool set for the current phase (search for `getToolsForPhase` or similar). Add a `trimmed` argument; when `true`, return only the chat-allowed subset:

```ts
const READ_TOOLS = new Set([
  'search_calls', 'get_call_blueprint', 'retrieve_evidence',
  'get_application_state', 'list_sections', 'get_section',
  'get_validation_report', 'get_project_summary',
  'list_uploaded_documents', 'get_document_content',
])
const RULE_TOOLS = new Set([
  'run_eligibility', 'score_fit', 'validate_section',
  'validate_application', 'check_missing_annexes',
])
const CHAT_WRITE_TOOLS = new Set(['save_section_draft'])

function trimToChatSurface(allTools: V3Tool[]): V3Tool[] {
  return allTools.filter(t =>
    READ_TOOLS.has(t.name) || RULE_TOOLS.has(t.name) || CHAT_WRITE_TOOLS.has(t.name)
  )
}
```

When `chatToolsTrimmed === true`, run `trimToChatSurface(tools)` before passing to the planner.

- [ ] **Step 3: Iteration cap → 3 when flag on**

V3's `runAgentTurn` has a loop count cap (currently 5, line ~310 in `runtime.ts`). Replace with:

```ts
const MAX_ITER = chatToolsTrimmed ? 3 : 5
```

- [ ] **Step 4: Switch V3 chat model to Sonnet when flag on**

V3 currently uses Opus for chat planning. Identify the model selection site (search for `'claude-opus'` in `runtime.ts` or `model-routing.ts`). When trimmed:

```ts
const planningModel = chatToolsTrimmed ? 'claude-sonnet-4-6' : 'claude-opus-4-6'
```

(Adapt to exact constant names used in `lib/ai/model-routing.ts`.)

- [ ] **Step 5: Thread `focusedSectionKey` into V3's `save_section_draft` tool**

In V3's `save_section_draft` tool implementation (likely `tools/save-section-draft.ts`), add the same injection: if input has no `sectionKey`, use `ctx.focusedSectionKey`; if neither, throw `NO_SECTION_FOCUSED`.

- [ ] **Step 6: Add metric**

In `app/src/lib/monitoring/metrics.ts`:

```ts
export const iterationCapHitTotal = new Counter({
  name: 'iteration_cap_hit_total',
  help: 'Number of turns that hit the iteration cap',
  labelNames: ['runtime'],
})
```

Increment from both runtimes when the loop reaches `MAX_ITER`:

```ts
if (iteration === MAX_ITER) {
  iterationCapHitTotal.inc({ runtime: 'v3' })
  break
}
```

Same for managed (`runtime: 'managed'`).

- [ ] **Step 7: Run typecheck + existing V3 tests**

```bash
cd app && npm run typecheck
cd app && npx vitest run tests/integration/agent-v3 2>&1 | tail -20
```
Expected: no regressions.

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/ai/agent/runtime.ts app/src/lib/ai/agent/tools/save-section-draft.ts app/src/lib/monitoring/metrics.ts
git commit -m "feat(v3): trim chat tool surface + lower iter cap + Sonnet downgrade behind flag"
```

---

## Task 8: Make rule tools read-only adapters when trimmed

**Files:**
- Modify: `app/src/lib/ai/agent/tools/run-eligibility.ts` (V3)
- Modify: `app/src/lib/ai/agent/managed/executor.ts` (managed rule cases)

- [ ] **Step 1: V3 run-eligibility — no persistence in trimmed mode**

In V3's `run-eligibility` tool, locate the persistence call (typically `setEligibility(session, result)` or a `db.update(agentSessions)` write). Wrap it:

```ts
if (!ctx.chatToolsTrimmed) {
  await persistEligibilityToSession(ctx, result)
}
// Always return verdict to the model
return { result }
```

Add `chatToolsTrimmed: boolean` to `ToolContext` (already extended with `focusedSectionKey` above).

- [ ] **Step 2: Same treatment for V3 validate-section, validate-application, check-missing-annexes, score-fit if they currently persist anything**

For each, check whether the tool writes to `agent_sessions.warnings`, `agent_sessions.eligibility`, or `agent_sections` columns. If yes, gate that write on `!ctx.chatToolsTrimmed`.

- [ ] **Step 3: Managed rule tools — same treatment**

In `executor.ts`, find the case for each rule tool. If any persists, gate that persistence on `!ctx.chatToolsTrimmed`.

- [ ] **Step 4: Run regression tests**

```bash
cd app && npx vitest run tests/integration 2>&1 | grep -E "(eligibility|validate)" | head -30
```
Expected: existing tests pass with flag off (default).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/tools/ app/src/lib/ai/agent/managed/executor.ts
git commit -m "feat(agent): rule tools become read-only adapters when chat tools are trimmed"
```

---

## Task 9: Wire `focusedSectionKey` through `useAgent` and UI

**Files:**
- Modify: `app/src/hooks/useAgent.ts`
- Modify: `app/src/components/agent/AgentWorkspace.tsx`

- [ ] **Step 1: Add local state to `useAgent`**

```ts
const [focusedSectionKey, setFocusedSectionKey] = useState<string | null>(null)
const focusedSectionKeyRef = useRef<string | null>(null)
useEffect(() => { focusedSectionKeyRef.current = focusedSectionKey }, [focusedSectionKey])
```

- [ ] **Step 2: Include in `sendMessage` POST body**

When `useAgent.sendMessage(message)` constructs the request body, include:

```ts
body: JSON.stringify({
  sessionId: sessionIdRef.current,
  message,
  locale,
  focusedSectionKey: focusedSectionKeyRef.current,
}),
```

- [ ] **Step 3: Return `focusedSectionKey` and `setFocusedSectionKey`**

```ts
return {
  // ... existing
  focusedSectionKey,
  setFocusedSectionKey,
}
```

- [ ] **Step 4: Workspace sets focus on click**

In `AgentWorkspace.tsx`, when a section row is clicked / a section view becomes active, call `setFocusedSectionKey(spec.id)`. Concretely: the existing UI probably already tracks a "selected section" in local state; wire that setter to also call `setFocusedSectionKey`.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useAgent.ts app/src/components/agent/AgentWorkspace.tsx
git commit -m "feat(agent): useAgent.focusedSectionKey threaded into sendMessage"
```

---

## Task 10: Integration test — managed with trimmed flag advertises 16 tools

**Files:**
- Create: `app/tests/integration/managed/managed-trimmed-tools.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest'
import { getManagedTools, READ_TOOL_NAMES, RULE_TOOL_NAMES, CHAT_WRITE_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'

describe('getManagedTools(trimmed=true)', () => {
  it('returns exactly 16 tools when writes are allowed and trimmed is on', () => {
    const tools = getManagedTools(true, true)
    expect(tools.length).toBe(READ_TOOL_NAMES.size + RULE_TOOL_NAMES.size + CHAT_WRITE_TOOL_NAMES.size)
    const names = new Set(tools.map(t => t.name))
    for (const n of READ_TOOL_NAMES) expect(names.has(n)).toBe(true)
    for (const n of RULE_TOOL_NAMES) expect(names.has(n)).toBe(true)
    for (const n of CHAT_WRITE_TOOL_NAMES) expect(names.has(n)).toBe(true)
    expect(names.has('save_call_blueprint')).toBe(false)
    expect(names.has('freeze_outline')).toBe(false)
    expect(names.has('set_selected_call')).toBe(false)
    expect(names.has('approve_revision')).toBe(false)
  })

  it('returns the full surface when trimmed is off (back-compat)', () => {
    const tools = getManagedTools(true, false)
    const names = new Set(tools.map(t => t.name))
    expect(names.has('save_call_blueprint')).toBe(true)
    expect(names.has('freeze_outline')).toBe(true)
  })
})
```

- [ ] **Step 2: Run + commit**

```bash
cd app && npx vitest run tests/integration/managed/managed-trimmed-tools.test.ts
git add app/tests/integration/managed/managed-trimmed-tools.test.ts
git commit -m "test(managed): trimmed tool surface == 16 tools"
```

---

## Task 11: Integration test — V3 trimmed tool surface

**Files:**
- Create: `app/tests/integration/agent-v3/v3-trimmed-tools.test.ts`

- [ ] **Step 1: Write the test**

Test that V3's tool registry, when filtered through `trimToChatSurface`, returns only the 16 chat tools. Adapt to the actual V3 registry API (e.g., `getToolsForPhase('drafting', { trimmed: true })`).

```ts
import { describe, it, expect } from 'vitest'
import { trimToChatSurface } from '@/lib/ai/agent/runtime'  // export it if currently private
import { allRegisteredTools } from '@/lib/ai/agent/tools'  // adapt to actual export

describe('V3 trimmed tool surface', () => {
  it('removes navigation writes', () => {
    const trimmed = trimToChatSurface(allRegisteredTools())
    const names = new Set(trimmed.map(t => t.name))
    expect(names.has('save_call_blueprint')).toBe(false)
    expect(names.has('freeze_outline')).toBe(false)
    expect(names.has('set_selected_call')).toBe(false)
    expect(names.has('save_section_draft')).toBe(true)
    expect(names.has('search_calls')).toBe(true)
    expect(names.has('run_eligibility')).toBe(true)
  })
})
```

If `trimToChatSurface` is private to `runtime.ts`, export it (it's a pure utility, safe to expose).

- [ ] **Step 2: Run + commit**

```bash
cd app && npx vitest run tests/integration/agent-v3/v3-trimmed-tools.test.ts
git add app/src/lib/ai/agent/runtime.ts app/tests/integration/agent-v3/v3-trimmed-tools.test.ts
git commit -m "test(v3): trimmed tool surface excludes navigation writes"
```

---

## Task 12: Final regression sweep + manual smoke

- [ ] **Step 1: Full suite**

```bash
cd app && npm run typecheck && npm run test
```
Expected: all green.

- [ ] **Step 2: Enable flag + smoke**

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = true WHERE key = 'chat_tools_trimmed'"
```

Open `/ro/proiecte/nou`, complete preselect (also needs `preselect_no_auto_send` on), click into a section, type "rewrite this paragraph more formally." Observe:
- Model uses Sonnet (check provider logs / cost telemetry).
- Iteration count ≤ 3.
- `save_section_draft` succeeds and targets the focused section.
- Attempts to ask the model to "freeze the outline" produce a textual response (model has no `freeze_outline` tool).

- [ ] **Step 3: Disable flag + verify legacy path unchanged**

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = false WHERE key = 'chat_tools_trimmed'"
```

Smoke the legacy chat flow; tools surface should be the full 24-tool managed set.

- [ ] **Step 4: Watch metrics for a week**

After staff rollout, query:
```bash
curl -s http://localhost:3002/api/metrics | grep iteration_cap_hit_total
```
If `runtime="v3"` or `runtime="managed"` show non-trivial values, raise `MAX_ITER` before percentage rollout.

---

## Self-Review Checklist

- [ ] Spec §6 coverage: tool-surface removals ✓ Tasks 4, 7 (V3 + managed share the same exclusion list semantically). focusedSectionKey injection ✓ Tasks 3, 5, 9. Iteration cap 3 ✓ Tasks 6, 7. V3 Sonnet downgrade ✓ Task 7. Rule tools as read-only adapters ✓ Task 8. Metric ✓ Task 7. `NO_SECTION_FOCUSED` + `INVALID_FOCUSED_SECTION` scrubbed in managed translator ✓ Task 5.
- [ ] No placeholders.
- [ ] Type consistency: `chatToolsTrimmed: boolean` and `focusedSectionKey?: string` named identically in V3 + managed `ToolContext`/`RuntimeOptions`.
- [ ] One commit per task.

## Definition of Done

- `chat_tools_trimmed = false` initially in production.
- Flag on for staff: managed advertises 16 tools, V3 advertises 16, iteration cap 3, V3 chat uses Sonnet, `save_section_draft` always targets the focused section.
- Flag off: legacy 24-tool surface and 5/8 caps and Opus chat unchanged.
- `iteration_cap_hit_total{runtime}` metric reports values.
- New unit + integration tests green; existing suites green.
- Manual smoke confirms model cannot invoke `freeze_outline` / `save_call_blueprint` / etc. through chat when flag is on.
