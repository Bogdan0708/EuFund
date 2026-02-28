import { ConnectorSyncFn } from './types';
import { ecPortalSync } from './ec-portal-sync';
import { mipeSync } from './mipe-sync';
import { runCrawler } from './crawler-engine';
import { ROMANIAN_SOURCES } from './sources/config';

const registry = new Map<string, ConnectorSyncFn>();

// Register core connectors
registry.set('ec-portal', ecPortalSync);
registry.set('mipe-pnrr', mipeSync);

// Register dynamic crawler sources
for (const source of ROMANIAN_SOURCES) {
  registry.set(source.slug, async (connector) => {
    const result = await runCrawler(source, connector.id);
    return {
      runId: 'crawler-' + Date.now(),
      itemsDiscovered: result.discovered,
      itemsChanged: result.changed,
      status: 'success'
    };
  });
}

export function registerConnector(slug: string, syncFn: ConnectorSyncFn) {
  registry.set(slug, syncFn);
}

export function getConnectorSync(slug: string): ConnectorSyncFn | undefined {
  return registry.get(slug);
}

export function listRegisteredConnectors(): string[] {
  return Array.from(registry.keys());
}
