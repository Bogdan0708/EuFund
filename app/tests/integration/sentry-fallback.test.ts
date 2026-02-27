import { describe, expect, it, vi } from 'vitest';

describe('Sentry fallback behavior', () => {
  it('does not throw when Sentry SDK is unavailable', async () => {
    vi.resetModules();
    vi.doMock('@/lib/logger', () => ({
      logger: {
        child: () => ({
          warn: vi.fn(),
          error: vi.fn(),
        }),
      },
    }));

    const { captureException } = await import('@/lib/monitoring/sentry');
    await expect(captureException(new Error('test-error'))).resolves.toBeUndefined();
  });
});
