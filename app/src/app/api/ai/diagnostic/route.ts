// ─── AI Diagnostic Endpoint ─────────────────────────────────────
// GET /api/ai/diagnostic — Tests the full AI chain from Cloud Run
// Protected: requires platform admin or diagnostic token

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Simple auth: either HEALTHCHECK_AUTH_TOKEN or platform admin
  const token = req.headers.get('x-diagnostic-token') || req.headers.get('authorization')?.replace('Bearer ', '');
  const expectedToken = process.env.HEALTHCHECK_AUTH_TOKEN || process.env.AI_GATEWAY_API_KEY;

  if (!token || token !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      AI_GATEWAY_URL: process.env.AI_GATEWAY_URL ? 'SET' : 'MISSING',
      AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY ? 'SET' : 'MISSING',
      AI_GATEWAY_KEY: process.env.AI_GATEWAY_KEY ? 'SET' : 'MISSING',
      AI_GATEWAY_TENANT_ID: process.env.AI_GATEWAY_TENANT_ID || 'NOT SET',
      REDIS_URL: process.env.REDIS_URL ? 'SET' : 'MISSING',
      DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'MISSING',
      NODE_ENV: process.env.NODE_ENV,
    },
  };

  // Test 1: Database connectivity
  try {
    const { db } = await import('@/lib/db');
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`SELECT 1`);
    results.database = 'OK';
  } catch (e) {
    results.database = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 2: Redis connectivity
  try {
    const { getRedis } = await import('@/lib/redis/client');
    const redis = getRedis();
    if (!redis) {
      results.redis = 'NOT CONFIGURED';
    } else {
      const pong = await redis.ping();
      results.redis = pong === 'PONG' ? 'OK' : `UNEXPECTED: ${pong}`;
    }
  } catch (e) {
    results.redis = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 3: Redis pub/sub (publish + subscribe)
  try {
    const { getRedis } = await import('@/lib/redis/client');
    const redis = getRedis();
    if (!redis) {
      results.redisPubSub = 'SKIPPED (no redis)';
    } else {
      const Redis = (await import('ioredis')).default;
      const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

      const testChannel = 'diagnostic:test';
      const testMessage = JSON.stringify({ test: true, ts: Date.now() });

      const received = await new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => {
          sub.unsubscribe(testChannel);
          sub.disconnect();
          resolve(null);
        }, 5000);

        sub.subscribe(testChannel).then(() => {
          sub.on('message', (_ch: string, msg: string) => {
            clearTimeout(timeout);
            sub.unsubscribe(testChannel);
            sub.disconnect();
            resolve(msg);
          });
          // Publish after subscribed
          redis.publish(testChannel, testMessage);
        });
      });

      results.redisPubSub = received === testMessage ? 'OK' : `FAIL: received=${received}`;
    }
  } catch (e) {
    results.redisPubSub = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 4: AI Gateway direct call
  try {
    const gatewayUrl = process.env.AI_GATEWAY_URL;
    const gatewayKey = process.env.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_KEY;
    const tenantId = process.env.AI_GATEWAY_TENANT_ID || 'fondeu-platform';

    if (!gatewayUrl || !gatewayKey) {
      results.aiGateway = 'NOT CONFIGURED';
    } else {
      const resp = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${gatewayKey}`,
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'Reply with just: OK' }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        results.aiGateway = `HTTP ${resp.status}: ${body.slice(0, 200)}`;
      } else {
        const data = await resp.json();
        results.aiGateway = {
          status: 'OK',
          model: data.model,
          content: data.choices?.[0]?.message?.content,
          tokens: data.usage?.total_tokens,
          latency: data.latency_ms,
        };
      }
    }
  } catch (e) {
    results.aiGateway = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 5: Workflow tables exist
  try {
    const { db } = await import('@/lib/db');
    const { sql } = await import('drizzle-orm');
    const tables = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name IN ('workflow_sessions','workflow_messages','project_files','project_documents','discovered_calls')
      ORDER BY table_name
    `);
    const tableNames = tables.map((r: Record<string, unknown>) => r.table_name);
    results.workflowTables = tableNames.length >= 2 ? { status: 'OK', tables: tableNames } : { status: 'MISSING', found: tableNames };
  } catch (e) {
    results.workflowTables = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Test 6: Full aiGenerate call
  try {
    const { aiGenerate } = await import('@/lib/ai/client');
    const result = await aiGenerate({
      system: 'Reply with just the word OK',
      prompt: 'Test',
      maxTokens: 5,
      temperature: 0,
    });
    results.aiGenerate = {
      status: 'OK',
      text: result.text,
      tokens: result.tokensUsed,
    };
  } catch (e) {
    results.aiGenerate = `FAIL: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Overall status
  const failures = Object.entries(results)
    .filter(([k, v]) => k !== 'timestamp' && k !== 'env' &&
      (typeof v === 'string' && (v.startsWith('FAIL') || v === 'NOT CONFIGURED' || v === 'MISSING')));

  results.overall = failures.length === 0 ? 'ALL OK' : `${failures.length} ISSUES`;

  return NextResponse.json(results, { status: 200 });
}
