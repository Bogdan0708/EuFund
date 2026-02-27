export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initSentryIfConfigured } = await import('@/lib/monitoring/sentry');
    await initSentryIfConfigured();
  }
}
