import { describe, it, expect } from 'vitest';
import { Errors, FondEUError, withRetry, CircuitBreaker } from '@/lib/errors';

describe('Error Framework', () => {
  it('creates validation error with correct status', () => {
    const err = Errors.validation('title', 'Câmpul este obligatoriu', 'Field is required');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.field).toBe('title');
  });

  it('generates response in Romanian', () => {
    const err = Errors.notFound('project', '123');
    const res = err.toResponse('ro');
    expect(res.success).toBe(false);
    expect(res.error.message).toContain('nu a fost găsită');
  });

  it('generates response in English', () => {
    const err = Errors.notFound('project', '123');
    const res = err.toResponse('en');
    expect(res.error.message).toContain('not found');
  });

  it('marks rate limit as retryable', () => {
    const err = Errors.rateLimited(5000);
    expect(err.retryable).toBe(true);
  });

  it('marks unauthorized as non-retryable', () => {
    const err = Errors.unauthorized();
    expect(err.retryable).toBe(false);
  });
});

describe('withRetry', () => {
  it('succeeds on first attempt', async () => {
    const result = await withRetry(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('retries on failure then succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('fail');
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 10 },
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts++;
          throw Errors.unauthorized();
        },
        { maxRetries: 3, baseDelayMs: 10 },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after threshold failures', async () => {
    const cb = new CircuitBreaker('test', 3, 100);
    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(async () => { throw new Error('fail'); });
      } catch {}
    }
    expect(cb.getState()).toBe('OPEN');
  });

  it('rejects calls when open', async () => {
    const cb = new CircuitBreaker('test', 1, 100000);
    try {
      await cb.execute(async () => { throw new Error('fail'); });
    } catch {}
    await expect(cb.execute(async () => 'ok')).rejects.toThrow();
  });
});
