// ─── Romanian Market Intelligence ────────────────────────────────
// Bureaucracy delay prediction, public procurement risks,
// currency analysis, regulatory monitoring, and partner ecosystem.

// ─── Types ───────────────────────────────────────────────────────

export interface DelayPrediction {
  process: string;
  processRo: string;
  averageDelayDays: number;
  bestCaseDays: number;
  worstCaseDays: number;
  confidence: number; // 0-1
  factors: string[];
  mitigation: string;
  mitigationRo: string;
}

export interface ProcurementRisk {
  category: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  descriptionRo: string;
  probability: number;
  impact: string;
  regulation: string;
  mitigation: string[];
  mitigationRo: string[];
}

export interface CurrencyAnalysis {
  currentRate: number; // EUR/RON
  historicalAvg30d: number;
  historicalAvg90d: number;
  historicalAvg1y: number;
  volatility: number; // std dev
  trend: 'strengthening-ron' | 'weakening-ron' | 'stable';
  projectedRange: { low: number; high: number };
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
  recommendationRo: string;
}

export interface RegulatoryUpdate {
  id: string;
  title: string;
  titleRo: string;
  category: 'tax' | 'procurement' | 'labor' | 'eu-funds' | 'corporate' | 'gdpr';
  effectiveDate: string;
  impactLevel: 'low' | 'medium' | 'high';
  summary: string;
  summaryRo: string;
  affectedAreas: string[];
  actionRequired: boolean;
  requiredAction?: string;
  requiredActionRo?: string;
}

export interface RomanianPartnerMap {
  totalOrganizations: number;
  byType: Record<string, number>;
  byRegion: Record<string, number>;
  topCapabilities: { capability: string; count: number }[];
  euProjectExperience: { range: string; count: number }[];
}

export interface RomanianContextIntelligence {
  bureaucracyDelays: DelayPrediction[];
  publicProcurementRisks: ProcurementRisk[];
  currencyVolatility: CurrencyAnalysis;
  regulatoryChanges: RegulatoryUpdate[];
  partnerEcosystem: RomanianPartnerMap;
  overallReadiness: number; // 0-100
  keyRecommendations: { en: string; ro: string }[];
}

// ─── Romanian Bureaucracy Delay Database ─────────────────────────

const BUREAUCRACY_DELAYS: DelayPrediction[] = [
  {
    process: 'ANAF Tax Registration for EU Project',
    processRo: 'Înregistrare fiscală ANAF pentru proiect UE',
    averageDelayDays: 21,
    bestCaseDays: 10,
    worstCaseDays: 45,
    confidence: 0.8,
    factors: ['ANAF office workload', 'Document completeness', 'Time of year (year-end slower)'],
    mitigation: 'Submit complete documentation early. Use electronic submission (SPV) when possible.',
    mitigationRo: 'Transmiteți documentația completă din timp. Utilizați depunerea electronică (SPV) când este posibil.',
  },
  {
    process: 'SICAP Public Procurement (under €135k)',
    processRo: 'Achiziție publică SICAP (sub 135.000€)',
    averageDelayDays: 35,
    bestCaseDays: 20,
    worstCaseDays: 90,
    confidence: 0.7,
    factors: ['Number of bidders', 'Contestation risk', 'SICAP system availability', 'Evaluation committee availability'],
    mitigation: 'Start procurement 3 months before need. Prepare clear technical specifications.',
    mitigationRo: 'Începeți achizițiile cu 3 luni înainte de necesitate. Pregătiți specificații tehnice clare.',
  },
  {
    process: 'SICAP Public Procurement (above €135k)',
    processRo: 'Achiziție publică SICAP (peste 135.000€)',
    averageDelayDays: 75,
    bestCaseDays: 45,
    worstCaseDays: 180,
    confidence: 0.65,
    factors: ['EU threshold rules', 'CNSC contestation', 'Court challenges', 'Complex evaluation'],
    mitigation: 'Allow 6 months minimum. Engage procurement specialist. Budget for legal consultation.',
    mitigationRo: 'Alocați minimum 6 luni. Angajați specialist achiziții. Bugetați consultanță juridică.',
  },
  {
    process: 'Bank Account Opening (EU Project Dedicated)',
    processRo: 'Deschidere cont bancar (dedicat proiect UE)',
    averageDelayDays: 14,
    bestCaseDays: 5,
    worstCaseDays: 30,
    confidence: 0.85,
    factors: ['Bank internal procedures', 'KYC/AML checks', 'Document requirements vary by bank'],
    mitigation: 'Choose banks experienced with EU project accounts (BCR, BRD, Banca Transilvania).',
    mitigationRo: 'Alegeți bănci cu experiență în conturi de proiecte UE (BCR, BRD, Banca Transilvania).',
  },
  {
    process: 'Romanian Company Formation for EU Project',
    processRo: 'Înființare firmă românească pentru proiect UE',
    averageDelayDays: 25,
    bestCaseDays: 10,
    worstCaseDays: 45,
    confidence: 0.75,
    factors: ['ONRC processing time', 'Registered office verification', 'Trade register backlog'],
    mitigation: 'Use authorized agent. Ensure all founding documents are notarized in advance.',
    mitigationRo: 'Folosiți agent autorizat. Asigurați-vă că toate documentele constitutive sunt notarizate în prealabil.',
  },
  {
    process: 'EU Fund Reimbursement Claim Processing',
    processRo: 'Procesare cerere de rambursare fonduri UE',
    averageDelayDays: 60,
    bestCaseDays: 30,
    worstCaseDays: 120,
    confidence: 0.7,
    factors: ['Managing authority backlog', 'Claim completeness', 'Audit triggers', 'Budget year-end'],
    mitigation: 'Submit claims quarterly. Maintain impeccable documentation. Pre-check with MA.',
    mitigationRo: 'Depuneți cererile trimestrial. Mențineți documentație impecabilă. Verificați în prealabil cu AM.',
  },
  {
    process: 'Environmental Permit (if needed)',
    processRo: 'Autorizație de mediu (dacă este necesară)',
    averageDelayDays: 45,
    bestCaseDays: 20,
    worstCaseDays: 90,
    confidence: 0.6,
    factors: ['Agency workload', 'Environmental impact assessment complexity', 'Public consultation period'],
    mitigation: 'Start environmental screening in project planning phase.',
    mitigationRo: 'Începeți evaluarea de mediu în faza de planificare a proiectului.',
  },
  {
    process: 'Partnership Agreement Notarization',
    processRo: 'Notarizare acord de parteneriat',
    averageDelayDays: 10,
    bestCaseDays: 3,
    worstCaseDays: 21,
    confidence: 0.85,
    factors: ['Notary availability', 'Document complexity', 'Number of partners'],
    mitigation: 'Book notary appointment early. Prepare all documents bilingually in advance.',
    mitigationRo: 'Programați la notar din timp. Pregătiți toate documentele bilingv în prealabil.',
  },
];

// ─── Public Procurement Risks ────────────────────────────────────

const PROCUREMENT_RISKS: ProcurementRisk[] = [
  {
    category: 'Contestation at CNSC',
    riskLevel: 'high',
    description: 'Losing bidders may file complaints with CNSC (National Council for Solving Complaints), adding 30-60 days.',
    descriptionRo: 'Ofertanții pierduți pot depune plângeri la CNSC, adăugând 30-60 zile.',
    probability: 0.3,
    impact: '30-60 day delay + legal costs',
    regulation: 'Law 98/2016 on public procurement',
    mitigation: ['Ensure transparent evaluation criteria', 'Document all decisions thoroughly', 'Use standardized templates'],
    mitigationRo: ['Asigurați criterii transparente de evaluare', 'Documentați toate deciziile temeinic', 'Utilizați template-uri standardizate'],
  },
  {
    category: 'Court Challenge',
    riskLevel: 'critical',
    description: 'CNSC decisions can be challenged in court, potentially adding 3-12 months.',
    descriptionRo: 'Deciziile CNSC pot fi contestate în instanță, adăugând potențial 3-12 luni.',
    probability: 0.1,
    impact: '3-12 month delay + significant legal costs',
    regulation: 'Law 101/2016 on remedies',
    mitigation: ['Strong initial documentation', 'Legal review of technical specifications', 'Consider framework agreements'],
    mitigationRo: ['Documentație inițială solidă', 'Revizie juridică a specificațiilor tehnice', 'Luați în considerare acorduri-cadru'],
  },
  {
    category: 'SICAP Technical Issues',
    riskLevel: 'medium',
    description: 'Electronic procurement system (SICAP) may have downtime or technical problems.',
    descriptionRo: 'Sistemul electronic de achiziții (SICAP) poate avea perioade de nefuncționare sau probleme tehnice.',
    probability: 0.2,
    impact: '5-15 day delay',
    regulation: 'HG 395/2016',
    mitigation: ['Submit well before deadlines', 'Keep offline backups', 'Document system issues immediately'],
    mitigationRo: ['Transmiteți cu mult înainte de termene', 'Păstrați copii de rezervă offline', 'Documentați problemele de sistem imediat'],
  },
  {
    category: 'Insufficient Competition',
    riskLevel: 'medium',
    description: 'Fewer than 3 bidders may require procedure restart or justification.',
    descriptionRo: 'Mai puțin de 3 ofertanți poate necesita repornirea procedurii sau justificare.',
    probability: 0.25,
    impact: '20-40 day delay + potential procedure change',
    regulation: 'Law 98/2016 Art. 68',
    mitigation: ['Market consultation before launch', 'Broader publication', 'Reasonable qualification criteria'],
    mitigationRo: ['Consultare de piață înainte de lansare', 'Publicare mai largă', 'Criterii de calificare rezonabile'],
  },
  {
    category: 'Conflict of Interest',
    riskLevel: 'high',
    description: 'Detected conflicts of interest can invalidate entire procurement procedure.',
    descriptionRo: 'Conflictele de interese detectate pot invalida întreaga procedură de achiziție.',
    probability: 0.15,
    impact: 'Procedure restart + potential sanctions',
    regulation: 'Law 98/2016 Art. 59-62, ANI verification',
    mitigation: ['Declaration of interests from all involved', 'ANI (National Integrity Agency) pre-check', 'Rotation of evaluation committee members'],
    mitigationRo: ['Declarații de interese de la toți implicații', 'Verificare ANI în prealabil', 'Rotația membrilor comisiei de evaluare'],
  },
];

// ─── Currency Analysis ───────────────────────────────────────────

export function analyzeRONCurrency(currentRate?: number): CurrencyAnalysis {
  // EUR/RON has been relatively stable due to BNR (Romanian National Bank) managed float
  const rate = currentRate ?? 4.97;

  return {
    currentRate: rate,
    historicalAvg30d: 4.976,
    historicalAvg90d: 4.974,
    historicalAvg1y: 4.968,
    volatility: 0.015, // Very low - BNR manages the rate
    trend: rate > 4.98 ? 'weakening-ron' : rate < 4.96 ? 'strengthening-ron' : 'stable',
    projectedRange: { low: rate * 0.995, high: rate * 1.02 },
    riskLevel: 'low', // RON is managed float, limited volatility
    recommendation: 'EUR/RON exchange rate is BNR-managed with low volatility. Use ECB monthly reference rate for conversions. Limited hedging needed.',
    recommendationRo: 'Cursul EUR/RON este administrat de BNR cu volatilitate redusă. Utilizați cursul de referință lunar ECB pentru conversii. Acoperire limitată necesară.',
  };
}

// ─── Key Regulatory Framework ────────────────────────────────────

const REGULATORY_FRAMEWORK: RegulatoryUpdate[] = [
  {
    id: 'reg-001',
    title: 'Public Procurement Thresholds Update 2024',
    titleRo: 'Actualizare praguri achiziții publice 2024',
    category: 'procurement',
    effectiveDate: '2024-01-01',
    impactLevel: 'high',
    summary: 'Updated EU procurement thresholds affecting Romanian public entities in EU projects.',
    summaryRo: 'Praguri actualizate de achiziții UE care afectează entitățile publice române în proiecte UE.',
    affectedAreas: ['public-procurement', 'budget-planning'],
    actionRequired: true,
    requiredAction: 'Review all planned procurements against new thresholds.',
    requiredActionRo: 'Revizuiți toate achizițiile planificate în raport cu noile praguri.',
  },
  {
    id: 'reg-002',
    title: 'Romanian Fiscal Code Amendments - Transfer Pricing',
    titleRo: 'Modificări Cod Fiscal Român - Prețuri de transfer',
    category: 'tax',
    effectiveDate: '2024-01-01',
    impactLevel: 'medium',
    summary: 'Updated transfer pricing rules affecting transactions between consortium partners.',
    summaryRo: 'Reguli actualizate de prețuri de transfer care afectează tranzacțiile între partenerii consorțiului.',
    affectedAreas: ['partner-payments', 'tax-compliance'],
    actionRequired: true,
    requiredAction: 'Review inter-partner transactions for transfer pricing compliance.',
    requiredActionRo: 'Revizuiți tranzacțiile inter-parteneri pentru conformitate cu prețurile de transfer.',
  },
  {
    id: 'reg-003',
    title: 'GDPR Enforcement Strengthening - ANSPDCP',
    titleRo: 'Consolidare aplicare GDPR - ANSPDCP',
    category: 'gdpr',
    effectiveDate: '2024-03-01',
    impactLevel: 'medium',
    summary: 'Romanian DPA (ANSPDCP) increased enforcement activity on data processing in publicly funded projects.',
    summaryRo: 'ANSPDCP a intensificat activitatea de control privind prelucrarea datelor în proiecte finanțate public.',
    affectedAreas: ['data-protection', 'participant-data', 'research-data'],
    actionRequired: true,
    requiredAction: 'Ensure all DPAs with partners are up to date. Review consent mechanisms.',
    requiredActionRo: 'Asigurați-vă că toate DPA-urile cu partenerii sunt actualizate. Revizuiți mecanismele de consimțământ.',
  },
  {
    id: 'reg-004',
    title: 'Minimum Wage Increase Impact on Personnel Costs',
    titleRo: 'Impact creștere salariu minim pe costurile de personal',
    category: 'labor',
    effectiveDate: '2025-01-01',
    impactLevel: 'medium',
    summary: 'Romanian minimum wage increase affects eligible personnel cost calculations for EU projects.',
    summaryRo: 'Creșterea salariului minim din România afectează calculul costurilor eligibile de personal pentru proiecte UE.',
    affectedAreas: ['personnel-costs', 'budget-planning'],
    actionRequired: false,
  },
  {
    id: 'reg-005',
    title: 'EU Funds Management Authority Reorganization',
    titleRo: 'Reorganizare Autoritate de Management Fonduri UE',
    category: 'eu-funds',
    effectiveDate: '2024-06-01',
    impactLevel: 'high',
    summary: 'Reorganization of managing authorities may affect reimbursement timelines and contact points.',
    summaryRo: 'Reorganizarea autorităților de management poate afecta termenele de rambursare și punctele de contact.',
    affectedAreas: ['reimbursement', 'reporting', 'monitoring'],
    actionRequired: true,
    requiredAction: 'Verify current MA contact points and update communication channels.',
    requiredActionRo: 'Verificați punctele de contact actuale ale AM și actualizați canalele de comunicare.',
  },
];

// ─── Romanian Partner Ecosystem ──────────────────────────────────

function getRomanianPartnerEcosystem(): RomanianPartnerMap {
  return {
    totalOrganizations: 850, // Approximate active EU project participants
    byType: {
      'University': 95,
      'Research Institute': 65,
      'SME': 380,
      'Large Enterprise': 120,
      'NGO': 90,
      'Public Body': 100,
    },
    byRegion: {
      'București-Ilfov': 320,
      'Nord-Vest (Cluj)': 110,
      'Vest (Timișoara)': 85,
      'Centru (Brașov)': 70,
      'Nord-Est (Iași)': 65,
      'Sud-Muntenia': 55,
      'Sud-Est': 45,
      'Sud-Vest Oltenia': 40,
    },
    topCapabilities: [
      { capability: 'IT & Software Development', count: 180 },
      { capability: 'Engineering & Manufacturing', count: 120 },
      { capability: 'Biotechnology & Health', count: 85 },
      { capability: 'Energy & Environment', count: 75 },
      { capability: 'Agriculture & Food', count: 65 },
      { capability: 'Materials Science', count: 55 },
      { capability: 'Social Innovation', count: 45 },
      { capability: 'Space & Aerospace', count: 30 },
    ],
    euProjectExperience: [
      { range: 'First EU project', count: 250 },
      { range: '2-5 EU projects', count: 350 },
      { range: '6-15 EU projects', count: 180 },
      { range: '15+ EU projects', count: 70 },
    ],
  };
}

// ─── Main Intelligence Analysis ──────────────────────────────────

export interface RomanianIntelligenceInput {
  projectBudget: number;
  romanianPartnerCount: number;
  hasPublicProcurement: boolean;
  projectDurationMonths: number;
  sectorFocus?: string;
  currentExchangeRate?: number;
  locale?: 'ro' | 'en';
}

export async function analyzeRomanianContext(input: RomanianIntelligenceInput): Promise<RomanianContextIntelligence> {
  const currency = analyzeRONCurrency(input.currentExchangeRate);
  const partnerEcosystem = getRomanianPartnerEcosystem();

  // Filter relevant delays based on project characteristics
  let relevantDelays = [...BUREAUCRACY_DELAYS];
  if (!input.hasPublicProcurement) {
    relevantDelays = relevantDelays.filter(d => !d.process.includes('SICAP') && !d.process.includes('Procurement'));
  }

  // Filter relevant procurement risks
  const relevantProcurementRisks = input.hasPublicProcurement ? [...PROCUREMENT_RISKS] : [];

  // Filter relevant regulations
  const relevantRegulations = REGULATORY_FRAMEWORK.filter(r => r.actionRequired || r.impactLevel === 'high');

  // Calculate overall readiness
  const readinessFactors: number[] = [
    currency.riskLevel === 'low' ? 90 : currency.riskLevel === 'medium' ? 60 : 30,
    input.hasPublicProcurement ? 60 : 85, // procurement adds complexity
    input.romanianPartnerCount > 0 ? 75 : 90, // having local partners helps but adds admin
    input.projectDurationMonths > 36 ? 65 : 80, // longer projects = more regulatory risk
  ];
  const overallReadiness = Math.round(readinessFactors.reduce((a, b) => a + b, 0) / readinessFactors.length);

  // Key recommendations
  const keyRecommendations: { en: string; ro: string }[] = [
    {
      en: 'Budget 15-20% time buffer for Romanian administrative procedures.',
      ro: 'Bugetați 15-20% tampon de timp pentru procedurile administrative românești.',
    },
    {
      en: 'Engage a Romanian legal/fiscal advisor familiar with EU project management.',
      ro: 'Angajați un consultant juridic/fiscal român familiar cu managementul proiectelor UE.',
    },
  ];

  if (input.hasPublicProcurement) {
    keyRecommendations.push({
      en: 'Start public procurement planning at least 3 months before estimated need.',
      ro: 'Începeți planificarea achizițiilor publice cu cel puțin 3 luni înainte de necesitatea estimată.',
    });
  }

  if (input.romanianPartnerCount > 2) {
    keyRecommendations.push({
      en: 'Designate a Romanian coordination hub for local regulatory compliance.',
      ro: 'Desemnați un hub de coordonare românesc pentru conformitatea reglementară locală.',
    });
  }

  keyRecommendations.push({
    en: 'Use ECB reference rates for EUR/RON conversions. Document rate used for each transaction.',
    ro: 'Utilizați cursurile de referință ECB pentru conversiile EUR/RON. Documentați cursul utilizat pentru fiecare tranzacție.',
  });

  return {
    bureaucracyDelays: relevantDelays,
    publicProcurementRisks: relevantProcurementRisks,
    currencyVolatility: currency,
    regulatoryChanges: relevantRegulations,
    partnerEcosystem,
    overallReadiness,
    keyRecommendations,
  };
}

// ─── Quick Romanian Context Check ────────────────────────────────

export function quickRomanianCheck(hasPublicProcurement: boolean, partnerCount: number): {
  readiness: number;
  topRisk: string;
  topRiskRo: string;
  estimatedAdminDelayDays: number;
} {
  const baseDelay = 21; // ANAF registration
  const procurementDelay = hasPublicProcurement ? 50 : 0;
  const partnerDelay = partnerCount * 5;
  const estimatedDelay = baseDelay + procurementDelay + partnerDelay;

  return {
    readiness: hasPublicProcurement ? 60 : 80,
    topRisk: hasPublicProcurement ? 'Public procurement delays (SICAP)' : 'Administrative registration delays (ANAF)',
    topRiskRo: hasPublicProcurement ? 'Întârzieri achiziții publice (SICAP)' : 'Întârzieri înregistrare administrativă (ANAF)',
    estimatedAdminDelayDays: estimatedDelay,
  };
}
