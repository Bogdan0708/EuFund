# FondEU UI Redesign — Design Specification

> **Approach:** UI Rewrite, Keep Backend (Approach B)
> Keep all API routes, database schema, auth, AI orchestrator engine, middleware, lib/ untouched.
> Completely rewrite: layout system, components, pages, navigation, design system.

**Goal:** Transform FondEU from a fragmented multi-page dashboard into a minimalist, Apple-inspired, dark-glass hybrid app with proper navigation, AI workspace, and contextual smart landing.

**Target users:** Solo founders/SME owners + EU funding consultants

**Bilingual:** All UI text via next-intl (ro default, en). Every string through `useTranslations()`, no hardcoded text.

**Visual design tool:** Google Stitch for screen designs → export ZIP (PNG + HTML/CSS) → build to spec.

---

## 1. Design System — "FondEU Glass"

### Color Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#06060A` | Page background |
| `--bg-surface` | `rgba(255,255,255,0.04)` | Cards, panels |
| `--bg-surface-hover` | `rgba(255,255,255,0.07)` | Card hover state |
| `--bg-glass` | `rgba(255,255,255,0.06)` | Frosted glass panels (+ `backdrop-filter: blur(16px)`) |
| `--border-subtle` | `rgba(255,255,255,0.08)` | Card borders, dividers |
| `--border-focus` | `rgba(59,130,246,0.5)` | Focus rings |
| `--text-primary` | `#F0F0F3` | Headlines, body text |
| `--text-secondary` | `rgba(255,255,255,0.55)` | Descriptions, labels |
| `--text-tertiary` | `rgba(255,255,255,0.35)` | Placeholders, timestamps |
| `--accent` | `#3B82F6` | Primary actions, links, active states |
| `--accent-soft` | `rgba(59,130,246,0.12)` | Accent backgrounds |
| `--success` | `#22C55E` | Approved, eligible, complete |
| `--warning` | `#F59E0B` | Pending, needs review |
| `--danger` | `#EF4444` | Errors, rejected, expired |
| `--provisional` | `opacity: 0.7` | AI-generated content before user approval |

### Glass Effect

```css
.glass {
  background: rgba(255,255,255,0.06);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
}
```

### Typography

- **Font:** Inter (primary), JetBrains Mono (code/data)
- **Headline:** 32-48px, font-weight 600, tracking -0.02em
- **Body:** 15px, font-weight 400, line-height 1.6
- **Label:** 13px, font-weight 500, uppercase, tracking 0.04em, `--text-secondary`
- **Mono:** JetBrains Mono, 13px

### Spacing

- Grid: 8px base unit
- Padding: 16/24/32px
- Card gap: 16px
- Page margins: 32px

### Radius

- Cards: 16px
- Buttons: 12px
- Inputs: 10px
- Badges: 6px

### Shadows

None. Depth from glass blur + border opacity, not box-shadow.

### Animations

- Page transitions: `opacity 0→1, translateY 8px→0`, 200ms ease-out
- Sidebar collapse: 200ms ease-in-out on width
- Card hover: border opacity 0.08→0.15, 150ms
- AI streaming text: character-by-character with blinking cursor
- Provisional→approved: opacity 0.7→1.0, 300ms with subtle scale pulse

---

## 2. Navigation & Layout Architecture

### Shell Structure

Every authenticated page shares this shell:

```
┌─────────────────────────────────────────────────────┐
│ [Sidebar]  │         [Main Content Area]            │
│            │                                         │
│  Logo      │  ┌─────────────────────────────────┐   │
│            │  │        Page Content              │   │
│  ──────    │  │                                   │  │
│  Home      │  │                                   │  │
│  Projects  │  │                                   │  │
│  Calls     │  │                                   │  │
│  Files     │  │                                   │  │
│            │  │                                   │  │
│  ──────    │  │                                   │  │
│  Settings  │  └─────────────────────────────────┘   │
│  Avatar    │                                         │
└─────────────────────────────────────────────────────┘
```

### Sidebar (Dimmed, Linear-style)

- **Width:** 240px expanded, 60px collapsed (icon-only rail)
- **Background:** `--bg-base` (same as page, no visual separation)
- **Collapse:** Toggle via hamburger icon at top, or drag edge. Preference saved to localStorage.
- **Items:** subtle `--bg-surface-hover` on hover, `--accent-soft` background when active
- **Top section:** FondEU logo (small wordmark when expanded, icon when collapsed)
- **Main nav (5 items):**
  - Home (grid icon) — smart landing page
  - Projects (folder icon) — project list/grid
  - Funding Calls (search icon) — browse calls
  - Files (paperclip icon) — file management
  - AI Assistant (sparkle icon) — opens/resumes chat+canvas workspace
- **Bottom section:** Settings (gear icon), User avatar + name (truncated when collapsed)
- **Icons:** 20px, Lucide icon set
- **Active indicator:** 2px `--accent` left border on active item

### Command Palette (Cmd+K / Ctrl+K)

- Centered modal, glass background, 560px wide
- Search input at top
- Results grouped by type: Pages, Projects, Funding Calls, Actions
- Actions: "New project", "Check eligibility", "Start AI assistant", "Upload file"
- Keyboard navigable (arrow keys + enter)
- Fuzzy search across all entities

### Top Bar (Inside Main Content Area)

- Minimal: page title (left) + contextual actions (right)
- No duplicate navigation
- On AI workspace: shows session name + step progress indicator

### Responsive Behavior

- **Desktop (>1024px):** sidebar + main content
- **Tablet (768-1024px):** sidebar collapsed to icon rail by default
- **Mobile (<768px):** sidebar hidden, accessible via hamburger. Bottom tab bar with 4 items: Home, Projects, Calls, AI

### Chat+Canvas Split (AI Workspace Only)

```
┌──────────┬─────────────────────┬──────────────────┐
│ Sidebar  │    Chat Panel       │  Canvas/Artifact  │
│          │                     │                    │
│          │  Messages + Input   │  Generated doc     │
│          │                     │  Matched calls     │
│          │                     │  Action plan       │
│          │                     │  Live preview      │
└──────────┴─────────────────────┴──────────────────┘
```

- Chat: 50% width, Canvas: 50% width (resizable divider)
- Canvas appears when AI produces structured output (step 2+)
- No canvas content → chat expands to full width
- Canvas content persists independently of chat scroll

---

## 3. Smart Landing Page (Home)

Contextual page adapting to user state. Apple-style generous whitespace.

### State 1: New User (No Projects, No Sessions)

- Big welcome headline + one-liner
  - ro: "Bine ai venit pe FondEU" / "Găsește finanțare europeană. Construiește aplicația."
  - en: "Welcome to FondEU" / "Find EU funding. Build your application."
- **Hero input:** Large glass-panel input field, centered. Placeholder: "Descrie ideea ta de proiect..." / "Describe your project idea..."
  - Typing here starts the AI orchestrator (creates new session, sends text as first message)
- **3 quick-start cards** (glass panels, bento-style, below hero input):
  - "Explorează apelurile" / "Browse Funding Calls" — navigates to /calls page. Shows live count: "47 apeluri deschise"
  - "Verifică eligibilitatea" / "Check Eligibility" — navigates to eligibility checker. "2 min, instant"
  - "Încarcă documente" / "Upload Documents" — navigates to /files page. "PDF, DOCX, Word"
- No other content. No tutorials, feature tours, or illustrations.

### State 2: Returning User (Has Projects/Sessions)

- **Greeting:** Time-of-day aware with first name
  - ro: "Bună dimineața, Andrei" / en: "Good morning, Andrei"
- **Continue banner** (top, prominent, glass + accent border): active/paused AI session
  - Shows: project/session label, step progress "Step 4/7 — Researching requirements", last active time
  - One-click resume → navigates to AI Workspace
- **Bento grid (2 columns):**
  - **My Projects:** 3 most recent, status badge, "View all" link to /projects
  - **New Matches:** funding calls matching profile/projects, match %, "View all" link to /calls. If no matches: "Set up alerts" CTA
- **Hero input** at bottom (smaller): "Start a new project..." / "Începe un proiect nou..."
- Optional row: upcoming deadlines (if any matched calls within 30 days)

### State 3: Consultant (5+ Projects)

Same as State 2 but Projects card expands:
- Count + status breakdown: "12 projects — 4 draft, 5 in progress, 3 exported"
- Matches grouped across all projects

### Data Sources

- Greeting: session user name
- Continue banner: `GET /api/ai/orchestrator/sessions?status=active&limit=1`
- Projects: `GET /api/v1/projects?perPage=3&sort=updatedAt`
- Matches: `GET /api/ai/match-grants` (cached)
- Deadlines: derived from matched calls' `submissionEnd` dates

---

## 4. AI Workspace (Chat + Canvas)

The core product — 7-step orchestrator with chat+canvas split.

### Entry Points

- Typing in hero input on landing page
- Clicking "Continue" on active session banner
- Clicking "AI Assistant" in sidebar
- Clicking a funding call match card
- Cmd+K → "Start AI assistant"

### Step Progress Bar (Top of Chat Panel)

- Horizontal, 7 dots/segments connected by a line
- Labels:
  - en: Enhance → Match → Validate → Research → Knowledge → Plan → Build
  - ro: Rafinare → Potrivire → Validare → Cercetare → Cunoștințe → Plan → Construire
- Current step: `--accent` fill + subtle pulse
- Completed: `--success` fill
- Future: `--text-tertiary` outline
- Click completed step → scrolls chat to that step's output (read-only)

### Chat Panel (Left Half)

- User bubbles: right-aligned, glass + accent tint
- AI bubbles: left-aligned, glass
- **Governor pattern:** new AI content at 0.7 opacity with "AI generated" label. Full opacity on approval or step advance.
- **Checkpoint interactions:**
  - **Select** (e.g., choose funding call): clickable glass cards with title, program, match %, deadline
  - **Confirm** (e.g., proceed?): "Continue" (accent) + "Modify" (ghost) buttons
  - **Freetext** (e.g., specific requirements?): regular input + suggested quick answer chips
- **Streaming:** character-by-character with blinking cursor. Structured blocks (call cards, plan tables) fade in as complete units.
- **Input field:** glass panel, placeholder "Scrie un mesaj..." / "Type a message...", send button (accent), attachment button for mid-conversation file upload

### Canvas Panel (Right Half)

- Appears on step 2+ when AI produces structured output
- **Tab bar at top** switches between artifact types:
  - After Step 2 (Match): "Calls" tab — matched funding calls as cards
  - After Step 6 (Plan): "Action Plan" tab — timeline/checklist
  - After Step 7 (Build): "Proposal" tab — full document with sections
- Tabs persist. Switching doesn't lose content.
- **Document view (proposal):**
  - Sections listed vertically (Objectives, Methodology, Budget, Impact, etc.)
  - Each: title + content + status badge (draft/review/final)
  - Governor pattern: new sections at 0.7 opacity, "Approve" button per section or "Approve all"
  - "Ask AI to improve" per section → sends edit request to chat
  - Inline editable content (contentEditable or textarea toggle)
- **Export button** (top right): "Export DOCX" / "Exportă DOCX"
- **Resizable:** drag divider between chat and canvas. Double-click to reset 50/50.

### Session Management

- Auto-saved on every step completion
- Resume from exact state on return
- Session list via sidebar "AI Assistant" → recent sessions grouped by project
- Abandoned sessions (>7 days inactive) → auto-paused

### Error Handling

- Gateway timeout: error card in chat with "Retry" button, no freeze
- Redis/SSE disconnect: auto-reconnect with exponential backoff, subtle "Reconnecting..." indicator
- Step failure: remain on current step, show error, allow retry or skip

---

## 5. Projects Page

### Grid View

- **Top:** Page title "Proiecte" / "Projects" (left), "+ New" button (right, accent) → AI Workspace
- **Filters:** Search input (glass), Status dropdown (All/Draft/Action Plan/Built/Exported), Sort (Recent/Deadline/Name A-Z)
- **Project cards** (glass panels, bento grid 2-3 columns):
  - Project title (large, `--text-primary`)
  - Matched call: program name + call code (`--text-secondary`)
  - Status badge: colored dot + label (draft=`--text-tertiary`, action_plan=`--warning`, built=`--accent`, exported=`--success`)
  - Key metric: next deadline or last activity date
  - Match score: percentage badge in corner (if call matched)
  - Hover: border brightens
  - Click → project detail
- **Ghost card** (always last): dashed border, "+" icon, "Start new project" → AI Workspace
- **Empty state:** centered icon, "Niciun proiect încă" / "No projects yet", "Start your first project" button, "Or browse open funding calls" link

### Project Detail Page

- **Top:** Back link, project title (headline), matched call + deadline, status badge, Export button
- **Three tabs:**

**Tab 1: Sections (Secțiuni)**
- Proposal document sections from `project_documents`
- Each: title, status badge (draft/review/final), content preview (2 lines), Edit button
- Edit → inline editor OR navigate to AI Workspace with section focused
- "Generate" button on empty sections → sends to AI
- Governor pattern on AI-generated sections

**Tab 2: Files (Fișiere)**
- Files from `project_files` linked to this project
- List: filename, type icon, size, upload date, category badge (uploaded/generated)
- Upload drag-and-drop zone
- Click to preview or download

**Tab 3: AI History (Istoric AI)**
- Read-only chat history from workflow session
- "Resume session" button → AI Workspace

**Bottom actions:**
- "Resume AI Session" (accent) → AI Workspace with this project's session
- "Export DOCX" (ghost) → generates and downloads full proposal

---

## 6. Funding Calls Page

### AI-Augmented Call Discovery

The platform never says "no calls found" without checking the web first.

**Three-layer model:**

1. **Database first:** page loads curated/crawled calls instantly
2. **Web verification layer:** background agent verifies open calls are still current
   - Each card shows "Verified" timestamp: "Last checked: 2h ago" with checkmark
   - Changed calls: `--warning` border + "Updated since last check" badge
   - Stale calls (7+ days): "Needs verification" badge, click to trigger live check
3. **AI web search fallback:** when filters return zero results OR user searches specifically
   - "Searching the web for matching calls..." animation
   - AI agent (Perplexity/web search via gateway) searches for EU/Romanian funding calls
   - Results appear with "Web result" badge at `--provisional` opacity
   - "Add to platform" → creates `discovered_calls` entry (pending_review)
   - "Start project with this call" → AI Workspace with call pre-loaded
4. **Proactive discovery:** even with results, subtle card at bottom: "AI found 3 more calls not in our database" (expandable)

### Trust Badges

| Badge | Meaning | Visual |
|-------|---------|--------|
| Verified | Confirmed via web check within 48h | `--success` checkmark |
| Curated | In DB, not recently verified | No special badge |
| Updated | Changed since last verification | `--warning` border |
| Web result | Found by AI, not yet in DB | `--provisional` opacity + "Web" badge |
| Stale | Not verified in 7+ days | `--text-tertiary` + "Needs check" |

### Page Layout

- **Top:** "Apeluri de finanțare" / "Funding Calls", subtitle with live count
- **Search:** glass input, searches title, call code, program name
- **Filter chips (horizontal):** Status: All/Open (`Deschise`)/Forthcoming (`Viitoare`). Source: All/EU/România. Toggle chips with accent when active. "More filters" link reveals program chip row.
- **Call cards (full-width, stacked vertically):** glass panels
  - Call code (monospace, `--text-secondary`)
  - Title (large, `--text-primary`)
  - Meta: Program badge (colored pill) · Status badge · Budget range (€)
  - Deadline or opening date
  - Urgency: deadline within 14 days → red-tinted border + "X days left"
- **Actions per card:**
  - Open calls: "Check Eligibility" (ghost) + "Start Project" (accent)
  - Forthcoming: "Set Alert" (ghost)
  - Closed: no actions, dimmed
- **Merged sources:** curated DB calls + EU portal feed unified. EU/RO badge distinguishes source. Optional toggle for single source view.
- **Pagination:** infinite scroll with "Load more" button, 20 per page

### API Changes Needed

- New: `POST /api/ai/search-calls` — triggers web search agent
- Modified: `GET /api/v1/calls` — add `lastVerifiedAt` field
- New: `POST /api/v1/calls/:id/verify` — triggers single-call verification
- Existing: `discovered_calls` table already supports this flow

---

## 7. Files Page

### Layout

- **Top:** "Fișiere" / "Files", subtitle: file count + storage used, Upload button (accent)
- **Drag-and-drop zone:** always visible, glass + dashed border. PDF, DOCX, XLSX, TXT. 15MB max. Drag-over: accent border + brightened background. Progress bar during upload.
- **Filters:** Search (filename, project), Category (All/Uploaded/Generated), Sort (Recent/Name/Size)
- **File cards** (bento grid, 4 columns desktop, 2 mobile):
  - File type icon (large, centered): PDF=red, DOCX=blue, XLSX=green, TXT=gray
  - Filename (truncated, 2 lines)
  - Project tag (if linked)
  - File size
  - Glass panel, hover brightens border
- **Grouped:** "Uploaded" / "Încărcate" and "Generated" / "Generate" section headers, collapsible

### File Actions

- **Preview:** modal with PDF viewer or text content
- **Download:** direct
- **Link to project:** associate with existing project
- **Use in AI session:** send as context
- **Delete:** confirmation modal

### File Detail Modal

- File preview (embedded PDF viewer or text)
- Metadata: upload date, size, linked project, extracted text word count
- Extraction status: success/failed with retry option
- Action buttons: Download, Use in AI, Delete

### Storage Limits

- Approaching limit: subtle banner "Using 48 MB of 100 MB" with progress bar
- At limit: upload disabled, upgrade CTA

---

## 8. Settings Page

Four glass cards, stacked vertically.

### Card 1: Profile

- Name (editable input)
- Email (read-only, verified checkmark)
- Language selector: Română / English — changes locale and redirects
- Save button (appears on changes)

### Card 2: AI Preferences

- **Default model** dropdown:
  - "Auto (recommended)" — platform picks best model per step (default)
  - Claude Sonnet, Gemini Pro, GPT-4o, Perplexity — force specific model
  - Preference passed to orchestrator engine, overrides per-step routing
  - Non-Auto options: Pro/Ultra tiers only. Free tier shows grayed with "Pro" badge
- **Response style:** Concise / Detailed / Technical — affects system prompt
- **Auto-approve toggle:** ON = skip governor pattern. Off by default. Power user feature.

### Card 3: Subscription

- Current plan + tier badge
- Usage meters: workflows used/limit, storage used/limit (progress bars, `--accent` fill)
- "Upgrade to Pro" (accent) → Stripe checkout
- "Manage billing" (ghost) → Stripe portal
- Trial info if applicable

### Card 4: Privacy & Data

- "Manage consent" → GDPR consent modal
- "Export my data" → triggers data export download
- "Delete account" → confirmation flow with email verification

---

## 9. Feature Scope

### Keep (Rebuild UI)

| Feature | Current Route | New Route | Notes |
|---------|--------------|-----------|-------|
| AI Orchestrator (7-step) | `/` (authenticated) | `/ai` or sidebar "AI Assistant" | Chat+Canvas split |
| Projects list | `/proiecte` | `/projects` | Bento grid |
| Project detail | `/proiecte/[id]` | `/projects/[id]` | Simplified: Sections, Files, AI History tabs only |
| Funding Calls | `/finantari` + `/finantari/live` | `/calls` | Merged, AI-augmented |
| Billing | `/billing` | Merged into Settings | Card within settings page |
| File uploads | Scattered | `/files` | New dedicated page |
| Eligibility checker | API only | Integrated into Calls page + AI flow | Modal on call cards |
| Settings | Doesn't exist | `/settings` | New page |

### Kill

| Feature | Reason |
|---------|--------|
| Create project form (`/proiecte/nou`) | Projects created via AI flow |
| Organization management | Move to user-owned model |
| Live EU Portal as separate page | Merged into Calls page |
| Separate billing page | Merged into Settings |

### Later (Post-Launch)

| Feature | Priority |
|---------|----------|
| Work packages | P2 |
| Gantt chart | P2 |
| Budget dashboard | P2 |
| Consortium/Partners | P3 |
| Reporting assistant | P3 |
| Compliance checking | P2 |

---

## 10. Technical Approach

### What Stays Untouched

- All API routes (`/api/*`)
- Database schema (`lib/db/schema.ts`)
- Auth configuration (`lib/auth/`)
- AI orchestrator engine (`lib/ai/orchestrator/`)
- Middleware (`middleware.ts`)
- All `lib/` utilities (errors, redis, storage, vectors, etc.)
- i18n configuration (next-intl)

### What Gets Rewritten

- **Layout system:** New `(app)` route group with sidebar shell layout
- **All page components:** Every page under `(dashboard)` rebuilt from scratch
- **Component library:** New glass-themed components (GlassCard, GlassInput, GlassButton, etc.)
- **Design tokens:** CSS custom properties in `globals.css`
- **Navigation:** New Sidebar, CommandPalette, MobileNav components
- **Chat components:** New ChatPanel, Canvas, StepBar, MessageBubble, CheckpointCard
- **i18n strings:** New keys in `ro.json` and `en.json` for all new UI text

### Route Structure (New)

```
app/src/app/[locale]/
├── (app)/                    # New authenticated shell with sidebar
│   ├── layout.tsx            # Sidebar + main content shell
│   ├── page.tsx              # Smart landing (home)
│   ├── projects/
│   │   ├── page.tsx          # Projects grid
│   │   └── [id]/page.tsx     # Project detail
│   ├── calls/
│   │   └── page.tsx          # Funding calls (merged)
│   ├── files/
│   │   └── page.tsx          # File management
│   ├── ai/
│   │   └── page.tsx          # AI Workspace (chat+canvas)
│   └── settings/
│       └── page.tsx          # Settings (profile, AI, billing, privacy)
├── (auth)/                   # Public auth pages (keep as-is)
│   ├── autentificare/
│   ├── inregistrare/
│   └── resetare-parola/
└── layout.tsx                # Root locale layout (keep as-is)
```

### New API Routes Needed

- `POST /api/ai/search-calls` — AI web search for funding calls
- `POST /api/v1/calls/:id/verify` — single-call web verification
- `GET /api/v1/calls` — add `lastVerifiedAt` to response
- `GET /api/v1/user/preferences` — user AI preferences (model, style, auto-approve)
- `PUT /api/v1/user/preferences` — update preferences

### Stitch Integration Workflow

1. Design spec describes each screen
2. User creates screens in Google Stitch based on spec
3. User exports ZIPs to `app/designs/` (PNG + HTML/CSS)
4. Code is built to match those designs using Next.js + Tailwind
