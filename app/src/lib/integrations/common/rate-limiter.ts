// ─── Rate Limiter with Exponential Backoff ──────────────────────
// Generic rate limiter for all external API integrations

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 10,
  windowMs: 60_000,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

interface RequestRecord {
  timestamps: number[];
}

const requestRecords = new Map<string, RequestRecord>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function canMakeRequest(key: string, config: RateLimiterConfig = DEFAULT_CONFIG): boolean {
  const now = Date.now();
  const record = requestRecords.get(key) ?? { timestamps: [] };
  record.timestamps = record.timestamps.filter((t) => now - t < config.windowMs);
  return record.timestamps.length < config.maxRequests;
}

export function recordRequest(key: string): void {
  const record = requestRecords.get(key) ?? { timestamps: [] };
  record.timestamps.push(Date.now());
  requestRecords.set(key, record);
}

export async function withRateLimit<T>(
  key: string,
  fn: () => Promise<T>,
  config: Partial<RateLimiterConfig> = {},
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    // Wait for rate limit window if needed
    while (!canMakeRequest(key, cfg)) {
      await sleep(1000);
    }

    try {
      recordRequest(key);
      return await fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || error?.message?.includes('rate limit');
      const isRetryable = isRateLimit || error?.status === 503 || error?.status === 502;

      if (!isRetryable || attempt === cfg.maxRetries) throw error;

      const delay = Math.min(cfg.baseDelayMs * Math.pow(2, attempt), cfg.maxDelayMs);
      const jitter = delay * 0.1 * Math.random();
      await sleep(delay + jitter);
    }
  }

  throw new Error(`Rate limit: max retries exceeded for ${key}`);
}
