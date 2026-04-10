// ─── GDPR-Compliant Audit Logging ────────────────────────────────
// Append-only audit trail with tamper-evident hash chain

import { db } from '@/lib/db';
import { auditLog } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { createHash } from 'crypto';
import { desc, eq } from 'drizzle-orm';

const log = logger.child({ component: 'legal-audit' });
const AUDIT_DLQ_PATH = process.env.AUDIT_DLQ_PATH || './tmp/audit-dlq.log';

export type AuditAction =
  // Auth
  | 'auth.login'
  | 'auth.logout'
  | 'auth.register'
  | 'auth.password_reset'
  | 'auth.mfa_enable'
  // User
  | 'user.update'
  | 'user.delete'
  | 'user.export_data'
  | 'user.onboarding_complete'
  // Organization
  | 'organization.create'
  | 'organization.update'
  | 'organization.delete'
  | 'organization.member_add'
  | 'organization.member_remove'
  | 'organization.member_role_change'
  // Project
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'project.section_update'
  | 'section.generated'
  | 'section.regenerated'
  | 'section.rollback'
  | 'section.state_change'
  | 'section.export'
  | 'project.version_save'
  | 'project.export'
  | 'project.status_change'
  | 'project.evidence_append'
  | 'project.comment_add'
  | 'project.timeline_create'
  | 'project.timeline_update'
  | 'project.timeline_delete'
  | 'project.work_package_create'
  | 'project.work_package_update'
  | 'project.work_package_delete'
  | 'project.risk_create'
  | 'project.risk_update'
  // Documents
  | 'document.upload'
  | 'document.delete'
  | 'document.download'
  // AI
  | 'ai.compliance_check'
  | 'ai.generate'
  | 'ai.chat'
  | 'ai.wizard_enhance'
  | 'ai.wizard_match'
  | 'ai.wizard_generate'
  // Consent
  | 'consent.grant'
  | 'consent.withdraw'
  // Legal
  | 'gdpr.data_export'
  | 'gdpr.data_delete'
  | 'gdpr.consent_update'
  // System
  | 'system.retention_cleanup'
  | 'system.feature_flag_change'
  | 'system.program_change'
  | 'system.call_change'
  | 'system.connector_sync'
  // Funding AI ingestion/enrichment
  | 'funding_ai.document_upsert'
  | 'funding_ai.extractions_upsert'
  | 'funding_ai.version_create'
  | 'funding_ai.review_queue_create'
  | 'funding_ai.review_queue_update'
  // Phase 3 managed-agent mutations (new narrow mutation services)
  | 'session.call_selected'
  | 'session.outline_frozen'
  | 'session.status_change'
  | 'section.marked_stale'
  | 'section.rejected';

export interface AuditEntry {
  userId?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Compute a SHA-256 hash of the audit entry fields for tamper detection.
 */
export function computeEntryHash(fields: {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  createdAt: string;
  previousHash: string | null;
}): string {
  const payload = [
    fields.id,
    fields.userId ?? '',
    fields.action,
    fields.resourceType ?? '',
    fields.resourceId ?? '',
    JSON.stringify(fields.oldValue ?? null),
    JSON.stringify(fields.newValue ?? null),
    fields.ipAddress ?? '',
    fields.createdAt,
    fields.previousHash ?? '',
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Log an audit entry with hash chain for tamper evidence.
 * RLS policies prevent UPDATE/DELETE on audit_log table.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      // 1. Read latest entry_hash (FOR UPDATE prevents concurrent chain forks)
      const [latest] = await tx
        .select({ entryHash: auditLog.entryHash })
        .from(auditLog)
        .orderBy(desc(auditLog.createdAt))
        .limit(1)
        .for('update');

      const previousHash = latest?.entryHash ?? null;

      // 2. Insert a row to get the generated id + createdAt
      const [inserted] = await tx.insert(auditLog).values({
        userId: entry.userId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        previousHash,
        metadata: {
          ...entry.metadata,
          legalBasis: inferLegalBasis(entry.action),
        },
      }).returning({ id: auditLog.id, createdAt: auditLog.createdAt });

      // 3. Compute the entry hash and update the row
      const entryHash = computeEntryHash({
        id: inserted.id,
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        ipAddress: entry.ipAddress ?? null,
        createdAt: inserted.createdAt!.toISOString(),
        previousHash,
      });

      await tx.update(auditLog)
        .set({ entryHash })
        .where(eq(auditLog.id, inserted.id));
    });
  } catch (error) {
    const failedAudit = {
      ...entry,
      failedAt: new Date().toISOString(),
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    };

    // Audit logging should never crash requests, but failures must be observable.
    log.error({
      error,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
    }, '[AUDIT_FAILURE]');

    // Dead-letter fallback so failed audit writes are not silently dropped.
    try {
      await mkdir(dirname(AUDIT_DLQ_PATH), { recursive: true });
      await appendFile(AUDIT_DLQ_PATH, `${JSON.stringify(failedAudit)}\n`, 'utf8');
    } catch (dlqError) {
      log.error({ error: dlqError, action: entry.action }, '[AUDIT_DLQ_FAILURE]');
    }
  }
}

/**
 * Infer GDPR legal basis for each action type
 */
function inferLegalBasis(action: AuditAction): string {
  if (action.startsWith('auth.') || action.startsWith('user.')) return 'contract';
  if (action.startsWith('project.') || action.startsWith('organization.')) return 'contract';
  if (action.startsWith('section.')) return 'contract';
  if (action.startsWith('consent.')) return 'legal_obligation';
  if (action.startsWith('gdpr.')) return 'legal_obligation';
  if (action.startsWith('ai.')) return 'contract';
  if (action.startsWith('document.')) return 'contract';
  if (action.startsWith('system.')) return 'legitimate_interest';
  return 'legitimate_interest';
}

/**
 * Helper to sanitize PII from audit values
 * Used when logging changes that might contain personal data
 */
export function sanitizeForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['password', 'passwordHash', 'mfaSecret', 'cnp', 'dateOfBirth'];
  const sanitized = { ...data };

  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}
