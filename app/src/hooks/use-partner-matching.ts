import { useQuery } from '@tanstack/react-query';

interface PartnerRecommendation {
  id: string;
  name: string;
  country: string;
  type: 'university' | 'research' | 'sme' | 'large_enterprise' | 'ngo' | 'public';
  capabilities: string[];
  matchScore: number;
  matchReasons: string[];
  budgetImpact: number;
  onrcStatus?: 'verified' | 'pending' | 'unknown';
  sicapScore?: number;
  pastProjects?: number;
}

interface PartnerMatchResult {
  recommendations: PartnerRecommendation[];
  gapAnalysis: { capability: string; covered: boolean; suggestedPartners: string[] }[];
  updatedAt: string;
}

async function fetchPartnerMatching(projectId: string, capabilities: string[]): Promise<PartnerMatchResult> {
  const params = new URLSearchParams({ projectId, capabilities: capabilities.join(',') });
  const res = await fetch(`/api/ai/partners/match?${params}`);
  if (!res.ok) throw new Error('Failed to fetch partner matching');
  return res.json();
}

export function usePartnerMatching(projectId: string, capabilities: string[]) {
  return useQuery<PartnerMatchResult>({
    queryKey: ['partner-matching', projectId, capabilities],
    queryFn: () => fetchPartnerMatching(projectId, capabilities),
    staleTime: 5 * 60_000,
    retry: 2,
    enabled: capabilities.length > 0,
  });
}
