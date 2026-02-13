/**
 * Security Headers Middleware for Next.js
 * Implements OWASP recommended security headers
 * Target: A+ SSL Labs rating, GDPR Article 32 compliance
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    'https://api.certsign.ro',
    'https://api.onrc.ro',
    'https://api.anaf.ro',
    'https://mysmis2021.gov.ro',
  ],
  'frame-ancestors': ["'self'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
};

function buildCSP(): string {
  return Object.entries(CSP_DIRECTIVES)
    .map(([key, values]) => `${key} ${values.join(' ')}`.trim())
    .join('; ');
}

export function applySecurityHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  // HSTS - 2 years with preload
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=63072000; includeSubDomains; preload'
  );

  // Prevent MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Clickjacking protection
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');

  // XSS Protection (disabled - CSP is better)
  response.headers.set('X-XSS-Protection', '0');

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy - restrict sensitive APIs
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );

  // Content Security Policy
  response.headers.set('Content-Security-Policy', buildCSP());

  // Prevent caching of sensitive pages
  if (
    request.nextUrl.pathname.startsWith('/api/') ||
    request.nextUrl.pathname.startsWith('/dashboard')
  ) {
    response.headers.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
  }

  // Remove server identification
  response.headers.delete('X-Powered-By');
  response.headers.delete('Server');

  return response;
}

/**
 * CORS configuration for API routes
 */
export const CORS_CONFIG = {
  allowedOrigins: [
    'https://funduri-ue.example.ro',
    process.env.NEXTAUTH_URL || '',
  ].filter(Boolean),
  allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400,
};
