// ─── AI Module Exports ───────────────────────────────────────────
export { AI_CONFIG } from './config';
export { aiGenerate, aiGenerateObject, aiEmbed, aiEmbedBatch, queryRomanianBert } from './client';
export { generateProposal, proposalInputSchema, type ProposalInput, type ProposalOutput } from './proposal-generator';
export { analyzeDocument, detectPII, type AnalysisInput, type AnalysisResult, type PIIDetection } from './document-analyzer';
export { matchGrants, type MatchInput, type MatchResult, type FundingCall } from './grant-matcher';
export { validateCompliance, type ComplianceInput, type ComplianceResult } from './compliance-validator';
