import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerSearchCalls } from './search-calls'
import { registerGetCallBlueprint } from './get-call-blueprint'
import { registerGetApplicationState } from './get-application-state'

export function createReadServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-read', '1.0.0')
  registerSearchCalls(server, ctx)
  registerGetCallBlueprint(server, ctx)
  registerGetApplicationState(server, ctx)
  // More tools will be registered here in later tasks
  return server
}
