// Resolution logic used by audit, patcher, backfill, and strict-mode bulk-ingest.
// No I/O of its own — callers wire ResolverDb to whatever DB they have.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(x: unknown): x is string {
  return typeof x === 'string' && UUID_RE.test(x);
}

// Read a payload key tolerating both legacy camelCase ("callId") and canonical
// snake_case ("call_id"). Snake_case wins when both are present. Returns undefined
// for missing or non-string values.
export function pickPayloadKey<K extends 'callId' | 'callCode' | 'externalId'>(
  payload: Record<string, unknown>, camelKey: K,
): string | undefined {
  const snakeKey =
    camelKey === 'callId' ? 'call_id' :
    camelKey === 'callCode' ? 'call_code' :
    'external_id';
  const snake = payload[snakeKey];
  if (typeof snake === 'string' && snake.length > 0) return snake;
  const camel = payload[camelKey];
  if (typeof camel === 'string' && camel.length > 0) return camel;
  return undefined;
}

export type Resolution =
  | { kind: 'resolved';                  callId: string; callCode: string | null }
  | { kind: 'resolvable_by_code';        callId: string; callCode: string }
  | { kind: 'resolvable_by_external_id'; callId: string; callCode: string | null }
  | { kind: 'orphan' };

export interface ResolverDb {
  findCallById(id: string):           Promise<{ id: string; callCode: string | null } | null>;
  findCallByCode(code: string):       Promise<{ id: string; callCode: string }        | null>;
  // Ambiguity-safe: must return null if the external_id matches multiple rows.
  // calls_for_proposals.external_id is NOT globally unique — uniqueness is
  // (source_connector_id, external_id). Callers should query with LIMIT 2 and
  // return null when length !== 1.
  findCallByExternalId(extId: string): Promise<{ id: string; callCode: string | null } | null>;
}

export async function resolveCallId(db: ResolverDb, payload: Record<string, unknown>): Promise<Resolution> {
  const callIdRaw   = pickPayloadKey(payload, 'callId');
  const callCodeRaw = pickPayloadKey(payload, 'callCode');
  const externalRaw = pickPayloadKey(payload, 'externalId');

  // 1. Already-canonical UUID match
  if (callIdRaw && isUUID(callIdRaw)) {
    const row = await db.findCallById(callIdRaw);
    if (row) return { kind: 'resolved', callId: row.id, callCode: row.callCode };
  }
  // 2. call_code / callCode match
  if (callCodeRaw) {
    const row = await db.findCallByCode(callCodeRaw);
    if (row) return { kind: 'resolvable_by_code', callId: row.id, callCode: row.callCode };
  }
  // 3. external_id match (single-row only)
  if (externalRaw) {
    const row = await db.findCallByExternalId(externalRaw);
    if (row) return { kind: 'resolvable_by_external_id', callId: row.id, callCode: row.callCode };
  }
  return { kind: 'orphan' };
}

// Produces a new payload object with canonical snake_case keys ADDED (no legacy
// removal). Returns the input unchanged for orphans.
export function canonicalizePayload(
  payload: Record<string, unknown>,
  resolution: Resolution,
): Record<string, unknown> {
  if (resolution.kind === 'orphan') return payload;
  const out: Record<string, unknown> = { ...payload, call_id: resolution.callId };
  if (resolution.callCode != null) out.call_code = resolution.callCode;
  return out;
}
