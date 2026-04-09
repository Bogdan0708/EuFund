import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Auth config safety', () => {
  const source = readFileSync('src/lib/auth/index.ts', 'utf-8');

  it('does not use allowDangerousEmailAccountLinking on any OAuth provider', () => {
    expect(source).not.toContain('allowDangerousEmailAccountLinking: true');
  });

  it('signIn callback does not auto-link OAuth accounts by email', () => {
    expect(source).not.toMatch(/user\.id\s*=\s*existing\.id/);
  });
});
