// ─── API Credential Management ──────────────────────────────────
// Secure credential storage and rotation

export interface ApiCredential {
  provider: string;
  apiKey?: string;
  apiSecret?: string;
  baseUrl: string;
  environment: 'production' | 'sandbox' | 'test';
  expiresAt?: Date;
  rotatedAt?: Date;
}

function getEnvCredential(provider: string): ApiCredential | null {
  const prefix = provider.toUpperCase().replace(/-/g, '_');
  const apiKey = process.env[`${prefix}_API_KEY`];
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  const rawEnvironment = process.env[`${prefix}_ENV`];
  const environment: ApiCredential['environment'] =
    rawEnvironment === 'sandbox' || rawEnvironment === 'test' ? rawEnvironment : 'production';

  if (!baseUrl) return null;

  return {
    provider,
    apiKey: apiKey ?? undefined,
    apiSecret: process.env[`${prefix}_API_SECRET`] ?? undefined,
    baseUrl,
    environment,
  };
}

const credentialCache = new Map<string, ApiCredential>();

export function getCredential(provider: string): ApiCredential {
  const cached = credentialCache.get(provider);
  if (cached) return cached;

  const envCred = getEnvCredential(provider);
  if (envCred) {
    credentialCache.set(provider, envCred);
    return envCred;
  }

  throw new Error(`No credentials configured for provider: ${provider}`);
}

export function isCredentialValid(cred: ApiCredential): boolean {
  if (cred.expiresAt && new Date() > cred.expiresAt) return false;
  return true;
}

// Provider-specific defaults
export const PROVIDER_DEFAULTS: Record<string, Partial<ApiCredential>> = {
  eurlex: {
    baseUrl: 'https://eur-lex.europa.eu',
    environment: 'production',
  },
  onrc: {
    baseUrl: 'https://portal.onrc.ro/api',
    environment: 'production',
  },
  anaf: {
    baseUrl: 'https://webservicesp.anaf.ro',
    environment: 'production',
  },
  'ec-portal': {
    baseUrl: 'https://api.tech.ec.europa.eu/search-api/prod/rest',
    environment: 'production',
  },
  certsign: {
    baseUrl: 'https://api.certsign.ro',
    environment: 'sandbox',
  },
  mysmis: {
    baseUrl: 'https://mysmis2021.gov.ro/api',
    environment: 'production',
  },
};
