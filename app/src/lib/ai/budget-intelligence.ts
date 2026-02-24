// ─── Advanced Budget Intelligence ────────────────────────────────
// Multi-currency analysis, EU funding rules engine, predictive
// budget analytics, and Romanian financial context.


// ─── Types ───────────────────────────────────────────────────────

export interface CostRecommendation {
  category: string;
  currentSpend: number;
  recommendedSpend: number;
  savingsPotential: number;
  priority: 'low' | 'medium' | 'high';
  action: string;
  actionRo: string;
  complianceImpact: 'none' | 'positive' | 'negative';
}

export interface BudgetRisk {
  category: string;
  riskType: 'overrun' | 'underutilization' | 'ineligible-cost' | 'currency' | 'inflation' | 'compliance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  probability: number;
  potentialImpact: number; // EUR
  description: string;
  descriptionRo: string;
  mitigation: string;
}

export interface ComplianceCheck {
  rule: string;
  status: 'compliant' | 'warning' | 'non-compliant';
  details: string;
  detailsRo: string;
  regulation: string;
  requiredAction?: string;
}

export interface CurrencyRisk {
  baseCurrency: 'EUR';
  localCurrency: 'RON';
  currentRate: number;
  projectedRateRange: { low: number; high: number };
  exposureAmount: number;
  potentialLoss: number;
  hedgingRecommendation: string;
  hedgingRecommendationRo: string;
  volatilityLevel: 'low' | 'medium' | 'high';
}

export interface BudgetAnalysis {
  costOptimization: CostRecommendation[];
  riskAnalysis: BudgetRisk[];
  forecastAccuracy: number;
  complianceStatus: ComplianceCheck[];
  currencyRiskAssessment: CurrencyRisk;
  partnerAllocationOptimal: boolean;
  burnRateAnalysis: BurnRateAnalysis;
  inflationImpact: InflationImpact;
  auditReadiness: AuditReadinessScore;
  overallBudgetHealth: number; // 0-100
}

export interface BurnRateAnalysis {
  monthlyBurnRate: number;
  projectedExhaustionDate: string;
  budgetRunway: number; // months remaining
  burnRateTrend: 'increasing' | 'stable' | 'decreasing';
  monthlyBreakdown: { month: string; planned: number; actual: number }[];
  isOnTrack: boolean;
}

export interface InflationImpact {
  annualInflationRate: number; // Romanian CPI
  projectedCostIncrease: number;
  affectedCategories: { category: string; impact: number }[];
  adjustmentRecommendation: string;
  adjustmentRecommendationRo: string;
}

export interface AuditReadinessScore {
  score: number; // 0-100
  documentationComplete: boolean;
  trailIntegrity: boolean;
  categoryCompliance: boolean;
  issues: string[];
}

// ─── Input Types ─────────────────────────────────────────────────

export interface BudgetIntelligenceInput {
  projectId: string;
  totalBudget: number;
  currency: 'EUR';
  programType: string;
  startDate: string;
  endDate: string;
  currentDate?: string;
  coFinancingRate: number; // e.g., 0.75 for 75% EU funding
  categories: BudgetCategory[];
  partners: PartnerBudget[];
  exchangeRate?: number; // EUR to RON
  romanianPartnerBudgetRON?: number;
  inflationRate?: number; // Romanian annual CPI %
  locale?: 'ro' | 'en';
}

export interface BudgetCategory {
  id: string;
  name: string;
  nameRo?: string;
  allocated: number;
  spent: number;
  committed: number; // approved but not yet spent
  isEligible: boolean;
  euCostCategory: 'personnel' | 'subcontracting' | 'equipment' | 'travel' | 'other-goods' | 'indirect';
  maxPercentage?: number; // e.g., 25% for indirect costs
  monthlySpending?: { month: string; amount: number }[];
}

export interface PartnerBudget {
  partnerId: string;
  partnerName: string;
  allocated: number;
  spent: number;
  currency: 'EUR' | 'RON';
  isRomanian: boolean;
}

// ─── EU Funding Rules Engine ─────────────────────────────────────

const EU_COST_RULES: Record<string, { maxPercent?: number; eligible: boolean; notes: string }> = {
  'personnel': { eligible: true, notes: 'Must follow actual salary costs or unit costs' },
  'subcontracting': { maxPercent: 30, eligible: true, notes: 'Requires competitive tendering above thresholds' },
  'equipment': { eligible: true, notes: 'Only depreciation during project period unless <€500k' },
  'travel': { eligible: true, notes: 'Must follow institutional or EU per-diem rates' },
  'other-goods': { eligible: true, notes: 'Consumables, dissemination, IP costs' },
  'indirect': { maxPercent: 25, eligible: true, notes: 'Flat rate 25% of eligible direct costs (excl. subcontracting)' },
};

function validateCostCompliance(categories: BudgetCategory[], totalBudget: number, coFinancingRate: number): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];
  const totalDirectEligible = categories
    .filter(c => c.euCostCategory !== 'indirect' && c.euCostCategory !== 'subcontracting')
    .reduce((sum, c) => sum + c.spent, 0);

  for (const cat of categories) {
    const rule = EU_COST_RULES[cat.euCostCategory];
    if (!rule) continue;

    // Check eligibility
    if (!cat.isEligible && cat.spent > 0) {
      checks.push({
        rule: `Eligible costs - ${cat.name}`,
        status: 'non-compliant',
        details: `€${cat.spent.toLocaleString()} spent on ineligible cost category "${cat.name}"`,
        detailsRo: `€${cat.spent.toLocaleString()} cheltuit pe categoria de costuri neeligibilă "${cat.nameRo ?? cat.name}"`,
        regulation: 'Horizon Europe MGA Art. 6',
        requiredAction: 'Reclassify or remove ineligible costs before next reporting period',
      });
    }

    // Check percentage limits
    if (rule.maxPercent) {
      const baseForPercent = cat.euCostCategory === 'indirect'
        ? totalDirectEligible
        : totalBudget;
      const actualPercent = (cat.spent / Math.max(1, baseForPercent)) * 100;

      if (actualPercent > rule.maxPercent) {
        checks.push({
          rule: `${cat.name} maximum percentage`,
          status: 'non-compliant',
          details: `${cat.name} at ${actualPercent.toFixed(1)}% exceeds ${rule.maxPercent}% limit`,
          detailsRo: `${cat.nameRo ?? cat.name} la ${actualPercent.toFixed(1)}% depășește limita de ${rule.maxPercent}%`,
          regulation: `EU Financial Regulation Art. 186`,
          requiredAction: `Reduce ${cat.name} spending to below ${rule.maxPercent}%`,
        });
      } else if (actualPercent > rule.maxPercent * 0.9) {
        checks.push({
          rule: `${cat.name} percentage warning`,
          status: 'warning',
          details: `${cat.name} at ${actualPercent.toFixed(1)}% - approaching ${rule.maxPercent}% limit`,
          detailsRo: `${cat.nameRo ?? cat.name} la ${actualPercent.toFixed(1)}% - se apropie de limita de ${rule.maxPercent}%`,
          regulation: `EU Financial Regulation Art. 186`,
        });
      } else {
        checks.push({
          rule: `${cat.name} percentage`,
          status: 'compliant',
          details: `${cat.name} at ${actualPercent.toFixed(1)}% - within ${rule.maxPercent}% limit`,
          detailsRo: `${cat.nameRo ?? cat.name} la ${actualPercent.toFixed(1)}% - în limita de ${rule.maxPercent}%`,
          regulation: `EU Financial Regulation`,
        });
      }
    }
  }

  // Co-financing check
  const totalSpent = categories.reduce((sum, c) => sum + c.spent, 0);
  const euContribution = totalSpent * coFinancingRate;
  const ownContribution = totalSpent - euContribution;
  const ownContributionPercent = (ownContribution / Math.max(1, totalSpent)) * 100;
  const requiredOwnPercent = (1 - coFinancingRate) * 100;

  checks.push({
    rule: 'Co-financing ratio',
    status: Math.abs(ownContributionPercent - requiredOwnPercent) < 2 ? 'compliant' : 'warning',
    details: `Own contribution: ${ownContributionPercent.toFixed(1)}% (required: ${requiredOwnPercent.toFixed(1)}%)`,
    detailsRo: `Contribuție proprie: ${ownContributionPercent.toFixed(1)}% (necesar: ${requiredOwnPercent.toFixed(1)}%)`,
    regulation: 'Grant Agreement Art. 5',
  });

  return checks;
}

// ─── Currency Risk Assessment ────────────────────────────────────

function assessCurrencyRisk(input: BudgetIntelligenceInput): CurrencyRisk {
  const currentRate = input.exchangeRate ?? 4.97; // EUR to RON approximate
  const romanianExposure = input.romanianPartnerBudgetRON ?? 0;
  const exposureEUR = romanianExposure / currentRate;

  // Simple volatility model (RON/EUR typically ±2-3% annual)
  const volatilityPercent = 3;
  const projectedLow = currentRate * (1 - volatilityPercent / 100);
  const projectedHigh = currentRate * (1 + volatilityPercent / 100);
  const potentialLoss = Math.round(exposureEUR * (volatilityPercent / 100));

  const volatilityLevel: CurrencyRisk['volatilityLevel'] =
    volatilityPercent > 5 ? 'high' : volatilityPercent > 2 ? 'medium' : 'low';

  return {
    baseCurrency: 'EUR',
    localCurrency: 'RON',
    currentRate,
    projectedRateRange: { low: Math.round(projectedLow * 100) / 100, high: Math.round(projectedHigh * 100) / 100 },
    exposureAmount: Math.round(exposureEUR),
    potentialLoss,
    hedgingRecommendation: potentialLoss > 10000
      ? 'Consider forward contracts or natural hedging by matching RON revenues with RON expenses.'
      : 'Currency exposure is manageable. Monitor quarterly.',
    hedgingRecommendationRo: potentialLoss > 10000
      ? 'Luați în considerare contracte forward sau acoperire naturală prin potrivirea veniturilor RON cu cheltuielile RON.'
      : 'Expunerea valutară este gestionabilă. Monitorizați trimestrial.',
    volatilityLevel,
  };
}

// ─── Burn Rate Analysis ──────────────────────────────────────────

function analyzeBurnRate(input: BudgetIntelligenceInput): BurnRateAnalysis {
  const now = new Date(input.currentDate ?? new Date().toISOString());
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  const totalMonths = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));
  const elapsedMonths = Math.max(1, Math.round((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30)));

  const totalSpent = input.categories.reduce((sum, c) => sum + c.spent, 0);
  const monthlyBurnRate = totalSpent / elapsedMonths;
  const remaining = input.totalBudget - totalSpent;
  const runwayMonths = monthlyBurnRate > 0 ? Math.round(remaining / monthlyBurnRate) : totalMonths;

  const exhaustionDate = new Date(now);
  exhaustionDate.setMonth(exhaustionDate.getMonth() + runwayMonths);

  // Expected monthly spend
  const expectedMonthlySpend = input.totalBudget / totalMonths;
  const expectedSpentSoFar = expectedMonthlySpend * elapsedMonths;
  const isOnTrack = Math.abs(totalSpent - expectedSpentSoFar) / Math.max(1, expectedSpentSoFar) < 0.2;

  // Monthly breakdown from categories
  const monthlyBreakdown: BurnRateAnalysis['monthlyBreakdown'] = [];
  const monthlyMap = new Map<string, { planned: number; actual: number }>();

  for (const cat of input.categories) {
    for (const ms of cat.monthlySpending ?? []) {
      const existing = monthlyMap.get(ms.month) ?? { planned: 0, actual: 0 };
      existing.actual += ms.amount;
      existing.planned += cat.allocated / Math.max(1, totalMonths);
      monthlyMap.set(ms.month, existing);
    }
  }

  for (const [month, data] of monthlyMap) {
    monthlyBreakdown.push({ month, ...data });
  }
  monthlyBreakdown.sort((a, b) => a.month.localeCompare(b.month));

  // Trend detection
  const recentMonths = monthlyBreakdown.slice(-3);
  let trend: BurnRateAnalysis['burnRateTrend'] = 'stable';
  if (recentMonths.length >= 2) {
    const first = recentMonths[0].actual;
    const last = recentMonths[recentMonths.length - 1].actual;
    if (last > first * 1.15) trend = 'increasing';
    else if (last < first * 0.85) trend = 'decreasing';
  }

  return {
    monthlyBurnRate: Math.round(monthlyBurnRate),
    projectedExhaustionDate: exhaustionDate.toISOString().slice(0, 10),
    budgetRunway: runwayMonths,
    burnRateTrend: trend,
    monthlyBreakdown,
    isOnTrack,
  };
}

// ─── Inflation Impact ────────────────────────────────────────────

function calculateInflationImpact(input: BudgetIntelligenceInput): InflationImpact {
  const inflationRate = input.inflationRate ?? 6.5; // Romanian CPI default
  const end = new Date(input.endDate);
  const now = new Date(input.currentDate ?? new Date().toISOString());
  const remainingYears = Math.max(0, (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365));

  const remaining = input.totalBudget - input.categories.reduce((sum, c) => sum + c.spent, 0);
  const inflationMultiplier = Math.pow(1 + inflationRate / 100, remainingYears);
  const projectedIncrease = Math.round(remaining * (inflationMultiplier - 1));

  // Categories most affected by inflation
  const inflationSensitive: Record<string, number> = {
    'personnel': 1.0,
    'travel': 0.8,
    'equipment': 0.6,
    'other-goods': 0.7,
    'subcontracting': 0.5,
    'indirect': 0.4,
  };

  const affectedCategories = input.categories.map(cat => ({
    category: cat.name,
    impact: Math.round((cat.allocated - cat.spent) * (inflationMultiplier - 1) * (inflationSensitive[cat.euCostCategory] ?? 0.5)),
  })).filter(c => c.impact > 0).sort((a, b) => b.impact - a.impact);

  return {
    annualInflationRate: inflationRate,
    projectedCostIncrease: projectedIncrease,
    affectedCategories,
    adjustmentRecommendation: projectedIncrease > input.totalBudget * 0.05
      ? `Inflation may erode €${projectedIncrease.toLocaleString()} of purchasing power. Front-load procurement and consider inflation clauses in contracts.`
      : 'Inflation impact is manageable within current budget margins.',
    adjustmentRecommendationRo: projectedIncrease > input.totalBudget * 0.05
      ? `Inflația poate eroda €${projectedIncrease.toLocaleString()} din puterea de cumpărare. Accelerați achizițiile și includeți clauze de inflație în contracte.`
      : 'Impactul inflației este gestionabil în marjele bugetare actuale.',
  };
}

// ─── Cost Optimization ───────────────────────────────────────────

function generateCostOptimizations(input: BudgetIntelligenceInput): CostRecommendation[] {
  const recommendations: CostRecommendation[] = [];
  const totalBudget = input.totalBudget;

  for (const cat of input.categories) {
    const utilizationRate = cat.spent / Math.max(1, cat.allocated);
    const now = new Date(input.currentDate ?? new Date().toISOString());
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    const timeProgress = (now.getTime() - start.getTime()) / Math.max(1, end.getTime() - start.getTime());

    // Underutilization
    if (utilizationRate < timeProgress * 0.6 && cat.allocated > totalBudget * 0.05) {
      recommendations.push({
        category: cat.name,
        currentSpend: cat.spent,
        recommendedSpend: Math.round(cat.allocated * timeProgress),
        savingsPotential: 0,
        priority: 'medium',
        action: `${cat.name} is underspent (${(utilizationRate * 100).toFixed(0)}% used at ${(timeProgress * 100).toFixed(0)}% timeline). Accelerate spending or risk decommitment.`,
        actionRo: `${cat.nameRo ?? cat.name} este subcheltuit (${(utilizationRate * 100).toFixed(0)}% utilizat la ${(timeProgress * 100).toFixed(0)}% din cronologie). Accelerați cheltuielile sau riscați decomiterea.`,
        complianceImpact: 'negative',
      });
    }

    // Overutilization
    if (utilizationRate > timeProgress * 1.3 && timeProgress > 0.2) {
      const overSpend = cat.spent - cat.allocated * timeProgress;
      recommendations.push({
        category: cat.name,
        currentSpend: cat.spent,
        recommendedSpend: Math.round(cat.allocated * timeProgress),
        savingsPotential: Math.round(overSpend * 0.3),
        priority: utilizationRate > 0.9 ? 'high' : 'medium',
        action: `${cat.name} spending is ${(utilizationRate * 100).toFixed(0)}% at ${(timeProgress * 100).toFixed(0)}% timeline. Slow burn rate to avoid early exhaustion.`,
        actionRo: `Cheltuielile ${cat.nameRo ?? cat.name} sunt ${(utilizationRate * 100).toFixed(0)}% la ${(timeProgress * 100).toFixed(0)}% din cronologie. Reduceți rata de consum.`,
        complianceImpact: 'none',
      });
    }
  }

  // Indirect costs optimization
  const indirectCat = input.categories.find(c => c.euCostCategory === 'indirect');
  if (indirectCat) {
    const directEligible = input.categories
      .filter(c => c.euCostCategory !== 'indirect' && c.euCostCategory !== 'subcontracting')
      .reduce((sum, c) => sum + c.spent, 0);
    const optimalIndirect = directEligible * 0.25;
    if (indirectCat.spent < optimalIndirect * 0.8) {
      recommendations.push({
        category: 'Indirect Costs',
        currentSpend: indirectCat.spent,
        recommendedSpend: Math.round(optimalIndirect),
        savingsPotential: 0,
        priority: 'low',
        action: `Indirect costs claim only €${indirectCat.spent.toLocaleString()} of eligible €${Math.round(optimalIndirect).toLocaleString()}. Ensure all indirect costs are claimed.`,
        actionRo: `Costurile indirecte revendică doar €${indirectCat.spent.toLocaleString()} din €${Math.round(optimalIndirect).toLocaleString()} eligibil. Asigurați revendicarea tuturor costurilor indirecte.`,
        complianceImpact: 'positive',
      });
    }
  }

  return recommendations.sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority];
  });
}

// ─── Budget Risks ────────────────────────────────────────────────

function identifyBudgetRisks(
  input: BudgetIntelligenceInput,
  burnRate: BurnRateAnalysis,
  currency: CurrencyRisk,
  inflation: InflationImpact
): BudgetRisk[] {
  const risks: BudgetRisk[] = [];

  // Burn rate risk
  if (!burnRate.isOnTrack) {
    const totalSpent = input.categories.reduce((sum, c) => sum + c.spent, 0);
    if (totalSpent > input.totalBudget * 0.5 && burnRate.burnRateTrend === 'increasing') {
      risks.push({
        category: 'Overall Budget',
        riskType: 'overrun',
        severity: 'high',
        probability: 0.6,
        potentialImpact: Math.round(burnRate.monthlyBurnRate * 3),
        description: `Budget burn rate is increasing. At current rate, budget exhausts by ${burnRate.projectedExhaustionDate}.`,
        descriptionRo: `Rata de consum bugetar crește. La rata actuală, bugetul se epuizează până la ${burnRate.projectedExhaustionDate}.`,
        mitigation: 'Review all discretionary spending. Implement monthly budget reviews.',
      });
    }
  }

  // Currency risk
  if (currency.potentialLoss > 5000) {
    risks.push({
      category: 'Currency',
      riskType: 'currency',
      severity: currency.potentialLoss > 50000 ? 'high' : 'medium',
      probability: 0.4,
      potentialImpact: currency.potentialLoss,
      description: `EUR/RON exposure: potential loss of €${currency.potentialLoss.toLocaleString()}`,
      descriptionRo: `Expunere EUR/RON: pierdere potențială de €${currency.potentialLoss.toLocaleString()}`,
      mitigation: currency.hedgingRecommendation,
    });
  }

  // Inflation risk
  if (inflation.projectedCostIncrease > input.totalBudget * 0.03) {
    risks.push({
      category: 'Inflation',
      riskType: 'inflation',
      severity: inflation.projectedCostIncrease > input.totalBudget * 0.1 ? 'high' : 'medium',
      probability: 0.7,
      potentialImpact: inflation.projectedCostIncrease,
      description: `Romanian inflation (${inflation.annualInflationRate}%) may increase costs by €${inflation.projectedCostIncrease.toLocaleString()}`,
      descriptionRo: `Inflația românească (${inflation.annualInflationRate}%) poate crește costurile cu €${inflation.projectedCostIncrease.toLocaleString()}`,
      mitigation: inflation.adjustmentRecommendation,
    });
  }

  // Category-specific risks
  for (const cat of input.categories) {
    if (cat.spent + cat.committed > cat.allocated) {
      risks.push({
        category: cat.name,
        riskType: 'overrun',
        severity: 'high',
        probability: 0.9,
        potentialImpact: (cat.spent + cat.committed) - cat.allocated,
        description: `${cat.name}: committed + spent (€${(cat.spent + cat.committed).toLocaleString()}) exceeds allocation (€${cat.allocated.toLocaleString()})`,
        descriptionRo: `${cat.nameRo ?? cat.name}: angajat + cheltuit (€${(cat.spent + cat.committed).toLocaleString()}) depășește alocarea (€${cat.allocated.toLocaleString()})`,
        mitigation: 'Request budget transfer between categories or reduce commitments.',
      });
    }
  }

  return risks.sort((a, b) => {
    const sev = { critical: 0, high: 1, medium: 2, low: 3 };
    return sev[a.severity] - sev[b.severity];
  });
}

// ─── Audit Readiness ─────────────────────────────────────────────

function assessAuditReadiness(input: BudgetIntelligenceInput, complianceChecks: ComplianceCheck[]): AuditReadinessScore {
  const issues: string[] = [];
  const nonCompliant = complianceChecks.filter(c => c.status === 'non-compliant');
  const warnings = complianceChecks.filter(c => c.status === 'warning');

  if (nonCompliant.length > 0) {
    issues.push(`${nonCompliant.length} non-compliant cost categories`);
  }
  if (warnings.length > 0) {
    issues.push(`${warnings.length} compliance warnings need attention`);
  }

  // Check documentation (simplified - would check actual documents in production)
  const categoriesWithSpending = input.categories.filter(c => c.spent > 0);
  const hasMonthlyTracking = categoriesWithSpending.every(c => (c.monthlySpending?.length ?? 0) > 0);
  if (!hasMonthlyTracking) {
    issues.push('Monthly spending breakdown incomplete for some categories');
  }

  // Partner reporting
  const romanianPartners = input.partners.filter(p => p.isRomanian);
  if (romanianPartners.length > 0 && !input.exchangeRate) {
    issues.push('EUR/RON exchange rate not documented for Romanian partner costs');
  }

  const score = Math.max(0, 100 - nonCompliant.length * 20 - warnings.length * 5 - issues.length * 5);

  return {
    score,
    documentationComplete: hasMonthlyTracking,
    trailIntegrity: nonCompliant.length === 0,
    categoryCompliance: nonCompliant.length === 0 && warnings.length <= 2,
    issues,
  };
}

// ─── Main Analysis ───────────────────────────────────────────────

export async function analyzeBudget(input: BudgetIntelligenceInput): Promise<BudgetAnalysis> {
  const burnRateAnalysis = analyzeBurnRate(input);
  const currencyRisk = assessCurrencyRisk(input);
  const inflationImpact = calculateInflationImpact(input);
  const complianceStatus = validateCostCompliance(input.categories, input.totalBudget, input.coFinancingRate);
  const costOptimization = generateCostOptimizations(input);
  const riskAnalysis = identifyBudgetRisks(input, burnRateAnalysis, currencyRisk, inflationImpact);
  const auditReadiness = assessAuditReadiness(input, complianceStatus);

  // Partner allocation check
  const totalPartnerAllocated = input.partners.reduce((sum, p) => sum + p.allocated, 0);
  const partnerAllocationOptimal = Math.abs(totalPartnerAllocated - input.totalBudget) / Math.max(1, input.totalBudget) < 0.05;

  // Forecast accuracy (based on burn rate stability)
  const forecastAccuracy = burnRateAnalysis.isOnTrack
    ? Math.min(95, 80 + (burnRateAnalysis.burnRateTrend === 'stable' ? 15 : 5))
    : Math.max(40, 70 - riskAnalysis.filter(r => r.severity === 'high').length * 10);

  // Overall health
  const overallBudgetHealth = Math.round(
    (auditReadiness.score * 0.25) +
    (forecastAccuracy * 0.25) +
    (100 - riskAnalysis.filter(r => r.severity === 'high' || r.severity === 'critical').length * 15) * 0.25 +
    (burnRateAnalysis.isOnTrack ? 25 : 10)
  );

  return {
    costOptimization,
    riskAnalysis,
    forecastAccuracy: Math.round(forecastAccuracy),
    complianceStatus,
    currencyRiskAssessment: currencyRisk,
    partnerAllocationOptimal,
    burnRateAnalysis,
    inflationImpact,
    auditReadiness,
    overallBudgetHealth: Math.max(0, Math.min(100, overallBudgetHealth)),
  };
}

// ─── Quick Budget Health ─────────────────────────────────────────

export function quickBudgetHealth(totalBudget: number, spent: number, elapsedPercent: number): {
  score: number;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
} {
  const spentPercent = (spent / Math.max(1, totalBudget)) * 100;
  const deviation = Math.abs(spentPercent - elapsedPercent);

  if (deviation < 10) return { score: 90, status: 'healthy', message: 'Budget on track' };
  if (deviation < 25) return { score: 65, status: 'warning', message: `Budget deviation: ${deviation.toFixed(0)}%` };
  return { score: 35, status: 'critical', message: `Significant budget deviation: ${deviation.toFixed(0)}%` };
}
