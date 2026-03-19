// ─── Organization Verification API ───────────────────────────────
// POST /api/v1/organizations/[id]/verify - Trigger ONRC/ANAF verification

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { lookupCompany } from '@/lib/integrations/romanian/onrc';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

type Params = { params: { id: string } };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;


    const org = await db.query.organizations.findFirst({
      where: and(eq(organizations.id, id), isNull(organizations.deletedAt)),
    });

    if (!org) {
      throw Errors.notFound('organization', id);
    }

    if (!org.cui) {
      return NextResponse.json(
        Errors.validation('cui', 'CUI-ul este necesar pentru verificare.', 'CUI is required for verification.').toResponse('ro'),
        { status: 400 },
      );
    }

    // Look up company via ONRC/ANAF
    const companyData = await lookupCompany(org.cui);

    if (!companyData) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Compania cu CUI ${org.cui} nu a fost găsită în registrele publice.`,
        },
      }, { status: 404 });
    }

    // Update organization with verified data
    const [updated] = await db
      .update(organizations)
      .set({
        name: companyData.name || org.name,
        regCom: companyData.registrationNumber || org.regCom,
        caenPrimary: companyData.caenPrimary || org.caenPrimary,
        caenSecondary: companyData.caenSecondary?.length ? companyData.caenSecondary : org.caenSecondary,
        address: companyData.address ? companyData.address : org.address,
        foundedDate: companyData.foundedDate || org.foundedDate,
        metadata: {
          ...(org.metadata as Record<string, unknown> || {}),
          onrcVerified: true,
          onrcVerifiedAt: new Date().toISOString(),
          onrcStatus: companyData.status,
          onrcLegalForm: companyData.legalForm,
        },
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();

    await logAudit({
      userId: user.id,
      action: 'organization.update',
      resourceType: 'organization',
      resourceId: id,
      metadata: {
        verificationType: 'onrc_anaf',
        companyStatus: companyData.status,
        isActive: companyData.isActive,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        verified: true,
        organization: updated,
        verification: {
          source: 'ONRC/ANAF',
          companyStatus: companyData.status,
          isActive: companyData.isActive,
          legalForm: companyData.legalForm,
          verifiedAt: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[organizations:verify]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
