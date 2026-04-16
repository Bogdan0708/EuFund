// ── Write MCP Server ───────────────────────────────────────────────────────
// Creates the eufunds-write MCP server and registers all 10 write tools.
// All write tools follow the 5-step write contract:
//   1. Verify ownership
//   2. Enforce expectedStateVersion (ConcurrencyError on mismatch)
//   3. Persist mutation (within transaction where applicable)
//   4. Emit audit log (logAudit)
//   5. Return canonical result with newStateVersion

import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerSaveSectionDraft } from './save-section-draft'
import { registerApproveRevision } from './approve-revision'
import { registerRollbackSection } from './rollback-section'
import { registerSaveCallBlueprint } from './save-call-blueprint'
import { registerSetApplicationStatus } from './set-application-status'
import { registerCreateExportSnapshot } from './create-export-snapshot'
import { registerSetSelectedCall } from './set-selected-call'
import { registerFreezeOutline } from './freeze-outline'
import { registerMarkSectionStale } from './mark-section-stale'
import { registerRejectSection } from './reject-section'

export function createWriteServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-write', '1.0.0')
  registerSaveSectionDraft(server, ctx)
  registerApproveRevision(server, ctx)
  registerRollbackSection(server, ctx)
  registerSaveCallBlueprint(server, ctx)
  registerSetApplicationStatus(server, ctx)
  registerCreateExportSnapshot(server, ctx)
  registerSetSelectedCall(server, ctx)
  registerFreezeOutline(server, ctx)
  registerMarkSectionStale(server, ctx)
  registerRejectSection(server, ctx)
  return server
}
