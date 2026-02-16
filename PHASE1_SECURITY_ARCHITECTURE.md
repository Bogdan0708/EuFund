# Phase 1: Comprehensive Security Architecture
## Romanian EU Funding Platform - P0 Security Implementation

**Status**: 🔴 CRITICAL - Security Gaps Identified
**Date**: 2026-02-15
**Priority**: P0 (Must complete before production)

---

## Executive Summary

### Current State Analysis

#### ✅ Implemented
- Basic auth helpers (`requireAuth`, `requireOrgRole`)
- `withAIAuth` middleware wrapper for AI endpoints (partial)
- Redis-based rate limiting foundation
- CSRF validation stub functions
- Audit logging system

#### 🔴 Critical Gaps (P0)
1. **No Global Middleware**: Missing `middleware.ts` for auth/rate limiting enforcement
2. **Unprotected AI Endpoints**: 14/17 AI endpoints lack authentication
3. **No CSRF Enforcement**: Token generation/validation not implemented
4. **No Session Security**: Missing secure cookie flags, SameSite enforcement
5. **No IP-based Rate Limiting**: Only user-based limits exist

---

## Security Architecture Design

### 1. Global Next.js Middleware Strategy

#### Architecture Pattern: Layered Defense

```
┌─────────────────────────────────────────────────────┐
│  middleware.ts (Global Edge)                        │
│  ├─ Public paths exclusion                          │
│  ├─ Rate limiting (IP + endpoint-based)             │
│  ├─ Auth verification (session check)               │
│  ├─ CSRF token generation/validation                │
│  └─ Security headers injection                      │
└─────────────────────────────────────────────────────┘
            │
            ├──────────────────────────────────────────┐
            │                                          │
┌───────────▼──────────┐               ┌──────────────▼─────────┐
│  API Routes          │               │  Page Routes           │
│  - withAIAuth wrap   │               │  - Server Components   │
│  - Endpoint-specific │               │  - Auto-authenticated  │
│  - Resource-based    │               │  - CSRF in forms       │
└──────────────────────┘               └────────────────────────┘
```

#### Decision Matrix: What Goes Where

| Security Layer | Global Middleware | Route Handler | Rationale |
|----------------|-------------------|---------------|-----------|
| Session Check | ✅ | ✅ (redundant) | Fast fail, edge optimization |
| IP Rate Limit | ✅ | ❌ | DDoS protection, platform-wide |
| User Rate Limit | ❌ | ✅ | Resource-specific, requires user context |
| CSRF Validation | ✅ | ❌ | Stateless, can run on edge |
| Role-Based Auth | ❌ | ✅ | Requires DB queries |
| Audit Logging | ❌ | ✅ | After successful auth only |

### 2. AI Endpoint Protection Strategy

#### Current Inventory (17 Total AI Endpoints)

| Endpoint | Status | Risk Level | Action |
|----------|--------|------------|--------|
| `/api/ai/predict-success` | ✅ Protected | Medium | Keep `withAIAuth` |
| `/api/ai/forecast-lifecycle` | ✅ Protected | Medium | Keep `withAIAuth` |
| `/api/ai/match-grants` | 🔴 **Unprotected** | **HIGH** | Add `withAIAuth` |
| `/api/ai/validate-compliance` | 🔴 **Unprotected** | **HIGH** | Add `withAIAuth` |
| `/api/ai/generate-proposal` | 🔴 **Unprotected** | **CRITICAL** | Add `withAIAuth` |
| `/api/ai/project-analysis` | 🔴 **Unprotected** | HIGH | Add `withAIAuth` |
| `/api/ai/analyze-document` | 🔴 **Unprotected** | **CRITICAL** | Add `withAIAuth` + file validation |
| `/api/ai/deadline-risk-assessment` | 🔴 **Unprotected** | Medium | Add `withAIAuth` |
| `/api/ai/optimize-timeline` | 🔴 **Unprotected** | Medium | Add `withAIAuth` |
| `/api/ai/analyze-consortium` | 🔴 **Unprotected** | HIGH | Add `withAIAuth` |
| `/api/ai/optimize-budget` | 🔴 **Unprotected** | HIGH | Add `withAIAuth` |
| `/api/ai/generate-report` | 🔴 **Unprotected** | Medium | Add `withAIAuth` |
| `/api/ai/project-health` | 🔴 **Unprotected** | LOW | Add `withAIAuth` |
| `/api/ai/market-intelligence` | 🔴 **Unprotected** | Medium | Add `withAIAuth` |
| `/api/ai/recommend-partners` | 🔴 **Unprotected** | Medium | Add `withAIAuth` |
| `/api/ai/generate-insights` | 🔴 **Unprotected** | Medium | Add `withAIAuth` |
| `/api/ai/advanced-analytics` | 🔴 **Unprotected** | HIGH | Add `withAIAuth` |

**Total Unprotected**: 15/17 (88% vulnerable)

#### Standardized Pattern

```typescript
// Every AI endpoint MUST follow this pattern:
export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user: AuthenticatedUser) => {
    try {
      // Validate input
      const body = await request.json();
      const parsed = inputSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(Errors.validation(...), { status: 400 });
      }

      // Execute AI logic
      const result = await aiFunction(parsed.data);

      // Audit log
      await logAudit({
        userId: user.id,
        action: 'ai.generate',
        resourceType: '...',
        metadata: { tier: user.tier, tokensUsed: result.tokensUsed }
      });

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      console.error('[endpoint]', error);
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}
```

### 3. CSRF Protection Architecture

#### Token Generation Strategy

```typescript
// Server-side: Generate on session creation
interface CSRFToken {
  token: string;        // 32-byte random hex
  expiresAt: number;    // Timestamp
  sessionId: string;    // Bind to session
}

// Storage: Redis with 1-hour TTL
redis.setex(`csrf:${sessionId}`, 3600, token);

// Client delivery: HTTP-only cookie + meta tag
Set-Cookie: csrf-token=...; HttpOnly; Secure; SameSite=Strict
<meta name="csrf-token" content="..." />
```

#### Validation Flow

```
POST /api/v1/projects
│
├─ Middleware extracts: X-CSRF-Token header
├─ Middleware extracts: csrf-token cookie
│
├─ Match header == cookie value? → ❌ 403 Forbidden
├─ Token exists in Redis? → ❌ 403 Forbidden
├─ Token expired? → ❌ 403 Forbidden
├─ Token sessionId == current session? → ❌ 403 Forbidden
│
└─ ✅ Pass to handler
```

#### Double-Submit Cookie Pattern

**Why**: Stateless validation, works with serverless/edge

1. Server generates token → sends in both cookie + header/body
2. Client stores token → includes in `X-CSRF-Token` header
3. Server validates: `cookie === header && redis.exists(token)`

### 4. Rate Limiting Layers

#### Layer 1: Global IP-Based (Middleware)

```typescript
// Prevents DDoS, enforces platform-wide limits
const IP_RATE_LIMITS = {
  '/api/ai/*': { max: 100, window: '1h' },      // 100 AI reqs/hour per IP
  '/api/v1/*': { max: 1000, window: '1h' },     // 1000 API reqs/hour per IP
  '/api/auth/*': { max: 10, window: '15m' },    // 10 auth attempts/15min per IP
};
```

#### Layer 2: User-Based (withAIAuth)

```typescript
// Enforces tier-based limits, prevents abuse
const USER_RATE_LIMITS: Record<UserTier, number> = {
  free: 10,        // 10 AI requests/hour
  pro: 100,        // 100 AI requests/hour
  enterprise: 1000 // 1000 AI requests/hour
};
```

#### Layer 3: Resource-Based (Future)

```typescript
// Per-project, per-org limits (Phase 2)
const RESOURCE_LIMITS = {
  projectCreation: { max: 10, window: '1d' },   // 10 projects/day per user
  documentUploads: { max: 50, window: '1h' },   // 50 docs/hour per project
};
```

---

## Implementation Plan

### Phase 1A: Global Middleware (2 hours)

**File**: `app/src/middleware.ts`

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Public paths - skip all checks
  const publicPaths = ['/autentificare', '/inregistrare', '/api/auth', '/api/health'];
  if (publicPaths.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 2. IP-based rate limiting
  const ip = request.ip || request.headers.get('x-forwarded-for') || 'unknown';
  const ipRateLimit = await checkIPRateLimit(ip, pathname);
  if (!ipRateLimit.allowed) {
    return new NextResponse('Rate limit exceeded', {
      status: 429,
      headers: {
        'X-RateLimit-Limit': ipRateLimit.limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': ipRateLimit.resetTime.toString(),
      }
    });
  }

  // 3. Authentication check
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token && pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 4. CSRF validation (POST/PUT/DELETE/PATCH only)
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    const isCSRFValid = await validateCSRFMiddleware(request);
    if (!isCSRFValid) {
      return NextResponse.json({ error: 'CSRF token invalid' }, { status: 403 });
    }
  }

  // 5. Add security headers
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
```

### Phase 1B: CSRF System (3 hours)

**Files**:
- `app/src/lib/middleware/csrf.ts` - Token generation/validation
- `app/src/lib/auth/session.ts` - Token injection into session
- `app/src/components/CSRFProvider.tsx` - Client-side token management

**Key Functions**:

```typescript
// Token generation (called on login/session refresh)
export async function generateCSRFToken(sessionId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const redis = getRedis();

  if (redis) {
    await redis.setex(`csrf:${sessionId}`, 3600, token); // 1 hour
  }

  return token;
}

// Validation (called by middleware)
export async function validateCSRFToken(
  request: NextRequest,
  sessionId: string
): Promise<boolean> {
  const headerToken = request.headers.get('X-CSRF-Token');
  const cookieToken = request.cookies.get('csrf-token')?.value;

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return false;
  }

  const redis = getRedis();
  if (redis) {
    const storedToken = await redis.get(`csrf:${sessionId}`);
    return storedToken === headerToken;
  }

  return true; // Fallback if Redis unavailable
}
```

### Phase 1C: Protect AI Endpoints (4 hours)

**Strategy**: Batch update all 15 unprotected endpoints

**Script**: `scripts/protect-ai-endpoints.sh`

```bash
#!/bin/bash
# Automated AI endpoint protection

ENDPOINTS=(
  "match-grants"
  "validate-compliance"
  "generate-proposal"
  "project-analysis"
  "analyze-document"
  "deadline-risk-assessment"
  "optimize-timeline"
  "analyze-consortium"
  "optimize-budget"
  "generate-report"
  "project-health"
  "market-intelligence"
  "recommend-partners"
  "generate-insights"
  "advanced-analytics"
)

for endpoint in "${ENDPOINTS[@]}"; do
  echo "Protecting /api/ai/$endpoint..."

  # Add withAIAuth import and wrap handler
  # (Implementation uses sed/awk to modify route.ts files)
done
```

---

## Security Testing Plan

### Test 1: Unauthenticated Access

```bash
# Should return 401
curl -X POST http://localhost:3000/api/ai/match-grants \
  -H "Content-Type: application/json" \
  -d '{"projectIdea": "test"}'

# Expected: {"error": "Authentication required", "code": "UNAUTHORIZED"}
```

### Test 2: Rate Limiting

```bash
# Exceed free tier limit (10 requests/hour)
for i in {1..15}; do
  curl -X POST http://localhost:3000/api/ai/predict-success \
    -H "Authorization: Bearer $FREE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"quick": true, ...}'
done

# Expected on 11th request: 429 Rate Limit Exceeded
```

### Test 3: CSRF Protection

```bash
# Missing CSRF token
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", ...}'

# Expected: {"error": "CSRF token required", "code": "CSRF_REQUIRED"}

# With valid CSRF token
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", ...}'

# Expected: 201 Created
```

### Test 4: IP Rate Limiting

```bash
# Simulate DDoS from single IP
for i in {1..150}; do
  curl http://localhost:3000/api/ai/match-grants
done

# Expected after 100 requests: 429 (IP-based limit)
```

---

## Deployment Checklist

### Pre-Production

- [ ] All 17 AI endpoints protected with `withAIAuth`
- [ ] Global middleware deployed and tested
- [ ] CSRF tokens generated on login
- [ ] CSRF validation enforced on all state-changing operations
- [ ] Rate limiting active (IP + user-based)
- [ ] Security headers added to all responses
- [ ] Redis connection stable (with fallback behavior)
- [ ] Audit logging captures auth failures
- [ ] Error messages don't leak sensitive info
- [ ] Session cookies use `Secure`, `HttpOnly`, `SameSite=Strict`

### Production Hardening (Phase 2)

- [ ] CAPTCHA on login after 3 failed attempts
- [ ] Anomaly detection (e.g., sudden spike in requests)
- [ ] Geographic rate limiting (EU vs non-EU)
- [ ] WebAuthn/2FA support
- [ ] Session rotation on privilege escalation
- [ ] Audit log export for GDPR compliance
- [ ] Penetration testing by external firm
- [ ] Bug bounty program launch

---

## Risk Assessment

### Before Implementation

| Risk | Likelihood | Impact | Severity |
|------|------------|--------|----------|
| Unauthorized AI access | **HIGH** | Critical | **🔴 P0** |
| Rate limit bypass | **HIGH** | High | **🔴 P0** |
| CSRF attacks | Medium | High | **🟠 P1** |
| Session hijacking | Medium | Critical | **🟠 P1** |
| DDoS attack | HIGH | Medium | **🟠 P1** |

### After Implementation

| Risk | Likelihood | Impact | Severity |
|------|------------|--------|----------|
| Unauthorized AI access | **LOW** | Critical | **🟢 P2** |
| Rate limit bypass | **LOW** | High | **🟢 P3** |
| CSRF attacks | **LOW** | High | **🟢 P3** |
| Session hijacking | Medium | Critical | **🟠 P1** |
| DDoS attack | LOW | Medium | **🟢 P3** |

---

## Compliance Impact

### GDPR (Article 32 - Security)

**Before**: ❌ Fails - No authentication on sensitive endpoints
**After**: ✅ Passes - Multi-layered access controls

### eIDAS Regulation

**Before**: ❌ Fails - No session integrity validation
**After**: ✅ Passes - CSRF + secure session management

### Romanian Data Protection Law (LPDP)

**Before**: ❌ Fails - Inadequate technical measures
**After**: ✅ Passes - Defense-in-depth architecture

---

## Next Steps

1. **Immediate** (Next 2 hours):
   - Implement global `middleware.ts`
   - Deploy to staging environment
   - Run security tests

2. **Today** (Next 6 hours):
   - Protect all 15 unprotected AI endpoints
   - Implement CSRF token system
   - Update client-side code to include CSRF tokens

3. **This Week**:
   - Load testing with Locust/K6
   - Security audit with OWASP ZAP
   - Documentation for developers

4. **Before Production**:
   - External penetration testing
   - Legal review of security measures
   - Incident response plan finalized

---

## Metrics & Monitoring

### Key Metrics

1. **Auth Failure Rate**: < 1% (excludes intentional brute-force)
2. **Rate Limit Hit Rate**: < 5% of legitimate users
3. **CSRF Validation Failure**: < 0.1% (indicates attacks)
4. **Session Hijacking Attempts**: 0 successful
5. **AI Endpoint Unauthorized Access**: 0

### Alerting Thresholds

- **Critical**: 10+ auth failures from single IP in 1 minute
- **Critical**: 100+ rate limit hits in 5 minutes (DDoS)
- **High**: CSRF validation failure rate > 1%
- **Medium**: Redis connection failure > 10 seconds

---

**Document Version**: 1.0
**Last Updated**: 2026-02-15
**Owner**: Security Team
**Reviewers**: CTO, Legal, DevOps
