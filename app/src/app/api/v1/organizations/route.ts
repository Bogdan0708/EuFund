// ─── Organizations API ───────────────────────────────────────────
// GET  /api/v1/organizations - List user's organizations
// POST /api/v1/organizations - Create new organization

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { organizations, orgMembers } from '@/lib/db/schema';
import { organizationSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, getPaginationParams } from '@/lib/auth/helpers';
import { logAudit, sanitizeForAudit } from '@/lib/legal/audit';
import { eq, and, isNull, ilike, count, desc } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth();
    const { page, perPage, offset } = getPaginationParams(req);
    const url = new URL(req.url);
    const search = url.searchParams.get('search') || undefined;
    const orgType = url.searchParams.get('orgType') || undefined;

    // Get orgs where user is a member
    const baseConditions = [
      eq(orgMembers.userId, user.id),
      isNull(organizations.deletedAt),
    ];

    // Build query with joins
    const query = db
      .select({
        id: organizations.id,
        name: organizations.name,
        cui: organizations.cui,
        orgType: organizations.orgType,
        orgSize: organizations.orgSize,
        caenPrimary: organizations.caenPrimary,
        address: organizations.address,
        nutsRegion: organizations.nutsRegion,
        contactEmail: organizations.contactEmail,
        website: organizations.website,
        employeeCount: organizations.employeeCount,
        createdAt: organizations.createdAt,
        memberRole: orgMembers.role,
      })
      .from(organizations)
      .innerJoin(orgMembers, eq(organizations.id, orgMembers.orgId))
      .where(and(...baseConditions))
      .orderBy(desc(organizations.createdAt))
      .limit(perPage)
      .offset(offset);

    const [results, totalResult] = await Promise.all([
      query,
      db
        .select({ total: count() })
        .from(organizations)
        .innerJoin(orgMembers, eq(organizations.id, orgMembers.orgId))
        .where(and(...baseConditions)),
    ]);

    const total = totalResult[0]?.total || 0;

    return NextResponse.json({
      success: true,
      data: results,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[organizations:list]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = organizationSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(
          firstError.path.join('.'),
          firstError.message,
          firstError.message,
        ).toResponse('ro'),
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Check for duplicate CUI
    if (data.cui) {
      const existing = await db.query.organizations.findFirst({
        where: and(
          eq(organizations.cui, data.cui),
          isNull(organizations.deletedAt),
        ),
      });
      if (existing) {
        return NextResponse.json(
          Errors.validation(
            'cui',
            `O organizație cu CUI-ul ${data.cui} există deja.`,
            `An organization with CUI ${data.cui} already exists.`,
          ).toResponse('ro'),
          { status: 409 },
        );
      }
    }

    // Insert organization
    const [org] = await db.insert(organizations).values({
      name: data.name,
      cui: data.cui,
      regCom: data.regCom,
      orgType: data.orgType,
      orgSize: data.orgSize,
      caenPrimary: data.caenPrimary,
      caenSecondary: data.caenSecondary,
      address: data.address,
      nutsRegion: data.nutsRegion,
      legalRepName: data.legalRepName,
      legalRepRole: data.legalRepRole,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      website: data.website,
    }).returning();

    // Add creator as org_admin
    await db.insert(orgMembers).values({
      orgId: org.id,
      userId: user.id,
      role: 'org_admin',
      invitedBy: user.id,
    });

    // Audit log
    await logAudit({
      userId: user.id,
      action: 'organization.create',
      resourceType: 'organization',
      resourceId: org.id,
      newValue: sanitizeForAudit(data as any),
      metadata: { cui: data.cui },
    });

    return NextResponse.json({
      success: true,
      data: org,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[organizations:create]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
