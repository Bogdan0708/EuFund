// ─── ANAF (Agenția Națională de Administrare Fiscală) Client ────
// Tax compliance verification

import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { withCache } from '../common/cache';

const ANAF_API = 'https://webservicesp.anaf.ro/AsynchWebService/api/v8/ws/tva';
const RATE_KEY = 'anaf';
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h

export interface ANAFTaxData {
  cui: number;
  name: string;
  address: string;
  county: string;
  isVatPayer: boolean;
  vatRegistrationDate?: string;
  vatDeregistrationDate?: string;
  isSplitVat: boolean;
  isInactive: boolean;
  isReactivated: boolean;
  registrationStatus: string;
  statusDate: string;
}

/**
 * Check tax compliance status for a Romanian company
 */
export async function checkTaxCompliance(cui: string | number): Promise<ANAFTaxData | null> {
  const cuiNum = typeof cui === 'string' ? parseInt(cui.replace(/^RO/i, ''), 10) : cui;
  if (isNaN(cuiNum)) throw new Error(`CUI invalid: ${cui}`);

  return withCache(`anaf:tax:${cuiNum}`, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        const response = await fetch(ANAF_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{
            cui: cuiNum,
            data: new Date().toISOString().split('T')[0],
          }]),
        });

        if (!response.ok) {
          throw new Error(`ANAF API error: ${response.status}`);
        }

        const data = await response.json();
        const found = data?.found?.[0];
        if (!found) return null;

        const gen = found.date_generale ?? {};
        const inregTVA = found.inregistrare_scop_Tva ?? {};

        return {
          cui: cuiNum,
          name: gen.denumire ?? '',
          address: gen.adresa ?? '',
          county: gen.judet ?? '',
          isVatPayer: !!inregTVA.scpTVA,
          vatRegistrationDate: inregTVA.data_inregistrare_scpTVA ?? undefined,
          vatDeregistrationDate: inregTVA.data_anulare_scpTVA ?? undefined,
          isSplitVat: !!found.inregistrare_RTVAI?.statusRTVAI,
          isInactive: !!gen.statusInactivi,
          isReactivated: !!gen.dataRepicare,
          registrationStatus: gen.stare_inregistrare ?? '',
          statusDate: gen.data_stare_inregistrare ?? '',
        };
      }, { maxRequests: 5, windowMs: 60_000 }),
    ),
  );
}

/**
 * Verify a company meets tax compliance requirements for EU funding
 */
export function verifyTaxEligibility(taxData: ANAFTaxData): {
  eligible: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (taxData.isInactive) {
    issues.push('Compania este declarată inactivă fiscal de ANAF');
  }

  if (taxData.registrationStatus !== 'INREGISTRAT') {
    issues.push(`Status înregistrare: ${taxData.registrationStatus} (necesar: INREGISTRAT)`);
  }

  // Split VAT companies may have issues with reimbursement
  if (taxData.isSplitVat) {
    issues.push('Compania aplică plata defalcată a TVA — verificați impactul asupra rambursării');
  }

  return { eligible: issues.length === 0, issues };
}
