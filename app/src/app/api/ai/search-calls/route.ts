import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAIAuth } from '@/lib/middleware/auth';
import { aiGenerate } from '@/lib/ai/client-v2';

const searchCallsSchema = z.object({
  query: z.string().min(3).max(500),
  region: z.string().optional(),
  sector: z.string().optional(),
});

export async function POST(request: NextRequest) {
  return withAIAuth(request, async () => {
    const body = await request.json();
    const parsed = searchCallsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const { query, region, sector } = parsed.data;

    const prompt = `Search for currently open EU and Romanian funding calls matching this criteria:
Query: ${query}
${region ? `Region: ${region}` : ''}
${sector ? `Sector: ${sector}` : ''}

Return a JSON array of funding calls found, each with: title, program, sourceUrl, deadline (if known), budgetRange (if known), status (open/forthcoming), summary.
Only include calls that are currently open or forthcoming. Do not include expired calls.`;

    const result = await aiGenerate({
      system: 'You are a funding call search assistant. Return only valid JSON arrays.',
      prompt,
      maxTokens: 2000,
      taskType: 'search' as never,
    });

    let calls: unknown[] = [];
    try {
      const parsed = JSON.parse(result.text);
      calls = Array.isArray(parsed) ? parsed : [];
    } catch {
      calls = [];
    }

    return NextResponse.json({ calls, source: 'web_search' });
  });
}
