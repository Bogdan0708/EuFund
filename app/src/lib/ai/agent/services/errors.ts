// ── Service Error Taxonomy ──────────────────────────────────────────────────
// All domain service errors extend ServiceError so callers can do a single
// `instanceof ServiceError` guard, then branch on `code` or specific class.

export abstract class ServiceError extends Error {
  abstract readonly code: string
  abstract readonly httpStatus: number
}

// ── 404 Not Found ──────────────────────────────────────────────────────────

export class NotFoundError extends ServiceError {
  readonly code = 'NOT_FOUND' as const
  readonly httpStatus = 404 as const
  readonly resourceType: string
  readonly resourceId: string

  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} not found: ${resourceId}`)
    this.name = this.constructor.name
    this.resourceType = resourceType
    this.resourceId = resourceId
  }
}

// ── 403 Authorization ──────────────────────────────────────────────────────

export class AuthorizationError extends ServiceError {
  readonly code = 'AUTHORIZATION' as const
  readonly httpStatus = 403 as const

  constructor(message = 'Insufficient permissions') {
    super(message)
    this.name = this.constructor.name
  }
}

// ── 409 Concurrency ────────────────────────────────────────────────────────

export class ConcurrencyError extends ServiceError {
  readonly code = 'CONCURRENCY' as const
  readonly httpStatus = 409 as const
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number) {
    super(`Concurrency conflict: expected version ${expected}, got ${actual}`)
    this.name = this.constructor.name
    this.expected = expected
    this.actual = actual
  }
}

// ── 400 Validation ─────────────────────────────────────────────────────────

export class ValidationError extends ServiceError {
  readonly code = 'VALIDATION' as const
  readonly httpStatus = 400 as const
  readonly field: string
  readonly policyCode?: string

  constructor(field: string, message: string, policyCode?: string) {
    super(message)
    this.name = this.constructor.name
    this.field = field
    this.policyCode = policyCode
  }
}

// ── 502 External Dependency ────────────────────────────────────────────────

export class ExternalDependencyError extends ServiceError {
  readonly code = 'EXTERNAL_DEPENDENCY' as const
  readonly httpStatus = 502 as const
  readonly service: string
  readonly retryable: boolean

  constructor(service: string, message: string, retryable = true) {
    super(message)
    this.name = this.constructor.name
    this.service = service
    this.retryable = retryable
  }
}
