import { NextRequest } from 'next/server';
import { GET, POST as nextAuthPost } from '@/lib/auth';
import { withRateLimit } from '@/lib/middleware/rate-limit';

const credentialsLoginRateLimit = withRateLimit(
  {
    keyPrefix: 'auth:login',
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
    messageRo: 'Prea multe încercări de autentificare. Vă rugăm să încercați din nou mai târziu.',
  },
  nextAuthPost,
);

export { GET };

export async function POST(request: NextRequest) {
  if (request.nextUrl.pathname.endsWith('/callback/credentials')) {
    return credentialsLoginRateLimit(request);
  }

  return nextAuthPost(request);
}
