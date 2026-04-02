import PizZip from 'pizzip'
import type { SectionResult } from '@/lib/ai/orchestrator/types'

interface ExportOptions {
  projectTitle: string
  program?: string
  applicant?: string
  date?: string
}

export async function generateDocx(
  sections: SectionResult[],
  options: ExportOptions
): Promise<Buffer> {
  // Build a simple DOCX from scratch using PizZip with XML content
  const content = buildDocxContent(sections, options)

  // Create a minimal DOCX template programmatically
  const zip = new PizZip()

  // [Content_Types].xml
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)

  // _rels/.rels
  zip.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

  // word/document.xml
  zip.folder('word')!.file('document.xml', content)

  // word/_rels/document.xml.rels
  zip.folder('word')!.folder('_rels')!.file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`)

  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
  return buffer
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildDocxContent(sections: SectionResult[], options: ExportOptions): string {
  const title = escapeXml(options.projectTitle)
  const program = options.program ? escapeXml(options.program) : ''
  const date = options.date || new Date().toISOString().split('T')[0]

  let body = ''

  // Title
  body += `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>${title}</w:t></w:r></w:p>`

  // Program and date
  if (program) {
    body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
      <w:r><w:t>Program: ${program}</w:t></w:r></w:p>`
  }
  body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:t>Data: ${date}</w:t></w:r></w:p>`

  // Page break after cover
  body += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`

  // Sections
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  for (const section of sorted) {
    // Section heading
    body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr>
      <w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>${section.order}. ${escapeXml(section.title)}</w:t></w:r></w:p>`

    // Section content — split by newlines into paragraphs
    const paragraphs = section.content.split('\n').filter((p: string) => p.trim())
    for (const para of paragraphs) {
      body += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(para)}</w:t></w:r></w:p>`
    }

    // Spacing after section
    body += `<w:p/>`
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`
}
