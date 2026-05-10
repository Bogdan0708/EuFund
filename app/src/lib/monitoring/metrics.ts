// ─── Prometheus Metrics Registry ────────────────────────────────
// In-memory metric collection for Prometheus scraping.
// Imported from monitoring/prometheus-metrics.ts design.

interface MetricData {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  values: Map<string, number>;
  buckets?: number[];
}

class MetricsRegistry {
  private metrics = new Map<string, MetricData>();

  counter(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { name, help, type: 'counter', values: new Map() });
    }
  }

  gauge(name: string, help: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { name, help, type: 'gauge', values: new Map() });
    }
  }

  histogram(name: string, help: string, buckets: number[]): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, { name, help, type: 'histogram', values: new Map(), buckets });
    }
  }

  inc(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const metric = this.metrics.get(name);
    if (!metric) return;
    const key = this.labelsToKey(labels);
    metric.values.set(key, (metric.values.get(key) || 0) + value);
  }

  set(name: string, labels: Record<string, string>, value: number): void {
    const metric = this.metrics.get(name);
    if (!metric) return;
    metric.values.set(this.labelsToKey(labels), value);
  }

  observe(name: string, labels: Record<string, string>, value: number): void {
    const metric = this.metrics.get(name);
    if (!metric || !metric.buckets) return;
    const keyBase = this.labelsToKey(labels);
    for (const bucket of metric.buckets) {
      if (value <= bucket) {
        const bucketKey = `${keyBase},le="${bucket}"`;
        metric.values.set(bucketKey, (metric.values.get(bucketKey) || 0) + 1);
      }
    }
    const infKey = `${keyBase},le="+Inf"`;
    metric.values.set(infKey, (metric.values.get(infKey) || 0) + 1);
    metric.values.set(`${keyBase}_sum`, (metric.values.get(`${keyBase}_sum`) || 0) + value);
    metric.values.set(`${keyBase}_count`, (metric.values.get(`${keyBase}_count`) || 0) + 1);
  }

  toPrometheus(): string {
    const lines: string[] = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
      for (const [labels, value] of metric.values) {
        if (labels) {
          lines.push(`${metric.name}{${labels}} ${value}`);
        } else {
          lines.push(`${metric.name} ${value}`);
        }
      }
    }
    return lines.join('\n');
  }

  private labelsToKey(labels: Record<string, string>): string {
    return Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
  }
}

export const metrics = new MetricsRegistry();

// ─── Define metrics ─────────────────────────────────────────────

metrics.histogram('http_request_duration_seconds', 'HTTP request duration in seconds', [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]);
metrics.counter('http_requests_total', 'Total HTTP requests');
metrics.counter('http_request_errors_total', 'Total HTTP request errors');

metrics.histogram('external_api_duration_seconds', 'External API call duration', [0.1, 0.25, 0.5, 1, 2, 5, 10]);
metrics.counter('external_api_calls_total', 'Total external API calls');
metrics.counter('external_api_errors_total', 'Total external API errors');

metrics.counter('ai_requests_total', 'Total AI requests');
metrics.counter('proposals_generated_total', 'Total proposals generated');

metrics.counter('ai_cache_calls_total', 'Router AI cache call outcomes');
metrics.counter('ai_cache_reads_tokens_total', 'Router AI cache read tokens');
metrics.counter('ai_cache_writes_tokens_total', 'Router AI cache write tokens');
metrics.counter('ai_cache_disabled_total', 'Router AI cache disable reasons');
metrics.counter('project_promotion_total', 'Session-to-project promotion outcomes');

function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f-]{36}/g, '/:id')
    .replace(/\/\d+/g, '/:id');
}

export function trackRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  const labels = { method, path: normalizePath(path), status: String(statusCode) };
  metrics.inc('http_requests_total', labels);
  metrics.observe('http_request_duration_seconds', labels, durationMs / 1000);
  if (statusCode >= 400) {
    metrics.inc('http_request_errors_total', labels);
  }
}

export function trackExternalAPI(api: string, success: boolean, durationMs: number): void {
  metrics.inc('external_api_calls_total', { api });
  metrics.observe('external_api_duration_seconds', { api }, durationMs / 1000);
  if (!success) metrics.inc('external_api_errors_total', { api });
}

export function trackAiCacheCall(provider: string, model: string, hit: string): void {
  metrics.inc('ai_cache_calls_total', { provider, model, hit });
}

export function trackAiCacheReadTokens(provider: string, model: string, task: string, tokens: number): void {
  if (tokens > 0) metrics.inc('ai_cache_reads_tokens_total', { provider, model, task }, tokens);
}

export function trackAiCacheWriteTokens(provider: string, model: string, task: string, tokens: number): void {
  if (tokens > 0) metrics.inc('ai_cache_writes_tokens_total', { provider, model, task }, tokens);
}

export function trackAiCacheDisabled(reason: 'global_kill_switch' | 'request_disabled'): void {
  metrics.inc('ai_cache_disabled_total', { reason });
}

export function trackProjectPromotion(
  outcome:
    | 'promoted'
    | 'already_linked'
    | 'synced'
    | 'no_selected_call'
    | 'user_missing'
    | 'session_missing'
    | 'failed',
): void {
  metrics.inc('project_promotion_total', { outcome });
}
