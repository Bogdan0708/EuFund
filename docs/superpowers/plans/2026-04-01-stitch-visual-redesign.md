# Stitch Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL**: For EVERY page task, read the corresponding Stitch `code.html` file FIRST, then copy Tailwind classes directly. After each page, screenshot and compare with `screen.png`. The Stitch files are the source of truth — NOT this plan's descriptions.

**Goal:** Pixel-match all dashboard pages to Stitch V2 reference designs, add Motion transitions, CSS live background, delete funding calls page, ensure WCAG AA readability.

**Architecture:** Motion library for page transitions and micro-interactions via `template.tsx`. CSS-only animated gradient orbs for live background. Each page preserves its existing data fetching logic but replaces JSX/Tailwind to match Stitch `code.html` exactly.

**Tech Stack:** Next.js 14 App Router, Motion (formerly Framer Motion), Tailwind CSS, Material Symbols icons, existing API endpoints unchanged.

**Spec:** `docs/superpowers/specs/2026-04-01-stitch-visual-redesign-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `app/src/components/ui/LiveBackground.tsx` | CSS-only animated gradient orbs behind all content |
| `app/src/lib/motion.ts` | Shared motion animation configs (page transition, stagger, hover) |
| `app/src/app/[locale]/(dashboard)/template.tsx` | AnimatePresence wrapper for page transitions |

### Modified files
| File | Changes |
|------|---------|
| `app/package.json` | Add `motion` dependency |
| `app/src/app/globals.css` | Add orb keyframes, update `.glass-card` to `.glass` |
| `app/src/components/layout/AppShell.tsx` | Add `<LiveBackground />`, adjust z-index |
| `app/src/components/layout/Sidebar.tsx` | Remove funding calls nav item, pixel-match Stitch, logo to `auto_awesome` |
| `app/src/components/layout/SidebarItem.tsx` | Pixel-match Stitch active/inactive styles with Motion `layoutId` |
| `app/src/components/layout/TopNav.tsx` | Pixel-match Stitch glass header |
| `app/src/components/layout/MobileNav.tsx` | Remove funding calls, update styles to match Stitch mobile nav |
| `app/src/app/[locale]/(dashboard)/panou/page.tsx` | Full rewrite to match Stitch home |
| `app/src/app/[locale]/(dashboard)/proiecte/page.tsx` | Pixel-match Stitch projects |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx` | Pixel-match Stitch project detail |
| `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` | Pixel-match Stitch AI assistant |
| `app/src/app/[locale]/(dashboard)/documente/page.tsx` | Pixel-match Stitch files |
| `app/src/app/[locale]/(dashboard)/setari/page.tsx` | Pixel-match Stitch settings |
| `app/src/middleware.ts` | Add `/finantari` → `/asistent-ai` redirect |

### Deleted files
| File | Reason |
|------|--------|
| `app/src/app/[locale]/(dashboard)/finantari/page.tsx` | Funding calls page removed (AI matches in background) |

---

## Task 1: Install Motion + Foundation Files

**Files:**
- Modify: `app/package.json`
- Create: `app/src/lib/motion.ts`
- Create: `app/src/components/ui/LiveBackground.tsx`
- Create: `app/src/app/[locale]/(dashboard)/template.tsx`
- Modify: `app/src/app/globals.css`

- [ ] **Step 1: Install motion package**

```bash
cd app && npm install motion
```

- [ ] **Step 2: Create shared motion config**

Create `app/src/lib/motion.ts`:

```typescript
export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export const pageTransition = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
  duration: 0.3,
}

export const staggerContainer = {
  animate: {
    transition: { staggerChildren: 0.06 },
  },
}

export const staggerItem = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
}

export const staggerTransition = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
}

export const hoverLift = {
  whileHover: { y: -4 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 25 },
}

export const canvasSlideIn = {
  initial: { x: 40, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  transition: { type: 'spring' as const, stiffness: 300, damping: 30 },
}
```

- [ ] **Step 3: Create LiveBackground component**

Create `app/src/components/ui/LiveBackground.tsx`:

```tsx
'use client'

export function LiveBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* Orb 1 — primary blue */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full opacity-[0.15] blur-[120px] will-change-transform"
        style={{
          background: '#0071E3',
          top: '-10%',
          left: '-5%',
          animation: 'float-orb-1 25s ease-in-out infinite',
        }}
      />
      {/* Orb 2 — secondary purple */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full opacity-[0.10] blur-[120px] will-change-transform"
        style={{
          background: '#4A47D2',
          bottom: '-10%',
          right: '-5%',
          animation: 'float-orb-2 30s ease-in-out infinite',
        }}
      />
      {/* Orb 3 — tertiary teal */}
      <div
        className="absolute w-[400px] h-[400px] rounded-full opacity-[0.07] blur-[120px] will-change-transform"
        style={{
          background: '#00637F',
          top: '40%',
          left: '30%',
          animation: 'float-orb-3 35s ease-in-out infinite',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Update globals.css with orb keyframes and glass utility**

Replace the entire `@layer components` block in `app/src/app/globals.css`:

```css
@layer components {
  /* Glass card — Stitch V2 canonical */
  .glass {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  /* Keep glass-card as alias for backwards compat during migration */
  .glass-card {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  [data-theme="dark"] .glass,
  [data-theme="dark"] .glass-card {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .mesh-gradient {
    background-color: rgb(var(--surface));
    background-image:
      radial-gradient(at 0% 0%, rgba(0, 113, 227, 0.15) 0px, transparent 50%),
      radial-gradient(at 100% 0%, rgba(74, 71, 210, 0.15) 0px, transparent 50%),
      radial-gradient(at 100% 100%, rgba(0, 113, 227, 0.10) 0px, transparent 50%),
      radial-gradient(at 0% 100%, rgba(74, 71, 210, 0.10) 0px, transparent 50%);
  }

  .ai-halo {
    background: radial-gradient(circle at center, rgba(74, 71, 210, 0.08) 0%, transparent 70%);
  }

  /* Live background orb keyframes */
  @keyframes float-orb-1 {
    0%, 100% { transform: translate3d(0, 0, 0); }
    25% { transform: translate3d(60px, 40px, 0); }
    50% { transform: translate3d(30px, -30px, 0); }
    75% { transform: translate3d(-40px, 20px, 0); }
  }

  @keyframes float-orb-2 {
    0%, 100% { transform: translate3d(0, 0, 0); }
    25% { transform: translate3d(-50px, -30px, 0); }
    50% { transform: translate3d(40px, 20px, 0); }
    75% { transform: translate3d(20px, -40px, 0); }
  }

  @keyframes float-orb-3 {
    0%, 100% { transform: translate3d(0, 0, 0); }
    33% { transform: translate3d(-30px, 50px, 0); }
    66% { transform: translate3d(50px, -20px, 0); }
  }
}
```

Note: `.fade-in-up` is removed — Motion handles all animations now.

- [ ] **Step 5: Create page transition template**

Create `app/src/app/[locale]/(dashboard)/template.tsx`:

```tsx
'use client'

import { motion, AnimatePresence } from 'motion/react'
import { usePathname } from 'next/navigation'
import { pageVariants, pageTransition } from '@/lib/motion'

export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        variants={pageVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={pageTransition}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 6: Commit foundation**

```bash
git add app/package.json app/package-lock.json app/src/lib/motion.ts app/src/components/ui/LiveBackground.tsx app/src/app/\[locale\]/\(dashboard\)/template.tsx app/src/app/globals.css
git commit -m "feat: add Motion library, live background, page transitions

Foundation for Stitch V2 visual redesign: motion configs, animated
gradient orbs, AnimatePresence page transitions via template.tsx."
```

---

## Task 2: Sidebar Pixel-Match Stitch

**Files:**
- Modify: `app/src/components/layout/Sidebar.tsx`
- Modify: `app/src/components/layout/SidebarItem.tsx`

**Stitch reference:** `docs/stitch-2/stitch/home_fondeu/code.html` lines 26-71

- [ ] **Step 1: Rewrite SidebarItem with Motion layoutId**

Replace entire `app/src/components/layout/SidebarItem.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { motion } from 'motion/react'
import { Icon } from '@/components/ui/ds-icon'

interface SidebarItemProps {
  href: string
  icon: string
  label: string
  active?: boolean
  collapsed?: boolean
}

export function SidebarItem({ href, icon, label, active = false, collapsed = false }: SidebarItemProps) {
  return (
    <Link
      href={href}
      className={`
        relative flex items-center gap-3 px-4 py-2 font-medium text-sm tracking-tight
        rounded-full transition-all duration-300 hover:translate-y-[-1px]
        ${active
          ? 'text-[#0071E3]'
          : 'text-[#414753] hover:text-slate-900 hover:bg-[#E3E2E7]'
        }
      `}
    >
      {active && (
        <motion.div
          layoutId="sidebar-active"
          className="absolute inset-0 bg-[#E3E2E7] rounded-full"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative z-10">
        <Icon name={icon} filled={active} size="md" className="shrink-0" />
      </span>
      {!collapsed && (
        <span className="relative z-10 truncate">{label}</span>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Rewrite Sidebar to match Stitch**

Replace entire `app/src/components/layout/Sidebar.tsx`:

```tsx
'use client'

import { usePathname } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Icon } from '@/components/ui/ds-icon'
import { SidebarItem } from './SidebarItem'

interface SidebarProps {
  userName?: string
  userInitials?: string
  collapsed: boolean
  onToggle: () => void
}

const NAV_ITEMS = [
  { route: '', icon: 'home', labelKey: 'home' },
  { route: '/proiecte', icon: 'folder_open', labelKey: 'projects' },
  { route: '/documente', icon: 'description', labelKey: 'files' },
  { route: '/asistent-ai', icon: 'smart_toy', labelKey: 'aiAssistant' },
] as const

export function Sidebar({ userName, userInitials, collapsed }: SidebarProps) {
  const t = useTranslations('nav')
  const locale = useLocale()
  const pathname = usePathname()
  const prefix = `/${locale}`

  const isActive = (route: string) => {
    const href = `${prefix}${route}`
    if (route === '') return pathname === prefix || pathname === `${prefix}/` || pathname === `${prefix}/panou`
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={`
        fixed top-0 left-0 h-screen flex flex-col
        bg-[#F5F5F7] border-r-0
        transition-[width] duration-300 ease-out z-40
        py-8 px-4
        ${collapsed ? 'w-[60px]' : 'w-[240px]'}
      `}
    >
      {/* Logo — matches Stitch: auto_awesome icon + FondEU + THE DIGITAL CURATOR */}
      <div className="flex items-center gap-3 px-4 mb-12">
        <div className="w-8 h-8 rounded-lg bg-primary-container flex items-center justify-center text-white shrink-0">
          <Icon name="auto_awesome" filled size="sm" />
        </div>
        {!collapsed && (
          <div className="flex flex-col min-w-0">
            <h1 className="text-xl font-bold tracking-tighter text-slate-900">FondEU</h1>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">
              The Digital Curator
            </p>
          </div>
        )}
      </div>

      {/* Navigation — 4 items (funding calls removed) */}
      <nav className="flex-1 space-y-2">
        {NAV_ITEMS.map(item => {
          const href = item.route === '' ? `${prefix}/panou` : `${prefix}${item.route}`
          return (
            <SidebarItem
              key={item.route}
              href={href}
              icon={item.icon}
              label={t(item.labelKey)}
              active={isActive(item.route)}
              collapsed={collapsed}
            />
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="mt-auto pt-8 px-4">
        {/* Settings */}
        <SidebarItem
          href={`${prefix}/setari`}
          icon="settings"
          label={t('settings')}
          active={isActive('/setari')}
          collapsed={collapsed}
        />

        {/* User profile — matches Stitch: avatar + name + role */}
        {!collapsed && (
          <div className="mt-6 flex items-center gap-3 p-2 bg-surface-container-low rounded-xl">
            <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center text-sm font-bold shrink-0">
              {userInitials || '?'}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-bold truncate">{userName || '—'}</p>
              <p className="text-[10px] text-on-surface-variant truncate">Premium Curator</p>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
```

- [ ] **Step 3: Commit sidebar changes**

```bash
git add app/src/components/layout/Sidebar.tsx app/src/components/layout/SidebarItem.tsx
git commit -m "feat(sidebar): pixel-match Stitch, remove funding calls, add animated active pill"
```

---

## Task 3: TopNav + AppShell + MobileNav Updates

**Files:**
- Modify: `app/src/components/layout/TopNav.tsx`
- Modify: `app/src/components/layout/AppShell.tsx`
- Modify: `app/src/components/layout/MobileNav.tsx`

**Stitch reference:** `docs/stitch-2/stitch/home_fondeu/code.html` lines 73-92 (TopNav), 236-256 (MobileNav)

- [ ] **Step 1: TopNav is already close — verify and keep**

The current TopNav at `app/src/components/layout/TopNav.tsx` already matches Stitch:
- Fixed glass header: `bg-white/[0.72] backdrop-blur-xl shadow-[0_20px_40px_rgba(0,0,0,0.04)]` ✓
- Left: date (desktop), hamburger+brand (mobile) ✓
- Right: notifications + help ✓

No changes needed to TopNav.

- [ ] **Step 2: Update AppShell to add LiveBackground**

Replace entire `app/src/components/layout/AppShell.tsx`:

```tsx
'use client'

import { type ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { TopNav } from './TopNav'
import { MobileNav } from './MobileNav'
import { CommandPalette } from './CommandPalette'
import { LiveBackground } from '@/components/ui/LiveBackground'
import { useCommandPalette } from '@/hooks/useCommandPalette'
import { useSidebar } from '@/hooks/useSidebar'

interface AppShellProps {
  locale: string
  userName: string
  userInitials: string
  userImage?: string | null
  children: ReactNode
}

export function AppShell({ locale, userName, userInitials, children }: AppShellProps) {
  const { open: cmdOpen, close: cmdClose } = useCommandPalette()
  const { collapsed, toggle } = useSidebar()

  return (
    <>
      {/* Live animated background */}
      <LiveBackground />

      {/* Sidebar — desktop only */}
      <div className="hidden md:flex">
        <Sidebar
          userName={userName}
          userInitials={userInitials}
          collapsed={collapsed}
          onToggle={toggle}
        />
      </div>

      {/* TopNav — fixed glass header */}
      <TopNav
        onMenuClick={toggle}
        sidebarCollapsed={collapsed}
      />

      {/* Main content area — z-10 above live background */}
      <main
        className={`
          relative z-10 min-h-screen transition-[margin-left] duration-300 ease-out
          pb-20 md:pb-0
          pt-20
          ${collapsed ? 'md:ml-[60px]' : 'md:ml-[240px]'}
        `}
      >
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 lg:px-24 py-6">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <MobileNav locale={locale} />

      {/* Command palette (Cmd+K) */}
      <CommandPalette open={cmdOpen} onClose={cmdClose} />
    </>
  )
}
```

- [ ] **Step 3: Update MobileNav — remove funding calls**

Replace entire `app/src/components/layout/MobileNav.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/ds-icon'

interface MobileNavProps {
  locale: string
}

const NAV_ITEMS = [
  { route: '/panou', icon: 'home', label: 'Home' },
  { route: '/proiecte', icon: 'folder_open', label: 'Projects' },
  { route: '/asistent-ai', icon: 'smart_toy', label: 'AI' },
  { route: '/documente', icon: 'description', label: 'Files' },
  { route: '/setari', icon: 'settings', label: 'Settings' },
] as const

export function MobileNav({ locale }: MobileNavProps) {
  const pathname = usePathname()
  const prefix = `/${locale}`

  const isActive = (route: string) => {
    const href = `${prefix}${route}`
    if (route === '/panou') {
      return pathname === prefix || pathname === `${prefix}/` || pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center px-6 pb-6 pt-3 bg-white/80 backdrop-blur-lg border-t border-slate-200/15 shadow-2xl z-50">
      {NAV_ITEMS.map((item) => {
        const href = `${prefix}${item.route}`
        const active = isActive(item.route)
        return (
          <Link
            key={item.route}
            href={href}
            className={`
              flex flex-col items-center justify-center
              ${active
                ? 'bg-[#0071E3] text-white rounded-full w-12 h-12 active:scale-95 transition-transform'
                : 'text-slate-400 active:scale-95 transition-transform'
              }
            `}
          >
            <Icon name={item.icon} filled={active} size="md" />
            {!active && (
              <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: Commit layout changes**

```bash
git add app/src/components/layout/AppShell.tsx app/src/components/layout/MobileNav.tsx
git commit -m "feat(layout): add live background to AppShell, update MobileNav"
```

---

## Task 4: Delete Funding Calls Page + Middleware Redirect

**Files:**
- Delete: `app/src/app/[locale]/(dashboard)/finantari/page.tsx`
- Modify: `app/src/middleware.ts`

- [ ] **Step 1: Delete the funding calls page**

```bash
rm app/src/app/\[locale\]/\(dashboard\)/finantari/page.tsx
```

- [ ] **Step 2: Add redirect in middleware**

In `app/src/middleware.ts`, find the section where routes are handled and add a redirect for `/finantari` to `/asistent-ai`. Look for the pathname handling section and add before the main logic:

```typescript
// Redirect removed funding calls page to AI assistant
if (pathname.match(/^\/(ro|en)\/finantari/)) {
  const locale = pathname.startsWith('/en') ? 'en' : 'ro'
  return NextResponse.redirect(new URL(`/${locale}/asistent-ai`, request.url))
}
```

Add this early in the middleware function, after locale detection but before auth checks.

- [ ] **Step 3: Commit deletion**

```bash
git add -A app/src/app/\[locale\]/\(dashboard\)/finantari/ app/src/middleware.ts
git commit -m "feat: delete funding calls page, add redirect to AI assistant

AI orchestrator matches funding calls in the background during the
workflow — a dedicated browse page is unnecessary."
```

---

## Task 5: Home Page (panou) — Full Rewrite

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/panou/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/home_fondeu/code.html` + `screen.png`

**IMPORTANT:** Read the full Stitch `code.html` before writing. Copy Tailwind classes directly.

- [ ] **Step 1: Read the Stitch home reference**

Read `docs/stitch-2/stitch/home_fondeu/code.html` and `screen.png` to understand exact classes.

- [ ] **Step 2: Rewrite panou/page.tsx**

Replace entire `app/src/app/[locale]/(dashboard)/panou/page.tsx` with:
- Keep existing data fetching logic (projects API + orchestrator sessions)
- Replace all JSX to match Stitch home layout exactly
- Add Motion animations (stagger container for action cards, hover lift)
- Sections: greeting → hero text → search bar with keyword pills → 3 action cards → two-column (continue activity + top matches) → floating AI bubble
- "Find Funding" card links to `/asistent-ai` (not `/finantari`)
- Use `glass` class for cards (not `glass-card`)
- All text must use readable tokens: headings `text-on-surface`, body `text-on-surface-variant`, never raw gray values

Key Stitch classes to copy:
- Hero: `text-5xl md:text-7xl font-bold tracking-[-0.03em] text-on-surface leading-tight`
- Search bar: `glass p-2 rounded-full flex items-center shadow-xl` with blue `bg-[#2997FF]` Analizează button
- Action cards: `glass p-8 rounded-lg group hover:bg-white transition-all duration-300`
- Card icons: `w-12 h-12 bg-primary/10 rounded-2xl` with `group-hover:scale-110 transition-transform`
- Continue section: `bg-surface-container-low rounded-lg p-1` with `bg-white rounded-[1.5rem] p-6 shadow-sm` items
- Top matches: `glass p-6 rounded-lg` with absolute positioned match badge
- AI bubble: `bg-gradient-to-br from-primary to-secondary p-6 rounded-lg text-white shadow-xl shadow-primary/20`

- [ ] **Step 3: Screenshot and verify against screen.png**

Use `/browse` to navigate to `localhost:3002/ro/panou` and take a screenshot. Compare with `docs/stitch-2/stitch/home_fondeu/screen.png`.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[locale\]/\(dashboard\)/panou/page.tsx
git commit -m "feat(home): pixel-match Stitch home design with Motion animations"
```

---

## Task 6: Projects Page (proiecte) — Pixel-Match Stitch

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/projects_fondeu/code.html` + `screen.png`

- [ ] **Step 1: Read the Stitch projects reference**

Read `docs/stitch-2/stitch/projects_fondeu/code.html` and `screen.png`.

- [ ] **Step 2: Rewrite proiecte/page.tsx**

Keep existing data fetching (API calls unchanged). Replace JSX to match Stitch:
- Header: `text-5xl font-bold tracking-tight` + subtitle + Create Project button (`bg-primary-container text-white px-8 py-4 rounded-full`)
- Search: `bg-surface-container-high rounded-full py-4 pl-12 pr-4` full-width
- Filter chips: active `bg-on-surface text-surface rounded-full`, inactive `bg-surface-container-high text-on-surface-variant`
- Project cards: `glass-card rounded-[1.5rem] p-8` with status badge, progress ring, title, team avatars, modified time
- Ghost add card: dashed border, centered plus icon
- Archive section: "The Archive is Clear" with icon, description
- Add Motion: `staggerContainer` on grid, `staggerItem` + `hoverLift` on cards

- [ ] **Step 3: Screenshot and verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[locale\]/\(dashboard\)/proiecte/page.tsx
git commit -m "feat(projects): pixel-match Stitch projects design with Motion animations"
```

---

## Task 7: Project Detail Page — Pixel-Match Stitch

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/project_detail_fondeu/code.html` + `screen.png`

- [ ] **Step 1: Read the Stitch project detail reference**

Read `docs/stitch-2/stitch/project_detail_fondeu/code.html` and `screen.png`.

- [ ] **Step 2: Update proiecte/[id]/page.tsx**

Keep existing data fetching. Update JSX:
- Breadcrumb: "Projects / {acronym}" with clickable back link
- Status pill: `IN PROGRESS` blue, `ID: EU-H2024-MOB-082` badge
- Title: `text-5xl font-bold tracking-tight`
- Right buttons: "Share" ghost + "Edit Project" dark solid
- Tabs: underline active `text-primary border-b-2 border-primary font-bold`
- Overview: 12-col grid, executive summary glass card with stats row, sidebar with progress ring + deadline card + curator insights
- Add Motion: `AnimatePresence mode="wait"` for tab content transitions

- [ ] **Step 3: Screenshot and verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[locale\]/\(dashboard\)/proiecte/\[id\]/page.tsx
git commit -m "feat(project-detail): pixel-match Stitch project detail with tab transitions"
```

---

## Task 8: AI Assistant Page — Pixel-Match Stitch

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/ai_assistant_fondeu/code.html` + `screen.png`

- [ ] **Step 1: Read the Stitch AI assistant reference**

Read `docs/stitch-2/stitch/ai_assistant_fondeu/code.html` and `screen.png`.

- [ ] **Step 2: Update asistent-ai/page.tsx**

Keep ALL existing data fetching and orchestrator hook logic. Update JSX:
- Chat header: "Grant Strategy Curator" with blue avatar + subtitle
- Message styling: user = blue pill right-aligned, assistant = glass card left-aligned with `rounded-tl-none`
- Canvas header: "Grant Proposal Canvas" + "SAVE DRAFT" / "REVIEW FINAL" buttons
- Step indicator: circles with checkmarks for completed steps
- Canvas slides in from right with Motion `canvasSlideIn`
- Each new message fades in with `staggerItem`
- Input: `bg-white rounded-full py-5 pl-8 pr-20 shadow-sm` with blue circular send button

- [ ] **Step 3: Screenshot and verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[locale\]/\(dashboard\)/asistent-ai/page.tsx
git commit -m "feat(ai-assistant): pixel-match Stitch AI assistant with canvas slide-in"
```

---

## Task 9: Files Page (documente) — Pixel-Match Stitch

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/documente/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/files_fondeu/code.html` + `screen.png`

- [ ] **Step 1: Read the Stitch files reference**

Read `docs/stitch-2/stitch/files_fondeu/code.html` and `screen.png`.

- [ ] **Step 2: Update documente/page.tsx**

Keep existing data fetching. Update JSX:
- Header: `text-[56px] font-bold tracking-tighter` "Files" + subtitle + search pill + Upload button (`bg-[#0071e3] text-white px-8 py-3 rounded-full`)
- Filter chips: All / Recent / Shared / Archived — active `bg-on-surface text-surface`, inactive `bg-surface-container-high`
- File cards: `glass-card rounded-[1rem] p-6` with colored file icons (red PDF `bg-red-50 text-red-500`, blue DOC `bg-blue-50 text-blue-500`, green XLS `bg-green-50 text-green-500`)
- Compliance section: list rows with verified badges
- Smart Templates card: `bg-primary-container text-white rounded-[1rem] p-8` right-aligned with template list
- Add Motion: stagger on file cards grid

- [ ] **Step 3: Screenshot and verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[locale\]/\(dashboard\)/documente/page.tsx
git commit -m "feat(files): pixel-match Stitch files design with Motion stagger"
```

---

## Task 10: Settings Page (setari) — Pixel-Match Stitch

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/setari/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/settings_fondeu/code.html` + `screen.png`

- [ ] **Step 1: Read the Stitch settings reference**

Read `docs/stitch-2/stitch/settings_fondeu/code.html` and `screen.png`.

- [ ] **Step 2: Update setari/page.tsx**

Keep existing data fetching. Update JSX:
- Hero: "Account & Preferences" `text-5xl lg:text-6xl font-bold tracking-tighter` + subtitle
- 2x2 bento grid: `glass-card rounded-[1rem] p-10`
  1. Personal Identity: person icon + label + "Edit Profile" link + avatar + name + email + org badge
  2. Curator Intelligence: auto_awesome icon + label + LLM dropdown + Auto-Approve toggle
  3. Subscription Status: payments icon + ENTERPRISE badge + AI credits bar + storage bar + "Manage Billing" button
  4. GDPR & Privacy: security icon + Data Retention toggle + Cross-Border toggle
- Footer: links + build version
- Add Motion: stagger on grid cards

- [ ] **Step 3: Screenshot and verify**

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[locale\]/\(dashboard\)/setari/page.tsx
git commit -m "feat(settings): pixel-match Stitch settings design"
```

---

## Task 11: Final Verification Pass

- [ ] **Step 1: Run build to check for errors**

```bash
cd app && npm run build
```

Fix any TypeScript or build errors.

- [ ] **Step 2: Start dev server and screenshot all pages**

```bash
cd app && npm run dev
```

Navigate to each page and screenshot:
1. `/ro/panou` — compare with `docs/stitch-2/stitch/home_fondeu/screen.png`
2. `/ro/proiecte` — compare with `docs/stitch-2/stitch/projects_fondeu/screen.png`
3. `/ro/proiecte/{id}` — compare with `docs/stitch-2/stitch/project_detail_fondeu/screen.png`
4. `/ro/asistent-ai` — compare with `docs/stitch-2/stitch/ai_assistant_fondeu/screen.png`
5. `/ro/documente` — compare with `docs/stitch-2/stitch/files_fondeu/screen.png`
6. `/ro/setari` — compare with `docs/stitch-2/stitch/settings_fondeu/screen.png`
7. `/ro/finantari` — should redirect to `/ro/asistent-ai`

- [ ] **Step 3: Verify readability**

Check each page:
- All body text uses `text-on-surface` or `text-on-surface-variant` (never raw gray/outline for body)
- All labels/small text at 10-12px use `text-on-surface-variant` minimum
- No text on gradient backgrounds without sufficient contrast
- Verify live background orbs don't interfere with text readability

- [ ] **Step 4: Verify Motion transitions**

- Navigate between pages — should see smooth fade+slide
- Hover cards — should see spring lift
- Open/close sidebar — should see smooth width transition
- Switch tabs on project detail — should see cross-dissolve
- AI assistant canvas — should slide in from right

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: visual verification fixes for Stitch pixel-match"
```
