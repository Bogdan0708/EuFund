// ─── GDPR-Compliant Audit Logging ────────────────────────────────
// Append-only audit trail for all data processing activities

import { db } from '@/lib/db';
import { auditLog } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

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
  | 'project.version_save'
  | 'project.export'
  | 'project.status_change'
  // Documents
  | 'document.upload'
  | 'document.delete'
  | 'document.download'
  // AI
  | 'ai.compliance_check'
  | 'ai.generate'
  | 'ai.chat'
  // Consent
  | 'consent.grant'
  | 'consent.withdraw'
  // Legal
  | 'gdpr.data_export'
  | 'gdpr.data_delete'
  | 'gdpr.consent_update';

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
 * Log an audit entry. This is append-only by design.
 * RLS policies prevent UPDATE/DELETE on audit_log table.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      metadata: {
        ...entry.metadata,
        legalBasis: inferLegalBasis(entry.action),
      },
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
  if (action.startsWith('consent.')) return 'legal_obligation';
  if (action.startsWith('gdpr.')) return 'legal_obligation';
  if (action.startsWith('ai.')) return 'contract';
  if (action.startsWith('document.')) return 'contract';
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
