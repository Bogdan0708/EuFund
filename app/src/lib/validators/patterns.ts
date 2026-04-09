/** UUID v1-v8, case-insensitive */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lowercase slug: starts with letter, alphanumeric + underscore, max 64 chars */
export const SLUG_RE = /^[a-z][a-z0-9_]{0,63}$/;
