// app/scripts/migrate-org-to-user.ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL required')

const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')

if (!dryRun && !confirm) {
  console.error('Usage: npx tsx scripts/migrate-org-to-user.ts [--dry-run | --confirm]')
  process.exit(1)
}

async function migrate() {
  const client = postgres(DATABASE_URL!)
  const db = drizzle(client)

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE MIGRATION'}`)

  // Step 1: Populate projects.user_id from org_members
  // Pick the org admin (or first member) for each org
  const projectsToMigrate = await db.execute(sql`
    SELECT p.id as project_id, p.org_id,
      COALESCE(
        (SELECT om.user_id FROM org_members om WHERE om.org_id = p.org_id AND om.role = 'admin' LIMIT 1),
        (SELECT om.user_id FROM org_members om WHERE om.org_id = p.org_id ORDER BY om.joined_at ASC LIMIT 1),
        p.created_by
      ) as target_user_id
    FROM projects p
    WHERE p.user_id IS NULL
  `)

  console.log(`Projects to migrate: ${projectsToMigrate.length}`)

  if (!dryRun) {
    for (const row of projectsToMigrate) {
      await db.execute(sql`
        UPDATE projects SET user_id = ${row.target_user_id} WHERE id = ${row.project_id}
      `)
    }
    console.log('Projects migrated.')
  }

  // Step 2: Migrate documents to project_files
  const docsToMigrate = await db.execute(sql`
    SELECT id, project_id, uploaded_by, doc_type, filename, mime_type,
           file_size, storage_path, ocr_text, ai_summary, created_at
    FROM documents
    WHERE project_id IS NOT NULL
  `)

  console.log(`Documents to migrate to project_files: ${docsToMigrate.length}`)

  if (!dryRun) {
    for (const doc of docsToMigrate) {
      await db.execute(sql`
        INSERT INTO project_files (project_id, user_id, filename, mime_type, size_bytes,
          storage_path, category, description, extracted_text, created_at)
        VALUES (${doc.project_id}, ${doc.uploaded_by}, ${doc.filename}, ${doc.mime_type},
          ${doc.file_size}, ${doc.storage_path}, 'uploaded', ${doc.ai_summary},
          ${doc.ocr_text}, ${doc.created_at})
      `)
    }
    console.log('Documents migrated to project_files.')
  }

  // Step 3: Migrate funding_calls to calls_for_proposals
  const ecCalls = await db.execute(sql`
    SELECT * FROM funding_calls
    WHERE external_id NOT IN (
      SELECT ec_external_id FROM calls_for_proposals WHERE ec_external_id IS NOT NULL
    )
  `)

  console.log(`EC Portal calls to migrate: ${ecCalls.length}`)

  if (!dryRun) {
    for (const call of ecCalls) {
      await db.execute(sql`
        INSERT INTO calls_for_proposals (
          call_code, title_ro, status, submission_start, submission_end,
          budget_total, ec_external_id, ec_topics, ec_eligibility_criteria,
          ec_source_url, ec_synced_at
        ) VALUES (
          ${call.external_id}, ${call.title}, 'deschis',
          ${call.opening_date}, ${call.deadline_date}, ${call.budget},
          ${call.external_id}, ${call.topics}, ${call.eligibility_criteria},
          ${call.source_url}, ${call.synced_at}
        )
      `)
    }
    console.log('EC Portal calls migrated.')
  }

  // Step 4: Rename enterprise tier to ultra
  const enterpriseUsers = await db.execute(sql`
    SELECT id FROM users WHERE tier = 'enterprise'
  `)
  console.log(`Enterprise users to migrate to ultra: ${enterpriseUsers.length}`)

  if (!dryRun) {
    await db.execute(sql`UPDATE users SET tier = 'ultra' WHERE tier = 'enterprise'`)
    console.log('Enterprise tier migrated to ultra.')
  }

  console.log('\nMigration complete.')
  await client.end()
}

migrate().catch(console.error)
