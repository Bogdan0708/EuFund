# Design System Specification: Liquid-Glass Editorial

## 1. Overview & Creative North Star
**The Creative North Star: "The Ethereal Vault"**

This design system moves away from the rigid, boxy nature of traditional fintech and enterprise AI. Instead, it treats data as a fluid, premium asset. The aesthetic is "Liquid-Glass"—a high-contrast, dark-mode environment where information floats on layers of light and frost.

We break the "template" look by utilizing **intentional asymmetry** and **tonal depth**. Rather than using lines to box users in, we use breathing room and light refraction to guide the eye. This is an editorial approach to software: bold typography scales, generous whitespace (using our specific `20` and `24` spacing tokens), and a refusal to use standard borders.

---

## 2. Colors & Surface Logic

Our palette is rooted in a "Near-Black" foundation, designed to make the accent colors and "glass" panels vibrate with a premium energy.

### Core Palette
- **Background (`surface`):** `#131318` (The deep canvas)
- **Primary Accent (`primary`):** `#adc6ff` (A soft, high-end blue)
- **Secondary Accent (`secondary`):** `#4ae176` (For growth and "Approved" states)
- **Tertiary Accent (`tertiary`):** `#ffb95f` (For alerts and "Submitted" states)

### The "No-Line" Rule
**Prohibit 1px solid opaque borders for sectioning.** Boundaries must be defined through background color shifts. To separate a sidebar from a main content area, use `surface-container-low` transitioning into `surface`. If a structural break is needed, use a `3.5` (1.2rem) gap of negative space rather than a stroke.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers of frosted glass.
1. **Base Layer:** `surface` (#131318)
2. **Sectioning:** `surface-container-low` (#1b1b20)
3. **Default Card:** `surface-container` (#1f1f24)
4. **Floating/Active Element:** `surface-container-highest` (#35343a)

### The "Glass & Gradient" Rule
For primary panels, use the **Liquid-Glass** formula:
`background: rgba(255, 255, 255, 0.06); backdrop-filter: blur(16px);`
To provide "soul," apply a subtle linear gradient to main CTAs (Primary to Primary-Container) to avoid the flat, "default" digital look.

---

## 3. Typography

The typography strategy pairs the technical precision of **Inter** with the editorial authority of **Manrope**, while using **JetBrains Mono** for the "Intelligence" layer (data, AI strings, and financial figures).

| Role | Token | Font | Size | Intent |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | `display-lg` | Manrope | 3.5rem | Bold, asymmetric hero statements. |
| **Headline** | `headline-md` | Manrope | 1.75rem | Section headers; Romanian primary, English secondary (italics). |
| **Title** | `title-lg` | Inter | 1.375rem | Modal and Card titles. |
| **Body** | `body-md` | Inter | 0.875rem | Standard UI text and descriptions. |
| **Data** | Custom | JetBrains | 0.875rem | All currency and AI-generated values. |

**Bilingual Treatment:** Primary text (Romanian) uses `on-surface` (#e4e1e8). Secondary text (English) must use `on-surface-variant` at 55% opacity to maintain clear hierarchy without adding visual noise.

---

## 4. Elevation & Depth

### The Layering Principle
Depth is achieved by "stacking" surface tiers. To make a card "pop," do not add a border; instead, place a `surface-container-lowest` card on a `surface-container-low` background.

### Ambient Shadows
For floating modals or dropdowns, use "Ambient Shadows":
- **Blur:** 40px - 60px
- **Opacity:** 4%-8%
- **Color:** Use a tinted version of `primary` (#adc6ff) rather than black to simulate light passing through blue glass.

### The "Ghost Border" Fallback
Where accessibility requires a container edge (e.g., input fields), use a **Ghost Border**:
- **Token:** `outline-variant`
- **Opacity:** 10% to 20% max.
- **Forbid:** 100% opaque strokes.

---

## 5. Components

### Buttons (The "Tactile Glass" variants)
- **Primary:** Background `primary_container`. Text `on_primary_fixed`. Radius `md` (0.75rem).
- **Secondary (Glass):** `rgba(255,255,255,0.06)` with a `12% outline-variant` Ghost Border.
- **Interaction:** On hover, increase `backdrop-blur` from 16px to 24px.

### Inputs (The "Deep Field")
- **Style:** `surface_container_lowest`. Radius `10px` (custom).
- **Focus State:** Transition the Ghost Border from 10% to 40% opacity using the `primary` color.
- **Data Entry:** Always use **JetBrains Mono** for character input to emphasize the AI/Fintech nature.

### Cards & Lists
- **Rule:** Absolute prohibition of divider lines.
- **Separation:** Use `1.5` (0.5rem) spacing between list items or subtle background shifts between `surface-container` and `surface-container-high`.
- **Corner Radius:** Cards must use `xl` (1.5rem) to feel friendly yet architectural.

### AI Status Chips
- **Draft:** `outline` (#8c909f)
- **In Progress:** `primary` (#adc6ff)
- **Submitted/Amber:** `tertiary` (#ffb95f)
- **Approved/Green:** `secondary` (#4ae176)
- **Rejected/Red:** `error` (#ffb4ab)

---

## 6. Do's and Don'ts

### Do
- **Do** use asymmetric layouts. Align a header to the far left and the data-value to the far right with significant whitespace between.
- **Do** use JetBrains Mono for all numbers. It signals "Financial Precision."
- **Do** leverage `surface-bright` (#39383e) for hover states on dark glass panels.

### Don't
- **Don't** use 1px solid white lines. It breaks the "Liquid" illusion.
- **Don't** use pure black (#000). The `surface` token (#131318) allows for depth and shadow visibility.
- **Don't** crowd the interface. If you think it needs more features, it actually needs more spacing (`spacing-16` or `spacing-20`).
- **Don't** use heavy drop shadows. If a component doesn't feel elevated, adjust the surface color tier instead.