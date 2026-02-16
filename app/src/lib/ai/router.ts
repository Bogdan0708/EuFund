// ─── Intelligent AI Provider Router ─────────────────────────────────
// Advanced routing logic for optimal provider selection

import { 
  AIProvider, 
  TaskType, 
  AIRequest, 
  RoutingDecision,
  TaskCharacteristics,
  RomanianLanguageContext,
  OptimizationStrategy
} from './types';
import { 
  PROVIDER_CAPABILITIES,
  TASK_CHARACTERISTICS,
  OPTIMIZATION_RULES,
  getProviderRanking,
  getRomanianProviderRanking,
  estimateCost
} from './provider-matrix';

// ─── Language Detection ──────────────────────────────────────────────

export function detectRomanianContext(text: string): RomanianLanguageContext {
  const romanianKeywords = [
    'proiect', 'finanțare', 'europeană', 'dezvoltare', 'România', 
    'implementare', 'buget', 'partener', 'activități', 'rezultate',
    'durată', 'echipă', 'experiență', 'impact', 'sustenabilitate',
    'și', 'cu', 'pentru', 'prin', 'după', 'asupra', 'către'
  ];
  
  const formalIndicators = [
    'în conformitate cu', 'prin prezenta', 'în atenția', 'respectuos',
    'corespunzător', 'prevederile', 'legislația', 'reglementările'
  ];
  
  const academicIndicators = [
    'cercetare', 'științific', 'universitar', 'doctoral', 'publicație',
    'metodologie', 'ipoteză', 'analiză', 'rezultate', 'concluzii'
  ];
  
  const legalIndicators = [
    'contractul', 'clauze', 'obligații', 'drepturi', 'răspunderi',
    'conform', 'prevede', 'stipulează', 'dispozițiile'
  ];

  const words = text.toLowerCase().split(/\s+/);
  const romanianMatches = words.filter(word => 
    romanianKeywords.some(keyword => word.includes(keyword))
  ).length;
  
  const confidence = Math.min(romanianMatches / words.length * 10, 1);
  
  let culturalContext: 'formal' | 'academic' | 'bureaucratic' | 'business' | 'casual' = 'casual';
  
  if (formalIndicators.some(indicator => text.includes(indicator))) {
    culturalContext = 'formal';
  } else if (academicIndicators.some(indicator => text.includes(indicator))) {
    culturalContext = 'academic';
  } else if (legalIndicators.some(indicator => text.includes(indicator))) {
    culturalContext = 'bureaucratic';
  } else if (words.length > 100) {
    culturalContext = 'business';
  }

  return {
    detectedLanguage: confidence > 0.3 ? 'ro' : 'unknown',
    confidence,
    culturalContext,
    regionalization: 'ro',
    complexity: words.length > 500 ? 'complex' : words.length > 100 ? 'moderate' : 'simple'
  };
}

// ─── Task Complexity Analysis ────────────────────────────────────────

export function analyzeTaskComplexity(request: AIRequest): {
  complexity: 'low' | 'medium' | 'high';
  reasoning: string;
} {
  const taskChar = TASK_CHARACTERISTICS[request.taskType];
  let complexity = taskChar.complexity;
  let reasoning = `Base complexity for ${request.taskType}: ${complexity}`;
  
  // Adjust based on prompt length
  const promptLength = request.prompt.length + (request.systemPrompt?.length || 0);
  if (promptLength > 10000) {
    complexity = 'high';
    reasoning += '; Long prompt increases complexity';
  } else if (promptLength > 5000 && complexity === 'low') {
    complexity = 'medium';
    reasoning += '; Medium prompt increases complexity';
  }
  
  // Adjust based on structured output requirement
  if (request.structuredOutput && complexity === 'low') {
    complexity = 'medium';
    reasoning += '; Structured output increases complexity';
  }
  
  // Romanian language adds complexity for non-specialized models
  const romanianContext = detectRomanianContext(request.prompt);
  if (romanianContext.confidence > 0.5 && romanianContext.complexity === 'complex') {
    if (complexity === 'low') complexity = 'medium';
    else if (complexity === 'medium') complexity = 'high';
    reasoning += '; Complex Romanian content increases complexity';
  }
  
  return { complexity, reasoning };
}

// ─── Provider Selection Logic ────────────────────────────────────────

export class AIRouter {
  private circuitBreakerStates: Map<AIProvider, { failures: number; lastFailure?: Date }> = new Map();
  private usageCache: Map<string, { cost: number; latency: number; timestamp: Date }> = new Map();
  
  constructor(private config: {
    enableCircuitBreaker: boolean;
    maxFailures: number;
    circuitBreakerTimeoutMs: number;
    enableCaching: boolean;
  } = {
    enableCircuitBreaker: true,
    maxFailures: 3,
    circuitBreakerTimeoutMs: 300000, // 5 minutes
    enableCaching: true
  }) {}

  public async routeRequest(request: AIRequest): Promise<RoutingDecision> {
    // 1. Analyze task characteristics
    const complexityAnalysis = analyzeTaskComplexity(request);
    const romanianContext = detectRomanianContext(request.prompt);
    
    // 2. Get optimization strategy based on user tier
    const optimizationStrategy = this.getOptimizationStrategy(request.userTier);
    
    // 3. Get candidate providers
    let candidates = this.getCandidateProviders(
      request.taskType, 
      request.userTier,
      romanianContext
    );
    
    // 4. Filter by circuit breaker status
    candidates = this.filterByCircuitBreaker(candidates);
    
    if (candidates.length === 0) {
      throw new Error(`No available providers for task ${request.taskType}`);
    }
    
    // 5. Score and rank providers
    const scoredProviders = await this.scoreProviders(
      candidates, 
      request, 
      complexityAnalysis,
      optimizationStrategy
    );
    
    // 6. Select best provider
    const selected = scoredProviders[0];
    const fallbacks = scoredProviders.slice(1, 4).map(s => ({
      provider: s.provider,
      model: this.getModelForProvider(s.provider, request.taskType)
    }));
    
    return {
      selectedProvider: selected.provider,
      selectedModel: this.getModelForProvider(selected.provider, request.taskType),
      reasoning: selected.reasoning,
      confidence: selected.score,
      estimatedCost: selected.estimatedCost,
      estimatedLatency: selected.estimatedLatency,
      fallbackProviders: fallbacks
    };
  }

  private getOptimizationStrategy(userTier: string): OptimizationStrategy {
    switch (userTier) {
      case 'free':
        return {
          prioritizeCost: true,
          prioritizeSpeed: false,
          prioritizeQuality: false,
          allowCache: true,
          maxAcceptableCost: 0.05, // $0.05 per request
          maxAcceptableLatency: 10000, // 10s
          fallbackBehavior: 'degrade'
        };
      case 'pro':
        return {
          prioritizeCost: false,
          prioritizeSpeed: true,
          prioritizeQuality: true,
          allowCache: true,
          maxAcceptableCost: 0.25, // $0.25 per request
          maxAcceptableLatency: 5000, // 5s
          fallbackBehavior: 'retry'
        };
      case 'enterprise':
        return {
          prioritizeCost: false,
          prioritizeSpeed: false,
          prioritizeQuality: true,
          allowCache: false, // Fresh results for enterprise
          maxAcceptableCost: 1.00, // $1.00 per request
          maxAcceptableLatency: 15000, // 15s acceptable for quality
          fallbackBehavior: 'retry'
        };
      default:
        return {
          prioritizeCost: true,
          prioritizeSpeed: false,
          prioritizeQuality: false,
          allowCache: true,
          maxAcceptableCost: 0.10,
          maxAcceptableLatency: 8000,
          fallbackBehavior: 'fail'
        };
    }
  }

  private getCandidateProviders(
    taskType: TaskType, 
    userTier: string,
    romanianContext: RomanianLanguageContext
  ): AIProvider[] {
    // Start with providers that support this task type
    let candidates = Object.entries(PROVIDER_CAPABILITIES)
      .filter(([_, cap]) => cap.taskTypes.includes(taskType))
      .map(([provider]) => provider as AIProvider);
    
    // Apply Romanian optimization if needed
    if (romanianContext.confidence > 0.5) {
      const romanianRanking = getRomanianProviderRanking(taskType);
      candidates = romanianRanking.filter(p => candidates.includes(p));
    }
    
    // Apply optimization rules
    for (const rule of OPTIMIZATION_RULES) {
      if (rule.condition(taskType, userTier, romanianContext.detectedLanguage)) {
        const ruleProviders = rule.preferredProviders.filter(p => 
          candidates.includes(p)
        );
        if (ruleProviders.length > 0) {
          candidates = ruleProviders;
          break;
        }
      }
    }
    
    return candidates;
  }

  private filterByCircuitBreaker(candidates: AIProvider[]): AIProvider[] {
    if (!this.config.enableCircuitBreaker) return candidates;
    
    const now = new Date();
    return candidates.filter(provider => {
      const state = this.circuitBreakerStates.get(provider);
      if (!state) return true;
      
      if (state.failures >= this.config.maxFailures) {
        const timeSinceLastFailure = now.getTime() - (state.lastFailure?.getTime() || 0);
        return timeSinceLastFailure > this.config.circuitBreakerTimeoutMs;
      }
      
      return true;
    });
  }

  private async scoreProviders(
    candidates: AIProvider[],
    request: AIRequest,
    complexityAnalysis: { complexity: 'low' | 'medium' | 'high'; reasoning: string },
    strategy: OptimizationStrategy
  ): Promise<Array<{
    provider: AIProvider;
    score: number;
    reasoning: string;
    estimatedCost: number;
    estimatedLatency: number;
  }>> {
    const results = [];
    
    for (const provider of candidates) {
      const capability = PROVIDER_CAPABILITIES[provider];
      const estimatedTokens = this.estimateTokenUsage(request);
      const cost = estimateCost(provider, estimatedTokens.input, estimatedTokens.output);
      const latency = capability.latencyP99;
      
      // Skip if exceeds user limits
      if (cost > strategy.maxAcceptableCost || latency > strategy.maxAcceptableLatency) {
        continue;
      }
      
      let score = capability.reliability; // Base score on reliability
      let reasoning = `Reliability: ${capability.reliability}`;
      
      // Adjust score based on optimization strategy
      if (strategy.prioritizeCost) {
        const costScore = 1 / (cost + 0.001); // Inverse cost
        score *= costScore;
        reasoning += `; Cost optimization (${cost.toFixed(4)})`;
      }
      
      if (strategy.prioritizeSpeed) {
        const speedScore = 1 / (latency / 1000); // Inverse latency in seconds
        score *= speedScore;
        reasoning += `; Speed optimization (${latency}ms)`;
      }
      
      if (strategy.prioritizeQuality) {
        // Premium providers get quality bonus
        if (provider === AIProvider.ANTHROPIC) score *= 1.2;
        else if (provider === AIProvider.OPENAI) score *= 1.1;
        reasoning += '; Quality preference applied';
      }
      
      // Complexity matching bonus
      if (complexityAnalysis.complexity === 'high' && 
          (provider === AIProvider.ANTHROPIC || provider === AIProvider.OPENAI)) {
        score *= 1.15;
        reasoning += '; High complexity task bonus';
      }
      
      results.push({
        provider,
        score,
        reasoning,
        estimatedCost: cost,
        estimatedLatency: latency
      });
    }
    
    return results.sort((a, b) => b.score - a.score);
  }

  private estimateTokenUsage(request: AIRequest): { input: number; output: number } {
    const inputText = request.prompt + (request.systemPrompt || '');
    const inputTokens = Math.ceil(inputText.length / 4); // Rough estimate: 4 chars per token
    
    const maxTokens = request.maxTokens || TASK_CHARACTERISTICS[request.taskType].contextLength / 4;
    const outputTokens = Math.min(maxTokens, Math.ceil(inputTokens * 0.5)); // Estimate output
    
    return { input: inputTokens, output: outputTokens };
  }

  private getModelForProvider(provider: AIProvider, taskType: TaskType): string {
    switch (provider) {
      case AIProvider.OPENAI:
        return TASK_CHARACTERISTICS[taskType].complexity === 'high' ? 'gpt-4o' : 'gpt-4o-mini';
      case AIProvider.ANTHROPIC:
        return TASK_CHARACTERISTICS[taskType].complexity === 'high' ? 'claude-3-opus-20240229' : 'claude-3-5-sonnet-20241022';
      case AIProvider.GOOGLE:
        return TASK_CHARACTERISTICS[taskType].contextLength > 100000 ? 'gemini-1.5-pro' : 'gemini-1.5-flash';
      case AIProvider.PERPLEXITY:
        return 'llama-3.1-sonar-large-128k-online';
      case AIProvider.OPENLLM_RO:
        return 'rollama3-8b-instruct';
      case AIProvider.AI_GATEWAY:
        return 'auto'; // Gateway handles model selection
      default:
        return 'gpt-4o-mini';
    }
  }

  public reportFailure(provider: AIProvider, error: Error): void {
    if (!this.config.enableCircuitBreaker) return;
    
    const state = this.circuitBreakerStates.get(provider) || { failures: 0 };
    state.failures++;
    state.lastFailure = new Date();
    this.circuitBreakerStates.set(provider, state);
  }

  public reportSuccess(provider: AIProvider): void {
    if (!this.config.enableCircuitBreaker) return;
    
    // Reset failure count on successful request
    this.circuitBreakerStates.delete(provider);
  }
}