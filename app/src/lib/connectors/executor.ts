import { getConnectorSync } from './registry';
import { db } from '@/lib/db';
import { sourceConnectors } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { acquireConnectorLock, releaseConnectorLock } from './lock';
import { SyncOptions } from './types';

const log = logger.child({ component: 'connector-executor' });

export async function executeSync(slug: string, options: SyncOptions = {}) {
  const connector = await db.query.sourceConnectors.findFirst({
    where: eq(sourceConnectors.slug, slug),
  });

  if (!connector) {
    log.error({ slug }, 'Connector not found for execution');
    return;
  }

  if (!connector.isActive) {
    log.warn({ slug }, 'Cannot sync inactive connector');
    return;
  }

  const syncFn = getConnectorSync(slug);
  if (!syncFn) {
    log.error({ slug }, 'No sync implementation found for connector');
    return;
  }

  const locked = await acquireConnectorLock(slug);
  if (!locked) {
    log.warn({ slug }, 'Sync already in progress, skipping');
    return;
  }

  try {
    log.info({ slug }, 'Starting background sync execution');
    const result = await syncFn(connector, options);
    
    // Update last run timestamp
    await db.update(sourceConnectors)
      .set({ lastRunAt: new Date() })
      .where(eq(sourceConnectors.id, connector.id));

    log.info({ slug, result }, 'Sync execution completed');
  } catch (error) {
    log.error({ slug, error }, 'Sync execution failed');
  } finally {
    await releaseConnectorLock(slug);
  }
}
