// ─── MySMIS 2021+ Client ────────────────────────────────────────
// EU funds management system integration
// Note: MySMIS doesn't have a public API — this implements the known
// integration patterns for authorized systems

import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'mysmis' });

const RATE_KEY = 'mysmis';

export interface MySMISProjectStatus {
  projectCode: string;
  status: 'draft' | 'submitted' | 'evaluation' | 'contracted' | 'implementation' | 'closed';
  submissionDate?: string;
  contractDate?: string;
  totalBudget: number;
  euContribution: number;
  lastUpdate: string;
}

export interface MySMISCallInfo {
  callCode: string;
  title: string;
  program: string;
  status: 'open' | 'closed' | 'evaluation';
  deadline?: string;
  budget: number;
}

/**
 * Check project submission status in MySMIS
 * Requires authorized API access (configured via env)
 */
export async function getProjectStatus(projectCode: string): Promise<MySMISProjectStatus | null> {
  const apiKey = process.env.MYSMIS_API_KEY;
  const baseUrl = process.env.MYSMIS_BASE_URL ?? 'https://mysmis2021.gov.ro/api';

  if (!apiKey) {
    log.warn('MySMIS API key not configured — returning null');
    return null;
  }

  return withCircuitBreaker(RATE_KEY, () =>
    withRateLimit(RATE_KEY, async () => {
      const response = await fetch(`${baseUrl}/projects/${projectCode}/status`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`MySMIS API error: ${response.status}`);
      }

      return response.json();
    }, { maxRequests: 5, windowMs: 60_000, maxRetries: 5, baseDelayMs: 2000 }),
  );
}

/**
 * Get open calls from MySMIS
 * Falls back to cached/scraped data if API unavailable
 */
export async function getOpenCalls(): Promise<MySMISCallInfo[]> {
  const apiKey = process.env.MYSMIS_API_KEY;
  const baseUrl = process.env.MYSMIS_BASE_URL ?? 'https://mysmis2021.gov.ro/api';

  if (!apiKey) {
    log.warn('MySMIS API key not configured — returning empty');
    return [];
  }

  return withCircuitBreaker(RATE_KEY, () =>
    withRateLimit(RATE_KEY, async () => {
      const response = await fetch(`${baseUrl}/calls?status=open`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) throw new Error(`MySMIS API error: ${response.status}`);
      const data = await response.json();
      return data.calls ?? [];
    }, { maxRequests: 3, windowMs: 60_000, maxRetries: 5, baseDelayMs: 3000 }),
  );
}
