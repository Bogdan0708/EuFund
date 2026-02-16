# TASK 1: Preliminary Migration Analysis - generateProposal

## 🎯 QUICK START ANALYSIS (While @claude completes architecture)

### **Current Implementation Summary:**
```typescript
// File: app/src/lib/ai/proposal-generator.ts
// Current approach: Single aiGenerateObject call
// Cost: €800/month
// Provider: Single (likely OpenAI)
// Romanian support: Basic locale handling only
```

### **Key Migration Points Identified:**

**1. Import Changes:**
```typescript
// OLD
import { aiGenerate, aiGenerateObject } from './client';

// NEW  
import { 
  aiGenerateObject, 
  TaskType, 
  analyzeRomanianContent,
  aiGenerateRomanianEUProposal 
} from './client-v2';
```

**2. Romanian Content Detection:**
```typescript
// NEW: Analyze input for Romanian optimization
const romanianAnalysis = await analyzeRomanianContent(
  `${input.projectIdea} ${input.organizationName} ${input.sector || ''}`
);
```

**3. Enhanced aiGenerateObject Call:**
```typescript
// OLD
const { object, tokensUsed } = await aiGenerateObject({
  system: systemPrompt,
  prompt,
  schema: proposalOutputSchema,
  temperature: 0.7,
});

// NEW
const { object, tokensUsed, provider, cost, cached } = await aiGenerateObject({
  system: enhancedSystemPrompt,
  prompt: optimizedPrompt,
  schema: proposalOutputSchema,
  // NEW: Multi-provider optimization parameters
  taskType: TaskType.PROPOSAL_GENERATION,
  userTier: input.userTier || 'pro',
  language: romanianAnalysis.isRomanian ? 'ro' : 'auto',
  priority: 'normal',
  userId: input.userId,
  temperature: 0.7,
});
```

**4. Enhanced Response:**
```typescript
// OLD
return {
  proposal,
  tokensUsed,
  ragSourcesUsed: ragResults.length,
};

// NEW
return {
  proposal,
  tokensUsed,
  ragSourcesUsed: ragResults.length,
  // NEW: Multi-provider metadata
  provider,
  cost,
  cached,
  romanianOptimized: romanianAnalysis.isRomanian,
  culturalContext: romanianAnalysis.culturalContext,
  optimizationSavings: calculateSavings(cost, tokensUsed),
};
```

### **Romanian Optimization Enhancements:**

**System Prompt Enhancement:**
```typescript
// Add Romanian context if detected
if (romanianAnalysis.isRomanian) {
  systemPrompt += `\n\nROMANIAN CONTEXT OPTIMIZATION:
- Use formal Romanian bureaucratic language for EU funding
- Include specific Romanian EU program terminology
- Reference Romanian regulatory framework where relevant
- Cultural context: ${romanianAnalysis.culturalContext}`;
}
```

**Program-Specific Romanian Enhancement:**
```typescript
const romanianProgramContext = {
  pnrr: 'Planul Național de Redresare și Reziliență - focus on digitalization, green transition',
  por: 'Program Operațional Regional - regional development focus',
  horizon_europe: 'Orizont Europa - research and innovation focus'
};
```

### **Cost Optimization Strategy:**

**Provider Selection Logic:**
```typescript
// Intelligent provider routing
let taskType = TaskType.PROPOSAL_GENERATION;

if (romanianAnalysis.isRomanian && romanianAnalysis.confidence > 0.8) {
  taskType = TaskType.ROMANIAN_LOCALIZATION;  // Route to Romanian-optimized provider
}

if (input.budget && input.budget > 1000000) {
  // High-value proposals get premium providers
  userTier = 'enterprise';
} else if (input.userTier === 'free') {
  // Cost-optimize for free users
  taskType = TaskType.SIMPLE_TEXT_GENERATION;
}
```

### **Expected Outcomes:**

**Cost Reduction:**
- Current: €800/month (single provider)
- Target: €216/month (multi-provider routing)
- Savings: €584/month (73% reduction)

**Quality Improvement:**
- Romanian cultural context integration
- Provider redundancy (4/5 healthy providers)
- Enhanced EU program knowledge integration
- Better error handling and recovery

**Performance Maintenance:**
- Target response time: ≤10 seconds
- Success rate improvement: 99.9% vs single provider risks
- Caching integration for similar proposals

---

## 🚀 READY FOR IMMEDIATE IMPLEMENTATION

**Once @claude completes the comprehensive architecture:**
1. **@codex can start implementation immediately**
2. **All preparation work is complete**  
3. **Romanian specialization patterns identified**
4. **Cost optimization strategies defined**
5. **Quality enhancement approaches ready**

**This preliminary analysis ensures we can hit the ground running once the architecture is complete!**

---

**Status: PREPARED FOR RAPID IMPLEMENTATION**  
**Waiting for: @claude architecture completion**  
**Next Phase: @codex implementation (45-60 minutes)**