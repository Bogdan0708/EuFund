# FondEU UI Redesign V2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark-glass UI with an Apple-style light editorial design ("The Digital Curator"), implementing all 15 Stitch-designed screens, switching to OAuth-only auth with 2-step onboarding.

**Architecture:** Complete frontend rewrite using CSS custom properties for light/dark theming, Material Symbols icons, and Stitch screen references as pixel-accurate targets. Auth backend simplified to OAuth + Magic Link only (no password storage). New onboarding flow after first sign-in. Routes renamed to Romanian per CLAUDE.md conventions.

**Tech Stack:** Next.js 14 App Router, Tailwind CSS 3.4, CSS custom properties, Material Symbols Outlined, Inter font, NextAuth v5 (OAuth + Email), Drizzle ORM, next-intl (ro/en)

---

## File Structure

### New Files
```
app/src/
├── styles/
│   └── tokens.css                    # Unified CSS custom properties (light + dark)
├── app/[locale]/
│   ├── (auth)/
│   │   ├── bun-venit/page.tsx        # Onboarding step 1 (profile)
│   │   └── interese/page.tsx         # Onboarding step 2 (interests)
│   └── (dashboard)/                  # NEW route group (replaces (app))
│       ├── layout.tsx                # Protected layout with AppShell
│       ├── panou/page.tsx            # Dashboard home
│       ├── proiecte/
│       │   ├── page.tsx              # Projects list
│       │   └── [id]/page.tsx         # Project detail
│       ├── finantari/page.tsx        # Funding calls
│       ├── asistent-ai/page.tsx      # AI Assistant
│       ├── documente/page.tsx        # Files
│       └── setari/page.tsx           # Settings
├── components/
│   ├── ui/
│   │   ├── ds-button.tsx             # Design system button
│   │   ├── ds-card.tsx               # Design system card (standard + glass)
│   │   ├── ds-input.tsx              # Design system input
│   │   ├── ds-chip.tsx               # Status chip / topic chip
│   │   └── ds-icon.tsx               # Material Symbols wrapper
│   └── layout/
│       ├── Sidebar.tsx               # REWRITE
│       ├── TopNav.tsx                # NEW (glass fixed header)
│       ├── AppShell.tsx              # REWRITE
│       ├── MobileNav.tsx             # REWRITE
│       ├── CommandPalette.tsx        # REWRITE
│       └── NotificationsPanel.tsx    # NEW
├── lib/
│   └── theme.ts                      # Theme toggle (light/dark/system)
└── api/
    └── auth/
        └── onboarding/route.ts       # Onboarding API endpoint
```

### Modified Files
```
app/tailwind.config.ts                # Complete rewrite for Stitch tokens
app/src/app/globals.css               # Replace imports, base styles
app/src/app/layout.tsx                # Add Material Symbols font link
app/src/app/[locale]/layout.tsx       # Update font, add theme provider
app/src/app/[locale]/not-found.tsx    # Rewrite for light theme
app/src/lib/auth/index.ts             # Add Apple provider
app/src/lib/db/schema.ts              # Add onboarding fields to users
app/src/middleware.ts                  # Update routes, add onboarding gate
```

### Files to Delete
```
app/src/styles/glass-tokens.css       # Replaced by tokens.css
app/src/styles/design-tokens.css      # Replaced by tokens.css
app/src/components/glass/*            # All 8 glass components (dark theme)
app/src/app/[locale]/(auth)/inregistrare/     # Registration page (no passwords)
app/src/app/[locale]/(auth)/resetare-parola/  # Password reset (no passwords)
app/src/app/api/auth/register/        # Register API (no passwords)
app/src/app/api/auth/forgot-password/ # Forgot password API (no passwords)
app/src/app/api/auth/reset-password/  # Reset password API (no passwords)
app/src/app/[locale]/(app)/           # Old route group (replaced by (dashboard))
```

---

## Dependency Graph

```
Task 1 (Tokens + Tailwind) ─────┬──→ Task 3 (Auth backend)
                                 │     ├──→ Task 4 (Login page)
                                 │     └──→ Task 5 (Onboarding)
Task 2 (Fonts + Icons) ─────────┤
                                 ├──→ Task 6 (Shared components)
                                 │     └──→ Tasks 10-16 (All pages)
                                 ├──→ Task 7 (Sidebar)
                                 ├──→ Task 8 (Top nav)
                                 │     └──→ Task 17 (Notifications)
                                 └──→ Task 9 (App shell + routing)
                                       └──→ Tasks 10-16 (All pages)

Tasks 10-16 (Pages) ─── all parallel after Tasks 6, 9
Tasks 17-18 (Overlays) ─ after Tasks 6, 8
Task 19 (404) ─────────── after Task 6
Task 20 (Dark theme) ──── after all pages
Task 21 (Cleanup) ─────── last
```

**Parallel groups:**
- Group A: Tasks 3-5 (auth) — parallel with Group B
- Group B: Tasks 7-9 (layout) — parallel with Group A
- Group C: Tasks 10-16 (pages) — all parallel after Groups A+B + Task 6
- Group D: Tasks 17-19 (overlays + 404) — parallel after Task 6

---

## Task 1: Design Tokens & Tailwind Config

**Files:**
- Create: `app/src/styles/tokens.css`
- Modify: `app/tailwind.config.ts`
- Modify: `app/src/app/globals.css`

**Design reference:** `docs/DESIGN.md` §2 (Color System) and Stitch HTML color tokens

- [ ] **Step 1: Create unified tokens.css**

```css
/* app/src/styles/tokens.css */
:root {
  /* Surface hierarchy */
  --surface: #faf8fe;
  --surface-dim: #dad9df;
  --surface-bright: #faf8fe;
  --surface-container-lowest: #ffffff;
  --surface-container-low: #f4f3f8;
  --surface-container: #eeedf3;
  --surface-container-high: #e9e7ed;
  --surface-container-highest: #e3e2e7;
  --background: #F5F5F7;

  --on-surface: #1a1b1f;
  --on-surface-variant: #414753;
  --on-background: #1a1b1f;

  --primary: #0059b5;
  --primary-container: #0071e3;
  --primary-fixed: #d7e2ff;
  --primary-fixed-dim: #abc7ff;
  --on-primary: #ffffff;
  --on-primary-container: #fcfbff;
  --on-primary-fixed: #001b3f;

  --secondary: #4a47d2;
  --secondary-container: #6462ec;
  --secondary-fixed: #e2dfff;
  --secondary-fixed-dim: #c2c1ff;
  --on-secondary: #ffffff;
  --on-secondary-container: #fffbff;

  --tertiary: #00637f;
  --tertiary-container: #007da1;
  --on-tertiary: #ffffff;

  --error: #ba1a1a;
  --error-container: #ffdad6;
  --on-error: #ffffff;
  --on-error-container: #93000a;

  --outline: #717785;
  --outline-variant: #c1c6d6;
  --surface-tint: #005cbb;
  --surface-variant: #e3e2e7;
  --inverse-surface: #2f3034;
  --inverse-on-surface: #f1f0f5;
  --inverse-primary: #abc7ff;
}

[data-theme="dark"] {
  --surface: #121317;
  --surface-dim: #121317;
  --surface-bright: #38393d;
  --surface-container-lowest: #0d0e12;
  --surface-container-low: #1a1b1f;
  --surface-container: #1e1f23;
  --surface-container-high: #292a2e;
  --surface-container-highest: #343539;
  --background: #121317;

  --on-surface: #e3e2e7;
  --on-surface-variant: #c1c6d6;
  --on-background: #e3e2e7;

  --primary: #abc7ff;
  --primary-container: #0071e3;
  --primary-fixed: #d7e2ff;
  --primary-fixed-dim: #abc7ff;
  --on-primary: #002f66;
  --on-primary-container: #fcfbff;

  --secondary: #c2c1ff;
  --secondary-container: #3630bf;
  --on-secondary: #1800a7;
  --on-secondary-container: #b1b1ff;

  --tertiary: #68d3ff;
  --tertiary-container: #007da1;

  --error: #ffb4ab;
  --error-container: #93000a;
  --on-error: #690005;
  --on-error-container: #ffdad6;

  --outline: #8b919f;
  --outline-variant: #414753;
  --surface-tint: #abc7ff;
  --surface-variant: #343539;
  --inverse-surface: #e3e2e7;
  --inverse-on-surface: #2f3034;
  --inverse-primary: #005cbb;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: #121317;
    --surface-dim: #121317;
    --surface-bright: #38393d;
    --surface-container-lowest: #0d0e12;
    --surface-container-low: #1a1b1f;
    --surface-container: #1e1f23;
    --surface-container-high: #292a2e;
    --surface-container-highest: #343539;
    --background: #121317;
    --on-surface: #e3e2e7;
    --on-surface-variant: #c1c6d6;
    --on-background: #e3e2e7;
    --primary: #abc7ff;
    --primary-container: #0071e3;
    --on-primary: #002f66;
    --on-primary-container: #fcfbff;
    --secondary: #c2c1ff;
    --secondary-container: #3630bf;
    --on-secondary: #1800a7;
    --on-secondary-container: #b1b1ff;
    --tertiary: #68d3ff;
    --error: #ffb4ab;
    --error-container: #93000a;
    --on-error: #690005;
    --on-error-container: #ffdad6;
    --outline: #8b919f;
    --outline-variant: #414753;
    --surface-tint: #abc7ff;
    --surface-variant: #343539;
    --tertiary-container: #007da1;
    --inverse-surface: #e3e2e7;
    --inverse-on-surface: #2f3034;
    --inverse-primary: #005cbb;
  }
}
```

- [ ] **Step 2: Rewrite tailwind.config.ts**

Replace the entire theme colors section with CSS custom property references. Use `darkMode: ['variant', '[data-theme="dark"] &']` so Tailwind's `dark:` prefix works with our `data-theme` attribute (not the `.dark` class). This must be consistent with `tokens.css` which uses `[data-theme="dark"]` and `theme.ts` which sets `data-theme` on `<html>`.

```typescript
// app/tailwind.config.ts
import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['variant', '[data-theme="dark"] &'],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--surface)',
          dim: 'var(--surface-dim)',
          bright: 'var(--surface-bright)',
          'container-lowest': 'var(--surface-container-lowest)',
          'container-low': 'var(--surface-container-low)',
          container: 'var(--surface-container)',
          'container-high': 'var(--surface-container-high)',
          'container-highest': 'var(--surface-container-highest)',
          variant: 'var(--surface-variant)',
          tint: 'var(--surface-tint)',
        },
        background: 'var(--background)',
        'on-surface': {
          DEFAULT: 'var(--on-surface)',
          variant: 'var(--on-surface-variant)',
        },
        'on-background': 'var(--on-background)',
        primary: {
          DEFAULT: 'var(--primary)',
          container: 'var(--primary-container)',
          fixed: 'var(--primary-fixed)',
          'fixed-dim': 'var(--primary-fixed-dim)',
        },
        'on-primary': {
          DEFAULT: 'var(--on-primary)',
          container: 'var(--on-primary-container)',
          fixed: 'var(--on-primary-fixed)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          container: 'var(--secondary-container)',
          fixed: 'var(--secondary-fixed)',
          'fixed-dim': 'var(--secondary-fixed-dim)',
        },
        'on-secondary': {
          DEFAULT: 'var(--on-secondary)',
          container: 'var(--on-secondary-container)',
        },
        tertiary: {
          DEFAULT: 'var(--tertiary)',
          container: 'var(--tertiary-container)',
        },
        'on-tertiary': 'var(--on-tertiary)',
        error: {
          DEFAULT: 'var(--error)',
          container: 'var(--error-container)',
        },
        'on-error': {
          DEFAULT: 'var(--on-error)',
          container: 'var(--on-error-container)',
        },
        outline: {
          DEFAULT: 'var(--outline)',
          variant: 'var(--outline-variant)',
        },
        'inverse-surface': 'var(--inverse-surface)',
        'inverse-on-surface': 'var(--inverse-on-surface)',
        'inverse-primary': 'var(--inverse-primary)',
      },
      fontFamily: {
        headline: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        label: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '1rem',
        lg: '2rem',
        xl: '3rem',
        full: '9999px',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
```

- [ ] **Step 3: Rewrite globals.css**

```css
/* app/src/app/globals.css */
@import '../styles/tokens.css';   /* Path relative to app/src/app/globals.css */

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    background-color: var(--background);
    color: var(--on-surface);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  ::selection {
    background-color: var(--primary-fixed);
    color: var(--on-primary-fixed);
  }
}

@layer components {
  .glass-card {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(0, 0, 0, 0.06);
  }

  [data-theme="dark"] .glass-card {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .mesh-gradient {
    background-color: var(--surface);
    background-image:
      radial-gradient(at 0% 0%, rgba(0, 113, 227, 0.15) 0px, transparent 50%),
      radial-gradient(at 100% 0%, rgba(74, 71, 210, 0.15) 0px, transparent 50%),
      radial-gradient(at 100% 100%, rgba(0, 113, 227, 0.10) 0px, transparent 50%),
      radial-gradient(at 0% 100%, rgba(74, 71, 210, 0.10) 0px, transparent 50%);
  }

  .ai-halo {
    background: radial-gradient(circle at center, rgba(74, 71, 210, 0.08) 0%, transparent 70%);
  }

  .fade-in-up {
    animation: fadeInUp 0.6s ease-out forwards;
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
}
```

**Note:** Verify `postcss-import` is installed/configured — `@import` in CSS requires it. If not present, add it to `postcss.config.js` or use Tailwind's `@import` support.

- [ ] **Step 4: Verify Tailwind compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tailwindcss --content './src/**/*.tsx' --output /dev/null`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css tailwind.config.ts src/app/globals.css
git commit -m "feat(design): replace design tokens with Stitch light/dark system"
```

---

## Task 2: Font & Icon Setup

**Files:**
- Modify: `app/src/app/layout.tsx`
- Modify: `app/src/app/[locale]/layout.tsx`
- Create: `app/src/components/ui/ds-icon.tsx`

**Design reference:** `docs/DESIGN.md` §9 (Icons)

- [ ] **Step 1: Add Material Symbols font to root layout**

In `app/src/app/layout.tsx`, add a `<link>` tag in the `<head>` for Material Symbols Outlined:

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
```

Keep the existing Inter font import. Remove JetBrains Mono from the main import if it's only needed for code blocks (keep it in tailwind config fontFamily.mono).

- [ ] **Step 2: Update locale layout body classes**

In `app/src/app/[locale]/layout.tsx`:
- Change body class from dark glass theme (`bg-[--bg-base]` etc.) to: `bg-background text-on-surface`
- Remove old glass CSS variable references
- Keep: `AuthSessionProvider`, `NextIntlClientProvider`, `CookieConsentBanner`, nonce

- [ ] **Step 3: Create ds-icon.tsx wrapper**

```tsx
// app/src/components/ui/ds-icon.tsx
interface IconProps {
  name: string;
  filled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = { sm: 'text-sm', md: 'text-xl', lg: 'text-3xl' };

export function Icon({ name, filled, size = 'md', className = '' }: IconProps) {
  return (
    <span
      className={`material-symbols-outlined ${sizeMap[size]} ${className}`}
      style={filled ? { fontVariationSettings: "'FILL' 1" } : undefined}
    >
      {name}
    </span>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/[locale]/layout.tsx src/components/ui/ds-icon.tsx
git commit -m "feat(design): add Material Symbols icons and update layout fonts"
```

---

## Task 3: Auth Backend — Remove Passwords, Add Apple Provider, Add Onboarding Schema

**Files:**
- Modify: `app/src/lib/auth/index.ts` — Add Apple provider
- Modify: `app/src/lib/db/schema.ts` — Add onboarding fields
- Create: `app/src/app/api/auth/onboarding/route.ts` — Onboarding API
- Modify: `app/src/middleware.ts` — Add onboarding redirect gate
- Delete: `app/src/app/api/auth/register/route.ts`
- Delete: `app/src/app/api/auth/forgot-password/` (if exists)
- Delete: `app/src/app/api/auth/reset-password/` (if exists)
- Delete: `app/src/app/[locale]/(auth)/inregistrare/`
- Delete: `app/src/app/[locale]/(auth)/resetare-parola/`
- Keep: `app/src/app/[locale]/verifica-email/` (still needed for Magic Link email verification)

**No Stitch reference — this is backend work.**

- [ ] **Step 1: Add Apple provider to auth config**

In `app/src/lib/auth/index.ts`, add:

```typescript
import Apple from 'next-auth/providers/apple';

// In the providers array, add:
Apple({
  clientId: process.env.APPLE_CLIENT_ID!,
  clientSecret: process.env.APPLE_CLIENT_SECRET!,
  allowDangerousEmailAccountLinking: true,
}),
```

**Apple Sign-In name handling:** Apple allows users to hide their name. The `users.fullName` column is `NOT NULL`. In the auth adapter (`app/src/lib/auth/adapter.ts`), ensure `createUser()` uses a fallback:
```typescript
fullName: user.name || user.email?.split('@')[0] || 'User',
```
This ensures the DB insert never fails. The onboarding flow (Step 1) lets users correct their name.

- [ ] **Step 2: Add onboarding fields to users table**

In `app/src/lib/db/schema.ts`, add to the `users` table:

```typescript
onboardingCompleted: boolean('onboarding_completed').default(false),
interests: text('interests').array(),  // e.g., ['digitalization', 'green_energy']
```

- [ ] **Step 3: Generate Drizzle migration**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run db:generate
```

- [ ] **Step 4: Create onboarding API route**

Uses `POST` (not PATCH) because it creates organizations — a POST-like operation.

```typescript
// app/src/app/api/auth/onboarding/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { users, organizations, orgMembers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';

const profileSchema = z.object({
  fullName: z.string().min(2).max(255),
  organizationName: z.string().min(2).max(500).optional(),
  organizationType: z.enum(['srl', 'sa', 'pfa', 'ong', 'uat', 'institutie_publica', 'altul']).optional(),
  preferredLang: z.enum(['ro', 'en']).optional(),
});

const interestsSchema = z.object({
  interests: z.array(z.string()).min(0).max(20),
});

export async function POST(request: NextRequest) {
  const locale = request.headers.get('x-locale') || 'ro';
  try {
    const session = await requireAuth();
    const body = await request.json();

    // Step 1: Profile update + optional org creation
    if (body.step === 'profile') {
      const data = profileSchema.parse(body);
      await db.transaction(async (tx) => {
        await tx.update(users)
          .set({
            fullName: data.fullName,
            preferredLang: data.preferredLang || 'ro',
            updatedAt: new Date(),
          })
          .where(eq(users.id, session.id));

        if (data.organizationName && data.organizationType) {
          const [org] = await tx.insert(organizations)
            .values({
              name: data.organizationName,
              orgType: data.organizationType,
            })
            .returning({ id: organizations.id });

          await tx.insert(orgMembers)
            .values({
              orgId: org.id,
              userId: session.id,
              role: 'admin',
            });

          logAudit({
            action: 'organization.created',
            userId: session.id,
            resourceType: 'organization',
            resourceId: org.id,
            details: { name: data.organizationName, orgType: data.organizationType },
          });
        }
      });
      return NextResponse.json({ success: true });
    }

    // Step 2: Interests + mark onboarding complete
    if (body.step === 'interests') {
      const data = interestsSchema.parse(body);
      await db.update(users)
        .set({
          interests: data.interests,
          onboardingCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, session.id));

      logAudit({
        action: 'user.onboarding_completed',
        userId: session.id,
        resourceType: 'user',
        resourceId: session.id,
        details: { interestCount: data.interests.length },
      });

      return NextResponse.json({ success: true });
    }

    return Errors.validation('step', 'Step must be "profile" or "interests"', 'Step must be "profile" or "interests"').toResponse(locale);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Errors.validation('body', 'Date invalide', 'Invalid data').toResponse(locale);
    }
    throw error;
  }
}
```

- [ ] **Step 5: Add onboarding gate to middleware**

In `app/src/middleware.ts`, after the email verification check (around line 191), add an onboarding check. If the user's `onboardingCompleted` is false, redirect to `/[locale]/bun-venit`. This requires reading the user from the edge session. Since the edge session may not have `onboardingCompleted`, add it to the JWT token claims in the auth config.

In `app/src/lib/auth/index.ts`, in the `jwt` callback, add:
```typescript
token.onboardingCompleted = dbUser?.onboardingCompleted ?? false;
```

In `app/src/lib/auth/edge.ts`, include `onboardingCompleted` in the EdgeSession type.

In `app/src/middleware.ts`, after email verification check:
```typescript
// Onboarding gate
const onboardingPaths = ['/bun-venit', '/interese'];
const isOnboardingPage = onboardingPaths.some(p => pathname.endsWith(p));
if (edgeSession && !edgeSession.onboardingCompleted && !isOnboardingPage && !isPublicPath && !isApiRoute) {
  return NextResponse.redirect(new URL(`/${locale}/bun-venit`, request.url));
}
```

- [ ] **Step 6: Delete password-related files**

Delete:
- `app/src/app/api/auth/register/route.ts` (and directory)
- `app/src/app/api/auth/forgot-password/` (if exists)
- `app/src/app/api/auth/reset-password/` (if exists)
- `app/src/app/[locale]/(auth)/inregistrare/` (registration page)
- `app/src/app/[locale]/(auth)/resetare-parola/` (password reset page)

Also remove `inregistrare` and `resetare-parola` from middleware's `publicPaths` array.

- [ ] **Step 7: Keep bcryptjs — still used by account deletion route**

Do NOT remove `bcryptjs` — `app/src/app/api/auth/account/route.ts` imports `compare` from `bcryptjs` for account deletion password verification. Existing users who signed up pre-OAuth may still have `passwordHash` values. Keep the dependency until the account route is updated to handle OAuth-only users (future task).

- [ ] **Step 8: Run typecheck**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run typecheck
```

- [ ] **Step 9: Commit**

Stage specific files (avoid `git add -A` per project conventions):
```bash
git add src/lib/auth/index.ts src/lib/auth/adapter.ts src/lib/auth/edge.ts \
       src/lib/db/schema.ts src/app/api/auth/onboarding/ src/middleware.ts \
       drizzle/
git rm -r src/app/api/auth/register/ src/app/[locale]/(auth)/inregistrare/ \
          src/app/[locale]/(auth)/resetare-parola/
# Also git rm forgot-password/reset-password dirs if they exist
git commit -m "feat(auth): switch to OAuth-only, add Apple provider, add onboarding schema"
```

---

## Task 4: Login Page Rewrite

**Files:**
- Modify: `app/src/app/[locale]/(auth)/autentificare/page.tsx`

**Stitch reference:** `docs/stitch-2/stitch/login_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch login HTML**

Read `docs/stitch-2/stitch/login_fondeu/code.html` to extract exact Tailwind classes and layout structure.

- [ ] **Step 2: Rewrite login page**

Replace the entire page with a new implementation matching the Stitch design:
- Full-page mesh gradient background
- Glass card centered (`max-w-md`)
- FondEU branding header (h1 + "The Digital Curator" subtitle)
- OAuth provider stack: Google, Microsoft, Facebook, Apple — each a full-width button with icon + text
- "or" divider
- Magic Link section: email input + "Send Magic Link" primary button + help text
- Footer with privacy/terms links
- Atmospheric blur blobs for depth

Key classes from Stitch HTML:
- Body: `font-body text-on-surface mesh-gradient min-h-screen flex flex-col items-center justify-center p-6`
- Card: `glass-card rounded-lg p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-white/20`
- OAuth buttons: `w-full flex items-center justify-start gap-4 px-6 py-4 bg-surface-container-lowest hover:bg-surface-container-low transition-all duration-250 rounded-md border border-outline-variant/10 text-on-surface font-medium hover:-translate-y-[1px]`
- Primary button: `w-full py-4 bg-primary-container hover:bg-primary text-on-primary font-bold rounded-md transition-all duration-250 active:scale-[0.98] hover:-translate-y-[1px]`
- Input: `w-full px-5 py-4 bg-surface-container-high/50 border-none rounded-md focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all duration-200 text-on-surface placeholder:text-outline outline-none`

For OAuth, use `signIn('google')`, `signIn('microsoft-entra-id')`, `signIn('facebook')`, `signIn('apple')` from next-auth/react.

For Magic Link, use `signIn('email', { email, redirect: false })` and show a success message.

Use `useTranslations('auth')` for i18n strings. Add the new translation keys to both `ro.json` and `en.json`.

- [ ] **Step 3: Add i18n keys**

Add to `app/src/messages/ro.json` and `en.json` under an `auth` namespace:
- `continueWithGoogle`, `continueWithMicrosoft`, `continueWithFacebook`, `continueWithApple`
- `orDivider` (="sau" / "or")
- `magicLinkTitle`, `magicLinkPlaceholder`, `magicLinkButton`, `magicLinkHelp`
- `magicLinkSent` (success message)

- [ ] **Step 4: Test manually**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run dev
```
Open `http://localhost:3000/ro/autentificare` — verify layout matches Stitch screen.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/(auth)/autentificare/ src/messages/
git commit -m "feat(auth): rewrite login page to Stitch light design"
```

---

## Task 5: Onboarding Flow — Welcome & Interests Pages

**Files:**
- Create: `app/src/app/[locale]/(auth)/bun-venit/page.tsx`
- Create: `app/src/app/[locale]/(auth)/interese/page.tsx`
- Modify: `app/src/messages/ro.json` — add onboarding i18n keys
- Modify: `app/src/messages/en.json` — add onboarding i18n keys

**Stitch references:**
- Step 1: `docs/stitch-2/stitch/welcome_fondeu/screen.png` + `code.html`
- Step 2: `docs/stitch-2/stitch/your_interests_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch onboarding HTMLs**

Read both `welcome_fondeu/code.html` and `your_interests_fondeu/code.html` to extract exact layout and classes.

- [ ] **Step 2: Create welcome page (bun-venit)**

Layout: Glass card centered on mesh gradient (same as login).
Form fields: Full name (pre-filled from OAuth), Organization name, Organization type (dropdown from orgTypeEnum values), Preferred language (ro/en toggle).
Primary CTA: "Continuă" → calls `POST /api/auth/onboarding` with `step: 'profile'`, then redirects to `/[locale]/interese`.

- [ ] **Step 3: Create interests page (interese)**

Layout: Glass card centered on mesh gradient.
Content: Heading + grid of topic chips.
Topics: `digitalization`, `green_energy`, `infrastructure`, `social_inclusion`, `agriculture`, `research_innovation`, `healthcare`, `education`, `sme_development`, `urban_development`
Chip style: `bg-surface-container-high` default, `bg-primary-container text-on-primary` when selected.
Primary CTA: "Începe explorarea" → calls `POST /api/auth/onboarding` with `step: 'interests'`, redirects to dashboard.
Skip: "Treci peste" ghost link → also calls API with empty interests array.

- [ ] **Step 4: Add i18n keys for onboarding**

Add to both `ro.json` and `en.json`:
- `onboarding.welcome.title`, `onboarding.welcome.subtitle`
- `onboarding.welcome.fullName`, `onboarding.welcome.organizationName`, etc.
- `onboarding.interests.title`, `onboarding.interests.subtitle`
- All topic names in both languages
- `onboarding.continue`, `onboarding.startExploring`, `onboarding.skip`

- [ ] **Step 5: Add onboarding paths to middleware publicPaths**

In `app/src/middleware.ts`, add `/bun-venit` and `/interese` to the paths that authenticated-but-not-onboarded users can access.

- [ ] **Step 6: Test manually**

Navigate through the flow: Login → Welcome → Interests → Dashboard.

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/(auth)/bun-venit/ src/app/[locale]/(auth)/interese/ src/messages/ src/middleware.ts
git commit -m "feat(onboarding): add 2-step onboarding flow (profile + interests)"
```

---

## Task 6: Shared Design System Components

**Files:**
- Create: `app/src/components/ui/ds-button.tsx`
- Create: `app/src/components/ui/ds-card.tsx`
- Create: `app/src/components/ui/ds-input.tsx`
- Create: `app/src/components/ui/ds-chip.tsx`

**Design reference:** `docs/DESIGN.md` §6 (Components)

- [ ] **Step 1: Create ds-button.tsx**

Variants: `primary`, `secondary`, `ghost`

```tsx
// Primary: bg-primary-container text-on-primary font-bold rounded-full
//          hover:bg-primary hover:-translate-y-[1px] active:scale-[0.98]
//          transition-all duration-250
// Secondary: text-primary font-bold rounded-full
//            hover:bg-primary-fixed transition-all duration-250
// Ghost: text-on-surface-variant font-medium rounded-full
//        hover:bg-surface-container-high transition-all duration-250
```

Sizes: `sm` (px-4 py-2 text-xs), `md` (px-6 py-3 text-sm), `lg` (px-8 py-4 text-base)

Use `class-variance-authority` (cva) for variant management — this is already installed.

- [ ] **Step 2: Create ds-card.tsx**

Variants: `standard`, `glass`

```tsx
// Standard: bg-surface-container-lowest rounded-lg p-8
//           shadow-[0_20px_40px_rgba(0,0,0,0.04)]
// Glass: glass-card rounded-lg p-8
//        shadow-[0_20px_40px_rgba(0,0,0,0.04)]
//        border border-white/20
```

- [ ] **Step 3: Create ds-input.tsx**

```tsx
// Base: w-full px-5 py-4 bg-surface-container-high/50 border-none rounded-md
//       focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest
//       transition-all duration-200 text-on-surface placeholder:text-outline
//       outline-none
```

Forward ref, support `label` prop, `error` state.

- [ ] **Step 4: Create ds-chip.tsx**

Variants: `default`, `selected`, `status`

```tsx
// Default: bg-surface-container-high text-on-surface-variant px-4 py-2 rounded-full
//          cursor-pointer hover:bg-surface-container-highest transition-all
// Selected: bg-primary-container text-on-primary px-4 py-2 rounded-full
// Status variants: draft (outline border), in-progress (primary), approved (green), etc.
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/ds-button.tsx src/components/ui/ds-card.tsx src/components/ui/ds-input.tsx src/components/ui/ds-chip.tsx
git commit -m "feat(design): add design system components (button, card, input, chip)"
```

---

## Task 7: Sidebar Rewrite

**Files:**
- Modify: `app/src/components/layout/Sidebar.tsx`
- Modify: `app/src/components/layout/SidebarItem.tsx`

**Stitch reference:** Sidebar from `docs/stitch-2/stitch/ai_assistant_fondeu/code.html` (lines 109-155) and `home_fondeu/code.html`

- [ ] **Step 1: Read Stitch sidebar HTML**

Read the sidebar sections from `ai_assistant_fondeu/code.html` and `home_fondeu/code.html` (if available) to extract exact layout.

- [ ] **Step 2: Rewrite Sidebar.tsx**

Key structure:
- `w-[240px]` expanded, transitions with `duration-300 ease-out`
- Background: `bg-background` (#F5F5F7)
- Logo: `w-10 h-10 bg-primary-container rounded-xl` with `account_balance` icon (filled)
- Title: "FondEU" (xl font-bold tracking-tighter) + "The Digital Curator" (10px uppercase tracking-widest)
- Nav items: `flex items-center gap-3 px-4 py-2 font-medium text-sm tracking-tight`
- Active: `bg-surface-container-highest text-primary-container rounded-full` (with filled icon)
- Hover: `hover:bg-surface-container-highest hover:-translate-y-[1px] transition-all duration-300`
- Icons: Material Symbols — `home`, `folder_open`, `euro_symbol`, `description`, `smart_toy`, `settings`
- Bottom: Storage progress bar + user profile avatar section

Nav items must use Romanian routes:
- Home → `/{locale}/panou`
- Projects → `/{locale}/proiecte`
- Funding Calls → `/{locale}/finantari`
- Files → `/{locale}/documente`
- AI Assistant → `/{locale}/asistent-ai`
- Settings → `/{locale}/setari`

Labels must use `useTranslations('nav')` for i18n.

- [ ] **Step 3: Update SidebarItem for new design**

Match the Stitch styling: icon + label, active state with primary color and filled icon, hover transition.

- [ ] **Step 4: Add nav i18n keys**

Add to `ro.json`/`en.json` under `nav`:
- `home`, `projects`, `fundingCalls`, `files`, `aiAssistant`, `settings`, `storage`

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Sidebar.tsx src/components/layout/SidebarItem.tsx src/messages/
git commit -m "feat(layout): rewrite sidebar to Stitch light design"
```

---

## Task 8: Top Navigation Bar

**Files:**
- Create: `app/src/components/layout/TopNav.tsx`

**Stitch reference:** Top nav from `docs/stitch-2/stitch/home page dark-mode/code.html` (lines 74-92)

- [ ] **Step 1: Create TopNav.tsx**

```
Fixed, full-width, z-50
Background: glass (bg-white/72 backdrop-blur-xl)
Shadow: 0 20px 40px rgba(0,0,0,0.04)
Height: 64px (h-16)
Layout: flex justify-between items-center px-8 max-w-[1440px] mx-auto
Left: Date display (text-on-surface-variant text-sm)
Right: Notification bell button + help button (w-10 h-10 rounded-full hover:bg-surface-container-high)
Mobile: Hamburger menu + "FondEU" title (hidden on md+)
```

Notification bell triggers NotificationsPanel (Task 17).

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/TopNav.tsx
git commit -m "feat(layout): add glass top navigation bar"
```

---

## Task 9: App Shell & Route Restructure

**Files:**
- Modify: `app/src/components/layout/AppShell.tsx`
- Create: `app/src/app/[locale]/(dashboard)/layout.tsx`
- Modify: `app/src/middleware.ts` — update route redirects
- Modify: `app/src/components/layout/MobileNav.tsx`

**This task restructures the route groups and combines layout components.**

- [ ] **Step 1: Create (dashboard) route group**

Create `app/src/app/[locale]/(dashboard)/layout.tsx` — this is the protected layout with AppShell. Move the auth check from the old `(app)/layout.tsx` here.

```tsx
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const session = await auth();
  if (!session?.user) {
    redirect(`/${params.locale}/autentificare`);
  }

  const userName = session.user.name || '';
  const userInitials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  return (
    <AppShell
      locale={params.locale}
      userName={userName}
      userInitials={userInitials}
      userImage={session.user.image}
    >
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 2: Rewrite AppShell.tsx**

Combine Sidebar + TopNav + content area:

```tsx
// Layout: flex h-screen
// Left: <Sidebar /> (hidden on mobile)
// Right: flex-1 flex flex-col overflow-hidden
//   Top: <TopNav />
//   Content: flex-1 overflow-y-auto pt-24 px-6 md:px-12 lg:px-24 max-w-[1400px] mx-auto
// Mobile: <MobileNav /> (visible on mobile only)
// Plus: <CommandPalette /> (modal overlay)
```

- [ ] **Step 3: Create empty page stubs in (dashboard)**

Create placeholder page.tsx files for all dashboard routes so the app compiles:
- `(dashboard)/panou/page.tsx` — `export default function Page() { return <div>Dashboard</div>; }`
- `(dashboard)/proiecte/page.tsx`
- `(dashboard)/proiecte/[id]/page.tsx`
- `(dashboard)/finantari/page.tsx`
- `(dashboard)/asistent-ai/page.tsx`
- `(dashboard)/documente/page.tsx`
- `(dashboard)/setari/page.tsx`

- [ ] **Step 4: Update middleware redirects**

The **existing** middleware redirects go Romanian→English (e.g., `/ro/proiecte` → `/ro/projects`). These must be **inverted** to English→Romanian since we're switching to Romanian routes:

```typescript
const routeRedirects: Record<string, string> = {
  '/projects': '/proiecte',
  '/calls': '/finantari',
  '/files': '/documente',
  '/ai': '/asistent-ai',
  '/settings': '/setari',
};
```

Also add a redirect from the root dashboard URL to `/panou`:
```typescript
// The old (app) group served the dashboard at /{locale}/
// Now it's at /{locale}/panou — add redirect
if (pathname === `/${locale}` || pathname === `/${locale}/`) {
  return NextResponse.redirect(new URL(`/${locale}/panou`, request.url));
}
```

Remove old redirects for `/panou` → `/`, `/proiecte` → `/projects`, `/finantari` → `/calls`.

Also update `publicPaths` to remove deleted pages (`inregistrare`, `resetare-parola`). Keep `verifica-email` (still needed for Magic Link).

- [ ] **Step 5: Rewrite MobileNav.tsx**

Bottom tab bar for mobile, matching sidebar nav items with Material Symbols icons.

- [ ] **Step 6: Delete old (app) route group**

Delete `app/src/app/[locale]/(app)/` and all its contents (old pages will be replaced by new ones in Tasks 10-16).

- [ ] **Step 7: Fix test imports that reference old paths**

Search for test files importing from the old `(app)` route group or old component paths:
```bash
grep -r '(app)' app/tests/ --include='*.ts' --include='*.tsx' -l
grep -r 'components/glass' app/tests/ --include='*.ts' --include='*.tsx' -l
```

Update imports to reference new paths. If tests import glass components, temporarily stub them or skip those tests (they'll be properly fixed in Task 21).

- [ ] **Step 8: Verify app compiles and routes work**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run build
```

- [ ] **Step 9: Commit**

Stage specific files:
```bash
git add src/components/layout/ src/app/[locale]/(dashboard)/ src/middleware.ts src/messages/
git rm -r src/app/[locale]/(app)/
git commit -m "feat(layout): restructure routes to Romanian names, rewrite AppShell"
```

---

## Task 10: Dashboard Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/panou/page.tsx`
- Modify: `app/src/components/landing/SmartLanding.tsx` (or rewrite)

**Stitch reference:** `docs/stitch-2/stitch/home_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch home HTML**

Read `docs/stitch-2/stitch/home_fondeu/code.html` for exact layout.

- [ ] **Step 2: Implement dashboard page**

Key sections from Stitch design:
1. **Greeting banner**: "Bună dimineața, [Name]" + subtitle about new matches
2. **Hero section**: Large editorial heading (text-5xl to text-7xl, font-extrabold, tracking-tighter), mesh gradient backdrop
3. **Glass search bar**: Full-width input with search icon, glass-card styling, rounded-full
4. **Quick start cards**: 3-4 action cards (New Project, Browse Calls, AI Assistant, Upload Document) — each with icon, title, description, subtle hover effect
5. **Activity feed**: Recent activity items with timestamps
6. **Matched calls preview**: Cards showing top AI-matched funding calls

Use existing data fetching patterns from the current SmartLanding component but apply new Stitch styling.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/panou/ src/components/landing/
git commit -m "feat(pages): rewrite dashboard to Stitch home design"
```

---

## Task 11: Projects Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/page.tsx`
- Modify: `app/src/components/projects/ProjectGrid.tsx` (or rewrite)
- Modify: `app/src/components/projects/ProjectCard.tsx` (or rewrite)

**Stitch reference:** `docs/stitch-2/stitch/projects_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch projects HTML**

Read `docs/stitch-2/stitch/projects_fondeu/code.html` for exact layout.

- [ ] **Step 2: Implement projects page**

Key features:
- Page header with "Projects" title + "Create New Project" primary button
- Project cards in responsive grid (3-col desktop, 2-col tablet, 1-col mobile)
- Each card: Title, status chip, progress ring (SVG circle), deadline, team avatars
- Archive section at bottom for completed/archived projects
- Empty state with illustration and CTA

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/proiecte/ src/components/projects/
git commit -m "feat(pages): rewrite projects page to Stitch design"
```

---

## Task 12: Project Detail Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`
- Modify: `app/src/components/projects/ProjectDetail.tsx` (or rewrite)

**Stitch reference:** `docs/stitch-2/stitch/project_detail_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch project detail HTML**

Read `docs/stitch-2/stitch/project_detail_fondeu/code.html`.

- [ ] **Step 2: Implement project detail page**

Key features:
- Tabbed interface (Overview / Documents / Tasks / Timeline) using Radix Tabs
- Overview: Progress ring (large SVG), project metadata, description, linked funding call
- Team section: Avatar list with role labels
- Documents tab: File cards matching files_fondeu design
- Tasks tab: Task list with assignees and status
- Timeline tab: Gantt-style or milestone view

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/proiecte/ src/components/projects/
git commit -m "feat(pages): rewrite project detail to Stitch design"
```

---

## Task 13: Funding Calls Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/finantari/page.tsx`
- Modify: `app/src/components/calls/CallCard.tsx` (or rewrite)
- Modify: `app/src/components/calls/CallFilters.tsx` (or rewrite)

**Stitch reference:** `docs/stitch-2/stitch/funding_calls_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch funding calls HTML**

Read `docs/stitch-2/stitch/funding_calls_fondeu/code.html`.

- [ ] **Step 2: Implement funding calls page**

Key features:
- Page header with search/filter bar
- "AI Smart Match" CTA card — highlighted card suggesting AI-matched calls
- Card grid: Each call card has program badge, title, deadline, status chip, "Verified" badge
- Filter chips for program type, status, deadline
- Pagination or infinite scroll

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/finantari/ src/components/calls/
git commit -m "feat(pages): rewrite funding calls to Stitch design"
```

---

## Task 14: AI Assistant Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`
- Modify: `app/src/components/workspace/WorkspaceLayout.tsx`
- Modify: `app/src/components/workspace/ChatPanel.tsx`
- Modify: `app/src/components/workspace/CanvasPanel.tsx`
- Modify: `app/src/components/workspace/MessageBubble.tsx`
- Modify: `app/src/components/workspace/StepProgressBar.tsx`

**Stitch reference:** `docs/stitch-2/stitch/ai_assistant_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch AI assistant HTML**

Read `docs/stitch-2/stitch/ai_assistant_fondeu/code.html` (already read above — reference lines 157-311).

- [ ] **Step 2: Implement AI assistant page**

Key layout: **Split panel — 55% chat (left) + 45% canvas (right)**

Left panel (chat):
- Background: `surface-container-low` with `ai-halo` overlay
- Header: AI avatar icon + "Grant Strategy Curator" title + context subtitle
- Chat bubbles: AI messages in `glass-card rounded-tl-none`, user messages in `bg-primary-container text-white rounded-full`
- Timestamps: `text-[10px] font-bold uppercase tracking-widest text-on-surface-variant opacity-40`
- AI generating state: pulsing sync icon + "Generating Strategy Draft..." label
- Input: Full-width rounded-full with attach + send buttons

Right panel (canvas):
- Background: `surface-container-lowest`
- Header: "Grant Proposal Canvas" + Save Draft / Review Final buttons
- Step progress: Horizontal stepper (Analysis → Strategy → Drafting → Review)
- Content: Proposal sections with "PROVISIONAL" status badges, content blocks, chart placeholders

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/asistent-ai/ src/components/workspace/
git commit -m "feat(pages): rewrite AI assistant to Stitch split-panel design"
```

---

## Task 15: Files Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/documente/page.tsx`
- Modify: `app/src/components/files/FileCard.tsx`
- Modify: `app/src/components/files/UploadZone.tsx`

**Stitch reference:** `docs/stitch-2/stitch/files_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch files HTML**

Read `docs/stitch-2/stitch/files_fondeu/code.html`.

- [ ] **Step 2: Implement files page**

Key features:
- Categorized file sections (Documents, Templates, Compliance)
- File cards with icon, name, size, date, status
- "Smart Templates" highlighted card — AI-powered template suggestions
- Upload zone with drag-drop
- Compliance documents section with verification badges

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/documente/ src/components/files/
git commit -m "feat(pages): rewrite files page to Stitch design"
```

---

## Task 16: Settings Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/setari/page.tsx`
- Modify: `app/src/components/settings/ProfileCard.tsx`
- Modify: `app/src/components/settings/AIPreferencesCard.tsx`
- Modify: `app/src/components/settings/SubscriptionCard.tsx`
- Modify: `app/src/components/settings/PrivacyCard.tsx`

**Stitch reference:** `docs/stitch-2/stitch/settings_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch settings HTML**

Read `docs/stitch-2/stitch/settings_fondeu/code.html`.

- [ ] **Step 2: Implement settings page**

Key layout: **2x2 card grid**
1. Profile card — avatar, name, email, organization, edit button
2. AI Preferences card — model selection, language, tone
3. Subscription card — current tier, usage stats, upgrade CTA
4. GDPR Privacy card — consent toggles, data export, account deletion

Cards use `bg-surface-container-lowest rounded-lg p-8 shadow-[0_20px_40px_rgba(0,0,0,0.04)]`.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(dashboard)/setari/ src/components/settings/
git commit -m "feat(pages): rewrite settings page to Stitch design"
```

---

## Task 17: Notifications Panel

**Files:**
- Create: `app/src/components/layout/NotificationsPanel.tsx`
- Modify: `app/src/components/layout/TopNav.tsx` — wire up bell icon

**Stitch reference:** `docs/stitch-2/stitch/notifications_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch notifications HTML**

Read `docs/stitch-2/stitch/notifications_fondeu/code.html`.

- [ ] **Step 2: Create NotificationsPanel.tsx**

Dropdown panel anchored to bell icon in TopNav:
- Glass card styling, `max-w-md`, rounded-lg
- Header: "Notifications" title + "Mark all read" link
- Notification items: Icon + title + description + timestamp
- Hover: `bg-surface-container-high`
- Unread indicator: primary dot
- "AI Curator Advisory" special card at bottom — highlighted with secondary color
- Click outside to close (use Radix Popover or custom click-outside handler)

- [ ] **Step 3: Wire to TopNav bell icon**

Add state management and toggle to TopNav component.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/NotificationsPanel.tsx src/components/layout/TopNav.tsx
git commit -m "feat(layout): add notifications dropdown panel"
```

---

## Task 18: Command Palette Rewrite

**Files:**
- Modify: `app/src/components/layout/CommandPalette.tsx`

**Stitch reference:** `docs/stitch-2/stitch/command_palette_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch command palette HTML**

Read `docs/stitch-2/stitch/command_palette_fondeu/code.html`.

- [ ] **Step 2: Rewrite CommandPalette.tsx**

Key structure:
- Overlay: `bg-black/40 backdrop-blur` full-screen
- Card: Glass card, `max-w-2xl`, centered vertically
- Search input: Full-width with search icon prefix, large text
- Results: Categorized sections (Pages, Recent Projects, Actions)
- Keyboard navigation: arrow keys + enter
- Trigger: Cmd+K / Ctrl+K (keep existing keybinding)

Style results to match Stitch: each item with icon + title + category label, hover highlight.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/CommandPalette.tsx
git commit -m "feat(layout): rewrite command palette to Stitch design"
```

---

## Task 19: 404 Page

**Files:**
- Modify: `app/src/app/[locale]/not-found.tsx`
- Modify: `app/src/app/not-found.tsx` (global)

**Stitch reference:** `docs/stitch-2/stitch/404_not_found_fondeu/screen.png` + `code.html`

- [ ] **Step 1: Read Stitch 404 HTML**

Read `docs/stitch-2/stitch/404_not_found_fondeu/code.html`.

- [ ] **Step 2: Rewrite not-found pages**

Full-page layout:
- Centered content on `background` with mesh gradient
- Large "404" display text
- Helpful message with link suggestions (Home, Projects, Funding Calls, AI Assistant)
- Light, editorial feel matching the rest of the design

Update both the global and locale-specific not-found pages.

- [ ] **Step 3: Commit**

```bash
git add src/app/not-found.tsx src/app/[locale]/not-found.tsx
git commit -m "feat(pages): rewrite 404 page to Stitch design"
```

---

## Task 20: Dark Theme Toggle

**Files:**
- Create: `app/src/lib/theme.ts`
- Modify: `app/src/app/[locale]/layout.tsx` — apply theme on load
- Modify: `app/src/components/settings/ProfileCard.tsx` — add theme toggle

**Design reference:** `docs/DESIGN.md` §2 (Theme Switching)

- [ ] **Step 1: Create theme utility**

```typescript
// app/src/lib/theme.ts
export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'fondeu:theme';

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', theme);
  }
}
```

- [ ] **Step 2: Apply theme on page load**

In the locale layout, add a script that runs before paint to prevent flash:

```tsx
<script dangerouslySetInnerHTML={{ __html: `
  (function() {
    var t = localStorage.getItem('fondeu:theme');
    if (t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
`}} />
```

Note: Use the CSP nonce for this inline script.

- [ ] **Step 3: Add theme toggle to settings**

In the Profile settings card, add a theme selector (Light / Dark / System) with radio or segmented control.

- [ ] **Step 4: Verify all pages look correct in dark mode**

Manually check each page in dark mode. Fix any elements using hardcoded light colors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme.ts src/app/[locale]/layout.tsx src/components/settings/
git commit -m "feat(theme): add light/dark/system theme toggle"
```

---

## Task 21: Cleanup — Remove Old Components & Dead Code

**Files:**
- Delete: `app/src/styles/glass-tokens.css`
- Delete: `app/src/styles/design-tokens.css`
- Delete: `app/src/components/glass/` (all files)
- Modify: Any files that import from `@/components/glass/` — update to use new ds-* components
- Modify: `app/package.json` — remove `lucide-react` if fully replaced by Material Symbols
- Modify: `app/src/components/ui/cookie-consent.tsx` — restyle for new design system
- Modify: CLAUDE.md — update routing conventions to reflect new structure

- [ ] **Step 1: Find all glass component imports**

```bash
grep -r 'components/glass' app/src/ --include='*.tsx' --include='*.ts' -l
```

Replace each import with the equivalent ds-* component or inline Tailwind classes.

Also restyle `cookie-consent.tsx` — it likely uses old glass/dark theme classes. Update to use the new design system tokens.

- [ ] **Step 2: Delete old token files and glass components**

```bash
rm app/src/styles/glass-tokens.css app/src/styles/design-tokens.css
rm -rf app/src/components/glass/
```

- [ ] **Step 3: Verify build**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run build
```

- [ ] **Step 4: Run existing tests**

```bash
cd /home/godja/Dev/EU-Funds/app && npm test
```

Fix any test failures caused by the redesign (mainly component import changes).

- [ ] **Step 5: Commit**

Stage specific deleted and modified files:
```bash
git rm -r src/styles/glass-tokens.css src/styles/design-tokens.css src/components/glass/
git add src/components/ui/cookie-consent.tsx
# Add any other files modified during import migration
git commit -m "chore: remove old glass components and design tokens"
```

---

## Testing Strategy

Each page task should include:
1. **Visual check** against Stitch `screen.png` — open side-by-side
2. **Responsive check** — test at mobile (375px), tablet (768px), desktop (1440px)
3. **i18n check** — verify both `/ro/` and `/en/` routes render correct translations
4. **Dark mode check** — after Task 20, verify all pages in both themes

Existing Vitest tests will need import path updates (glass → ds-*) in Task 21. API route tests should remain unaffected except for deleted routes (register, forgot-password).

## Key References

- **Unified design spec:** `docs/DESIGN.md`
- **Stitch screens:** `docs/stitch-2/stitch/` (15 directories, each with `screen.png` + `code.html`)
- **Color tokens:** `docs/DESIGN.md` §2 or any Stitch `code.html` tailwind config block
- **CLAUDE.md:** Project conventions, routing, error handling patterns
