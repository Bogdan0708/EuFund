import { describe, it, expect } from 'vitest';
import { runEligibilityRules, type RuleContext } from '@/lib/rules/eligibility';

const baseContext: RuleContext = {
  organization: {
    orgType: 'srl',
    orgSize: 'mica',
    caenPrimary: '6201',
    nutsRegion: 'RO32',
    employeeCount: 15,
  },
  project: {
    totalBudget: 500000,
    ownContrib: 100000,
    durationMonths: 24,
  },
  call: {
    eligibleTypes: ['srl', 'sa', 'pfa'],
    eligibleRegions: ['RO32', 'RO11', 'RO12'],
    eligibleCaen: ['6201', '6202', '6209'],
    budgetMin: 100000,
    budgetMax: 1000000,
    cofinancingRate: 15,
    durationMin: 12,
    durationMax: 36,
    submissionEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
};

describe('Eligibility Rules Engine', () => {
  it('passes all rules for eligible project', () => {
    const result = runEligibilityRules(baseContext);
    expect(result.failCount).toBe(0);
    expect(result.score).toBe(100);
  });

  it('fails on ineligible org type', () => {
    const ctx: RuleContext = {
      ...baseContext,
      organization: { ...baseContext.organization, orgType: 'uat' },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'ELIG-001')?.status).toBe('fail');
  });

  it('fails on ineligible region', () => {
    const ctx: RuleContext = {
      ...baseContext,
      organization: { ...baseContext.organization, nutsRegion: 'RO41' },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'ELIG-002')?.status).toBe('fail');
  });

  it('fails on budget over maximum', () => {
    const ctx: RuleContext = {
      ...baseContext,
      project: { ...baseContext.project, totalBudget: 2000000 },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'BUD-001')?.status).toBe('fail');
  });

  it('fails on budget under minimum', () => {
    const ctx: RuleContext = {
      ...baseContext,
      project: { ...baseContext.project, totalBudget: 50000 },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'BUD-001')?.status).toBe('fail');
  });

  it('fails on insufficient cofinancing', () => {
    const ctx: RuleContext = {
      ...baseContext,
      project: { ...baseContext.project, totalBudget: 500000, ownContrib: 10000 },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'BUD-002')?.status).toBe('fail');
  });

  it('fails on duration too long', () => {
    const ctx: RuleContext = {
      ...baseContext,
      project: { ...baseContext.project, durationMonths: 48 },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'DUR-001')?.status).toBe('fail');
  });

  it('warns on missing CAEN', () => {
    const ctx: RuleContext = {
      ...baseContext,
      organization: { ...baseContext.organization, caenPrimary: undefined, caenSecondary: undefined },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'ELIG-003')?.status).toBe('warning');
  });

  it('warns on expired deadline', () => {
    const ctx: RuleContext = {
      ...baseContext,
      call: { ...baseContext.call, submissionEnd: '2020-01-01T00:00:00Z' },
    };
    const result = runEligibilityRules(ctx);
    expect(result.results.find((r) => r.ruleId === 'DEAD-001')?.status).toBe('fail');
  });

  it('returns not_applicable when call has no restrictions', () => {
    const ctx: RuleContext = {
      ...baseContext,
      call: {},
    };
    const result = runEligibilityRules(ctx);
    const notApplicable = result.results.filter((r) => r.status === 'not_applicable');
    expect(notApplicable.length).toBeGreaterThan(0);
  });
});
