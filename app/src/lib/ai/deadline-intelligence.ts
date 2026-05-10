// ─── Smart Deadline & Risk Management Engine ────────────────────
// Analyzes project timelines, calculates completion probability,
// identifies bottlenecks and generates bilingual risk alerts.

import { z } from 'zod';
import { aiGenerateObject } from './client';

// ─── Types ───────────────────────────────────────────────────────

export interface DeadlineAnalysis {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  daysUntilDeadline: number;
  completionProbability: number; // 0-1
  riskFactors: string[];
  recommendations: string[];
  mitigationSteps: string[];
  bottlenecks: Bottleneck[];
  timeline: TimelineAssessment;
}

export interface Bottleneck {
  workPackageId: string;
  workPackageName: string;
  issue: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  blockedBy?: string[];
  suggestedAction: string;
}

export interface TimelineAssessment {
  overallProgress: number; // 0-100
  expectedCompletionDate: string;
  isOnTrack: boolean;
  delayDays: number;
  criticalPath: string[];
}

export interface WorkPackageStatus {
  id: string;
  name: string;
  plannedStart: string;
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  progress: number; // 0-100
  dependencies: string[];
  budget: number;
  spent: number;
  deliverables: { name: string; completed: boolean; dueDate: string }[];
  assignedPartner?: string;
}

export interface ProjectDeadlineInput {
  projectId: string;
  projectTitle: string;
  submissionDeadline?: string;
  projectStart?: string;
  projectEnd?: string;
  workPackages: WorkPackageStatus[];
  currentDate?: string;
  locale?: 'ro' | 'en';
}

// ─── AI Schema ───────────────────────────────────────────────────

const deadlineAnalysisSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  completionProbability: z.number().min(0).max(1),
  riskFactors: z.array(z.string()),
  recommendations: z.array(z.string()),
  mitigationSteps: z.array(z.string()),
  bottlenecks: z.array(z.object({
    workPackageId: z.string(),
    workPackageName: z.string(),
    issue: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    blockedBy: z.array(z.string()).optional(),
    suggestedAction: z.string(),
  })),
  criticalPath: z.array(z.string()),
  overallAssessment: z.string(),
});

// ─── Deterministic Analysis ──────────────────────────────────────

function calculateDaysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function calculateOverallProgress(wps: WorkPackageStatus[]): number {
  if (wps.length === 0) return 0;
  const totalBudget = wps.reduce((s, wp) => s + wp.budget, 0);
  if (totalBudget === 0) {
    return wps.reduce((s, wp) => s + wp.progress, 0) / wps.length;
  }
  // Weighted by budget
  return wps.reduce((s, wp) => s + wp.progress * (wp.budget / totalBudget), 0);
}

function calculateExpectedProgress(
  projectStart: string,
  projectEnd: string,
  currentDate?: string,
): number {
  const start = new Date(projectStart).getTime();
  const end = new Date(projectEnd).getTime();
  const now = currentDate ? new Date(currentDate).getTime() : Date.now();
  const total = end - start;
  if (total <= 0) return 100;
  const elapsed = now - start;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function detectDependencyBottlenecks(wps: WorkPackageStatus[]): Bottleneck[] {
  const wpMap = new Map(wps.map(wp => [wp.id, wp]));
  const bottlenecks: Bottleneck[] = [];

  for (const wp of wps) {
    // Check if dependencies are blocking
    const blockingDeps = wp.dependencies.filter(depId => {
      const dep = wpMap.get(depId);
      return dep && dep.progress < 100;
    });

    if (blockingDeps.length > 0 && wp.progress < 20) {
      bottlenecks.push({
        workPackageId: wp.id,
        workPackageName: wp.name,
        issue: `Blocked by incomplete dependencies: ${blockingDeps.join(', ')}`,
        severity: blockingDeps.length > 2 ? 'critical' : 'high',
        blockedBy: blockingDeps,
        suggestedAction: `Prioritize completion of ${blockingDeps[0]} to unblock this work package`,
      });
    }

    // Check budget overrun
    if (wp.budget > 0 && wp.spent > wp.budget * 0.8 && wp.progress < 60) {
      bottlenecks.push({
        workPackageId: wp.id,
        workPackageName: wp.name,
        issue: `Budget consumption (${Math.round(wp.spent / wp.budget * 100)}%) exceeds progress (${wp.progress}%)`,
        severity: wp.spent > wp.budget ? 'critical' : 'high',
        suggestedAction: 'Review spending and reallocate budget or reduce scope',
      });
    }

    // Check overdue deliverables
    const overdue = wp.deliverables.filter(d => !d.completed && new Date(d.dueDate) < new Date());
    if (overdue.length > 0) {
      bottlenecks.push({
        workPackageId: wp.id,
        workPackageName: wp.name,
        issue: `${overdue.length} overdue deliverable(s): ${overdue.map(d => d.name).join(', ')}`,
        severity: overdue.length > 2 ? 'critical' : 'medium',
        suggestedAction: `Fast-track delivery of: ${overdue[0].name}`,
      });
    }
  }

  return bottlenecks;
}

function determineDeterministicRiskLevel(
  progressGap: number,
  daysUntilDeadline: number,
  bottleneckCount: number,
): 'low' | 'medium' | 'high' | 'critical' {
  if (daysUntilDeadline < 0) return 'critical';
  if (daysUntilDeadline < 7 && progressGap > 20) return 'critical';
  if (progressGap > 30 || bottleneckCount > 3) return 'high';
  if (progressGap > 15 || bottleneckCount > 1) return 'medium';
  return 'low';
}

// ─── Main Analysis Function ──────────────────────────────────────

export async function analyzeDeadlines(input: ProjectDeadlineInput): Promise<DeadlineAnalysis> {
  const isRo = input.locale !== 'en';
  const now = input.currentDate || new Date().toISOString().split('T')[0];

  // Deterministic calculations
  const deadline = input.submissionDeadline || input.projectEnd || now;
  const daysUntilDeadline = calculateDaysUntil(deadline);
  const overallProgress = calculateOverallProgress(input.workPackages);

  const expectedProgress = input.projectStart && input.projectEnd
    ? calculateExpectedProgress(input.projectStart, input.projectEnd, now)
    : 50;

  const progressGap = expectedProgress - overallProgress;
  const bottlenecks = detectDependencyBottlenecks(input.workPackages);

  const deterministicRisk = determineDeterministicRiskLevel(
    progressGap,
    daysUntilDeadline,
    bottlenecks.length,
  );

  // Build AI prompt for deeper analysis
  const wpSummary = input.workPackages.map(wp =>
    `- ${wp.name} (${wp.id}): ${wp.progress}% complete, budget ${wp.spent}/${wp.budget}€, ` +
    `deps: [${wp.dependencies.join(', ')}], deliverables: ${wp.deliverables.filter(d => d.completed).length}/${wp.deliverables.length} done`
  ).join('\n');

  const systemPrompt = isRo
    ? `Ești un expert în managementul proiectelor UE cu experiență în România. Analizează riscurile legate de termenele limită ale proiectului și oferă recomandări specifice și acționabile. Ia în considerare contextul românesc: întârzieri guvernamentale, birocrație, termene de achiziții publice. Răspunde în limba română.`
    : `You are an EU project management expert with Romanian context expertise. Analyze project deadline risks and provide specific, actionable recommendations. Consider Romanian context: government delays, bureaucracy, public procurement timelines. Respond in English.`;

  const prompt = `Analyze this EU-funded project for deadline risks:

Project: ${input.projectTitle}
Deadline: ${deadline} (${daysUntilDeadline} days remaining)
Overall Progress: ${overallProgress.toFixed(1)}% (expected: ${expectedProgress.toFixed(1)}%)
Progress Gap: ${progressGap.toFixed(1)} percentage points ${progressGap > 0 ? 'behind' : 'ahead'}

Work Packages:
${wpSummary}

Known Bottlenecks (deterministic):
${bottlenecks.map(b => `- [${b.severity}] ${b.workPackageName}: ${b.issue}`).join('\n') || 'None detected'}

Provide risk analysis with specific recommendations for this project context.`;

  try {
    const aiResult = await aiGenerateObject({
      system: systemPrompt,
      prompt,
      schema: deadlineAnalysisSchema,
      schemaName: 'DeadlineAnalysis',
      temperature: 0.3,
      taskType: 'classification',
    });

    const ai = aiResult.object;

    if (!ai) {
      throw new Error('AI analysis failed to produce valid result');
    }

    // Merge deterministic + AI analysis
    const allBottlenecks = [
      ...bottlenecks,
      ...ai.bottlenecks.filter(ab =>
        !bottlenecks.some(b => b.workPackageId === ab.workPackageId && b.issue === ab.issue)
      ),
    ];

    // Use worse of deterministic vs AI risk
    const riskOrder = ['low', 'medium', 'high', 'critical'] as const;
    const finalRisk = riskOrder[Math.max(
      riskOrder.indexOf(deterministicRisk),
      riskOrder.indexOf(ai.riskLevel),
    )];

    return {
      riskLevel: finalRisk,
      daysUntilDeadline,
      completionProbability: ai.completionProbability,
      riskFactors: ai.riskFactors,
      recommendations: ai.recommendations,
      mitigationSteps: ai.mitigationSteps,
      bottlenecks: allBottlenecks,
      timeline: {
        overallProgress,
        expectedCompletionDate: deadline,
        isOnTrack: progressGap <= 5,
        delayDays: Math.max(0, Math.round(progressGap / 100 * daysUntilDeadline)),
        criticalPath: ai.criticalPath,
      },
    };
  } catch {
    // Fallback to deterministic-only analysis
    return {
      riskLevel: deterministicRisk,
      daysUntilDeadline,
      completionProbability: Math.max(0, 1 - progressGap / 100),
      riskFactors: bottlenecks.map(b => b.issue),
      recommendations: bottlenecks.map(b => b.suggestedAction),
      mitigationSteps: [],
      bottlenecks,
      timeline: {
        overallProgress,
        expectedCompletionDate: deadline,
        isOnTrack: progressGap <= 5,
        delayDays: Math.max(0, Math.round(progressGap / 100 * daysUntilDeadline)),
        criticalPath: [],
      },
    };
  }
}

// ─── Quick Risk Check (lightweight, no AI call) ──────────────────

export function quickRiskCheck(wps: WorkPackageStatus[], deadline: string): {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  progress: number;
  daysRemaining: number;
  alerts: string[];
} {
  const daysRemaining = calculateDaysUntil(deadline);
  const progress = calculateOverallProgress(wps);
  const bottlenecks = detectDependencyBottlenecks(wps);
  const alerts: string[] = [];

  if (daysRemaining < 0) alerts.push('Deadline has passed!');
  if (daysRemaining < 14 && progress < 80) alerts.push('Less than 2 weeks with <80% progress');
  bottlenecks.filter(b => b.severity === 'critical').forEach(b => alerts.push(b.issue));

  return {
    riskLevel: determineDeterministicRiskLevel(
      50 - progress, // simplified gap
      daysRemaining,
      bottlenecks.length,
    ),
    progress,
    daysRemaining,
    alerts,
  };
}
