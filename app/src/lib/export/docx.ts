import PizZip from 'pizzip'
import type { SectionResult } from '@/lib/ai/orchestrator/types'
import { parseMarkdownBlocks } from '@/lib/markdown/proposal-markdown'
import { blocksToOoxml, escapeXml, STYLES_XML, NUMBERING_XML } from './markdown-to-ooxml'

interface ExportOptions {
  projectTitle: string
  program?: string
  applicant?: string
  date?: string
}

const FOOTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:fldChar w:fldCharType="begin"/></w:r>
    <w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
    <w:r><w:fldChar w:fldCharType="separate"/></w:r>
    <w:r><w:t>1</w:t></w:r>
    <w:r><w:fldChar w:fldCharType="end"/></w:r>
  </w:p>
</w:ftr>`

export async function generateDocx(
  sections: SectionResult[],
  options: ExportOptions
): Promise<Buffer> {
  const zip = new PizZip()

  // [Content_Types].xml
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`)

  // _rels/.rels
  zip.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

  // Build document body
  const body = buildDocumentBody(sections, options)

  const wordFolder = zip.folder('word')!
  wordFolder.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr></w:body>
</w:document>`)

  wordFolder.file('styles.xml', STYLES_XML)
  wordFolder.file('numbering.xml', NUMBERING_XML)
  wordFolder.file('footer1.xml', FOOTER_XML)

  wordFolder.folder('_rels')!.file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`)

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

function buildDocumentBody(sections: SectionResult[], options: ExportOptions): string {
  const title = options.projectTitle.trim()
    ? escapeXml(options.projectTitle)
    : 'Cerere de finan\u021bare'
  const date = options.date || new Date().toISOString().split('T')[0]

  let body = ''

  // Cover page — title
  body += `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="4000"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="64"/><w:szCs w:val="64"/></w:rPr><w:t>${title}</w:t></w:r></w:p>`

  // Cover page — program (only if provided)
  if (options.program) {
    body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>Program: ${escapeXml(options.program)}</w:t></w:r></w:p>`
  }

  // Cover page — applicant (only if provided)
  if (options.applicant) {
    body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>${escapeXml(options.applicant)}</w:t></w:r></w:p>`
  }

  // Cover page — date
  body += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${date}</w:t></w:r></w:p>`

  // Page break after cover
  body += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`

  // Sections
  const sorted = [...sections].sort((a, b) => a.order - b.order)
  for (const section of sorted) {
    // Section heading as Heading1
    body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${section.order}. ${escapeXml(section.title)}</w:t></w:r></w:p>`

    // Parse markdown content and convert to OOXML
    const blocks = parseMarkdownBlocks(section.content)
    body += blocksToOoxml(blocks)

    // Spacing after section
    body += `<w:p/>`
  }

  return body
}
