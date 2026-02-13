/**
 * GDPR Audit Trail - Article 32 Compliance
 * Enhanced audit logging for data processing activities
 */

export interface AuditEvent {
  id: string;
  timestamp: Date;
  action: AuditAction;
  category: AuditCategory;
  userId?: string;
  resourceType: string;
  resourceId?: string;
  details: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  legalBasis?: string;
  dataSubjectId?: string;
  retentionDays: number;
}

export type AuditAction =
  | 'CREATE'
  | 'READ'
  | 'UPDATE'
  | 'DELETE'
  | 'EXPORT'
  | 'ACCESS_REQUEST'
  | 'CONSENT_GIVEN'
  | 'CONSENT_WITHDRAWN'
  | 'DATA_BREACH'
  | 'ERASURE_REQUEST'
  | 'RECTIFICATION'
  | 'PORTABILITY_EXPORT'
  | 'PROCESSING_RESTRICTION'
  | 'LOGIN'
  | 'LOGOUT'
  | 'FAILED_LOGIN';

export type AuditCategory =
  | 'AUTHENTICATION'
  | 'DATA_ACCESS'
  | 'DATA_MODIFICATION'
  | 'DATA_SUBJECT_REQUEST'
  | 'CONSENT'
  | 'SECURITY'
  | 'SYSTEM'
  | 'EXTERNAL_API';

/**
 * Create an audit log entry
 */
export function createAuditEntry(
  params: Omit<AuditEvent, 'id' | 'timestamp'>
): AuditEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    ...params,
  };
}

/**
 * Audit logger that writes to structured log output
 * In production, these go to CloudWatch/Loki for searchability
 */
export class GDPRAuditLogger {
  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const entry = createAuditEntry(event);

    // Structured JSON log - picked up by log aggregation
    console.log(
      JSON.stringify({
        level: 'audit',
        ...entry,
        timestamp: entry.timestamp.toISOString(),
      })
    );

    // In production, also write to audit_logs table
    // await db.insert(auditLogs).values(entry);
  }

  /**
   * Log a data subject access request (DSAR)
   */
  async logDSAR(
    subjectId: string,
    requestType: 'access' | 'erasure' | 'rectification' | 'portability',
    userId: string
  ): Promise<void> {
    const actionMap: Record<string, AuditAction> = {
      access: 'ACCESS_REQUEST',
      erasure: 'ERASURE_REQUEST',
      rectification: 'RECTIFICATION',
      portability: 'PORTABILITY_EXPORT',
    };

    await this.log({
      action: actionMap[requestType],
      category: 'DATA_SUBJECT_REQUEST',
      userId,
      resourceType: 'data_subject_request',
      dataSubjectId: subjectId,
      details: { requestType },
      legalBasis: 'GDPR Article 15-20',
      retentionDays: 2190, // 6 years for legal compliance
    });
  }

  /**
   * Log consent changes
   */
  async logConsent(
    subjectId: string,
    consentType: string,
    granted: boolean
  ): Promise<void> {
    await this.log({
      action: granted ? 'CONSENT_GIVEN' : 'CONSENT_WITHDRAWN',
      category: 'CONSENT',
      resourceType: 'consent',
      dataSubjectId: subjectId,
      details: { consentType, granted },
      legalBasis: 'GDPR Article 7',
      retentionDays: 2190,
    });
  }

  /**
   * Log data breach notification
   */
  async logBreach(details: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    affectedRecords: number;
    description: string;
    containmentActions: string[];
  }): Promise<void> {
    await this.log({
      action: 'DATA_BREACH',
      category: 'SECURITY',
      resourceType: 'security_incident',
      details,
      legalBasis: 'GDPR Article 33-34',
      retentionDays: 3650, // 10 years
    });
  }

  /**
   * Log external API calls (ONRC, ANAF, certSIGN)
   */
  async logExternalAPI(
    apiName: string,
    endpoint: string,
    userId: string,
    success: boolean,
    responseTimeMs: number
  ): Promise<void> {
    await this.log({
      action: 'READ',
      category: 'EXTERNAL_API',
      userId,
      resourceType: 'external_api_call',
      details: { apiName, endpoint, success, responseTimeMs },
      retentionDays: 365,
    });
  }
}

export const auditLogger = new GDPRAuditLogger();
