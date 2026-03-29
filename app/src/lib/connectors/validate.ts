import * as cheerio from 'cheerio';
import { createHash } from 'crypto';
import type { StructureCheck } from './contract';

export function validateStructure(
  html: string,
  checks: StructureCheck[]
): { valid: boolean; missing: string[] } {
  const $ = cheerio.load(html);
  const missing: string[] = [];

  for (const check of checks) {
    const found = $(check.selector).length > 0;
    if (!found && check.required) {
      missing.push(`${check.description} (${check.selector})`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
