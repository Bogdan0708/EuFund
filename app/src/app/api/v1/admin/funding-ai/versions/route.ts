import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { fundingCallVersions } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-funding-ai-versions-route' });
export const dynamic = 'force-dynamic';

const createVersionSchema = z.object({
  callExternalKey: z.string().min(1).max(255),
  versionNo: z.number().int().min(1).optional(),
  changeType: z.string().min(1).max(50).optional(),
  changedFields: z.record(z.string(), z.unknown()),
  diffSummary: z.string().max(10000).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin();
    const callExternalKey = req.nextUrl.searchParams.get('callExternalKey');
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '20');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 20;

    if (!callExternalKey) {
      throw Errors.validation('query.callExternalKey', 'Lipsește callExternalKey', 'Missing callExternalKey');
    }

    const rows = await db.query.fundingCallVersions.findMany({
      where: eq(fundingCallVersions.callExternalKey, callExternalKey),
      orderBy: (items, { desc: d }) => [d(items.versionNo)],
      limit,
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-versions] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();
    const body = await req.json();
    const parsed = createVersionSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const payload = parsed.data;
    const inserted = await db.transaction(async (tx) => {
      let versionNo = payload.versionNo;
      if (!versionNo) {
        const latest = await tx.query.fundingCallVersions.findFirst({
          where: eq(fundingCallVersions.callExternalKey, payload.callExternalKey),
          orderBy: (items, { desc: d }) => [d(items.versionNo)],
        });
        versionNo = (latest?.versionNo ?? 0) + 1;
      }

      const [row] = await tx.insert(fundingCallVersions).values({
        callExternalKey: payload.callExternalKey,
        versionNo,
        changeType: payload.changeType ?? 'updated',
        changedFields: payload.changedFields,
        diffSummary: payload.diffSummary,
        createdBy: user.id,
      }).returning();
      return row;
    });

    await logAudit({
      userId: user.id,
      action: 'funding_ai.version_create',
      resourceType: 'funding_call_version',
      resourceId: inserted.id,
      metadata: {
        callExternalKey: inserted.callExternalKey,
        versionNo: inserted.versionNo,
      },
    });

    return NextResponse.json({ success: true, data: inserted }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-versions] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
