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

  return runs
}

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

    // Heading ###  (check before ## since ### starts with ##)
    const h3 = line.match(HEADING3_RE)
    if (h3) {
      blocks.push({ type: 'heading', level: 3, runs: parseInlineRuns(h3[1]) })
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

// ─── Normalizer ─────────────────────────────────────────────────

export function normalizeMarkdown(raw: string): string {
  if (!raw) return ''

  let result = raw

  // 1. Strip code fences (``` ... ```) — balanced pairs first, then unclosed
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split('\n')
    return lines.slice(1, -1).join('\n')
  })
  // Fallback: strip unclosed fence (LLM opened but didn't close)
  result = result.replace(/^```[^\n]*\n?/m, '')

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
