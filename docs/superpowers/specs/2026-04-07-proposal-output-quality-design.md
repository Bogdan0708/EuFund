# Proposal Output Quality — Design Spec

## Context

FondEU generates EU funding proposal sections via AI. Currently, content is stored and rendered as plain text — no headings, no bullet points, no bold. The canvas preview shows flat paragraphs. DOCX exports are unstyled text walls. Neither looks like a professional document.

**Goal**: Make generated sections look like real EU funding proposal documents, in both the canvas preview and DOCX export.

## Decision: Markdown as canonical content format

AI-generated section content is stored as a **restricted Markdown string** in `SectionResult.content`. Both preview and export parse the same Markdown into their respective output formats.

### Supported Markdown subset (v1)

| Syntax | Example | Supported |
|--------|---------|-----------|
| Paragraphs | Plain text | Yes |
| Sub-headings | `##`, `###` | Yes |
| Bold | `**text**` | Yes |
| Bullet lists | `- item` | Yes |
| Numbered lists | `1. item` | Yes |
| Tables | `\| col \|` | No (v2) |
| Code fences | ` ``` ` | No — stripped |
| Blockquotes | `> text` | No — stripped |
| Images | `![](url)` | No — stripped |
| Links | `[text](url)` | No — stripped |
| Raw HTML | `<div>` | No — stripped |

## Architecture

```
AI generates markdown string
        |
        v
  normalizeMarkdown()          ← strip fences, HTML, redundant titles
        |
        v
  SectionResult.content        ← stored as markdown string
        |
        +----> parseMarkdownBlocks()  ← shared parser
        |           |
        |           +----> Canvas preview (React components)
        |           +----> DOCX export (Word XML)
        |
        +----> Plain text fallback (old content without markdown)
```

### New shared module: `lib/markdown/proposal-markdown.ts`

Single file containing:

- `normalizeMarkdown(raw: string): string` — post-AI cleanup (idempotent: `f(f(x)) === f(x)`)
- `parseMarkdownBlocks(content: string): Block[]` — parse into block model
- Block types (top-level): `paragraph`, `heading`, `bullet_list`, `numbered_list`
- Inline run types (within blocks): `text`, `bold`
- A `paragraph` contains `InlineRun[]`. A `heading` contains `InlineRun[]` + `level`. List items contain `InlineRun[]`.

This split keeps block-level structure separate from inline formatting, making both preview and DOCX generation cleaner.

Both DOCX export and canvas preview consume `Block[]`.

**No nested lists in v1.** Indented bullets or sub-numbering degrade to flat list items. This prevents parser complexity creep.

## Content rules

- New AI-generated section content is stored as markdown
- Old plain-text content still renders correctly (paragraphs only)
- No raw HTML allowed in stored content
- No code fences allowed in stored content
- The `content` field inside the JSON wrapper contains markdown only — prompts must be explicit about this

## Normalization step

After AI output, before storage, `normalizeMarkdown()`:

1. Strip markdown code fences (` ``` `)
2. Strip raw HTML tags
3. Remove redundant top-level title if section already has an external title
4. Normalize 3+ consecutive blank lines to 2
5. Downgrade `#` (h1) to `##` (h2) — sections already have a title

**Idempotency requirement**: `normalizeMarkdown(normalizeMarkdown(x)) === normalizeMarkdown(x)`. This prevents subtle bugs in regen/edit flows where content passes through normalization multiple times.

## Canvas preview

**Component change**: `ProposalTab.tsx` line 534

Replace `{section.content}` with a local `<MarkdownPreview content={section.content} />` component.

**Rendering rules:**
- `##` → `<h3>` with `text-base font-semibold` (slightly larger than body)
- `###` → `<h4>` with `text-sm font-semibold`
- `**bold**` → `<strong>`
- `- bullet` → `<ul>` with proper indentation
- `1. numbered` → `<ol>` with proper indentation
- Paragraphs → `<p>` with `leading-relaxed`
- Unsupported syntax → render as plain text (graceful degradation)
- Keep current sans-serif styling, compact panel layout
- Keep `max-h-48 overflow-y-auto` scroll behavior

**No `react-markdown` dependency**. Build a small local renderer from `parseMarkdownBlocks()`. Predictable output, no third-party dependency, same subset as DOCX.

## DOCX export

**Styling (Option 1 — clean professional document):**

- Font: Times New Roman 12pt body, 14pt headings
- Page size: A4 (210mm x 297mm)
- Margins: 2.5cm all sides
- Line spacing: 1.15
- Paragraph spacing: 6pt after
- Footer: centered page numbers
- Cover page: project title (16pt bold centered), program name, applicant name, date
- Page break between cover and content

**Cover page fallback rules** (when data is missing):
- Title missing → use `"Cerere de finanțare"` (generic)
- Program missing → omit the program line entirely
- Applicant missing → omit the applicant line entirely
- Date missing → use current date (`YYYY-MM-DD`)
- Cover page is always generated — at minimum it shows the title and date

**Markdown → Word XML mapping:**

| Markdown | Word XML |
|----------|----------|
| `## heading` | `<w:pStyle w:val="Heading2"/>`, 14pt bold |
| `### heading` | `<w:pStyle w:val="Heading3"/>`, 12pt bold |
| `**bold**` | `<w:rPr><w:b/></w:rPr>` within a run |
| `- bullet` | `<w:numPr>` with bullet list definition |
| `1. numbered` | `<w:numPr>` with decimal list definition |
| paragraph | Default body style, Times New Roman 12pt |

**Implementation**: Rewrite `section-docx.ts` and `docx.ts` to use `parseMarkdownBlocks()`. Add Word numbering definitions (`word/numbering.xml`) for bullet and numbered lists. Add styles part (`word/styles.xml`) for consistent font/spacing.

**Both `generateSectionDocx()` and `generateDocx()` use the same parser and XML generation logic** — no duplicate Markdown handling.

## AI prompt changes

Update system prompts in `generate-section.ts`, `regenerate-section.ts`, and `build.ts`.

**Add to RULES section:**

```
FORMAT:
- Use ## for sub-section headings within this section
- Use ### for sub-sub-headings if needed
- Use **bold** for key terms, regulation names, and important values
- Use bullet lists (-) for enumerations of items, criteria, or features
- Use numbered lists (1.) only for ordered steps, phases, or ranked criteria
- Write in clear paragraphs between structured elements
- Do NOT use code fences, blockquotes, images, links, or HTML
- Do NOT include a section title heading — it is added separately
```

**Implementation order**: renderers first, then prompts. Users must never see raw `##` in the preview.

## Backward compatibility

- `parseMarkdownBlocks()` handles plain text (no markdown) by returning paragraph blocks
- Old content without any markdown syntax renders exactly as before
- No migration of existing stored content needed

## Reliability rules

- Malformed markdown does not break preview — falls back to paragraph rendering
- Malformed markdown does not break DOCX export — falls back to plain paragraphs
- `normalizeMarkdown()` is defensive — unknown syntax is left as text, not rejected

## Files modified

| File | Change |
|------|--------|
| `lib/markdown/proposal-markdown.ts` | **NEW**: normalizeMarkdown, parseMarkdownBlocks, Block types |
| `asistent-ai/components/ProposalTab.tsx` | Replace plain text with MarkdownPreview component |
| `lib/export/section-docx.ts` | Use parseMarkdownBlocks, professional styling, numbering.xml |
| `lib/export/docx.ts` | Same parser, cover page, margins, footer, styles.xml |
| `agent/tools/generate-section.ts` | Prompt: add FORMAT rules |
| `agent/tools/regenerate-section.ts` | Prompt: add FORMAT rules |
| `orchestrator/agents/build.ts` | Prompt: add FORMAT rules |

## Files unchanged

- `SectionResult` type definition — `content` stays `string`
- `parseAIJson` — JSON extraction stays as-is
- `generateFormDocx` — form templates are not AI narrative content
- Version history, state management, action buttons — unchanged

## Implementation order

1. `lib/markdown/proposal-markdown.ts` — parser + normalizer
2. Unit tests for parser (headings, bold, lists, plain text fallback, malformed input)
3. `ProposalTab.tsx` — canvas preview rendering
4. `section-docx.ts` + `docx.ts` — DOCX export with professional styling
5. Prompt updates in generate-section, regenerate-section, build agent
6. Integration test: generate → normalize → preview + export

## Verification

### Parser unit tests
1. All supported syntax parses into correct block/inline types
2. Plain text (no markdown) returns paragraph blocks only
3. Malformed markdown (missing closing `**`, nested lists) degrades to text
4. `normalizeMarkdown` is idempotent (`f(f(x)) === f(x)`)
5. Nested lists degrade to flat list items

### Canvas preview tests
6. `##`, `**`, `-`, `1.` render as headings, bold, lists
7. Old plain text content renders as paragraphs (no regression)
8. Unsupported syntax renders as plain text

### DOCX structural tests (inspect generated XML)
9. Heading blocks produce `<w:pStyle w:val="Heading2"/>` / `Heading3`
10. Bullet lists produce `<w:numPr>` with bullet numbering definition
11. Numbered lists produce `<w:numPr>` with decimal numbering definition
12. Bold inline runs produce `<w:b/>` within `<w:rPr>`
13. Footer contains page number field `<w:fldChar>`
14. Page size is A4 (11906 x 16838 twips)
15. Margins are 2.5cm (1440 twips)
16. Default font is Times New Roman 12pt

### Integration tests
17. Generate a section with new prompts → verify markdown output → verify preview + DOCX
18. Old plain text content exports as plain paragraphs in DOCX
19. Cover page renders with fallback values when fields are missing
