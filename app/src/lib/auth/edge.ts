// Edge-safe auth — manual JWT decoding, NO NextAuth import
// NextAuth v5 beta bundles eval()-using code even with empty providers,
// which crashes in Edge runtime. We bypass it entirely.
//
// Key insight: Auth.js derives encryption keys using @panva/hkdf with:
//   - digest: sha256
//   - ikm: NEXTAUTH_SECRET
//   - salt: cookie name (e.g. "__Secure-authjs.session-token")
//   - info: "Auth.js Generated Encryption Key (<cookie_name>)"
//   - length: 64 bytes (for A256CBC-HS512)

import { jwtDecrypt } from 'jose';
import { hkdf } from '@panva/hkdf';
import { NextRequest } from 'next/server';

const COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token';

interface EdgeSession {
  user?: {
    id?: string;
    email?: string;
    name?: string;
    emailVerified?: boolean;
    onboardingCompleted?: boolean;
  };
}

/**
 * Derive the JWE decryption key exactly as Auth.js does.
 */
async function getEncryptionKey(secret: string): Promise<Uint8Array> {
  const salt = COOKIE_NAME;
  const info = `Auth.js Generated Encryption Key (${salt})`;
  const derived = await hkdf('sha256', secret, salt, info, 64);
  return new Uint8Array(derived);
}

/**
 * Read and verify the Auth.js JWT session from cookies.
 * Returns the session if valid, null otherwise.
 */
export async function getEdgeSession(req: NextRequest): Promise<EdgeSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    const key = await getEncryptionKey(secret);
    const { payload } = await jwtDecrypt(token, key);
    return {
      user: {
        id: (payload.userId || payload.sub) as string | undefined,
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
        emailVerified: payload.emailVerified as boolean | undefined,
        onboardingCompleted: payload.onboardingCompleted as boolean | undefined,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Middleware wrapper that mimics NextAuth's auth() pattern.
 * Adds `req.auth` with the session data if a valid JWT exists.
 */
export function auth(
  handler: (req: NextRequest & { auth: EdgeSession | null }) => Promise<Response | void>
) {
  return async function middleware(req: NextRequest) {
    const session = await getEdgeSession(req);
    (req as NextRequest & { auth: EdgeSession | null }).auth = session;
    return handler(req as NextRequest & { auth: EdgeSession | null });
  };
}
