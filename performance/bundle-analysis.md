# Bundle Optimization Guide - EU Funds Platform

## Target: <2s page load for Romanian users

### Next.js Optimizations Applied

1. **Standalone Output** - `output: 'standalone'` in next.config.js reduces Docker image size
2. **Image Optimization** - Next/Image with WebP, lazy loading, responsive sizes
3. **Code Splitting** - Automatic per-route splitting by Next.js
4. **Tree Shaking** - Ensure ES modules for all dependencies

### i18n Bundle Optimization

```js
// next-intl - load only active locale
// Romanian (~15KB) and English (~12KB) loaded on demand
// Do NOT import both locales in a single bundle
```

### Recommended next.config.js additions

```js
module.exports = {
  output: 'standalone',
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,

  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 86400,
  },

  experimental: {
    optimizePackageImports: ['@tanstack/react-query', 'zod'],
  },

  headers: async () => [{
    source: '/_next/static/:path*',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
  }],
};
```

### Analysis Commands

```bash
# Build with bundle analysis
ANALYZE=true npm run build

# Check bundle sizes
npx @next/bundle-analyzer

# Visualize dependencies
npx source-map-explorer .next/static/**/*.js
```

### Performance Budget

| Asset | Target | Current |
|-------|--------|---------|
| First Load JS | <100KB | TBD |
| Largest Contentful Paint | <2.0s | TBD |
| Total Blocking Time | <200ms | TBD |
| Cumulative Layout Shift | <0.1 | TBD |

### CDN Strategy for Romania

- CloudFront edge: London (eu-west-2) - primary
- Static assets: 1-year cache with immutable hash
- API: no-cache, pass-through to origin
- Images: WebP with Romanian-language alt text for SEO
