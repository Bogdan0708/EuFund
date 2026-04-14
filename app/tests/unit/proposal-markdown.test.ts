import { describe, it, expect } from 'vitest'
import { parseInlineRuns, parseMarkdownBlocks, normalizeMarkdown, type Block } from '@/lib/markdown/proposal-markdown'

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
