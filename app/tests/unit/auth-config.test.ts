import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

describe('Auth config safety', () => {
  const source = readFileSync('src/lib/auth/index.ts', 'utf-8');

  it('does not use allowDangerousEmailAccountLinking on any OAuth provider', () => {
    expect(source).not.toContain('allowDangerousEmailAccountLinking: true');
  });

  it('signIn callback checks authAccounts linkage before allowing OAuth re-login', () => {
    // Must verify the linked account exists before setting user.id
    expect(source).toContain('authAccounts.provider');
    expect(source).toContain('authAccounts.providerAccountId');
    expect(source).toContain('authAccounts.userId');
    // Must reject unlinked OAuth identities claiming same email
    expect(source).toContain('return false');
  });

  it('requires an explicit allowlisted email before any sign-in path can proceed', () => {
    expect(source).toContain('AUTH_ALLOWED_EMAILS');
    expect(source).toContain('function isAuthEmailAllowed');
    expect(source).toContain('allowedAuthEmails.size === 0');
    expect(source).toContain('if (!isAuthEmailAllowed(user.email))');
  });

  it('keeps production password login behind an explicit opt-in flag', () => {
    expect(source).toContain("process.env.ALLOW_PASSWORD_LOGIN === 'true'");
  });
});
