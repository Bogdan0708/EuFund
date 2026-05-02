import { describe, it, expect } from 'vitest';
import { deriveProjectTitle } from '@/lib/projects/promotion';

const baseSession = {
  selectedCallId: 'CALL-ABC123XYZ',
  messageSummary: null as string | null,
  planningArtifact: null as { preselect?: { description?: string } } | null,
};

describe('deriveProjectTitle', () => {
  it('uses preselect.description when present (truncated to 120, normalized whitespace)', () => {
    const session = {
      ...baseSession,
      planningArtifact: {
        preselect: {
          description: '  We will  build  a  digital   platform   for   ' + 'x'.repeat(200),
        },
      },
    };
    const out = deriveProjectTitle(session, 'ro');
    expect(out.source).toBe('description');
    expect(out.title.length).toBeLessThanOrEqual(120);
    expect(out.title).not.toContain('  ');
    expect(out.title.startsWith('We will build a digital platform')).toBe(true);
  });

  it('falls back to messageSummary when description missing', () => {
    const session = {
      ...baseSession,
      messageSummary: 'Project summary text',
    };
    const out = deriveProjectTitle(session, 'ro');
    expect(out.source).toBe('messageSummary');
    expect(out.title).toBe('Project summary text');
  });

  it('falls back to messageSummary when description below MIN length', () => {
    const session = {
      ...baseSession,
      messageSummary: 'Project summary text',
      planningArtifact: { preselect: { description: 'too short' } },
    };
    const out = deriveProjectTitle(session, 'ro');
    expect(out.source).toBe('messageSummary');
  });

  it('uses Romanian fallback when both are missing (ro locale)', () => {
    const out = deriveProjectTitle(baseSession, 'ro');
    expect(out.source).toBe('fallback');
    expect(out.title).toBe('Proiect nou — CALL-ABC123');
  });

  it('uses English fallback when both are missing (en locale)', () => {
    const out = deriveProjectTitle(baseSession, 'en');
    expect(out.source).toBe('fallback');
    expect(out.title).toBe('Untitled project — CALL-ABC123');
  });
});
