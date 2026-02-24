// ─── CSP Violation Reporting Endpoint ───────────────────────────
// Receives and logs Content Security Policy violations for monitoring

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

interface CSPViolationReport {
  'csp-report': {
    'document-uri': string;
    'violated-directive': string;
    'effective-directive': string;
    'original-policy': string;
    'blocked-uri': string;
    'status-code': number;
    'referrer'?: string;
    'source-file'?: string;
    'line-number'?: number;
    'column-number'?: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const report: CSPViolationReport = await request.json();
    const violation = report['csp-report'];

    // Log the violation (in production, send to monitoring service like Sentry)
    console.warn('[CSP Violation]', {
      timestamp: new Date().toISOString(),
      documentUri: violation['document-uri'],
      violatedDirective: violation['violated-directive'],
      effectiveDirective: violation['effective-directive'],
      blockedUri: violation['blocked-uri'],
      sourceFile: violation['source-file'],
      lineNumber: violation['line-number'],
      columnNumber: violation['column-number'],
      referrer: violation['referrer'],
      statusCode: violation['status-code'],
      userAgent: request.headers.get('user-agent'),
      ip: request.ip ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    });

    // TODO: In production, integrate with monitoring service:
    // - Sentry: Sentry.captureMessage('CSP Violation', { extra: violation })
    // - Datadog: logger.warn('csp_violation', violation)
    // - Custom analytics endpoint

    // Return 204 No Content (CSP reporting doesn't expect a response body)
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error({ error: error }, '[CSP Report] Failed to process violation report:');
    // Still return 204 to avoid breaking the browser's reporting
    return new NextResponse(null, { status: 204 });
  }
}

// Also support the newer Reporting API format
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
