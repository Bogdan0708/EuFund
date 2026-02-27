import { createHash } from 'crypto';

export type ComplianceRisk = 'high' | 'medium' | 'low';

export interface ComplianceTask {
  id: string;
  title: string;
  requirement: string;
  section: 'eligibility' | 'financial' | 'technical' | 'reporting' | 'administrative';
  ownerRole: 'legal' | 'finance' | 'project_manager' | 'technical';
  dueInDays: number;
  evidenceType: 'document' | 'declaration' | 'financial_report' | 'technical_report';
  risk: ComplianceRisk;
  isEliminatory: boolean;
  sourceSnippet: string;
  sourceHash: string;
  sourceRef: {
    line: number;
    page: number;
    clauseId: string;
  };
}

export interface GhidTaskGenerationResult {
  tasks: ComplianceTask[];
  sourceHash: string;
  summary: {
    total: number;
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
  };
  readiness: {
    overallScore: number;
    sections: Record<'eligibility' | 'financial' | 'technical' | 'reporting' | 'administrative', number>;
  };
}

const MAX_INPUT_CHARS = 100_000;

function computeRisk(line: string): ComplianceRisk {
  const text = line.toLowerCase();
  if (/eligibil|obligatoriu|neconform|resping|exclud/i.test(text)) return 'high';
  if (/raport|termen|audit|verific|indicator/i.test(text)) return 'medium';
  return 'low';
}

function ownerForLine(line: string): ComplianceTask['ownerRole'] {
  const text = line.toLowerCase();
  if (/buget|financ|cheltuieli|cofinan|cost/i.test(text)) return 'finance';
  if (/contract|declara|legal|gdpr|conformitate|eligibil/i.test(text)) return 'legal';
  if (/tehnic|specifica|implement|echipament|sistem/i.test(text)) return 'technical';
  return 'project_manager';
}

function evidenceForLine(line: string): ComplianceTask['evidenceType'] {
  const text = line.toLowerCase();
  if (/declara|anexa|certificat|aviz/i.test(text)) return 'declaration';
  if (/raport financiar|buget|cheltuieli|factur/i.test(text)) return 'financial_report';
  if (/raport tehnic|indicator|deliverable|milestone/i.test(text)) return 'technical_report';
  return 'document';
}

function dueDaysForRisk(risk: ComplianceRisk): number {
  if (risk === 'high') return 7;
  if (risk === 'medium') return 14;
  return 30;
}

function taskId(projectId: string, source: string, index: number): string {
  const hash = createHash('sha256').update(`${projectId}:${source}:${index}`).digest('hex').slice(0, 12);
  return `ghid-${hash}`;
}

function classifySection(line: string): ComplianceTask['section'] {
  const text = line.toLowerCase();
  if (/eligibil|admisibil|criteri/i.test(text)) return 'eligibility';
  if (/buget|financ|cofinan|cheltuieli|pl[aă]t/i.test(text)) return 'financial';
  if (/tehnic|specifica|echipament|implement|sistem/i.test(text)) return 'technical';
  if (/raport|indicator|monitorizare|audit|termen/i.test(text)) return 'reporting';
  return 'administrative';
}

function readinessPenalty(risk: ComplianceRisk): number {
  if (risk === 'high') return 15;
  if (risk === 'medium') return 7;
  return 3;
}

export function generateComplianceTasksFromGhid(projectId: string, ghidText: string): GhidTaskGenerationResult {
  const normalized = ghidText.slice(0, MAX_INPUT_CHARS);
  const sourceHash = createHash('sha256').update(normalized).digest('hex');
  const pages = normalized.split('\f');
  const sectionScores: Record<ComplianceTask['section'], number> = {
    eligibility: 100,
    financial: 100,
    technical: 100,
    reporting: 100,
    administrative: 100,
  };

  const lines = normalized
    .split(/\r?\n/)
    .map((line, idx) => ({ text: line.trim(), lineNumber: idx + 1 }))
    .filter((line) => line.text.length >= 25);

  const candidateLines = lines.filter(({ text }) => /obligatoriu|trebuie|se va|se vor|eligibil|documente|anexa|termen|raport/i.test(text));

  const tasks: ComplianceTask[] = candidateLines.slice(0, 200).map(({ text, lineNumber }, index) => {
    const risk = computeRisk(text);
    const ownerRole = ownerForLine(text);
    const evidenceType = evidenceForLine(text);
    const section = classifySection(text);
    const isEliminatory = section === 'eligibility' && risk === 'high';
    
    sectionScores[section] = Math.max(0, sectionScores[section] - (isEliminatory ? 25 : readinessPenalty(risk)));

    let page = 1;
    let traversed = 0;
    for (let i = 0; i < pages.length; i++) {
      traversed += pages[i].split(/\r?\n/).length;
      if (lineNumber <= traversed) {
        page = i + 1;
        break;
      }
    }

    return {
      id: taskId(projectId, text, index),
      title: isEliminatory ? `CERINȚĂ ELIMINATORIE #${index + 1}` : `Conformare ghid #${index + 1}`,
      requirement: text,
      section,
      ownerRole,
      dueInDays: dueDaysForRisk(risk),
      evidenceType,
      risk,
      isEliminatory,
      sourceSnippet: text.slice(0, 500),
      sourceHash,
      sourceRef: {
        line: lineNumber,
        page,
        clauseId: `GHID-${page}-${lineNumber}`,
      },
    };
  });

  // Calculate overall score with heavy weighting on eligibility
  // If eligibility is below 50, the overall score is capped at the eligibility score
  const baseScore = (
    sectionScores.eligibility * 0.4 +
    sectionScores.financial * 0.2 +
    sectionScores.technical * 0.2 +
    sectionScores.reporting * 0.1 +
    sectionScores.administrative * 0.1
  );

  const overallScore = sectionScores.eligibility < 50 
    ? Math.min(Math.round(baseScore), sectionScores.eligibility)
    : Math.round(baseScore);

  return {
    tasks,
    sourceHash,
    summary: {
      total: tasks.length,
      highRisk: tasks.filter((task) => task.risk === 'high').length,
      mediumRisk: tasks.filter((task) => task.risk === 'medium').length,
      lowRisk: tasks.filter((task) => task.risk === 'low').length,
    },
    readiness: {
      overallScore,
      sections: sectionScores,
    },
  };
}
