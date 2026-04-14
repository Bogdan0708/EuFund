# Direct AI Providers + Disable Tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bypass the offline AI gateway by calling AI providers directly, and disable all tier/billing/rate-limit gates so the app runs with zero restrictions.

**Architecture:** Replace the single `gateway.ts` adapter (which routes everything through the offline external gateway) with direct OpenAI-compatible SDK calls to each provider (Gemini, Perplexity, Claude, OpenAI). The `GatewayClient` interface stays identical — no agent code changes. Remove all billing checks and rate limits from the message endpoint and auth middleware.

**Tech Stack:** OpenAI SDK v6 (used for all providers via OpenAI-compatible endpoints), existing env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `PERPLEXITY_API_KEY`)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/ai/orchestrator/gateway.ts` | **Rewrite** | Route to correct provider SDK based on `opts.provider` |
| `src/app/api/ai/orchestrator/message/route.ts` | **Modify** | Remove billing checks, simplify session creation |
| `src/lib/middleware/auth.ts` | **Modify** | Skip rate limiting, authenticate only |
| `src/lib/ai/orchestrator/agents/build.ts` | **Modify** | Remove tier-based model selection |
| `src/lib/ai/orchestrator/agents/edit.ts` | **Modify** | Remove tier-based model selection |

---

### Task 1: Rewrite gateway.ts for direct provider routing

**Files:**
- Rewrite: `app/src/lib/ai/orchestrator/gateway.ts`

This is the core change. The current gateway discards the `provider`/`model` from agent requests and routes everything through `aiGenerate()` → offline gateway HTTP endpoint. The new version creates an OpenAI-compatible client per provider and routes based on `opts.provider`.

- [ ] **Step 1: Rewrite gateway.ts**

Replace the entire content of `app/src/lib/ai/orchestrator/gateway.ts` with:

```typescript
import OpenAI from 'openai'
import type { GatewayClient } from './types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'gateway' })

// ─── Provider clients (lazy-initialized singletons) ─────────────

const clients: Record<string, OpenAI> = {}

function getClient(provider: string): OpenAI {
  if (clients[provider]) return clients[provider]

  switch (provider) {
    case 'openai':
      clients[provider] = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
      break

    case 'claude':
    case 'anthropic':
      clients[provider] = new OpenAI({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseURL: 'https://api.anthropic.com/v1/',
      })
      break

    case 'gemini':
    case 'google':
      clients[provider] = new OpenAI({
        apiKey: process.env.GOOGLE_AI_API_KEY,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      })
      break

    case 'perplexity':
      clients[provider] = new OpenAI({
        apiKey: process.env.PERPLEXITY_API_KEY,
        baseURL: 'https://api.perplexity.ai/',
      })
      break

    default:
      // Fall back to OpenAI for unknown providers
      log.warn({ provider }, 'Unknown provider, falling back to OpenAI')
      clients[provider] = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
  }

  return clients[provider]
}

// ─── Embedding client (always OpenAI) ───────────────────────────

function getEmbeddingClient(): OpenAI {
  if (clients['_embed']) return clients['_embed']
  clients['_embed'] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return clients['_embed']
}

// ─── Public API ─────────────────────────────────────────────────

export function createGatewayClient(_tenantId: string): GatewayClient {
  return {
    async generate(opts) {
      const client = getClient(opts.provider)

      const messages: OpenAI.ChatCompletionMessageParam[] = []
      if (opts.system) {
        messages.push({ role: 'system', content: opts.system })
      }
      for (const m of opts.messages) {
        messages.push({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })
      }

      log.info({ provider: opts.provider, model: opts.model }, 'AI request')

      const response = await client.chat.completions.create({
        model: opts.model,
        messages,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
      })

      const content = response.choices?.[0]?.message?.content ?? ''
      const tokensUsed = response.usage?.total_tokens ?? 0

      return { content, tokensUsed }
    },

    async embed(text: string) {
      const client = getEmbeddingClient()
      const response = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      })
      return response.data[0].embedding
    },
  }
}
```

- [ ] **Step 2: Verify env vars exist**

Run:
```bash
grep -c 'OPENAI_API_KEY\|ANTHROPIC_API_KEY\|GOOGLE_AI_API_KEY\|PERPLEXITY_API_KEY' app/.env.local
```
Expected: 4 (all keys present)

- [ ] **Step 3: Commit**

```bash
cd app && git add src/lib/ai/orchestrator/gateway.ts
git commit -m "feat: replace gateway proxy with direct provider routing via OpenAI SDK"
```

---

### Task 2: Remove billing gates from orchestrator message endpoint

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/message/route.ts`

Remove the `checkWorkflowLimit`/`incrementWorkflowCount` calls and the tier lookup. Pass a fixed tier string to `createSession`.

- [ ] **Step 1: Remove billing imports and tier lookup**

In `app/src/app/api/ai/orchestrator/message/route.ts`:

Remove line 7 (billing import):
```typescript
// DELETE: import { checkWorkflowLimit, incrementWorkflowCount } from '@/lib/billing/usage'
```

Remove lines 48-50 (tier lookup):
```typescript
// DELETE:
//     const [dbUser] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, user.id)).limit(1)
//     const tier = dbUser?.tier || 'free'
```

Remove lines 53-58 (limit check):
```typescript
// DELETE:
//       const limitCheck = await checkWorkflowLimit(user.id, tier)
//       if (!limitCheck.allowed) {
//         return NextResponse.json({ error: limitCheck.message }, { status: 429 })
//       }
//       await incrementWorkflowCount(user.id)
```

Change line 59 to use fixed tier:
```typescript
// BEFORE:
//       const session = await createSession(user.id, locale || 'ro', tier)
// AFTER:
      const session = await createSession(user.id, locale || 'ro', 'free')
```

Also clean up unused imports. Remove `users` from the schema import (line 4) if it's only used for the tier lookup, and remove the `db` import if unused. Check if `db` and `users` are still used elsewhere in the file first.

After these changes, the `if (!sessionId)` block should look like:

```typescript
    if (!sessionId) {
      const session = await createSession(user.id, locale || 'ro', 'free')

      const stream = createPubSubStream(session.id)
      const gateway = createGatewayClient('fondeu')
      log.info({ sessionId: session.id, userId: user.id }, 'New session created, processing message')
      await acquireLock(session.id)
      processMessage(session.id, message, stream, gateway).then(() => {
        releaseLock(session.id)
      }).catch((err) => {
        releaseLock(session.id)
        log.error({ error: err instanceof Error ? err.message : String(err), sessionId: session.id }, 'processMessage failed')
      })

      return NextResponse.json({ sessionId: session.id }, { status: 202 })
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/ai/orchestrator/message/route.ts
git commit -m "fix: remove billing gates from orchestrator message endpoint"
```

---

### Task 3: Disable rate limiting in withAIAuth middleware

**Files:**
- Modify: `app/src/lib/middleware/auth.ts`

The `guardAIRequest` function checks Redis availability, hourly rate limits, and daily feature limits. Replace the rate-limit section with a pass-through that always allows requests. Keep authentication and input sanitization.

- [ ] **Step 1: Replace guardAIRequest rate-limit logic**

In `app/src/lib/middleware/auth.ts`, replace the `guardAIRequest` function (lines 169-252) with:

```typescript
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
```

This keeps authentication and content-type validation, removes all Redis/rate-limit/tier checks.

- [ ] **Step 2: Commit**

```bash
git add src/lib/middleware/auth.ts
git commit -m "fix: disable rate limiting in AI auth middleware"
```

---

### Task 4: Remove tier-based model selection from build and edit agents

**Files:**
- Modify: `app/src/lib/ai/orchestrator/agents/build.ts:12-16`
- Modify: `app/src/lib/ai/orchestrator/agents/edit.ts:12-13`

Both agents select cheaper models for free-tier users. Since tiers are disabled, always use the best model (Claude Sonnet 4.6).

- [ ] **Step 1: Fix build.ts**

In `app/src/lib/ai/orchestrator/agents/build.ts`, replace lines 12-16:

```typescript
  // BEFORE:
  // const model = (ctx.tier === 'pro' || ctx.tier === 'ultra')
  //   ? 'claude-sonnet-4-6'
  //   : 'gemini-2.5-flash-preview'
  // const provider = (ctx.tier === 'pro' || ctx.tier === 'ultra') ? 'claude' : 'gemini'

  // AFTER:
  const provider = 'claude'
  const model = 'claude-sonnet-4-6'
```

- [ ] **Step 2: Fix edit.ts**

In `app/src/lib/ai/orchestrator/agents/edit.ts`, replace lines 12-13:

```typescript
  // BEFORE:
  // const model = (ctx.tier === 'pro' || ctx.tier === 'ultra') ? 'claude-sonnet-4-6' : 'gemini-2.5-flash-preview'
  // const provider = (ctx.tier === 'pro' || ctx.tier === 'ultra') ? 'claude' : 'gemini'

  // AFTER:
  const provider = 'claude'
  const model = 'claude-sonnet-4-6'
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/orchestrator/agents/build.ts src/lib/ai/orchestrator/agents/edit.ts
git commit -m "fix: always use Claude Sonnet for build and edit agents"
```

---

### Task 5: End-to-end smoke test

After all changes, verify the full 7-phase flow works with direct provider calls.

- [ ] **Step 1: Reset Redis state**

```bash
docker exec eu-funds-redis-1 redis-cli FLUSHDB
```

- [ ] **Step 2: Test orchestrator message endpoint**

```bash
# Get fresh auth cookies via Playwright auth setup
cd app && npx playwright test e2e/auth.setup.ts --project=setup

# Extract session token
COOKIES=$(python3 -c "import json; d=json.load(open('e2e/.auth/user.json')); print('; '.join(f'{c[\"name\"]}={c[\"value\"]}' for c in d['cookies']))")

# Test new session creation (should NOT get 429)
curl -s -w "\nHTTP:%{http_code}" -X POST http://localhost:3002/api/ai/orchestrator/message \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $(python3 -c "import json; d=json.load(open('e2e/.auth/user.json')); print(next(c['value'] for c in d['cookies'] if c['name']=='csrf-token'))")" \
  -H "Cookie: $COOKIES" \
  -d '{"message":"Vreau sa creez un proiect de digitalizare a primariilor din judetul Timis cu buget de 500000 EUR","locale":"ro"}'
```

Expected: `{"sessionId":"<uuid>"}` with HTTP 202 (NOT 429)

- [ ] **Step 3: Monitor server logs for AI calls**

Check the dev server terminal for log lines like:
```
AI request { provider: 'gemini', model: 'gemini-2.5-flash-preview' }
```

This confirms the direct provider routing is working.

- [ ] **Step 4: Run existing Playwright QA suite**

```bash
npx playwright test e2e/full-qa-test.spec.ts --project=chromium --reporter=list
```

All previously passing tests should still pass. The AI flow test (test 14) should now show AI responses in the chat.

- [ ] **Step 5: Commit test results if test file needs updates**

```bash
git add -A && git status
# Only commit if there are meaningful changes
```

---

## Task Order

1. **Task 1** (gateway rewrite) — core change, enables all AI calls
2. **Task 2** (remove billing) — unblocks session creation
3. **Task 3** (disable rate limits) — unblocks other AI endpoints
4. **Task 4** (model selection) — uses best models everywhere
5. **Task 5** (smoke test) — verify end-to-end

Total: 4 code changes across 5 files, 1 verification task. No new files, no new abstractions.
