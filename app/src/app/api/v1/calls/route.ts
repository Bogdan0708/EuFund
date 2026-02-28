import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { callsForProposals, fundingPrograms, sourceConnectors } from '@/lib/db/schema';
import { eq, and, or, ilike, inArray, asc, SQL } from 'drizzle-orm';
import { requireAuth, getPaginationParams } from '@/lib/auth/helpers';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'calls-api' });

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { page, perPage, offset } = getPaginationParams(req);
    
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const programId = url.searchParams.get('programId');
    const source = url.searchParams.get('source');
    const search = url.searchParams.get('search');

    const filters: SQL[] = [];

    if (status && status !== 'all') {
      if (status === 'open') {
        filters.push(eq(callsForProposals.status, 'deschis'));
      } else if (status === 'forthcoming') {
        filters.push(eq(callsForProposals.status, 'previzionat'));
      } else {
        filters.push(eq(callsForProposals.status, status as 'deschis' | 'previzionat' | 'inchis' | 'in_evaluare' | 'anulat'));
      }
    } else {
      // Default: only active/forthcoming
      filters.push(inArray(callsForProposals.status, ['deschis', 'previzionat']));
    }

    if (programId) {
      filters.push(eq(callsForProposals.programId, programId));
    }

    if (source) {
      filters.push(eq(sourceConnectors.slug, source));
    }

    if (search) {
      filters.push(
        or(
        ilike(callsForProposals.titleRo, `%${search}%`),
        ilike(callsForProposals.callCode, `%${search}%`)
      ) as SQL);
    }

    const data = await db.select({
      call: callsForProposals,
      program: fundingPrograms,
      source: sourceConnectors,
    })
    .from(callsForProposals)
    .innerJoin(fundingPrograms, eq(callsForProposals.programId, fundingPrograms.id))
    .leftJoin(sourceConnectors, eq(callsForProposals.sourceConnectorId, sourceConnectors.id))
    .where(and(...filters))
    .orderBy(asc(callsForProposals.submissionEnd))
    .limit(perPage)
    .offset(offset);

    return NextResponse.json({
      success: true,
      data: data.map(d => ({
        ...d.call,
        programName: d.program.nameRo,
        programCode: d.program.code,
        sourceSlug: d.source?.slug ?? null,
        sourceName: d.source?.name ?? null,
      })),
      pagination: { page, perPage }
    });

  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    log.error({ error }, '[calls:list] error');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
}
