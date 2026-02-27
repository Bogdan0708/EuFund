/**
 * Sentry Configuration for EU Funds Platform
 * Error tracking and performance monitoring
 */

export const sentryConfig = {
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'development',
  release: process.env.APP_VERSION || '1.0.0',

  // Performance monitoring
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  profilesSampleRate: 0.1,

  // Session replay for debugging
  replaysSessionSampleRate: 0.01,
  replaysOnErrorSampleRate: 1.0,

  // Filter sensitive data
  beforeSend(event: any) {
    // Strip PII from error reports
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
    }

    // Don't send CNP (Romanian personal ID) in breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((b: any) => {
        if (b.message) {
          b.message = b.message.replace(/\b[1-8]\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\d{6}\b/g, '[CNP_REDACTED]');
        }
        return b;
      });
    }

    return event;
  },

  // Ignore common non-errors
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection',
    'AbortError',
    'NetworkError',
    'ChunkLoadError',
  ],

  // Tag transactions for Romanian government APIs
  beforeSendTransaction(event: any) {
    const url = event.transaction || '';
    if (url.includes('onrc') || url.includes('anaf') || url.includes('certsign') || url.includes('mysmis')) {
      event.tags = { ...event.tags, integration: 'romanian-gov' };
    }
    return event;
  },
};

/**
 * Initialize Sentry (call in instrumentation.ts)
 */
let initialized = false;

export async function initSentry() {
  if (initialized) return;

  if (!sentryConfig.dsn) {
    console.warn('Sentry DSN not configured - error tracking disabled');
    return;
  }

  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.init(sentryConfig as never);
    initialized = true;
    console.log('Sentry initialized:', sentryConfig.environment, sentryConfig.release);
  } catch (error) {
    console.warn('Sentry package unavailable - skipping initialization', error);
  }
}
