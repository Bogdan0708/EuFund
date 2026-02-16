// ─── POST /api/ai/analyze-document ───────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { analyzeDocument } from '@/lib/ai/document-analyzer';
import { FondEUError, Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { withAIAuth } from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    try {
      const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const projectContext = formData.get('projectContext') as string | null;
    const callContext = formData.get('callContext') as string | null;
    const locale = (formData.get('locale') as string) || 'ro';

    if (!file) {
      return NextResponse.json(
        Errors.validation('file', 'Fișierul este obligatoriu', 'File is required').toResponse(),
        { status: 400 }
      );
    }

    // Size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        Errors.validation('file', 'Fișierul depășește 10MB', 'File exceeds 10MB').toResponse(),
        { status: 400 }
      );
    }

    // Extract text content based on mime type
    let content: string;
    const mimeType = file.type;

    if (mimeType === 'text/plain') {
      content = await file.text();
    } else if (mimeType === 'application/pdf') {
      const buffer = Buffer.from(await file.arrayBuffer());
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();
      content = textResult.text;
      await parser.destroy();
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else {
      return NextResponse.json(
        Errors.validation(
          'file',
          'Tipul fișierului nu este suportat. Acceptăm PDF, DOCX, TXT.',
          'Unsupported file type. We accept PDF, DOCX, TXT.'
        ).toResponse(),
        { status: 400 }
      );
    }

    if (!content || content.trim().length < 10) {
      return NextResponse.json(
        Errors.validation('file', 'Nu s-a putut extrage text din fișier', 'Could not extract text from file').toResponse(),
        { status: 400 }
      );
    }

    const result = await analyzeDocument({
      content,
      filename: file.name,
      mimeType,
      projectContext: projectContext || undefined,
      callContext: callContext || undefined,
      locale: locale as 'ro' | 'en',
    });

    await logAudit({
      userId: user.id,
      action: 'ai.compliance_check',
      resourceType: 'document',
      metadata: {
        filename: file.name,
        mimeType,
        fileSize: file.size,
        tokensUsed: result.tokensUsed,
        piiDetected: result.piiDetections.length > 0,
        userTier: user.tier,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        analysis: result.analysis,
        piiDetections: result.piiDetections,
        gdprCompliant: result.gdprCompliant,
        metadata: {
          tokensUsed: result.tokensUsed,
          analyzedAt: new Date().toISOString(),
        },
      },
    });
    } catch (error) {
      if (error instanceof FondEUError) {
        return NextResponse.json(error.toResponse(), { status: error.statusCode });
      }
      logger.error({ error: error }, '[analyze-document]');
      return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
    }
  });
}
