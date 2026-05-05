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

    expect(cloudBuild).toContain('_NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN: "false"');
    expect(cloudBuild).toContain(
      '--build-arg "NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN=$_NEXT_PUBLIC_ALLOW_PASSWORD_LOGIN"',
    );
  });
});
