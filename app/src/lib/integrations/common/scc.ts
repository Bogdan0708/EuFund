// ─── Standard Contractual Clauses (SCCs) Compliance ─────────────
// Cross-border data transfer compliance documentation

export interface DataTransferRecord {
  id: string;
  provider: string;
  dataCategory: string;
  legalBasis: 'scc' | 'adequacy_decision' | 'binding_corporate_rules' | 'derogation';
  destinationCountry: string;
  sccVersion?: string;
  supplementaryMeasures?: string[];
  tiaPerformed: boolean; // Transfer Impact Assessment
  lastReviewDate: Date;
  nextReviewDate: Date;
}

// EU/EEA countries — no SCC needed for transfers within
const EEA_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
]);

// Countries with EU adequacy decisions
const ADEQUACY_COUNTRIES = new Set([
  'AD', 'AR', 'CA', 'FO', 'GG', 'IL', 'IM', 'JP', 'JE', 'NZ',
  'KR', 'CH', 'GB', 'UY', 'US', // US under EU-US Data Privacy Framework
]);

export function requiresSCC(destinationCountry: string): boolean {
  if (EEA_COUNTRIES.has(destinationCountry)) return false;
  if (ADEQUACY_COUNTRIES.has(destinationCountry)) return false;
  return true;
}

export function getLegalBasis(destinationCountry: string): DataTransferRecord['legalBasis'] {
  if (EEA_COUNTRIES.has(destinationCountry)) return 'adequacy_decision';
  if (ADEQUACY_COUNTRIES.has(destinationCountry)) return 'adequacy_decision';
  return 'scc';
}

// Documented data transfers for all external integrations
export const DOCUMENTED_TRANSFERS: DataTransferRecord[] = [
  {
    id: 'eurlex-eu',
    provider: 'EUR-Lex (Publications Office of the EU)',
    dataCategory: 'Public legislative documents (no personal data)',
    legalBasis: 'adequacy_decision',
    destinationCountry: 'LU',
    tiaPerformed: true,
    lastReviewDate: new Date('2026-02-01'),
    nextReviewDate: new Date('2027-02-01'),
  },
  {
    id: 'ec-portal-eu',
    provider: 'EC Funding & Tenders Portal',
    dataCategory: 'Public funding call data (no personal data)',
    legalBasis: 'adequacy_decision',
    destinationCountry: 'BE',
    tiaPerformed: true,
    lastReviewDate: new Date('2026-02-01'),
    nextReviewDate: new Date('2027-02-01'),
  },
  {
    id: 'onrc-ro',
    provider: 'ONRC (Oficiul Național al Registrului Comerțului)',
    dataCategory: 'Public company registry data',
    legalBasis: 'adequacy_decision',
    destinationCountry: 'RO',
    tiaPerformed: true,
    lastReviewDate: new Date('2026-02-01'),
    nextReviewDate: new Date('2027-02-01'),
  },
  {
    id: 'anaf-ro',
    provider: 'ANAF (Agenția Națională de Administrare Fiscală)',
    dataCategory: 'Tax compliance verification (company data)',
    legalBasis: 'adequacy_decision',
    destinationCountry: 'RO',
    tiaPerformed: true,
    lastReviewDate: new Date('2026-02-01'),
    nextReviewDate: new Date('2027-02-01'),
  },
  {
    id: 'certsign-ro',
    provider: 'certSIGN S.A.',
    dataCategory: 'Document signatures, signer identity',
    legalBasis: 'adequacy_decision',
    destinationCountry: 'RO',
    sccVersion: 'N/A (intra-EEA)',
    tiaPerformed: true,
    lastReviewDate: new Date('2026-02-01'),
    nextReviewDate: new Date('2027-02-01'),
  },
  {
    id: 'mysmis-ro',
    provider: 'MySMIS 2021+ (Ministerul Investițiilor și Proiectelor Europene)',
    dataCategory: 'Project submission data, organization data',
    legalBasis: 'adequacy_decision',
    destinationCountry: 'RO',
    tiaPerformed: true,
    lastReviewDate: new Date('2026-02-01'),
    nextReviewDate: new Date('2027-02-01'),
  },
];

export function getTransferDocumentation(): string {
  return DOCUMENTED_TRANSFERS.map((t) =>
    `Provider: ${t.provider}\n` +
    `Data: ${t.dataCategory}\n` +
    `Destination: ${t.destinationCountry}\n` +
    `Legal Basis: ${t.legalBasis}\n` +
    `TIA Performed: ${t.tiaPerformed ? 'Yes' : 'No'}\n` +
    `Last Review: ${t.lastReviewDate.toISOString().split('T')[0]}\n`
  ).join('\n---\n');
}
