/**
 * Orchestrator type definitions — shared across the SSE stream manager,
 * agent runner, and any route handlers that surface events to the client.
 */

// ---------------------------------------------------------------------------
// SSE event payloads
// ---------------------------------------------------------------------------

export type SSEEventType =
  | 'step_start'
  | 'step_complete'
  | 'step_error'
  | 'agent_message'
  | 'tool_call'
  | 'tool_result'
  | 'orchestrator_done'
  | 'error'

export interface BaseSSEEvent {
  eventId: number
  type: SSEEventType
}

export interface StepStartEvent extends BaseSSEEvent {
  type: 'step_start'
  step: number
  label: string
}

export interface StepCompleteEvent extends BaseSSEEvent {
  type: 'step_complete'
  step: number
  summary?: string
}

export interface StepErrorEvent extends BaseSSEEvent {
  type: 'step_error'
  step: number
  error: string
}

export interface AgentMessageEvent extends BaseSSEEvent {
  type: 'agent_message'
  agent: string
  content: string
}

export interface ToolCallEvent extends BaseSSEEvent {
  type: 'tool_call'
  tool: string
  input: unknown
}

export interface ToolResultEvent extends BaseSSEEvent {
  type: 'tool_result'
  tool: string
  output: unknown
}

export interface OrchestratorDoneEvent extends BaseSSEEvent {
  type: 'orchestrator_done'
  result?: unknown
}

export interface ErrorEvent extends BaseSSEEvent {
  type: 'error'
  message: string
}

export type SSEEvent =
  | StepStartEvent
  | StepCompleteEvent
  | StepErrorEvent
  | AgentMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | OrchestratorDoneEvent
  | ErrorEvent

// ---------------------------------------------------------------------------
// SSE stream interface
// ---------------------------------------------------------------------------

export interface SSEStream {
  /** Send a typed SSE event to the client. */
  send(event: Omit<SSEEvent, 'eventId'>): void
  /** Terminate the SSE connection. */
  close(): void
}
