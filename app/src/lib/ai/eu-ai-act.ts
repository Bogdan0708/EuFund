/**
 * EU AI Act Compliance Module
 * 
 * Implements requirements from the EU Artificial Intelligence Act (Regulation 2024/1689)
 * for AI systems used in EU funding platform operations.
 */

import { logger } from '@/lib/logger';

const log = logger.child({ component: 'eu-ai-act' });

// ─── Risk Classification (Article 6) ───

export enum AIRiskLevel {
  MINIMAL = 'minimal',      // No specific obligations
  LIMITED = 'limited',       // Transparency obligations
  HIGH = 'high',             // Full compliance required
  UNACCEPTABLE = 'unacceptable', // Prohibited
}

interface AIFeatureClassification {
  feature: string;
  riskLevel: AIRiskLevel;
  rationale: string;
  obligations: string[];
}

export const AI_FEATURE_CLASSIFICATIONS: Record<string, AIFeatureClassification> = {
  'analyze-document': {
    feature: 'Document Analysis',
    riskLevel: AIRiskLevel.MINIMAL,
    rationale: 'Text summarization/extraction without decision-making impact',
    obligations: ['transparency_notice'],
  },
  'forecast-lifecycle': {
    feature: 'Project Lifecycle Forecasting',
    riskLevel: AIRiskLevel.LIMITED,
    rationale: 'Predictive analytics that may influence funding decisions',
    obligations: ['transparency_notice', 'human_oversight', 'decision_logging'],
  },
  'generate-proposal': {
    feature: 'Proposal Generation',
    riskLevel: AIRiskLevel.MINIMAL,
    rationale: 'Content generation as a drafting tool, human reviews output',
    obligations: ['transparency_notice'],
  },
  'match-grants': {
    feature: 'Grant Matching',
    riskLevel: AIRiskLevel.LIMITED,
    rationale: 'Recommendation system that influences access to public funding',
    obligations: ['transparency_notice', 'human_oversight', 'decision_logging', 'bias_monitoring'],
  },
  'predict-success': {
    feature: 'Success Prediction',
    riskLevel: AIRiskLevel.HIGH,
    rationale: 'Scoring/ranking system that may determine access to EU public funds (Annex III)',
    obligations: ['transparency_notice', 'human_oversight', 'decision_logging', 'bias_monitoring', 'risk_assessment', 'data_governance'],
  },
  'validate-compliance': {
    feature: 'Compliance Validation',
    riskLevel: AIRiskLevel.LIMITED,
    rationale: 'Regulatory checking tool — advisory only, human makes final decision',
    obligations: ['transparency_notice', 'decision_logging'],
  },
};

// ─── Transparency (Article 52) ───

export function getTransparencyDisclaimer(feature: string, locale: string = 'en'): string {
  const classification = AI_FEATURE_CLASSIFICATIONS[feature];
  const riskLevel = classification?.riskLevel || AIRiskLevel.LIMITED;

  const disclaimers: Record<string, Record<string, string>> = {
    en: {
      minimal: 'This content was generated with AI assistance. Please verify independently.',
      limited: 'This analysis was produced by an AI system. Results should be reviewed by a qualified professional before making decisions.',
      high: '⚠️ This assessment was produced by an AI system classified as high-risk under the EU AI Act. It must be reviewed and approved by a qualified human decision-maker before any action is taken.',
    },
    ro: {
      minimal: 'Acest conținut a fost generat cu asistență AI. Vă rugăm să verificați independent.',
      limited: 'Această analiză a fost produsă de un sistem AI. Rezultatele trebuie revizuite de un profesionist calificat înainte de a lua decizii.',
      high: '⚠️ Această evaluare a fost produsă de un sistem AI clasificat ca risc ridicat conform Regulamentului UE privind IA. Trebuie revizuită și aprobată de un factor de decizie uman calificat.',
    },
  };

  return disclaimers[locale]?.[riskLevel] || disclaimers.en[riskLevel] || disclaimers.en.limited;
}

// ─── Human Oversight (Article 14) ───

export interface OversightFlag {
  requiresReview: boolean;
  reason: string;
  confidence: number;
  feature: string;
}

export function checkHumanOversight(feature: string, confidence: number): OversightFlag {
  const classification = AI_FEATURE_CLASSIFICATIONS[feature];
  const needsOversight = classification?.obligations.includes('human_oversight') || false;

  // Low confidence predictions should be flagged for human review
  const lowConfidenceThreshold = 0.5;
  const flagLowConfidence = confidence < lowConfidenceThreshold;

  const requiresReview = needsOversight || flagLowConfidence;

  const flag: OversightFlag = {
    requiresReview,
    reason: flagLowConfidence
      ? `Low confidence (${(confidence * 100).toFixed(1)}%) — requires human verification`
      : needsOversight
        ? `Feature '${feature}' requires human oversight per EU AI Act`
        : 'No oversight required',
    confidence,
    feature,
  };

  if (requiresReview) {
    log.info({ flag }, 'Human oversight flag raised');
  }

  return flag;
}

// ─── PII Stripping (Data Minimization - Article 10) ───

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  { name: 'email', pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL_REDACTED]' },
  { name: 'phone_intl', pattern: /\+?[0-9]{1,4}[\s.-]?\(?[0-9]{1,4}\)?[\s.-]?[0-9]{2,4}[\s.-]?[0-9]{2,4}[\s.-]?[0-9]{0,4}/g, replacement: '[PHONE_REDACTED]' },
  { name: 'romanian_cnp', pattern: /\b[1-8]\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6}\b/g, replacement: '[CNP_REDACTED]' },
  { name: 'romanian_cui', pattern: /\bRO?\d{2,10}\b/gi, replacement: '[CUI_REDACTED]' },
  { name: 'iban', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, replacement: '[IBAN_REDACTED]' },
  { name: 'credit_card', pattern: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, replacement: '[CARD_REDACTED]' },
  { name: 'ip_address', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[IP_REDACTED]' },
];

export function stripPII(text: string): { cleaned: string; redactions: string[] } {
  const redactions: string[] = [];
  let cleaned = text;

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    const matches = cleaned.match(pattern);
    if (matches) {
      redactions.push(`${name}: ${matches.length} instance(s)`);
      cleaned = cleaned.replace(pattern, replacement);
    }
  }

  if (redactions.length > 0) {
    log.info({ redactions }, 'PII stripped from AI input');
  }

  return { cleaned, redactions };
}

// ─── Decision Logging (Article 12 - Record-Keeping) ───

export interface AIDecisionLog {
  timestamp: string;
  feature: string;
  riskLevel: AIRiskLevel;
  inputHash: string;  // SHA-256 of input (not the input itself)
  outputSummary: string;
  confidence?: number;
  oversightRequired: boolean;
  userId?: string;
  tenantId?: string;
}

export function logAIDecision(decision: Omit<AIDecisionLog, 'timestamp'>): void {
  const entry: AIDecisionLog = {
    ...decision,
    timestamp: new Date().toISOString(),
  };

  log.info({ aiDecision: entry }, `AI decision: ${decision.feature} [${decision.riskLevel}]`);
}

// ─── Wrapper for AI Route Handlers ───

export function withEUAIActCompliance<T>(
  feature: string,
  handler: (input: T) => Promise<{ result: unknown; confidence?: number }>,
) {
  return async (input: T, userId?: string, tenantId?: string) => {
    const classification = AI_FEATURE_CLASSIFICATIONS[feature];
    
    // Strip PII if sending to external provider
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
    const { cleaned, redactions } = stripPII(inputStr);

    // Create input hash for audit (not storing actual input)
    const encoder = new TextEncoder();
    const data = encoder.encode(cleaned);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const inputHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Execute handler
    const { result, confidence } = await handler(input);

    // Check human oversight
    const oversight = checkHumanOversight(feature, confidence || 0);

    // Log decision
    logAIDecision({
      feature,
      riskLevel: classification?.riskLevel || AIRiskLevel.LIMITED,
      inputHash,
      outputSummary: typeof result === 'string' ? result.substring(0, 200) : 'structured_output',
      confidence,
      oversightRequired: oversight.requiresReview,
      userId,
      tenantId,
    });

    // Add transparency disclaimer
    const disclaimer = getTransparencyDisclaimer(feature);

    return {
      result,
      metadata: {
        aiGenerated: true,
        disclaimer,
        riskLevel: classification?.riskLevel,
        oversightRequired: oversight.requiresReview,
        oversightReason: oversight.requiresReview ? oversight.reason : undefined,
        piiRedactions: redactions.length > 0 ? redactions : undefined,
      },
    };
  };
}
