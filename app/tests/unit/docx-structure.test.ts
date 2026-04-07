import { describe, it, expect } from 'vitest'
import PizZip from 'pizzip'
import { blocksToOoxml } from '@/lib/export/markdown-to-ooxml'
import { parseMarkdownBlocks } from '@/lib/markdown/proposal-markdown'
import { generateSectionDocx } from '@/lib/export/section-docx'
import { generateDocx } from '@/lib/export/docx'

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
    expect(docXml).toContain('w:w="11906"')
    expect(docXml).toContain('w:h="16838"')
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
