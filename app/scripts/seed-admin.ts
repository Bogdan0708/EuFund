/**
 * Seed platform admin account.
 * Usage: npx tsx scripts/seed-admin.ts
 * Requires DATABASE_URL in .env.local
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../src/lib/db/schema';

const ADMIN_EMAIL = 'godjabogdan@gmail.com';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client, { schema });

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, ADMIN_EMAIL),
  });

  if (existing) {
    if (existing.isPlatformAdmin) {
      console.log(`User ${ADMIN_EMAIL} is already a platform admin (id: ${existing.id})`);
    } else {
      await db
        .update(schema.users)
        .set({ isPlatformAdmin: true, updatedAt: new Date() })
        .where(eq(schema.users.id, existing.id));
      console.log(`Promoted ${ADMIN_EMAIL} to platform admin (id: ${existing.id})`);
    }
  } else {
    const [user] = await db
      .insert(schema.users)
      .values({
        email: ADMIN_EMAIL,
        fullName: 'Bogdan Godja',
        emailVerified: true,
        isPlatformAdmin: true,
        ageVerified: true,
      })
      .returning();
    console.log(`Created admin user ${ADMIN_EMAIL} (id: ${user.id})`);

    // Add required consent records
    await db.insert(schema.consentRecords).values([
      { userId: user.id, consentType: 'privacy_policy', status: 'granted', version: '1.0' },
      { userId: user.id, consentType: 'terms_of_service', status: 'granted', version: '1.0' },
      { userId: user.id, consentType: 'data_processing', status: 'granted', version: '1.0' },
    ]);
    console.log('Created consent records');
  }

  await client.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
