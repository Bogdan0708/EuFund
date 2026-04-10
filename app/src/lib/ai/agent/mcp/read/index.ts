import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerSearchCalls } from './search-calls'
import { registerGetCallBlueprint } from './get-call-blueprint'

export function createReadServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-read', '1.0.0')
  registerSearchCalls(server, ctx)
  registerGetCallBlueprint(server, ctx)
  // More tools will be registered here in later tasks
  return server
}
