import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aiGenerate } from '@/lib/ai/client';
import { withAIAuth } from '@/lib/middleware/auth';
import { Errors } from '@/lib/errors';
import { logger } from '@/lib/logger';

const SYSTEM_PROMPT = 'Ești un asistent expert în fonduri europene pentru organizații din România. Răspunzi concis, practic și la obiect. Cunoști programele: Horizon Europe, LIFE+, Interreg, POCIDIF, PNRR și alte programe UE. Răspunzi în limba română dacă nu ți se cere altfel.';

const chatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z.array(z.object({
    role: z.string().trim().min(1).max(32),
    content: z.string().trim().min(1).max(4000),
  })).optional(),
  locale: z.string().trim().max(16).optional(),
});

function normalizeRole(role: string): 'user' | 'assistant' | 'system' {
  if (role === 'assistant' || role === 'system') {
    return role;
  }
  return 'user';
}

export async function POST(request: NextRequest) {
  return withAIAuth(request, async () => {
    try {
      const body = await request.json();
      const parsed = chatSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          Errors.validation('body', 'Date invalide', 'Invalid input').toResponse(),
          { status: 400 }
        );
      }

      const { message, history = [], locale } = parsed.data;
      const historyText = history
        .slice(-20)
        .map((item) => `${normalizeRole(item.role)}: ${item.content}`)
        .join('\n');

      const promptParts = [
        historyText ? `Istoric conversație:\n${historyText}` : '',
        `Mesajul curent al utilizatorului:\n${message}`,
        'Formulează un răspuns util, clar și aplicat.',
      ].filter(Boolean);

      const response = await aiGenerate({
        system: locale === 'en' ? `${SYSTEM_PROMPT} Răspunde în engleză.` : SYSTEM_PROMPT,
        prompt: promptParts.join('\n\n'),
        temperature: 0.3,
      });

      return NextResponse.json({
        success: true,
        data: {
          answer: response.text.trim(),
        },
      });
    } catch (error) {
      logger.error({ error }, '[ai-chat]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}
