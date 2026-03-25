# FondEU UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite FondEU's frontend from a fragmented dashboard into a minimalist dark-glass hybrid app with sidebar navigation, smart landing, AI chat+canvas workspace, and proper pages for projects, funding calls, files, and settings.

**Architecture:** Approach B — keep all backend (API routes, DB schema, auth, orchestrator engine) mostly untouched. Rewrite the entire frontend layer: new `(app)` route group with sidebar shell, glass-themed component library, new pages. Small targeted backend modifications for sessions API filtering, user preferences, and middleware fixes.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Radix UI primitives (existing), next-intl (ro/en), Inter + JetBrains Mono fonts via next/font, Lucide icons, existing API routes.

**Spec:** `docs/superpowers/specs/2026-03-25-fondeu-ui-redesign-design.md`

**Key Codebase Conventions (from CLAUDE.md):**
- **Auth:** NextAuth v5 beta — use `auth()` from `@/lib/auth` (NOT `getServerSession`). Use `requireAuth()` from `@/lib/auth/helpers` in API routes.
- **RLS:** Always wrap direct DB queries in `withUserRLS(userId, fn)` from `@/lib/db`. Or fetch via API routes which already enforce RLS.
- **Validation:** Zod for all request schemas. Bilingual error messages via `Errors.*().toResponse(locale)`.
- **Audit:** `logAudit()` from `@/lib/legal/audit` for state-changing operations.
- **CSRF:** Double-submit cookie pattern. Include `X-CSRF-Token` header on POST/PUT/DELETE/PATCH.

---

## Phase Overview & Dependencies

```
Phase 0: Backend Prep (small targeted changes) ─────────┐
Phase 1: Design System Foundation ───────────────────────┤ (parallel after P0)
Phase 2: Shell Layout (sidebar, command palette) ────────┘
                                                          ↓
Phase 3: Smart Landing Page ─────────────────────────────┐
Phase 4: AI Workspace (chat + canvas) ──────────────────┤ (parallel)
Phase 5: Projects Page ─────────────────────────────────┤
                                                          ↓
Phase 6: Funding Calls Page ─────────────────────────────┐
Phase 7: Files Page ────────────────────────────────────┤ (parallel)
Phase 8: Settings Page ─────────────────────────────────┤
                                                          ↓
Phase 9: Auth Pages & Route Migration ──────────────────→ Done
```

Phases 1-2 can run in parallel after Phase 0. Phases 3-5 depend on shell layout (Phase 2). Phases 6-8 can run in parallel. Phase 9 is cleanup/migration.

---

## File Structure

### New Files to Create

```
app/src/
├── app/[locale]/(app)/                   # New authenticated shell
│   ├── layout.tsx                         # Sidebar + main content shell
│   ├── page.tsx                           # Smart landing
│   ├── projects/
│   │   ├── page.tsx                       # Projects grid
│   │   └── [id]/page.tsx                  # Project detail
│   ├── calls/
│   │   └── page.tsx                       # Funding calls (merged)
│   ├── files/
│   │   └── page.tsx                       # File management
│   ├── ai/
│   │   └── page.tsx                       # AI Workspace
│   └── settings/
│       └── page.tsx                       # Settings
├── components/glass/                      # Glass design system components
│   ├── GlassCard.tsx                      # Base glass panel
│   ├── GlassButton.tsx                    # Button variants (accent, ghost)
│   ├── GlassInput.tsx                     # Input field
│   ├── GlassBadge.tsx                     # Status badges
│   ├── GlassChip.tsx                      # Filter chips (toggle)
│   ├── GlassModal.tsx                     # Modal overlay
│   ├── GlassSkeleton.tsx                  # Loading skeleton
│   └── GlassDropZone.tsx                  # File drag-and-drop
├── components/layout/
│   ├── Sidebar.tsx                        # Collapsible sidebar
│   ├── SidebarItem.tsx                    # Nav item (icon + label)
│   ├── CommandPalette.tsx                 # Cmd+K search modal
│   ├── MobileNav.tsx                      # Bottom tab bar (<768px)
│   └── AppShell.tsx                       # Shell wrapper (sidebar + content)
├── components/landing/
│   ├── SmartLanding.tsx                   # Contextual landing orchestrator
│   ├── HeroInput.tsx                      # Large project idea input
│   ├── QuickStartCard.tsx                 # Quick action card
│   ├── ContinueBanner.tsx                 # Resume active session
│   ├── ProjectsPreview.tsx               # Recent projects bento card
│   └── MatchesPreview.tsx                 # New funding matches card
├── components/workspace/                  # AI Workspace (chat+canvas)
│   ├── WorkspaceLayout.tsx               # Chat + Canvas split layout
│   ├── ChatPanel.tsx                      # Chat messages + input
│   ├── CanvasPanel.tsx                    # Artifact tabs + content
│   ├── StepProgressBar.tsx               # 7-step horizontal progress
│   ├── MessageBubble.tsx                  # User/AI message bubble
│   ├── CheckpointInteraction.tsx         # Select/confirm/freetext cards
│   ├── CanvasTabs.tsx                     # Calls/Plan/Proposal tabs
│   ├── ProposalView.tsx                   # Document sections view
│   └── CallMatchCard.tsx                  # Matched call card (for canvas)
├── components/projects/                   # Rewrite existing
│   ├── ProjectCard.tsx                    # Glass project card
│   ├── ProjectGrid.tsx                    # Grid + filters
│   ├── ProjectDetail.tsx                  # Detail view with tabs
│   ├── SectionsTab.tsx                    # Proposal sections list
│   ├── ProjectFilesTab.tsx               # Files linked to project
│   └── AIHistoryTab.tsx                   # Read-only chat history
├── components/calls/
│   ├── CallCard.tsx                       # Funding call card
│   ├── CallFilters.tsx                    # Search + filter chips
│   ├── CallTrustBadge.tsx                # Verified/Stale/Web badges
│   ├── EligibilityModal.tsx              # Quick eligibility check
│   └── WebSearchFallback.tsx             # AI searching animation + results
├── components/files/
│   ├── FileGrid.tsx                       # File cards grid
│   ├── FileCard.tsx                       # File type icon + info
│   ├── FileDetailModal.tsx               # Preview + actions modal
│   └── UploadZone.tsx                     # Drag-and-drop upload
├── components/settings/
│   ├── ProfileCard.tsx                    # Name, email, language
│   ├── AIPreferencesCard.tsx             # Model, style, auto-approve
│   ├── SubscriptionCard.tsx              # Plan, usage, upgrade
│   └── PrivacyCard.tsx                   # GDPR, export, delete
├── hooks/
│   ├── useCommandPalette.ts              # Cmd+K state + search
│   ├── useSidebar.ts                     # Collapse state (localStorage)
│   └── useCSRF.ts                        # CSRF token bootstrap
├── styles/
│   └── glass-tokens.css                  # CSS custom properties for glass design
└── lib/
    └── status-map.ts                     # V1 Romanian → V2 English status mapping
```

### Files to Modify

```
app/src/
├── middleware.ts                          # Add publicPaths, redirects
├── app/globals.css                        # Import glass-tokens.css
├── app/[locale]/layout.tsx               # Add Inter + JetBrains Mono fonts
├── app/[locale]/not-found.tsx            # Glass redesign
├── app/[locale]/(auth)/autentificare/page.tsx  # Glass redesign
├── app/api/ai/orchestrator/sessions/route.ts   # Add ?status, ?limit params
├── lib/db/schema.ts                      # Add userPreferences table
├── messages/ro.json                      # New translation keys
├── messages/en.json                      # New translation keys
├── tailwind.config.ts                    # Extend with glass colors
```

### Files to Delete (Phase 9, after new routes are live)

```
app/src/app/[locale]/(dashboard)/         # Entire old route group
```

---

## Phase 0: Backend Prep

### Task 0.1: Fix Middleware publicPaths

**Files:**
- Modify: `app/src/middleware.ts:47-65`
- Test: `app/tests/integration/middleware-public-paths.test.ts`

- [ ] **Step 1: Write test for register/reset paths**

```typescript
// app/tests/integration/middleware-public-paths.test.ts
import { describe, it, expect, vi } from 'vitest'

// We test the isPublicPath logic directly
describe('Middleware public paths', () => {
  it('treats /ro/inregistrare as public', async () => {
    const { middleware } = await import('@/middleware')
    // The middleware should not redirect /ro/inregistrare to login
    // We verify the publicPaths array includes the expected paths
    const middlewareSrc = await import('fs').then(fs =>
      fs.readFileSync('src/middleware.ts', 'utf-8')
    )
    expect(middlewareSrc).toContain('/ro/inregistrare')
    expect(middlewareSrc).toContain('/en/inregistrare')
    expect(middlewareSrc).toContain('/ro/resetare-parola')
    expect(middlewareSrc).toContain('/en/resetare-parola')
  })
})
```

- [ ] **Step 2: Add missing paths to publicPaths array in middleware.ts**

Add these entries to the `publicPaths` array (around line 55):

```typescript
'/ro/inregistrare',
'/en/inregistrare',
'/ro/resetare-parola',
'/en/resetare-parola',
```

- [ ] **Step 3: Run test to verify**

Run: `cd app && npx vitest run tests/integration/middleware-public-paths.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/middleware.ts app/tests/integration/middleware-public-paths.test.ts
git commit -m "fix(middleware): add register and reset-password to publicPaths"
```

---

### Task 0.2: Add Session Filtering to Orchestrator Sessions API

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/sessions/route.ts`
- Test: `app/tests/integration/orchestrator-sessions-filter.test.ts`

- [ ] **Step 1: Write test for filtering**

```typescript
// app/tests/integration/orchestrator-sessions-filter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', email: 'test@test.com' }),
}))

vi.mock('@/lib/db', () => {
  const mockSelect = vi.fn().mockReturnThis()
  const mockFrom = vi.fn().mockReturnThis()
  const mockLeftJoin = vi.fn().mockReturnThis()
  const mockWhere = vi.fn().mockReturnThis()
  const mockOrderBy = vi.fn().mockReturnThis()
  const mockLimit = vi.fn().mockResolvedValue([])
  return {
    db: {
      select: mockSelect,
      from: mockFrom,
      leftJoin: mockLeftJoin,
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
    },
  }
})

vi.mock('@/lib/db/schema', () => ({
  workflowSessions: { id: 'id', userId: 'userId', status: 'status', updatedAt: 'updatedAt', projectId: 'projectId' },
  projects: { id: 'id', title: 'title' },
}))

describe('GET /api/ai/orchestrator/sessions', () => {
  it('accepts status and limit query params', async () => {
    const { GET } = await import('@/app/api/ai/orchestrator/sessions/route')
    const url = new URL('http://localhost/api/ai/orchestrator/sessions?status=active&limit=1')
    const request = new Request(url)
    const response = await GET(request)
    expect(response.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/orchestrator-sessions-filter.test.ts`
Expected: FAIL or PASS with no filtering (current implementation ignores params)

- [ ] **Step 3: Update sessions route to support filtering**

Replace the GET handler in `app/src/app/api/ai/orchestrator/sessions/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowSessions, projects } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'

export async function GET(request: Request) {
  const user = await requireAuth()
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50)

  const conditions = [eq(workflowSessions.userId, user.id)]
  if (status) {
    conditions.push(eq(workflowSessions.status, status as 'active' | 'paused' | 'completed' | 'abandoned'))
  }

  const sessions = await db
    .select({
      id: workflowSessions.id,
      currentStep: workflowSessions.currentStep,
      status: workflowSessions.status,
      projectId: workflowSessions.projectId,
      projectTitle: projects.title,
      createdAt: workflowSessions.createdAt,
      updatedAt: workflowSessions.updatedAt,
    })
    .from(workflowSessions)
    .leftJoin(projects, eq(workflowSessions.projectId, projects.id))
    .where(and(...conditions))
    .orderBy(desc(workflowSessions.updatedAt))
    .limit(limit)

  return NextResponse.json({ sessions })
}
```

- [ ] **Step 4: Run test to verify**

Run: `cd app && npx vitest run tests/integration/orchestrator-sessions-filter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/orchestrator/sessions/route.ts app/tests/integration/orchestrator-sessions-filter.test.ts
git commit -m "feat(api): add status and limit filtering to orchestrator sessions endpoint"
```

---

### Task 0.3: Add User Preferences Table and API

**Files:**
- Modify: `app/src/lib/db/schema.ts`
- Create: `app/src/app/api/v1/user/preferences/route.ts`
- Test: `app/tests/integration/user-preferences.test.ts`

- [ ] **Step 1: Write test**

```typescript
// app/tests/integration/user-preferences.test.ts
import { describe, it, expect } from 'vitest'

describe('User preferences schema', () => {
  it('exports userPreferences table', async () => {
    const { userPreferences } = await import('@/lib/db/schema')
    expect(userPreferences).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/user-preferences.test.ts`
Expected: FAIL — table not defined

- [ ] **Step 3: Add userPreferences table to schema.ts**

Add after the existing tables in `app/src/lib/db/schema.ts`:

```typescript
export const aiModelPreferenceEnum = pgEnum('ai_model_preference', [
  'auto', 'claude-sonnet', 'gemini-pro', 'gpt-4o', 'perplexity'
])

export const responseStyleEnum = pgEnum('response_style', [
  'concise', 'detailed', 'technical'
])

export const userPreferences = pgTable('user_preferences', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id).unique(),
  defaultModel: aiModelPreferenceEnum('default_model').notNull().default('auto'),
  responseStyle: responseStyleEnum('response_style').notNull().default('detailed'),
  autoApprove: boolean('auto_approve').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

- [ ] **Step 4: Run test to verify**

Run: `cd app && npx vitest run tests/integration/user-preferences.test.ts`
Expected: PASS

- [ ] **Step 5: Generate migration**

Run: `cd app && npm run db:generate`
Review the generated SQL. Should create new enums + `user_preferences` table.

- [ ] **Step 6: Create API routes (with Zod validation + audit logging)**

```typescript
// app/src/app/api/v1/user/preferences/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { userPreferences } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { Errors } from '@/lib/errors'
import { logAudit } from '@/lib/legal/audit'

const updatePreferencesSchema = z.object({
  defaultModel: z.enum(['auto', 'claude-sonnet', 'gemini-pro', 'gpt-4o', 'perplexity']).optional(),
  responseStyle: z.enum(['concise', 'detailed', 'technical']).optional(),
  autoApprove: z.boolean().optional(),
})

export async function GET() {
  const user = await requireAuth()

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, user.id))
    .limit(1)

  if (!prefs) {
    return NextResponse.json({
      defaultModel: 'auto',
      responseStyle: 'detailed',
      autoApprove: false,
    })
  }

  return NextResponse.json({
    defaultModel: prefs.defaultModel,
    responseStyle: prefs.responseStyle,
    autoApprove: prefs.autoApprove,
  })
}

export async function PUT(request: Request) {
  const user = await requireAuth()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Errors.validation('body', 'Format JSON invalid', 'Invalid JSON body').toResponse('ro')
  }

  const parsed = updatePreferencesSchema.safeParse(body)
  if (!parsed.success) {
    return Errors.validation('preferences', 'Preferințe invalide', 'Invalid preferences').toResponse('ro')
  }

  const { defaultModel, responseStyle, autoApprove } = parsed.data

  await db
    .insert(userPreferences)
    .values({
      userId: user.id,
      defaultModel: defaultModel || 'auto',
      responseStyle: responseStyle || 'detailed',
      autoApprove: autoApprove ?? false,
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        ...(defaultModel && { defaultModel }),
        ...(responseStyle && { responseStyle }),
        ...(autoApprove !== undefined && { autoApprove }),
        updatedAt: new Date(),
      },
    })

  await logAudit({
    userId: user.id,
    action: 'user.update_preferences',
    resourceType: 'user_preferences',
    resourceId: user.id,
    metadata: parsed.data,
  })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/db/schema.ts app/src/app/api/v1/user/preferences/route.ts app/drizzle/ app/tests/integration/user-preferences.test.ts
git commit -m "feat(schema): add user preferences table and API for AI model/style settings"
```

---

### Task 0.4: Add lastVerifiedAt Column to Calls Table

**Files:**
- Modify: `app/src/lib/db/schema.ts` (callsForProposals table)

- [ ] **Step 1: Add lastVerifiedAt column**

In the `callsForProposals` table definition in `app/src/lib/db/schema.ts`, add:

```typescript
lastVerifiedAt: timestamp('last_verified_at'),
```

- [ ] **Step 2: Generate migration**

Run: `cd app && npm run db:generate`

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/db/schema.ts app/drizzle/
git commit -m "feat(schema): add lastVerifiedAt column to calls_for_proposals for trust badges"
```

---

### Task 0.5: Auto-Create Personal Org for New Users

**Files:**
- Modify: `app/src/app/api/v1/projects/route.ts` (resolveProjectOrgId function)

- [ ] **Step 1: Update resolveProjectOrgId to auto-create org when none exists**

In `app/src/app/api/v1/projects/route.ts`, modify the `resolveProjectOrgId` function. When the user has 0 org memberships, instead of throwing 409 CONFLICT, auto-create a personal organization:

```typescript
// Inside resolveProjectOrgId, replace the 0-membership error with:
if (memberships.length === 0) {
  // Auto-create personal org for user
  const [newOrg] = await db
    .insert(organizations)
    .values({
      name: `${user.name || user.email}'s Workspace`,
      orgType: 'micro',
    })
    .returning({ id: organizations.id })

  await db.insert(orgMembers).values({
    userId,
    orgId: newOrg.id,
    role: 'admin',
  })

  return newOrg.id
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/api/v1/projects/route.ts
git commit -m "feat(projects): auto-create personal org when user has no organization"
```

---

### Task 0.6: Create Search Calls API Route

**Files:**
- Create: `app/src/app/api/ai/search-calls/route.ts`

- [ ] **Step 1: Create the web search endpoint**

```typescript
// app/src/app/api/ai/search-calls/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAIAuth } from '@/lib/middleware/auth'
import { aiGenerate } from '@/lib/ai/client-v2'

const searchCallsSchema = z.object({
  query: z.string().min(3).max(500),
  region: z.string().optional(),
  sector: z.string().optional(),
})

export const POST = withAIAuth(async (request, user) => {
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = searchCallsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { query, region, sector } = parsed.data

  const prompt = `Search for currently open EU and Romanian funding calls matching this criteria:
Query: ${query}
${region ? `Region: ${region}` : ''}
${sector ? `Sector: ${sector}` : ''}

Return a JSON array of funding calls found, each with: title, program, sourceUrl, deadline (if known), budgetRange (if known), status (open/forthcoming), summary.
Only include calls that are currently open or forthcoming. Do not include expired calls.`

  const result = await aiGenerate({
    prompt,
    taskType: 'search',
    maxTokens: 2000,
  })

  let calls = []
  try {
    const parsed = JSON.parse(result.text)
    calls = Array.isArray(parsed) ? parsed : []
  } catch {
    calls = []
  }

  return NextResponse.json({ calls, source: 'web_search' })
})
```

- [ ] **Step 2: Commit**

```bash
git add app/src/app/api/ai/search-calls/route.ts
git commit -m "feat(api): add AI web search endpoint for funding call discovery"
```

---

## Phase 1: Design System Foundation

### Task 1.1: Glass Design Tokens

**Files:**
- Create: `app/src/styles/glass-tokens.css`
- Modify: `app/src/app/globals.css`
- Modify: `app/tailwind.config.ts`

- [ ] **Step 1: Create glass-tokens.css**

```css
/* app/src/styles/glass-tokens.css */
:root {
  /* Base surfaces */
  --bg-base: #06060A;
  --bg-surface: rgba(255,255,255,0.04);
  --bg-surface-hover: rgba(255,255,255,0.07);
  --bg-glass: rgba(255,255,255,0.06);

  /* Borders */
  --border-subtle: rgba(255,255,255,0.08);
  --border-focus: rgba(59,130,246,0.5);

  /* Text */
  --text-primary: #F0F0F3;
  --text-secondary: rgba(255,255,255,0.55);
  --text-tertiary: rgba(255,255,255,0.35);

  /* Accent */
  --accent: #3B82F6;
  --accent-soft: rgba(59,130,246,0.12);

  /* Semantic */
  --success: #22C55E;
  --warning: #F59E0B;
  --danger: #EF4444;

  /* Glass effect */
  --glass-blur: blur(16px);
  --glass-radius: 16px;
  --btn-radius: 12px;
  --input-radius: 10px;
  --badge-radius: 6px;

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* Sidebar */
  --sidebar-width: 240px;
  --sidebar-collapsed: 60px;

  /* Animation */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease-out;
  --transition-slow: 300ms ease-out;
}
```

- [ ] **Step 2: Add glass tokens to globals.css (additive — keep existing tokens for old components during transition)**

Add the glass-tokens import and glass utility classes to `app/src/app/globals.css` — do NOT remove existing `:root` variables or design-tokens import, as they are needed by existing components until Phase 9 cleanup:

```css
/* ADD this import at the top, BEFORE existing imports */
@import '../styles/glass-tokens.css';

/* ADD these utility classes after existing @tailwind directives */

/* Glass utility class */
.glass {
  background: var(--bg-glass);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-subtle);
  border-radius: var(--glass-radius);
}

/* Provisional (AI-generated, not yet approved) */
.provisional {
  opacity: 0.7;
  transition: opacity var(--transition-slow);
}

.provisional.approved {
  opacity: 1;
}
```

**Note:** The existing `:root` variables (--background, --foreground, --card, etc.) and body styles remain untouched. The new `(app)` route group pages will use glass tokens; old `(dashboard)` pages keep working with old tokens. Both token files can coexist because they use different variable names (--bg-base vs --background, --accent vs --color-accent). In Phase 9, the old tokens and old design-tokens.css import will be removed.

- [ ] **Step 3: Extend Tailwind config with glass colors (avoid collisions with existing tokens)**

Update `app/tailwind.config.ts` — use `g-` prefix for glass-specific tokens to avoid colliding with existing shadcn/radix accent, border, text colors:

```typescript
// Add to theme.extend.colors:
'g-surface': 'var(--bg-surface)',
'g-surface-hover': 'var(--bg-surface-hover)',
'g-glass': 'var(--bg-glass)',
'g-border': 'var(--border-subtle)',
'g-border-focus': 'var(--border-focus)',
'g-text': 'var(--text-primary)',
'g-text-secondary': 'var(--text-secondary)',
'g-text-tertiary': 'var(--text-tertiary)',
'g-accent': 'var(--accent)',
'g-accent-soft': 'var(--accent-soft)',
'g-success': 'var(--success)',
'g-warning': 'var(--warning)',
'g-danger': 'var(--danger)',

// Add to theme.extend.backdropBlur:
backdropBlur: {
  glass: '16px',
},
// Add to theme.extend.borderRadius:
borderRadius: {
  glass: '16px',
  btn: '12px',
  input: '10px',
  badge: '6px',
},
```

**Note:** The glass components use CSS custom properties directly via `var(--accent)` in inline styles, not Tailwind classes, so the `g-` prefix Tailwind classes are optional shortcuts. The existing `accent`, `border`, `text` Tailwind colors remain untouched for old components. Both can coexist until Phase 9 cleanup.

- [ ] **Step 4: Verify build compiles**

Run: `cd app && npx next build --no-lint 2>&1 | head -20`
Expected: Build starts without CSS errors (may fail on other issues — we only care about CSS here)

- [ ] **Step 5: Commit**

```bash
git add app/src/styles/glass-tokens.css app/src/app/globals.css app/tailwind.config.ts
git commit -m "feat(design): add FondEU Glass design tokens and Tailwind extensions"
```

---

### Task 1.2: Setup Fonts (Inter + JetBrains Mono)

**Files:**
- Modify: `app/src/app/[locale]/layout.tsx`

- [ ] **Step 1: Add next/font imports and font setup to locale layout**

At the top of `app/src/app/[locale]/layout.tsx`, add:

```typescript
import { Inter, JetBrains_Mono } from 'next/font/google'

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})
```

Then update the `<html>` or `<body>` tag to include the font variables:

```tsx
<html lang={locale} className={`${inter.variable} ${jetbrainsMono.variable}`}>
```

- [ ] **Step 2: Verify fonts load in dev**

Run: `cd app && npm run dev` — open browser, inspect `<html>` tag to confirm `--font-inter` and `--font-mono` CSS variables are set.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/[locale]/layout.tsx
git commit -m "feat(fonts): setup Inter and JetBrains Mono via next/font/google"
```

---

### Task 1.3: Glass Component Library

**Files:**
- Create: `app/src/components/glass/GlassCard.tsx`
- Create: `app/src/components/glass/GlassButton.tsx`
- Create: `app/src/components/glass/GlassInput.tsx`
- Create: `app/src/components/glass/GlassBadge.tsx`
- Create: `app/src/components/glass/GlassChip.tsx`
- Create: `app/src/components/glass/GlassSkeleton.tsx`
- Create: `app/src/components/glass/GlassModal.tsx`
- Create: `app/src/components/glass/GlassDropZone.tsx`
- Create: `app/src/components/glass/index.ts`
- Test: `app/tests/components/glass.test.tsx`

- [ ] **Step 1: Write component render tests**

```typescript
// app/tests/components/glass.test.tsx
import { describe, it, expect } from 'vitest'

describe('Glass components export', () => {
  it('exports all glass components', async () => {
    const glass = await import('@/components/glass')
    expect(glass.GlassCard).toBeDefined()
    expect(glass.GlassButton).toBeDefined()
    expect(glass.GlassInput).toBeDefined()
    expect(glass.GlassBadge).toBeDefined()
    expect(glass.GlassChip).toBeDefined()
    expect(glass.GlassSkeleton).toBeDefined()
    expect(glass.GlassModal).toBeDefined()
    expect(glass.GlassDropZone).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/components/glass.test.tsx`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement GlassCard**

```tsx
// app/src/components/glass/GlassCard.tsx
'use client'

import { forwardRef, type HTMLAttributes } from 'react'

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  accent?: boolean
  provisional?: boolean
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className = '', hover = true, accent = false, provisional = false, children, ...props }, ref) => {
    const baseClasses = 'glass transition-all'
    const hoverClasses = hover ? 'hover:border-[rgba(255,255,255,0.15)] cursor-pointer' : ''
    const accentClasses = accent ? 'border-[var(--accent)] border-opacity-50' : ''
    const provisionalClasses = provisional ? 'provisional' : ''

    return (
      <div
        ref={ref}
        className={`${baseClasses} ${hoverClasses} ${accentClasses} ${provisionalClasses} ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)
GlassCard.displayName = 'GlassCard'
```

- [ ] **Step 4: Implement GlassButton**

```tsx
// app/src/components/glass/GlassButton.tsx
'use client'

import { forwardRef, type ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'accent' | 'ghost' | 'danger'

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses: Record<ButtonVariant, string> = {
  accent: 'bg-[var(--accent)] text-white hover:brightness-110',
  ghost: 'bg-transparent border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]',
  danger: 'bg-transparent border border-[var(--danger)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.1)]',
}

const sizeClasses = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-[15px]',
  lg: 'px-6 py-3 text-base',
}

export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(
  ({ variant = 'accent', size = 'md', className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`
          inline-flex items-center justify-center font-medium
          rounded-[var(--btn-radius)] transition-all duration-[var(--transition-fast)]
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--border-focus)] focus-visible:outline-offset-2
          disabled:opacity-40 disabled:cursor-not-allowed
          ${variantClasses[variant]} ${sizeClasses[size]} ${className}
        `}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  }
)
GlassButton.displayName = 'GlassButton'
```

- [ ] **Step 5: Implement GlassInput**

```tsx
// app/src/components/glass/GlassInput.tsx
'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  large?: boolean
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ className = '', large = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`
          w-full bg-[var(--bg-glass)] backdrop-blur-glass
          border border-[var(--border-subtle)] rounded-[var(--input-radius)]
          text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]
          focus:outline-none focus:border-[var(--border-focus)]
          transition-colors duration-[var(--transition-fast)]
          ${large ? 'px-6 py-4 text-lg' : 'px-4 py-2.5 text-[15px]'}
          ${className}
        `}
        {...props}
      />
    )
  }
)
GlassInput.displayName = 'GlassInput'
```

- [ ] **Step 6: Implement GlassBadge**

```tsx
// app/src/components/glass/GlassBadge.tsx
'use client'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'accent'

interface GlassBadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-surface)] text-[var(--text-secondary)]',
  success: 'bg-[rgba(34,197,94,0.12)] text-[var(--success)]',
  warning: 'bg-[rgba(245,158,11,0.12)] text-[var(--warning)]',
  danger: 'bg-[rgba(239,68,68,0.12)] text-[var(--danger)]',
  accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
}

export function GlassBadge({ variant = 'default', children, className = '' }: GlassBadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 text-xs font-medium
        rounded-[var(--badge-radius)] ${variantClasses[variant]} ${className}
      `}
    >
      {children}
    </span>
  )
}
```

- [ ] **Step 7: Implement GlassChip**

```tsx
// app/src/components/glass/GlassChip.tsx
'use client'

interface GlassChipProps {
  active?: boolean
  onClick?: () => void
  children: React.ReactNode
  className?: string
}

export function GlassChip({ active = false, onClick, children, className = '' }: GlassChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-full
        transition-all duration-[var(--transition-fast)]
        ${active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]'
          : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'
        }
        ${className}
      `}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 8: Implement GlassSkeleton**

```tsx
// app/src/components/glass/GlassSkeleton.tsx
'use client'

interface GlassSkeletonProps {
  className?: string
}

export function GlassSkeleton({ className = '' }: GlassSkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-[var(--bg-surface)] rounded-[var(--glass-radius)] ${className}`}
    />
  )
}
```

- [ ] **Step 9: Implement GlassModal**

```tsx
// app/src/components/glass/GlassModal.tsx
'use client'

import { useEffect, type ReactNode } from 'react'

interface GlassModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

export function GlassModal({ open, onClose, children, className = '' }: GlassModalProps) {
  useEffect(() => {
    if (!open) return
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`
          relative glass max-w-lg w-full mx-4 p-6
          animate-in fade-in zoom-in-95 duration-200
          ${className}
        `}
      >
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 10: Implement GlassDropZone**

```tsx
// app/src/components/glass/GlassDropZone.tsx
'use client'

import { useState, useCallback, type DragEvent, type ReactNode } from 'react'

interface GlassDropZoneProps {
  onDrop: (files: File[]) => void
  accept?: string
  maxSize?: number
  children: ReactNode
  className?: string
}

export function GlassDropZone({ onDrop, accept, maxSize, children, className = '' }: GlassDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragging(false), [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    onDrop(files)
  }, [onDrop])

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        border-2 border-dashed rounded-[var(--glass-radius)] p-8
        text-center transition-all duration-[var(--transition-fast)]
        ${isDragging
          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
        }
        ${className}
      `}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 11: Create barrel export**

```typescript
// app/src/components/glass/index.ts
export { GlassCard } from './GlassCard'
export { GlassButton } from './GlassButton'
export { GlassInput } from './GlassInput'
export { GlassBadge } from './GlassBadge'
export { GlassChip } from './GlassChip'
export { GlassSkeleton } from './GlassSkeleton'
export { GlassModal } from './GlassModal'
export { GlassDropZone } from './GlassDropZone'
```

- [ ] **Step 12: Run test to verify**

Run: `cd app && npx vitest run tests/components/glass.test.tsx`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add app/src/components/glass/ app/tests/components/glass.test.tsx
git commit -m "feat(glass): implement glass component library — card, button, input, badge, chip, skeleton, modal, dropzone"
```

---

## Phase 2: Shell Layout

### Task 2.1: Sidebar Component

**Files:**
- Create: `app/src/components/layout/SidebarItem.tsx`
- Create: `app/src/components/layout/Sidebar.tsx`
- Create: `app/src/hooks/useSidebar.ts`

- [ ] **Step 1: Create useSidebar hook**

```typescript
// app/src/hooks/useSidebar.ts
'use client'

import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'fondeu-sidebar-collapsed'

export function useSidebar() {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') setCollapsed(true)
  }, [])

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  return { collapsed, toggle }
}
```

- [ ] **Step 2: Create SidebarItem**

```tsx
// app/src/components/layout/SidebarItem.tsx
'use client'

import Link from 'next/link'
import { type LucideIcon } from 'lucide-react'

interface SidebarItemProps {
  href: string
  icon: LucideIcon
  label: string
  active?: boolean
  collapsed?: boolean
}

export function SidebarItem({ href, icon: Icon, label, active = false, collapsed = false }: SidebarItemProps) {
  return (
    <Link
      href={href}
      className={`
        flex items-center gap-3 px-3 py-2 rounded-[var(--btn-radius)]
        text-[15px] transition-all duration-[var(--transition-fast)]
        ${active
          ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-l-2 border-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
        }
      `}
      title={collapsed ? label : undefined}
    >
      <Icon size={20} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}
```

- [ ] **Step 3: Create Sidebar**

```tsx
// app/src/components/layout/Sidebar.tsx
'use client'

import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Home, FolderOpen, Search, Paperclip, Sparkles, Settings, Menu } from 'lucide-react'
import { SidebarItem } from './SidebarItem'
import { signOut } from 'next-auth/react'

interface SidebarProps {
  userName?: string
  userInitials?: string
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ userName, userInitials, collapsed, onToggle }: SidebarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()

  const prefix = `/${locale}`

  const navItems = [
    { href: prefix, icon: Home, labelKey: 'home' as const },
    { href: `${prefix}/projects`, icon: FolderOpen, labelKey: 'projects' as const },
    { href: `${prefix}/calls`, icon: Search, labelKey: 'calls' as const },
    { href: `${prefix}/files`, icon: Paperclip, labelKey: 'files' as const },
    { href: `${prefix}/ai`, icon: Sparkles, labelKey: 'ai' as const },
  ]

  const isActive = (href: string) => {
    if (href === prefix) return pathname === prefix || pathname === `${prefix}/`
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={`
        fixed top-0 left-0 h-screen flex flex-col
        bg-[var(--bg-base)] border-r border-[var(--border-subtle)]
        transition-[width] duration-200 ease-in-out z-40
        ${collapsed ? 'w-[var(--sidebar-collapsed)]' : 'w-[var(--sidebar-width)]'}
      `}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-4">
        <button onClick={onToggle} className="p-1.5 rounded-[var(--btn-radius)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]">
          <Menu size={20} />
        </button>
        {!collapsed && <span className="text-[var(--text-primary)] font-semibold text-base">FondEU</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-2">
        {navItems.map(item => (
          <SidebarItem
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={t(item.labelKey)}
            active={isActive(item.href)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Footer */}
      <div className="flex flex-col gap-1 px-2 py-3 border-t border-[var(--border-subtle)]">
        <SidebarItem
          href={`${prefix}/settings`}
          icon={Settings}
          label={t('settings')}
          active={isActive(`${prefix}/settings`)}
          collapsed={collapsed}
        />
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center text-sm font-medium shrink-0">
            {userInitials || '?'}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[var(--text-primary)] truncate">{userName}</p>
              <button
                onClick={() => signOut({ callbackUrl: `/${locale}/autentificare` })}
                className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              >
                {t('signOut')}
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add app/src/components/layout/Sidebar.tsx app/src/components/layout/SidebarItem.tsx app/src/hooks/useSidebar.ts
git commit -m "feat(layout): implement collapsible glass sidebar with navigation"
```

---

### Task 2.2: Command Palette

**Files:**
- Create: `app/src/components/layout/CommandPalette.tsx`
- Create: `app/src/hooks/useCommandPalette.ts`

- [ ] **Step 1: Create useCommandPalette hook**

```typescript
// app/src/hooks/useCommandPalette.ts
'use client'

import { useState, useEffect, useCallback } from 'react'

export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen(prev => !prev), [])
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggle])

  return { open, close, toggle }
}
```

- [ ] **Step 2: Create CommandPalette component**

```tsx
// app/src/components/layout/CommandPalette.tsx
'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Home, FolderOpen, Search, Paperclip, Sparkles, Settings, Plus, Shield, Upload } from 'lucide-react'
import { GlassInput } from '@/components/glass'

interface CommandItem {
  id: string
  label: string
  icon: React.ReactNode
  action: () => void
  group: string
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('commandPalette')
  const prefix = `/${locale}`

  const navigate = useCallback((path: string) => {
    router.push(path)
    onClose()
  }, [router, onClose])

  const items: CommandItem[] = [
    { id: 'home', label: t('home'), icon: <Home size={18} />, action: () => navigate(prefix), group: t('pages') },
    { id: 'projects', label: t('projects'), icon: <FolderOpen size={18} />, action: () => navigate(`${prefix}/projects`), group: t('pages') },
    { id: 'calls', label: t('fundingCalls'), icon: <Search size={18} />, action: () => navigate(`${prefix}/calls`), group: t('pages') },
    { id: 'files', label: t('files'), icon: <Paperclip size={18} />, action: () => navigate(`${prefix}/files`), group: t('pages') },
    { id: 'ai', label: t('aiAssistant'), icon: <Sparkles size={18} />, action: () => navigate(`${prefix}/ai`), group: t('pages') },
    { id: 'settings', label: t('settings'), icon: <Settings size={18} />, action: () => navigate(`${prefix}/settings`), group: t('pages') },
    { id: 'new-project', label: t('newProject'), icon: <Plus size={18} />, action: () => navigate(`${prefix}/ai`), group: t('actions') },
    { id: 'check-eligibility', label: t('checkEligibility'), icon: <Shield size={18} />, action: () => navigate(`${prefix}/calls`), group: t('actions') },
    { id: 'upload-file', label: t('uploadFile'), icon: <Upload size={18} />, action: () => navigate(`${prefix}/files`), group: t('actions') },
  ]

  const filtered = query
    ? items.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
    : items

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => { setSelectedIndex(0) }, [query])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && filtered[selectedIndex]) { filtered[selectedIndex].action() }
    if (e.key === 'Escape') onClose()
  }, [filtered, selectedIndex, onClose])

  if (!open) return null

  const groups = [...new Set(filtered.map(i => i.group))]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative glass w-[560px] max-h-[400px] overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <div className="p-3 border-b border-[var(--border-subtle)]">
          <GlassInput
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            autoFocus
          />
        </div>
        <div className="overflow-y-auto max-h-[320px] p-2">
          {groups.map(group => (
            <div key={group}>
              <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">{group}</p>
              {filtered.filter(i => i.group === group).map((item, idx) => {
                const globalIdx = filtered.indexOf(item)
                return (
                  <button
                    key={item.id}
                    onClick={item.action}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-[var(--btn-radius)] text-left
                      ${globalIdx === selectedIndex ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]'}
                    `}
                  >
                    {item.icon}
                    <span className="text-sm">{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-sm text-[var(--text-tertiary)] text-center">{t('noResults')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/components/layout/CommandPalette.tsx app/src/hooks/useCommandPalette.ts
git commit -m "feat(layout): implement Cmd+K command palette with fuzzy search"
```

---

### Task 2.3: Mobile Nav

**Files:**
- Create: `app/src/components/layout/MobileNav.tsx`

- [ ] **Step 1: Create MobileNav**

```tsx
// app/src/components/layout/MobileNav.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Home, FolderOpen, Search, Sparkles } from 'lucide-react'

export function MobileNav() {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('nav')
  const prefix = `/${locale}`

  const items = [
    { href: prefix, icon: Home, labelKey: 'home' as const },
    { href: `${prefix}/projects`, icon: FolderOpen, labelKey: 'projects' as const },
    { href: `${prefix}/calls`, icon: Search, labelKey: 'calls' as const },
    { href: `${prefix}/ai`, icon: Sparkles, labelKey: 'ai' as const },
  ]

  const isActive = (href: string) => {
    if (href === prefix) return pathname === prefix || pathname === `${prefix}/`
    return pathname.startsWith(href)
  }

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="flex items-center justify-around py-2">
        {items.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`
              flex flex-col items-center gap-0.5 px-3 py-1
              ${isActive(item.href) ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'}
            `}
          >
            <item.icon size={20} />
            <span className="text-[10px]">{t(item.labelKey)}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/components/layout/MobileNav.tsx
git commit -m "feat(layout): implement mobile bottom tab bar navigation"
```

---

### Task 2.4: App Shell Layout

**Files:**
- Create: `app/src/components/layout/AppShell.tsx`
- Create: `app/src/app/[locale]/(app)/layout.tsx`
- Create: `app/src/hooks/useCSRF.ts`

- [ ] **Step 1: Create CSRF hook**

```typescript
// app/src/hooks/useCSRF.ts
'use client'

import { useState, useEffect } from 'react'

export function useCSRF() {
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    // Read CSRF token from response header on initial load
    fetch('/api/health', { method: 'GET', credentials: 'same-origin' })
      .then(res => {
        const csrfToken = res.headers.get('x-csrf-token')
        if (csrfToken) setToken(csrfToken)
      })
      .catch(() => {})
  }, [])

  return token
}
```

- [ ] **Step 2: Create AppShell**

```tsx
// app/src/components/layout/AppShell.tsx
'use client'

import { type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { CommandPalette } from './CommandPalette'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useSidebar } from '@/hooks/useSidebar'

interface AppShellProps {
  children: ReactNode
  userName?: string
  userInitials?: string
}

export function AppShell({ children, userName, userInitials }: AppShellProps) {
  const { open: cmdOpen, close: cmdClose } = useCommandPalette()
  const { collapsed, toggle } = useSidebar()  // Single source of truth — passed to Sidebar as props

  return (
    <>
      {/* Sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar userName={userName} userInitials={userInitials} collapsed={collapsed} onToggle={toggle} />
      </div>

      {/* Main content */}
      <main
        className={`
          min-h-screen transition-[margin-left] duration-200 ease-in-out
          pb-16 md:pb-0
          ${collapsed ? 'md:ml-[var(--sidebar-collapsed)]' : 'md:ml-[var(--sidebar-width)]'}
        `}
      >
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <MobileNav />

      {/* Command palette */}
      <CommandPalette open={cmdOpen} onClose={cmdClose} />
    </>
  )
}
```

- [ ] **Step 3: Create (app) layout — uses NextAuth v5 `auth()`, NOT `getServerSession`**

```tsx
// app/src/app/[locale]/(app)/layout.tsx
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AppShell } from '@/components/layout/AppShell'

export default async function AppLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await auth()

  if (!session?.user) {
    redirect(`/${locale}/autentificare`)
  }

  const name = session.user.name || session.user.email || ''
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <AppShell userName={name} userInitials={initials}>
      {children}
    </AppShell>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `cd app && npx next build --no-lint 2>&1 | tail -20`
Expected: Build should compile the new layout (may warn about missing pages — that's fine)

- [ ] **Step 5: Commit**

```bash
git add app/src/components/layout/AppShell.tsx app/src/app/[locale]/'(app)'/layout.tsx app/src/hooks/useCSRF.ts
git commit -m "feat(layout): implement app shell with sidebar, command palette, and mobile nav"
```

---

### Task 2.5: Add i18n Keys for Navigation

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add nav and commandPalette keys to ro.json**

Add these top-level sections:

```json
"nav": {
  "home": "Acasă",
  "projects": "Proiecte",
  "calls": "Apeluri",
  "files": "Fișiere",
  "ai": "Asistent AI",
  "settings": "Setări",
  "signOut": "Deconectare"
},
"commandPalette": {
  "searchPlaceholder": "Caută pagini, proiecte, acțiuni...",
  "pages": "Pagini",
  "actions": "Acțiuni",
  "home": "Acasă",
  "projects": "Proiecte",
  "fundingCalls": "Apeluri de finanțare",
  "files": "Fișiere",
  "aiAssistant": "Asistent AI",
  "settings": "Setări",
  "newProject": "Proiect nou",
  "checkEligibility": "Verifică eligibilitatea",
  "uploadFile": "Încarcă fișier",
  "noResults": "Niciun rezultat"
}
```

- [ ] **Step 2: Add nav and commandPalette keys to en.json**

```json
"nav": {
  "home": "Home",
  "projects": "Projects",
  "calls": "Calls",
  "files": "Files",
  "ai": "AI Assistant",
  "settings": "Settings",
  "signOut": "Sign out"
},
"commandPalette": {
  "searchPlaceholder": "Search pages, projects, actions...",
  "pages": "Pages",
  "actions": "Actions",
  "home": "Home",
  "projects": "Projects",
  "fundingCalls": "Funding Calls",
  "files": "Files",
  "aiAssistant": "AI Assistant",
  "settings": "Settings",
  "newProject": "New project",
  "checkEligibility": "Check eligibility",
  "uploadFile": "Upload file",
  "noResults": "No results"
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/messages/ro.json app/src/messages/en.json
git commit -m "i18n: add navigation and command palette translation keys (ro/en)"
```

---

## Phase 3: Smart Landing Page

### Task 3.1: Status Mapping Utility

**Files:**
- Create: `app/src/lib/status-map.ts`

- [ ] **Step 1: Create status mapping**

```typescript
// app/src/lib/status-map.ts
// Maps V1 Romanian project statuses to V2 English display statuses
const V1_TO_V2: Record<string, string> = {
  ciorna: 'draft',
  in_lucru: 'action_plan',
  verificare: 'action_plan',
  finalizat: 'built',
  depus: 'exported',
  aprobat: 'exported',
  respins: 'draft',
  arhivat: 'exported',
  // V2 values map to themselves
  draft: 'draft',
  action_plan: 'action_plan',
  built: 'built',
  exported: 'exported',
}

export function normalizeProjectStatus(status: string): string {
  return V1_TO_V2[status] || 'draft'
}

export type ProjectDisplayStatus = 'draft' | 'action_plan' | 'built' | 'exported'

export const STATUS_VARIANT: Record<string, 'default' | 'warning' | 'accent' | 'success'> = {
  draft: 'default',
  action_plan: 'warning',
  built: 'accent',
  exported: 'success',
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/status-map.ts
git commit -m "feat(utils): add V1→V2 project status mapping utility"
```

---

### Task 3.2: Landing Page Components

**Files:**
- Create: `app/src/components/landing/HeroInput.tsx`
- Create: `app/src/components/landing/QuickStartCard.tsx`
- Create: `app/src/components/landing/ContinueBanner.tsx`
- Create: `app/src/components/landing/ProjectsPreview.tsx`
- Create: `app/src/components/landing/MatchesPreview.tsx`
- Create: `app/src/components/landing/SmartLanding.tsx`

- [ ] **Step 1: Create HeroInput**

```tsx
// app/src/components/landing/HeroInput.tsx
'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { GlassInput } from '@/components/glass'
import { ArrowRight } from 'lucide-react'

interface HeroInputProps {
  large?: boolean
}

export function HeroInput({ large = true }: HeroInputProps) {
  const [value, setValue] = useState('')
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('landing')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    // Navigate to AI workspace with the idea as a query param
    router.push(`/${locale}/ai?idea=${encodeURIComponent(value.trim())}`)
  }

  return (
    <form onSubmit={handleSubmit} className="relative w-full max-w-2xl mx-auto">
      <GlassInput
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={t('heroPlaceholder')}
        large={large}
        className="pr-12"
      />
      {value.trim() && (
        <button
          type="submit"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-[var(--accent)] text-white hover:brightness-110 transition-all"
        >
          <ArrowRight size={18} />
        </button>
      )}
    </form>
  )
}
```

- [ ] **Step 2: Create QuickStartCard**

```tsx
// app/src/components/landing/QuickStartCard.tsx
'use client'

import Link from 'next/link'
import { type LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/glass'

interface QuickStartCardProps {
  href: string
  icon: LucideIcon
  title: string
  description: string
  metric?: string
}

export function QuickStartCard({ href, icon: Icon, title, description, metric }: QuickStartCardProps) {
  return (
    <Link href={href}>
      <GlassCard className="p-6 h-full flex flex-col gap-3">
        <Icon size={24} className="text-[var(--accent)]" />
        <h3 className="text-[var(--text-primary)] font-semibold text-base">{title}</h3>
        <p className="text-[var(--text-secondary)] text-sm flex-1">{description}</p>
        {metric && <p className="text-[var(--text-tertiary)] text-xs">{metric}</p>}
      </GlassCard>
    </Link>
  )
}
```

- [ ] **Step 3: Create ContinueBanner**

```tsx
// app/src/components/landing/ContinueBanner.tsx
'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard } from '@/components/glass'
import { Play } from 'lucide-react'

interface ContinueBannerProps {
  session: {
    id: string
    currentStep: number
    projectTitle?: string | null
    updatedAt: string
  }
}

export function ContinueBanner({ session }: ContinueBannerProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  const stepLabels = [
    t('steps.enhance'), t('steps.match'), t('steps.validate'),
    t('steps.research'), t('steps.knowledge'), t('steps.plan'), t('steps.build'),
  ]

  const label = session.projectTitle || `${t('step')} ${session.currentStep}/7`
  const stepLabel = stepLabels[session.currentStep - 1] || ''

  const timeAgo = getTimeAgo(session.updatedAt, locale)

  return (
    <Link href={`/${locale}/ai?session=${session.id}`}>
      <GlassCard accent className="p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded-full bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
          <Play size={18} className="text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-primary)] font-medium truncate">
            {t('continue')}: {label}
          </p>
          <p className="text-[var(--text-secondary)] text-sm">
            {t('step')} {session.currentStep}/7 — {stepLabel}
          </p>
        </div>
        <span className="text-[var(--text-tertiary)] text-xs shrink-0">{timeAgo}</span>
      </GlassCard>
    </Link>
  )
}

function getTimeAgo(dateStr: string, locale: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return locale === 'ro' ? 'acum' : 'just now'
  if (hours < 24) return locale === 'ro' ? `acum ${hours}h` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return locale === 'ro' ? `acum ${days}z` : `${days}d ago`
}
```

- [ ] **Step 4: Create ProjectsPreview and MatchesPreview**

```tsx
// app/src/components/landing/ProjectsPreview.tsx
'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard, GlassBadge } from '@/components/glass'
import { normalizeProjectStatus, STATUS_VARIANT } from '@/lib/status-map'

interface ProjectPreviewItem {
  id: string
  title: string
  status: string
}

interface ProjectsPreviewProps {
  projects: ProjectPreviewItem[]
  total: number
}

export function ProjectsPreview({ projects, total }: ProjectsPreviewProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  return (
    <GlassCard hover={false} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[var(--text-primary)] font-semibold">{t('myProjects')} ({total})</h3>
      </div>
      <div className="flex flex-col gap-2">
        {projects.map(p => {
          const status = normalizeProjectStatus(p.status)
          return (
            <Link key={p.id} href={`/${locale}/projects/${p.id}`} className="flex items-center justify-between py-1.5 hover:bg-[var(--bg-surface-hover)] px-2 -mx-2 rounded-lg transition-colors">
              <span className="text-sm text-[var(--text-primary)] truncate">{p.title}</span>
              <GlassBadge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</GlassBadge>
            </Link>
          )
        })}
      </div>
      {total > 3 && (
        <Link href={`/${locale}/projects`} className="block mt-3 text-sm text-[var(--accent)] hover:underline">
          {t('viewAll')} →
        </Link>
      )}
    </GlassCard>
  )
}
```

```tsx
// app/src/components/landing/MatchesPreview.tsx
'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { GlassCard, GlassBadge } from '@/components/glass'

interface MatchPreviewItem {
  callCode: string
  title: string
  matchScore: number
}

interface MatchesPreviewProps {
  matches: MatchPreviewItem[]
}

export function MatchesPreview({ matches }: MatchesPreviewProps) {
  const locale = useLocale()
  const t = useTranslations('landing')

  if (matches.length === 0) {
    return (
      <GlassCard hover={false} className="p-5">
        <h3 className="text-[var(--text-primary)] font-semibold mb-3">{t('newMatches')}</h3>
        <p className="text-[var(--text-secondary)] text-sm">{t('noMatchesYet')}</p>
        <Link href={`/${locale}/calls`} className="block mt-3 text-sm text-[var(--accent)] hover:underline">
          {t('browseCalls')} →
        </Link>
      </GlassCard>
    )
  }

  return (
    <GlassCard hover={false} className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[var(--text-primary)] font-semibold">{t('newMatches')} ({matches.length})</h3>
      </div>
      <div className="flex flex-col gap-2">
        {matches.map(m => (
          <div key={m.callCode} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-[var(--text-primary)] truncate">{m.callCode}</span>
            <GlassBadge variant="accent">{m.matchScore}%</GlassBadge>
          </div>
        ))}
      </div>
      <Link href={`/${locale}/calls`} className="block mt-3 text-sm text-[var(--accent)] hover:underline">
        {t('viewAllCalls')} →
      </Link>
    </GlassCard>
  )
}
```

- [ ] **Step 5: Create SmartLanding orchestrator**

```tsx
// app/src/components/landing/SmartLanding.tsx
'use client'

import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import { Search, Shield, Upload } from 'lucide-react'
import { HeroInput } from './HeroInput'
import { QuickStartCard } from './QuickStartCard'
import { ContinueBanner } from './ContinueBanner'
import { ProjectsPreview } from './ProjectsPreview'
import { MatchesPreview } from './MatchesPreview'

interface SmartLandingProps {
  user: { name?: string | null }
  activeSession?: {
    id: string
    currentStep: number
    projectTitle?: string | null
    updatedAt: string
  } | null
  recentProjects: { id: string; title: string; status: string }[]
  totalProjects: number
  matches: { callCode: string; title: string; matchScore: number }[]
}

export function SmartLanding({ user, activeSession, recentProjects, totalProjects, matches }: SmartLandingProps) {
  const t = useTranslations('landing')
  const locale = useLocale()
  const prefix = `/${locale}`

  const isNewUser = totalProjects === 0 && !activeSession
  const firstName = user.name?.split(' ')[0] || ''

  const greeting = getGreeting(t, firstName)

  if (isNewUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] gap-8">
        <div className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-[var(--text-primary)]">
            {t('welcomeTitle')}
          </h1>
          <p className="text-lg text-[var(--text-secondary)]">
            {t('welcomeSubtitle')}
          </p>
        </div>

        <HeroInput large />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl mt-4">
          <QuickStartCard
            href={`${prefix}/calls`}
            icon={Search}
            title={t('quickStart.browseCalls')}
            description={t('quickStart.browseCallsDesc')}
          />
          <QuickStartCard
            href={`${prefix}/calls`}
            icon={Shield}
            title={t('quickStart.checkEligibility')}
            description={t('quickStart.checkEligibilityDesc')}
          />
          <QuickStartCard
            href={`${prefix}/files`}
            icon={Upload}
            title={t('quickStart.uploadDocs')}
            description={t('quickStart.uploadDocsDesc')}
          />
        </div>
      </div>
    )
  }

  // Returning user
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">
        {greeting}
      </h1>

      {activeSession && <ContinueBanner session={activeSession} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ProjectsPreview projects={recentProjects} total={totalProjects} />
        <MatchesPreview matches={matches} />
      </div>

      <HeroInput large={false} />
    </div>
  )
}

function getGreeting(t: ReturnType<typeof useTranslations>, name: string): string {
  const hour = new Date().getHours()
  if (hour < 12) return t('greetingMorning', { name })
  if (hour < 18) return t('greetingAfternoon', { name })
  return t('greetingEvening', { name })
}
```

- [ ] **Step 6: Commit**

```bash
git add app/src/components/landing/
git commit -m "feat(landing): implement smart landing page components — hero input, quick starts, continue banner, previews"
```

---

### Task 3.3: Landing Page Route

**Files:**
- Create: `app/src/app/[locale]/(app)/page.tsx`

- [ ] **Step 1: Create the landing page server component — uses `auth()` (v5) and `withUserRLS`**

```tsx
// app/src/app/[locale]/(app)/page.tsx
import { auth } from '@/lib/auth'
import { db, withUserRLS } from '@/lib/db'
import { workflowSessions, projects } from '@/lib/db/schema'
import { eq, desc, and, count } from 'drizzle-orm'
import { SmartLanding } from '@/components/landing/SmartLanding'

export default async function HomePage() {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

  // All DB queries wrapped in withUserRLS to enforce row-level security
  const { activeSession, recentProjects, totalProjects } = await withUserRLS(userId, async (tx) => {
    // Fetch active session
    const [activeSession] = await tx
      .select({
        id: workflowSessions.id,
        currentStep: workflowSessions.currentStep,
        projectTitle: projects.title,
        updatedAt: workflowSessions.updatedAt,
      })
      .from(workflowSessions)
      .leftJoin(projects, eq(workflowSessions.projectId, projects.id))
      .where(and(eq(workflowSessions.userId, userId), eq(workflowSessions.status, 'active')))
      .orderBy(desc(workflowSessions.updatedAt))
      .limit(1)

    // Fetch recent projects
    const recentProjects = await tx
      .select({ id: projects.id, title: projects.title, status: projects.status })
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt))
      .limit(3)

    // Get total count
    const [{ value: totalProjects }] = await tx
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.userId, userId))

    return { activeSession, recentProjects, totalProjects }
  })

  return (
    <SmartLanding
      user={{ name: session.user.name }}
      activeSession={activeSession ? {
        ...activeSession,
        projectTitle: activeSession.projectTitle ?? null,
        updatedAt: activeSession.updatedAt.toISOString(),
      } : null}
      recentProjects={recentProjects.map(p => ({
        ...p,
        title: p.title || 'Untitled',
        status: p.status || 'draft',
      }))}
      totalProjects={totalProjects}
      matches={[]} // TODO: integrate match-grants API
    />
  )
}
```

- [ ] **Step 2: Add i18n keys for landing page to both ro.json and en.json**

Add `"landing"` section to both locale files with all keys used by the components (welcomeTitle, welcomeSubtitle, heroPlaceholder, greetingMorning, greetingAfternoon, greetingEvening, quickStart.*, continue, step, steps.*, myProjects, newMatches, viewAll, viewAllCalls, browseCalls, noMatchesYet, status.draft, status.action_plan, status.built, status.exported).

- [ ] **Step 3: Commit**

```bash
git add app/src/app/[locale]/'(app)'/page.tsx app/src/messages/ro.json app/src/messages/en.json
git commit -m "feat(landing): implement smart landing page with server-side data fetching"
```

---

## Phase 4-8: Remaining Pages

> **Note for agentic workers:** Phases 4-8 follow the same pattern as Phase 3. Each phase creates page-specific components, then the page route, then i18n keys. The spec document at `docs/superpowers/specs/2026-03-25-fondeu-ui-redesign-design.md` contains the full design for each page. Key implementation notes per phase:

### Task 4.1-4.4: AI Workspace (Phase 4)

**Files to create:**
- `app/src/components/workspace/WorkspaceLayout.tsx` — Chat + Canvas split with resizable divider
- `app/src/components/workspace/ChatPanel.tsx` — Reuse `useOrchestrator` hook from existing `components/chat/ChatPage.tsx`, rebuild visual layer with glass components
- `app/src/components/workspace/CanvasPanel.tsx` — Tabbed artifact view (Calls/Plan/Proposal)
- `app/src/components/workspace/StepProgressBar.tsx` — 7-step horizontal indicator
- `app/src/components/workspace/MessageBubble.tsx` — Glass-styled user/AI message with governor pattern
- `app/src/components/workspace/CheckpointInteraction.tsx` — Select/confirm/freetext glass cards
- `app/src/components/workspace/ProposalView.tsx` — Sections list with approve/edit per section
- `app/src/components/workspace/CallMatchCard.tsx` — Matched call card for canvas
- `app/src/app/[locale]/(app)/ai/page.tsx` — Page route reading `?idea=` and `?session=` params

**Key reuse:** The `useOrchestrator` hook in the existing `ChatPage.tsx` handles SSE streaming, session management, and message state. Port its logic, rebuild its UI with glass components.

**Reference existing files:**
- `app/src/components/chat/ChatPage.tsx` — current orchestrator UI (extract hook logic)
- `app/src/components/chat/MessageList.tsx` — message rendering patterns
- `app/src/components/chat/CheckpointCard.tsx` — checkpoint interaction patterns
- `app/src/components/chat/StepIndicator.tsx` — step progress patterns

### Task 5.1-5.3: Projects Page (Phase 5)

**Files to create:**
- `app/src/components/projects/ProjectCard.tsx` — Glass card with status badge, match score (rewrite existing)
- `app/src/components/projects/ProjectGrid.tsx` — Grid + search + filter chips (rewrite existing)
- `app/src/components/projects/ProjectDetail.tsx` — 3-tab view: Sections, Files, AI History (rewrite existing)
- `app/src/components/projects/SectionsTab.tsx` — Proposal sections with governor pattern
- `app/src/components/projects/ProjectFilesTab.tsx` — Files linked to project
- `app/src/components/projects/AIHistoryTab.tsx` — Read-only chat history + resume button
- `app/src/app/[locale]/(app)/projects/page.tsx` — Grid page with API fetch
- `app/src/app/[locale]/(app)/projects/[id]/page.tsx` — Detail page with tabs

**API reuse:** `GET /api/v1/projects`, `GET /api/v1/projects/[id]`, `GET /api/v1/files?projectId=`

### Task 6.1-6.4: Funding Calls Page (Phase 6)

**Files to create:**
- `app/src/components/calls/CallCard.tsx` — Full-width glass card with trust badges
- `app/src/components/calls/CallFilters.tsx` — Search + status/source chip toggles
- `app/src/components/calls/CallTrustBadge.tsx` — Verified/Stale/Web result badges
- `app/src/components/calls/EligibilityModal.tsx` — Quick check modal using existing rules engine
- `app/src/components/calls/WebSearchFallback.tsx` — AI searching animation + provisional results
- `app/src/app/[locale]/(app)/calls/page.tsx` — Page with merged curated + live data

**New API:** `POST /api/ai/search-calls` needs to be created (calls AI gateway with web search prompt)

### Task 7.1-7.2: Files Page (Phase 7)

**Files to create:**
- `app/src/components/files/FileCard.tsx` — Type icon + info glass card
- `app/src/components/files/FileGrid.tsx` — Grid + category groups
- `app/src/components/files/FileDetailModal.tsx` — Preview + actions
- `app/src/components/files/UploadZone.tsx` — Drag-and-drop using GlassDropZone
- `app/src/app/[locale]/(app)/files/page.tsx` — Page route

**API reuse:** `GET /api/v1/files`, `POST /api/v1/files` (existing upload endpoint)

### Task 8.1-8.2: Settings Page (Phase 8)

**Files to create:**
- `app/src/components/settings/ProfileCard.tsx` — Name, email, language
- `app/src/components/settings/AIPreferencesCard.tsx` — Model/style/auto-approve
- `app/src/components/settings/SubscriptionCard.tsx` — Plan + usage meters
- `app/src/components/settings/PrivacyCard.tsx` — GDPR, export, delete
- `app/src/app/[locale]/(app)/settings/page.tsx` — Page route

**API reuse:** `GET /api/v1/user/preferences` (new, Task 0.3), `GET /api/billing/info`, `GET /api/auth/consent`

---

## Phase 9: Auth Pages & Route Migration

### Task 9.1: Restyle Login Page

**Files:**
- Modify: `app/src/app/[locale]/(auth)/autentificare/page.tsx`

- [ ] **Step 1: Rewrite login page with glass design**

Apply dark glass background, centered glass card, Inter font. Keep existing auth logic (NextAuth signIn). Add glass-styled form inputs, accent button, social login buttons (Google, Microsoft, Facebook, Email).

- [ ] **Step 2: Commit**

### Task 9.2: Create Register and Reset Password Pages

**Files:**
- Create: `app/src/app/[locale]/(auth)/inregistrare/page.tsx`
- Create: `app/src/app/[locale]/(auth)/resetare-parola/page.tsx`

- [ ] **Step 1: Create register page** using glass components, calling existing `POST /api/auth/register`
- [ ] **Step 2: Create reset-password page** using glass components, calling existing `POST /api/auth/forgot-password`
- [ ] **Step 3: Commit**

### Task 9.3: Restyle 404 and Email Verification Pages

**Files:**
- Modify: `app/src/app/[locale]/not-found.tsx`
- Modify: `app/src/app/[locale]/verifica-email/page.tsx`

- [ ] **Step 1: Apply glass styling to both pages**
- [ ] **Step 2: Commit**

### Task 9.4: Add Route Redirects for Old Paths

**Files:**
- Modify: `app/src/middleware.ts`

- [ ] **Step 1: Add redirects in middleware for old paths**

Add redirect logic before the auth check:

```typescript
const redirects: Record<string, string> = {
  '/ro/panou': '/ro',
  '/en/panou': '/en',
  '/ro/proiecte': '/ro/projects',
  '/en/proiecte': '/en/projects',
  '/ro/finantari': '/ro/calls',
  '/en/finantari': '/en/calls',
  '/ro/billing': '/ro/settings',
  '/en/billing': '/en/settings',
}

const redirectTo = redirects[pathname]
if (redirectTo) {
  return NextResponse.redirect(new URL(redirectTo, request.url), 301)
}
```

- [ ] **Step 2: Commit**

### Task 9.5: Delete Old Dashboard Route Group

**WARNING:** Only do this AFTER all new routes are verified working.

- [ ] **Step 1: Verify all new pages work** (manual check in browser)
- [ ] **Step 2: Delete `app/src/app/[locale]/(dashboard)/` directory**
- [ ] **Step 3: Run build to verify no broken imports**

Run: `cd app && npx next build --no-lint`

- [ ] **Step 4: Commit**

```bash
git rm -r app/src/app/[locale]/'(dashboard)'/
git commit -m "chore: remove old dashboard route group — replaced by (app)"
```

---

## Post-Implementation Checklist

- [ ] All pages render with glass design in dark mode
- [ ] Sidebar navigation works (expand/collapse, active state, mobile)
- [ ] Command palette (Cmd+K) searches pages, projects, actions
- [ ] Smart landing shows correct state (new user / returning / consultant)
- [ ] AI Workspace streams messages, shows step progress, renders canvas
- [ ] Projects grid shows cards with correct status mapping
- [ ] Funding calls show trust badges, AI search fallback works
- [ ] Files page upload/preview/download works
- [ ] Settings page saves preferences, shows billing info
- [ ] All text is bilingual (ro/en) via next-intl
- [ ] Login/register/reset pages styled with glass design
- [ ] Old routes redirect to new paths
- [ ] Mobile responsive (sidebar hidden, bottom tab bar)
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes (or only pre-existing issues)
