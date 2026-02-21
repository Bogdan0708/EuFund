import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'async_hooks';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required. Cannot start without database configuration.');
}

// Support Cloud SQL unix socket via DB_SOCKET_PATH env var
const socketPath = process.env.DB_SOCKET_PATH;

const client = socketPath
  ? postgres({
      host: socketPath,
      database: process.env.DB_NAME || 'fondeu',
      username: process.env.DB_USER || 'fondeu',
      password: process.env.DB_PASS || '',
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
    })
  : postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });

const baseDb = drizzle(client, { schema });

export type DrizzleDb = typeof baseDb;
export type DrizzleTransaction = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];

// ─── AsyncLocalStorage for user-scoped transactions ───────────────
interface UserScope {
  userId: string;
  tx: DrizzleTransaction;
}

const userScopeStorage = new AsyncLocalStorage<UserScope>();

// These symbols/props must never be intercepted — they are used by
// JS runtime internals (Promise detection, JSON.stringify, etc.).
const NEVER_INTERCEPT = new Set<string | symbol>([
  Symbol.toPrimitive,
  Symbol.toStringTag,
  Symbol.iterator,
  Symbol.asyncIterator,
  'then',   // Prevents false positive "thenable" detection
  'catch',
  'finally',
]);

// ─── Proxied Drizzle client ───────────────────────────────────────
/**
 * Proxied Drizzle client that transparently routes all queries through
 * the user-scoped transaction when inside withUserScope().
 *
 * Inside withUserScope(userId, fn), this client routes every operation
 * (select, insert, update, delete, query.X, execute, transaction) through
 * a single DB transaction that has `SET LOCAL "app.user_id" = userId`
 * active. This activates all RLS policies defined in rls.sql.
 *
 * When NOT inside withUserScope(), the client behaves as a normal
 * Drizzle client with no user context (RLS not activated).
 *
 * NOTE: `db.transaction()` within withUserScope() is routed to
 * tx.transaction(), which creates a PostgreSQL SAVEPOINT. The
 * SET LOCAL "app.user_id" set in the outer scope remains visible
 * inside savepoints (it is transaction-level, not savepoint-level).
 */
export const db: DrizzleDb = new Proxy(baseDb, {
  get(target, prop, receiver) {
    if (NEVER_INTERCEPT.has(prop)) {
      return Reflect.get(target, prop, receiver);
    }

    const scope = userScopeStorage.getStore();
    if (scope?.tx) {
      const val = (scope.tx as unknown as Record<string | symbol, unknown>)[prop];
      if (val !== undefined) {
        return typeof val === 'function'
          ? (val as (...args: unknown[]) => unknown).bind(scope.tx)
          : val;
      }
    }

    return Reflect.get(target, prop, receiver);
  },
});

// ─── withUserScope ────────────────────────────────────────────────
/**
 * Execute a callback within a database transaction that has RLS user
 * context activated. All `db` queries inside fn automatically run
 * through a single transaction with:
 *
 *   SELECT set_config('app.user_id', '<userId>', true)
 *
 * This activates the RLS policies in rls.sql that reference:
 *   current_setting('app.user_id', true)::uuid
 *
 * The `true` (LOCAL) flag makes the setting transaction-scoped, so it
 * is safe with connection poolers (PgBouncer). It persists through
 * savepoints created by nested db.transaction() calls inside fn.
 *
 * @example
 * const projects = await withUserScope(userId, async () => {
 *   return db.query.projects.findMany(); // RLS filters by org membership
 * });
 */
export async function withUserScope<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return baseDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return userScopeStorage.run({ userId, tx }, fn);
  });
}

/**
 * Get the current user ID if inside withUserScope(), or null.
 * Useful for services that need to know the RLS-active user without
 * requiring it to be passed as a parameter.
 */
export function getCurrentDbUserId(): string | null {
  return userScopeStorage.getStore()?.userId ?? null;
}

export type Database = typeof db;
export { schema };
