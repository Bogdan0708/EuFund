// ─── Authentication Middleware for AI Endpoints ───────────────
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { sanitizeAIResponseDeep, sanitizeUserInput } from '@/lib/ai/sanitize';

export type UserTier = 'free' | 'pro' | 'enterprise';
export type AIFeature = 'proposal' | 'document' | 'grant' | 'compliance';

const log = logger.child({ component: 'auth' });

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  tier: UserTier;
}

function validateAllowedContentType(
  request: NextRequest,
  allowedContentTypes: string[] = ['application/json'],
): NextResponse | null {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    return null;
  }

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!contentType || !allowedContentTypes.some((value) => contentType.startsWith(value))) {
    return NextResponse.json(
      { error: 'Unsupported Media Type', code: 'UNSUPPORTED_MEDIA_TYPE' },
      { status: 415 },
    );
  }

  return null;
}

async function sanitizeAIJsonResponse(response: NextResponse): Promise<NextResponse> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return response;
  }

  try {
    const payload = await response.clone().json();
    const { sanitized } = sanitizeAIResponseDeep(payload);

    const sanitizedResponse = NextResponse.json(sanitized, { status: response.status });
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === 'content-length' || key.toLowerCase() === 'content-type') continue;
      sanitizedResponse.headers.set(key, value);
    }
    return sanitizedResponse;
  } catch {
    return response;
  }
}

type AuthGuardResult =
  | { user: AuthenticatedUser; rateLimit: { remaining: number; resetTime: number } }
  | { errorResponse: NextResponse };

async function guardAIRequest(
  request: NextRequest,
  options?: { feature?: AIFeature; allowedContentTypes?: string[] }
): Promise<AuthGuardResult> {
  const contentTypeError = validateAllowedContentType(request, options?.allowedContentTypes);
  if (contentTypeError) {
    return { errorResponse: contentTypeError };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 },
      ),
    };
  }

  const user: AuthenticatedUser = {
    id: session.user.id,
    email: session.user.email!,
    name: session.user.name || undefined,
    tier: 'free' as UserTier,
  };

  // Rate limiting disabled — single-user dev mode
  return { user, rateLimit: { remaining: 9999, resetTime: Date.now() + 3600000 } };
}

/**
 * Authenticate and rate-limit an AI request, returning the user or an error response.
 * Use this for streaming routes where you need to run auth before returning a stream.
 */
export async function authenticateAIUser(
  request: NextRequest,
  options?: { feature?: AIFeature; allowedContentTypes?: string[] }
): Promise<{ user: AuthenticatedUser } | { errorResponse: NextResponse }> {
  try {
    const result = await guardAIRequest(request, options);
    if ('errorResponse' in result) {
      return result;
    }

    // Sanitize AI input if present in request body
    if (request.method === 'POST') {
      try {
        const body = await request.clone().json();
        const fieldsToSanitize = ['message', 'prompt', 'query', 'goal', 'description'];
        for (const field of fieldsToSanitize) {
          if (typeof body[field] === 'string') {
            const sanitizeResult = sanitizeUserInput(body[field]);
            if (!sanitizeResult.clean) {
              log.warn({ field, patterns: sanitizeResult.matched, userId: result.user.id },
                `[AI Sanitize] Injection patterns detected in field "${field}"`);
            }
          }
        }
      } catch {
        // Body parsing may fail for non-JSON requests — that's fine
      }
    }

    return { user: result.user };
  } catch (error) {
    log.error({ error }, 'AI authentication error:');
    return {
      errorResponse: NextResponse.json(
        { error: 'Internal server error', code: 'INTERNAL_ERROR' },
        { status: 500 }
      ),
    };
  }
}

export async function withAIAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser) => Promise<NextResponse>,
  options?: { feature?: AIFeature; allowedContentTypes?: string[] }
): Promise<NextResponse> {
  try {
    const result = await guardAIRequest(request, options);
    if ('errorResponse' in result) {
      return result.errorResponse;
    }

    // Sanitize AI input if present in request body
    if (request.method === 'POST') {
      try {
        const body = await request.clone().json();
        const fieldsToSanitize = ['message', 'prompt', 'query', 'goal', 'description'];
        for (const field of fieldsToSanitize) {
          if (typeof body[field] === 'string') {
            const sanitizeResult = sanitizeUserInput(body[field]);
            if (!sanitizeResult.clean) {
              log.warn({ field, patterns: sanitizeResult.matched, userId: result.user.id },
                `[AI Sanitize] Injection patterns detected in field "${field}"`);
            }
          }
        }
      } catch {
        // Body parsing may fail for non-JSON requests — that's fine
      }
    }

    const response = await handler(result.user);
    return await sanitizeAIJsonResponse(response);

  } catch (error) {
    log.error({ error }, 'AI authentication error:');
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
