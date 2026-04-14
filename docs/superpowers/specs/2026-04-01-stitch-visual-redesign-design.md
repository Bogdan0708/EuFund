# Stitch Visual Redesign — Design Spec

**Date**: 2026-04-01
**Branch**: `feature/local-production-readiness`
**Approach**: Motion library + CSS live background (Approach B)

## Overview

Pixel-match all dashboard pages to the Stitch V2 reference designs (`docs/stitch-2/stitch/`). Add Apple-style transitions via Motion library, a CSS-only animated live background, and ensure full WCAG AA readability. Delete the funding calls page (AI matches calls in the background).

## Scope

### In Scope
- **Foundation**: Live background, Motion system, page transitions
- **Sidebar**: Pixel-match Stitch nav with animated active pill
- **TopNav**: Glass header with date, notifications, help
- **6 pages**: Home, Projects, Project Detail, AI Assistant, Files, Settings
- **Delete**: Funding calls page (`finantari/page.tsx`) + sidebar nav item
- **Readability**: All text passes WCAG AA (4.5:1 body, 3:1 large)

### Out of Scope
- Auth pages (login, register, onboarding) — separate effort
- Backend API changes (all pages already wired)
- Dark theme (light-first, dark derived later)
- 404 page, command palette, notifications panel — separate effort

## Dependencies

### New Package
- `motion` (formerly Framer Motion) — ~30KB gzipped, React animation library

### Existing
- All current API endpoints remain unchanged
- Stitch reference files in `docs/stitch-2/stitch/` (code.html + screen.png)
- Design tokens in `app/src/styles/tokens.css` (already have readability fix)

## 1. Foundation Layer

### 1.1 Live Background Component

New component: `app/src/components/ui/LiveBackground.tsx`

Three CSS-only floating gradient orbs behind all content:

```
Orb 1: bg-[#0071E3] opacity-25, w-[600px] h-[600px], top-[-10%] left-[-5%], 25s orbit
Orb 2: bg-[#4A47D2] opacity-15, w-[500px] h-[500px], bottom-[-10%] right-[-5%], 30s orbit
Orb 3: bg-[#00637F] opacity-10, w-[400px] h-[400px], top-[40%] left-[30%], 35s orbit
```

All orbs: `rounded-full filter blur-[120px]`, animated with CSS `@keyframes float-orb-{n}` — gentle elliptical paths. Container is `pointer-events-none fixed inset-0 z-0 overflow-hidden`.

Rendered once in `AppShell.tsx` before all content.

Performance: CSS `will-change: transform` on orbs, `transform: translate3d()` for GPU compositing. No JS animation loop.

### 1.2 Motion System

Shared animation config: `app/src/lib/motion.ts`

```typescript
export const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { type: 'spring', stiffness: 300, damping: 30, duration: 0.3 }
}

export const staggerContainer = {
  animate: { transition: { staggerChildren: 0.06 } }
}

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { type: 'spring', stiffness: 400, damping: 30 }
}

export const hoverLift = {
  whileHover: { y: -4, transition: { type: 'spring', stiffness: 400, damping: 25 } }
}

export const tabContent = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -10 },
  transition: { duration: 0.2 }
}
```

### 1.3 Page Transitions

New file: `app/src/app/[locale]/(dashboard)/template.tsx`

Wraps page children with `<AnimatePresence mode="wait">` + `<motion.div>` using `pageTransition` config. This creates smooth fade+slide between dashboard pages.

### 1.4 Token Verification

Current tokens already pass WCAG AA:
- `--on-surface-variant: 55 58 65` (#373A41) — ~5.5:1 on #F5F5F7 ✓
- `--outline: 85 90 100` (#555A64) — ~4.5:1 on #F5F5F7 ✓
- `--on-surface: 26 27 31` (#1A1B1F) — ~14:1 on #F5F5F7 ✓

No token changes needed.

## 2. Sidebar

Reference: `docs/stitch-2/stitch/home_fondeu/code.html` lines 26-71

### Structure
```
aside (w-[240px] | w-[60px], h-screen, sticky, bg-[#F5F5F7], z-40)
├── Logo: w-8 h-8 rounded-lg bg-primary-container + "FondEU" + "THE DIGITAL CURATOR"
├── Nav (4 items, no more funding calls):
│   ├── Home (home, filled when active)
│   ├── Projects (folder_open)
│   ├── Files (description)
│   └── AI Assistant (smart_toy)
├── Settings link (bottom, above profile)
└── User profile card (bg-surface-container-low rounded-xl p-2, avatar + name + role)
```

### Active State Animation
The active nav item has a `bg-[#E3E2E7] text-[#0071E3] rounded-full` background. Using Motion `layoutId="sidebar-active"`, this pill animates smoothly between items on navigation — Apple-style floating indicator.

### Nav Items Reduced
Remove `euro_symbol` / "Funding Calls" entry. Final 4 items:
- `home` → `/{locale}/panou`
- `folder_open` → `/{locale}/proiecte`
- `description` → `/{locale}/documente`
- `smart_toy` → `/{locale}/asistent-ai`

### Collapsed State
Icon-only, tooltip on hover, logo shrinks to icon-only (just the blue square).

## 3. TopNav

Reference: `docs/stitch-2/stitch/home_fondeu/code.html` lines 73-92

### Structure
```
header (fixed, top-0, w-full, z-50)
  bg-white/72 backdrop-blur-xl shadow-[0_20px_40px_rgba(0,0,0,0.04)]
├── Left: Date string "Luni, 22 Octombrie" (text-on-surface-variant text-sm font-medium)
│   Mobile: hamburger + "FondEU" title
├── Right: notification bell (w-10 h-10 rounded-full) + help icon (same)
```

Offset `left` matches sidebar width with transition.

## 4. Pages

### 4.1 Home (panou)

Reference: `docs/stitch-2/stitch/home_fondeu/code.html` + `screen.png`

**Layout**: Single column, max-w-[1400px], centered

**Sections (top to bottom):**

1. **Greeting banner**
   - "Bună dimineața, {name}" — `text-lg font-medium text-primary`
   - Subtitle: "Ai {n} apeluri de finanțare noi care se potrivesc profilului tău." — `text-on-surface-variant`

2. **Hero section** (centered)
   - "Pregătește-ți proiectul european" — `text-5xl md:text-7xl font-bold tracking-tighter leading-none text-on-surface`
   - Below: search bar — `bg-white rounded-full shadow-sm py-4 px-6` with search icon + input + blue "Analizează" pill button
   - Below search: 3 small keyword pills (e.g. "Digitalizare IMM", "Energie Verde", "Startup Tech")

3. **3 Action cards** (staggered reveal)
   - Grid of 3 glass cards: "New Project" (add_circle), "Find Funding" (manage_search → links to AI assistant now), "Upload Documents" (upload_file)
   - Each: large icon header, title bold, description text
   - `glass` style: `bg-white/72 backdrop-blur-[20px] border border-black/6 rounded-[1rem] p-6`
   - Motion: `staggerContainer` + `staggerItem` + `hoverLift`

4. **Two-column section**
   - Left "Continuă activitatea" — recent projects list with progress indicators
     - Data: `GET /api/v1/projects?perPage=3`
     - Each row: project thumbnail placeholder, title, schedule/status, progress bar, chevron_right
     - "Vezi tot" link to `/proiecte`
   - Right "Potriviri de Top" — AI-matched funding opportunities
     - Data: `GET /api/ai/orchestrator/sessions?limit=3` to find matched calls from canvas state, or static prompt
     - Cards with match percentage badge, title, budget, deadline

5. **Floating AI bubble** (bottom-right, fixed)
   - `bg-primary-container text-white rounded-2xl p-4 shadow-lg` with "Întreabă AI Curatorul" + "Start Chat" link
   - Links to `/asistent-ai`
   - Subtle bounce animation on mount

**Data sources**: Same as current (projects API + orchestrator sessions). No changes.

### 4.2 Projects (proiecte)

Reference: `docs/stitch-2/stitch/projects_fondeu/code.html` + `screen.png`

**Header:**
- "Projects" — `text-5xl font-bold tracking-tight`
- Subtitle: "Curating your path to European innovation." — `text-on-surface-variant text-lg`
- "Create Project" blue button (links to AI assistant)

**Search + Filters:**
- Full-width search: `bg-surface-container-high rounded-full py-4 pl-12 pr-4` with search icon
- Filter chips: All Projects / In Progress / Submitted / Approved
  - Active: `bg-on-surface text-surface rounded-full`
  - Inactive: `bg-surface-container-high text-on-surface-variant rounded-full`

**Project Grid:** 3 columns, `staggerContainer`
- Each card: `glass` style rounded-[1.5rem] p-8
  - Status badge top-left (colored pill)
  - Progress ring top-right (SVG circle, 36x36)
  - Title bold, subtitle (acronym + ID)
  - Footer: team avatars left, modified time right
  - Motion: `staggerItem` + `hoverLift`
- Ghost "add" card: dashed border, plus icon

**Archive section:** "The Archive is Clear" centered, stacked papers icon, description, learn more link

**Data**: Same `/api/v1/projects` endpoint. No changes.

### 4.3 Project Detail (proiecte/[id])

Reference: `docs/stitch-2/stitch/project_detail_fondeu/code.html` + `screen.png`

**Breadcrumb:** "Projects / {acronym}" — clickable back link

**Hero:**
- Status pill (IN PROGRESS blue, DRAFT gray, etc.) + ID badge `text-on-surface-variant text-sm`
- Title: `text-5xl font-bold tracking-tight`
- Organization name below
- Right: Share button (ghost) + Edit Project / Resume AI button (dark solid)

**Tabs:** Overview / Documents / Tasks / Timeline
- Underline active with `border-b-2 border-primary text-primary font-bold`
- `AnimatePresence mode="wait"` for tab content transitions

**Overview tab (12-col grid):**
- Left 8 cols:
  - Executive Summary glass card: `rounded-[1rem] p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)]`
  - Summary text + stats row (Grant Allocation, Duration, Consortium Size) with divider
  - Project Details card below
- Right 4 cols:
  - Large progress ring (w-40 h-40) compliance card
  - "Technical Reporting" deadline card with calendar icon + days left
  - "Curator Insights" AI card with avatar + suggestion text + CTA button

**Data**: Same `/api/v1/projects/:id` + files + sessions. No changes.

### 4.4 AI Assistant (asistent-ai)

Reference: `docs/stitch-2/stitch/ai_assistant_fondeu/code.html` + `screen.png`

**Split panel:** Left ~55% chat, Right ~45% canvas

**Chat (left):**
- Header: "Grant Strategy Curator" with blue avatar circle + subtitle "Optimizing for {call}"
- Messages: user = blue pill right-aligned, assistant = glass card left-aligned with rounded-tl-none
- File attachments: card with file icon + filename + download icon
- Step progress: horizontal dots with labels
- Input: `bg-white rounded-full py-5 pl-8 pr-20 shadow-sm` + blue send button

**Canvas (right):**
- Header: "Grant Proposal Canvas" + "SAVE DRAFT" ghost button + "REVIEW FINAL" blue button
- Step indicator: 5 circles (Analysis → Strategy → Drafting → Review) with check marks for completed
- Section cards: "SECTION 1.1: PROJECT SUMMARY" with status badge (INDIVIDUAL/PROVISIONAL)
- Content preview with edit capabilities

**Transitions:**
- Canvas slides in from right when `showCanvas` becomes true — Motion `initial={{ x: 40, opacity: 0 }}` `animate={{ x: 0, opacity: 1 }}`
- Message list: each new message fades in with `staggerItem`

**Data**: Same orchestrator hook. No changes.

### 4.5 Files (documente)

Reference: `docs/stitch-2/stitch/files_fondeu/code.html` + `screen.png`

**Header:**
- "Files" — `text-[56px] font-bold tracking-tighter`
- Subtitle: "Manage your EU grant documentation and research assets."
- Search pill + Upload button (blue)

**Filter chips:** All / Recent / Shared / Archived

**Project Documents section:**
- 3-column grid of file cards
- Each card: colored file icon (red PDF, blue DOC, green XLS) in rounded-xl container, filename bold, size + updated time, user avatar + name bottom
- `glass` style + `hoverLift`

**Compliance section:**
- List rows: file icon + name + verified badge + size
- Simpler row layout vs grid

**Smart Templates card:**
- `bg-primary-container text-white rounded-[1rem] p-8` — positioned right-aligned (lg:col-span-4 lg:col-start-9)
- AI icon + title + description + template list + "Browse Templates" button

**Floating AI bubble:** "Curate AI — Ready to organize files" bottom-right

**Data**: Same project files API. No changes.

### 4.6 Settings (setari)

Reference: `docs/stitch-2/stitch/settings_fondeu/code.html` + `screen.png`

**Hero:**
- "Account & Preferences" — `text-5xl lg:text-6xl font-bold tracking-tighter`
- Subtitle: "Curate your digital workspace..." — `text-xl text-on-surface-variant`

**2x2 Bento grid:** `grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12`

1. **Personal Identity** — glass card
   - Header: person icon + "PERSONAL IDENTITY" label + "Edit Profile" link
   - Avatar (w-24 h-24 rounded-full) + name + email + org badge
   - Language switcher (RO/EN pills)

2. **Curator Intelligence** — glass card
   - Header: auto_awesome icon + "CURATOR INTELLIGENCE" label
   - LLM Model dropdown (select with custom styling)
   - Auto-Approve toggle with description

3. **Subscription Status** — glass card
   - Header: payments icon + "SUBSCRIPTION STATUS" label + tier badge (ENTERPRISE pill)
   - AI Analysis Credits: progress bar (840/1000)
   - Storage: progress bar (12.4 GB / 50 GB)
   - "Manage Billing & Usage" full-width blue button

4. **GDPR & Privacy** — glass card
   - Header: security icon + "GDPR & PRIVACY" label
   - Data Retention Consent toggle + "Last consented" date
   - Cross-Border Transfer toggle + description

**Footer:** Privacy Policy / Terms / Compliance Hub links + "FONDEU © 2024 • BUILD V8.2.0-ALPHA"

**Data**: Same API endpoints (session, preferences, orgs, pricing). No changes.

## 5. Deletion: Funding Calls Page

### Remove
- `app/src/app/[locale]/(dashboard)/finantari/page.tsx` — delete entirely
- Sidebar nav: remove `euro_symbol` / "Funding Calls" entry from `NAV_ITEMS` in `Sidebar.tsx`
- Home page: "Find Funding" action card links to `/asistent-ai` instead of `/finantari`

### Keep
- `/api/v1/calls` API route — may still be used by AI orchestrator internally
- `/api/ai/search-calls` API route — used by AI orchestrator for matching
- `calls_for_proposals` DB table — no schema changes

### Redirect
- Add a redirect from `/{locale}/finantari` → `/{locale}/asistent-ai` in middleware to handle bookmarks

## 6. Glass Card Utility

Standardize `glass` class used across all pages. In `app/src/app/globals.css`:

```css
.glass {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
```

Replace existing `glass-card` class with this. All cards across all pages use this base + additional Tailwind for rounding, padding, shadows.

## 7. Readability Checklist

Every page must pass:
- [ ] Body text (14-16px): uses `text-on-surface` (#1A1B1F, 14:1) or `text-on-surface-variant` (#373A41, 5.5:1) — both pass AA
- [ ] Small labels (10-12px): uses `text-on-surface-variant` at minimum, never `text-outline` for small text
- [ ] Large headings (24px+): can use any token (all pass 3:1 for large text)
- [ ] Interactive elements: minimum 3:1 contrast against background
- [ ] No text on gradient/image backgrounds without sufficient overlay
- [ ] All placeholder text uses `placeholder:text-on-surface-variant/50` minimum

## 8. File Changes Summary

### New files
- `app/src/components/ui/LiveBackground.tsx` — animated orbs
- `app/src/lib/motion.ts` — shared motion configs
- `app/src/app/[locale]/(dashboard)/template.tsx` — page transition wrapper

### Modified files
- `app/src/components/layout/Sidebar.tsx` — pixel-match Stitch, remove funding nav, add layoutId
- `app/src/components/layout/SidebarItem.tsx` — Motion animated active pill
- `app/src/components/layout/TopNav.tsx` — pixel-match Stitch glass header
- `app/src/components/layout/AppShell.tsx` — add LiveBackground, adjust z-indices
- `app/src/app/[locale]/(dashboard)/panou/page.tsx` — full rewrite to match Stitch home
- `app/src/app/[locale]/(dashboard)/proiecte/page.tsx` — pixel-match Stitch projects
- `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx` — pixel-match Stitch project detail
- `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` — pixel-match Stitch AI assistant
- `app/src/app/[locale]/(dashboard)/documente/page.tsx` — pixel-match Stitch files
- `app/src/app/[locale]/(dashboard)/setari/page.tsx` — pixel-match Stitch settings
- `app/src/app/globals.css` — add `.glass` utility, orb keyframes
- `app/src/middleware.ts` — add finantari → asistent-ai redirect
- `package.json` — add `motion` dependency

### Deleted files
- `app/src/app/[locale]/(dashboard)/finantari/page.tsx`

## 9. Verification Plan

For each page after implementation:
1. Screenshot with headless browser
2. Compare side-by-side with `docs/stitch-2/stitch/{page}/screen.png`
3. Check all text is readable (no light-on-light)
4. Verify Motion transitions work (page nav, hover, stagger)
5. Verify live background is visible but subtle
6. Test collapsed sidebar state
7. Test mobile responsive (topnav hamburger, stacked layouts)
