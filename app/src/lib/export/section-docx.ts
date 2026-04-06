import PizZip from 'pizzip'
import { slugify } from '@/lib/compliance/interpolate'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapDocx(bodyXml: string): Buffer {
  const zip = new PizZip()

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)

  zip.folder('_rels')!.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

  zip.folder('word')!.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyXml}</w:body>
</w:document>`)

  zip.folder('word')!.folder('_rels')!.file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`)

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export function generateSectionDocx(opts: { title: string; content: string; order: number }): Buffer {
  let body = ''
  body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>${opts.order}. ${escapeXml(opts.title)}</w:t></w:r></w:p>`

  const paragraphs = opts.content.split('\n').filter(p => p.trim())
  for (const para of paragraphs) {
    body += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(para)}</w:t></w:r></w:p>`
  }

  return wrapDocx(body)
}

export function generateFormDocx(opts: { title: string; content: string }): Buffer {
  let body = ''
  body += `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>${escapeXml(opts.title)}</w:t></w:r></w:p>`
  body += `<w:p/>`

  const paragraphs = opts.content.split('\n')
  for (const para of paragraphs) {
    if (!para.trim()) {
      body += `<w:p/>`
    } else {
      body += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(para)}</w:t></w:r></w:p>`
    }
  }

  return wrapDocx(body)
}

export function buildSectionStoragePath(projectId: string, order: number, title: string): string {
  const paddedOrder = String(order).padStart(2, '0')
  return `projects/${projectId}/propunere/${paddedOrder}-${slugify(title)}.docx`
}

export function buildFormStoragePath(projectId: string, scope: 'general' | 'call_specific', title: string): string {
  const folder = scope === 'general' ? 'generale' : 'apel'
  return `projects/${projectId}/formulare/${folder}/${slugify(title)}.docx`
}
