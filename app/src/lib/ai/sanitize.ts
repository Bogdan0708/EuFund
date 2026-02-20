// ─── AI Prompt Injection Protection ─────────────────────────────
// Sanitizes and wraps user input to prevent prompt injection attacks.

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

/**
 * Known prompt injection patterns to detect and flag.
 * These are logged for monitoring but the delimiter approach is the primary defense.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /ignore\s+(all\s+)?above\s+instructions/i,
  /disregard\s+(all\s+)?previous/i,
  /you\s+are\s+now\s+(?:a|an)\s+/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
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
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
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
