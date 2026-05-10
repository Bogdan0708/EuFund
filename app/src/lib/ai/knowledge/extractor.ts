// ─── AI Extraction Layer ──────────────────────────────────────────
// Extracts structured eligibility rules from "Ghidul Solicitantului"

import { aiGenerateObject } from '../client';
import { extractedCallSchema, type ExtractedCall } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'knowledge-extractor' });

/**
 * Uses AI to parse raw document text into structured funding call data.
 * Optimized for Romanian EU funding guides.
 */
export async function extractCallDataFromText(text: string): Promise<ExtractedCall> {
  log.info('Starting AI extraction from document text');

  const systemPrompt = `Ești un expert în fonduri europene (PNRR, Programe Operaționale). 
Sarcina ta este să citești textul dintr-un "Ghid al Solicitantului" și să extragi datele esențiale pentru configurarea unui sistem de matching.

EXTRAGE URMĂTOARELE:
1. Codul apelului (ex: PNRR/2024/C9/I1).
2. Titlul oficial al apelului în română.
3. Tipuri de entități eligibile (srl, sa, ong, pfa, uat, etc.). Maprează-le la: 'srl', 'sa', 'ong', 'pfa', 'uat', 'institutie_publica'.
4. Coduri CAEN eligibile (listă de string-uri de 4 cifre).
5. Regiuni eligibile (coduri NUTS, ex: RO11, RO21 sau nume de județe).
6. Valoare grant: minim și maxim (în EUR).
7. Rata de cofinanțare minimă obligatorie (procent).
8. Durata proiectului (luni): minim și maxim.
9. Termen limită depunere.

Dacă o informație nu este clară în fragmentul oferit, las-o goală sau folosește valori rezonabile bazate pe context.`;

  const prompt = `Analizează următorul fragment din Ghidul Solicitantului și extrage datele structurate conform schemei:

--- BEGIN DOCUMENT TEXT ---
${text.substring(0, 15000)} 
--- END DOCUMENT TEXT ---

Notă: Dacă textul este foarte lung, am inclus doar primele 15.000 de caractere care conțin de obicei datele de eligibilitate.`;

  try {
    const { object, tokensUsed } = await aiGenerateObject({
      system: systemPrompt,
      prompt,
      schema: extractedCallSchema,
      schemaName: 'ExtractedCall',
      temperature: 0.1, // Low temperature for higher accuracy in data extraction
      taskType: 'structure_extraction',
    });

    if (!object) {
      throw new Error('AI failed to extract structured call data');
    }

    log.info({ callCode: object.callCode, tokensUsed }, 'AI extraction successful');
    return object;
  } catch (error) {
    log.error({ error }, 'Failed to extract call data via AI');
    throw error;
  }
}
