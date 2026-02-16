# TASK 1: @codex Implementation Phase - Ready for Architecture Output

## 🎯 MISSION FOR @codex
Implement the multi-provider migration of `generateProposal` based on @claude's architecture design.

## 📋 IMPLEMENTATION CONTEXT

### **Files to Modify:**
- **Primary**: `~/Dev/EU-Funds/app/src/lib/ai/proposal-generator.ts`  
- **Reference**: `~/Dev/EU-Funds/app/src/lib/ai/client-v2.ts` (multi-provider system)
- **Reference**: `~/Dev/EU-Funds/app/src/lib/ai/romanian-specialization.ts` (Romanian engine)

### **Current Implementation Pattern:**
```typescript
// BEFORE: Single provider
import { aiGenerate, aiGenerateObject } from './client';

const { object, tokensUsed } = await aiGenerateObject({
  system: systemPrompt,
  prompt,
  schema: proposalOutputSchema,
  temperature: 0.7,
});
```

### **Target Implementation Pattern:**
```typescript  
// AFTER: Multi-provider with Romanian specialization
import { 
  aiGenerateObject, 
  TaskType, 
  analyzeRomanianContent,
  aiGenerateRomanianEUProposal 
} from './client-v2';

// Romanian content analysis
const romanianAnalysis = await analyzeRomanianContent(input.projectIdea);

// Enhanced generation with intelligent routing
const { object, provider, cost, cached, tokensUsed } = await aiGenerateObject({
  system: enhancedSystemPrompt,
  prompt: optimizedPrompt,
  schema: proposalOutputSchema,
  taskType: TaskType.PROPOSAL_GENERATION,
  userTier: input.userTier || 'pro',
  language: romanianAnalysis.isRomanian ? 'ro' : 'auto',
  priority: 'normal',
  userId: input.userId,
  temperature: 0.7,
});
```

### **Key Implementation Requirements:**
1. **Backward Compatibility**: Maintain existing API interface
2. **Romanian Optimization**: Use Romanian specialization engine
3. **Cost Tracking**: Include provider, cost, cached status in response
4. **Error Handling**: Implement provider fallback logic
5. **Performance**: Maintain <10 second response time
6. **Quality**: Equal or better proposal quality

## 🚀 IMPLEMENTATION CHECKLIST

### **Phase 1: Interface Enhancement**
- [ ] Add optional enhanced input parameters (userTier, userId, priority)
- [ ] Extend output interface with multi-provider metadata
- [ ] Maintain backward compatibility for existing callers

### **Phase 2: Romanian Integration**  
- [ ] Integrate analyzeRomanianContent for input analysis
- [ ] Use aiGenerateRomanianEUProposal for Romanian-optimized proposals
- [ ] Add Romanian cultural context to system prompts
- [ ] Handle Romanian EU program specifics (PNRR, POR, Horizon)

### **Phase 3: Multi-Provider Logic**
- [ ] Replace single aiGenerateObject with multi-provider version
- [ ] Add intelligent TaskType selection based on content analysis
- [ ] Implement user tier-based optimization  
- [ ] Add provider fallback and error handling

### **Phase 4: Performance & Analytics**
- [ ] Integrate cost tracking and optimization metrics
- [ ] Add caching strategy for similar proposals
- [ ] Performance monitoring and logging
- [ ] A/B testing capability for gradual rollout

### **Phase 5: Testing & Validation**
- [ ] Unit tests for new functionality
- [ ] Integration tests with multi-provider system
- [ ] Romanian content accuracy testing
- [ ] Performance benchmarking vs current implementation

## 📊 SUCCESS METRICS

### **Technical Targets:**
- **Cost Reduction**: 70%+ savings (€800 → €216/month)
- **Response Time**: ≤10 seconds (maintain current performance)  
- **Success Rate**: 99.9% with provider redundancy
- **Romanian Accuracy**: 100% cultural context detection
- **Quality Score**: Equal or better than current proposals

### **Code Quality Targets:**
- **TypeScript**: Zero compilation errors
- **Test Coverage**: 80%+ for new functionality
- **Performance**: No regression in response time
- **Maintainability**: Clear separation of concerns
- **Documentation**: Complete inline documentation

---

**WAITING FOR @claude ARCHITECTURE OUTPUT**
**Status: Ready for implementation once architecture is complete**

**Next Steps:**
1. Review @claude's architecture design
2. Implement according to architectural specifications  
3. Pass to @gemini for systematic review
4. Integration testing and deployment