#!/usr/bin/env npx tsx
// ─── AI Gateway Smoke Test ──────────────────────────────────────────
// Standalone script — raw fetch, no Next.js imports.
// Validates FundEU's AI gateway contract against the live service.
//
// Usage:  npm run smoke:ai
//         npx tsx scripts/smoke-test-ai.ts
//
// Reads env from .env.local via --env-file (tsx flag in package.json script).

const GATEWAY_URL = process.env.AI_GATEWAY_URL?.replace(/\/$/, '');
const GATEWAY_KEY = process.env.AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY;
const TENANT_ID = process.env.AI_GATEWAY_TENANT_ID || 'fondeu-platform';
const GENERATION_MODEL = process.env.AI_GENERATION_MODEL || 'gpt-4o';
const ANALYSIS_MODEL = process.env.AI_ANALYSIS_MODEL || 'gpt-4o';
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function run(name: string, fn: () => Promise<string | void>) {
  const start = performance.now();
  try {
    const detail = await fn();
    results.push({ name, passed: true, detail: detail || 'OK', durationMs: Math.round(performance.now() - start) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, passed: false, detail: msg, durationMs: Math.round(performance.now() - start) });
  }
}

async function main() {
  if (!GATEWAY_URL || !GATEWAY_KEY) {
    console.error('Missing AI_GATEWAY_URL or AI_GATEWAY_API_KEY / AI_GATEWAY_KEY in env');
    process.exit(1);
  }

  console.log(`\nAI Gateway Smoke Test`);
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`Tenant:  ${TENANT_ID}\n`);

  // 1. Health check
  await run('Health check', async () => {
    const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { status?: string };
    if (data.status !== 'healthy') throw new Error(`status=${data.status}`);
  });

  // 2. Chat completion — generation model
  await run(`Chat completion (${GENERATION_MODEL})`, async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_KEY}`,
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_ID,
      },
      body: JSON.stringify({
        model: GENERATION_MODEL,
        messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
        max_tokens: 10,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || '(empty)';
  });

  // 3. Chat completion — analysis model
  if (ANALYSIS_MODEL !== GENERATION_MODEL) {
    await run(`Chat completion (${ANALYSIS_MODEL})`, async () => {
      const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GATEWAY_KEY}`,
          'Content-Type': 'application/json',
          'x-tenant-id': TENANT_ID,
        },
        body: JSON.stringify({
          model: ANALYSIS_MODEL,
          messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
    });
  }

  // 4. JSON mode (structured output)
  await run('JSON mode structured output', async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_KEY}`,
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_ID,
      },
      body: JSON.stringify({
        model: ANALYSIS_MODEL,
        messages: [
          { role: 'system', content: 'Return valid JSON with a single key "status" set to "ok".' },
          { role: 'user', content: 'Generate the JSON.' },
        ],
        max_tokens: 20,
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    if (parsed.status !== 'ok') throw new Error(`Unexpected JSON: ${content}`);
  });

  // 5. Embeddings
  await run(`Embeddings (${EMBEDDING_MODEL})`, async () => {
    const res = await fetch(`${GATEWAY_URL}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_KEY}`,
        'Content-Type': 'application/json',
        'x-tenant-id': TENANT_ID,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: 'test embedding for FondEU smoke test',
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
    const dims = data.data?.[0]?.embedding?.length || 0;
    if (dims !== 1536) throw new Error(`Expected 1536 dims, got ${dims}`);
    return `${dims} dimensions`;
  });

  // Report
  console.log('─'.repeat(60));
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${r.name} (${r.durationMs}ms) — ${r.detail}`);
    if (!r.passed) failed++;
  }
  console.log('─'.repeat(60));
  console.log(`${results.length} tests, ${failed} failed\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
