import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema';

// Support Cloud SQL unix socket via DB_SOCKET_PATH env var
const socketPath = process.env.DB_SOCKET_PATH;

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required. Cannot start without database configuration.');
  }

  return socketPath
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
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    _db = drizzle(createClient(), { schema });
  }
  return _db;
}

// Lazy proxy — defers connection until first property access at runtime.
// This allows Next.js build to import this module without DATABASE_URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: ReturnType<typeof drizzle<typeof schema>> = new Proxy({} as any, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export { schema };

/**
 * Execute DB operations in a transaction-bound RLS context.
 * Ensures `app.current_user_id` is set on the same connection before tenant-scoped queries.
 */
export async function withUserRLS<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${userId}, true)`);
    return fn(tx);
  });
}
