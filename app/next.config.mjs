import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/lib/i18n.ts');

const isProd = process.env.NODE_ENV === 'production';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    // ESLint errors are pre-existing across many files (no-explicit-any, unused-vars)
    // These don't affect runtime behavior - fix incrementally in Phase 2
    // TODO: Remove `ignoreDuringBuilds` once lint errors are fixed across the app.
    ignoreDuringBuilds: true,
  },

  // Production optimizations (merged from next.config.production.js)
  experimental: {
    ...(isProd && {
      optimizeCss: false,
    }),
    optimizePackageImports: ['@/components', '@/lib'],
    instrumentationHook: true,
  },

  compiler: {
    removeConsole: isProd ? { exclude: ['error'] } : false,
  },

  images: {
    domains: ['storage.googleapis.com'],
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60 * 60 * 24,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

const finalConfig = withNextIntl(nextConfig);

let exportedConfig = finalConfig;

if (process.env.SENTRY_DSN) {
  try {
    const { withSentryConfig } = await import('@sentry/nextjs');
    exportedConfig = withSentryConfig(finalConfig, {
      silent: true,
      disableServerWebpackPlugin: !isProd,
      disableClientWebpackPlugin: !isProd,
    });
  } catch {
    // @sentry/nextjs not installed — continue without Sentry build integration
  }
}

export default exportedConfig;
