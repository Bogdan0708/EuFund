// ─── AI Module Exports ───────────────────────────────────────────

// ==================== MULTI-PROVIDER AI SYSTEM ====================
// Enhanced multi-provider versions (backward compatible)
export { 
  aiGenerate, 
  aiGenerateObject, 
  aiEmbed, 
  aiEmbedBatch, 
  queryRomanianBert 
} from './client-v2';

// Advanced multi-provider features
export {
  aiGenerateRomanian,
  aiGenerateEconomical,
  aiGenerateUrgent,
  getAIHealthStatus,
  getAIUsageSnapshot,
  clearAICache,
  TaskType,
  // Romanian specialization
  analyzeRomanianContent,
  getRomanianAIMetrics,
  aiGenerateRomanianEUProposal
} from './client-v2';

// Multi-provider types and configuration
export type { 
  AIRequest, 
  AIResponse, 
  AIProvider,
  TaskType as TaskTypeEnum,
  UserTierLimits,
  RoutingDecision 
} from './types';

// Provider management
export { getAIOrchestrator, createDefaultConfig } from './orchestrator';
export { getAICache } from './cache';

// Legacy single-provider client (for migration)
export { 
  aiGenerate as aiGenerateLegacy,
  aiGenerateObject as aiGenerateObjectLegacy 
} from './client';

export { AI_CONFIG } from './config';
export { generateProposal, proposalInputSchema, type ProposalInput, type ProposalOutput } from './proposal-generator';
export { generateEnhancedProposal, type EnhancedProposalInput, type EUProposal, type EnhancedProposalOutput } from './enhanced-proposal-generator';
export { analyzeDocument, detectPII, type AnalysisInput, type AnalysisResult, type PIIDetection } from './document-analyzer';
export { matchGrants, type MatchInput, type MatchResult, type FundingCall } from './grant-matcher';
export { validateCompliance, type ComplianceInput, type ComplianceResult } from './compliance-validator';

// Phase 1: AI Intelligence Features
export { analyzeDeadlines, quickRiskCheck, type DeadlineAnalysis, type WorkPackageStatus, type ProjectDeadlineInput } from './deadline-intelligence';
export { assessRisk, type RiskAssessment, type RiskAssessmentInput, type PartnerInfo } from './risk-assessment';
export { analyzeCompliance, type ComplianceAnalysis, type ComplianceCheckInput } from './compliance-engine';
export { analyzeProject, getProjectHealthQuick, analyzeProjectsBatch, clearAnalysisCache, getAdvancedProjectHealth, getPredictiveIntelligence, type ProjectHealthReport, type FullProjectAnalysis, type ProjectAnalysisRequest, type ProjectHealthAnalysis, type PredictiveProjectIntelligence } from './project-intelligence';
export { EU_PROGRAMS, getProgramInfo, getEvaluationCriteria, getBudgetCategories, getProposalSections, getRomanianAdvantages, findBestProgram, type EUProgramKey } from './eu-knowledge-base';

// Phase 2: Advanced Intelligence
export { optimizeTimeline, analyzeScenario, quickFeasibilityCheck, getRomanianHolidays, type TimelineOptimization, type OptimizedTask, type Bottleneck, type ResourceConflict, type OptimizationRecommendation, type TimelineOptimizationInput, type WhatIfScenario, type ScenarioResult } from './timeline-optimizer';
export { analyzeConsortium, quickPartnerCheck, type ConsortiumAnalysis, type PartnerMetrics, type CollaborationScore, type PartnerRisk, type BudgetOptimization, type SkillGap, type ConsortiumAnalysisInput, type PartnerData } from './consortium-analytics';
export { analyzeBudget, quickBudgetHealth, type BudgetAnalysis, type CostRecommendation, type BudgetRisk, type CurrencyRisk, type BurnRateAnalysis, type BudgetIntelligenceInput } from './budget-intelligence';
export { generateReport, quickReportSummary, type ReportGeneration, type ReportInput, type FinancialReport, type ProgressReport, type RiskReport, type PartnerReport, type ComplianceReport } from './reporting-engine';
export { generateNotification, generateProjectNotifications, suggestMeetingSlots, generateCommunicationPlan, DEFAULT_ESCALATION_RULES, type SmartNotification, type NotificationInput, type MeetingSchedule, type CommunicationPlan, type UserRole, type UrgencyLevel } from './communication-engine';
export { analyzeAdvancedCompliance, type AdvancedComplianceAnalysis, type AdvancedComplianceInput, type PartnerComplianceStatus, type AuditPreparation } from './compliance-engine';
export { analyzeRomanianContext, analyzeRONCurrency, quickRomanianCheck, type RomanianContextIntelligence, type RomanianIntelligenceInput, type DelayPrediction, type ProcurementRisk, type CurrencyAnalysis } from './romanian-market-intelligence';

// Phase 3: Predictive Analytics & Intelligence
export { predictProposalSuccess, quickSuccessPrediction, type ProposalSuccessPrediction, type PredictionInput, type SuccessFactor, type Improvement, type BenchmarkData, type PredictiveRisk } from './predictive-analytics';
export { recommendPartners, quickPartnerMatch, type PartnerRecommendation, type PartnerMatchingInput, type Partner, type ConsortiumAnalysis as PartnerConsortiumAnalysis, type CapabilityGap, type GeographicOptimization, type SkillMatrix, type OptimalBudgetDistribution, type PartnershipRisk } from './partner-matching';
export { predictLifecycle, quickLifecycleCheck, type LifecyclePrediction, type LifecyclePredictionInput, type MilestoneRisk, type BudgetForecast, type PartnerForecast, type ComplianceRisk as LifecycleComplianceRisk, type SuccessEvolution, type InterventionAction } from './lifecycle-prediction';
export { generateKnowledgeRecommendations, quickQualityCheck, type KnowledgeRecommendations, type KnowledgeEngineInput, type ProposalEnhancement, type BestPractice, type LessonLearned, type SuccessPattern, type PitfallWarning, type ExpertRecommendation } from './knowledge-engine';
export { gatherMarketIntelligence, quickIntelligenceSummary, type IntegrationIntelligence, type IntelligenceInput, type EUDatabaseStatus, type MarketIntelligence, type RegulatoryChange, type CompetitorAnalysis, type OpportunityAlert } from './integration-intelligence';
export { generateAdvancedReport, quickPortfolioSummary, type AdvancedReporting, type AdvancedReportingInput, type ExecutiveReport, type PredictiveInsights, type BenchmarkReport, type PortfolioInsights, type MarketAnalysis, type StrategyRecommendation } from './advanced-reporting';
// Romanian specialization exports are handled via client-v2
