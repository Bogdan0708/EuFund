// ── MCP Tool Error Wrapping ──────────────────────────────────────────────
// Converts ServiceError exceptions into MCP tool results with isError: true.
// Without this, thrown errors propagate through transport.handleRequest() and
// return transport-level HTTP failures — a protocol-visible regression vs the
// expected tools/call response shape.

import {
  ServiceError,
  NotFoundError,
  AuthorizationError,
  ConcurrencyError,
  ValidationError,
  ExternalDependencyError,
} from '../services/errors'

/**
 * MCP error tool result — the shape returned when a service throws a
 * ServiceError. Intentionally minimal: no `structuredContent` or other
 * optional fields that would widen the return type and conflict with
 * well-typed handler overloads.
 */
type McpErrorResult = {
  content: { type: 'text'; text: string }[]
  isError: true
}

/**
 * Wraps an MCP tool handler so that any ServiceError thrown by the service
 * is converted into a well-formed MCP tool result with `isError: true`.
 *
 * Non-ServiceError exceptions propagate unchanged — they indicate bugs or
 * transport-level failures that should surface to the MCP client as errors.
 *
 * The return type is generic so the wrapper preserves the handler's exact
 * success shape (e.g. with or without `structuredContent`).
 */
export function withMcpErrorMapping<TArgs, TResult>(
  handler: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult | McpErrorResult> {
  return async (args: TArgs) => {
    try {
      return await handler(args)
    } catch (err) {
      if (err instanceof ServiceError) {
        return serviceErrorToToolResult(err)
      }
      throw err
    }
  }
}

function serviceErrorToToolResult(err: ServiceError): McpErrorResult {
  const payload: Record<string, unknown> = {
    error: err.message,
    code: err.code,
  }

  if (err instanceof NotFoundError) {
    payload.resourceType = err.resourceType
    payload.resourceId = err.resourceId
  } else if (err instanceof ConcurrencyError) {
    payload.expected = err.expected
    payload.actual = err.actual
  } else if (err instanceof ValidationError) {
    payload.field = err.field
  } else if (err instanceof ExternalDependencyError) {
    payload.service = err.service
    payload.retryable = err.retryable
  } else if (err instanceof AuthorizationError) {
    // No extra fields
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
  }
}
