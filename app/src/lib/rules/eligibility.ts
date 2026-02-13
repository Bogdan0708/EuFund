// ─── Deterministic Rules Engine ──────────────────────────────────
// Hard eligibility checks that do NOT depend on AI
// These are objective, verifiable criteria from call guides

export type RuleResult = {
  ruleId: string;
  ruleName: string;
  status: 'pass' | 'fail' | 'warning' | 'not_applicable';
  messageRo: string;
  messageEn: string;
  details?: Record<string, unknown>;
};

export type RuleContext = {
  organization: {
    orgType: string;
    orgSize?: string;
    caenPrimary?: string;
    caenSecondary?: string[];
    nutsRegion?: string;
    employeeCount?: number;
    annualRevenue?: number;
    foundedDate?: string;
  };
  project: {
    totalBudget?: number;
    ownContrib?: number;
    durationMonths?: number;
    startDate?: string;
    endDate?: string;
  };
  call: {
    eligibleTypes?: string[];
    eligibleRegions?: string[];
    eligibleCaen?: string[];
    budgetMin?: number;
    budgetMax?: number;
    cofinancingRate?: number;
    durationMin?: number;
    durationMax?: number;
    submissionEnd?: string;
  };
};

type Rule = (ctx: RuleContext) => RuleResult;

// ─── Individual Rules ────────────────────────────────────────────

const checkOrgTypeEligibility: Rule = (ctx) => {
  const { organization, call } = ctx;
  if (!call.eligibleTypes || call.eligibleTypes.length === 0) {
    return {
      ruleId: 'ELIG-001',
      ruleName: 'Tip organizație eligibil',
      status: 'not_applicable',
      messageRo: 'Nu sunt specificate tipuri de organizație eligibile.',
      messageEn: 'No eligible organization types specified.',
    };
  }

  const eligible = call.eligibleTypes.includes(organization.orgType);
  return {
    ruleId: 'ELIG-001',
    ruleName: 'Tip organizație eligibil',
    status: eligible ? 'pass' : 'fail',
    messageRo: eligible
      ? `Tipul organizației (${organization.orgType}) este eligibil.`
      : `Tipul organizației (${organization.orgType}) NU este eligibil. Tipuri acceptate: ${call.eligibleTypes.join(', ')}.`,
    messageEn: eligible
      ? `Organization type (${organization.orgType}) is eligible.`
      : `Organization type (${organization.orgType}) is NOT eligible. Accepted types: ${call.eligibleTypes.join(', ')}.`,
  };
};

const checkRegionEligibility: Rule = (ctx) => {
  const { organization, call } = ctx;
  if (!call.eligibleRegions || call.eligibleRegions.length === 0) {
    return {
      ruleId: 'ELIG-002',
      ruleName: 'Regiune eligibilă',
      status: 'not_applicable',
      messageRo: 'Apelul nu restricționează regiunile eligibile.',
      messageEn: 'The call does not restrict eligible regions.',
    };
  }

  if (!organization.nutsRegion) {
    return {
      ruleId: 'ELIG-002',
      ruleName: 'Regiune eligibilă',
      status: 'warning',
      messageRo: 'Regiunea organizației nu este specificată. Completați profilul organizației.',
      messageEn: 'Organization region not specified. Please complete the organization profile.',
    };
  }

  const eligible = call.eligibleRegions.includes(organization.nutsRegion);
  return {
    ruleId: 'ELIG-002',
    ruleName: 'Regiune eligibilă',
    status: eligible ? 'pass' : 'fail',
    messageRo: eligible
      ? `Regiunea ${organization.nutsRegion} este eligibilă.`
      : `Regiunea ${organization.nutsRegion} NU este eligibilă. Regiuni acceptate: ${call.eligibleRegions.join(', ')}.`,
    messageEn: eligible
      ? `Region ${organization.nutsRegion} is eligible.`
      : `Region ${organization.nutsRegion} is NOT eligible. Accepted regions: ${call.eligibleRegions.join(', ')}.`,
  };
};

const checkCAENEligibility: Rule = (ctx) => {
  const { organization, call } = ctx;
  if (!call.eligibleCaen || call.eligibleCaen.length === 0) {
    return {
      ruleId: 'ELIG-003',
      ruleName: 'Cod CAEN eligibil',
      status: 'not_applicable',
      messageRo: 'Apelul nu restricționează codurile CAEN.',
      messageEn: 'The call does not restrict CAEN codes.',
    };
  }

  const allCaen = [organization.caenPrimary, ...(organization.caenSecondary || [])].filter(Boolean) as string[];
  if (allCaen.length === 0) {
    return {
      ruleId: 'ELIG-003',
      ruleName: 'Cod CAEN eligibil',
      status: 'warning',
      messageRo: 'Codul CAEN nu este specificat. Completați profilul organizației.',
      messageEn: 'CAEN code not specified. Please complete the organization profile.',
    };
  }

  const matchingCaen = allCaen.filter((c) => call.eligibleCaen!.includes(c));
  const eligible = matchingCaen.length > 0;

  return {
    ruleId: 'ELIG-003',
    ruleName: 'Cod CAEN eligibil',
    status: eligible ? 'pass' : 'fail',
    messageRo: eligible
      ? `Cod(uri) CAEN eligibil(e): ${matchingCaen.join(', ')}.`
      : `Niciun cod CAEN al organizației nu este eligibil. CAEN-uri acceptate: ${call.eligibleCaen.join(', ')}.`,
    messageEn: eligible
      ? `Eligible CAEN code(s): ${matchingCaen.join(', ')}.`
      : `No organization CAEN code is eligible. Accepted: ${call.eligibleCaen.join(', ')}.`,
  };
};

const checkBudgetLimits: Rule = (ctx) => {
  const { project, call } = ctx;
  if (!project.totalBudget) {
    return {
      ruleId: 'BUD-001',
      ruleName: 'Plafon bugetar',
      status: 'warning',
      messageRo: 'Bugetul proiectului nu este specificat.',
      messageEn: 'Project budget not specified.',
    };
  }

  const issues: string[] = [];
  if (call.budgetMin && project.totalBudget < call.budgetMin) {
    issues.push(`sub minimul de ${call.budgetMin} EUR`);
  }
  if (call.budgetMax && project.totalBudget > call.budgetMax) {
    issues.push(`peste maximul de ${call.budgetMax} EUR`);
  }

  return {
    ruleId: 'BUD-001',
    ruleName: 'Plafon bugetar',
    status: issues.length === 0 ? 'pass' : 'fail',
    messageRo: issues.length === 0
      ? `Bugetul de ${project.totalBudget} EUR este în limitele apelului.`
      : `Bugetul de ${project.totalBudget} EUR este ${issues.join(' și ')}.`,
    messageEn: issues.length === 0
      ? `Budget of ${project.totalBudget} EUR is within call limits.`
      : `Budget of ${project.totalBudget} EUR is ${issues.join(' and ')}.`,
  };
};

const checkCofinancing: Rule = (ctx) => {
  const { project, call } = ctx;
  if (!call.cofinancingRate || !project.totalBudget || !project.ownContrib) {
    return {
      ruleId: 'BUD-002',
      ruleName: 'Cofinanțare',
      status: 'not_applicable',
      messageRo: 'Datele de cofinanțare nu sunt complete.',
      messageEn: 'Co-financing data is incomplete.',
    };
  }

  const actualRate = (project.ownContrib / project.totalBudget) * 100;
  const meetsRequirement = actualRate >= call.cofinancingRate;

  return {
    ruleId: 'BUD-002',
    ruleName: 'Cofinanțare',
    status: meetsRequirement ? 'pass' : 'fail',
    messageRo: meetsRequirement
      ? `Rata de cofinanțare (${actualRate.toFixed(1)}%) respectă minimul de ${call.cofinancingRate}%.`
      : `Rata de cofinanțare (${actualRate.toFixed(1)}%) este sub minimul de ${call.cofinancingRate}%.`,
    messageEn: meetsRequirement
      ? `Co-financing rate (${actualRate.toFixed(1)}%) meets the minimum of ${call.cofinancingRate}%.`
      : `Co-financing rate (${actualRate.toFixed(1)}%) is below the minimum of ${call.cofinancingRate}%.`,
  };
};

const checkDuration: Rule = (ctx) => {
  const { project, call } = ctx;
  if (!project.durationMonths) {
    return {
      ruleId: 'DUR-001',
      ruleName: 'Durată proiect',
      status: 'warning',
      messageRo: 'Durata proiectului nu este specificată.',
      messageEn: 'Project duration not specified.',
    };
  }

  const issues: string[] = [];
  if (call.durationMin && project.durationMonths < call.durationMin) {
    issues.push(`sub minimul de ${call.durationMin} luni`);
  }
  if (call.durationMax && project.durationMonths > call.durationMax) {
    issues.push(`peste maximul de ${call.durationMax} luni`);
  }

  return {
    ruleId: 'DUR-001',
    ruleName: 'Durată proiect',
    status: issues.length === 0 ? 'pass' : 'fail',
    messageRo: issues.length === 0
      ? `Durata de ${project.durationMonths} luni este în limitele apelului.`
      : `Durata de ${project.durationMonths} luni este ${issues.join(' și ')}.`,
    messageEn: issues.length === 0
      ? `Duration of ${project.durationMonths} months is within call limits.`
      : `Duration of ${project.durationMonths} months is ${issues.join(' and ')}.`,
  };
};

const checkDeadline: Rule = (ctx) => {
  const { call } = ctx;
  if (!call.submissionEnd) {
    return {
      ruleId: 'DEAD-001',
      ruleName: 'Termen limită',
      status: 'not_applicable',
      messageRo: 'Termenul limită nu este specificat.',
      messageEn: 'Deadline not specified.',
    };
  }

  const deadline = new Date(call.submissionEnd);
  const now = new Date();
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    return {
      ruleId: 'DEAD-001',
      ruleName: 'Termen limită',
      status: 'fail',
      messageRo: `Termenul limită a expirat în urmă cu ${Math.abs(daysLeft)} zile.`,
      messageEn: `Deadline expired ${Math.abs(daysLeft)} days ago.`,
    };
  }

  return {
    ruleId: 'DEAD-001',
    ruleName: 'Termen limită',
    status: daysLeft <= 14 ? 'warning' : 'pass',
    messageRo: daysLeft <= 14
      ? `Atenție: mai sunt doar ${daysLeft} zile până la termenul limită!`
      : `Mai sunt ${daysLeft} zile până la termenul limită.`,
    messageEn: daysLeft <= 14
      ? `Warning: only ${daysLeft} days until deadline!`
      : `${daysLeft} days until deadline.`,
  };
};

// ─── Rules Engine ────────────────────────────────────────────────

const ALL_RULES: Rule[] = [
  checkOrgTypeEligibility,
  checkRegionEligibility,
  checkCAENEligibility,
  checkBudgetLimits,
  checkCofinancing,
  checkDuration,
  checkDeadline,
];

/**
 * Run all deterministic eligibility rules against a project context.
 * Returns individual results + overall score.
 */
export function runEligibilityRules(ctx: RuleContext): {
  results: RuleResult[];
  score: number;
  passCount: number;
  failCount: number;
  warningCount: number;
} {
  const results = ALL_RULES.map((rule) => rule(ctx));

  const applicable = results.filter((r) => r.status !== 'not_applicable');
  const passCount = applicable.filter((r) => r.status === 'pass').length;
  const failCount = applicable.filter((r) => r.status === 'fail').length;
  const warningCount = applicable.filter((r) => r.status === 'warning').length;

  const score = applicable.length > 0
    ? Math.round((passCount / applicable.length) * 100)
    : 100;

  return { results, score, passCount, failCount, warningCount };
}
