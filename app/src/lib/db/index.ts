import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
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

export const db = drizzle(client, { schema });
export type Database = typeof db;
export { schema };
