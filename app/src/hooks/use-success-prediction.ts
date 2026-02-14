import { useQuery } from '@tanstack/react-query';

interface SuccessFactor {
  id: string;
  name: string;
  impact: 'high' | 'medium' | 'low';
  direction: 'positive' | 'negative';
  score: number;
  description: string;
  recommendation?: string;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedImpact: number;
  effort: 'low' | 'medium' | 'high';
  category: string;
}

interface SuccessPrediction {
  probability: number;
  confidence: number;
  factors: SuccessFactor[];
  recommendations: Recommendation[];
  updatedAt: string;
}

async function fetchSuccessPrediction(projectId: string): Promise<SuccessPrediction> {
  const res = await fetch(`/api/ai/predictions/${projectId}/success`);
  if (!res.ok) throw new Error('Failed to fetch success prediction');
  return res.json();
}

export function useSuccessPrediction(projectId: string) {
  return useQuery<SuccessPrediction>({
    queryKey: ['success-prediction', projectId],
    queryFn: () => fetchSuccessPrediction(projectId),
    staleTime: 30_000, // 30s — predictions update frequently
    refetchInterval: 60_000, // auto-refresh every minute
    retry: 2,
    placeholderData: undefined,
  });
}
