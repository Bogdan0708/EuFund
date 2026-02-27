import { EU_PROGRAMS, type EUProgramKey } from './eu-knowledge-base';

const PROGRAM_ALIASES = new Set<string>(
  Object.entries(EU_PROGRAMS).flatMap(([key, program]) => {
    const labels = [
      key,
      program.name,
      program.namero,
      ...(program.name.includes(' ') ? [program.name.replace(/\s+/g, '')] : []),
    ];
    return labels.map((label) => label.toLowerCase());
  }),
);

const REFERENCE_PATTERN = /\b(?:Horizon(?:\s+Europe)?|Orizont(?:\s+Europa)?|LIFE\+?|Interreg|POCIDIF|PNRR|ERDF|FEDR)\b[^\n,.;:)]*/gi;

export interface FactCheckResult<T> {
  annotated: T;
  references: string[];
  unverifiableClaims: string[];
  confidenceScore: number;
}

export interface FactWarning {
  type: 'incorrect_budget' | 'incorrect_period' | 'incorrect_rate' | 'incorrect_trl' | 'unverifiable_claim';
  program?: string;
  expected?: string;
  found?: string;
  claim?: string;
}

function normalizeReference(ref: string): string {
  return ref
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractReferences(text: string): string[] {
  return [...text.matchAll(REFERENCE_PATTERN)]
    .map((match) => match[0].trim())
    .filter((ref, idx, arr) => arr.findIndex((r) => normalizeReference(r) === normalizeReference(ref)) === idx);
}

function isVerifiable(ref: string, expectedProgram?: EUProgramKey): boolean {
  const normalized = normalizeReference(ref);
  if (expectedProgram) {
    const expected = EU_PROGRAMS[expectedProgram];
    const expectedLabels = [expectedProgram, expected.name, expected.namero].map((label) => label.toLowerCase());
    if (expectedLabels.some((label) => normalized.includes(label))) return true;
  }

  for (const alias of PROGRAM_ALIASES) {
    if (normalized.includes(alias)) return true;
  }
  return false;
}

function annotateUnknownClaimsInString(value: string, unknownClaims: string[]): string {
  let result = value;
  for (const claim of unknownClaims) {
    const normalizedClaim = claim.trim();
    if (!normalizedClaim) continue;
    if (result.includes(normalizedClaim) && !result.includes(`${normalizedClaim} [AI-generated, unverified]`)) {
      result = result.replaceAll(normalizedClaim, `${normalizedClaim} [AI-generated, unverified]`);
    }
  }
  return result;
}

function annotateDeep<T>(input: T, unknownClaims: string[]): T {
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return annotateUnknownClaimsInString(node, unknownClaims);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object' && !(node instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(value);
      }
      return out;
    }
    return node;
  };
  return walk(input) as T;
}

export function factCheckGeneratedContent<T>(input: T, options?: { expectedProgram?: EUProgramKey }): FactCheckResult<T> {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  const references = extractReferences(text);
  const unverifiableClaims = references.filter((ref) => !isVerifiable(ref, options?.expectedProgram));

  const totalRefs = references.length;
  const verifiedRefs = totalRefs - unverifiableClaims.length;
  const confidenceScore = totalRefs === 0 ? 0.9 : Math.max(0, Math.min(1, verifiedRefs / totalRefs));

  return {
    annotated: annotateDeep(input, unverifiableClaims),
    references,
    unverifiableClaims,
    confidenceScore,
  };
}

export function checkFacts(text: string): { passed: boolean; warnings: FactWarning[] } {
  const warnings: FactWarning[] = [];
  const lower = text.toLowerCase();

  // Horizon Europe checks
  if (lower.includes('horizon europe')) {
    const budgetMatch = text.match(/€?\s*([0-9]+(?:\.[0-9]+)?)\s*billion/i);
    if (budgetMatch && budgetMatch[1] !== '95.5') {
      warnings.push({
        type: 'incorrect_budget',
        program: 'Horizon Europe',
        expected: '€95.5 billion',
        found: budgetMatch[0],
      });
    }

    const trlMatch = text.match(/TRL\s*([0-9]\s*-\s*[0-9])/i);
    if (trlMatch && trlMatch[1].replace(/\s+/g, '') === '1-9') {
      warnings.push({
        type: 'incorrect_trl',
        program: 'Horizon Europe',
        expected: 'TRL 2-5 (RIA), TRL 5-8 (IA)',
        found: trlMatch[0],
      });
    }
  }

  // PNRR period check
  if (lower.includes('pnrr')) {
    const periodMatch = text.match(/\b(20\d{2}\s*-\s*20\d{2})\b/);
    if (periodMatch && periodMatch[1].replace(/\s+/g, '') !== '2021-2026') {
      warnings.push({
        type: 'incorrect_period',
        program: 'PNRR',
        expected: '2021-2026',
        found: periodMatch[1],
      });
    }
  }

  // LIFE co-financing check
  if (lower.includes('life')) {
    const rateMatch = text.match(/([0-9]{2,3})%\s*(?:co-?finanțare|cofinancing|cofinan(?:t|ț)are)/i);
    if (rateMatch && !['60', '75'].includes(rateMatch[1])) {
      warnings.push({
        type: 'incorrect_rate',
        program: 'LIFE Programme',
        expected: '60% standard / 75% nature-biodiversity',
        found: `${rateMatch[1]}%`,
      });
    }
  }

  const genericCheck = factCheckGeneratedContent(text);
  for (const claim of genericCheck.unverifiableClaims) {
    warnings.push({
      type: 'unverifiable_claim',
      claim,
    });
  }

  return { passed: warnings.length === 0, warnings };
}

