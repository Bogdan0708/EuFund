import { useQuery } from '@tanstack/react-query';

interface LifecyclePhase {
  name: string;
  progress: number;
  deadline: string;
  risk: 'low' | 'medium' | 'high';
  milestones: { name: string; status: 'complete' | 'upcoming' | 'at-risk' }[];
}

interface LifecycleForecast {
  phases: LifecyclePhase[];
  overallHealth: 'good' | 'warning' | 'critical';
  estimatedCompletion: string;
  confidenceLevel: number;
  updatedAt: string;
}

async function fetchLifecycleForecast(projectId: string): Promise<LifecycleForecast> {
  const res = await fetch(`/api/ai/predictions/${projectId}/lifecycle`);
  if (!res.ok) throw new Error('Failed to fetch lifecycle forecast');
  return res.json();
}

export function useLifecycleForecasting(projectId: string) {
  return useQuery<LifecycleForecast>({
    queryKey: ['lifecycle-forecast', projectId],
    queryFn: () => fetchLifecycleForecast(projectId),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: 2,
  });
}
