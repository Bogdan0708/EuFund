# QA Bugfix Plan — Playwright Full-App Test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all bugs discovered during comprehensive Playwright E2E testing of every page and the 7-phase AI project creation flow.

**Architecture:** Simple, targeted fixes — each bug gets the minimal code change. No new abstractions. No refactoring beyond what's broken.

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM, Redis, Playwright

**Principle:** Simplicity over complexity. Every fix must be the smallest possible change that solves the problem.

---

## Error Catalog (from QA run)

| # | Severity | Description | Root Cause |
|---|----------|-------------|------------|
| 1 | **P0** | AI orchestrator silently swallows 429 rate-limit error — user message appears but no feedback | `sendMessage()` catch block sets error state correctly, but the error banner only shows when `status === 'error'` AND no messages exist below it — the user message pushes it off-screen. The real problem: the error is invisible unless you scroll up. |
| 2 | **P0** | Project detail page (`/proiecte/[id]`) doesn't render — shows projects list | `params` is a Promise in Next.js 14.x latest patches but page uses `params.id` synchronously. Page crashes silently, Next.js falls back to nearest error boundary / parent. |
| 3 | **P1** | Documents page never reaches `networkidle` — fetches files for up to 10 projects sequentially, any slow/hanging endpoint blocks the page | `Promise.all` over N project file fetches with no timeout or AbortController. |
| 4 | **P1** | `GET /api/v1/projects/invalid-uuid` returns 500 | No UUID format validation before DB query. Postgres throws on invalid UUID, catch returns generic 500. |
| 5 | **P1** | Free tier limited to 1 **lifetime** workflow — too restrictive for dev/testing | `tiers.ts` has `workflowsPerMonth: 1` + `isLifetimeLimit: true` for free tier. |
| 6 | **P2** | `POST /api/ai/match-grants` with empty body returns undefined/hangs | Missing early validation — falls through to AI call that crashes. |
| 7 | **P2** | Project detail "Back to projects" button missing locale prefix | `router.push('/proiecte')` instead of `router.push(`/${locale}/proiecte`)` |

---

### Task 1: Fix AI orchestrator error display (P0)

**Files:**
- Modify: `app/src/hooks/useOrchestrator.ts:330-377` (sendMessage catch block)
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:589-601` (error banner)

The core issue: when `sendMessage` fails (e.g. 429), the user message is already added to the chat at line 340. The error banner at line 589 renders above the chat area, but the user's eye is on their message at the bottom. The fix: add the error as a visible chat message (like SSE errors already do), and remove the user's message since it wasn't actually processed.

- [ ] **Step 1: Fix sendMessage catch block to add error as chat message**

In `app/src/hooks/useOrchestrator.ts`, replace the catch block in `sendMessage`:

```typescript
// Current (line 373-377):
      } catch (err) {
        setIsStreaming(false);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Unknown error');
      }

// Replace with:
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setIsStreaming(false);
        setStatus('error');
        setError(errorMessage);
        // Remove the user message that was never processed and add error as visible chat message
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsg.id),
          {
            id: `error-send-${Date.now()}`,
            role: 'assistant',
            content: errorMessage,
            eventType: 'error',
            step: currentStep,
          },
        ]);
      }
```

Note: `currentStep` is already accessible via closure since the hook owns the state. However, `sendMessage` dependency array doesn't include it. To keep it simple, just use `0` instead:

```typescript
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== userMsg.id),
          {
            id: `error-send-${Date.now()}`,
            role: 'assistant',
            content: errorMessage,
            eventType: 'error',
            step: 0,
          },
        ]);
```

- [ ] **Step 2: Verify error rendering path in the AI page**

The page already renders `eventType === 'error'` messages as red error cards (line 662-676). Confirm this path handles `step: 0`:

In `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`, the error rendering at line 662 checks `msg.eventType === 'error'` — no step-specific logic. This will work as-is.

- [ ] **Step 3: Test manually**

1. Reset workflow count: `docker exec eu-funds-redis-1 redis-cli DEL usage:workflows:<userId>`
2. Create one workflow in the AI assistant
3. Start a new session and submit another idea
4. Verify the error message "You've used 1/1 total workflows..." appears as a red card in the chat

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useOrchestrator.ts
git commit -m "fix: show orchestrator errors as visible chat messages instead of hidden banner"
```

---

### Task 2: Fix project detail page crash (P0)

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx:177,191,210,220,238,262`

The page uses `params.id` synchronously, but in Next.js 14 App Router `params` may need to be awaited or accessed via `use()`. Additionally, the "Back to projects" button links use `/proiecte` without locale.

The simplest fix: use `useParams()` hook from `next/navigation` instead of the `params` prop, and fix the locale-less paths.

- [ ] **Step 1: Replace params prop with useParams hook**

In `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`:

Change the component signature (line 177):

```typescript
// Current:
export default function ProiectDetailPage({ params }: { params: { id: string } }) {
  const t = useTranslations('projectDetail');
  const router = useRouter();

// Replace with:
export default function ProiectDetailPage() {
  const t = useTranslations('projectDetail');
  const router = useRouter();
  const params = useParams<{ id: string; locale: string }>();
  const id = params.id;
  const locale = params.locale || 'ro';
```

Add `useParams` to the import from `next/navigation` (line 4):

```typescript
import { useRouter, useParams } from 'next/navigation';
```

- [ ] **Step 2: Replace all `params.id` with `id`**

Replace all occurrences in the file:
- Line 191: `fetch(\`/api/v1/projects/${params.id}\`)` → `fetch(\`/api/v1/projects/${id}\`)`
- Line 204: `[params.id]` → `[id]`
- Line 210: `fetch(\`/api/v1/projects/${params.id}/files\`)` → `fetch(\`/api/v1/projects/${id}/files\`)`
- Line 215: `[params.id, project]` → `[id, project]`
- Line 220: limit=20 stays the same
- Line 224: `s.projectId === params.id` → `s.projectId === id`
- Line 228: `[params.id, project]` → `[id, project]`

- [ ] **Step 3: Fix locale-less navigation**

Line 238: `router.push('/proiecte')` → `router.push(\`/${locale}/proiecte\`)`
Line 262 (if exists, similar pattern): same fix

- [ ] **Step 4: Test manually**

Navigate to `/ro/proiecte`, click a project card. The project detail page should render with title, status badge, and tabs.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(dashboard\)/proiecte/\[id\]/page.tsx
git commit -m "fix: use useParams hook for project detail page, fix locale-less navigation"
```

---

### Task 3: Fix documents page network timeout (P1)

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/documente/page.tsx:145-189`

The page fetches files for each project with no timeout. Add an AbortController with a 5-second timeout per fetch. Also handle the case where projects list returns nothing gracefully.

- [ ] **Step 1: Add timeout to file fetches**

Replace the useEffect block (lines 145-189):

```typescript
  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const projRes = await fetch('/api/v1/projects?perPage=50', {
          signal: controller.signal,
        });
        const projData = await projRes.json();
        const projects = projData.data?.items || [];

        const allFiles: AggregatedFile[] = [];

        // Fetch files for first 10 projects, 5s timeout each
        const projectsToFetch = projects.slice(0, 10);
        await Promise.all(
          projectsToFetch.map(async (project: { id: string; title: string }) => {
            try {
              const fileController = new AbortController();
              const timeout = setTimeout(() => fileController.abort(), 5000);
              const filesRes = await fetch(`/api/v1/projects/${project.id}/files`, {
                signal: fileController.signal,
              });
              clearTimeout(timeout);
              if (!filesRes.ok) return;
              const filesData = await filesRes.json();
              const projectFiles = filesData.data || filesData.files || [];
              for (const file of projectFiles) {
                allFiles.push({
                  id: file.id,
                  name: file.filename || file.name,
                  size: file.sizeBytes || file.size || null,
                  mimeType: file.mimeType || 'application/octet-stream',
                  projectId: project.id,
                  projectTitle: project.title,
                  source: file.source || 'uploaded',
                  createdAt: file.createdAt,
                  updatedAt: file.updatedAt || file.createdAt,
                });
              }
            } catch {
              // Skip projects with no files or timeout
            }
          })
        );

        setFiles(allFiles);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : t('errorLoading'));
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [t]);
```

- [ ] **Step 2: Test manually**

Navigate to `/ro/documente`. Page should load quickly with either files listed or the empty state.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/\(dashboard\)/documente/page.tsx
git commit -m "fix: add timeout to documents page file fetches to prevent hanging"
```

---

### Task 4: Validate UUID in project detail API (P1)

**Files:**
- Modify: `app/src/app/api/v1/projects/[id]/route.ts:20-25`

Add UUID format validation at the top of the GET handler. Simple regex check — no new dependencies.

- [ ] **Step 1: Add UUID validation**

In `app/src/app/api/v1/projects/[id]/route.ts`, add after line 23 (`const { id } = params;`):

```typescript
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        Errors.validation('id', 'ID de proiect invalid', 'Invalid project ID').toResponse('ro'),
        { status: 400 },
      );
    }
```

- [ ] **Step 2: Apply same validation to PUT and DELETE handlers**

Add the same block after `const { id } = params;` in the PUT handler (around line 58) and DELETE handler.

- [ ] **Step 3: Test**

```bash
curl -s http://localhost:3002/api/v1/projects/invalid-uuid -H "Cookie: ..."
# Expected: 400 with validation error, NOT 500
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/projects/\[id\]/route.ts
git commit -m "fix: validate UUID format in project detail API, return 400 instead of 500"
```

---

### Task 5: Increase free tier workflow limit for dev (P1)

**Files:**
- Modify: `app/src/lib/billing/tiers.ts:14-15`

Change free tier from 1 lifetime workflow to 3 monthly workflows. This unblocks development and gives real users a meaningful free trial.

- [ ] **Step 1: Update free tier limits**

In `app/src/lib/billing/tiers.ts`:

```typescript
// Current (line 14-15):
    workflowsPerMonth: 1,
    ...
    isLifetimeLimit: true,

// Change to:
    workflowsPerMonth: 3,
    ...
    isLifetimeLimit: false,
```

- [ ] **Step 2: Reset test user's workflow count**

```bash
docker exec eu-funds-redis-1 redis-cli KEYS "usage:workflows:*"
# Delete the key for your test user
docker exec eu-funds-redis-1 redis-cli DEL usage:workflows:<userId>
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/billing/tiers.ts
git commit -m "fix: increase free tier to 3 monthly workflows (was 1 lifetime)"
```

---

### Task 6: Fix match-grants empty body crash (P2)

**Files:**
- Modify: `app/src/app/api/ai/match-grants/route.ts` (early in the POST handler)

Add early return for missing/empty body before the AI call.

- [ ] **Step 1: Read the current route handler**

Read `app/src/app/api/ai/match-grants/route.ts` to find the exact validation location.

- [ ] **Step 2: Add early validation**

After `req.json()` parsing, add:

```typescript
    const body = await req.json();
    if (!body || (!body.companyProfile && !body.organizationType)) {
      return NextResponse.json(
        Errors.validation('body', 'Profilul organizației este obligatoriu', 'Company profile is required').toResponse(locale),
        { status: 400 },
      );
    }
```

- [ ] **Step 3: Test**

```bash
curl -s -X POST http://localhost:3002/api/ai/match-grants \
  -H "Content-Type: application/json" -H "X-CSRF-Token: ..." -H "Cookie: ..." \
  -d '{}'
# Expected: 400 validation error, NOT hang/crash
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ai/match-grants/route.ts
git commit -m "fix: validate match-grants request body before AI call"
```

---

### Task 7: Run Playwright QA re-test

**Files:**
- Run: `app/e2e/full-qa-test.spec.ts`

After all fixes are applied, re-run the Playwright test suite to verify.

- [ ] **Step 1: Reset test state**

```bash
docker exec eu-funds-redis-1 redis-cli FLUSHDB
```

- [ ] **Step 2: Run the full QA test**

```bash
cd app && npx playwright test e2e/full-qa-test.spec.ts --project=chromium --reporter=list
```

- [ ] **Step 3: Review screenshots**

Check `e2e/screenshots/full-qa/` for visual regression:
- `14-*` screenshots should show AI responding
- `15-*` screenshots should show project detail page
- `05-*` screenshots should show documents page without timeout

- [ ] **Step 4: Commit test updates if needed**

---

## Task Order

1. **Task 5** (free tier limit) — unblocks AI flow testing
2. **Task 1** (error display) — P0, makes errors visible
3. **Task 2** (project detail) — P0, fixes broken page
4. **Task 3** (documents timeout) — P1, fixes test flakiness
5. **Task 4** (UUID validation) — P1, quick fix
6. **Task 6** (match-grants) — P2, quick fix
7. **Task 7** (re-test) — verify all fixes

Total: ~7 targeted fixes, no new files, no abstractions.
