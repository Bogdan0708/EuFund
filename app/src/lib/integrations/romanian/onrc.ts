// ─── ONRC (Oficiul Național al Registrului Comerțului) Client ────
// Company registry validation and lookup

import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { withCache } from '../common/cache';
import { validateCUI, validateCAEN, normalizeDiacritics } from '@/lib/utils/romanian';

const RATE_KEY = 'onrc';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

// ONRC doesn't have a public REST API — we use the public RECOM endpoint
const RECOM_URL = 'https://portal.onrc.ro/ONRCPortalWeb/appmanager/myONRC/public';

export interface ONRCCompanyData {
  cui: string;
  name: string;
  registrationNumber: string; // J##/####/####
  legalForm: RomanianLegalEntity;
  status: CompanyStatus;
  address: {
    street: string;
    city: string;
    county: string;
    postalCode?: string;
  };
  caenPrimary: string;
  caenSecondary: string[];
  foundedDate: string;
  isActive: boolean;
  lastUpdated: string;
}

export type RomanianLegalEntity = 'SRL' | 'SA' | 'SNC' | 'SCS' | 'SCA' | 'PFA' | 'II' | 'IF' | 'ONG' | 'RA' | 'SC' | 'OTHER';
export type CompanyStatus = 'active' | 'suspended' | 'dissolved' | 'insolvency' | 'bankruptcy' | 'radiated';

/**
 * Validate and look up a Romanian company by CUI
 * Falls back to ANAF public API if ONRC is unavailable
 */
export async function lookupCompany(cui: string): Promise<ONRCCompanyData | null> {
  const cleaned = cui.toUpperCase().replace(/^RO/, '').trim();

  if (!validateCUI(cleaned)) {
    throw new Error(`CUI invalid: ${cui}. Verificați cifra de control.`);
  }

  return withCache(`onrc:company:${cleaned}`, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        // Try ANAF public listing API (more reliable than ONRC portal)
        const anafResponse = await fetch(
          'https://webservicesp.anaf.ro/AsynchWebService/api/v8/ws/tva',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{
              cui: parseInt(cleaned),
              data: new Date().toISOString().split('T')[0],
            }]),
          },
        );

        if (!anafResponse.ok) {
          throw new Error(`ANAF API error: ${anafResponse.status}`);
        }

        const data = await anafResponse.json();
        const found = data?.found?.[0];

        if (!found) return null;

        return {
          cui: cleaned,
          name: normalizeDiacritics(found.date_generale?.denumire ?? ''),
          registrationNumber: found.date_generale?.nrRegCom ?? '',
          legalForm: inferLegalForm(found.date_generale?.denumire ?? ''),
          status: found.date_generale?.stare_inregistrare === 'INREGISTRAT' ? 'active' : 'dissolved',
          address: {
            street: normalizeDiacritics(found.date_generale?.adresa ?? ''),
            city: '',
            county: normalizeDiacritics(found.date_generale?.judet ?? ''),
          },
          caenPrimary: found.date_generale?.cod_CAEN ?? '',
          caenSecondary: [],
          foundedDate: '',
          isActive: found.date_generale?.stare_inregistrare === 'INREGISTRAT',
          lastUpdated: new Date().toISOString(),
        };
      }, { maxRequests: 3, windowMs: 60_000 }),
    ),
  );
}

/**
 * Validate company data for EU funding eligibility
 */
export function validateCompanyEligibility(company: ONRCCompanyData, requirements: {
  allowedLegalForms?: RomanianLegalEntity[];
  requiredCaen?: string[];
  mustBeActive?: boolean;
}): { eligible: boolean; issues: string[] } {
  const issues: string[] = [];

  if (requirements.mustBeActive !== false && !company.isActive) {
    issues.push('Compania nu este activă în Registrul Comerțului');
  }

  if (requirements.allowedLegalForms?.length) {
    if (!requirements.allowedLegalForms.includes(company.legalForm)) {
      issues.push(`Forma juridică ${company.legalForm} nu este eligibilă. Forme acceptate: ${requirements.allowedLegalForms.join(', ')}`);
    }
  }

  if (requirements.requiredCaen?.length) {
    const allCaen = [company.caenPrimary, ...company.caenSecondary];
    const hasMatch = requirements.requiredCaen.some((c) => allCaen.includes(c));
    if (!hasMatch) {
      issues.push(`Codul CAEN principal (${company.caenPrimary}) nu se regăsește în lista codurilor eligibile`);
    }
  }

  return { eligible: issues.length === 0, issues };
}

function inferLegalForm(name: string): RomanianLegalEntity {
  const upper = name.toUpperCase();
  if (upper.includes('S.R.L') || upper.includes('SRL')) return 'SRL';
  if (upper.includes('S.A.') || upper.endsWith(' SA')) return 'SA';
  if (upper.includes('S.N.C') || upper.includes('SNC')) return 'SNC';
  if (upper.includes('S.C.S') || upper.includes('SCS')) return 'SCS';
  if (upper.includes('S.C.A') || upper.includes('SCA')) return 'SCA';
  if (upper.includes('P.F.A') || upper.includes('PFA')) return 'PFA';
  if (upper.includes('I.I.') || upper.includes(' II ')) return 'II';
  if (upper.includes('I.F.') || upper.includes(' IF ')) return 'IF';
  if (upper.includes('ASOCIAT') || upper.includes('FUNDATI') || upper.includes('ONG')) return 'ONG';
  if (upper.includes('R.A.') || upper.includes('REGIA')) return 'RA';
  return 'OTHER';
}
