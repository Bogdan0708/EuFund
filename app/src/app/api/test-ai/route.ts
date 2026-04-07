// ─── AI Integration Test Endpoint ────────────────────────────────────
import { NextResponse } from 'next/server';
import { aiGenerate } from '@/lib/ai/client';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  try {
    // Test: Simple generation via gateway
    let generationTest: { success: boolean; error?: string; text?: string; tokensUsed?: number } = {
      success: false,
      error: 'Not attempted',
    };

    try {
      const result = await aiGenerate({
        system: 'You are a helpful assistant.',
        prompt: 'Say hello in exactly 5 words.',
        maxTokens: 50,
      });

      generationTest = {
        success: true,
        text: result.text,
        tokensUsed: result.tokensUsed,
      };
    } catch (error: unknown) {
      generationTest = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      system: 'AI Gateway Integration',
      tests: { generation: generationTest },
      status: generationTest.success ? 'healthy' : 'degraded',
    });
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Integration test failed: ${details}` },
      },
      { status: 500 },
    );
  }
}
