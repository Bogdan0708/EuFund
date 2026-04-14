/**
 * Replaces {{variable}} placeholders in a template string.
 * Variables not found in the context are replaced with [___].
 */
export function interpolate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return context[key] ?? '[___]'
  })
}

/**
 * Slugifies a Romanian title for use in deterministic document IDs and filenames.
 * Strips diacritics, lowercases, replaces non-alphanumeric with hyphens.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Builds a deterministic document ID from scope and title.
 */
export function makeDocumentId(scope: 'general' | 'call_specific', title: string): string {
  return `doc-${scope}-${slugify(title)}`
}
