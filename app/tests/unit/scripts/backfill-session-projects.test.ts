import { describe, it, expect, vi, beforeEach } from 'vitest';

// Vitest hoists vi.mock() calls to the top of the file. Because of this,
// factory closures cannot reference variables declared in the module body
// (they would be in TDZ at hoist time). Instead we use vi.hoisted() to
// create the shared mock ref in the same hoisting pass, then reference it
// from the factory. Both path shapes are mocked for robustness.
const { ensureMock } = vi.hoisted(() => ({ ensureMock: vi.fn() }));

vi.mock('@/lib/projects/promotion', () => ({ ensureProjectForSession: ensureMock }));
vi.mock('../../../src/lib/projects/promotion', () => ({ ensureProjectForSession: ensureMock }));

// processRow is exported from the script for unit-level testability.
// The script has a main guard so this import does NOT trigger main().
import { processRow, type Tally } from '../../../scripts/backfill-session-projects';

function newTally(): Tally {
  return { promoted: 0, alreadyLinked: 0, syncedCall: 0, skippedNoSelectedCall: 0, skippedMissingUser: 0, failed: 0 };
}

describe('backfill-session-projects processRow', () => {
  beforeEach(() => ensureMock.mockReset());

  it('skips missing-user without calling helper', async () => {
    const tally = newTally();
    const failed = await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: false }, { confirm: false }, tally);
    expect(tally.skippedMissingUser).toBe(1);
    expect(ensureMock).not.toHaveBeenCalled();
    expect(failed).toBe(false);
  });

  it('counts promoted on created=true return', async () => {
    ensureMock.mockResolvedValueOnce({ promoted: true, created: true, projectId: 'p1', titleSource: 'description', selectedCallResolution: 'callCode' });
    const tally = newTally();
    await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: true }, { confirm: true }, tally);
    expect(tally.promoted).toBe(1);
  });

  it('counts syncedCall on created=false synced=true', async () => {
    ensureMock.mockResolvedValueOnce({ promoted: true, created: false, synced: true, projectId: 'p1' });
    const tally = newTally();
    await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: true }, { confirm: true }, tally);
    expect(tally.syncedCall).toBe(1);
  });

  it('flips failed=true on thrown helper error', async () => {
    ensureMock.mockRejectedValueOnce(new Error('boom'));
    const tally = newTally();
    const failed = await processRow({ id: 's', user_id: 'u', selected_call_id: 'c', user_exists: true }, { confirm: true }, tally);
    expect(tally.failed).toBe(1);
    expect(failed).toBe(true);
  });
});
