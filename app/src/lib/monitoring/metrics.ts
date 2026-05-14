/**
 * Super-minimal Prometheus-compatible metrics registry.
 * This is the V1 implementation; V2 will move to OTel.
 */
class MetricsRegistry {
  private counters = new Map<string, { help: string; values: Map<string, number> }>();
  private histograms = new Map<string, { help: string; buckets: number[]; values: Map<string, number[]> }>();

  counter(name: string, help: string) {
    this.counters.set(name, { help, values: new Map() });
  }

  histogram(name: string, help: string, buckets: number[]) {
    this.histograms.set(name, { help, buckets, values: new Map() });
  }

  inc(name: string, labels: Record<string, string> = {}, value = 1) {
    const counter = this.counters.get(name);
    if (!counter) return;

    const labelKey = this.serializeLabels(labels);
    const current = counter.values.get(labelKey) ?? 0;
    counter.values.set(labelKey, current + value);
  }

  observe(name: string, labels: Record<string, string> = {}, value: number) {
    const histogram = this.histograms.get(name);
    if (!histogram) return;

    const labelKey = this.serializeLabels(labels);
    const values = histogram.values.get(labelKey) ?? [];
    values.push(value);
    histogram.values.set(labelKey, values);
  }

  private serializeLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
  }

  expose(): string {
    let output = '';
    for (const [name, counter] of this.counters) {
      output += `# HELP ${name} ${counter.help}\n`;
      output += `# TYPE ${name} counter\n`;
      for (const [labels, value] of counter.values) {
        output += `${name}{${labels}} ${value}\n`;
      }
    }
    for (const [name, histogram] of this.histograms) {
      output += `# HELP ${name} ${histogram.help}\n`;
      output += `# TYPE ${name} histogram\n`;
      for (const [labels, values] of histogram.values) {
        // Very simplified histogram export (sum only)
        const sum = values.reduce((a, b) => a + b, 0);
        output += `${name}_sum{${labels}} ${sum}\n`;
        output += `${name}_count{${labels}} ${values.length}\n`;
      }
    }
    return output;
  }
}

export const metrics = new MetricsRegistry();

// Initialize counters
metrics.counter('http_requests_total', 'Total HTTP requests');
metrics.counter('ai_completion_total', 'Total AI completion requests');
metrics.counter('ai_completion_tokens_total', 'Total AI completion tokens (input + output)');
metrics.counter('ai_completion_errors_total', 'Total AI completion errors');
metrics.counter('ai_cost_usd_total', 'Estimated AI cost in USD');
metrics.counter('rag_search_total', 'Total RAG searches');
metrics.counter('rag_search_errors_total', 'Total RAG search errors');
metrics.counter('auth_login_total', 'Total login attempts');
metrics.counter('auth_register_total', 'Total registration attempts');
metrics.counter('stripe_webhook_total', 'Total Stripe webhooks received');
metrics.counter('stripe_webhook_errors_total', 'Total Stripe webhook errors');
metrics.counter('audit_log_total', 'Total audit log entries');
metrics.counter('audit_integrity_failure_total', 'Total audit chain integrity check failures');
metrics.counter('backup_total', 'Total backups performed');
metrics.counter('backup_errors_total', 'Total backup errors');
metrics.counter('rate_limit_hits_total', 'Total rate limit hits');
metrics.counter('security_csp_violation_total', 'Total CSP violations reported');
metrics.counter('security_csrf_failure_total', 'Total CSRF check failures');
metrics.counter('ai_cache_hits_total', 'Router AI cache hits');
metrics.counter('ai_cache_misses_total', 'Router AI cache misses');
metrics.counter('ai_cache_reads_tokens_total', 'Router AI cache read tokens');
metrics.counter('ai_cache_writes_tokens_total', 'Router AI cache write tokens');
metrics.counter('ai_cache_disabled_total', 'Router AI cache disable reasons');
metrics.counter('project_promotion_total', 'Session-to-project promotion outcomes');
metrics.counter('policy_violation_total', 'Policy gate rejections from assertPolicy');
metrics.counter('change_call_total', 'Number of change-call operations');
metrics.counter('iteration_cap_hit_total', 'Total agent turns that hit the tool-loop iteration cap');
metrics.counter('generate_section_total', 'Outcomes of /sections/generate requests');
metrics.histogram('generate_section_latency_seconds', 'Wall-clock latency of /sections/generate end-to-end', [0.5, 1, 2, 5, 10, 20, 30, 60]);
metrics.counter('managed_action_bridge_total', 'Managed action bridge outcomes');
metrics.histogram('managed_action_bridge_duration_ms', 'Managed action bridge duration', [50, 100, 250, 500, 1000]);
metrics.counter('storage_cleanup_errors_total', 'Total storage cleanup failures');

function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-fA-F-]{36}(\/|$)/g, '/:id$1') // UUIDs
    .replace(/\/[0-9]+(\/|$)/g, '/:num$1'); // Numeric IDs
}

export function trackHttpRequest(method: string, path: string, status: number): void {
  const normalizedPath = normalizePath(path);
  metrics.inc('http_requests_total', { method, path: normalizedPath, status: String(status) });
}

export function trackAICompletion(model: string, provider: string, tokens: number, costUsd: number): void {
  metrics.inc('ai_completion_total', { model, provider });
  metrics.inc('ai_completion_tokens_total', { model, provider }, tokens);
  metrics.inc('ai_cost_usd_total', { model, provider }, costUsd);
}

export function trackAIError(model: string, provider: string, type: string): void {
  metrics.inc('ai_completion_errors_total', { model, provider, type });
}

export function trackRAGSearch(provider: string, status: 'success' | 'error'): void {
  metrics.inc(status === 'success' ? 'rag_search_total' : 'rag_search_errors_total', { provider });
}

export function trackProjectPromotion(outcome: 'success' | 'failure' | 'no_op'): void {
  metrics.inc('project_promotion_total', { outcome });
}

export function trackIterationCapHit(runtime: 'v3' | 'managed'): void {
  metrics.inc('iteration_cap_hit_total', { runtime });
}

type GenerateSectionOutcome = 'success' | 'failure' | 'precondition'

export function trackGenerateSectionTotal(args: {
  outcome: GenerateSectionOutcome
  reason?: string
}): void {
  const labels: Record<string, string> = { outcome: args.outcome }
  if (args.reason) labels.reason = args.reason
  metrics.inc('generate_section_total', labels)
}

export function trackGenerateSectionLatency(seconds: number): void {
  metrics.observe('generate_section_latency_seconds', {}, seconds)
}

export function trackManagedActionBridge(
  actionType: string,
  outcome: string,
  durationMs: number,
  code?: string,
): void {
  const labels = { action_type: actionType, outcome, code: code || 'none' };
  metrics.inc('managed_action_bridge_total', labels);
  metrics.observe('managed_action_bridge_duration_ms', { action_type: actionType }, durationMs);
}

export function trackStorageCleanupError(service: string): void {
  metrics.inc('storage_cleanup_errors_total', { service });
}
