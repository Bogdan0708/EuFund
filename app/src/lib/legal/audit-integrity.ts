// ─── Audit Log Hash Chain Integrity Verification ─────────────────
// Scans audit entries and verifies the hash chain is intact

import { db } from '@/lib/db';
import { auditLog } from '@/lib/db/schema';
import { asc, and, gte, lte } from 'drizzle-orm';
import { computeEntryHash } from './audit';

export interface ChainVerificationResult {
  totalChecked: number;
  validEntries: number;
  brokenLinks: Array<{
    entryId: string;
    position: number;
    expected: string | null;
    actual: string | null;
  }>;
  isIntact: boolean;
  verifiedAt: string;
}

export async function verifyAuditChainIntegrity(options?: {
  from?: Date;
  to?: Date;
  batchSize?: number;
}): Promise<ChainVerificationResult> {
  const batchSize = options?.batchSize ?? 1000;
  const brokenLinks: ChainVerificationResult['brokenLinks'] = [];
  let totalChecked = 0;
  let validEntries = 0;
  let lastHash: string | null = null;
  let offset = 0;
  let isFirst = true;

  // Build date filters
  const conditions = [];
  if (options?.from) conditions.push(gte(auditLog.createdAt, options.from));
  if (options?.to) conditions.push(lte(auditLog.createdAt, options.to));

  // If filtering from a specific date, fetch the entry just before to seed the chain
  if (options?.from) {
    const [preceding] = await db
      .select({
        entryHash: auditLog.entryHash,
      })
      .from(auditLog)
      .where(lte(auditLog.createdAt, options.from))
      .orderBy(asc(auditLog.createdAt))
      .limit(1);
    if (preceding?.entryHash) {
      lastHash = preceding.entryHash;
      isFirst = false;
    }
  }

  while (true) {
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const batch = await db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        action: auditLog.action,
        resourceType: auditLog.resourceType,
        resourceId: auditLog.resourceId,
        oldValue: auditLog.oldValue,
        newValue: auditLog.newValue,
        ipAddress: auditLog.ipAddress,
        entryHash: auditLog.entryHash,
        previousHash: auditLog.previousHash,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .where(whereClause)
      .orderBy(asc(auditLog.createdAt))
      .limit(batchSize)
      .offset(offset);

    if (batch.length === 0) break;

    for (const entry of batch) {
      totalChecked++;

      // 1. Verify previousHash links to the last entry's entryHash
      if (!isFirst && entry.previousHash !== lastHash) {
        brokenLinks.push({
          entryId: entry.id,
          position: totalChecked,
          expected: lastHash,
          actual: entry.previousHash,
        });
      } else {
        // 2. Recompute the entry hash and verify it matches
        const recomputed = computeEntryHash({
          id: entry.id,
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          ipAddress: entry.ipAddress,
          createdAt: entry.createdAt!.toISOString(),
          previousHash: entry.previousHash,
        });

        if (recomputed !== entry.entryHash) {
          brokenLinks.push({
            entryId: entry.id,
            position: totalChecked,
            expected: recomputed,
            actual: entry.entryHash,
          });
        } else {
          validEntries++;
        }
      }

      lastHash = entry.entryHash;
      isFirst = false;
    }

    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  return {
    totalChecked,
    validEntries,
    brokenLinks,
    isIntact: brokenLinks.length === 0,
    verifiedAt: new Date().toISOString(),
  };
}
