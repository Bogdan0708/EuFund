import { NextRequest, NextResponse } from 'next/server';
import { withAIAuth } from '@/lib/middleware/auth';
import { aiGenerate } from '@/lib/ai/client';
import { enhanceIdeaSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { sanitizeAIOutput } from '@/lib/ai/sanitize';

const log = logger.child({ component: 'wizard-enhance-idea' });

export async function POST(req: NextRequest) {
  return withAIAuth(req, async (user) => {
    try {
      const body = await req.json();
      const parsed = enhanceIdeaSchema.safeParse(body);
      
      if (!parsed.success) {
        throw Errors.validation('body', 'Date invalide', 'Invalid input');
      }

      const { projectIdea, locale } = parsed.data;

      const system = locale === 'ro'
        ? 'Ești un expert în consultanță pentru fonduri europene. Rolul tău este să rafinezi o idee de proiect brută, să o structurezi și să o faci să sune profesionist și eligibil.'
        : 'You are an expert EU funds consultant. Your role is to refine a raw project idea, structure it, and make it sound professional and eligible.';

      const prompt = locale === 'ro'
        ? `Rafinează următoarea idee de proiect: "${projectIdea}". Returnează în format clar:
1) Idee îmbunătățită
2) 3-5 sugestii concrete
3) Rezumat structurat cu: problema, obiectiv, activități, impact`
        : `Refine the following project idea: "${projectIdea}". Return in clear format:
1) Enhanced idea
2) 3-5 concrete suggestions
3) Structured summary with: problem, objective, activities, impact`;

      const response = await aiGenerate({
        system,
        prompt,
        temperature: 0.7,
      });
      const { sanitized } = sanitizeAIOutput(response.text);
      const lines = sanitized
        .split('\n')
        .map((line: string) => line.trim())
        .filter(Boolean);
      const suggestions = lines
        .filter((line: string) => /^[-*•]|^\d+[.)]/.test(line))
        .slice(0, 5);
      const structuredSummary = lines.slice(0, 4).join('\n');

      await logAudit({
        userId: user.id,
        action: 'ai.wizard_enhance',
        resourceType: 'ai_wizard',
        metadata: { length: projectIdea.length, locale },
      });

      return NextResponse.json({
        success: true,
        data: {
          enhancedIdea: sanitized,
          suggestions,
          structuredSummary,
          originalIdea: projectIdea,
        },
      });

    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
      }
      log.error({ error }, '[wizard:enhance] error');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  }, { feature: 'proposal' });
}
