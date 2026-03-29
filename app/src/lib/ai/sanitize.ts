// ─── AI Prompt Injection Protection & Output Sanitization ───────
// Sanitizes and wraps user input to prevent prompt injection attacks.
// Also sanitizes AI output to strip leaked PII (GDPR data minimization).

import DOMPurify from 'isomorphic-dompurify';
import { stripPII } from './eu-ai-act';

/**
 * Maximum allowed lengths for various AI input fields.
 */
export const AI_INPUT_LIMITS = {
  chatMessage: 4000,
  projectIdea: 8000,
  documentContent: 15000,
  projectContext: 2000,
  callContext: 2000,
  organizationName: 200,
  sector: 200,
  genericField: 2000,
} as const;

// ─── Hardened Prompt Security (Sprint 1-3 remediation) ───────────
const INVISIBLE_OR_BIDI_PATTERN = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CYRILLIC_CONFUSABLE_PATTERN = /[аАеЕоОіІрРсСуУхХкКмМтТвВнНзЗьЬ]/g;
const ASCII_DELIMITER_LOOKALIKE_PATTERN = /---\s*(?:BEGIN|END)\b|<<<|>>>/i;
const NON_TEXT_PAYLOAD_THRESHOLD = 0.02;
const REPLACEMENT_CHAR_PENALTY = 5;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_AI_API_KEY|GATEWAY_MASTER_KEY|NEXTAUTH_SECRET|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|QDRANT_API_KEY|AI_GATEWAY_API_KEY)\b\s*[:=]\s*[^\s"'`]+/gi;
const TOKEN_LIKE_PATTERN = /\b(?:sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z\-_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9\-_]+)\b/g;
const PROMPT_LEAK_PATTERN = /(^|\n)\s*(?:system prompt|developer message|hidden instructions?)\s*:\s*([^\n]+)/gi;

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a', А: 'A', е: 'e', Е: 'E', о: 'o', О: 'O', і: 'i', І: 'I',
  р: 'p', Р: 'P', с: 'c', С: 'C', у: 'y', У: 'Y', х: 'x', Х: 'X',
  к: 'k', К: 'K', м: 'm', М: 'M', т: 't', Т: 'T', в: 'v', В: 'V',
  н: 'n', Н: 'H', з: '3', З: '3', ь: 'b', Ь: 'B',
};

/**
 * Normalize text before security processing:
 * NFKC canonicalization, Cyrillic homoglyph replacement, invisible char removal.
 */
export function normalizePromptInput(text: string): string {
  return text
    .normalize('NFKC')
    .replace(CYRILLIC_CONFUSABLE_PATTERN, (char) => CYRILLIC_TO_LATIN_MAP[char] ?? char)
    .replace(INVISIBLE_OR_BIDI_PATTERN, '')
    .replace(CONTROL_CHAR_PATTERN, ' ');
}

/**
 * Heuristic check for binary/non-text payloads injected into text fields.
 */
export function isLikelyNonTextPayload(text: string): boolean {
  if (!text) return false;
  const sample = text.slice(0, 2048);
  let suspiciousChars = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 9 || (code > 13 && code < 32) || code === 127)) {
      suspiciousChars++;
    }
  }
  if (sample.includes('\uFFFD')) suspiciousChars += REPLACEMENT_CHAR_PENALTY;
  return sample.length > 0 && suspiciousChars / sample.length > NON_TEXT_PAYLOAD_THRESHOLD;
}

/**
 * Known prompt injection patterns to detect and flag.
 * These are logged for monitoring; boundary isolation remains primary defense.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /forget\s+(the\s+)?(rules|instructions|system\s+prompt)/i,
  /(override|bypass|disable|break|evade)\s+(all\s+)?(safety|security|guardrails?|polic(?:y|ies))/i,
  /(new|updated)\s+instructions?\s*:/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /(act|behave|roleplay|pretend)\s+as\s+(?:a|an)\s+/i,
  /(reveal|show|display|print|dump)\s+(the\s+)?(system\s+prompt|developer\s+message|hidden\s+instructions?)/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /<\/?INST>/i,
  /<\|(?:im_start|im_end|system|user|assistant)\|>/i,
  /<<\s*SYS\s*>>/i,
  /HUMAN\s*:\s*$/m,
  /ASSISTANT\s*:\s*$/m,
];

/**
 * Check if text contains potential injection patterns.
 * Returns true if suspicious patterns are detected.
 */
export function detectInjectionAttempt(text: string): boolean {
  const normalized = normalizePromptInput(text);
  return ASCII_DELIMITER_LOOKALIKE_PATTERN.test(normalized)
    || INJECTION_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Wraps user-provided text in clear delimiters so the LLM can distinguish
 * user data from system instructions. This is the primary defense against
 * prompt injection.
 *
 * Uses a unique delimiter format that's unlikely to appear in natural text.
 */
export function wrapUserInput(text: string, label: string = 'USER_INPUT'): string {
  // Strip any attempt to include our own delimiters in the input
  const sanitized = text
    .replace(/<<<[A-Z_]+>>>/g, '')
    .replace(/───[A-Z_\s]+───/g, '');

  return `───BEGIN_${label}───\n${sanitized}\n───END_${label}───`;
}

/**
 * Truncate text to a maximum length, appending a notice if truncated.
 */
export function truncateInput(text: string, maxLength: number, label?: string): string {
  if (text.length <= maxLength) return text;
  const suffix = label
    ? `\n...[${label} truncated at ${maxLength} characters]`
    : `\n...[truncated at ${maxLength} characters]`;
  return text.substring(0, maxLength) + suffix;
}

/**
 * Full sanitization pipeline for user input going into AI prompts:
 * 1. Truncate to limit
 * 2. Wrap in delimiters
 * 3. Detect injection (for logging/monitoring)
 */
export function sanitizeForAI(
  text: string,
  options: {
    maxLength?: number;
    label?: string;
    fieldName?: string;
  } = {}
): { sanitized: string; injectionDetected: boolean } {
  const { maxLength = AI_INPUT_LIMITS.genericField, label = 'USER_INPUT' } = options;

  const truncated = truncateInput(text, maxLength, options.fieldName);
  const wrapped = wrapUserInput(truncated, label);
  const injectionDetected = detectInjectionAttempt(text);

  return { sanitized: wrapped, injectionDetected };
}

/**
 * Strip HTML/XSS from AI-generated text.
 * Uses DOMPurify in text-only mode (ALLOWED_TAGS: []) so all markup is removed.
 * This prevents stored-XSS if AI output is ever rendered with dangerouslySetInnerHTML.
 */
export function sanitizeHTML(text: string): string {
  return DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/**
 * Sanitize AI-generated output before returning to the user.
 * 1. Strips HTML/XSS tags (defense-in-depth against stored XSS)
 * 2. Strips PII that the model may have echoed or hallucinated
 *    (emails, phone numbers, CNP, CUI, IBAN, credit cards, IPs).
 */
export function sanitizeAIOutput(
  text: string,
  options?: { stripPII?: boolean }
): { sanitized: string; piiRedacted: string[] } {
  // Always strip HTML/XSS first
  const output = sanitizeHTML(text);
  const { cleaned: secretCleaned, redactions: secretRedactions } = stripSensitiveAILeaks(output);

  if (options?.stripPII === false) {
    return { sanitized: secretCleaned, piiRedacted: secretRedactions };
  }

  const { cleaned, redactions } = stripPII(secretCleaned);
  return { sanitized: cleaned, piiRedacted: [...secretRedactions, ...redactions] };
}

/**
 * Recursively sanitize all string values in a structured AI response.
 * Walks objects and arrays, running stripPII on every string leaf.
 * Returns a deep copy — the original is not mutated.
 */
export function sanitizeAIResponseDeep<T>(data: T): { sanitized: T; piiRedacted: string[] } {
  const allRedactions: string[] = [];

  function walk(node: unknown): unknown {
    if (typeof node === 'string') {
      const htmlClean = sanitizeHTML(node);
      const { cleaned: secretCleaned, redactions: secretRedactions } = stripSensitiveAILeaks(htmlClean);
      const { cleaned, redactions } = stripPII(secretCleaned);
      if (secretRedactions.length > 0) allRedactions.push(...secretRedactions);
      if (redactions.length > 0) allRedactions.push(...redactions);
      return cleaned;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node !== null && typeof node === 'object' && !(node instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        out[key] = walk(val);
      }
      return out;
    }
    return node;
  }

  return { sanitized: walk(data) as T, piiRedacted: allRedactions };
}

// ─── User Input Sanitization for AI Endpoints ───────────────────
// Scans user input fields from API request bodies for injection patterns
// and returns a structured result with matched patterns for monitoring.

export interface SanitizeResult {
  clean: boolean;
  input: string;
  sanitized: string;
  matched: string[];
}

/**
 * Sanitize user input before passing to AI prompts.
 * Extends the RAG poisoning detection pattern from pipeline.ts.
 * - Detects known injection patterns (for logging/monitoring)
 * - Wraps input in boundary markers for safe prompt insertion
 */
export function sanitizeUserInput(input: string): SanitizeResult {
  const matched: string[] = [];
  const normalized = normalizePromptInput(input);

  if (ASCII_DELIMITER_LOOKALIKE_PATTERN.test(normalized)) {
    matched.push(ASCII_DELIMITER_LOOKALIKE_PATTERN.source);
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      matched.push(pattern.source);
    }
  }

  const sanitized = wrapUserInput(input);

  return {
    clean: matched.length === 0,
    input,
    sanitized,
    matched,
  };
}

function stripSensitiveAILeaks(text: string): { cleaned: string; redactions: string[] } {
  const redactions: string[] = [];
  let cleaned = text;

  cleaned = cleaned.replace(PRIVATE_KEY_PATTERN, () => {
    redactions.push('PRIVATE_KEY');
    return '[SECRET_REDACTED]';
  });

  cleaned = cleaned.replace(SECRET_ASSIGNMENT_PATTERN, (match) => {
    const secretName = match.split(/[:=]/, 1)[0]?.trim() || 'SECRET';
    redactions.push(secretName);
    return `${secretName}=[SECRET_REDACTED]`;
  });

  cleaned = cleaned.replace(TOKEN_LIKE_PATTERN, () => {
    redactions.push('ACCESS_TOKEN');
    return '[SECRET_REDACTED]';
  });

  cleaned = cleaned.replace(PROMPT_LEAK_PATTERN, (_match, prefix) => {
    redactions.push('PROMPT_LEAK');
    return `${prefix || ''}[PROMPT_CONTENT_REDACTED]`;
  });

  return { cleaned, redactions };
}
