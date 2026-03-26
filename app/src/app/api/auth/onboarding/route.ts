import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { users, organizations, orgMembers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';

const profileSchema = z.object({
  fullName: z.string().min(2).max(255),
  organizationName: z.string().min(2).max(500).optional(),
  organizationType: z.enum(['srl', 'sa', 'pfa', 'ong', 'uat', 'institutie_publica', 'altul']).optional(),
  preferredLang: z.enum(['ro', 'en']).optional(),
});

const interestsSchema = z.object({
  interests: z.array(z.string()).min(0).max(20),
});

export async function POST(request: NextRequest) {
  const locale = (request.headers.get('x-locale') || 'ro') as 'ro' | 'en';
  try {
    const session = await requireAuth();
    const body = await request.json();

    if (body.step === 'profile') {
      const data = profileSchema.parse(body);
      await db.transaction(async (tx) => {
        await tx.update(users).set({
          fullName: data.fullName,
          preferredLang: data.preferredLang || 'ro',
          updatedAt: new Date(),
        }).where(eq(users.id, session.id));

        if (data.organizationName && data.organizationType) {
          const [org] = await tx.insert(organizations).values({
            name: data.organizationName,
            orgType: data.organizationType,
          }).returning({ id: organizations.id });

          await tx.insert(orgMembers).values({
            orgId: org.id,
            userId: session.id,
            role: 'admin',
          });

          logAudit({
            action: 'organization.create',
            userId: session.id,
            resourceType: 'organization',
            resourceId: org.id,
            metadata: { name: data.organizationName, orgType: data.organizationType },
          });
        }
      });
      return NextResponse.json({ success: true });
    }

    if (body.step === 'interests') {
      const data = interestsSchema.parse(body);
      await db.update(users).set({
        interests: data.interests,
        onboardingCompleted: true,
        updatedAt: new Date(),
      }).where(eq(users.id, session.id));

      logAudit({
        action: 'user.onboarding_complete',
        userId: session.id,
        resourceType: 'user',
        resourceId: session.id,
        metadata: { interestCount: data.interests.length },
      });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      Errors.validation('step', 'Pasul trebuie să fie "profile" sau "interests"', 'Step must be "profile" or "interests"').toResponse(locale),
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        Errors.validation('body', 'Date invalide', 'Invalid data').toResponse(locale),
        { status: 400 },
      );
    }
    throw error;
  }
}
