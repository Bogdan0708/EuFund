/** UUID v1-v8, case-insensitive */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lowercase slug: starts with letter, alphanumeric + underscore or hyphen, max 64 chars.
 *  Hyphens are allowed because the V3 agent's structure extraction prompts the LLM for
 *  "kebab-case identifier" (see lib/ai/agent/tools/extract-structure.ts:52) and
 *  blueprint.materializeCachedSections produces hyphen-separated slugs via slugifyTitle.
 *  Section IDs like `context-si-justificare` need to pass route validation, otherwise the
 *  section/state/export endpoints 400 on any V3-generated outline. */
export const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
