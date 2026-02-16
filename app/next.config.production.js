/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production optimizations
  output: 'standalone',
  
  // Enable experimental features for better performance
  experimental: {
    optimizeCss: true,
    optimizePackageImports: ['@/components', '@/lib'],
  },

  // Compiler optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error'],
    } : false,
  },

  // Image optimization
  images: {
    domains: ['storage.googleapis.com'],
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60 * 60 * 24, // 24 hours
  },

  // Headers for security and caching
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      {
        source: '/api/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // Redirects for SEO
  async redirects() {
    return [
      {
        source: '/en',
        destination: '/ro',
        permanent: false,
      },
      {
        source: '/',
        destination: '/ro',
        permanent: false,
      },
    ];
  },

  // Environment variables for build
  env: {
    CUSTOM_KEY: process.env.CUSTOM_KEY,
  },

  // Bundle analyzer (disable in production)
  ...(process.env.ANALYZE === 'true' && {
    experimental: {
      bundlePagesRouterDependencies: true,
    },
  }),
};

// Webpack configuration for production
nextConfig.webpack = (config, { isServer }) => {
  // Optimize bundle size
  if (!isServer) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };
  }

  // Add source map configuration for production debugging
  if (process.env.NODE_ENV === 'production') {
    config.devtool = 'source-map';
  }

  return config;
};

module.exports = nextConfig;