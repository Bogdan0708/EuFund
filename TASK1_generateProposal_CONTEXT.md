# TASK 1: generateProposal Migration - Context for @claude

## 🎯 MISSION
Architect the migration of `generateProposal` module from single-provider to multi-provider AI system with Romanian specialization.

## 📊 CURRENT IMPLEMENTATION ANALYSIS

### **File Location:** `~/Dev/EU-Funds/app/src/lib/ai/proposal-generator.ts`

### **Current Architecture:**
```typescript
import { aiGenerate, aiGenerateObject } from './client';  // Single provider

export async function generateProposal(input: ProposalInput): Promise<{
  proposal: ProposalOutput;
  tokensUsed: number;
  ragSourcesUsed: number;
}> {
  // RAG search for EU legislation
  const ragResults = await hybridSearch({
    query: input.projectIdea,
    locale: input.locale,
    topK: 3,
  });

  // Single aiGenerateObject call
  const { object, tokensUsed } = await aiGenerateObject({
    system: systemPrompt,
    prompt,
    schema: proposalOutputSchema,
    temperature: 0.7,
  });
}
```

### **Current Issues:**
- ❌ **Single provider** (no redundancy) 
- ❌ **No cost optimization** (73% more expensive)
- ❌ **No Romanian specialization** beyond locale
- ❌ **No intelligent routing** based on content
- ❌ **No provider fallback** if API fails
- ❌ **No usage analytics** or cost tracking

## 🚀 MULTI-PROVIDER TARGET ARCHITECTURE

### **Available System:**
- ✅ **4/5 providers healthy**: OpenAI, Anthropic, Google, Romanian specialist
- ✅ **Romanian AI engine**: 100% detection accuracy with cultural context
- ✅ **Cost optimization**: 73% reduction through intelligent routing
- ✅ **Enhanced client**: `client-v2.ts` with all capabilities

### **New Capabilities to Integrate:**
```typescript
import { 
  aiGenerateObject, 
  TaskType, 
  analyzeRomanianContent,
  aiGenerateRomanianEUProposal  // Special Romanian EU proposal generator
} from './client-v2';
```

## 🇷🇴 ROMANIAN SPECIALIZATION REQUIREMENTS

### **Cultural Context Integration:**
- **Formal context**: EU funding proposals (PNRR, POR, Horizon)
- **Bureaucratic language**: Official Romanian administrative terms
- **EU terminology**: Romanian translations (e.g., "Orizont Europa" for Horizon Europe)
- **Regulatory compliance**: Romanian legal framework references

### **Program-Specific Optimization:**
- **PNRR**: Romanian National Recovery Plan specifics
- **POR**: Regional Operational Program context  
- **Horizon Europe**: Romanian research ecosystem
- **Interreg**: Cross-border cooperation with Romanian focus

## 📋 ARCHITECTURAL REQUIREMENTS

### **1. Enhanced Input Interface:**
```typescript
export interface EnhancedProposalInput extends ProposalInput {
  userTier?: 'free' | 'pro' | 'enterprise';    // For cost optimization
  userId?: string;                              // For usage tracking
  priority?: 'low' | 'normal' | 'high';        // For provider routing
  culturalContext?: 'formal' | 'bureaucratic'; // Romanian context
  optimizeForRomanian?: boolean;                // Force Romanian optimization
}
```

### **2. Enhanced Output Interface:**
```typescript
export interface EnhancedProposalOutput {
  proposal: ProposalOutput;
  // Existing fields
  tokensUsed: number;
  ragSourcesUsed: number;
  // New multi-provider fields  
  provider: string;                    // Which AI provider used
  cost: number;                        // Actual cost in EUR
  cached: boolean;                     // Was response cached
  romanianOptimized: boolean;          // Used Romanian specialization
  culturalContext?: string;            // Detected cultural context
  providerFallbacks?: string[];        // Fallback providers used
  optimizationSavings: number;         // Cost savings vs single provider
}
```

### **3. Intelligent Routing Logic:**
- **Romanian content detection**: Analyze input for Romanian language/context
- **Program-specific routing**: Different providers for different EU programs
- **Complexity assessment**: Simple vs complex proposals get different routing
- **Cost optimization**: Balance quality vs cost based on user tier

### **4. Error Handling & Fallbacks:**
- **Provider failures**: Automatic fallback to backup providers
- **Romanian provider issues**: Graceful fallback to main providers with Romanian prompts
- **RAG integration failures**: Continue with degraded but functional service
- **Schema validation**: Ensure structured output consistency

### **5. Performance Optimization:**
- **Caching strategy**: Cache based on input similarity and program type
- **Parallel processing**: RAG search + provider health check simultaneously  
- **Romanian knowledge injection**: Pre-load Romanian EU program context
- **Cost prediction**: Estimate costs before generation

## 🎯 SUCCESS CRITERIA

### **Technical Requirements:**
- ✅ **Backward compatibility**: Existing API unchanged
- ✅ **Performance**: Response time ≤ 10 seconds (current baseline)
- ✅ **Quality**: Proposal quality equal or better than current
- ✅ **Reliability**: 99.9% success rate with provider fallbacks
- ✅ **Cost reduction**: 70%+ savings on typical proposal generation

### **Business Requirements:**
- ✅ **Romanian optimization**: Cultural context for Romanian proposals
- ✅ **EU program accuracy**: Correct terminology and requirements
- ✅ **User experience**: Transparent upgrade (users see benefits, not complexity)
- ✅ **Analytics**: Detailed usage and cost tracking
- ✅ **Scalability**: Handle increased load with multi-provider system

## 📊 EXPECTED OUTCOMES

### **Cost Impact:**
- **Current cost**: ~€800/month for proposal generation
- **Target cost**: ~€216/month (73% reduction)  
- **Monthly savings**: €584
- **Annual savings**: €7,008

### **Quality Impact:**
- **Romanian proposals**: Enhanced cultural accuracy
- **EU program compliance**: Better terminology and structure
- **Provider redundancy**: 99.9%+ uptime vs single provider risks
- **Performance**: Maintained or improved response times

## 🚀 ARCHITECTURAL TASKS FOR @claude

### **Primary Deliverables:**
1. **Enhanced interface design** with Romanian optimization parameters
2. **Intelligent routing algorithm** for proposal generation
3. **Romanian cultural context integration** strategy  
4. **Provider fallback and error handling** architecture
5. **Performance and caching optimization** approach
6. **Migration strategy** with backward compatibility
7. **Testing and validation** framework

### **Secondary Considerations:**
- Integration with existing RAG pipeline
- Romanian EU knowledge base enhancement
- User tier optimization strategies  
- Analytics and monitoring requirements
- Deployment and rollback procedures

---

**@claude: Please design the complete architecture for migrating generateProposal to the multi-provider system with Romanian specialization. Focus on the technical architecture that maximizes cost savings while maintaining quality and adding Romanian cultural context optimization.**

**Context available in:**
- Current implementation: `~/Dev/EU-Funds/app/src/lib/ai/proposal-generator.ts`
- Multi-provider system: `~/Dev/EU-Funds/app/src/lib/ai/client-v2.ts`
- Romanian engine: `~/Dev/EU-Funds/app/src/lib/ai/romanian-specialization.ts`

**Deadline: 30 minutes for complete architectural design**