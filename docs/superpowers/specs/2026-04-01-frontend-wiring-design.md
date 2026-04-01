# Frontend Wiring + Text Readability — Design Spec

**Date:** 2026-04-01
**Approach:** B — Structured Wiring (extend useOrchestrator hook, plain fetch for other pages)
**Scope:** Wire all dashboard pages to real APIs, fix text readability tokens

---

## Constraints

- No new dependencies (no SWR, no React Query)
- AI assistant first — it's the core product
- Follow Google agent research: 1 agent per sequential step, centralized orchestrator for parallel sub-tasks, simplicity over cleverness
- Funding calls = DB + web verification + AI discovery (3-layer model)
- "Create Project" everywhere → AI workspace (projects created through orchestrator)
- All text via `useTranslations()` — no hardcoded strings

---

## Section 1: AI Assistant Wiring

### Backend Fixes (4 changes)

**1. Expose session context in messages API**

File: `app/src/app/api/ai/orchestrator/messages/route.ts`

The current session select doesn't include the `context` JSONB field. The canvas needs `session.context.matchedCalls`, `.actionPlan`, `.projectSections` to render structured outputs.

Change: Include `context` in the session select. Response becomes `{ messages, session: { ...fields, context } }`.

**2. Preserve raw message content**

File: `app/src/app/api/ai/orchestrator/messages/route.ts`

`tryParseContent()` flattens JSON into `"key: value\nkey: value"` strings, destroying structured data. The canvas can't reconstruct matched calls or proposal sections from flattened strings on reconnect.

Fix: Canvas reads only `session.context` (fix #1 above), not individual message content. This makes fix #2 unnecessary if #1 is done. If we later need per-message structured data, add `rawContent` field alongside display `content`.

**3. Redis session lock**

File: `app/src/app/api/ai/orchestrator/message/route.ts`

No mutex on session processing. Two browser tabs can send messages to the same session simultaneously, corrupting the step sequence.

Fix: Before `processMessage()`, acquire `SETNX orchestrator:lock:{sessionId}` with 5-min TTL. If lock held → return `409 Conflict`. Release lock when the engine emits `step_complete`, `checkpoint`, `error`, or `done` events.

**4. Filter replay by lastEventId**

File: `app/src/app/api/ai/orchestrator/stream/route.ts`

The replay query (lines 39-59) fetches ALL messages when `Last-Event-ID` is present — no `WHERE eventId > lastEventId` filter. Causes duplicate messages on reconnect.

Fix: Add `.where(gt(workflowMessages.eventId, parseInt(lastEventId)))` to the replay query.

### Hook Extension: CanvasState

File: `app/src/hooks/useOrchestrator.ts`

Add ~50 lines to track canvas state derived from SSE events and loaded session context.

```typescript
interface CanvasState {
  matchedCalls: MatchedCall[] | null;        // Populated at step 2
  actionPlan: ActionPlan | null;              // Populated at step 6
  proposalSections: ProposalSection[] | null; // Populated at step 7
  activeTab: 'calls' | 'plan' | 'proposal';  // Auto-advances with steps
}
```

**Population logic:**

- **Live (approach A):** On `step_complete` SSE events for steps 2, 6, 7 — parse structured data from the event. The engine already stores step results in the session context JSONB; emit a context snapshot in step_complete metadata.
- **Reconnect (approach B):** On `resumeSession()` → `loadHistory()` fetches `{ messages, session }`. Read `session.context.matchedCalls`, `.actionPlan`, `.projectSections` to reconstruct canvas state.
- **Tab auto-advance:** `activeTab` derives from `currentStep`: step < 2 → canvas hidden, steps 2-5 → 'calls', step 6 → 'plan', step 7+ → 'proposal'.

The hook returns `canvasState` alongside existing `messages`, `currentStep`, `status`, etc.

### Page Component Architecture

File: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`

Replace all hardcoded data with hook outputs. Keep existing layout structure (split-panel matches Stitch).

```
asistent-ai/page.tsx
├── useOrchestrator(locale)
├── useTranslations()
│
├── ChatPanel (LEFT 55%)
│   ├── StepProgressBar         7-step horizontal dots from currentStep
│   ├── MessageList             renders messages[] by eventType:
│   │   ├── UserBubble            role='user' → right-aligned blue pill
│   │   ├── AssistantBubble       role='assistant' → left glass card
│   │   ├── StepIndicator         eventType='step_start' → subtle label
│   │   ├── CheckpointCard        eventType='checkpoint' → interactive:
│   │   │   ├── SelectOptions       type='select' → clickable cards (call selection)
│   │   │   ├── ConfirmButtons      type='confirm' → Continue / Modify buttons
│   │   │   └── FreetextInput       type='freetext' → input + suggested chips
│   │   └── StreamingIndicator    isStreaming → animated dots
│   └── ChatInput                text input + send button → sendMessage()
│
└── CanvasPanel (RIGHT 45%)
    ├── TabBar                   calls | plan | proposal (from canvasState.activeTab)
    │                            Hidden when step < 2
    ├── CallsTab                 canvasState.matchedCalls → CallMatchCard[]
    │   └── CallMatchCard          title, program badge, match%, deadline, "Start Project"
    ├── PlanTab                  canvasState.actionPlan → PlanStep[]
    │   └── PlanStep               category, description, deadline, dependencies
    └── ProposalTab              canvasState.proposalSections → ProposalSection[]
        └── ProposalSection        title, content, status badge (draft/review/final)
            └── "Ask AI to improve" → sendMessage("Improve section: {title}")
```

### Session Management

- **New session:** User types in empty chat → `sendMessage()` → POST creates session → SSE connects → step 1 starts. Canvas hidden until step 2.
- **Resume session:** From dashboard "Continue" banner or direct URL `/asistent-ai?session={id}` → `resumeSession(id)` → loads history + reconstructs canvas state + connects SSE.
- **Post-completion edit:** Session status = 'completed' → chat stays open → user sends edit requests → edit agent updates sections → canvas `proposalSections` refreshes.

---

## Section 2: Dashboard (Smart Landing)

File: `app/src/app/[locale]/(dashboard)/panou/page.tsx`

Currently an empty `<h1>` stub. Becomes the entry point to the AI workflow.

### New User (no projects, no sessions)

- Welcome headline with user's first name
- **Hero input** — large glass-panel input. Placeholder: "Descrie ideea ta de proiect..." / "Describe your project idea..."
- On submit: POST to `/api/ai/orchestrator/message` with the text, get `sessionId` back, navigate to `/asistent-ai?session={sessionId}`
- 3 quick-start cards below: Browse Calls (→ /finantari), Check Eligibility (→ /asistent-ai), Upload Documents (→ /documente)
- No API calls needed — just session user name

### Returning User (has projects/sessions)

- Time-of-day greeting with first name
- **Continue banner** (accent border): shows active AI session label, step progress, last active time. "Resume" → navigates to `/asistent-ai?session={id}`
- **Recent projects** (3 most recent): title, status badge, last updated
- Hero input at bottom (smaller)

**Data sources:**
- Greeting: session user name
- Continue banner: `GET /api/ai/orchestrator/sessions?status=active&limit=1`
- Projects: `GET /api/v1/projects?perPage=3`

**Key decision:** Hero input kicks off the orchestrator then navigates to `/asistent-ai`. Dashboard does NOT embed the full chat — it just starts the session.

---

## Section 3: Projects Page

### List (`/proiecte`)

File: `app/src/app/[locale]/(dashboard)/proiecte/page.tsx`

- Fetch: `GET /api/v1/projects?page=1&perPage=12` via `useEffect` + `csrfFetch()`
- Search: debounced `?search=` query param (300ms)
- Status filter: maps UI labels to DB enum values (`ciorna`→draft, `in_lucru`→in_progress, `verificare`→submitted, `aprobat`→approved)
- "Create Project" button → navigates to `/asistent-ai`
- Ghost card (always last): dashed border, "+" icon → `/asistent-ai`
- Empty state: centered "No projects yet" + "Start your first project" button → `/asistent-ai`
- Loading: skeleton cards matching existing layout
- Error: inline error message with retry button

### Detail (`/proiecte/[id]`)

File: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`

- Fetch: `GET /api/v1/projects/{id}` (confirmed: endpoint exists at `app/src/app/api/v1/projects/[id]/route.ts`)
- Tabs: Overview (project sections + key metrics), Documents (linked files), AI History (read-only chat)
- "Resume AI Session" → `/asistent-ai?session={sessionId}` (sessionId from project's linked workflow session)
- Status badge maps both V1 (Romanian) and V2 (English) enum values via i18n

---

## Section 4: Funding Calls Page

File: `app/src/app/[locale]/(dashboard)/finantari/page.tsx`

### Three-Layer Model

**Layer 1 — Database (ships first):**
- Fetch: `GET /api/v1/calls?status=open&perPage=20`
- Status filter chips: Open / Forthcoming / Closed (maps to DB enum values)
- Program filter: from program badges in response
- Search: debounced `?search=` query param
- Each card: program badge (PNRR/PEO/POTJ), title, budget range, deadline, status
- "Start Project" on open calls → `/asistent-ai`
- Pagination: "Load more" button increments page

**Layer 2 — Web Verification (uses existing data):**
- If `lastVerifiedAt` exists in call data, show trust badge:
  - Verified < 48h → green checkmark
  - Verified > 7d → amber "Needs check"
  - No `lastVerifiedAt` → no badge (curated, unverified)
- No new API needed — just render existing field

**Layer 3 — AI Discovery (endpoint confirmed: `app/src/app/api/ai/search-calls/route.ts`):**
- When filter results are few/empty OR user clicks "AI Smart Match": trigger `POST /api/ai/search-calls` with `{ query, region?, sector? }`
- Show "Searching the web for matching calls..." animation while loading
- Render results with "Web result" badge at reduced opacity, distinct from DB calls
- Each result includes: title, program, sourceUrl, deadline, budgetRange, status, summary
- "Start project with this call" → navigates to `/asistent-ai`
- Proactive: subtle expandable card at bottom "AI found N more calls not in our database"

---

## Section 5: Settings Page

File: `app/src/app/[locale]/(dashboard)/setari/page.tsx`

### Card 1: Profile
- Read: session user (name, email)
- Read: `GET /api/v1/organizations` (user's org name, type)
- Language selector: changes locale, redirects

### Card 2: AI Preferences
- Read: `GET /api/v1/user/preferences` (defaultModel, responseStyle, autoApprove)
- Write: `POST /api/v1/user/preferences` on save
- Model dropdown: Auto / Claude Sonnet / Gemini Pro / GPT-4o / Perplexity
- Response style: Concise / Detailed / Technical
- Auto-approve toggle

### Card 3: Subscription
- Read: user tier from session + `GET /api/billing/pricing` for plan details
- Usage meters: placeholder values until billing tracking is implemented
- "Manage Billing" → `POST /api/billing/portal` → Stripe redirect

### Card 4: Privacy & Data
- Toggles: connect to `PATCH /api/auth/consent`
- "Export my data" / "Delete account" — show buttons, wire later

---

## Section 6: Documents Page

File: `app/src/app/[locale]/(dashboard)/documente/page.tsx`

No dedicated documents list API exists. Documents are per-project.

**Approach:** Fetch all user projects via `GET /api/v1/projects`, aggregate their linked documents into a unified list. Group by "Project Documents" and "Generated" (AI outputs).

- Filter chips: All / Recent / by project name
- File cards: type icon, filename, size, project tag, last modified
- Upload, preview, delete — deferred. UI shows existing data only.

---

## Section 7: Text Readability Fix

File: `app/src/styles/tokens.css`

Darken two design tokens for WCAG AA compliance on `#F5F5F7` background:

- `--on-surface-variant`: `65 71 83` → `55 58 65` (contrast ratio 4.1:1 → 5.5:1)
- `--outline`: `113 119 133` → `85 90 100` (contrast ratio 3.1:1 → 4.5:1)

Applied globally via CSS custom properties — fixes all secondary text and labels across all pages at once. No per-component changes needed.

---

## Data Fetching Pattern

All pages use the same simple pattern:

```typescript
// In each page component
const [data, setData] = useState<T | null>(null)
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
  csrfFetch('/api/v1/endpoint')
    .then(res => res.json())
    .then(data => { setData(data); setLoading(false) })
    .catch(err => { setError(err.message); setLoading(false) })
}, [])
```

No shared abstraction, no custom hook factory, no data layer. Each page owns its own fetch. If this becomes painful later, extract a `useFetch()` hook — but not preemptively.

---

## Execution Order

1. **Backend fixes** — context exposure, replay dedup, Redis lock (prerequisite for AI assistant)
2. **AI Assistant** — wire useOrchestrator + canvas to asistent-ai page
3. **Dashboard** — smart landing with hero input + continue banner
4. **Projects + Funding Calls** — read-only wiring with real API data
5. **Settings + Documents** — preferences persistence, document aggregation
6. **Text readability** — 2-line tokens.css change
7. **Visual QA** — browse each page, compare with Stitch, fix issues

---

## Out of Scope

- Document upload/preview/delete (UI exists, backend partially exists, defer wiring)
- Legislație page (doesn't exist, not in scope)
- Inline proposal editing in canvas (show sections read-only, editing via chat "Ask AI to improve")
- DOCX export (button exists, wire later)
- Notifications panel
- Session cleanup cron
- Knowledge store persistence (Step 5 Qdrant upsert)
- Billing mid-workflow checks
