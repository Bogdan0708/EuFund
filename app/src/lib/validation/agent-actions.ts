// app/src/lib/validation/agent-actions.ts
//
// Zod schemas for /api/v1/agent-sessions/[id]/actions/* request bodies.
// Each schema represents the body of one POST endpoint. The path's session
// id is read from req.params and is NOT in these schemas.
//
// expectedStateVersion is required on every mutation for optimistic
// concurrency control (CAS at the service layer).

import { z } from 'zod';

export const runEligibilityBody = z.object({
  projectSummary: z.string().min(1).max(20_000).optional(),
  expectedStateVersion: z.number().int().nonnegative(),
});

export const freezeOutlineBody = z.object({
  expectedStateVersion: z.number().int().nonnegative(),
});

export const changeCallBody = z.object({
  newCallId: z.string().min(1).max(200),
  expectedStateVersion: z.number().int().nonnegative(),
});

// sectionKey caps match the agent_sections.section_key column (varchar(100));
// keeping the validator narrower than the DB prevents 23502/opaque errors.
export const acceptSectionBody = z.object({
  sectionKey: z.string().min(1).max(100),
  expectedStateVersion: z.number().int().nonnegative(),
});

export const rejectSectionBody = z.object({
  sectionKey: z.string().min(1).max(100),
  reason: z.string().min(1).max(2000),
  expectedStateVersion: z.number().int().nonnegative(),
});

export const rollbackSectionBody = z.object({
  sectionKey: z.string().min(1).max(100),
  targetVersion: z.number().int().nonnegative(),
  expectedStateVersion: z.number().int().nonnegative(),
});

// Export is a read-like operation that does not bump stateVersion. We
// accept (and ignore) `expectedStateVersion` so the generic
// `useAgent.runAction` helper, which auto-injects the current version
// for all action calls, does not trip strict-mode validation here.
export const exportBody = z.object({
  expectedStateVersion: z.number().int().nonnegative().optional(),
}).strict();

export type RunEligibilityBody = z.infer<typeof runEligibilityBody>;
export type FreezeOutlineBody = z.infer<typeof freezeOutlineBody>;
export type ChangeCallBody = z.infer<typeof changeCallBody>;
export type AcceptSectionBody = z.infer<typeof acceptSectionBody>;
export type RejectSectionBody = z.infer<typeof rejectSectionBody>;
export type RollbackSectionBody = z.infer<typeof rollbackSectionBody>;
export type ExportBody = z.infer<typeof exportBody>;
