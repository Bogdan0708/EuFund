import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { executeSync } from '@/lib/connectors/executor';
import { logAudit } from '@/lib/legal/audit';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-connector-sync' });

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const user = await requirePlatformAdmin();
    const { slug } = params;

    log.info({ slug, userId: user.id }, 'Sync triggered via API');

    await logAudit({
      userId: user.id,
      action: 'system.connector_sync',
      resourceType: 'source_connector',
      metadata: { slug, triggeredBy: 'api' },
    });

    // Start background execution
    // Note: in a serverless env like Vercel, use waitUntil
    // For standard Node.js it just runs
    void executeSync(slug, { userId: user.id });
    
    // In Next.js 15 we'd use waitUntil(promise)
    // For now we just don't await it if we want 202 immediately, 
    // but Cloud Run/Vercel might kill the process.
    // Given the 'deploy' turn showed Cloud Run, backgrounding is safer.
    
    return NextResponse.json({
      success: true,
      message: 'Sync started in background',
      slug,
    }, { status: 202 });

  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    log.error({ error }, '[admin:connector-sync] error');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
}
