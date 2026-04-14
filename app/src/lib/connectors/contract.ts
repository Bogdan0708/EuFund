import type { ExtractionData } from './normalize';

export interface ConnectorMeta {
  fetchedAt: string;
  responseStatus: number;
  contentHash: string;
  structureValid: boolean;
  callsFound: number;
  durationMs: number;
}

export interface ConnectorResult {
  source: string;
  calls: ExtractionData[];
  meta: ConnectorMeta;
  errors: string[];
}

export interface StructureCheck {
  selector: string;
  description: string;
  required: boolean;
}
