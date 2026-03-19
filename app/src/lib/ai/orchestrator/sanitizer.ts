const PATTERNS = [
  { regex: /\bRO\d{2,10}\b/g, replacement: '[REDACTED_CIF]' },
  { regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g, replacement: '[REDACTED_IBAN]' },
  { regex: /\b[1-8]\d{12}\b/g, replacement: '[REDACTED_CNP]' },
  { regex: /\b\d{10}\b/g, replacement: '[REDACTED_PHONE]' },
  { regex: /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
]

export function sanitizeForAI(text: string): string {
  let result = text
  for (const { regex, replacement } of PATTERNS) {
    result = result.replace(regex, replacement)
  }
  return result
}
