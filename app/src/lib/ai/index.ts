// ─── AI Module Exports ───────────────────────────────────────────

// Core AI client (gateway-backed with circuit breaker + retry)
export { aiGenerate, aiGenerateObject, aiEmbed, aiEmbedBatch, queryRomanianBert } from './client';

export { AI_CONFIG } from './config';
export { analyzeDocument, detectPII, type AnalysisInput, type AnalysisResult, type PIIDetection } from './document-analyzer';
export { validateCompliance, type ComplianceInput, type ComplianceResult } from './compliance-validator';

// Intelligence features (active)
export { analyzeDeadlines, quickRiskCheck, type DeadlineAnalysis, type WorkPackageStatus, type ProjectDeadlineInput } from './deadline-intelligence';
export { assessRisk, type RiskAssessment, type RiskAssessmentInput, type PartnerInfo } from './risk-assessment';
export { analyzeCompliance, type ComplianceAnalysis, type ComplianceCheckInput } from './compliance-engine';
