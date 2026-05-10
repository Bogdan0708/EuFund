// ─── Romanian AI Specialization ──────────────────────────────────
// Specialized logic for Romanian cultural, administrative and legal context

import { logger } from '@/lib/logger';
import { queryRomanianBert } from './client';

const log = logger.child({ component: 'romanian-specialist' });

export interface RomanianContentInput {
  content: string;
  context: 'document_analysis' | 'proposal_generation' | 'match_grants' | 'compliance_validation';
  documentType?: string;
  additionalContext?: Record<string, any>;
}

export interface RomanianAnalysisResult {
  context: string;
  detectedEntities?: any[];
  administrativeScore?: number;
}

/**
 * Analyzes content specifically for Romanian cultural and administrative context.
 * Uses Romanian BERT for entity extraction and provides specialized context strings
 * to enhance LLM prompts.
 */
export async function analyzeRomanianContent(
  input: RomanianContentInput
): Promise<RomanianAnalysisResult> {
  const startTime = performance.now();
  
  try {
    // 1. Extract Romanian entities using BERT (Named Entity Recognition)
    // We take a snippet of the content to stay within BERT limits
    const snippet = input.content.slice(0, 1000);
    const entities = await queryRomanianBert({
      inputs: snippet,
      task: 'ner'
    }).catch(err => {
      log.warn({ err }, 'Romanian BERT analysis failed, continuing with fallback');
      return [];
    });

    // 2. Build specialized context string based on the task
    let contextStr = '';
    
    switch (input.context) {
      case 'document_analysis':
        contextStr = `Documentul este în limba română și trebuie analizat conform standardelor administrative românești. 
Atenție la terminologia specifică (CUI, CNP, IBAN, RO-eFactura). 
${input.documentType ? `Tip document detectat: ${input.documentType}` : ''}`;
        break;
      case 'proposal_generation':
        contextStr = `Generarea propunerii trebuie să respecte stilul formal și birocratic românesc. 
Utilizează terminologia oficială din ghidurile de finanțare (Solicitant, Eligibilitate, Cheltuieli eligibile).`;
        break;
      default:
        contextStr = `Analiză în contextul administrativ și legal din România.`;
    }

    return {
      context: contextStr,
      detectedEntities: Array.isArray(entities) ? entities : [],
      administrativeScore: 0.85 // Placeholder for future quality scoring
    };
  } catch (error) {
    log.error({ error }, 'Romanian content analysis failed');
    return {
      context: 'Analiză generală în limba română.',
    };
  } finally {
    log.info({ 
      durationMs: Number((performance.now() - startTime).toFixed(2)),
      context: input.context 
    }, 'Romanian specialization analysis completed');
  }
}

/**
 * Helper to identify Romanian document types from metadata
 */
export function getRomanianDocumentType(filename: string, mimeType: string): string {
  const name = filename.toLowerCase();
  
  if (name.includes('cerere') || name.includes('finantare')) return 'Cerere de finanțare';
  if (name.includes('declaratie')) return 'Declarație pe propria răspundere';
  if (name.includes('raport') || name.includes('progres')) return 'Raport de progres';
  if (name.includes('certificat')) return 'Certificat de eligibilitate';
  if (name.includes('bilant') || name.includes('contabil')) return 'Bilanț contabil';
  if (mimeType.includes('pdf')) return 'Document PDF oficial';
  
  return 'Document administrativ';
}
