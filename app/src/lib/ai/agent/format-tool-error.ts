// Pure function: maps stable tool-error prefixes emitted by
// app/src/lib/ai/agent/managed/executor.ts into translation keys
// under the agent.toolErrors namespace. Order of checks matters —
// most specific prefixes first.
//
// Source of truth for the input strings: executor.ts:166-203 +
// runtime.ts:29 (PARALLEL_WRITE_BLOCKED). Adding a new error code in
// the executor REQUIRES adding a matching branch here AND a matching
// translation key in messages/{ro,en}.json — otherwise users see the
// GENERIC fallback and we log a dev-only console.warn.

export type TranslateFn = (key: string, params?: Record<string, string>) => string

export function formatToolError(
  tool: string,
  summary: string,
  t: TranslateFn,
): string {
  if (summary.startsWith('PARALLEL_WRITE_BLOCKED')) return t('PARALLEL_WRITE_BLOCKED', { tool })
  if (summary === 'Tool timed out after 15s') return t('TOOL_TIMEOUT', { tool })
  if (summary.startsWith('NOT_FOUND')) return t('NOT_FOUND', { tool })
  if (summary.startsWith('AUTHORIZATION')) return t('AUTHORIZATION', { tool })
  if (summary.startsWith('POLICY_')) {
    // Extract ONLY the stable code (text up to the first ':') — never
    // pass the full summary as detail. Otherwise a Romanian render of
    // "POLICY_OUTLINE_NOT_FROZEN: outline must be frozen" leaks the
    // English service prose into a localized template.
    const code = summary.split(':')[0]
    return t('POLICY_PREFIX', { tool, code })
  }
  if (summary.startsWith('VALIDATION:')) return t('VALIDATION_PREFIX', { tool })
  if (summary.startsWith('CONCURRENCY')) return t('CONCURRENCY', { tool })
  if (summary.startsWith('EXTERNAL_DEPENDENCY')) return t('EXTERNAL_DEPENDENCY', { tool })
  if (summary === 'Internal tool error') return t('INTERNAL', { tool })

  if (process.env.NODE_ENV !== 'production') {
    console.warn('[tool error]', tool, summary)
  }
  return t('GENERIC', { tool })
}
