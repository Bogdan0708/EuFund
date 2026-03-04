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
const CYRILLIC_CONFUSABLE_PATTERN = /[аАеЕоОіІрРсСуУхХкКмМтТвВнН]/g;
const ASCII_DELIMITER_LOOKALIKE_PATTERN = /---\s*(?:BEGIN|END)\b|<<<|>>>/i;

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a', А: 'A', е: 'e', Е: 'E', о: 'o', О: 'O', і: 'i', І: 'I',
  р: 'p', Р: 'P', с: 'c', С: 'C', у: 'y', У: 'Y', х: 'x', Х: 'X',
  к: 'k', К: 'K', м: 'm', М: 'M', т: 't', Т: 'T', в: 'b', В: 'B',
  н: 'h', Н: 'H',
};

const SENSITIVE_OUTPUT_PATTERNS: Array<{ type: string; pattern: RegExp }> = [
  { type: 'api_key', pattern: /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b/gi },
  { type: 'api_key', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { type: 'secret', pattern: /\b(?:api[_\s-]?key|secret|access[_\s-]?token|refresh[_\s-]?token|password)\b\s*[:=]?\s*[A-Za-z0-9._-]{8,}\b/gi },
];

const SYSTEM_FRAGMENT_BLOCK_PATTERNS = [
  /system\s+prompt/i,
  /developer\s+message/i,
  /hidden\s+instructions?/i,
];

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
  if (sample.includes('\uFFFD')) suspiciousChars += 5;
  return sample.length > 0 && suspiciousChars / sample.length > 0.02;
}

/**
 * Filter AI output: redact leaked secrets/keys and block system prompt leakage.
 */
export function filterAIOutput(text: string): { text: string; blocked: boolean; redactions: string[] } {
  const redactions: string[] = [];
  let filtered = text;

  for (const { type, pattern } of SENSITIVE_OUTPUT_PATTERNS) {
    filtered = filtered.replace(pattern, () => {
      redactions.push(type);
      return `[REDACTED:${type}]`;
    });
  }

  const blocked = SYSTEM_FRAGMENT_BLOCK_PATTERNS.some(p => p.test(filtered));

  return { text: filtered, blocked, redactions };
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

  if (options?.stripPII === false) {
    return { sanitized: output, piiRedacted: [] };
  }

  const { cleaned, redactions } = stripPII(output);
  return { sanitized: cleaned, piiRedacted: redactions };
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
      const { cleaned, redactions } = stripPII(htmlClean);
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
