import { describe, it, expect } from 'vitest'
import {
  ServiceError,
  NotFoundError,
  AuthorizationError,
  ConcurrencyError,
  ValidationError,
  ExternalDependencyError,
} from '@/lib/ai/agent/services/errors'

// ── ServiceError (abstract base) ───────────────────────────────────────────

describe('ServiceError (abstract base)', () => {
  it('all concrete error classes are instanceof ServiceError', () => {
    expect(new NotFoundError('Session', 'abc-123')).toBeInstanceOf(ServiceError)
    expect(new AuthorizationError()).toBeInstanceOf(ServiceError)
    expect(new ConcurrencyError(1, 2)).toBeInstanceOf(ServiceError)
    expect(new ValidationError('field', 'bad value')).toBeInstanceOf(ServiceError)
    expect(new ExternalDependencyError('Qdrant', 'timeout')).toBeInstanceOf(ServiceError)
  })

  it('all concrete error classes are instanceof Error', () => {
    expect(new NotFoundError('Session', 'abc-123')).toBeInstanceOf(Error)
    expect(new AuthorizationError()).toBeInstanceOf(Error)
    expect(new ConcurrencyError(1, 2)).toBeInstanceOf(Error)
    expect(new ValidationError('field', 'bad value')).toBeInstanceOf(Error)
    expect(new ExternalDependencyError('Qdrant', 'timeout')).toBeInstanceOf(Error)
  })
})

// ── NotFoundError ──────────────────────────────────────────────────────────

describe('NotFoundError', () => {
  const err = new NotFoundError('AgentSession', 'sess-uuid-001')

  it('has code NOT_FOUND', () => {
    expect(err.code).toBe('NOT_FOUND')
  })

  it('has httpStatus 404', () => {
    expect(err.httpStatus).toBe(404)
  })

  it('stores resourceType', () => {
    expect(err.resourceType).toBe('AgentSession')
  })

  it('stores resourceId', () => {
    expect(err.resourceId).toBe('sess-uuid-001')
  })

  it('message contains resourceType and resourceId', () => {
    expect(err.message).toContain('AgentSession')
    expect(err.message).toContain('sess-uuid-001')
  })

  it('name is NotFoundError', () => {
    expect(err.name).toBe('NotFoundError')
  })

  it('is instanceof NotFoundError', () => {
    expect(err).toBeInstanceOf(NotFoundError)
  })

  it('is instanceof ServiceError', () => {
    expect(err).toBeInstanceOf(ServiceError)
  })

  it('works with different resource types', () => {
    const sectionErr = new NotFoundError('Section', 'section-xyz')
    expect(sectionErr.resourceType).toBe('Section')
    expect(sectionErr.resourceId).toBe('section-xyz')
    expect(sectionErr.code).toBe('NOT_FOUND')
    expect(sectionErr.httpStatus).toBe(404)
  })
})

// ── AuthorizationError ─────────────────────────────────────────────────────

describe('AuthorizationError', () => {
  it('has code AUTHORIZATION', () => {
    expect(new AuthorizationError().code).toBe('AUTHORIZATION')
  })

  it('has httpStatus 403', () => {
    expect(new AuthorizationError().httpStatus).toBe(403)
  })

  it('uses default message when no message provided', () => {
    expect(new AuthorizationError().message).toBe('Insufficient permissions')
  })

  it('uses custom message when provided', () => {
    const err = new AuthorizationError('Only org admins can perform this action')
    expect(err.message).toBe('Only org admins can perform this action')
  })

  it('name is AuthorizationError', () => {
    expect(new AuthorizationError().name).toBe('AuthorizationError')
  })

  it('is instanceof AuthorizationError', () => {
    expect(new AuthorizationError()).toBeInstanceOf(AuthorizationError)
  })

  it('is instanceof ServiceError', () => {
    expect(new AuthorizationError()).toBeInstanceOf(ServiceError)
  })
})

// ── ConcurrencyError ───────────────────────────────────────────────────────

describe('ConcurrencyError', () => {
  const err = new ConcurrencyError(5, 3)

  it('has code CONCURRENCY', () => {
    expect(err.code).toBe('CONCURRENCY')
  })

  it('has httpStatus 409', () => {
    expect(err.httpStatus).toBe(409)
  })

  it('stores expected version', () => {
    expect(err.expected).toBe(5)
  })

  it('stores actual version', () => {
    expect(err.actual).toBe(3)
  })

  it('message contains expected and actual', () => {
    expect(err.message).toContain('5')
    expect(err.message).toContain('3')
  })

  it('name is ConcurrencyError', () => {
    expect(err.name).toBe('ConcurrencyError')
  })

  it('is instanceof ConcurrencyError', () => {
    expect(err).toBeInstanceOf(ConcurrencyError)
  })

  it('is instanceof ServiceError', () => {
    expect(err).toBeInstanceOf(ServiceError)
  })

  it('works with version 0 vs 1', () => {
    const zeroErr = new ConcurrencyError(0, 1)
    expect(zeroErr.expected).toBe(0)
    expect(zeroErr.actual).toBe(1)
  })
})

// ── ValidationError ────────────────────────────────────────────────────────

describe('ValidationError', () => {
  const err = new ValidationError('sessionId', 'sessionId is required for this operation')

  it('has code VALIDATION', () => {
    expect(err.code).toBe('VALIDATION')
  })

  it('has httpStatus 400', () => {
    expect(err.httpStatus).toBe(400)
  })

  it('stores field name', () => {
    expect(err.field).toBe('sessionId')
  })

  it('stores message', () => {
    expect(err.message).toBe('sessionId is required for this operation')
  })

  it('name is ValidationError', () => {
    expect(err.name).toBe('ValidationError')
  })

  it('is instanceof ValidationError', () => {
    expect(err).toBeInstanceOf(ValidationError)
  })

  it('is instanceof ServiceError', () => {
    expect(err).toBeInstanceOf(ServiceError)
  })

  it('works with different fields', () => {
    const projErr = new ValidationError('projectId', 'projectId must be a valid UUID')
    expect(projErr.field).toBe('projectId')
    expect(projErr.message).toBe('projectId must be a valid UUID')
    expect(projErr.code).toBe('VALIDATION')
    expect(projErr.httpStatus).toBe(400)
  })
})

// ── ExternalDependencyError ────────────────────────────────────────────────

describe('ExternalDependencyError', () => {
  const err = new ExternalDependencyError('Qdrant', 'Connection timed out after 30s')

  it('has code EXTERNAL_DEPENDENCY', () => {
    expect(err.code).toBe('EXTERNAL_DEPENDENCY')
  })

  it('has httpStatus 502', () => {
    expect(err.httpStatus).toBe(502)
  })

  it('stores service name', () => {
    expect(err.service).toBe('Qdrant')
  })

  it('stores message', () => {
    expect(err.message).toBe('Connection timed out after 30s')
  })

  it('defaults retryable to true', () => {
    expect(err.retryable).toBe(true)
  })

  it('accepts retryable=false', () => {
    const nonRetryable = new ExternalDependencyError('ONRC', 'API key invalid', false)
    expect(nonRetryable.retryable).toBe(false)
  })

  it('accepts retryable=true explicitly', () => {
    const retryable = new ExternalDependencyError('Perplexity', 'rate limited', true)
    expect(retryable.retryable).toBe(true)
  })

  it('name is ExternalDependencyError', () => {
    expect(err.name).toBe('ExternalDependencyError')
  })

  it('is instanceof ExternalDependencyError', () => {
    expect(err).toBeInstanceOf(ExternalDependencyError)
  })

  it('is instanceof ServiceError', () => {
    expect(err).toBeInstanceOf(ServiceError)
  })

  it('works with different services', () => {
    const notebookErr = new ExternalDependencyError('NotebookLM', 'session expired', false)
    expect(notebookErr.service).toBe('NotebookLM')
    expect(notebookErr.retryable).toBe(false)
    expect(notebookErr.code).toBe('EXTERNAL_DEPENDENCY')
    expect(notebookErr.httpStatus).toBe(502)
  })
})

// ── Cross-class discrimination ─────────────────────────────────────────────

describe('Error discrimination', () => {
  const errors: ServiceError[] = [
    new NotFoundError('X', 'y'),
    new AuthorizationError(),
    new ConcurrencyError(1, 2),
    new ValidationError('f', 'msg'),
    new ExternalDependencyError('svc', 'err'),
  ]

  it('each error has a unique code', () => {
    const codes = errors.map(e => e.code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(errors.length)
  })

  it('correct codes are assigned', () => {
    expect(errors.map(e => e.code)).toEqual([
      'NOT_FOUND',
      'AUTHORIZATION',
      'CONCURRENCY',
      'VALIDATION',
      'EXTERNAL_DEPENDENCY',
    ])
  })

  it('correct httpStatus values are assigned', () => {
    expect(errors.map(e => e.httpStatus)).toEqual([404, 403, 409, 400, 502])
  })

  it('can switch on code', () => {
    const results: string[] = []
    for (const e of errors) {
      switch (e.code) {
        case 'NOT_FOUND': results.push('not-found'); break
        case 'AUTHORIZATION': results.push('auth'); break
        case 'CONCURRENCY': results.push('concurrency'); break
        case 'VALIDATION': results.push('validation'); break
        case 'EXTERNAL_DEPENDENCY': results.push('external'); break
      }
    }
    expect(results).toEqual(['not-found', 'auth', 'concurrency', 'validation', 'external'])
  })
})
