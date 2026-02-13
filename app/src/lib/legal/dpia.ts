// ─── Data Protection Impact Assessment (DPIA) Structure ─────────
// Required under GDPR Art. 35 and Romanian Law 190/2018
// This module defines the DPIA framework for AI processing activities

export interface DPIARecord {
  id: string;
  title: string;
  version: string;
  status: 'draft' | 'under_review' | 'approved' | 'requires_update';
  dpoApproval: boolean;
  lastReviewDate: string;
  nextReviewDate: string;

  // Processing description
  processing: {
    purpose: string;
    legalBasis: LegalBasis;
    dataCategories: DataCategory[];
    dataSubjects: string[];
    recipients: string[];
    retentionPeriod: string;
    crossBorderTransfers: CrossBorderTransfer[];
  };

  // Necessity & proportionality
  necessity: {
    isNecessary: boolean;
    justification: string;
    lessIntrusiveAlternatives: string[];
    proportionalityAssessment: string;
  };

  // Risk assessment
  risks: DPIARisk[];

  // Mitigation measures
  mitigations: DPIAMitigation[];

  // Consultation
  dpoConsultation: {
    date: string;
    opinion: string;
    recommendations: string[];
  };

  // ANSPDCP consultation (if high risk remains after mitigation)
  anspdcpConsultation?: {
    required: boolean;
    submitted: boolean;
    reference?: string;
    response?: string;
  };
}

export type LegalBasis =
  | 'consent'           // Art. 6(1)(a) GDPR
  | 'contract'          // Art. 6(1)(b) GDPR
  | 'legal_obligation'  // Art. 6(1)(c) GDPR
  | 'vital_interests'   // Art. 6(1)(d) GDPR
  | 'public_interest'   // Art. 6(1)(e) GDPR
  | 'legitimate_interest'; // Art. 6(1)(f) GDPR

export type DataCategory =
  | 'identification'     // Name, email, phone
  | 'financial'          // Revenue, budget, bank details
  | 'organizational'     // CUI, CAEN, structure
  | 'project_content'    // Proposal text, objectives
  | 'usage_data'         // IP, user agent, access logs
  | 'ai_interactions';   // Prompts, AI responses

export interface CrossBorderTransfer {
  destination: string;
  provider: string;
  mechanism: 'adequacy_decision' | 'sccs' | 'bcrs' | 'derogation';
  tiaCompleted: boolean;
  supplementaryMeasures?: string[];
}

export interface DPIARisk {
  id: string;
  description: string;
  likelihood: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  overallRisk: 'low' | 'medium' | 'high' | 'critical';
  affectedRights: string[];
}

export interface DPIAMitigation {
  riskId: string;
  measure: string;
  implemented: boolean;
  effectiveness: 'partial' | 'full';
  residualRisk: 'low' | 'medium' | 'high';
}

// ─── FondEU Platform DPIA ────────────────────────────────────────

export const FONDEU_DPIA: DPIARecord = {
  id: 'DPIA-FONDEU-001',
  title: 'Evaluarea Impactului asupra Protecției Datelor - Platforma FondEU',
  version: '1.0',
  status: 'draft',
  dpoApproval: false,
  lastReviewDate: '2026-02-13',
  nextReviewDate: '2026-08-13',

  processing: {
    purpose: 'Asistarea organizațiilor românești în pregătirea cererilor de finanțare europeană prin verificarea conformității, generarea de text și potrivirea cu apeluri de proiecte.',
    legalBasis: 'contract',
    dataCategories: ['identification', 'organizational', 'financial', 'project_content', 'usage_data', 'ai_interactions'],
    dataSubjects: ['Utilizatori platformă (reprezentanți organizații)', 'Manageri de proiect', 'Consultanți fonduri europene'],
    recipients: ['Procesatori AI (OpenAI, Anthropic) - doar date de proiect, nu date personale', 'Furnizor hosting (Hetzner, Frankfurt - EU)'],
    retentionPeriod: 'Date cont: durata contului + 30 zile. Date proiecte: 10 ani (cerință fonduri EU). Loguri audit: 7 ani.',
    crossBorderTransfers: [
      {
        destination: 'SUA',
        provider: 'Anthropic (Claude API)',
        mechanism: 'sccs',
        tiaCompleted: false,
        supplementaryMeasures: [
          'Pseudonimizare date personale înainte de trimitere',
          'Nu se trimit CNP, adrese personale, sau date sensibile',
          'Encripție TLS 1.3 în tranzit',
        ],
      },
      {
        destination: 'SUA',
        provider: 'OpenAI (GPT API)',
        mechanism: 'sccs',
        tiaCompleted: false,
        supplementaryMeasures: [
          'Pseudonimizare date personale',
          'API data not used for training (enterprise agreement)',
          'Encripție TLS 1.3',
        ],
      },
    ],
  },

  necessity: {
    isNecessary: true,
    justification: 'Procesarea AI este necesară pentru verificarea automată a conformității cu ghiduri de 100+ pagini și legislație complexă. Verificarea manuală durează 40+ ore per proiect.',
    lessIntrusiveAlternatives: [
      'Verificare manuală exclusivă (ineficientă, costisitoare)',
      'Reguli deterministe fără AI (acoperire limitată la ~40% din verificări)',
    ],
    proportionalityAssessment: 'Abordare hibridă: reguli deterministe pentru criterii obiective (eligibilitate, plafoane bugetare) + AI doar pentru analiză text narativ. Minimizează datele trimise la procesori AI.',
  },

  risks: [
    {
      id: 'R1',
      description: 'Transfer date personale către procesori AI din SUA',
      likelihood: 'medium',
      impact: 'high',
      overallRisk: 'high',
      affectedRights: ['Protecția datelor personale', 'Dreptul la viață privată'],
    },
    {
      id: 'R2',
      description: 'Decizii automate bazate pe output AI incorect (hallucination)',
      likelihood: 'medium',
      impact: 'medium',
      overallRisk: 'medium',
      affectedRights: ['Dreptul de a nu fi supus unei decizii automatizate (Art. 22 GDPR)'],
    },
    {
      id: 'R3',
      description: 'Breșă de securitate cu expunere date organizații',
      likelihood: 'low',
      impact: 'high',
      overallRisk: 'medium',
      affectedRights: ['Confidențialitatea datelor comerciale', 'Protecția datelor personale'],
    },
  ],

  mitigations: [
    {
      riskId: 'R1',
      measure: 'Pseudonimizare automată: eliminare date personale din prompturi AI',
      implemented: false,
      effectiveness: 'partial',
      residualRisk: 'medium',
    },
    {
      riskId: 'R1',
      measure: 'Utilizare preferențială modele EU-hosted (când disponibile)',
      implemented: false,
      effectiveness: 'full',
      residualRisk: 'low',
    },
    {
      riskId: 'R2',
      measure: 'Reguli deterministe pentru criterii obiective, AI doar pentru text narativ',
      implemented: false,
      effectiveness: 'full',
      residualRisk: 'low',
    },
    {
      riskId: 'R2',
      measure: 'Disclaimer obligatoriu pe toate output-urile AI',
      implemented: false,
      effectiveness: 'partial',
      residualRisk: 'medium',
    },
    {
      riskId: 'R3',
      measure: 'Encripție AES-256 at rest, TLS 1.3 în tranzit, RLS în PostgreSQL',
      implemented: false,
      effectiveness: 'full',
      residualRisk: 'low',
    },
  ],

  dpoConsultation: {
    date: '',
    opinion: '',
    recommendations: [],
  },

  anspdcpConsultation: {
    required: true, // Due to high-risk AI processing
    submitted: false,
  },
};
