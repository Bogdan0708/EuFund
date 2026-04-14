// ─── AI Module Exports ───────────────────────────────────────────

// Core AI client (gateway-backed with circuit breaker + retry)
export { aiGenerate, aiGenerateObject, aiEmbed, aiEmbedBatch, queryRomanianBert } from './client';

export { AI_CONFIG } from './config';
export { generateProposal, proposalInputSchema, type ProposalInput, type ProposalOutput } from './proposal-generator';
export { generateEnhancedProposal, type EnhancedProposalInput, type EUProposal, type EnhancedProposalOutput } from './enhanced-proposal-generator';
export { analyzeDocument, detectPII, type AnalysisInput, type AnalysisResult, type PIIDetection } from './document-analyzer';
export { matchGrants, type MatchInput, type MatchResult, type FundingCall } from './grant-matcher';
export { validateCompliance, type ComplianceInput, type ComplianceResult } from './compliance-validator';

// Intelligence features (active)
export { analyzeDeadlines, quickRiskCheck, type DeadlineAnalysis, type WorkPackageStatus, type ProjectDeadlineInput } from './deadline-intelligence';
export { assessRisk, type RiskAssessment, type RiskAssessmentInput, type PartnerInfo } from './risk-assessment';
export { analyzeCompliance, type ComplianceAnalysis, type ComplianceCheckInput } from './compliance-engine';
export { EU_PROGRAMS, getProgramInfo, getEvaluationCriteria, getBudgetCategories, getProposalSections, getRomanianAdvantages, findBestProgram, type EUProgramKey } from './eu-knowledge-base';
export { generateReport, quickReportSummary, type ReportGeneration, type ReportInput, type FinancialReport, type ProgressReport, type RiskReport, type PartnerReport, type ComplianceReport } from './reporting-engine';
export { generateKnowledgeRecommendations, quickQualityCheck, type KnowledgeRecommendations, type KnowledgeEngineInput, type ProposalEnhancement, type BestPractice, type LessonLearned, type SuccessPattern, type PitfallWarning, type ExpertRecommendation } from './knowledge-engine';
