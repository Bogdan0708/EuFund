import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QdrantClient } from '../../scripts/lib/qdrant-client';

const mockFetch = vi.fn();
beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
});

describe('QdrantClient', () => {
  it('scrollAll paginates until next_page_offset is null', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { points: [{ id: 1, payload: { a: 1 } }], next_page_offset: 'tok' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { points: [{ id: 2, payload: { a: 2 } }], next_page_offset: null } }) });
    const c = new QdrantClient('http://q:6333', 'coll');
    const out: unknown[] = [];
    for await (const p of c.scrollAll({ batchSize: 1 })) out.push(p);
    expect(out).toEqual([{ id: 1, payload: { a: 1 } }, { id: 2, payload: { a: 2 } }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('scrollAll throws on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    const c = new QdrantClient('http://q:6333', 'coll');
    await expect(async () => { for await (const _ of c.scrollAll()) { /* drain */ } }).rejects.toThrow(/scroll failed.*500.*boom/i);
  });

  it('setPayload POSTs to /points/payload with point IDs and payload', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { status: 'ok' } }) });
    const c = new QdrantClient('http://q:6333', 'coll');
    await c.setPayload([42], { canonical_call_id: 'uuid-1' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://q:6333/collections/coll/points/payload',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ payload: { canonical_call_id: 'uuid-1' }, points: [42] }) }),
    );
  });

  it('ensureCollection creates a missing collection with the configured vector size', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'not found' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: true }) });
    const c = new QdrantClient('http://q:6333', 'coll');
    await c.ensureCollection(1536);
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      'http://q:6333/collections/coll',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ vectors: { size: 1536, distance: 'Cosine' } }),
      }),
    );
  });

  it('reads QDRANT_API_KEY from env when constructor apiKey is omitted', async () => {
    process.env.QDRANT_API_KEY = 'env-key-xyz';
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { count: 0 } }) });
    const c = new QdrantClient('http://q:6333', 'coll');
    await c.getCount();
    delete process.env.QDRANT_API_KEY;
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ 'api-key': 'env-key-xyz' });
  });

  it('omits api-key header when no key is configured anywhere', async () => {
    delete process.env.QDRANT_API_KEY;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: { count: 0 } }) });
    const c = new QdrantClient('http://q:6333', 'coll');
    await c.getCount();
    const [, init] = mockFetch.mock.calls[0];
    expect((init as RequestInit).headers).not.toHaveProperty('api-key');
  });
});
