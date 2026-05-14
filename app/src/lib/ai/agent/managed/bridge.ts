// ─── Managed Structured Action Bridge ─────────────────────────────
// Maps frontend UI actions to deterministic service-layer mutations
// without requiring an LLM turn for intent classification.

import { logger } from '@/lib/logger'
import type { StructuredAction } from '../types'
import type { ServiceContext } from '../services/types'
import { executeManagedTool } from './executor'
import { trackManagedActionBridge } from '@/lib/monitoring/metrics'
import { randomUUID } from 'crypto'

const log = logger.child({ component: 'action-bridge' })

export type BridgeOutcome =
  | 'success'        // Mutation applied successfully
  | 'no_op'          // Preconditions met but no change needed (idempotent)
  | 'policy_error'   // Rejected by service-layer policy gate
  | 'concurrency'    // Stale expectedStateVersion
  | 'not_found'      // Session or resource missing
  | 'failed'         // Unexpected runtime error

export interface BridgeResult {
  outcome: BridgeOutcome
  errorCode?: string
  errorMessage?: string
  stateVersionBumped: boolean
  newStateVersion?: number
  // The tool result summary for the agent to "react" to
  summary?: string
  continueToManaged: boolean
}

const MUTATING_ACTIONS: ReadonlySet<StructuredAction['type']> = new Set([
  'select_call',
  'approve_outline',
  'accept_section',
  'reject_section',
  'mark_complete',
])

/**
 * Maps a frontend StructuredAction to a managed tool name and input.
 */
function planAction(
  action: StructuredAction,
  expectedStateVersion: number,
): { name: string; input: Record<string, unknown> } {
  switch (action.type) {
    case 'select_call':
      return {
        name: 'set_selected_call',
        input: { callId: action.callId, expectedStateVersion }
      }
    case 'approve_outline':
      return {
        name: 'freeze_outline',
        input: { expectedStateVersion }
      }
    case 'accept_section':
      return {
        name: 'approve_revision',
        input: { sectionKey: action.sectionKey, expectedStateVersion }
      }
    case 'regenerate_section':
      throw new BridgeUnsupportedActionError(
        'REGENERATE_ENDPOINT_REQUIRED',
        'Regeneration must use the deterministic /sections/generate endpoint.',
      )
    case 'reject_section':
      return {
        name: 'reject_section',
        input: { sectionKey: action.sectionKey, reason: action.reason, expectedStateVersion }
      }
    case 'mark_complete':
      return {
        name: 'set_application_status',
        input: { status: 'completed', expectedStateVersion }
      }
    case 'request_refresh':
      throw new BridgeReadOnlyActionError()

    default:
      action satisfies never
      throw new Error('Unknown action type')
  }
}

class BridgeReadOnlyActionError extends Error {
  constructor() {
    super('REQUEST_REFRESH')
  }
}

class BridgeUnsupportedActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function classifyToolError(msg: string): { outcome: BridgeOutcome; code: string } {
  if (msg.startsWith('CONCURRENCY:')) {
    return { outcome: 'concurrency', code: 'CONCURRENCY' }
  }

  const policyMatch = msg.match(/^(POLICY_[A-Z_]+):?/)
  if (policyMatch) {
    return { outcome: 'policy_error', code: policyMatch[1] }
  }

  if (msg.startsWith('NOT_FOUND:')) {
    return { outcome: 'not_found', code: 'NOT_FOUND' }
  }

  return { outcome: 'failed', code: 'UNKNOWN' }
}

function parseResultPayload(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/**
 * Executes a structured UI action by calling the appropriate service function.
 * This is called by the route handler BEFORE the agentic turn.
 */
export async function bridgeStructuredAction(
  ctx: ServiceContext,
  action: StructuredAction,
  expectedStateVersion: number,
): Promise<BridgeResult> {
  const start = Date.now()

  try {
    const { name, input } = planAction(action, expectedStateVersion)

    log.info({ actionType: action.type, toolName: name }, 'bridging structured action')

    const result = await executeManagedTool(
      { type: 'tool_use', id: `bridge_${randomUUID()}`, name, input },
      ctx
    )

    const duration = Date.now() - start

    if (result.isError) {
      const { outcome, code } = classifyToolError(result.content)

      trackManagedActionBridge(action.type, outcome, duration, code)
      return {
        outcome,
        errorMessage: result.content,
        stateVersionBumped: false,
        errorCode: code,
        continueToManaged: false,
      }
    }

    const payload = parseResultPayload(result.content)
    const nextVersion = typeof payload?.newStateVersion === 'number'
      ? payload.newStateVersion
      : undefined
    const stateVersionBumped =
      typeof nextVersion === 'number' && nextVersion > expectedStateVersion
    const actionMutates = MUTATING_ACTIONS.has(action.type)
    const outcome: BridgeOutcome = actionMutates && stateVersionBumped ? 'success' : 'no_op'

    trackManagedActionBridge(action.type, outcome, duration)

    return {
      outcome,
      summary: result.content,
      stateVersionBumped,
      newStateVersion: nextVersion,
      continueToManaged: false,
    }
  } catch (error) {
    const duration = Date.now() - start

    if (error instanceof BridgeReadOnlyActionError) {
      trackManagedActionBridge(action.type, 'no_op', duration)
      return {
        outcome: 'no_op',
        summary: 'request_refresh',
        stateVersionBumped: false,
        newStateVersion: expectedStateVersion,
        continueToManaged: false,
      }
    }

    if (error instanceof BridgeUnsupportedActionError) {
      trackManagedActionBridge(action.type, 'policy_error', duration, error.code)
      return {
        outcome: 'policy_error',
        errorCode: error.code,
        errorMessage: error.message,
        stateVersionBumped: false,
        continueToManaged: false,
      }
    }

    log.error({ actionType: action.type, error }, 'action bridge failed')
    trackManagedActionBridge(action.type, 'failed', duration, 'RUNTIME_ERROR')
    return {
      outcome: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown bridge error',
      stateVersionBumped: false,
      continueToManaged: false,
    }
  }
}
