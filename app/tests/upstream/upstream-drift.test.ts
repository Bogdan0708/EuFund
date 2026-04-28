/**
 * Upstream contract drift checks.
 *
 * NOT included in the PR test suite. Run only via .github/workflows/upstream-drift.yml
 * (nightly cron + workflow_dispatch) by setting RUN_UPSTREAM_DRIFT=1.
 *
 * Catches:
 *  - upstream availability (CORDIS, EUR-Lex, Eurostat, EC funding-calls portal)
 *  - schema/format drift that breaks our integration parsers
 *
 * Non-merge-gating: a flaky upstream must never block a PR.
 */
import { describe, expect, it } from 'vitest';

const RUN = process.env.RUN_UPSTREAM_DRIFT === '1';

describe.skipIf(!RUN)('upstream contract drift', () => {
  it('CORDIS searchFundedProjects returns an array for a horizon query', async () => {
    const { searchFundedProjects } = await import('@/lib/integrations/cordis');
    const projects = await searchFundedProjects({ query: 'horizon', limit: 5 });
    expect(Array.isArray(projects)).toBe(true);
  }, 60_000);

  it('EUR-Lex searchEURLex returns results for a Romanian query', async () => {
    const { searchEURLex } = await import('@/lib/integrations/eurlex');
    const results = await searchEURLex('fonduri', { language: 'ro', limit: 5 });
    expect(Array.isArray(results)).toBe(true);
  }, 60_000);

  it('Eurostat getRegionalGDP returns regional data for RO', async () => {
    const { getRegionalGDP } = await import('@/lib/integrations/eurostat');
    const data = await getRegionalGDP('RO');
    expect(data).toBeDefined();
    expect(data.nutsCode).toBe('RO');
    expect(Array.isArray(data.indicators)).toBe(true);
  }, 60_000);

  it('EC funding-calls portal returns calls for status=open', async () => {
    const { searchFundingCalls } = await import('@/lib/integrations/ec-portal');
    const calls = await searchFundingCalls({ status: 'open', limit: 5 });
    expect(Array.isArray(calls)).toBe(true);
  }, 60_000);
});
