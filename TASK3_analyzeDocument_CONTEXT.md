# TASK 3: analyzeDocument Migration Context

## 🎯 Migration Objective
Migrate `analyzeDocument` from single-provider to multi-provider system with Romanian specialization for 73% cost reduction (€292/month → €79/month savings target).

## 📊 Current State Analysis

### Function Location & Size
- **File:** `~/Dev/EU-Funds/app/src/lib/ai/document-analyzer.ts`
- **Size:** ~6,500 bytes (medium complexity analyzer)
- **Complexity:** MEDIUM - Document analysis with PII detection, compliance scoring
- **Dependencies:** Uses old `client.ts`, Romanian utils, PII pattern matching

### Current Cost Structure (Single Provider)
- **Function:** analyzeDocument()
- **Usage Pattern:** Document compliance and quality analysis
- **Token Count:** ~3,000-5,000 tokens per document analysis
- **Current Cost:** €292/month
- **Target Cost:** €79/month (73% reduction)
- **Monthly Savings Target:** €213/month = €2,556/year

### Key Features to Preserve
```typescript
export interface AnalysisInput {
  content: string;
  filename: string;
  mimeType: string;
  locale?: string;
  projectContext?: string;
  callContext?: string;
}

export interface AnalysisResult {
  analysis: DocumentAnalysis;
  piiDetections: PIIDetection[];
  tokensUsed: number;
  gdprCompliant: boolean;
}
```

### Current Implementation Pattern
```typescript
// OLD: Single provider approach
import { aiGenerateObject } from './client';

// Main analysis call
const { object, tokensUsed } = await aiGenerateObject({
  system: systemPrompt,
  prompt,
  schema: documentAnalysisSchema,
  schemaName: 'DocumentAnalysis',
  temperature: 0.3,
});
```

## 🚀 Migration Plan - Following Task 1-2 Success Pattern

### Phase 1: Pre-Migration Setup ✅
1. ✅ Create backup of original file
2. ✅ Analyze current usage and dependencies  
3. ✅ Document current API structure
4. ✅ Prepare multi-agent context documents

### Phase 2: Multi-Provider Migration 
1. **Update Imports:** Switch from `client.ts` to `client-v2.ts`
2. **Add Romanian Analysis:** Integrate specialized Romanian document analysis
3. **Provider Optimization:** Add TaskType routing for document analysis tasks
4. **Cost Tracking:** Implement enhanced metadata collection
5. **Maintain Compatibility:** Preserve exact same input/output interface

### Phase 3: Romanian Specialization Enhancement
1. **Document Type Recognition:** Romanian administrative documents, EU forms
2. **Compliance Context:** Romanian regulatory requirements, GDPR specifics
3. **Language Analysis:** Document language quality, formal register assessment
4. **Cultural Context:** Romanian bureaucratic language patterns

### Phase 4: Validation & Testing
1. **Static Analysis:** Code structure and feature completeness
2. **Romanian Test:** Romanian document analysis (PNRR application)
3. **English Test:** English document analysis (technical proposal)
4. **PII Test:** Ensure PII detection still works correctly
5. **Cost Validation:** Confirm 73% reduction target

## 🎯 Expected Multi-Provider Optimizations

### Provider Routing Strategy
```typescript
// Romanian Documents → Romanian Specialist + Claude (compliance expertise)
// English Technical → OpenAI GPT-4 (document analysis) + Google (fact checking)
// Compliance Analysis → Anthropic Claude (regulatory) + Google (validation)
// PII Detection → Local processing (no AI needed) + Claude (contextual analysis)
```

### Cost Optimization Logic
1. **Document Type:** Technical → OpenAI, Compliance → Claude, General → Google
2. **Language Detection:** Romanian content → specialized provider routing
3. **Complexity Analysis:** Simple docs → faster providers, complex → thorough analysis
4. **PII Sensitivity:** High PII → local processing priority
5. **Cache Strategy:** Similar document types → intelligent caching

## 🔧 Implementation Details

### New Migration Pattern
```typescript
// NEW: Multi-provider with Romanian optimization
import { 
  aiGenerateObject, 
  TaskType, 
  analyzeRomanianContent,
  type AIRequest 
} from './client-v2';

// Enhanced analysis with optimization
const romanianAnalysis = input.locale !== 'en' ? await analyzeRomanianContent({
  content: input.content,
  context: 'document_analysis',
  documentType: getDocumentType(input.filename, input.mimeType),
  additionalContext: {
    projectContext: input.projectContext,
    callContext: input.callContext
  }
}) : null;

const { object, provider, cost, cached, romanianOptimized } = await aiGenerateObject({
  system: enhancedSystemPrompt,
  prompt: optimizedPrompt,
  schema: documentAnalysisSchema,
  schemaName: 'DocumentAnalysis',
  temperature: 0.3,
  taskType: TaskType.DOCUMENT_ANALYSIS,
  language: input.locale || 'auto',
  userTier: 'pro', // Document analysis is professional feature
  priority: 'normal',
  romanianContext: romanianAnalysis?.context,
  expectedTokens: 4000,
  maxRetries: 2
});
```

### Enhanced Metadata Response
```typescript
interface AnalysisResult {
  analysis: DocumentAnalysis;
  piiDetections: PIIDetection[];
  tokensUsed: number;
  gdprCompliant: boolean;
  // NEW: Multi-provider metadata
  provider?: string;
  cost?: number;
  cached?: boolean;
  romanianOptimized?: boolean;
  optimizationSavings?: number;
  processingTime?: number;
  documentType?: string;
  languageDetected?: string;
  complianceScore?: number;
}
```

## 📋 Quality Assurance Checklist

### Critical Requirements (Must Preserve)
- [ ] PII detection patterns working correctly
- [ ] GDPR compliance assessment accurate
- [ ] Document type classification
- [ ] Romanian/English bilingual support
- [ ] Quality and completeness scoring
- [ ] Error handling with text truncation
- [ ] High-severity PII redaction

### Enhancement Requirements (New Features)
- [ ] 73% cost reduction through multi-provider routing
- [ ] Romanian document expertise (administrative forms, applications)
- [ ] Provider performance analytics
- [ ] Enhanced caching for similar document types
- [ ] Automatic document type classification
- [ ] Cost tracking per analysis type

## 🎯 Success Metrics

### Financial Targets
- **Cost Reduction:** 73% (€292 → €79 monthly)
- **Annual Savings:** €2,556
- **ROI Target:** 1,278% annually (2-hour development)

### Quality Targets  
- **Analysis Accuracy:** 95%+ document type classification
- **Romanian Accuracy:** 90%+ specialized document analysis
- **PII Detection:** 100% pattern accuracy (unchanged)
- **Processing Time:** <20 seconds average

### Integration Targets
- **Backward Compatibility:** 100% (no API changes)
- **GDPR Compliance:** Maintain existing level
- **Error Rate:** <0.1% (with fallback)
- **Cache Hit Rate:** 20-30% for similar document types

## 🔍 Specialized Romanian Document Types

### Administrative Documents
- **Cerere de finanțare** (Funding applications)
- **Raport de progres** (Progress reports) 
- **Declarații pe propria răspundere** (Self-declarations)
- **Certificate de eligibilitate** (Eligibility certificates)

### EU Program Documents
- **Formulare PNRR** (PNRR application forms)
- **Documente POR** (Regional Operational Programme docs)
- **Rapoarte Horizon Europe** (Horizon Europe reports)
- **Contracte de finanțare** (Funding contracts)

### Compliance Focus Areas
- **Terminologie oficială română** (Official Romanian terminology)
- **Cerințe legale naționale** (National legal requirements)
- **Standarde UE în română** (EU standards in Romanian)
- **Format și structură documentar** (Document format and structure)

---

## 🚀 Ready for Multi-Agent Implementation

This comprehensive context provides all necessary information for:
1. **Direct Implementation** following successful Tasks 1-2 pattern
2. **Romanian specialization** for document analysis
3. **Multi-provider optimization** with cost tracking
4. **Quality validation** with comprehensive testing

**Following the proven successful pattern from Tasks 1-2, this migration is ready to begin!**