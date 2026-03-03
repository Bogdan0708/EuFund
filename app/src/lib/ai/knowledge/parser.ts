import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as xlsx from 'xlsx';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'knowledge-parser' });

export interface ParsedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    sheetNames?: string[];
    format: string;
  };
}

/**
 * Universal Parser for Knowledge Ingestion
 */
export async function parseKnowledgeFile(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<ParsedDocument> {
  const extension = filename.split('.').pop()?.toLowerCase();
  
  log.info({ filename, extension, contentType }, 'Parsing knowledge file');

  try {
    // 1. PDF Parsing
    if (extension === 'pdf' || contentType === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();
      await parser.destroy();
      return {
        text: textResult.text,
        metadata: { pageCount: textResult.total, format: 'pdf' }
      };
    }

    // 2. Word (DOCX) Parsing
    if (extension === 'docx' || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return {
        text: result.value,
        metadata: { format: 'docx' }
      };
    }

    // 3. Excel (XLSX) Parsing
    if (extension === 'xlsx' || extension === 'xls' || contentType.includes('spreadsheet')) {
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      let fullText = '';
      
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        fullText += `
--- Sheet: ${sheetName} ---
`;
        fullText += xlsx.utils.sheet_to_txt(sheet);
      });

      return {
        text: fullText,
        metadata: { sheetNames: workbook.SheetNames, format: 'xlsx' }
      };
    }

    // 4. Text / Markdown
    if (extension === 'md' || extension === 'txt' || contentType.startsWith('text/')) {
      return {
        text: buffer.toString('utf8'),
        metadata: { format: extension || 'txt' }
      };
    }

    throw new Error(`Unsupported file format: ${extension}`);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, filename }, 'Failed to parse document');
    throw new Error(`Parser Error: ${message}`);
  }
}
