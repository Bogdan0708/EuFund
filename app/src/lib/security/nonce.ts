// ─── CSP Nonce Utilities ─────────────────────────────────────────
// Helper functions for working with CSP nonces in Next.js App Router

import { headers } from 'next/headers';

/**
 * Get the CSP nonce from request headers (server-side only)
 * Use this in Server Components and Server Actions
 * 
 * @returns The nonce string, or undefined if not available
 */
export async function getNonce(): Promise<string | undefined> {
  const headersList = await headers();
  return headersList.get('x-nonce') ?? undefined;
}

/**
 * Get nonce attribute string for inline scripts/styles
 * Returns empty string if no nonce is available
 * 
 * @example
 * ```tsx
 * <script nonce={await getNonceAttr()}>
 *   console.log('This script has a CSP nonce');
 * </script>
 * ```
 */
export async function getNonceAttr(): Promise<string> {
  const nonce = await getNonce();
  return nonce || '';
}

/**
 * Server-side only: Get nonce for use in HTML attributes
 * Synchronous version for use in middleware or edge functions
 */
export function getNonceSync(headersList: Headers): string | undefined {
  return headersList.get('x-nonce') ?? undefined;
}
