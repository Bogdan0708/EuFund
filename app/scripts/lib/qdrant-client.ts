// Thin Qdrant HTTP wrapper. Used by bulk-ingest (existing), audit, and patcher (new).
// API key reads from constructor arg OR QDRANT_API_KEY env so callers that pass two
// args (e.g., the refactored bulk-ingest) don't silently drop auth.

export interface QdrantPoint<P = Record<string, unknown>> {
  id: string | number;
  payload?: P;
  vector?: number[];
}

export interface ScrollOptions { batchSize?: number; withVector?: boolean; }

export class QdrantClient {
  private readonly apiKey: string | undefined;
  constructor(private readonly baseUrl: string, private readonly collection: string, apiKey?: string) {
    this.apiKey = apiKey ?? process.env.QDRANT_API_KEY;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  async *scrollAll<P = Record<string, unknown>>(opts: ScrollOptions = {}): AsyncIterable<QdrantPoint<P>> {
    const batchSize = opts.batchSize ?? 256;
    const withVector = opts.withVector ?? false;
    let next: string | number | null | undefined = undefined;
    do {
      const body: Record<string, unknown> = { limit: batchSize, with_payload: true, with_vector: withVector };
      if (next !== undefined) body.offset = next;
      const resp = await fetch(`${this.baseUrl}/collections/${this.collection}/points/scroll`,
        { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
      if (!resp.ok) throw new Error(`scroll failed (${resp.status}): ${await resp.text()}`);
      const data = await resp.json() as { result: { points: QdrantPoint<P>[]; next_page_offset: string | number | null } };
      for (const p of data.result.points) yield p;
      next = data.result.next_page_offset ?? null;
    } while (next !== null);
  }

  async setPayload(pointIds: Array<string | number>, payload: Record<string, unknown>): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/collections/${this.collection}/points/payload`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify({ payload, points: pointIds }) });
    if (!resp.ok) throw new Error(`setPayload failed (${resp.status}): ${await resp.text()}`);
  }

  async ensureCollection(vectorSize: number, distance: 'Cosine' | 'Dot' | 'Euclid' = 'Cosine'): Promise<void> {
    const existing = await fetch(`${this.baseUrl}/collections/${this.collection}`, { headers: this.headers() });
    if (existing.ok) return;
    if (existing.status !== 404) {
      throw new Error(`ensureCollection check failed (${existing.status}): ${await existing.text()}`);
    }
    const created = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ vectors: { size: vectorSize, distance } }),
    });
    if (!created.ok) throw new Error(`ensureCollection create failed (${created.status}): ${await created.text()}`);
  }

  async getCount(): Promise<number> {
    const resp = await fetch(`${this.baseUrl}/collections/${this.collection}/points/count`,
      { method: 'POST', headers: this.headers(), body: JSON.stringify({ exact: true }) });
    if (!resp.ok) throw new Error(`count failed (${resp.status}): ${await resp.text()}`);
    return (await resp.json() as { result: { count: number } }).result.count;
  }

  async upsertPoints(points: QdrantPoint[]): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/collections/${this.collection}/points?wait=true`,
      { method: 'PUT', headers: this.headers(), body: JSON.stringify({ points }) });
    if (!resp.ok) throw new Error(`upsertPoints failed (${resp.status}): ${await resp.text()}`);
  }
}
