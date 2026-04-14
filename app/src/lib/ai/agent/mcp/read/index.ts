import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerSearchCalls } from './search-calls'
import { registerGetCallBlueprint } from './get-call-blueprint'
import { registerGetApplicationState } from './get-application-state'
import { registerRetrieveEvidence } from './retrieve-evidence'
import { registerGetProjectSummary } from './get-project-summary'
import { registerListUploadedDocuments } from './list-uploaded-documents'
import { registerListSections } from './list-sections'
import { registerGetSection } from './get-section'
import { registerGetValidationReport } from './get-validation-report'

export function createReadServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-read', '1.0.0')
  registerSearchCalls(server, ctx)
  registerGetCallBlueprint(server, ctx)
  registerGetApplicationState(server, ctx)
  registerRetrieveEvidence(server, ctx)
  registerGetProjectSummary(server, ctx)
  registerListUploadedDocuments(server, ctx)
  registerListSections(server, ctx)
  registerGetSection(server, ctx)
  registerGetValidationReport(server, ctx)
  return server
}
