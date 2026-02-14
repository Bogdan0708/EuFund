import { useQuery } from '@tanstack/react-query';

interface AdvancedAnalyticsData {
  kpis: {
    id: string;
    name: string;
    value: number;
    previousValue: number;
    unit: string;
    trend: 'up' | 'down' | 'stable';
    target?: number;
  }[];
  risks: {
    category: string;
    dimension: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
    description: string;
  }[];
  forecast: { label: string; actual?: number; predicted: number }[];
  competitive: { name: string; yourRank: number; totalProjects: number; percentile: number }[];
  updatedAt: string;
}

async function fetchAdvancedAnalytics(
  projectId: string,
  analyticsType: string,
  timeRange: string
): Promise<AdvancedAnalyticsData> {
  const params = new URLSearchParams({ type: analyticsType, range: timeRange });
  const res = await fetch(`/api/ai/analytics/${projectId}?${params}`);
  if (!res.ok) throw new Error('Failed to fetch advanced analytics');
  return res.json();
}

export function useAdvancedAnalytics(
  projectId: string,
  analyticsType: 'performance' | 'predictive' | 'competitive',
  timeRange: 'realtime' | '7d' | '30d' | 'lifetime'
) {
  return useQuery<AdvancedAnalyticsData>({
    queryKey: ['advanced-analytics', projectId, analyticsType, timeRange],
    queryFn: () => fetchAdvancedAnalytics(projectId, analyticsType, timeRange),
    staleTime: timeRange === 'realtime' ? 10_000 : 60_000,
    refetchInterval: timeRange === 'realtime' ? 15_000 : 5 * 60_000,
    retry: 2,
  });
}
