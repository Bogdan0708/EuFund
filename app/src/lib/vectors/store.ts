// ─── Vector Store Abstraction ────────────────────────────────────
// Supports in-memory (dev) and Qdrant (production)

import { AI_CONFIG } from '@/lib/ai/config';
import { aiEmbed, aiEmbedBatch } from '@/lib/ai/client';
import { logger } from '@/lib/logger';

export interface VectorDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

interface VectorStore {
  upsert(docs: VectorDocument[]): Promise<void>;
  search(query: string, topK?: number, filter?: Record<string, unknown>): Promise<SearchResult[]>;
  delete(ids: string[]): Promise<void>;
  deleteByFilter(filter: Record<string, unknown>): Promise<void>;
  count(): Promise<number>;
}

// ─── In-Memory Store (Development) ───────────────────────────────

class MemoryVectorStore implements VectorStore {
  private documents: Map<string, VectorDocument & { embedding: number[] }> = new Map();

  async upsert(docs: VectorDocument[]): Promise<void> {
    const textsToEmbed = docs.filter((d) => !d.embedding).map((d) => d.content);
    let embeddings: number[][] = [];

    if (textsToEmbed.length > 0) {
      const result = await aiEmbedBatch(textsToEmbed);
      embeddings = result.embeddings;
    }

    let embIdx = 0;
    for (const doc of docs) {
      const embedding = doc.embedding ?? embeddings[embIdx++];
      this.documents.set(doc.id, { ...doc, embedding });
    }
  }

  async search(query: string, topK = 5, filter?: Record<string, unknown>): Promise<SearchResult[]> {
    if (this.documents.size === 0) return [];

    const { embedding: queryEmb } = await aiEmbed(query);

    const scored = Array.from(this.documents.values())
      .filter((doc) => {
        if (!filter) return true;
        for (const [fKey, fVal] of Object.entries(filter)) {
          if (doc.metadata[fKey] !== fVal) return false;
        }
        return true;
      })
      .map((doc) => ({
        id: doc.id,
        content: doc.content,
        metadata: doc.metadata,
        score: cosineSimilarity(queryEmb, doc.embedding),
      }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.documents.delete(id);
  }

  async deleteByFilter(filter: Record<string, unknown>): Promise<void> {
    const toDelete: string[] = [];
    for (const [id, doc] of this.documents.entries()) {
      let matches = true;
      for (const [fKey, fVal] of Object.entries(filter)) {
        if (doc.metadata[fKey] !== fVal) {
          matches = false;
          break;
        }
      }
      if (matches) toDelete.push(id);
    }
    for (const id of toDelete) this.documents.delete(id);
  }

  async count(): Promise<number> {
    return this.documents.size;
  }
}

// ─── Qdrant Store (Production) ───────────────────────────────────

class QdrantVectorStore implements VectorStore {
  private baseUrl: string;
  private collection: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = AI_CONFIG.vectorStore.qdrantUrl;
    this.collection = AI_CONFIG.vectorStore.collectionName;
    this.apiKey = AI_CONFIG.vectorStore.qdrantApiKey;
  }

  private async qdrantFetch(path: string, opts?: RequestInit): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts?.headers as Record<string, string>),
    };
    if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...opts,
      headers,
    });
    if (!res.ok) throw new Error(`Qdrant error: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async ensureCollection(): Promise<void> {
    try {
      await this.qdrantFetch(`/collections/${this.collection}`);
    } catch {
      await this.qdrantFetch('/collections/' + this.collection, {
        method: 'PUT',
        body: JSON.stringify({
          vectors: { size: AI_CONFIG.embedding.dimensions, distance: 'Cosine' },
        }),
      });
    }
  }

  async upsert(docs: VectorDocument[]): Promise<void> {
    const textsToEmbed = docs.filter((d) => !d.embedding).map((d) => d.content);
    let embeddings: number[][] = [];

    if (textsToEmbed.length > 0) {
      const result = await aiEmbedBatch(textsToEmbed);
      embeddings = result.embeddings;
    }

    let embIdx = 0;
    const points = docs.map((doc) => ({
      id: doc.id,
      vector: doc.embedding ?? embeddings[embIdx++],
      payload: { content: doc.content, ...doc.metadata },
    }));

    await this.qdrantFetch(`/collections/${this.collection}/points`, {
      method: 'PUT',
      body: JSON.stringify({ points }),
    });
  }

  async search(query: string, topK = 5, filter?: Record<string, unknown>): Promise<SearchResult[]> {
    const { embedding } = await aiEmbed(query);

    const body: Record<string, unknown> = {
      vector: embedding,
      limit: topK,
      with_payload: true,
    };
    body.filter = toQdrantFilter(filter);

    const result = (await this.qdrantFetch(`/collections/${this.collection}/points/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    })) as { result: Array<{ id: string; score: number; payload: Record<string, unknown> }> };

    return result.result.map((r) => ({
      id: String(r.id),
      content: String(r.payload.content || ''),
      metadata: r.payload,
      score: r.score,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    await this.qdrantFetch(`/collections/${this.collection}/points/delete`, {
      method: 'POST',
      body: JSON.stringify({ points: ids }),
    });
  }

  async deleteByFilter(filter: Record<string, unknown>): Promise<void> {
    const must = Object.entries(filter).map(([key, value]) => ({
      key,
      match: { value },
    }));

    await this.qdrantFetch(`/collections/${this.collection}/points/delete`, {
      method: 'POST',
      body: JSON.stringify({
        filter: { must },
      }),
    });
  }

  async count(): Promise<number> {
    const result = (await this.qdrantFetch(`/collections/${this.collection}`)) as {
      result: { points_count: number };
    };
    return result.result.points_count;
  }
}

// ─── Qdrant Filter Translation ──────────────────────────────────
// Qdrant's search and delete endpoints expect structured filter bodies —
// `{ must: [{ key, match: { value } }] }` — not the flat `{ key: value }`
// shape MemoryVectorStore accepts. Translate here so callers pass one
// shape regardless of provider.

const ORPHAN_EXCLUSION = { key: 'orphan', match: { value: true } } as const;

export function toQdrantFilter(
  filter?: Record<string, unknown>,
): {
  must?: Array<{ key: string; match: { value: unknown } }>;
  must_not: Array<typeof ORPHAN_EXCLUSION>;
} {
  const entries = Object.entries(filter ?? {});
  const base = { must_not: [ORPHAN_EXCLUSION] };
  if (entries.length === 0) return base;
  return {
    must: entries.map(([key, value]) => ({ key, match: { value } })),
    ...base,
  };
}

// ─── Cosine Similarity ──────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Factory ─────────────────────────────────────────────────────

let _store: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!_store) {
    if (AI_CONFIG.vectorStore.provider === 'qdrant') {
      const qs = new QdrantVectorStore();
      // Fire and forget collection setup
      qs.ensureCollection().catch((error) => logger.error({ error }, 'Unhandled async error'));
      _store = qs;
    } else {
      _store = new MemoryVectorStore();
    }
  }
  return _store;
}

export { cosineSimilarity };
