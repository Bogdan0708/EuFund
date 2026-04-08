import { hashContent } from './section-versions';
import type { SectionResult } from './types';

/**
 * Fills in missing versioning fields for legacy/incomplete section data.
 * Used when reading from projectDocuments snapshots that predate the versioning system.
 */
export function normalizeSections(
  sections: unknown[],
  fallbackCreatedAt: string,
): SectionResult[] {
  return sections.map((raw) => {
    const s = raw as Record<string, unknown>;
    const content = typeof s.content === 'string' ? s.content : '';
    return {
      id: String(s.id ?? ''),
      title: String(s.title ?? ''),
      content,
      order: typeof s.order === 'number' ? s.order : 0,
      source: (s.source as SectionResult['source']) ?? 'generated',
      state: (s.state as SectionResult['state']) ?? 'draft',
      currentVersion: typeof s.currentVersion === 'number' ? s.currentVersion : 1,
      versionCount: typeof s.versionCount === 'number' ? s.versionCount : 1,
      contentHash: typeof s.contentHash === 'string' && s.contentHash.length > 0
        ? s.contentHash
        : hashContent(content),
      lastStateChangeAt: typeof s.lastStateChangeAt === 'string'
        ? s.lastStateChangeAt
        : fallbackCreatedAt,
      lastStateChangeBy: typeof s.lastStateChangeBy === 'string'
        ? s.lastStateChangeBy
        : null,
      metadata: (s.metadata ?? {}) as SectionResult['metadata'],
    };
  });
}
