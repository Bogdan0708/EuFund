import { describe, expect, it } from 'vitest';
import { validateMySMISPayload } from '@/lib/integrations/romanian/mysmis-contract';

function makeValidPayload() {
  return {
    schemaVersion: 'mysmis-2021-plus-v1',
    generatedAt: new Date().toISOString(),
    project: {
      localProjectId: '123e4567-e89b-42d3-a456-426614174000',
      title: 'Platformă digitală pentru management granturi',
      acronym: 'FONDEU',
      status: 'implementation',
      summary: 'Rezumat valid cu detalii suficiente pentru depunere în sistemul MySMIS.',
      sustainability: 'Plan de sustenabilitate pe 5 ani.',
      timeline: {
        startDate: new Date('2026-01-01').toISOString(),
        endDate: new Date('2027-12-31').toISOString(),
        durationMonths: 24,
      },
      financials: {
        totalBudget: 1000000,
        euContribution: 850000,
        ownContribution: 150000,
      },
      objectives: ['Obiectiv 1', 'Obiectiv 2'],
      methodology: ['Pas 1', 'Pas 2'],
    },
    applicant: {
      name: 'FondEU SRL',
      cui: 'RO12345678',
      regCom: 'J40/1234/2020',
      legalType: 'srl',
      address: 'Str. Exemplu 1, Bucuresti',
      nutsRegion: 'RO32',
    },
    call: {
      callCode: 'POCIDIF-2026-OP1-01',
      title: 'Digitalizare',
      deadline: new Date('2026-12-15').toISOString(),
      guideUrl: 'https://example.com/ghid.pdf',
    },
    compliance: {
      overallScore: 88,
      evaluatedAt: new Date().toISOString(),
      dnshStatus: 'pass',
      dnshScore: 92,
      highRiskFindings: [],
    },
    workPackages: [
      {
        localWorkPackageId: '223e4567-e89b-42d3-a456-426614174001',
        name: 'WP1 Management',
        description: 'Coordonare proiect',
        startDate: new Date('2026-01-01').toISOString(),
        endDate: new Date('2026-12-31').toISOString(),
        budgetAllocated: 250000,
        status: 'active',
        milestones: [],
        deliverables: [],
      },
    ],
  };
}

describe('MySMIS Contract Validation', () => {
  it('accepts a valid payload', () => {
    const result = validateMySMISPayload(makeValidPayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects invalid contract fields', () => {
    const payload = makeValidPayload();
    payload.project.financials.totalBudget = 0;
    payload.applicant.name = '';
    payload.workPackages[0].localWorkPackageId = 'not-a-uuid';

    const result = validateMySMISPayload(payload as unknown as Record<string, unknown>);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns warnings for optional-but-important fields', () => {
    const payload = makeValidPayload();
    payload.call.callCode = null as unknown as string;
    payload.compliance.overallScore = null as unknown as number;

    const result = validateMySMISPayload(payload as unknown as Record<string, unknown>);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Cod apel MySMIS'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('overallScore'))).toBe(true);
  });
});
