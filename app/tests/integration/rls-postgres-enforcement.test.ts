import { describe, expect, it } from 'vitest';
import postgres from 'postgres';

const dbUrl = process.env.RLS_TEST_DATABASE_URL || process.env.DATABASE_URL;
const maybeIt = dbUrl ? it : it.skip;

describe('PostgreSQL RLS enforcement (opt-in integration)', () => {
  maybeIt('enforces tenant isolation on projects via app.current_user_id', async () => {
    const sql = postgres(dbUrl!, { max: 1, prepare: false });

    const user1 = crypto.randomUUID();
    const user2 = crypto.randomUUID();
    const org1 = crypto.randomUUID();
    const org2 = crypto.randomUUID();
    const project1 = crypto.randomUUID();
    const project2 = crypto.randomUUID();

    try {
      await sql`begin`;

      await sql`
        insert into users (id, email, full_name)
        values
          (${user1}::uuid, ${`rls-user1-${user1}@test.local`}, 'RLS User 1'),
          (${user2}::uuid, ${`rls-user2-${user2}@test.local`}, 'RLS User 2')
      `;

      await sql`
        insert into organizations (id, name, org_type)
        values
          (${org1}::uuid, 'RLS Org 1', 'srl'),
          (${org2}::uuid, 'RLS Org 2', 'srl')
      `;

      await sql`
        insert into org_members (id, org_id, user_id, role)
        values
          (${crypto.randomUUID()}::uuid, ${org1}::uuid, ${user1}::uuid, 'admin'),
          (${crypto.randomUUID()}::uuid, ${org2}::uuid, ${user2}::uuid, 'admin')
      `;

      await sql`
        insert into projects (id, org_id, created_by, title, status)
        values
          (${project1}::uuid, ${org1}::uuid, ${user1}::uuid, 'RLS Project 1', 'ciorna'),
          (${project2}::uuid, ${org2}::uuid, ${user2}::uuid, 'RLS Project 2', 'ciorna')
      `;

      await sql`select set_config('app.current_user_id', ${user1}, true)`;
      const visibleForUser1 = await sql<{ id: string }[]>`
        select id from projects where deleted_at is null
      `;

      await sql`select set_config('app.current_user_id', ${user2}, true)`;
      const visibleForUser2 = await sql<{ id: string }[]>`
        select id from projects where deleted_at is null
      `;

      expect(visibleForUser1.map((r) => r.id)).toContain(project1);
      expect(visibleForUser1.map((r) => r.id)).not.toContain(project2);
      expect(visibleForUser2.map((r) => r.id)).toContain(project2);
      expect(visibleForUser2.map((r) => r.id)).not.toContain(project1);
    } finally {
      await sql`rollback`;
      await sql.end({ timeout: 1 });
    }
  });
});
