import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildPatchPlan, applyPatchPlan, type AuditArtifact } from '../../scripts/patch-qdrant-payloads';

const UUID_A = '11111111-1111-4111-8111-111111111111';

describe('buildPatchPlan', () => {
  it('one patch entry per resolvable_by_* point, with call_id + call_code', () => {
    const audit: AuditArtifact = {
      summary: {} as never, samples: {} as never,
      resolutions: [
        { pointId: 1, call_id: UUID_A, call_code: 'PNRR/001', kind: 'resolvable_by_code' },
        { pointId: '3', call_id: 'uuid-B', call_code: 'PEO/2024/1.1', kind: 'resolvable_by_external_id' },
      ],
      orphanIds: [],
    };
    const plan = buildPatchPlan(audit);
    expect(plan.patches).toEqual([
      { pointId: 1, payload: { call_id: UUID_A, call_code: 'PNRR/001' } },
      { pointId: '3', payload: { call_id: 'uuid-B', call_code: 'PEO/2024/1.1' } },
    ]);
  });

  it('emits a top-up patch for `resolved` points that still need call_code', () => {
    const audit: AuditArtifact = {
      summary: {} as never, samples: {} as never,
      resolutions: [
        { pointId: '5', call_id: UUID_A, call_code: 'PNRR/001', kind: 'resolved' },
        { pointId: '6', call_id: 'uuid-X', call_code: null, kind: 'resolved' },
      ],
      orphanIds: [],
    };
    const plan = buildPatchPlan(audit);
    // Point 5 has both — still emit so call_code is set (it may be missing live).
    expect(plan.patches.find((p) => p.pointId === '5')).toEqual({
      pointId: '5', payload: { call_id: UUID_A, call_code: 'PNRR/001' },
    });
    // Point 6 has no callCode — emit only call_id.
    expect(plan.patches.find((p) => p.pointId === '6')).toEqual({
      pointId: '6', payload: { call_id: 'uuid-X' },
    });
  });

  it('tags every orphan from orphanIds (not samples.orphan)', () => {
    const audit: AuditArtifact = {
      summary: {} as never, samples: {} as never,
      resolutions: [], orphanIds: [11, 12, 13, 14, 15],
    };
    const plan = buildPatchPlan(audit);
    expect(plan.orphanTags).toEqual([
      { pointId: 11, payload: { orphan: true } },
      { pointId: 12, payload: { orphan: true } },
      { pointId: 13, payload: { orphan: true } },
      { pointId: 14, payload: { orphan: true } },
      { pointId: 15, payload: { orphan: true } },
    ]);
  });
});

describe('applyPatchPlan', () => {
  const setPayload = vi.fn();
  const client = { setPayload } as never;
  beforeEach(() => setPayload.mockReset());

  it('calls setPayload once per patch and once per orphan tag in confirm mode', async () => {
    const plan = {
      patches: [{ pointId: '1', payload: { call_id: UUID_A } }],
      orphanTags: [{ pointId: '99', payload: { orphan: true } }],
    };
    await applyPatchPlan(client, plan, { dryRun: false });
    expect(setPayload).toHaveBeenCalledTimes(2);
  });

  it('zero setPayload calls in dry-run', async () => {
    const plan = { patches: [{ pointId: '1', payload: { call_id: UUID_A } }], orphanTags: [] };
    await applyPatchPlan(client, plan, { dryRun: true });
    expect(setPayload).not.toHaveBeenCalled();
  });
});
