import { InferSelectModel } from 'drizzle-orm';
import { sourceConnectors } from '@/lib/db/schema';

export type SourceConnector = InferSelectModel<typeof sourceConnectors>;

export interface SyncOptions {
  dryRun?: boolean;
  fullSync?: boolean;
  userId?: string;
}

export interface SyncResult {
  runId: string;
  itemsDiscovered: number;
  itemsChanged: number;
  status: 'success' | 'failed' | 'partial';
  error?: string;
}

export type ConnectorSyncFn = (
  connector: SourceConnector,
  options?: SyncOptions
) => Promise<SyncResult>;
