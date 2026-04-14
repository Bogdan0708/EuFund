# Probe 05 — `lib/ai/` root module reference sweep

**Run on:** 2026-04-14 against `master` at commit `1040228`.
**Spec reference:** Section 2, probe 5.
**Purpose:** For each file at `app/src/lib/ai/*.ts` not inside `agent/` or `orchestrator/`, count external references. Zero → presumptive delete candidate. Non-zero → callers classified first.

## Commands

```bash
find app/src/lib/ai -maxdepth 1 -name "*.ts" -type f

while IFS= read -r module_file; do
  base=$(basename "$module_file" .ts)
  rg -n "from ['\"]@/lib/ai/$base['\"]|from ['\"]\./$base['\"]|from ['\"]\.\./ai/$base['\"]" app/src app/tests app/scripts
done
```

## Per-module results

```text
# Per-module external reference counts

## Module: app/src/lib/ai/anthropic-client.ts
### Imports referencing @/lib/ai/anthropic-client or relative paths
app/src/lib/ai/agent/managed/runtime.ts:23:import { getAnthropicClient } from '@/lib/ai/anthropic-client'

## Module: app/src/lib/ai/client.ts
### Imports referencing @/lib/ai/client or relative paths
app/src/lib/integrations/ec-portal/index.ts:1:export * from './client';
app/src/lib/rag/pipeline.ts:5:import { aiGenerate } from '@/lib/ai/client';
app/src/lib/integrations/cordis/index.ts:1:export * from './client';
app/src/lib/integrations/eurlex/index.ts:1:export * from './client';
app/src/lib/integrations/eurostat/index.ts:1:export * from './client';
app/src/lib/vectors/store.ts:5:import { aiEmbed, aiEmbedBatch } from '@/lib/ai/client';
app/src/lib/ai/enhanced-proposal-generator.ts:7:import { aiGenerateObject } from './client';
app/src/lib/ai/reporting-engine.ts:5:import { aiGenerate } from './client';
app/src/lib/ai/risk-assessment.ts:6:import { aiGenerateObject } from './client';
app/src/lib/ai/compliance-validator.ts:5:import { aiGenerateObject } from './client';
app/src/lib/ai/document-analyzer.ts:5:import { aiGenerateObject } from './client';
app/src/lib/ai/compliance-engine.ts:6:import { aiGenerateObject } from './client';
app/src/lib/ai/knowledge-engine.ts:5:import { aiGenerateObject } from './client';
app/src/app/api/ai/chat/route.ts:3:import { aiGenerate } from '@/lib/ai/client';
app/src/lib/ai/index.ts:4:export { aiGenerate, aiGenerateObject, aiEmbed, aiEmbedBatch, queryRomanianBert } from './client';
app/src/lib/ai/deadline-intelligence.ts:6:import { aiGenerateObject } from './client';
app/src/lib/ai/proposal-generator.ts:5:import { aiGenerateObject } from './client';
app/src/app/api/ai/search-calls/route.ts:4:import { aiGenerate } from '@/lib/ai/client';
app/src/lib/ai/grant-matcher.ts:5:import { aiGenerateObject } from './client';

## Module: app/src/lib/ai/compliance-engine.ts
### Imports referencing @/lib/ai/compliance-engine or relative paths
app/src/lib/ai/enhanced-proposal-generator.ts:10:import { analyzeCompliance, type ComplianceAnalysis } from './compliance-engine';
app/src/app/api/v1/projects/[id]/compliance/ai-score/route.ts:6:import { analyzeCompliance, type ComplianceCheckInput } from '@/lib/ai/compliance-engine';
app/src/lib/ai/index.ts:16:export { analyzeCompliance, type ComplianceAnalysis, type ComplianceCheckInput } from './compliance-engine';

## Module: app/src/lib/ai/compliance-validator.ts
### Imports referencing @/lib/ai/compliance-validator or relative paths
app/src/components/compliance/compliance-explainability-panel.tsx:5:import type { AIComplianceCheck, ComplianceSourceTrace } from '@/lib/ai/compliance-validator';
app/src/lib/ai/index.ts:11:export { validateCompliance, type ComplianceInput, type ComplianceResult } from './compliance-validator';
app/src/app/api/v1/projects/[id]/compliance/route.ts:7:import { validateCompliance } from '@/lib/ai/compliance-validator';

## Module: app/src/lib/ai/config.ts
### Imports referencing @/lib/ai/config or relative paths
app/src/lib/ai/index.ts:6:export { AI_CONFIG } from './config';
app/src/lib/ai/client.ts:9:import { AI_CONFIG } from './config';
app/src/lib/vectors/store.ts:4:import { AI_CONFIG } from '@/lib/ai/config';

## Module: app/src/lib/ai/deadline-intelligence.ts
### Imports referencing @/lib/ai/deadline-intelligence or relative paths
app/src/lib/ai/index.ts:14:export { analyzeDeadlines, quickRiskCheck, type DeadlineAnalysis, type WorkPackageStatus, type ProjectDeadlineInput } from './deadline-intelligence';
app/src/lib/ai/risk-assessment.ts:7:import type { WorkPackageStatus } from './deadline-intelligence';

## Module: app/src/lib/ai/document-analyzer.ts
### Imports referencing @/lib/ai/document-analyzer or relative paths
app/tests/ai-components.test.ts:2:import { detectPII, type PIIDetection } from '@/lib/ai/document-analyzer';
app/src/lib/ai/index.ts:9:export { analyzeDocument, detectPII, type AnalysisInput, type AnalysisResult, type PIIDetection } from './document-analyzer';
app/src/app/api/documents/[id]/analyze/route.ts:7:import { analyzeDocument } from '@/lib/ai/document-analyzer';

## Module: app/src/lib/ai/enhanced-proposal-generator.ts
### Imports referencing @/lib/ai/enhanced-proposal-generator or relative paths
app/src/app/api/ai/generate-proposal-enhanced/route.ts:3:import { generateEnhancedProposal } from '@/lib/ai/enhanced-proposal-generator';
app/src/lib/ai/index.ts:8:export { generateEnhancedProposal, type EnhancedProposalInput, type EUProposal, type EnhancedProposalOutput } from './enhanced-proposal-generator';

## Module: app/src/lib/ai/eu-ai-act.ts
### Imports referencing @/lib/ai/eu-ai-act or relative paths
app/src/app/api/ai/match-grants/route.ts:7:import { withEUAIActCompliance } from '@/lib/ai/eu-ai-act';
app/src/lib/ai/sanitize.ts:6:import { stripPII } from './eu-ai-act';

## Module: app/src/lib/ai/eu-knowledge-base.ts
### Imports referencing @/lib/ai/eu-knowledge-base or relative paths
app/src/lib/ai/enhanced-proposal-generator.ts:11:import { type EUProgramKey, getProgramInfo, getProposalSections } from './eu-knowledge-base';
app/src/lib/ai/fact-checker.ts:1:import { EU_PROGRAMS, type EUProgramKey } from './eu-knowledge-base';
app/src/lib/ai/knowledge-engine.ts:7:import { type EUProgramKey, EU_PROGRAMS } from './eu-knowledge-base';
app/src/lib/ai/index.ts:17:export { EU_PROGRAMS, getProgramInfo, getEvaluationCriteria, getBudgetCategories, getProposalSections, getRomanianAdvantages, findBestProgram, type EUProgramKey } from './eu-knowledge-base';
app/src/app/api/ai/generate-insights/route.ts:6:import { type EUProgramKey } from '@/lib/ai/eu-knowledge-base';

## Module: app/src/lib/ai/fact-checker.ts
### Imports referencing @/lib/ai/fact-checker or relative paths
app/src/app/api/ai/generate-proposal-enhanced/route.ts:10:import { factCheckGeneratedContent } from '@/lib/ai/fact-checker';
app/src/app/api/ai/generate-proposal/route.ts:10:import { factCheckGeneratedContent } from '@/lib/ai/fact-checker';

## Module: app/src/lib/ai/grant-matcher.ts
### Imports referencing @/lib/ai/grant-matcher or relative paths
app/src/lib/ai/index.ts:10:export { matchGrants, type MatchInput, type MatchResult, type FundingCall } from './grant-matcher';
app/src/app/api/ai/match-grants/route.ts:3:import { matchGrants, type FundingCall } from '@/lib/ai/grant-matcher';

## Module: app/src/lib/ai/index.ts
### Imports referencing @/lib/ai/index or relative paths
app/src/lib/db/seed.ts:4:import { db } from './index';

## Module: app/src/lib/ai/knowledge-engine.ts
### Imports referencing @/lib/ai/knowledge-engine or relative paths
app/src/lib/ai/index.ts:19:export { generateKnowledgeRecommendations, quickQualityCheck, type KnowledgeRecommendations, type KnowledgeEngineInput, type ProposalEnhancement, type BestPractice, type LessonLearned, type SuccessPattern, type PitfallWarning, type ExpertRecommendation } from './knowledge-engine';
app/src/app/api/ai/generate-insights/route.ts:5:import { generateKnowledgeRecommendations, quickQualityCheck } from '@/lib/ai/knowledge-engine';

## Module: app/src/lib/ai/model-routing.ts
### Imports referencing @/lib/ai/model-routing or relative paths
app/tests/unit/model-routing.test.ts:9:} from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/agents/enhance.ts:4:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/client.ts:10:import { resolveAgentModel } from './model-routing';
app/src/lib/ai/orchestrator/agents/research.ts:4:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/freshness.ts:2:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/agents/edit.ts:4:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/agents/documents.ts:5:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/agents/plan.ts:4:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/agents/match.ts:4:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/orchestrator/agents/build.ts:5:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/app/api/ai/agent/route.ts:10:import { getAIModelRoutingContext } from '@/lib/ai/model-routing'
app/src/lib/ai/agent/tools/extract-structure.ts:7:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/agent/tools/resolve-call.ts:7:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/agent/tools/generate-section.ts:7:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/lib/ai/agent/tools/regenerate-section.ts:7:import { resolveAgentModel } from '@/lib/ai/model-routing'
app/src/app/api/ai/orchestrator/message/route.ts:11:import { getAIModelRoutingContext } from '@/lib/ai/model-routing'
app/src/lib/ai/agent/services/freshness.ts:14:import { resolveAgentModel } from '@/lib/ai/model-routing'

## Module: app/src/lib/ai/proposal-generator.ts
### Imports referencing @/lib/ai/proposal-generator or relative paths
app/src/app/api/ai/generate-proposal/route.ts:3:import { generateProposal } from '@/lib/ai/proposal-generator';
app/src/lib/ai/index.ts:7:export { generateProposal, proposalInputSchema, type ProposalInput, type ProposalOutput } from './proposal-generator';

## Module: app/src/lib/ai/reporting-engine.ts
### Imports referencing @/lib/ai/reporting-engine or relative paths
app/src/lib/ai/index.ts:18:export { generateReport, quickReportSummary, type ReportGeneration, type ReportInput, type FinancialReport, type ProgressReport, type RiskReport, type PartnerReport, type ComplianceReport } from './reporting-engine';
app/src/app/api/ai/generate-report/route.ts:4:import { generateReport, type ReportInput } from '@/lib/ai/reporting-engine';

## Module: app/src/lib/ai/risk-assessment.ts
### Imports referencing @/lib/ai/risk-assessment or relative paths
app/src/lib/ai/index.ts:15:export { assessRisk, type RiskAssessment, type RiskAssessmentInput, type PartnerInfo } from './risk-assessment';
app/src/app/api/v1/projects/[id]/risks/ai-assessment/route.ts:6:import { assessRisk, type RiskAssessmentInput } from '@/lib/ai/risk-assessment';

## Module: app/src/lib/ai/sanitize.ts
### Imports referencing @/lib/ai/sanitize or relative paths
app/tests/ai-sanitize-security.test.ts:7:} from '@/lib/ai/sanitize';
app/src/lib/middleware/auth.ts:5:import { sanitizeAIResponseDeep, sanitizeUserInput } from '@/lib/ai/sanitize';
app/src/lib/rag/pipeline.ts:7:import { isLikelyNonTextPayload, normalizePromptInput } from '@/lib/ai/sanitize';
app/src/lib/ai/document-analyzer.ts:6:import { wrapUserInput, sanitizeForAI, AI_INPUT_LIMITS } from './sanitize';
app/src/lib/ai/proposal-generator.ts:8:import { sanitizeForAI, wrapUserInput, AI_INPUT_LIMITS } from './sanitize';
app/src/lib/ai/knowledge-engine.ts:8:import { sanitizeForAI, AI_INPUT_LIMITS } from './sanitize';
app/src/app/api/ai/generate-report/route.ts:7:import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
app/src/app/api/ai/generate-insights/route.ts:10:import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
app/src/app/api/ai/match-grants/route.ts:10:import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
app/src/app/api/ai/chat/route.ts:7:import { sanitizeForAI, sanitizeAIOutput, wrapUserInput, AI_INPUT_LIMITS } from '@/lib/ai/sanitize';
app/src/app/api/ai/ghid-to-tasks/route.ts:8:import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';

## Module: app/src/lib/ai/types.ts
### Imports referencing @/lib/ai/types or relative paths
app/src/lib/connectors/executor.ts:7:import { SyncOptions } from './types';
app/src/lib/connectors/mipe-sync.ts:3:import { ConnectorSyncFn } from './types';
app/src/lib/connectors/ec-portal-sync.ts:4:import { ConnectorSyncFn } from './types';
app/src/lib/connectors/registry.ts:1:import { ConnectorSyncFn } from './types';
app/src/lib/ai/orchestrator/workspace.ts:11:import type { SectionResult } from './types';
app/src/lib/ai/orchestrator/stream.ts:1:import type { SSEStream, SSEEvent } from './types'
app/src/lib/ai/orchestrator/engine.ts:4:import type { WorkflowContext, AgentFn, SSEStream, GatewayClient, ProjectCompletionStatus, SectionResult, CallBlueprint } from './types'
app/src/lib/ai/orchestrator/engine.ts:5:import { STEP_LABELS } from './types'
app/src/lib/ai/orchestrator/qa.ts:3:import type { SectionResult, SectionSpec, QAResult } from './types'
app/src/lib/ai/orchestrator/freshness.ts:1:import type { MatchedCall, FreshnessResult, GatewayClient } from './types'
app/src/lib/ai/orchestrator/pubsub.ts:4:import type { SectionResult, SSEEvent, SSEEventPayload, SSEStream } from './types'
app/src/lib/ai/agent/transitions.ts:1:import type { AgentSession, AgentSection, StateTransition } from './types'
app/src/lib/ai/orchestrator/section-specs.ts:3:import type { CallBlueprint, SectionSpec, SectionResult } from './types'
app/src/lib/ai/orchestrator/gateway.ts:2:import type { GatewayClient } from './types'
app/src/lib/ai/agent/services/evidence.ts:8:import type { ServiceContext } from './types'
app/src/lib/ai/agent/services/evidence.ts:9:import type { CallMatch, EvidenceBundle, EvidenceChunk } from './types'
app/src/lib/ai/agent/services/context-helpers.ts:6:import type { ServiceContext } from './types'
app/src/lib/ai/agent/prompt.ts:1:import type { AgentSession, AgentSection, Phase, EligibilityResult } from './types'
app/src/lib/ai/orchestrator/section-versions.ts:7:import type { SectionResult, SectionVersion } from './types';
app/src/lib/ai/providers/retry.ts:1:import type { ProviderClient, GenerateRequest, GenerateResult, ModelConfig, ProviderName } from './types'
app/src/lib/ai/agent/runtime.ts:5:} from './types'
app/src/lib/ai/agent/services/sections.ts:27:} from './types'
app/src/lib/ai/agent/policies.ts:1:import type { AgentSession, AgentSection, SectionSpec } from './types'
app/src/lib/ai/agent/services/eligibility.ts:17:} from './types'
app/src/lib/ai/providers/perplexity.ts:2:import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
app/src/lib/ai/agent/services/application.ts:27:} from './types'
app/src/lib/ai/agent/services/blueprint.ts:19:import type { ServiceContext } from './types'
app/src/lib/ai/agent/services/blueprint.ts:21:import type { BlueprintLookupResult, BlueprintSaveResult, EvidenceChunk } from './types'
app/src/lib/ai/agent/services/projects.ts:13:import type { ServiceContext, ProjectSummary, UploadedDocument } from './types'
app/src/lib/ai/providers/router.ts:1:import type { ProviderClient, ProviderName, GenerateRequest, GenerateResult } from './types'
app/src/lib/ai/providers/router.ts:2:import { MODEL_CONFIGS } from './types'
app/src/lib/ai/providers/openai.ts:2:import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
app/src/lib/ai/agent/history.ts:2:import type { Phase } from './types'
app/src/lib/ai/agent/services/freshness.ts:18:import type { ServiceContext } from './types'
app/src/lib/ai/agent/services/freshness.ts:19:import type { FreshnessCheckResult, DeadlineVerification, CallPageDiff } from './types'
app/src/lib/ai/providers/anthropic.ts:2:import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
app/src/lib/ai/providers/google.ts:2:import type { ProviderClient, GenerateRequest, GenerateResult } from './types'

## Module: app/src/lib/ai/utils.ts
### Imports referencing @/lib/ai/utils or relative paths
app/src/lib/ai/client.ts:12:import { zodToJsonSchema } from './utils';
app/src/lib/ai/agent/runtime.ts:12:import { zodToJsonSchema } from './utils'
```

## Classification

| Module | External ref count | Classification |
|--------|--------------------|----------------|
| `anthropic-client.ts` | 1 | Keeper shared dependency of Managed runtime |
| `client.ts` | 19 | Keeper shared client layer |
| `compliance-engine.ts` | 3 | Migration candidate; still imported by live API/code paths |
| `compliance-validator.ts` | 3 | Migration candidate; still imported by live API/UI paths |
| `config.ts` | 3 | Keeper shared config |
| `deadline-intelligence.ts` | 2 | Migration candidate; still coupled to risk-assessment flow |
| `document-analyzer.ts` | 3 | Migration candidate; still imported by route + tests |
| `enhanced-proposal-generator.ts` | 2 | Migration candidate; still imported by legacy proposal route |
| `eu-ai-act.ts` | 2 | Migration candidate; helper still used by live route + sanitize layer |
| `eu-knowledge-base.ts` | 5 | Migration candidate; helper still used by live legacy capability routes |
| `fact-checker.ts` | 2 | Migration candidate; still imported by proposal routes |
| `grant-matcher.ts` | 2 | Migration candidate; still imported by legacy match route |
| `index.ts` | 1 | Keeper barrel |
| `knowledge-engine.ts` | 2 | Migration candidate; still imported by generate-insights route |
| `model-routing.ts` | 17 | Keeper shared routing/module selection layer |
| `proposal-generator.ts` | 2 | Migration candidate; still imported by legacy proposal route |
| `reporting-engine.ts` | 2 | Migration candidate; still imported by legacy report route |
| `risk-assessment.ts` | 2 | Migration candidate; still imported by live v1 risk route |
| `sanitize.ts` | 11 | Keeper shared sanitization layer |
| `types.ts` | 37 | Keeper shared types module |
| `utils.ts` | 2 | Keeper shared utility module |

## Notes

- No root `lib/ai/*.ts` module returned a zero-reference outcome on current `master`, so this probe produced no confirmed presumptive deletes.
- The legacy capability modules named in the spec remain coupled to live routes or shared helpers; Plan 4 has to separate active keeper behavior from true orphan surface rather than deleting the whole set wholesale.
