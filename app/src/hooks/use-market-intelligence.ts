import { useQuery } from '@tanstack/react-query';

interface MarketOpportunity {
  id: string;
  title: string;
  programme: string;
  deadline: string;
  budget: string;
  matchScore: number;
  status: 'new' | 'tracked' | 'applied';
}

interface CompetitorInsight {
  id: string;
  organization: string;
  recentProjects: number;
  successRate: number;
  focusAreas: string[];
}

interface MarketIntelligence {
  opportunities: MarketOpportunity[];
  competitors: CompetitorInsight[];
  trends: { topic: string; momentum: 'rising' | 'stable' | 'declining'; relevance: number }[];
  updatedAt: string;
}

async function fetchMarketIntelligence(projectId?: string): Promise<MarketIntelligence> {
  const url = projectId ? `/api/ai/market-intelligence?projectId=${projectId}` : '/api/ai/market-intelligence';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch market intelligence');
  return res.json();
}

export function useMarketIntelligence(projectId?: string) {
  return useQuery<MarketIntelligence>({
    queryKey: ['market-intelligence', projectId],
    queryFn: () => fetchMarketIntelligence(projectId),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
    retry: 2,
  });
}
