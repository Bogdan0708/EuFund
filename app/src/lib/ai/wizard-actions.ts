// ─── Shared Wizard Actions ───────────────────────────────────────
// Reusable business logic for the AI project wizard.
// Used by both the step-by-step wizard routes and the conversational chat route.

import { db } from '@/lib/db';
import { callsForProposals, fundingPrograms, projects, projectVersions, workPackages } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { aiGenerate } from './client';
import { matchGrants, type FundingCall, type MatchResult } from './grant-matcher';
import { generateProposal, type ProposalOutput } from './proposal-generator';
import { factCheckGeneratedContent } from './fact-checker';
import { withEUAIActCompliance } from './eu-ai-act';
import { sanitizeAIOutput } from './sanitize';
import { Errors } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'wizard-actions' });

type ProgramType = 'horizon_europe' | 'interreg' | 'life_plus' | 'pocidif' | 'pnrr' | 'general';

const PROGRAM_MAP: Record<string, ProgramType> = {
  'HORIZON-EUROPE': 'horizon_europe',
  'LIFE-PLUS': 'life_plus',
  'INTERREG-VI': 'interreg',
  POCIDIF: 'pocidif',
  PNRR: 'pnrr',
};

// ─── Enhance Idea ────────────────────────────────────────────────

export interface EnhanceResult {
  enhancedIdea: string;
  suggestions: string[];
  structuredSummary: string;
  originalIdea: string;
}

export async function enhanceProjectIdea(
  projectIdea: string,
  locale: string = 'ro',
): Promise<EnhanceResult> {
  const system = locale === 'ro'
    ? 'Ești un expert în consultanță pentru fonduri europene. Rolul tău este să rafinezi o idee de proiect brută, să o structurezi și să o faci să sune profesionist și eligibil.'
    : 'You are an expert EU funds consultant. Your role is to refine a raw project idea, structure it, and make it sound professional and eligible.';

  const prompt = locale === 'ro'
    ? `Rafinează următoarea idee de proiect: "${projectIdea}". Returnează în format clar:
1) Idee îmbunătățită
2) 3-5 sugestii concrete
3) Rezumat structurat cu: problema, obiectiv, activități, impact`
    : `Refine the following project idea: "${projectIdea}". Return in clear format:
1) Enhanced idea
2) 3-5 concrete suggestions
3) Structured summary with: problem, objective, activities, impact`;

  const response = await aiGenerate({ system, prompt, temperature: 0.7 });
  const { sanitized } = sanitizeAIOutput(response.text);
  const lines = sanitized
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean);
  const suggestions = lines
    .filter((line: string) => /^[-*•]|^\d+[.)]/.test(line))
    .slice(0, 5);
  const structuredSummary = lines.slice(0, 4).join('\n');

  return {
    enhancedIdea: sanitized,
    suggestions,
    structuredSummary,
    originalIdea: projectIdea,
  };
}

// ─── Match Funding Calls ─────────────────────────────────────────

export interface MatchCallsResult {
  matches: MatchResult[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  aiAct: any;
}

export async function matchFundingCalls(
  projectIdea: string,
  organization: { orgType: string; employeeCount?: number; annualRevenue?: number },
  budget: number | undefined,
  locale: 'ro' | 'en' = 'ro',
  userId: string,
): Promise<MatchCallsResult> {
  // Fetch active calls from DB
  const dbCalls = await db.select({
    id: callsForProposals.id,
    callCode: callsForProposals.callCode,
    titleRo: callsForProposals.titleRo,
    descriptionRo: callsForProposals.descriptionRo,
    programName: fundingPrograms.nameRo,
    eligibleTypes: callsForProposals.eligibleTypes,
    eligibleRegions: callsForProposals.eligibleRegions,
    eligibleCaen: callsForProposals.eligibleCaen,
    budgetMin: callsForProposals.budgetMin,
    budgetMax: callsForProposals.budgetMax,
    cofinancingRate: callsForProposals.cofinancingRate,
    durationMin: callsForProposals.durationMin,
    durationMax: callsForProposals.durationMax,
    submissionEnd: callsForProposals.submissionEnd,
    status: callsForProposals.status,
  })
    .from(callsForProposals)
    .innerJoin(fundingPrograms, eq(callsForProposals.programId, fundingPrograms.id))
    .where(inArray(callsForProposals.status, ['deschis', 'previzionat']))
    .limit(50);

  const mappedCalls: FundingCall[] = dbCalls.map((c) => ({
    id: c.id,
    callCode: c.callCode,
    titleRo: c.titleRo,
    descriptionRo: c.descriptionRo ?? undefined,
    programName: c.programName,
    eligibleTypes: c.eligibleTypes ?? undefined,
    eligibleRegions: c.eligibleRegions ?? undefined,
    eligibleCaen: c.eligibleCaen ?? undefined,
    budgetMin: c.budgetMin ? Number(c.budgetMin) : undefined,
    budgetMax: c.budgetMax ? Number(c.budgetMax) : undefined,
    cofinancingRate: c.cofinancingRate ? Number(c.cofinancingRate) : undefined,
    durationMin: c.durationMin ?? undefined,
    durationMax: c.durationMax ?? undefined,
    submissionStart: undefined,
    submissionEnd: c.submissionEnd ? c.submissionEnd.toISOString() : undefined,
    status: c.status ?? 'deschis',
  }));

  if (mappedCalls.length === 0) {
    return { matches: [], aiAct: null };
  }

  const matcherInput = { projectIdea, organization, budget, locale };

  const runWithCompliance = withEUAIActCompliance<typeof matcherInput>(
    'match-grants',
    async (payload) => {
      const result = await matchGrants(payload, mappedCalls);
      return {
        result,
        confidence: Math.max(0.3, Math.min(0.95, (result.matches[0]?.overallScore ?? 0) / 100)),
      };
    },
  );

  const execution = await runWithCompliance(matcherInput, userId);
  const result = execution.result as Awaited<ReturnType<typeof matchGrants>>;

  return {
    matches: result.matches,
    aiAct: execution.metadata,
  };
}

// ─── Generate Proposal ───────────────────────────────────────────

export interface GenerateProposalResult {
  proposal: ProposalOutput;
  metadata: {
    tokensUsed: number;
    ragSourcesUsed: number;
    factCheck: {
      confidenceScore: number;
      references: string[];
      unverifiableClaims: string[];
    };
  };
}

export async function generateProjectProposal(
  projectIdea: string,
  callId: string,
  organization: { orgName: string; orgType: string; sector?: string },
  locale: string = 'ro',
): Promise<GenerateProposalResult> {
  const call = await db.query.callsForProposals.findFirst({
    where: eq(callsForProposals.id, callId),
    with: { program: true },
  });

  if (!call) {
    throw Errors.notFound('call', callId);
  }

  const proposal = await generateProposal({
    projectIdea,
    programType: PROGRAM_MAP[call.program.code] ?? 'general',
    organizationName: organization.orgName,
    organizationType: organization.orgType,
    sector: organization.sector,
    locale: locale as 'ro' | 'en',
    callId,
  });

  const factCheck = factCheckGeneratedContent(proposal.proposal, {
    expectedProgram: PROGRAM_MAP[call.program.code] ?? 'general',
  });

  return {
    proposal: factCheck.annotated,
    metadata: {
      tokensUsed: proposal.tokensUsed,
      ragSourcesUsed: proposal.ragSourcesUsed,
      factCheck: {
        confidenceScore: factCheck.confidenceScore,
        references: factCheck.references,
        unverifiableClaims: factCheck.unverifiableClaims,
      },
    },
  };
}

// ─── Save Project ────────────────────────────────────────────────

export interface SaveProjectResult {
  projectId: string;
  title: string;
}

export async function saveWizardProject(
  callId: string,
  orgId: string,
  userId: string,
  proposal: ProposalOutput,
): Promise<SaveProjectResult> {
  const createdProject = await db.transaction(async (tx) => {
    const [project] = await tx.insert(projects).values({
      orgId,
      callId,
      createdBy: userId,
      title: proposal.title,
      status: 'ciorna',
      sectionSummary: proposal.summary,
      sectionObjectives: proposal.objectives,
      sectionMethodology: proposal.methodology,
      sectionBudget: proposal.budget,
      sectionIndicators: proposal.indicators,
      sectionRisks: proposal.risks,
      sectionSustainability: proposal.sustainability,
      currentVersion: 1,
    }).returning();

    if (Array.isArray(proposal.methodology?.workPackages)) {
      for (const wp of proposal.methodology.workPackages) {
        await tx.insert(workPackages).values({
          projectId: project.id,
          name: wp.name,
          description: wp.description,
          budgetAllocated: null,
          status: 'planned',
        });
      }
    }

    await tx.insert(projectVersions).values({
      projectId: project.id,
      versionNumber: 1,
      snapshot: proposal as unknown as Record<string, unknown>,
      changedBy: userId,
      changeSummary: 'Initial generation via AI Wizard',
    });

    return project;
  });

  await logAudit({
    userId,
    action: 'project.create',
    resourceType: 'project',
    resourceId: createdProject.id,
    metadata: { method: 'ai_wizard', callId },
  });

  log.info({ projectId: createdProject.id, userId }, 'Project saved via wizard');

  return {
    projectId: createdProject.id,
    title: createdProject.title,
  };
}
