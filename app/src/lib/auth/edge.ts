// Edge-safe auth — manual JWT decoding, NO NextAuth import
// NextAuth v5 beta bundles eval()-using code even with empty providers,
// which crashes in Edge runtime. We bypass it entirely.
import { jwtVerify } from 'jose';
import { NextRequest } from 'next/server';

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
 * Read and verify the NextAuth JWT session from cookies.
 * Returns the session if valid, null otherwise.
 * This replaces NextAuth's auth() wrapper for Edge middleware.
 */
export async function getEdgeSession(req: NextRequest): Promise<EdgeSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) return null;

  try {
    // NextAuth v5 uses JWE (encrypted JWT) by default
    // The secret is used to derive the encryption key
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(secret);
    
    // Derive key using the same method as NextAuth (hkdf)
    const derivedKey = await crypto.subtle.importKey(
      'raw',
      await deriveKey(secretKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // NextAuth uses a compact JWE format — try jose's jwtVerify first for JWS,
    // then fall back to JWE decryption
    try {
      // Try as signed JWT (JWS) first
      const { payload } = await jwtVerify(token, encoder.encode(secret));
      return extractSession(payload);
    } catch {
      // Try as encrypted JWT (JWE) — NextAuth v5 default
      try {
        const { compactDecrypt } = await import('jose');
        const { plaintext } = await compactDecrypt(token, derivedKey);
        const payload = JSON.parse(new TextDecoder().decode(plaintext));
        return extractSession(payload);
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}

function extractSession(payload: Record<string, unknown>): EdgeSession {
  return {
    user: {
      id: (payload.userId || payload.sub) as string | undefined,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    },
  };
}

/**
 * Derive encryption key using HKDF (same as NextAuth)
 */
async function deriveKey(secret: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const info = new TextEncoder().encode('NextAuth.js Generated Encryption Key');
  const salt = new Uint8Array(0); // NextAuth uses empty salt
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );
  
  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    keyMaterial,
    256 // 32 bytes
  );
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
