// ─── certSIGN.ro QES Integration ────────────────────────────────
// Qualified Electronic Signatures (eIDAS compliant)

import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { v4 as uuidv4 } from 'uuid';

const RATE_KEY = 'certsign';

export type SignatureStatus = 'pending' | 'prepared' | 'signing' | 'signed' | 'rejected' | 'expired' | 'error';

export interface SignatureWorkflow {
  id: string;
  documentId: string;
  documentTitle: string;
  documentHash: string;
  signers: SignerInfo[];
  status: SignatureStatus;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  auditTrail: AuditEntry[];
}

export interface SignerInfo {
  id: string;
  name: string;
  email: string;
  role: 'signer' | 'approver' | 'witness';
  order: number;
  status: 'pending' | 'notified' | 'signed' | 'rejected';
  signedAt?: string;
  certificateSerial?: string;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  details: string;
  ipAddress?: string;
}

export interface PrepareDocumentRequest {
  documentId: string;
  documentTitle: string;
  documentContent: Buffer | string; // PDF content
  signers: Array<{
    name: string;
    email: string;
    role: SignerInfo['role'];
    order: number;
  }>;
  expiresInDays?: number;
  callbackUrl?: string;
}

/**
 * Prepare a document for QES signing via certSIGN
 */
export async function prepareDocument(req: PrepareDocumentRequest): Promise<SignatureWorkflow> {
  const apiKey = process.env.CERTSIGN_API_KEY;
  const baseUrl = process.env.CERTSIGN_BASE_URL ?? 'https://api.certsign.ro';

  if (!apiKey) {
    throw new Error('certSIGN API key not configured (CERTSIGN_API_KEY)');
  }

  return withCircuitBreaker(RATE_KEY, () =>
    withRateLimit(RATE_KEY, async () => {
      const workflowId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (req.expiresInDays ?? 30) * 86400000);

      // Compute document hash
      const crypto = await import('crypto');
      const content = typeof req.documentContent === 'string'
        ? Buffer.from(req.documentContent, 'base64')
        : req.documentContent;
      const hash = crypto.createHash('sha256').update(content).digest('hex');

      const response = await fetch(`${baseUrl}/api/v1/signing/workflows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          externalId: workflowId,
          document: {
            name: req.documentTitle,
            hash,
            contentBase64: content.toString('base64'),
          },
          signers: req.signers.map((s, i) => ({
            name: s.name,
            email: s.email,
            role: s.role,
            signingOrder: s.order,
          })),
          callbackUrl: req.callbackUrl,
          expiresAt: expiresAt.toISOString(),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`certSIGN prepare error: ${response.status} - ${error}`);
      }

      const result = await response.json();

      const workflow: SignatureWorkflow = {
        id: result.workflowId ?? workflowId,
        documentId: req.documentId,
        documentTitle: req.documentTitle,
        documentHash: hash,
        signers: req.signers.map((s) => ({
          id: uuidv4(),
          name: s.name,
          email: s.email,
          role: s.role,
          order: s.order,
          status: 'pending',
        })),
        status: 'prepared',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        auditTrail: [{
          timestamp: now.toISOString(),
          action: 'document_prepared',
          actor: 'system',
          details: `Document "${req.documentTitle}" prepared for signing. Hash: ${hash}`,
        }],
      };

      return workflow;
    }, { maxRequests: 10, windowMs: 60_000 }),
  );
}

/**
 * Get the signing URL for a signer
 */
export async function getSigningUrl(workflowId: string, signerEmail: string): Promise<string> {
  const apiKey = process.env.CERTSIGN_API_KEY;
  const baseUrl = process.env.CERTSIGN_BASE_URL ?? 'https://api.certsign.ro';

  if (!apiKey) throw new Error('certSIGN API key not configured');

  return withCircuitBreaker(RATE_KEY, () =>
    withRateLimit(RATE_KEY, async () => {
      const response = await fetch(`${baseUrl}/api/v1/signing/workflows/${workflowId}/signing-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signerEmail }),
      });

      if (!response.ok) throw new Error(`certSIGN error: ${response.status}`);
      const data = await response.json();
      return data.signingUrl;
    }),
  );
}

/**
 * Check workflow status
 */
export async function getWorkflowStatus(workflowId: string): Promise<SignatureWorkflow | null> {
  const apiKey = process.env.CERTSIGN_API_KEY;
  const baseUrl = process.env.CERTSIGN_BASE_URL ?? 'https://api.certsign.ro';

  if (!apiKey) throw new Error('certSIGN API key not configured');

  return withCircuitBreaker(RATE_KEY, () =>
    withRateLimit(RATE_KEY, async () => {
      const response = await fetch(`${baseUrl}/api/v1/signing/workflows/${workflowId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`certSIGN error: ${response.status}`);
      }

      return response.json();
    }),
  );
}

/**
 * Download signed document
 */
export async function downloadSignedDocument(workflowId: string): Promise<Buffer> {
  const apiKey = process.env.CERTSIGN_API_KEY;
  const baseUrl = process.env.CERTSIGN_BASE_URL ?? 'https://api.certsign.ro';

  if (!apiKey) throw new Error('certSIGN API key not configured');

  return withCircuitBreaker(RATE_KEY, () =>
    withRateLimit(RATE_KEY, async () => {
      const response = await fetch(`${baseUrl}/api/v1/signing/workflows/${workflowId}/document`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!response.ok) throw new Error(`certSIGN download error: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }),
  );
}
