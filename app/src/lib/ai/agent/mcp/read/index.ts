import { createMcpDomain } from '../server'
import type { ServiceContext } from '../../services/types'
import { registerSearchCalls } from './search-calls'

export function createReadServer(ctx: ServiceContext) {
  const server = createMcpDomain('eufunds-read', '1.0.0')
  registerSearchCalls(server, ctx)
  // More tools will be registered here in later tasks
  return server
}
