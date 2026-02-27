let initAttempted = false;

async function importSentryOptional() {
  return import('@sentry/nextjs') as Promise<{
    init: (config: Record<string, unknown>) => void;
    captureException: (error: unknown, context?: Record<string, unknown>) => void;
  }>;
}

export async function initSentryIfConfigured(): Promise<void> {
  if (initAttempted || !process.env.SENTRY_DSN) return;
  initAttempted = true;

  try {
    const release = process.env.APP_VERSION
      || process.env.GITHUB_SHA
      || process.env.VERCEL_GIT_COMMIT_SHA
      || undefined;
    const Sentry = await importSentryOptional();
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      release,
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
      sendDefaultPii: false,
    });
  } catch (error) {
    console.warn('Sentry SDK not available; continuing without remote error capture', error);
  }
}

export async function captureException(error: unknown, context?: Record<string, unknown>): Promise<void> {
  try {
    await initSentryIfConfigured();
    const Sentry = await importSentryOptional();
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch (captureError) {
    console.error('Failed to report exception to Sentry', {
      captureError,
      originalError: error,
      context,
    });
  }
}
