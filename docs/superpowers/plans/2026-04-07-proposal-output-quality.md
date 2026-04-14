# Proposal Output Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-generated proposal sections render with proper structure (headings, bold, lists) in both the canvas preview and DOCX exports, using restricted Markdown as the canonical content format.

**Architecture:** A shared Markdown parser (`lib/markdown/proposal-markdown.ts`) converts a restricted subset of Markdown into a `Block[]` model. Both the React canvas preview and the DOCX exporter consume this same block model. AI prompts are updated last to generate Markdown, after renderers are in place.

**Tech Stack:** TypeScript, PizZip (existing DOCX dependency), React, Vitest

**Spec:** `docs/superpowers/specs/2026-04-07-proposal-output-quality-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `app/src/lib/markdown/proposal-markdown.ts` | **NEW** — Types, normalizer, block parser, inline parser |
| `app/tests/unit/proposal-markdown.test.ts` | **NEW** — Parser + normalizer unit tests |
| `app/src/app/[locale]/(dashboard)/asistent-ai/components/MarkdownPreview.tsx` | **NEW** — React component rendering `Block[]` |
| `app/src/app/[locale]/(dashboard)/asistent-ai/components/ProposalTab.tsx` | **MODIFY** — Use `<MarkdownPreview>` instead of raw text |
| `app/src/lib/export/markdown-to-ooxml.ts` | **NEW** — Convert `Block[]` to Word XML body string |
| `app/src/lib/export/section-docx.ts` | **MODIFY** — Use markdown-to-ooxml, add styles/numbering |
| `app/src/lib/export/docx.ts` | **MODIFY** — Use markdown-to-ooxml, cover page, margins, footer |
| `app/tests/unit/docx-structure.test.ts` | **NEW** — DOCX XML structural tests |
| `app/src/lib/ai/agent/tools/generate-section.ts` | **MODIFY** — Add FORMAT rules to prompt |
| `app/src/lib/ai/agent/tools/regenerate-section.ts` | **MODIFY** — Add FORMAT rules to prompt |
| `app/src/lib/ai/orchestrator/prompts/build-section.ts` | **MODIFY** — Add FORMAT rules to prompt |

---

### Task 1: Markdown Types and Inline Parser

**Files:**
- Create: `app/src/lib/markdown/proposal-markdown.ts`
- Test: `app/tests/unit/proposal-markdown.test.ts`

- [ ] **Step 1: Write failing tests for inline parsing**

```typescript
// app/tests/unit/proposal-markdown.test.ts
import { describe, it, expect } from 'vitest'
import { parseInlineRuns, type InlineRun } from '@/lib/markdown/proposal-markdown'

describe('parseInlineRuns', () => {
  it('returns plain text as a single text run', () => {
    expect(parseInlineRuns('Hello world')).toEqual([
      { type: 'text', content: 'Hello world' },
    ])
  })

  it('parses bold text', () => {
    expect(parseInlineRuns('This is **important** text')).toEqual([
      { type: 'text', content: 'This is ' },
      { type: 'bold', content: 'important' },
      { type: 'text', content: ' text' },
    ])
  })

  it('parses multiple bold segments', () => {
    const runs = parseInlineRuns('**A** then **B**')
    expect(runs).toEqual([
      { type: 'bold', content: 'A' },
      { type: 'text', content: ' then ' },
      { type: 'bold', content: 'B' },
    ])
  })

  it('handles unclosed bold as plain text', () => {
    expect(parseInlineRuns('This is **broken')).toEqual([
      { type: 'text', content: 'This is **broken' },
    ])
  })

  it('handles empty string', () => {
    expect(parseInlineRuns('')).toEqual([])
  })

  it('handles bold at start and end', () => {
    expect(parseInlineRuns('**all bold**')).toEqual([
      { type: 'bold', content: 'all bold' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/proposal-markdown.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types and inline parser**

```typescript
// app/src/lib/markdown/proposal-markdown.ts

// ─── Types ──────────────────────────────────────────────────────

export interface TextRun {
  type: 'text'
  content: string
}

export interface BoldRun {
  type: 'bold'
  content: string
}

export type InlineRun = TextRun | BoldRun

export interface ParagraphBlock {
  type: 'paragraph'
  runs: InlineRun[]
}

export interface HeadingBlock {
  type: 'heading'
  level: 2 | 3
  runs: InlineRun[]
}

export interface ListItemBlock {
  runs: InlineRun[]
}

export interface BulletListBlock {
  type: 'bullet_list'
  items: ListItemBlock[]
}

export interface NumberedListBlock {
  type: 'numbered_list'
  items: ListItemBlock[]
}

export type Block = ParagraphBlock | HeadingBlock | BulletListBlock | NumberedListBlock

// ─── Inline Parser ──────────────────────────────────────────────

export function parseInlineRuns(text: string): InlineRun[] {
  if (!text) return []

  const runs: InlineRun[] = []
  const BOLD_RE = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    runs.push({ type: 'bold', content: match[1] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    runs.push({ type: 'text', content: text.slice(lastIndex) })
  }

  // If no bold was found and text is non-empty, return as single text run
  if (runs.length === 0 && text.length > 0) {
    runs.push({ type: 'text', content: text })
  }

  return runs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/unit/proposal-markdown.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/markdown/proposal-markdown.ts app/tests/unit/proposal-markdown.test.ts
git commit -m "feat: add proposal markdown types and inline parser"
```

---

### Task 2: Block Parser

**Files:**
- Modify: `app/src/lib/markdown/proposal-markdown.ts`
- Modify: `app/tests/unit/proposal-markdown.test.ts`

- [ ] **Step 1: Write failing tests for block parsing**

Add to `app/tests/unit/proposal-markdown.test.ts`:

```typescript
import { parseMarkdownBlocks, type Block } from '@/lib/markdown/proposal-markdown'

describe('parseMarkdownBlocks', () => {
  it('parses plain text as paragraphs', () => {
    const blocks = parseMarkdownBlocks('Hello world\n\nSecond paragraph')
    expect(blocks).toEqual([
      { type: 'paragraph', runs: [{ type: 'text', content: 'Hello world' }] },
      { type: 'paragraph', runs: [{ type: 'text', content: 'Second paragraph' }] },
    ])
  })

  it('parses ## headings', () => {
    const blocks = parseMarkdownBlocks('## Sub-section Title')
    expect(blocks).toEqual([
      { type: 'heading', level: 2, runs: [{ type: 'text', content: 'Sub-section Title' }] },
    ])
  })

  it('parses ### headings', () => {
    const blocks = parseMarkdownBlocks('### Sub-sub Title')
    expect(blocks).toEqual([
      { type: 'heading', level: 3, runs: [{ type: 'text', content: 'Sub-sub Title' }] },
    ])
  })

  it('parses bullet lists', () => {
    const blocks = parseMarkdownBlocks('- Item one\n- Item two\n- Item three')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('bullet_list')
    const list = blocks[0] as Extract<Block, { type: 'bullet_list' }>
    expect(list.items).toHaveLength(3)
    expect(list.items[0].runs).toEqual([{ type: 'text', content: 'Item one' }])
  })

  it('parses numbered lists', () => {
    const blocks = parseMarkdownBlocks('1. First step\n2. Second step')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('numbered_list')
    const list = blocks[0] as Extract<Block, { type: 'numbered_list' }>
    expect(list.items).toHaveLength(2)
    expect(list.items[0].runs).toEqual([{ type: 'text', content: 'First step' }])
  })

  it('parses bold within paragraphs', () => {
    const blocks = parseMarkdownBlocks('This has **bold** text')
    expect(blocks).toEqual([{
      type: 'paragraph',
      runs: [
        { type: 'text', content: 'This has ' },
        { type: 'bold', content: 'bold' },
        { type: 'text', content: ' text' },
      ],
    }])
  })

  it('parses bold within list items', () => {
    const blocks = parseMarkdownBlocks('- **Important** item')
    const list = blocks[0] as Extract<Block, { type: 'bullet_list' }>
    expect(list.items[0].runs).toEqual([
      { type: 'bold', content: 'Important' },
      { type: 'text', content: ' item' },
    ])
  })

  it('handles mixed content', () => {
    const md = `## Overview

This is the introduction.

- Point one
- Point two

## Details

1. Step one
2. Step two

Final paragraph.`

    const blocks = parseMarkdownBlocks(md)
    expect(blocks.map(b => b.type)).toEqual([
      'heading', 'paragraph', 'bullet_list', 'heading', 'numbered_list', 'paragraph',
    ])
  })

  it('handles empty input', () => {
    expect(parseMarkdownBlocks('')).toEqual([])
  })

  it('degrades nested lists to flat items', () => {
    const blocks = parseMarkdownBlocks('- Top\n  - Nested\n- Back')
    const list = blocks[0] as Extract<Block, { type: 'bullet_list' }>
    expect(list.items).toHaveLength(3)
    expect(list.items[1].runs[0]).toEqual({ type: 'text', content: 'Nested' })
  })

  it('handles single-line input as paragraph', () => {
    const blocks = parseMarkdownBlocks('Just one line')
    expect(blocks).toEqual([
      { type: 'paragraph', runs: [{ type: 'text', content: 'Just one line' }] },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/proposal-markdown.test.ts`
Expected: FAIL — `parseMarkdownBlocks` not found

- [ ] **Step 3: Implement block parser**

Add to `app/src/lib/markdown/proposal-markdown.ts`:

```typescript
// ─── Block Parser ───────────────────────────────────────────────

const HEADING2_RE = /^##\s+(.+)$/
const HEADING3_RE = /^###\s+(.+)$/
const BULLET_RE = /^[-*]\s+(.+)$/
const NUMBERED_RE = /^\d+\.\s+(.+)$/
const NESTED_BULLET_RE = /^\s{2,}[-*]\s+(.+)$/

export function parseMarkdownBlocks(content: string): Block[] {
  if (!content.trim()) return []

  const lines = content.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Skip blank lines
    if (!line.trim()) {
      i++
      continue
    }

    // Heading ##
    const h2 = line.match(HEADING2_RE)
    if (h2) {
      blocks.push({ type: 'heading', level: 2, runs: parseInlineRuns(h2[1]) })
      i++
      continue
    }

    // Heading ###
    const h3 = line.match(HEADING3_RE)
    if (h3) {
      blocks.push({ type: 'heading', level: 3, runs: parseInlineRuns(h3[1]) })
      i++
      continue
    }

    // Bullet list — consume consecutive bullet lines
    if (BULLET_RE.test(line) || NESTED_BULLET_RE.test(line)) {
      const items: ListItemBlock[] = []
      while (i < lines.length) {
        const bulletLine = lines[i]
        const bulletMatch = bulletLine.match(BULLET_RE)
        const nestedMatch = bulletLine.match(NESTED_BULLET_RE)
        if (bulletMatch) {
          items.push({ runs: parseInlineRuns(bulletMatch[1]) })
          i++
        } else if (nestedMatch) {
          // Nested list degrades to flat item
          items.push({ runs: parseInlineRuns(nestedMatch[1]) })
          i++
        } else {
          break
        }
      }
      blocks.push({ type: 'bullet_list', items })
      continue
    }

    // Numbered list — consume consecutive numbered lines
    if (NUMBERED_RE.test(line)) {
      const items: ListItemBlock[] = []
      while (i < lines.length) {
        const numMatch = lines[i].match(NUMBERED_RE)
        if (numMatch) {
          items.push({ runs: parseInlineRuns(numMatch[1]) })
          i++
        } else {
          break
        }
      }
      blocks.push({ type: 'numbered_list', items })
      continue
    }

    // Paragraph — consume consecutive non-blank, non-special lines
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() &&
      !HEADING2_RE.test(lines[i]) && !HEADING3_RE.test(lines[i]) &&
      !BULLET_RE.test(lines[i]) && !NUMBERED_RE.test(lines[i]) &&
      !NESTED_BULLET_RE.test(lines[i])) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', runs: parseInlineRuns(paraLines.join(' ')) })
    }
  }

  return blocks
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/proposal-markdown.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/markdown/proposal-markdown.ts app/tests/unit/proposal-markdown.test.ts
git commit -m "feat: add proposal markdown block parser"
```

---

### Task 3: Normalizer

**Files:**
- Modify: `app/src/lib/markdown/proposal-markdown.ts`
- Modify: `app/tests/unit/proposal-markdown.test.ts`

- [ ] **Step 1: Write failing tests for normalizeMarkdown**

Add to `app/tests/unit/proposal-markdown.test.ts`:

```typescript
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

describe('normalizeMarkdown', () => {
  it('strips code fences', () => {
    const input = '```markdown\n## Hello\nWorld\n```'
    expect(normalizeMarkdown(input)).toBe('## Hello\nWorld')
  })

  it('strips raw HTML tags', () => {
    expect(normalizeMarkdown('Hello <div>world</div> here')).toBe('Hello world here')
  })

  it('strips self-closing HTML tags', () => {
    expect(normalizeMarkdown('Line<br/>break')).toBe('Linebreak')
  })

  it('downgrades # to ##', () => {
    expect(normalizeMarkdown('# Top Title\n\nContent')).toBe('## Top Title\n\nContent')
  })

  it('does not downgrade ## or ###', () => {
    expect(normalizeMarkdown('## Already H2\n### H3')).toBe('## Already H2\n### H3')
  })

  it('normalizes 3+ blank lines to 2', () => {
    expect(normalizeMarkdown('A\n\n\n\nB')).toBe('A\n\nB')
  })

  it('preserves 2 blank lines', () => {
    expect(normalizeMarkdown('A\n\nB')).toBe('A\n\nB')
  })

  it('is idempotent', () => {
    const input = '```json\n{"a":1}\n```\n\n# Title\n\n<b>bold</b>\n\n\n\n\nEnd'
    const once = normalizeMarkdown(input)
    const twice = normalizeMarkdown(once)
    expect(twice).toBe(once)
  })

  it('handles empty string', () => {
    expect(normalizeMarkdown('')).toBe('')
  })

  it('handles plain text unchanged', () => {
    expect(normalizeMarkdown('Just plain text')).toBe('Just plain text')
  })

  it('strips blockquotes', () => {
    expect(normalizeMarkdown('> Quoted text')).toBe('Quoted text')
  })

  it('strips image syntax', () => {
    expect(normalizeMarkdown('![alt](url)')).toBe('')
  })

  it('strips link syntax keeping text', () => {
    expect(normalizeMarkdown('See [this link](url) for details')).toBe('See this link for details')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/unit/proposal-markdown.test.ts`
Expected: FAIL — `normalizeMarkdown` not found

- [ ] **Step 3: Implement normalizer**

Add to `app/src/lib/markdown/proposal-markdown.ts`:

```typescript
// ─── Normalizer ─────────────────────────────────────────────────

export function normalizeMarkdown(raw: string): string {
  if (!raw) return ''

  let result = raw

  // 1. Strip code fences (``` ... ```)
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    // Extract content between fences, skip the fence lines
    const lines = match.split('\n')
    return lines.slice(1, -1).join('\n')
  })

  // 2. Strip image syntax ![alt](url)
  result = result.replace(/!\[.*?\]\(.*?\)/g, '')

  // 3. Strip link syntax [text](url) → keep text
  result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  // 4. Strip blockquote markers
  result = result.replace(/^>\s?/gm, '')

  // 5. Strip HTML tags (both opening/closing and self-closing)
  result = result.replace(/<\/?[a-zA-Z][^>]*\/?>/g, '')

  // 6. Downgrade # (h1) to ## (but not ## or ###)
  result = result.replace(/^#\s+/gm, '## ')

  // 7. Normalize 3+ consecutive blank lines to 2
  result = result.replace(/\n{3,}/g, '\n\n')

  // 8. Trim trailing whitespace on each line
  result = result.split('\n').map(l => l.trimEnd()).join('\n')

  // 9. Trim leading/trailing blank lines
  result = result.trim()

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/proposal-markdown.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/markdown/proposal-markdown.ts app/tests/unit/proposal-markdown.test.ts
git commit -m "feat: add proposal markdown normalizer (idempotent)"
```

---

### Task 4: Canvas Preview Component

**Files:**
- Create: `app/src/app/[locale]/(dashboard)/asistent-ai/components/MarkdownPreview.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/components/ProposalTab.tsx`

- [ ] **Step 1: Create MarkdownPreview component**

```tsx
// app/src/app/[locale]/(dashboard)/asistent-ai/components/MarkdownPreview.tsx
'use client'

import { parseMarkdownBlocks, type Block, type InlineRun } from '@/lib/markdown/proposal-markdown'

function InlineRuns({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((run, i) => {
        if (run.type === 'bold') {
          return <strong key={i} className="font-semibold text-on-surface">{run.content}</strong>
        }
        return <span key={i}>{run.content}</span>
      })}
    </>
  )
}

function BlockRenderer({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading':
      if (block.level === 2) {
        return (
          <h3 className="text-base font-semibold text-on-surface mt-4 mb-1.5">
            <InlineRuns runs={block.runs} />
          </h3>
        )
      }
      return (
        <h4 className="text-sm font-semibold text-on-surface mt-3 mb-1">
          <InlineRuns runs={block.runs} />
        </h4>
      )

    case 'bullet_list':
      return (
        <ul className="list-disc list-outside ml-5 my-2 space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="text-sm text-on-surface-variant leading-relaxed">
              <InlineRuns runs={item.runs} />
            </li>
          ))}
        </ul>
      )

    case 'numbered_list':
      return (
        <ol className="list-decimal list-outside ml-5 my-2 space-y-1">
          {block.items.map((item, i) => (
            <li key={i} className="text-sm text-on-surface-variant leading-relaxed">
              <InlineRuns runs={item.runs} />
            </li>
          ))}
        </ol>
      )

    case 'paragraph':
      return (
        <p className="text-sm text-on-surface-variant leading-relaxed my-1.5">
          <InlineRuns runs={block.runs} />
        </p>
      )
  }
}

export function MarkdownPreview({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content)

  return (
    <div className="space-y-0">
      {blocks.map((block, i) => (
        <BlockRenderer key={i} block={block} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Update ProposalTab.tsx to use MarkdownPreview**

In `app/src/app/[locale]/(dashboard)/asistent-ai/components/ProposalTab.tsx`:

Add import at top:
```typescript
import { MarkdownPreview } from './MarkdownPreview'
```

Replace lines 533-536:
```tsx
// OLD:
                ) : (
                  <div className="text-sm text-on-surface-variant leading-relaxed max-h-48 overflow-y-auto">
                    {section.content}
                  </div>
                )}
```

With:
```tsx
// NEW:
                ) : (
                  <div className="max-h-48 overflow-y-auto">
                    <MarkdownPreview content={section.content} />
                  </div>
                )}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 0

- [ ] **Step 4: Commit**

```bash
git add app/src/app/*/asistent-ai/components/MarkdownPreview.tsx app/src/app/*/asistent-ai/components/ProposalTab.tsx
git commit -m "feat: add markdown preview component for proposal canvas"
```

---

### Task 5: Markdown to OOXML Converter

**Files:**
- Create: `app/src/lib/export/markdown-to-ooxml.ts`
- Create: `app/tests/unit/docx-structure.test.ts`

- [ ] **Step 1: Write failing structural tests**

```typescript
// app/tests/unit/docx-structure.test.ts
import { describe, it, expect } from 'vitest'
import { blocksToOoxml } from '@/lib/export/markdown-to-ooxml'
import { parseMarkdownBlocks } from '@/lib/markdown/proposal-markdown'

describe('blocksToOoxml', () => {
  it('converts heading to Heading2 style', () => {
    const blocks = parseMarkdownBlocks('## Section Title')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('w:val="Heading2"')
    expect(xml).toContain('Section Title')
  })

  it('converts ### to Heading3 style', () => {
    const blocks = parseMarkdownBlocks('### Sub Title')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('w:val="Heading3"')
  })

  it('converts bold runs to w:b', () => {
    const blocks = parseMarkdownBlocks('This is **important** text')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('important')
  })

  it('converts bullet list to numPr with bullet numId', () => {
    const blocks = parseMarkdownBlocks('- Item one\n- Item two')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('<w:numId w:val="1"/>')
    expect(xml).toContain('Item one')
    expect(xml).toContain('Item two')
  })

  it('converts numbered list to numPr with decimal numId', () => {
    const blocks = parseMarkdownBlocks('1. First\n2. Second')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('<w:numId w:val="2"/>')
    expect(xml).toContain('First')
  })

  it('converts paragraph to body text', () => {
    const blocks = parseMarkdownBlocks('Plain paragraph text.')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('<w:t xml:space="preserve">')
    expect(xml).toContain('Plain paragraph text.')
  })

  it('escapes XML special characters', () => {
    const blocks = parseMarkdownBlocks('A < B & C > D')
    const xml = blocksToOoxml(blocks)
    expect(xml).toContain('A &lt; B &amp; C &gt; D')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/docx-structure.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement markdown-to-ooxml converter**

```typescript
// app/src/lib/export/markdown-to-ooxml.ts
import type { Block, InlineRun } from '@/lib/markdown/proposal-markdown'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function runsToOoxml(runs: InlineRun[]): string {
  return runs.map(run => {
    const escaped = escapeXml(run.content)
    if (run.type === 'bold') {
      return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`
    }
    return `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`
  }).join('')
}

// numId 1 = bullet, numId 2 = decimal (defined in numbering.xml)
function listItemToOoxml(runs: InlineRun[], numId: number): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runsToOoxml(runs)}</w:p>`
}

export function blocksToOoxml(blocks: Block[]): string {
  return blocks.map(block => {
    switch (block.type) {
      case 'heading': {
        const style = block.level === 2 ? 'Heading2' : 'Heading3'
        return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runsToOoxml(block.runs)}</w:p>`
      }
      case 'bullet_list':
        return block.items.map(item => listItemToOoxml(item.runs, 1)).join('')
      case 'numbered_list':
        return block.items.map(item => listItemToOoxml(item.runs, 2)).join('')
      case 'paragraph':
        return `<w:p>${runsToOoxml(block.runs)}</w:p>`
    }
  }).join('')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/docx-structure.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/export/markdown-to-ooxml.ts app/tests/unit/docx-structure.test.ts
git commit -m "feat: add markdown-to-OOXML converter for DOCX export"
```

---

### Task 6: Professional DOCX Template (styles, numbering, footer)

**Files:**
- Modify: `app/src/lib/export/section-docx.ts`
- Modify: `app/src/lib/export/docx.ts`
- Modify: `app/tests/unit/docx-structure.test.ts`

- [ ] **Step 1: Write failing tests for DOCX structure**

Add to `app/tests/unit/docx-structure.test.ts`:

```typescript
import PizZip from 'pizzip'
import { generateSectionDocx } from '@/lib/export/section-docx'
import { generateDocx } from '@/lib/export/docx'

describe('generateSectionDocx structure', () => {
  const buffer = generateSectionDocx({ title: 'Test Section', content: '## Heading\n\nParagraph with **bold**.', order: 1 })
  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')!.asText()

  it('contains Heading2 style for ## markup', () => {
    expect(docXml).toContain('w:val="Heading2"')
  })

  it('contains bold run for **bold**', () => {
    expect(docXml).toContain('<w:b/>')
  })

  it('includes styles.xml with Times New Roman default', () => {
    const stylesXml = zip.file('word/styles.xml')!.asText()
    expect(stylesXml).toContain('Times New Roman')
  })

  it('includes numbering.xml for list support', () => {
    const numXml = zip.file('word/numbering.xml')!.asText()
    expect(numXml).toContain('w:abstractNumId')
  })
})

describe('generateDocx full document structure', () => {
  it('has A4 page size', async () => {
    const buffer = await generateDocx([], { projectTitle: 'Test' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).toContain('w:w="11906"')  // A4 width in twips
    expect(docXml).toContain('w:h="16838"')  // A4 height in twips
  })

  it('has 2.5cm margins (1440 twips)', async () => {
    const buffer = await generateDocx([], { projectTitle: 'Test' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).toContain('w:top="1440"')
    expect(docXml).toContain('w:bottom="1440"')
    expect(docXml).toContain('w:left="1440"')
    expect(docXml).toContain('w:right="1440"')
  })

  it('has footer with page number', async () => {
    const buffer = await generateDocx([], { projectTitle: 'Test' })
    const zip = new PizZip(buffer)
    const footerXml = zip.file('word/footer1.xml')
    expect(footerXml).toBeTruthy()
    expect(footerXml!.asText()).toContain('w:fldChar')
  })

  it('has cover page with project title', async () => {
    const buffer = await generateDocx([], { projectTitle: 'My Project' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).toContain('My Project')
  })

  it('uses fallback title when projectTitle is empty', async () => {
    const buffer = await generateDocx([], { projectTitle: '' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).toContain('Cerere de finan')
  })

  it('omits program line when program is missing', async () => {
    const buffer = await generateDocx([], { projectTitle: 'Test' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).not.toContain('Program:')
  })

  it('includes program when provided', async () => {
    const buffer = await generateDocx([], { projectTitle: 'Test', program: 'PNRR' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).toContain('PNRR')
  })

  it('renders markdown sections with proper formatting', async () => {
    const sections = [{
      id: 's1', title: 'Context', content: '## Background\n\n**Important** point.\n\n- Item A\n- Item B',
      order: 1, source: 'generated' as const, state: 'draft' as const,
      currentVersion: 1, versionCount: 1, contentHash: '', lastStateChangeAt: '', lastStateChangeBy: null,
      metadata: { model: '', provider: '', tokensIn: 0, tokensOut: 0, latencyMs: 0, retryCount: 0, fallbackUsed: false, generatedAt: '', checksum: '' },
    }]
    const buffer = await generateDocx(sections, { projectTitle: 'Test' })
    const zip = new PizZip(buffer)
    const docXml = zip.file('word/document.xml')!.asText()
    expect(docXml).toContain('w:val="Heading2"')
    expect(docXml).toContain('<w:b/>')
    expect(docXml).toContain('<w:numId w:val="1"/>')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/docx-structure.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite section-docx.ts with professional styling**

Replace the entire content of `app/src/lib/export/section-docx.ts` — this is a complete rewrite. The new version uses `parseMarkdownBlocks` + `blocksToOoxml`, adds `styles.xml` and `numbering.xml` to the ZIP, and sets Times New Roman as the default font.

Key changes:
- Import `parseMarkdownBlocks` from `@/lib/markdown/proposal-markdown`
- Import `blocksToOoxml` from `./markdown-to-ooxml`
- Add `STYLES_XML` constant with Heading2, Heading3, Normal styles (Times New Roman 12pt, 1.15 spacing, 6pt after)
- Add `NUMBERING_XML` constant with bullet (abstractNumId 0, numId 1) and decimal (abstractNumId 1, numId 2) definitions
- `wrapDocx()` now includes `word/styles.xml`, `word/numbering.xml`, and references in `document.xml.rels`
- `generateSectionDocx()` calls `parseMarkdownBlocks(opts.content)` then `blocksToOoxml(blocks)`

- [ ] **Step 4: Rewrite docx.ts with cover page, margins, footer**

Replace `buildDocxContent()` in `app/src/lib/export/docx.ts`:
- Add `FOOTER_XML` constant with centered page number using `w:fldChar` / `PAGE` field
- Add `word/footer1.xml` to the ZIP
- Add footer relationship in `document.xml.rels`
- Cover page: title (32pt bold centered), optional program line, optional applicant line, date, page break
- Cover page fallbacks: empty title → `"Cerere de finanțare"`, empty program → omit, empty applicant → omit, empty date → today
- Section properties: A4 (w=11906, h=16838), margins 1440 twips all sides, footer reference
- Section content: heading + `blocksToOoxml(parseMarkdownBlocks(section.content))`
- Reuse `STYLES_XML`, `NUMBERING_XML` from section-docx (or import shared constants)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/docx-structure.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run typecheck**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 0

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/export/section-docx.ts app/src/lib/export/docx.ts app/tests/unit/docx-structure.test.ts
git commit -m "feat: professional DOCX export with markdown formatting, cover page, A4 layout"
```

---

### Task 7: AI Prompt Updates

**Files:**
- Modify: `app/src/lib/ai/agent/tools/generate-section.ts`
- Modify: `app/src/lib/ai/agent/tools/regenerate-section.ts`
- Modify: `app/src/lib/ai/orchestrator/prompts/build-section.ts`

- [ ] **Step 1: Update generate-section.ts prompt**

In `app/src/lib/ai/agent/tools/generate-section.ts`, replace lines 98-105 (the RULES block):

```typescript
// OLD:
RULES:
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- Be specific, use concrete numbers and timelines
- Reference evaluation criteria where relevant
- Maintain consistency with previously written sections
- Use formal but accessible language for EU funding applications
- Do NOT use placeholder text like [insert here] or TBD

OUTPUT: Write the section content directly. No JSON wrapping needed.

// NEW:
RULES:
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- Be specific, use concrete numbers and timelines
- Reference evaluation criteria where relevant
- Maintain consistency with previously written sections
- Use formal but accessible language for EU funding applications
- Do NOT use placeholder text like [insert here] or TBD

FORMAT:
- Use ## for sub-section headings within this section
- Use ### for sub-sub-headings if needed
- Use **bold** for key terms, regulation names, and important values
- Use bullet lists (-) for enumerations of items, criteria, or features
- Use numbered lists (1.) only for ordered steps, phases, or ranked criteria
- Write in clear paragraphs between structured elements
- Do NOT use code fences, blockquotes, images, links, or HTML
- Do NOT include a section title heading — it is added separately

OUTPUT: Write the section content directly. No JSON wrapping needed.
```

- [ ] **Step 2: Update regenerate-section.ts prompt**

In `app/src/lib/ai/agent/tools/regenerate-section.ts`, replace lines 64-69 (the RULES block):

```typescript
// OLD:
RULES:
- Address the feedback specifically
- Maintain the parts that were good
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- No placeholder text
- Output the full rewritten section content directly

// NEW:
RULES:
- Address the feedback specifically
- Maintain the parts that were good
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- No placeholder text
- Output the full rewritten section content directly

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

- [ ] **Step 3: Update build-section.ts prompt**

In `app/src/lib/ai/orchestrator/prompts/build-section.ts`, replace lines 48-55:

```typescript
// OLD:
RULES:
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- Be specific, use concrete numbers and timelines
- Reference the evaluation criteria where relevant
- Maintain consistency with previously written sections
- Use formal but accessible language appropriate for EU funding applications

OUTPUT: Return ONLY valid JSON: { "title": "...", "content": "...", "order": ${sectionSpec.order} }

// NEW:
RULES:
- Write in ${ctx.locale === 'en' ? 'English' : 'Romanian'}
- Be specific, use concrete numbers and timelines
- Reference the evaluation criteria where relevant
- Maintain consistency with previously written sections
- Use formal but accessible language appropriate for EU funding applications

FORMAT (for the "content" field):
- Use ## for sub-section headings within this section
- Use ### for sub-sub-headings if needed
- Use **bold** for key terms, regulation names, and important values
- Use bullet lists (-) for enumerations of items, criteria, or features
- Use numbered lists (1.) only for ordered steps, phases, or ranked criteria
- Write in clear paragraphs between structured elements
- Do NOT use code fences, blockquotes, images, links, or HTML
- Do NOT include a section title heading — it is added separately

OUTPUT: Return ONLY valid JSON: { "title": "...", "content": "...", "order": ${sectionSpec.order} }
```

- [ ] **Step 4: Add normalizeMarkdown call in build.ts after parsing**

In `app/src/lib/ai/orchestrator/agents/build.ts`, after `parseAIJson` extracts the content (around line 112), add normalization:

```typescript
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

// After: const finalContent = parsed.content || result.content
const finalContent = normalizeMarkdown(parsed.content || result.content)
```

Do the same in `generate-section.ts` after extracting content (around line 115):

```typescript
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

// After: const content = response.content.trim()
const content = normalizeMarkdown(response.content.trim())
```

And in `regenerate-section.ts` (around line 82):

```typescript
import { normalizeMarkdown } from '@/lib/markdown/proposal-markdown'

// After: const content = response.content.trim()
const content = normalizeMarkdown(response.content.trim())
```

- [ ] **Step 5: Run typecheck**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 0

- [ ] **Step 6: Run full test suite**

Run: `cd app && npx vitest run`
Expected: Same baseline failures, no new failures

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/agent/tools/generate-section.ts app/src/lib/ai/agent/tools/regenerate-section.ts app/src/lib/ai/orchestrator/prompts/build-section.ts app/src/lib/ai/orchestrator/agents/build.ts
git commit -m "feat: add markdown FORMAT rules to AI prompts, normalize output"
```

---

### Task 8: Version History Markdown Preview

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/components/ProposalTab.tsx`

- [ ] **Step 1: Update version history content display**

In `ProposalTab.tsx`, the `SectionHistoryPanel` shows version content on line 173 as plain text:
```tsx
<div className="... whitespace-pre-wrap ...">
  {v.content}
</div>
```

Replace with:
```tsx
<div className="... ...">
  <MarkdownPreview content={v.content} />
</div>
```

Remove the `whitespace-pre-wrap` class since `MarkdownPreview` handles its own layout.

- [ ] **Step 2: Run typecheck**

Run: `cd app && npx tsc --noEmit 2>&1 | grep -c "error TS"`
Expected: 0

- [ ] **Step 3: Commit**

```bash
git add app/src/app/*/asistent-ai/components/ProposalTab.tsx
git commit -m "feat: render markdown in version history panel"
```

---

## Post-Implementation Verification

After all tasks are complete:

1. `cd app && npx tsc --noEmit` — zero errors
2. `cd app && npx vitest run` — same baseline, no new failures
3. `cd app && npx vitest run tests/unit/proposal-markdown.test.ts tests/unit/docx-structure.test.ts` — all new tests pass
4. Manual: Start dev server, open AI assistant, trigger section generation → canvas preview shows headings/bold/lists
5. Manual: Download a section DOCX → open in Word → verify Times New Roman, headings, lists, cover page, page numbers
6. Manual: View old plain-text sections → still render as paragraphs (no regression)
