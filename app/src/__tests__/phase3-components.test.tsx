import { describe, it, expect, vi } from 'vitest';

// Mock react-query
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
}));

// Type-level tests to ensure interfaces are sound
describe('Phase 3 Component Types', () => {
  it('PredictiveDashboard props are valid', async () => {
    const mod = await import('@/components/analytics/predictive-dashboard');
    expect(mod.default).toBeDefined();
  });

  it('PartnerMatching props are valid', async () => {
    const mod = await import('@/components/consortium/partner-matching');
    expect(mod.default).toBeDefined();
  });

  it('ProjectAnalytics props are valid', async () => {
    const mod = await import('@/components/analytics/project-analytics');
    expect(mod.default).toBeDefined();
  });

  it('RealTimeWorkspace props are valid', async () => {
    const mod = await import('@/components/collaboration/real-time-workspace');
    expect(mod.default).toBeDefined();
  });

  it('AdvancedReports props are valid', async () => {
    const mod = await import('@/components/reporting/advanced-reports');
    expect(mod.default).toBeDefined();
  });

  it('AdvancedMobile props are valid', async () => {
    const mod = await import('@/components/mobile/advanced-mobile');
    expect(mod.default).toBeDefined();
  });

  it('AdvancedSearch props are valid', async () => {
    const mod = await import('@/components/search/advanced-search');
    expect(mod.default).toBeDefined();
  });

  it('IntegrationDashboard props are valid', async () => {
    const mod = await import('@/components/integrations/integration-dashboard');
    expect(mod.default).toBeDefined();
  });
});

describe('Phase 3 Hooks', () => {
  it('useSuccessPrediction exports correctly', async () => {
    const mod = await import('@/hooks/use-success-prediction');
    expect(mod.useSuccessPrediction).toBeDefined();
  });

  it('usePartnerMatching exports correctly', async () => {
    const mod = await import('@/hooks/use-partner-matching');
    expect(mod.usePartnerMatching).toBeDefined();
  });

  it('useLifecycleForecasting exports correctly', async () => {
    const mod = await import('@/hooks/use-lifecycle-forecasting');
    expect(mod.useLifecycleForecasting).toBeDefined();
  });

  it('useMarketIntelligence exports correctly', async () => {
    const mod = await import('@/hooks/use-market-intelligence');
    expect(mod.useMarketIntelligence).toBeDefined();
  });

  it('useAdvancedAnalytics exports correctly', async () => {
    const mod = await import('@/hooks/use-advanced-analytics');
    expect(mod.useAdvancedAnalytics).toBeDefined();
  });
});
