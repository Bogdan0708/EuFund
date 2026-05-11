import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('Password login deployment gate', () => {
  it('renders the client password form when the public opt-in flag is enabled', () => {
    const source = readFileSync('src/app/[locale]/(auth)/autentificare/page.tsx', 'utf-8');

    expect(source).toContain("process.env.NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN === 'true'");
    expect(source).toContain('const allowPasswordLogin = isDev ||');
    expect(source).toContain('{allowPasswordLogin && (');
    expect(source).toContain('Password Login');
    expect(source).not.toContain('Dev Login (local only)');
  });

  it('passes the public password-login flag into the production Next.js build', () => {
    const dockerfile = readFileSync('../infrastructure/Dockerfile.prod', 'utf-8');
    const cloudBuild = readFileSync('../cloudbuild.production.yaml', 'utf-8');

    expect(dockerfile).toContain('ARG NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=false');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=$NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN');
    expect(dockerfile.indexOf('ENV NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=')).toBeLessThan(
      dockerfile.indexOf('RUN npm run build'),
    );

    // Closed beta opt-in: password login is currently ON for allowlisted testers.
    // Flip back to "false" once OAuth/magic-link coverage is complete.
    expect(cloudBuild).toContain('_NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN: "true"');
    expect(cloudBuild).toContain('_ALLOW_PASSWORD_LOGIN: "true"');
    expect(cloudBuild).toContain(
      '--build-arg "NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=$_NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN"',
    );
    expect(cloudBuild).toContain('--set-env-vars "^|^APP_VERSION=');
    expect(cloudBuild).toContain('_MANAGED_RUNTIME_ENABLED: "true"');
    expect(cloudBuild).toContain('|AUTH_ALLOWED_EMAILS=$_AUTH_ALLOWED_EMAILS|MANAGED_RUNTIME_ENABLED=$_MANAGED_RUNTIME_ENABLED|ROMANIAN_BERT_ENABLED=$_ROMANIAN_BERT_ENABLED|SCHEDULER_OIDC_AUDIENCE=$_SCHEDULER_OIDC_AUDIENCE"');
  });

  it('gates magic-link UI behind a build-time flag until SMTP is wired', () => {
    const dockerfile = readFileSync('../infrastructure/Dockerfile.prod', 'utf-8');
    const cloudBuild = readFileSync('../cloudbuild.production.yaml', 'utf-8');
    const page = readFileSync('src/app/[locale]/(auth)/autentificare/page.tsx', 'utf-8');

    expect(dockerfile).toContain('ARG NEXT_PUBLIC_MAGIC_LINK_ENABLED=false');
    expect(dockerfile).toContain('ENV NEXT_PUBLIC_MAGIC_LINK_ENABLED=$NEXT_PUBLIC_MAGIC_LINK_ENABLED');
    expect(cloudBuild).toContain('_NEXT_PUBLIC_MAGIC_LINK_ENABLED: "false"');
    expect(cloudBuild).toContain(
      '--build-arg "NEXT_PUBLIC_MAGIC_LINK_ENABLED=$_NEXT_PUBLIC_MAGIC_LINK_ENABLED"',
    );
    expect(page).toContain("process.env.NEXT_PUBLIC_MAGIC_LINK_ENABLED === 'true'");
    expect(page).toContain('{magicLinkEnabled && (');
  });

  it('keeps the AUTH_ALLOWED_EMAILS allowlist populated for the closed beta', () => {
    const cloudBuild = readFileSync('../cloudbuild.production.yaml', 'utf-8');
    // Empty allowlist = fail-closed for every provider. Must contain at least one address
    // while password login is on; otherwise the new dev-login form locks everyone out.
    expect(cloudBuild).not.toContain('_AUTH_ALLOWED_EMAILS: ""');
    expect(cloudBuild).toMatch(/_AUTH_ALLOWED_EMAILS:\s*"[^"]+@[^"]+"/);
  });
});
