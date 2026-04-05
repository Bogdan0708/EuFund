# Design System Strategy: The Sovereign Minimalist

## 1. Overview & Creative North Star
The **Creative North Star** for this design system is **"The Digital Curator."**

Navigating EU funding is historically a dense, bureaucratic, and overwhelming process. This system rejects that chaos. It treats every piece of data as a high-end gallery exhibit. We leverage "The Digital Curator" to transform complex AI-driven grant matching into an editorial experience that feels authoritative, serene, and premium.

By utilizing massive whitespace (Spacings 16, 20, 24), we create "breathing rooms" that lower the user's cognitive load. We break the traditional SaaS "dashboard grid" through intentional asymmetry—placing hero elements slightly off-center and using overlapping glassmorphism cards—to mimic the tactile feel of physical documents spread across a clean studio desk.

---

## 2. Colors & Surface Philosophy
The palette is rooted in Apple’s iconic neutrals but elevated through a strict adherence to tonal depth rather than structural lines.

### The "No-Line" Rule
**Lines are a sign of structural weakness.** In this system, designers are prohibited from using 1px solid borders to define sections. Layout boundaries must be defined solely through background color shifts.
* **Background (`#F5F5F7`):** The canvas.
* **Surface-Container-Low (`#F4F3F8`):** Use for subtle content grouping.
* **Surface-Container-Highest (`#E3E2E7`):** Use for active or elevated navigation states.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers.
* **Level 0 (Canvas):** `background` (`#faf8fe`)
* **Level 1 (Sections):** `surface_container_low`
* **Level 2 (Active Cards):** `surface_container_lowest` (`#ffffff`) placed atop Level 1.

### The "Glass & Gradient" Rule
To inject "soul" into the AI experience, use **Glassmorphism** for floating AI assistant panels and modal overlays:
* **Fill:** `rgba(255, 255, 255, 0.72)`
* **Blur:** `20px backdrop-filter`
* **Gradients:** Use mesh gradients (transitioning from `primary` `#0059b5` to `secondary` `#4a47d2`) only for high-impact CTAs or as soft "halos" behind glass cards to indicate AI activity.

---

## 3. Typography: Editorial Authority
We utilize **Inter** with heavy customization to mimic the character of SF Pro. The typography is the primary driver of the brand's premium feel.

* **Display-LG (Hero Headings):** 56-80px, Weight 700, -0.03em letter-spacing. These are "Statement Headings." They should never be crowded.
* **Body-LG:** 17px (1rem), Weight 400, Line-height 1.47. This specific line-height ensures maximum readability for long-form grant requirements.
* **Tonal Contrast:** Use `on_surface` (`#1a1b1f`) for primary information and `on_surface_variant` (`#414753`) for metadata. Never use pure black.

---

## 4. Elevation & Depth
Depth is a functional tool, not a stylistic flourish.

### The Layering Principle
Avoid "Drop Shadows" for static elements. Instead, achieve lift by stacking:
* A `surface_container_lowest` card on a `surface_container_low` background creates a natural, soft lift.

### Ambient Shadows
When a card must "float" (e.g., during a drag-and-drop or a hover state), use **Ambient Shadows**:
* **Shadow:** `0 20px 40px rgba(0, 0, 0, 0.04)`
* The shadow must be tinted with the `on_surface` color, never a neutral grey, to maintain a natural light-refraction look.

### The "Ghost Border" Fallback
If a container sits on an identical color background and requires definition, use a **Ghost Border**:
* `outline_variant` (`#c1c6d6`) at **15% opacity**. Anything higher is too aggressive.

---

## 5. Components

### Buttons
* **Primary:** Solid `primary_container` (`#0071e3`). Border-radius `full`. No shadow.
* **Secondary:** Ghost style. No background, `primary` text.
* **Interaction:** `ease-out 250ms`. On hover: `translateY(-1px)`.

### Glassmorphism Cards (The "Grant Card")
* **Styling:** `surface_container_lowest` at 72% opacity.
* **Radius:** `md` (1.5rem) or `lg` (2rem).
* **Shadow:** Ambient Shadow (4% opacity).
* **Layout:** No dividers. Separate content using `Spacing 6` (2rem) of vertical whitespace.

### Input Fields
* **Styling:** Subtle `surface_container_high` background. No border.
* **Active State:** 1px `primary` ghost border (20% opacity) and a soft blue outer glow (halo).

### Sidebar (The Navigator)
* **Collapsed (64px):** Icons only, centered.
* **Expanded (240px):** Minimalist list items. Use `secondary_container` for active states with a soft `primary` dot indicator.

### AI Assistant (Floating Panel)
* **Component:** An asymmetric, glassmorphic "blob" or card that overlaps the main content area.
* **Texture:** Uses a soft radial halo of `secondary` (`#4a47d2`) in the background to signify "AI Intelligence" is active.

---

## 6. Do's and Don'ts

### Do
* **Do** use massive whitespace. If a section feels "finished," add 20px more padding.
* **Do** use asymmetrical layouts (e.g., a 2/3 width main card and a 1/3 width sidebar that starts lower on the Y-axis).
* **Do** use `fadeIn + translateY(20px to 0)` for all page transitions to give a sense of "ascending" into the data.

### Don't
* **Don't** use 1px solid borders to separate list items. Use `surface-variant` color shifts or purely vertical spacing.
* **Don't** use high-saturation backgrounds. The background should always be a "gallery white" (`#F5F5F7`).
* **Don't** use standard "Material Design" shadows. They are too heavy for this "Digital Curator" aesthetic.
* **Don't** crowd the Hero. The Headline-LG needs at least 96px of space from the nearest element.