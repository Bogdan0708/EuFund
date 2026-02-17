import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/redis/client';
import { Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'rate-limit' });

export interface RateLimitOptions {
  keyPrefix: string;
  maxRequests: number;
  windowMs: number;
  messageRo?: string;
}

export type NextRouteHandler = (request: NextRequest) => Promise<Response>;

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return '';
}

function buildRateLimitExceededResponse(retryAfterSeconds: number, messageRo?: string): NextResponse {
  const payload = Errors.rateLimited(retryAfterSeconds * 1000).toResponse('ro');
  if (messageRo) {
    payload.error.message = messageRo;
  }

  return NextResponse.json(payload, {
    status: 429,
    headers: {
      'Retry-After': retryAfterSeconds.toString(),
    },
  });
}

export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response }
> {
  const ip = getClientIp(request);

  // Reject requests with no identifiable IP — can't rate limit safely
  if (!ip) {
    log.warn('Request with no identifiable IP address — denying');
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Nu s-a putut identifica adresa IP.' } },
        { status: 400 },
      ),
    };
  }

  try {
    const rateLimit = await checkRateLimit(
      `${options.keyPrefix}:${ip}`,
      options.maxRequests,
      options.windowMs,
    );

    const retryAfterSeconds = Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000));

    if (!rateLimit.allowed) {
      return {
        ok: false,
        response: buildRateLimitExceededResponse(retryAfterSeconds, options.messageRo),
      };
    }

    return {
      ok: true,
      headers: {
        'X-RateLimit-Limit': options.maxRequests.toString(),
        'X-RateLimit-Remaining': rateLimit.remaining.toString(),
        'X-RateLimit-Reset': rateLimit.resetTime.toString(),
      },
    };
  } catch (error) {
    log.error({ error }, 'Rate limit check failed — allowing request');
    return {
      ok: true,
      headers: {},
    };
  }
}

export function withRateLimit(options: RateLimitOptions, handler: NextRouteHandler): NextRouteHandler {
  return async (request: NextRequest) => {
    const limit = await enforceRateLimit(request, options);
    if (!limit.ok) {
      return limit.response;
    }

    const response = await handler(request);
    for (const [header, value] of Object.entries(limit.headers)) {
      response.headers.set(header, value);
    }

    return response;
  };
}
