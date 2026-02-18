// Edge-safe auth — manual JWT decoding, NO NextAuth import
// NextAuth v5 beta bundles eval()-using code even with empty providers,
// which crashes in Edge runtime. We bypass it entirely.
import { jwtVerify, compactDecrypt } from 'jose';
import { NextRequest } from 'next/server';
import type { JWTPayload } from 'jose';

const COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Secure-next-auth.session-token'
  : 'next-auth.session-token';

interface EdgeSession {
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
}

/**
 * Derive the encryption key using HKDF — matching NextAuth/Auth.js internals.
 * Returns raw bytes as Uint8Array (what jose's compactDecrypt expects).
 */
async function getDerivedEncryptionKey(secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  // Auth.js uses HKDF with SHA-256, empty salt, and this specific info string
  // Output length must be 512 bits for A256CBC-HS512 (the default JWE alg)
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('Auth.js Generated Encryption Key'),
    },
    keyMaterial,
    512 // 64 bytes for A256CBC-HS512
  );

  return new Uint8Array(derivedBits);
}

/**
 * Alternative HKDF derivation for older NextAuth v4 style keys.
 */
async function getDerivedEncryptionKeyLegacy(secret: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('NextAuth.js Generated Encryption Key'),
    },
    keyMaterial,
    512
  );

  return new Uint8Array(derivedBits);
}

/**
 * Read and verify the NextAuth JWT session from cookies.
 * Returns the session if valid, null otherwise.
 */
export async function getEdgeSession(req: NextRequest): Promise<EdgeSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    // Try JWS (signed, unencrypted) first
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      return extractSession(payload);
    } catch {
      // Not JWS — try JWE (encrypted)
    }

    // Try Auth.js v5 key derivation (info = "Auth.js Generated Encryption Key")
    try {
      const key = await getDerivedEncryptionKey(secret);
      const { plaintext } = await compactDecrypt(token, key);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      return extractSession(payload);
    } catch {
      // Try legacy NextAuth v4 key derivation
    }

    // Try NextAuth v4 key derivation (info = "NextAuth.js Generated Encryption Key")
    try {
      const key = await getDerivedEncryptionKeyLegacy(secret);
      const { plaintext } = await compactDecrypt(token, key);
      const payload = JSON.parse(new TextDecoder().decode(plaintext));
      return extractSession(payload);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function extractSession(payload: Record<string, unknown> | JWTPayload): EdgeSession {
  return {
    user: {
      id: (payload.userId || payload.sub) as string | undefined,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    },
  };
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
