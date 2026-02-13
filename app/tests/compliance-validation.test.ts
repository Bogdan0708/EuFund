import { describe, it, expect } from 'vitest';
import { runEligibilityRules, type RuleContext } from '@/lib/rules/eligibility';

describe('Legal Compliance - Deterministic Rules', () => {
  const baseCtx: RuleContext = {
    organization: {
      orgType: 'srl',
      orgSize: 'mica',
      caenPrimary: '6201',
      nutsRegion: 'RO32',
      employeeCount: 25,
    },
    project: {
      totalBudget: 1000000,
      ownContrib: 150000,
      durationMonths: 24,
    },
    call: {
      eligibleTypes: ['srl', 'sa', 'ong'],
      eligibleRegions: ['RO32', 'RO11'],
      eligibleCaen: ['6201', '6202', '7211'],
      budgetMin: 500000,
      budgetMax: 5000000,
      cofinancingRate: 10,
      durationMin: 12,
      durationMax: 36,
      submissionEnd: new Date(Date.now() + 90 * 86400000).toISOString(),
    },
  };

  it('should pass all checks for fully eligible project', () => {
    const { score, failCount } = runEligibilityRules(baseCtx);
    expect(failCount).toBe(0);
    expect(score).toBe(100);
  });

  it('should fail on ineligible organization type', () => {
    const ctx = {
      ...baseCtx,
      organization: { ...baseCtx.organization, orgType: 'pfa' },
    };
    const { results } = runEligibilityRules(ctx);
    const typeCheck = results.find((r) => r.ruleId === 'ELIG-001');
    expect(typeCheck?.status).toBe('fail');
  });

  it('should fail on ineligible region', () => {
    const ctx = {
      ...baseCtx,
      organization: { ...baseCtx.organization, nutsRegion: 'RO21' },
    };
    const { results } = runEligibilityRules(ctx);
    const regionCheck = results.find((r) => r.ruleId === 'ELIG-002');
    expect(regionCheck?.status).toBe('fail');
  });

  it('should fail on budget below minimum', () => {
    const ctx = {
      ...baseCtx,
      project: { ...baseCtx.project, totalBudget: 100000 },
    };
    const { results } = runEligibilityRules(ctx);
    const budgetCheck = results.find((r) => r.ruleId === 'BUD-001');
    expect(budgetCheck?.status).toBe('fail');
  });

  it('should fail on budget above maximum', () => {
    const ctx = {
      ...baseCtx,
      project: { ...baseCtx.project, totalBudget: 10000000 },
    };
    const { results } = runEligibilityRules(ctx);
    const budgetCheck = results.find((r) => r.ruleId === 'BUD-001');
    expect(budgetCheck?.status).toBe('fail');
  });

  it('should fail on insufficient co-financing', () => {
    const ctx = {
      ...baseCtx,
      project: { ...baseCtx.project, ownContrib: 50000 }, // 5% < 10%
    };
    const { results } = runEligibilityRules(ctx);
    const cofinCheck = results.find((r) => r.ruleId === 'BUD-002');
    expect(cofinCheck?.status).toBe('fail');
  });

  it('should fail on duration too short', () => {
    const ctx = {
      ...baseCtx,
      project: { ...baseCtx.project, durationMonths: 6 },
    };
    const { results } = runEligibilityRules(ctx);
    const durCheck = results.find((r) => r.ruleId === 'DUR-001');
    expect(durCheck?.status).toBe('fail');
  });

  it('should warn on expired deadline', () => {
    const ctx = {
      ...baseCtx,
      call: { ...baseCtx.call, submissionEnd: '2020-01-01T00:00:00Z' },
    };
    const { results } = runEligibilityRules(ctx);
    const deadlineCheck = results.find((r) => r.ruleId === 'DEAD-001');
    expect(deadlineCheck?.status).toBe('fail');
  });

  it('should warn when deadline is imminent (<14 days)', () => {
    const ctx = {
      ...baseCtx,
      call: {
        ...baseCtx.call,
        submissionEnd: new Date(Date.now() + 7 * 86400000).toISOString(),
      },
    };
    const { results } = runEligibilityRules(ctx);
    const deadlineCheck = results.find((r) => r.ruleId === 'DEAD-001');
    expect(deadlineCheck?.status).toBe('warning');
  });

  it('should mark rules not_applicable when call data missing', () => {
    const ctx: RuleContext = {
      organization: { orgType: 'srl' },
      project: {},
      call: {},
    };
    const { results } = runEligibilityRules(ctx);
    const naCount = results.filter((r) => r.status === 'not_applicable').length;
    expect(naCount).toBeGreaterThan(0);
  });

  it('should calculate correct score with mixed results', () => {
    const ctx = {
      ...baseCtx,
      organization: { ...baseCtx.organization, orgType: 'pfa' }, // Will fail ELIG-001
    };
    const { score, failCount, passCount } = runEligibilityRules(ctx);
    expect(failCount).toBe(1);
    expect(passCount).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThan(0);
  });
});
