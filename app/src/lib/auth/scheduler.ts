import { OAuth2Client } from 'google-auth-library';
import type { NextRequest } from 'next/server';
import { Errors } from '@/lib/errors';
export { isSchedulerBearerRequest } from '@/lib/auth/scheduler-predicate';

const oauth2 = new OAuth2Client();

export interface SchedulerAuth {
  source: 'scheduler';
}

/**
 * Verify a Google OIDC ID token issued by Cloud Scheduler.
 *
 * - Returns `null` if no Bearer token is present (caller should fall through
 *   to its next auth check).
 * - Returns `{ source: 'scheduler' }` if the token is valid AND issued by
 *   `expectedServiceAccount` AND has audience `expectedAudience`.
 * - Throws `Errors.unauthorized()` if a Bearer token is present but invalid.
 */
export async function verifySchedulerOIDC(
  req: NextRequest,
  expectedAudience: string,
  expectedServiceAccount: string,
): Promise<SchedulerAuth | null> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;

  const token = auth.slice('Bearer '.length).trim();
  if (!token) return null;

  let ticket;
  try {
    ticket = await oauth2.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
  } catch {
    throw Errors.unauthorized();
  }

  const payload = ticket.getPayload();
  if (
    !payload ||
    payload.email !== expectedServiceAccount ||
    payload.email_verified !== true
  ) {
    throw Errors.unauthorized();
  }

  return { source: 'scheduler' };
}

