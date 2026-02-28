import { ConnectorSyncFn } from './types';
import { ecPortalSync } from './ec-portal-sync';
import { mipeSync } from './mipe-sync';

const registry = new Map<string, ConnectorSyncFn>();

// Register core connectors
registry.set('ec-portal', ecPortalSync);
registry.set('mipe-pnrr', mipeSync);

export function registerConnector(slug: string, syncFn: ConnectorSyncFn) {
  registry.set(slug, syncFn);
}

export function getConnectorSync(slug: string): ConnectorSyncFn | undefined {
  return registry.get(slug);
}

export function listRegisteredConnectors(): string[] {
  return Array.from(registry.keys());
}
