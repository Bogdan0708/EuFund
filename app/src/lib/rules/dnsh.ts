export type DNSHStatus = 'pass' | 'warning' | 'fail';

export interface DNSHAssessment {
  status: DNSHStatus;
  score: number;
  finding: string;
  recommendation: string;
  legalReference: string;
  missingEvidence: string[];
}

const PROHIBITED_PATTERNS = [
  /\bcoal\b/i,
  /\bpetrol\b/i,
  /\boil\b/i,
  /\bgas extraction\b/i,
  /\bincineration\b/i,
  /\bdeforestation\b/i,
];

const EVIDENCE_PATTERNS = [
  /\bdnsh\b/i,
  /do no significant harm/i,
  /\bimpact de mediu\b/i,
  /\bevaluare de mediu\b/i,
  /\bmitigare\b/i,
  /\bmonitorizare\b/i,
  /\bemisii\b/i,
  /\beconomie circulară\b/i,
];

const MITIGATION_PATTERNS = [
  /\bmitigare\b/i,
  /\bcompensare\b/i,
  /\breducere emisii\b/i,
  /\bmanagement deșeuri\b/i,
  /\bmonitorizare impact\b/i,
  /\bcircular\b/i,
];

export function assessDNSH(input: {
  title: string;
  summary?: string;
  objectives?: string;
  methodology?: string;
  locale?: 'ro' | 'en';
}): DNSHAssessment {
  const isRo = input.locale !== 'en';
  const combined = [input.title, input.summary, input.objectives, input.methodology]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const evidenceHits = EVIDENCE_PATTERNS.filter((pattern) => pattern.test(combined)).length;
  const mitigationHits = MITIGATION_PATTERNS.filter((pattern) => pattern.test(combined)).length;
  const prohibitedHits = PROHIBITED_PATTERNS.filter((pattern) => pattern.test(combined)).length;

  const missingEvidence: string[] = [];
  if (!/\bdnsh\b/i.test(combined) && !/do no significant harm/i.test(combined)) {
    missingEvidence.push(isRo ? 'Declarație explicită DNSH' : 'Explicit DNSH statement');
  }
  if (!/\bimpact de mediu\b/i.test(combined) && !/\benvironmental impact\b/i.test(combined)) {
    missingEvidence.push(isRo ? 'Evaluare impact de mediu' : 'Environmental impact assessment');
  }
  if (!/\bmonitorizare\b/i.test(combined) && !/\bmonitoring\b/i.test(combined)) {
    missingEvidence.push(isRo ? 'Plan de monitorizare impact' : 'Impact monitoring plan');
  }

  const scoreRaw = 45 + evidenceHits * 12 + mitigationHits * 8 - prohibitedHits * 25 - missingEvidence.length * 8;
  const score = Math.max(0, Math.min(100, scoreRaw));

  let status: DNSHStatus = 'warning';
  if (prohibitedHits > 0 || score < 45) status = 'fail';
  else if (score >= 70 && missingEvidence.length <= 1) status = 'pass';

  const finding = isRo
    ? status === 'pass'
      ? 'Proiectul include elemente suficiente pentru conformitate DNSH, fără riscuri majore identificate.'
      : status === 'warning'
        ? 'Conformitatea DNSH este parțial demonstrată; sunt necesare dovezi suplimentare.'
        : 'Risc DNSH ridicat: au fost identificate activități sau lacune care pot încălca principiul.'
    : status === 'pass'
      ? 'The project includes sufficient elements for DNSH compliance with no major risks detected.'
      : status === 'warning'
        ? 'DNSH compliance is partially evidenced; additional proof is needed.'
        : 'High DNSH risk: detected activities or gaps may breach the principle.';

  const recommendation = isRo
    ? status === 'pass'
      ? 'Păstrați matricea DNSH actualizată și atașați dovezile în raportare.'
      : status === 'warning'
        ? `Completați documentația DNSH: ${missingEvidence.join(', ')}.`
        : `Revizuiți activitățile cu impact negativ și furnizați măsuri de mitigare + dovezi pentru: ${missingEvidence.join(', ')}.`
    : status === 'pass'
      ? 'Keep the DNSH matrix updated and attach supporting evidence in reporting.'
      : status === 'warning'
        ? `Complete DNSH documentation: ${missingEvidence.join(', ')}.`
        : `Revise high-impact activities and provide mitigation measures plus evidence for: ${missingEvidence.join(', ')}.`;

  return {
    status,
    score,
    finding,
    recommendation,
    legalReference: 'Regulation (EU) 2020/852, Article 17 (DNSH)',
    missingEvidence,
  };
}
