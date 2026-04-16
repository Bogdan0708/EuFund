#!/usr/bin/env npx tsx
// ─── AI Provider Smoke Test ──────────────────────────────────────────
// Standalone script — raw fetch, no Next.js imports.
// Validates direct provider SDK connectivity for FondEU.
//
// Usage:  npm run smoke:ai
//         npx tsx scripts/smoke-test-ai.ts
//
// Reads env from .env.local via --env-file (tsx flag in package.json script).

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GOOGLE_KEY = process.env.GOOGLE_AI_API_KEY;
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
  const providers = [
    OPENAI_KEY && 'OpenAI',
    ANTHROPIC_KEY && 'Anthropic',
    GOOGLE_KEY && 'Google',
  ].filter(Boolean);

  if (providers.length === 0) {
    console.error('No AI provider keys found. Set at least one of: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY');
    process.exit(1);
  }

  console.log(`\nAI Provider Smoke Test (direct SDK)`);
  console.log(`Providers: ${providers.join(', ')}\n`);

  // OpenAI chat completion
  if (OPENAI_KEY) {
    await run('OpenAI chat completion', async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content?.trim() || '(empty)';
    });

    // OpenAI embeddings
    await run(`OpenAI embeddings (${EMBEDDING_MODEL})`, async () => {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: 'test embedding for FondEU smoke test',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
      const dims = data.data?.[0]?.embedding?.length || 0;
      if (dims !== 1536) throw new Error(`Expected 1536 dims, got ${dims}`);
      return `${dims} dimensions`;
    });
  }

  // Anthropic chat completion (used by Managed Agents)
  if (ANTHROPIC_KEY) {
    await run('Anthropic chat completion', async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json() as { content?: Array<{ text?: string }> };
      return data.content?.[0]?.text?.trim() || '(empty)';
    });
  }

  // Google AI chat completion
  if (GOOGLE_KEY) {
    await run('Google AI chat completion', async () => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GOOGLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash',
          messages: [{ role: 'user', content: 'Reply with exactly: SMOKE_OK' }],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content?.trim() || '(empty)';
    });
  }

  // Report
  console.log('\u2500'.repeat(60));
  let failed = 0;
  for (const r of results) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${r.name} (${r.durationMs}ms) \u2014 ${r.detail}`);
    if (!r.passed) failed++;
  }
  console.log('\u2500'.repeat(60));
  console.log(`${results.length} tests, ${failed} failed\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main();
