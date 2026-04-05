# FondEU Design System — The Digital Curator

> Unified design specification for FondEU's UI redesign. Light theme primary, dark theme derived.
> Generated from 15 Google Stitch screens + editorial design principles.

---

## 1. Creative North Star

**"The Digital Curator"** — EU funding is dense and bureaucratic. This system treats every piece of data as a high-end gallery exhibit. The aesthetic is Apple-inspired editorial: massive whitespace, bold typography, light glassmorphism, and intentional asymmetry.

**Not this:** Dark SaaS dashboards, Material Design defaults, cramped data grids.
**This:** Apple.com product pages, editorial magazines, gallery exhibitions.

---

## 2. Color System

All colors are defined as CSS custom properties on `:root` (light) and `.dark` / `@media (prefers-color-scheme: dark)`.

### Light Theme (Primary)

```css
:root {
  /* Surface hierarchy */
  --surface:                  #faf8fe;
  --surface-dim:              #dad9df;
  --surface-bright:           #faf8fe;
  --surface-container-lowest: #ffffff;
  --surface-container-low:    #f4f3f8;
  --surface-container:        #eeedf3;
  --surface-container-high:   #e9e7ed;
  --surface-container-highest:#e3e2e7;
  --background:               #F5F5F7;  /* Canvas — Apple gallery white */

  /* Text */
  --on-surface:               #1a1b1f;
  --on-surface-variant:       #414753;
  --on-background:            #1a1b1f;

  /* Primary (Blue) */
  --primary:                  #0059b5;
  --primary-container:        #0071e3;  /* Apple blue — buttons, CTAs */
  --primary-fixed:            #d7e2ff;
  --primary-fixed-dim:        #abc7ff;
  --on-primary:               #ffffff;
  --on-primary-container:     #fcfbff;
  --on-primary-fixed:         #001b3f;

  /* Secondary (Purple) */
  --secondary:                #4a47d2;
  --secondary-container:      #6462ec;
  --secondary-fixed:          #e2dfff;
  --secondary-fixed-dim:      #c2c1ff;
  --on-secondary:             #ffffff;
  --on-secondary-container:   #fffbff;

  /* Tertiary (Teal) */
  --tertiary:                 #00637f;
  --tertiary-container:       #007da1;
  --on-tertiary:              #ffffff;

  /* Error */
  --error:                    #ba1a1a;
  --error-container:          #ffdad6;
  --on-error:                 #ffffff;
  --on-error-container:       #93000a;

  /* Structural */
  --outline:                  #717785;
  --outline-variant:          #c1c6d6;
  --surface-tint:             #005cbb;
  --surface-variant:          #e3e2e7;
  --inverse-surface:          #2f3034;
  --inverse-on-surface:       #f1f0f5;
  --inverse-primary:          #abc7ff;
}
```

### Dark Theme (Derived)

```css
.dark, [data-theme="dark"] {
  --surface:                  #121317;
  --surface-dim:              #121317;
  --surface-bright:           #38393d;
  --surface-container-lowest: #0d0e12;
  --surface-container-low:    #1a1b1f;
  --surface-container:        #1e1f23;
  --surface-container-high:   #292a2e;
  --surface-container-highest:#343539;
  --background:               #121317;

  --on-surface:               #e3e2e7;
  --on-surface-variant:       #c1c6d6;
  --on-background:            #e3e2e7;

  --primary:                  #abc7ff;
  --primary-container:        #0071e3;  /* Stays the same */
  --primary-fixed:            #d7e2ff;
  --primary-fixed-dim:        #abc7ff;
  --on-primary:               #002f66;
  --on-primary-container:     #fcfbff;

  --secondary:                #c2c1ff;
  --secondary-container:      #3630bf;
  --on-secondary:             #1800a7;
  --on-secondary-container:   #b1b1ff;

  --tertiary:                 #68d3ff;
  --tertiary-container:       #007da1;

  --error:                    #ffb4ab;
  --error-container:          #93000a;
  --on-error:                 #690005;
  --on-error-container:       #ffdad6;

  --outline:                  #8b919f;
  --outline-variant:          #414753;
  --surface-tint:             #abc7ff;
  --surface-variant:          #343539;
  --inverse-surface:          #e3e2e7;
  --inverse-on-surface:       #2f3034;
  --inverse-primary:          #005cbb;
}
```

### Tailwind Config

```javascript
// tailwind.config.ts — extend colors with CSS custom properties
colors: {
  "surface":                  "var(--surface)",
  "surface-dim":              "var(--surface-dim)",
  "surface-bright":           "var(--surface-bright)",
  "surface-container-lowest": "var(--surface-container-lowest)",
  "surface-container-low":    "var(--surface-container-low)",
  "surface-container":        "var(--surface-container)",
  "surface-container-high":   "var(--surface-container-high)",
  "surface-container-highest":"var(--surface-container-highest)",
  "background":               "var(--background)",
  "on-surface":               "var(--on-surface)",
  "on-surface-variant":       "var(--on-surface-variant)",
  "on-background":            "var(--on-background)",
  "primary":                  "var(--primary)",
  "primary-container":        "var(--primary-container)",
  "primary-fixed":            "var(--primary-fixed)",
  "primary-fixed-dim":        "var(--primary-fixed-dim)",
  "on-primary":               "var(--on-primary)",
  "on-primary-container":     "var(--on-primary-container)",
  "secondary":                "var(--secondary)",
  "secondary-container":      "var(--secondary-container)",
  "secondary-fixed":          "var(--secondary-fixed)",
  "on-secondary":             "var(--on-secondary)",
  "on-secondary-container":   "var(--on-secondary-container)",
  "tertiary":                 "var(--tertiary)",
  "tertiary-container":       "var(--tertiary-container)",
  "on-tertiary":              "var(--on-tertiary)",
  "error":                    "var(--error)",
  "error-container":          "var(--error-container)",
  "on-error":                 "var(--on-error)",
  "on-error-container":       "var(--on-error-container)",
  "outline":                  "var(--outline)",
  "outline-variant":          "var(--outline-variant)",
  "surface-tint":             "var(--surface-tint)",
  "surface-variant":          "var(--surface-variant)",
  "inverse-surface":          "var(--inverse-surface)",
  "inverse-on-surface":       "var(--inverse-on-surface)",
  "inverse-primary":          "var(--inverse-primary)",
},
borderRadius: {
  DEFAULT: "1rem",
  lg: "2rem",
  xl: "3rem",
  full: "9999px",
},
fontFamily: {
  headline: ["Inter", "system-ui", "sans-serif"],
  body: ["Inter", "system-ui", "sans-serif"],
  label: ["Inter", "system-ui", "sans-serif"],
},
```

### Theme Switching

```typescript
// Toggle via class + localStorage + system preference
// Light is default. Dark activated by:
// 1. User toggle → adds .dark class to <html>, saves to localStorage
// 2. System preference → @media (prefers-color-scheme: dark) as fallback
```

---

## 3. Surface Philosophy

### The "No-Line" Rule

**Lines are a sign of structural weakness.** Do NOT use `1px solid` borders to separate sections. Layout boundaries are defined through background color shifts.

| Use case | Solution |
|----------|----------|
| Section separation | Background color shift (e.g., `surface` → `surface-container-low`) |
| Card on background | White card (`surface-container-lowest`) on tinted background (`surface-container-low`) |
| List item separation | Vertical spacing (`gap-6`) or subtle background alternation |
| Input field boundary | No border — use `surface-container-high` background |
| Structural edge needed | Ghost border: `outline-variant` at **15% opacity** max |

### Surface Hierarchy

```
Level 0 (Canvas):    var(--background)           — #F5F5F7 light / #121317 dark
Level 1 (Page):      var(--surface)              — #faf8fe / #121317
Level 2 (Sections):  var(--surface-container-low) — #f4f3f8 / #1a1b1f
Level 3 (Cards):     var(--surface-container-lowest) — #ffffff / #0d0e12
Level 4 (Elevated):  var(--surface-container-highest) — #e3e2e7 / #343539
```

### Glass & Gradient

**Glassmorphism** — used for floating panels, modals, AI assistant, command palette:

```css
.glass-card {
  background: rgba(255, 255, 255, 0.72);   /* light */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

/* Dark variant */
.dark .glass-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
```

**Mesh Gradient** — atmospheric background on login, hero sections:

```css
.mesh-gradient {
  background-color: var(--surface);
  background-image:
    radial-gradient(at 0% 0%, rgba(0, 113, 227, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 0%, rgba(74, 71, 210, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 100%, rgba(0, 113, 227, 0.10) 0px, transparent 50%),
    radial-gradient(at 0% 100%, rgba(74, 71, 210, 0.10) 0px, transparent 50%);
}
```

**AI Halo** — subtle radial glow behind AI assistant panels:

```css
.ai-halo {
  background: radial-gradient(
    circle at center,
    rgba(74, 71, 210, 0.08) 0%,
    rgba(255, 255, 255, 0) 70%
  );
}
```

**Atmospheric Blobs** — decorative blurred circles for depth:

```html
<!-- Top glow -->
<div class="fixed top-[-10%] left-[20%] w-[600px] h-[600px] bg-secondary/10 rounded-full blur-[120px] pointer-events-none" />
<!-- Bottom accent -->
<div class="fixed bottom-[-10%] left-[-10%] w-[300px] h-[300px] bg-primary opacity-[0.03] blur-[100px] rounded-full pointer-events-none" />
```

---

## 4. Typography

**Inter** is the sole font family, styled to mimic SF Pro's editorial character.

| Role | Size | Weight | Letter-spacing | Line-height | Usage |
|------|------|--------|----------------|-------------|-------|
| Display-LG | 56-80px | 800 (extrabold) | -0.03em | 1.1 | Hero statements, landing headlines |
| Headline-MD | 28px (1.75rem) | 700 (bold) | -0.02em | 1.2 | Section headers |
| Title-LG | 22px (1.375rem) | 700 | -0.01em | 1.3 | Card titles, modal headers |
| Title-MD | 18-20px | 600 (semibold) | tight | 1.4 | Subsection titles |
| Body-LG | 17px (1.0625rem) | 400 | normal | 1.47 | Long-form content, grant descriptions |
| Body-MD | 15px | 400 | normal | 1.6 | Standard UI text, chat messages |
| Label-LG | 13px | 700 (bold) | 0.05em (widest) | 1 | Uppercase labels, metadata |
| Label-SM | 10-11px | 700 | 0.1em | 1 | Timestamps, subtle metadata |

### Text Color

- **Primary text:** `on-surface` (#1a1b1f light / #e3e2e7 dark) — never pure black
- **Secondary text:** `on-surface-variant` (#414753 light / #c1c6d6 dark) — metadata, descriptions
- **Muted text:** `outline` (#717785 light / #8b919f dark) — timestamps, footnotes
- **Link/accent text:** `primary` or `primary-container` (#0071e3) — interactive elements

### Headline Rules

- Display-LG needs **at least 96px** clearance from the nearest element
- Hero headings must never be crowded — add 20px more padding if it feels "finished"
- Use `tracking-tighter` (-0.03em) for display and headline sizes

---

## 5. Elevation & Depth

### The Layering Principle

Do NOT use drop shadows for static elements. Achieve lift by stacking surface tiers:
- A white card (`surface-container-lowest`) on a tinted background (`surface-container-low`) creates natural lift.

### Ambient Shadows

For floating elements (hover states, modals, dropdowns):

```css
box-shadow: 0 20px 40px rgba(0, 0, 0, 0.04);
```

- Shadow tinted with `on-surface` color, never neutral grey
- 4% opacity for subtle elements, 8% max for prominent modals

### Ghost Border Fallback

When a container sits on an identical color background:

```css
border: 1px solid rgba(193, 198, 214, 0.15);  /* outline-variant at 15% */
```

- **15% opacity** maximum for structural definition
- **10%** for input field ghost borders (resting state)
- **20%** for input field focus state

---

## 6. Components

### Buttons

| Type | Background | Text | Radius | Shadow | Hover |
|------|-----------|------|--------|--------|-------|
| Primary | `primary-container` (#0071e3) | `on-primary` (white) | `full` (pill) | none | `translateY(-1px)`, darken to `primary` |
| Secondary | transparent | `primary` | `full` | none | `bg-primary-fixed` |
| Ghost | transparent | `on-surface-variant` | `full` | none | `bg-surface-container-high` |

```html
<!-- Primary button -->
<button class="bg-primary-container text-on-primary font-bold rounded-full px-8 py-4
               hover:bg-primary hover:-translate-y-[1px] transition-all duration-250
               active:scale-[0.98]">
  Send Magic Link
</button>

<!-- Secondary button -->
<button class="text-primary font-bold rounded-full px-6 py-3
               hover:bg-primary-fixed transition-all duration-250">
  Save Draft
</button>
```

### Cards

```html
<!-- Standard card -->
<div class="bg-surface-container-lowest rounded-lg p-8
            shadow-[0_20px_40px_rgba(0,0,0,0.04)]">
  <!-- No dividers. Use gap-6 for content separation -->
</div>

<!-- Glass card (floating, AI, modals) -->
<div class="glass-card rounded-lg p-8
            shadow-[0_20px_40px_rgba(0,0,0,0.04)]
            border border-white/20">
</div>
```

- Corner radius: `rounded` (1rem default), `rounded-lg` (2rem) for large cards
- No internal divider lines — use `gap-6` or `space-y-6` for content separation

### Input Fields

```html
<input class="w-full px-5 py-4 bg-surface-container-high/50 border-none rounded-md
              focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest
              transition-all duration-200 text-on-surface placeholder:text-outline
              outline-none" />
```

- Resting: subtle background (`surface-container-high` at 50%), no border
- Focus: ring glow (`primary` at 20% opacity), background shifts to white

### Sidebar (The Navigator)

```
Width:    240px expanded / 64px collapsed
Background: var(--background) (#F5F5F7)
Active item: bg-surface-container-highest, text-primary-container, rounded-full
Hover:    bg-surface-container-highest, translateY(-1px)
Icon:     Material Symbols Outlined, 20px
Storage:  Progress bar at bottom (primary fill on surface-container-highest track)
```

### Top Navigation Bar

```css
background: rgba(255, 255, 255, 0.72);  /* glass */
backdrop-filter: blur(20px);
box-shadow: 0 20px 40px rgba(0, 0, 0, 0.04);
height: 64px;
position: fixed;
z-index: 50;
```

### Status Chips

| Status | Border | Text | Background |
|--------|--------|------|------------|
| Draft | `outline` (#717785) | `outline` | transparent |
| In Progress | `primary` | `primary` | `primary/10` |
| Submitted | `tertiary` (#ffb95f dark / yellow-400 light) | amber | amber/10 |
| Approved | `secondary` (#4ae176 dark / green) | green | green/10 |
| Rejected | `error` | `error` | `error/10` |
| Provisional | `yellow-400` border-2 | `yellow-700` | `yellow-50` |

### AI Assistant (Split Panel)

```
Layout:   55% chat (left) + 45% canvas (right)
Chat bg:  surface-container-low with ai-halo overlay
Canvas bg: surface-container-lowest
AI bubbles: glass-card with rounded-tl-none
User bubbles: bg-primary-container text-white rounded-full
Input:    Full-width, rounded-full, white bg, send button as primary pill
Progress: Horizontal stepper (Analysis → Strategy → Drafting → Review)
```

### Command Palette (Cmd+K)

```
Trigger:  Cmd+K / Ctrl+K
Overlay:  bg-black/40, backdrop-blur
Card:     glass-card, rounded-lg, max-w-2xl, centered
Input:    Full-width search with material icon prefix
Results:  Categorized (Pages, Recent Projects) with keyboard navigation
```

### Notifications Panel

```
Trigger:  Bell icon click
Position: Dropdown, top-right anchored
Card:     glass-card, rounded-lg, max-w-md
Items:    Icon + title + timestamp, hover bg-surface-container-high
Special:  "AI Curator Advisory" highlighted card at bottom
```

---

## 7. Animation & Transitions

### Page Transitions

```css
.fade-in-up {
  animation: fadeInUp 0.6s ease-out forwards;
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### Interactive Elements

| Element | Transition | Effect |
|---------|-----------|--------|
| Buttons | `duration-250 ease-out` | `translateY(-1px)` on hover, `scale(0.98)` on active |
| Cards | `duration-300 ease-out` | `translateY(-2px)` + shadow increase on hover |
| Nav items | `duration-300` | Background color shift + `translateY(-1px)` |
| Inputs | `duration-200` | Ring glow + background shift on focus |
| Sidebar | `duration-300 ease-out` | Width transition (64px ↔ 240px) |

### Micro-interactions

- **AI pulse:** `animate-pulse` on sync icon during generation
- **Progress rings:** SVG stroke-dasharray animation for project completion
- **Selection highlight:** `selection:bg-primary-fixed selection:text-on-primary-fixed`

---

## 8. Layout Patterns

### Page Structure

```
┌──────────────────────────────────────────────┐
│ [Sidebar 240px] │ [Main Content]             │
│                 │ ┌─[Top Nav — fixed, glass]─┐│
│  Logo           │ │ Date  [Search] [Bell][?] ││
│  Nav items      │ ├─────────────────────────┤│
│  ...            │ │                          ││
│                 │ │  pt-24 (below fixed nav) ││
│                 │ │  px-12 lg:px-24          ││
│                 │ │  max-w-[1400px] mx-auto  ││
│                 │ │                          ││
│  Storage bar    │ │                          ││
│  User profile   │ └──────────────────────────┘│
└──────────────────────────────────────────────┘
```

### Content Max Width

- Page content: `max-w-[1400px]`
- Top nav: `max-w-[1440px]`
- Login card: `max-w-md` (28rem)
- Command palette: `max-w-2xl`

### Spacing Scale

- Sections: `mb-24` (6rem) between major sections
- Cards: `gap-6` (1.5rem) in grids
- Card padding: `p-8` (2rem) standard, `p-10` (2.5rem) for hero cards
- Content spacing: `space-y-6` (1.5rem) within cards
- Hero clearance: `96px` minimum from nearest element

### Responsive Breakpoints

```
Mobile:  < 768px  — Sidebar hidden (hamburger), single column, px-6
Tablet:  768px+   — Sidebar visible, 2-col where applicable, px-12
Desktop: 1024px+  — Full layout, px-24, all features visible
```

---

## 9. Icons

**Material Symbols Outlined** — variable font with customizable fill, weight, grade, and optical size.

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1" rel="stylesheet" />
```

Default settings: `font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24`

- Active/selected icons use `FILL 1`
- Icon size: `text-xl` (20px) for nav, `text-sm` (14px) for inline
- Color: `text-on-surface-variant` default, `text-primary` on active/hover

### Key Icons by Screen

| Page | Icon | Name |
|------|------|------|
| Home | `home` | Home |
| Projects | `folder_open` | Projects |
| Funding | `euro_symbol` | Funding Calls |
| Files | `description` | Files |
| AI Assistant | `smart_toy` | AI Assistant |
| Settings | `settings` | Settings |
| Notifications | `notifications` | Notifications |
| Search | `search` | Search/Command Palette |
| Logo | `account_balance` | FondEU brand mark |
| AI sparkle | `auto_awesome` | AI activity indicator |

---

## 10. Authentication Flow

### OAuth-Only + Magic Link

**No password storage.** Authentication uses:

1. **OAuth Providers:** Google, Microsoft, Facebook, Apple
2. **Magic Link:** Email-based passwordless sign-in (NextAuth Email provider)

### Login Screen (Reference: `login_fondeu/`)

```
┌─────────────────────────────────────┐
│         glass-card on mesh-gradient  │
│                                      │
│           FondEU                     │
│      The Digital Curator             │
│                                      │
│  ┌─[Continue with Google]──────────┐ │
│  ┌─[Continue with Microsoft]───────┐ │
│  ┌─[Continue with Facebook]────────┐ │
│  ┌─[Continue with Apple]───────────┐ │
│                                      │
│  ──────── or ────────               │
│                                      │
│  Sign in with Magic Link             │
│  ┌─[Email address]────────────────┐ │
│  ┌─[Send Magic Link]─────────────┐ │
│  We'll send you a secure sign-in   │
│  link. No password needed.          │
│                                      │
└─────────────────────────────────────┘
```

OAuth buttons: Full-width, left-aligned icon + text, `surface-container-lowest` bg, ghost border at 10%.

### Onboarding Flow (First Sign-In Only)

**Step 1 — Profile** (Reference: `welcome_fondeu/`):
- Name, Organization, Organization Type (dropdown), Role, Preferred Language
- Primary CTA: "Continue to Interests"

**Step 2 — Interests** (Reference: `your_interests_fondeu/`):
- Topic chips: Digitalization, Green Energy, Infrastructure, Social Inclusion, Agriculture, Research & Innovation, Healthcare, Education, SME Development, Urban Development
- Chip style: `surface-container-high` default, `primary-container text-white` selected
- Primary CTA: "Start Exploring"
- Skip option: "Skip for Now" ghost link

### Pages Removed

- ~~Registration page~~ (first OAuth sign-in auto-creates account)
- ~~Forgot password~~ (no passwords to forget)
- ~~Reset password~~ (no passwords to reset)

---

## 11. Screen Reference

All screens are in `docs/stitch-2/stitch/`. Each has `screen.png` (pixel reference) + `code.html` (exact Tailwind classes).

| # | Directory | Page | Route | Key Features |
|---|-----------|------|-------|--------------|
| 1 | `login_fondeu/` | Login | `/[locale]/autentificare` | OAuth stack + Magic Link, mesh gradient bg |
| 2 | `welcome_fondeu/` | Onboarding Step 1 | `/[locale]/bun-venit` | Profile form (name, org, type, role, lang) |
| 3 | `your_interests_fondeu/` | Onboarding Step 2 | `/[locale]/interese` | Topic chip grid, skip option |
| 4 | `home_fondeu/` | Dashboard | `/[locale]/panou` | Editorial hero, glass search, quick starts, activity feed |
| 5 | `projects_fondeu/` | Projects | `/[locale]/proiecte` | Project cards with progress rings, archive section |
| 6 | `project_detail_fondeu/` | Project Detail | `/[locale]/proiecte/[id]` | Tabs (Overview/Docs/Tasks/Timeline), progress ring, team |
| 7 | `funding_calls_fondeu/` | Funding Calls | `/[locale]/finantari` | Card grid, program badges, "AI Smart Match" CTA |
| 8 | `ai_assistant_fondeu/` | AI Assistant | `/[locale]/asistent-ai` | Split panel: chat 55% + canvas 45%, step progress |
| 9 | `files_fondeu/` | Files | `/[locale]/documente` | Categorized sections, "Smart Templates" card |
| 10 | `settings_fondeu/` | Settings | `/[locale]/setari` | 2x2 card grid (Profile, AI, Subscription, GDPR) |
| 11 | `404_not_found_fondeu/` | 404 Error | `not-found` | Full-page 404, helper links |
| 12 | `notifications_fondeu/` | Notifications | Dropdown overlay | Notification items + "AI Curator Advisory" card |
| 13 | `command_palette_fondeu/` | Command Palette | Modal overlay (Cmd+K) | Search + categorized results |
| 14 | `home page dark-mode/` | Dashboard (Dark) | — | Dark variant reference for token validation |
| 15 | `login_fondeu_updated/` | Login variant | — | Alternative login layout (reference only) |

**Superseded screens** (do not implement):
- `login_register_fondeu/`, `login_register_fondeu_1/`, `login_register_fondeu_2/` — old login/register variants with password fields

---

## 12. Do's and Don'ts

### Do

- Use massive whitespace. If a section feels "finished," add 20px more padding.
- Use asymmetrical layouts (e.g., 2/3 main + 1/3 sidebar offset lower on Y-axis).
- Use `fadeIn + translateY(20px→0)` for all page transitions.
- Reference `screen.png` files for pixel-accurate implementation.
- Extract exact Tailwind classes from `code.html` files.
- Build light theme first, dark adapts automatically via CSS custom properties.
- Use `prefers-color-scheme` media query as system-level dark mode detection.

### Don't

- Don't use `1px solid` borders to separate sections — use background color shifts.
- Don't use high-saturation backgrounds — always "gallery white" (#F5F5F7).
- Don't use Material Design shadows — they're too heavy for this aesthetic.
- Don't crowd the hero — Display-LG needs 96px clearance.
- Don't use pure black (#000000) — use `on-surface` token.
- Don't default to dark theme — light is primary, dark is secondary toggle.
- Don't add password-based authentication — OAuth + Magic Link only.
- Don't create registration, forgot-password, or reset-password pages.
