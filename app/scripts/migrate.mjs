import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const socketPath = process.env.DB_SOCKET_PATH;
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

function createClient() {
  if (socketPath) {
    const parsedUrl = new URL(connectionString.replace(/@(?=\/)/, '@localhost'));

    return postgres({
      host: socketPath,
      database: parsedUrl.pathname.replace(/^\//, '') || process.env.DB_NAME || 'fondeu',
      username: decodeURIComponent(parsedUrl.username || process.env.DB_USER || 'fondeu'),
      password: decodeURIComponent(parsedUrl.password || process.env.DB_PASS || ''),
      max: 1,
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }

  return postgres(connectionString, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
}

const client = createClient();
const db = drizzle(client);

try {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations complete.');
  await client.end();
  process.exit(0);
} catch (error) {
  console.error('Migration failed:', error);
  await client.end({ timeout: 0 }).catch(() => {});
  process.exit(1);
}
