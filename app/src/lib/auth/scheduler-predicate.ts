/**
 * Edge-safe scheduler request predicate.
 *
 * This module intentionally has NO imports so it is safe to use in
 * Next.js middleware (Edge runtime). `scheduler.ts` re-exports this
 * function so route handlers can import it from one place.
 */

/**
 * Pure predicate: returns true when the request looks like a Cloud Scheduler
 * OIDC call to the discovery endpoint.
 *
 * Exported from both this file (Edge-safe) and `scheduler.ts` (Node.js)
 * so middleware and the route handler share the same logic without drifting.
 */
export function isSchedulerBearerRequest(
  pathname: string,
  method: string,
  authorizationHeader: string | null,
): boolean {
  return (
    pathname === '/api/v1/admin/discovery/run' &&
    method === 'POST' &&
    (authorizationHeader?.startsWith('Bearer ') ?? false)
  );
}
