import { describe, expect, it, vi } from 'vitest';
import {
  isUUID, pickPayloadKey, resolveCallId, canonicalizePayload, type ResolverDb,
} from '../../scripts/lib/call-id-resolver';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function makeDb(rows: {
  byId?: Record<string, { id: string; callCode: string | null }>;
  byCode?: Record<string, { id: string; callCode: string }>;
  byExternalId?: Record<string, { id: string; callCode: string | null } | 'ambiguous'>;
} = {}): ResolverDb {
  return {
    findCallById:        vi.fn(async (id) => rows.byId?.[id] ?? null),
    findCallByCode:      vi.fn(async (code) => rows.byCode?.[code] ?? null),
    findCallByExternalId: vi.fn(async (ext) => {
      const v = rows.byExternalId?.[ext];
      if (v === 'ambiguous') return null;
      return v ?? null;
    }),
  };
}

describe('isUUID', () => {
  it('accepts v4-shaped UUIDs case-insensitively', () => {
    expect(isUUID(UUID_A)).toBe(true);
    expect(isUUID(UUID_A.toUpperCase())).toBe(true);
  });
  it('rejects non-strings and bad shapes', () => {
    expect(isUUID(undefined)).toBe(false);
    expect(isUUID(123)).toBe(false);
    expect(isUUID('not-a-uuid')).toBe(false);
  });
});

describe('pickPayloadKey', () => {
  it('prefers snake_case', () => {
    expect(pickPayloadKey({ call_id: 'A', callId: 'B' }, 'callId')).toBe('A');
    expect(pickPayloadKey({ call_code: 'X', callCode: 'Y' }, 'callCode')).toBe('X');
  });
  it('falls back to camelCase when snake_case absent', () => {
    expect(pickPayloadKey({ callCode: 'Y' }, 'callCode')).toBe('Y');
  });
  it('returns undefined for missing key', () => {
    expect(pickPayloadKey({}, 'callId')).toBeUndefined();
  });
  it('returns undefined for non-string values', () => {
    expect(pickPayloadKey({ callId: 123 } as never, 'callId')).toBeUndefined();
  });
});

describe('resolveCallId — legacy camelCase payloads', () => {
  it('resolves payload.callCode (camelCase) via call_code lookup', async () => {
    const db = makeDb({ byCode: { 'PNRR/001': { id: UUID_A, callCode: 'PNRR/001' } } });
    const r = await resolveCallId(db, { callCode: 'PNRR/001' });
    expect(r).toEqual({ kind: 'resolvable_by_code', callId: UUID_A, callCode: 'PNRR/001' });
  });
  it('resolves payload.callId when it is a real UUID', async () => {
    const db = makeDb({ byId: { [UUID_A]: { id: UUID_A, callCode: 'PNRR/001' } } });
    const r = await resolveCallId(db, { callId: UUID_A });
    expect(r).toEqual({ kind: 'resolved', callId: UUID_A, callCode: 'PNRR/001' });
  });
  it('falls through to call_code when callId is a non-UUID string', async () => {
    const db = makeDb({ byCode: { 'PNRR/001': { id: UUID_A, callCode: 'PNRR/001' } } });
    const r = await resolveCallId(db, { callId: 'PNRR/001', callCode: 'PNRR/001' });
    expect(r).toEqual({ kind: 'resolvable_by_code', callId: UUID_A, callCode: 'PNRR/001' });
  });
});

describe('resolveCallId — canonical snake_case payloads', () => {
  it('resolves when only call_id is present', async () => {
    const db = makeDb({ byId: { [UUID_A]: { id: UUID_A, callCode: null } } });
    const r = await resolveCallId(db, { call_id: UUID_A });
    expect(r).toEqual({ kind: 'resolved', callId: UUID_A, callCode: null });
  });
});

describe('resolveCallId — external_id ambiguity safety', () => {
  it('returns orphan when external_id matches multiple rows', async () => {
    const db = makeDb({ byExternalId: { 'ec-42': 'ambiguous' } });
    const r = await resolveCallId(db, { external_id: 'ec-42' });
    expect(r).toEqual({ kind: 'orphan' });
  });
  it('resolves when external_id matches exactly one row', async () => {
    const db = makeDb({ byExternalId: { 'ec-42': { id: UUID_B, callCode: 'PEO/2024/1.1' } } });
    const r = await resolveCallId(db, { externalId: 'ec-42' });
    expect(r).toEqual({ kind: 'resolvable_by_external_id', callId: UUID_B, callCode: 'PEO/2024/1.1' });
  });
});

describe('resolveCallId — orphan fallback', () => {
  it('returns orphan when nothing matches', async () => {
    const db = makeDb();
    const r = await resolveCallId(db, { callId: 'abc', callCode: 'X' });
    expect(r).toEqual({ kind: 'orphan' });
  });
});

describe('canonicalizePayload', () => {
  it('adds call_id + call_code (snake_case) without removing legacy camelCase', () => {
    const payload = { callCode: 'PNRR/001', programCode: 'PNRR', sourceId: 'sha-abc' };
    const out = canonicalizePayload(payload, { kind: 'resolvable_by_code', callId: UUID_A, callCode: 'PNRR/001' });
    expect(out).toEqual({
      callCode: 'PNRR/001', programCode: 'PNRR', sourceId: 'sha-abc',
      call_id: UUID_A, call_code: 'PNRR/001',
    });
  });
  it('writes only call_id when resolution has no callCode', () => {
    const out = canonicalizePayload({ a: 1 }, { kind: 'resolved', callId: UUID_A, callCode: null });
    expect(out).toEqual({ a: 1, call_id: UUID_A });
  });
  it('returns payload unchanged for orphan resolution', () => {
    const out = canonicalizePayload({ a: 1 }, { kind: 'orphan' });
    expect(out).toEqual({ a: 1 });
  });
});
