// ─── AI Provider Capability Matrix ──────────────────────────────────
// Comprehensive provider capabilities, costs, and optimization rules

import { 
  AIProvider, 
  TaskType, 
  ProviderCapability, 
  TaskCharacteristics,
  ProviderTier
} from './types';

// ─── Provider Capabilities ───────────────────────────────────────────

export const PROVIDER_CAPABILITIES: Record<AIProvider, ProviderCapability> = {
  [AIProvider.OPENAI]: {
    taskTypes: [
      TaskType.PROPOSAL_GENERATION,
      TaskType.DOCUMENT_ANALYSIS, 
      TaskType.COMPLIANCE_CHECK,
      TaskType.GRANT_MATCHING,
      TaskType.BUDGET_ANALYSIS,
      TaskType.SEMANTIC_SEARCH,
      TaskType.TIMELINE_OPTIMIZATION
    ],
    maxContextLength: 128000, // GPT-4o
    supportsRomanian: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    costPerToken: {
      input: 0.0015,  // $1.50 per 1M input tokens
      output: 0.006   // $6.00 per 1M output tokens  
    },
    latencyP99: 2500,
    reliability: 0.995
  },

  [AIProvider.ANTHROPIC]: {
    taskTypes: [
      TaskType.PROPOSAL_GENERATION,
      TaskType.RISK_ASSESSMENT,
      TaskType.LEGAL_ANALYSIS,
      TaskType.ROMANIAN_LOCALIZATION,
      TaskType.CREATIVE_WRITING,
      TaskType.PARTNER_MATCHING
    ],
    maxContextLength: 200000, // Claude 3 Opus
    supportsRomanian: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    costPerToken: {
      input: 0.015,   // $15 per 1M input tokens (Opus)
      output: 0.075   // $75 per 1M output tokens
    },
    latencyP99: 3200,
    reliability: 0.998
  },

  [AIProvider.GOOGLE]: {
    taskTypes: [
      TaskType.SIMPLE_TEXT_GENERATION,
      TaskType.DOCUMENT_ANALYSIS,
      TaskType.COMPLIANCE_CHECK,
      TaskType.BUDGET_ANALYSIS,
      TaskType.GRANT_MATCHING
    ],
    maxContextLength: 1000000, // Gemini 1.5 Pro
    supportsRomanian: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    costPerToken: {
      input: 0.00125, // $1.25 per 1M input tokens
      output: 0.005   // $5.00 per 1M output tokens
    },
    latencyP99: 1800,
    reliability: 0.993
  },

  [AIProvider.PERPLEXITY]: {
    taskTypes: [
      TaskType.WEB_RESEARCH,
      TaskType.GRANT_MATCHING,
      TaskType.PARTNER_MATCHING
    ],
    maxContextLength: 16000,
    supportsRomanian: true,
    supportsFunctionCalling: false,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    costPerToken: {
      input: 0.002,   // $2.00 per 1M input tokens
      output: 0.02    // $20 per 1M output tokens
    },
    latencyP99: 4500,
    reliability: 0.990
  },

  [AIProvider.OPENLLM_RO]: {
    taskTypes: [
      TaskType.ROMANIAN_LOCALIZATION,
      TaskType.ROMANIAN_NER,
      TaskType.LEGAL_ANALYSIS // Romanian legal context
    ],
    maxContextLength: 8192,
    supportsRomanian: true,
    supportsFunctionCalling: false,
    supportsStreaming: false,
    supportsSystemPrompts: true,
    costPerToken: {
      input: 0.0005,  // Estimated for Hugging Face inference
      output: 0.0015  
    },
    latencyP99: 5000,
    reliability: 0.985
  },

  [AIProvider.AI_GATEWAY]: {
    taskTypes: Object.values(TaskType), // Gateway supports all via routing
    maxContextLength: 1000000, // Max of underlying providers
    supportsRomanian: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    costPerToken: {
      input: 0.001,   // Gateway aggregated pricing
      output: 0.003
    },
    latencyP99: 2200, // Including gateway overhead
    reliability: 0.999
  }
};

// ─── Task Characteristics ────────────────────────────────────────────

export const TASK_CHARACTERISTICS: Record<TaskType, TaskCharacteristics> = {
  [TaskType.PROPOSAL_GENERATION]: {
    complexity: 'high',
    contextLength: 8000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: true,
    latencySensitive: false,
    structuredOutput: false,
    costSensitive: false
  },

  [TaskType.SIMPLE_TEXT_GENERATION]: {
    complexity: 'low',
    contextLength: 2000,
    requiresRomanian: false,
    requiresReasoning: false,
    requiresCreativity: false,
    latencySensitive: true,
    structuredOutput: false,
    costSensitive: true
  },

  [TaskType.ROMANIAN_LOCALIZATION]: {
    complexity: 'medium',
    contextLength: 4000,
    requiresRomanian: true,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: false,
    costSensitive: false
  },

  [TaskType.DOCUMENT_ANALYSIS]: {
    complexity: 'high',
    contextLength: 50000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: true,
    costSensitive: false
  },

  [TaskType.COMPLIANCE_CHECK]: {
    complexity: 'medium',
    contextLength: 12000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: true,
    costSensitive: true
  },

  [TaskType.GRANT_MATCHING]: {
    complexity: 'medium',
    contextLength: 6000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: true,
    structuredOutput: true,
    costSensitive: true
  },

  [TaskType.RISK_ASSESSMENT]: {
    complexity: 'high',
    contextLength: 10000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: true,
    costSensitive: false
  },

  [TaskType.BUDGET_ANALYSIS]: {
    complexity: 'medium',
    contextLength: 8000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: true,
    costSensitive: true
  },

  [TaskType.SEMANTIC_SEARCH]: {
    complexity: 'low',
    contextLength: 1000,
    requiresRomanian: false,
    requiresReasoning: false,
    requiresCreativity: false,
    latencySensitive: true,
    structuredOutput: false,
    costSensitive: true
  },

  [TaskType.WEB_RESEARCH]: {
    complexity: 'medium',
    contextLength: 4000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: false,
    costSensitive: false
  },

  [TaskType.ROMANIAN_NER]: {
    complexity: 'low',
    contextLength: 2000,
    requiresRomanian: true,
    requiresReasoning: false,
    requiresCreativity: false,
    latencySensitive: true,
    structuredOutput: true,
    costSensitive: true
  },

  [TaskType.LEGAL_ANALYSIS]: {
    complexity: 'high',
    contextLength: 15000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: true,
    costSensitive: false
  },

  [TaskType.TIMELINE_OPTIMIZATION]: {
    complexity: 'medium',
    contextLength: 8000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: false,
    structuredOutput: true,
    costSensitive: true
  },

  [TaskType.PARTNER_MATCHING]: {
    complexity: 'medium',
    contextLength: 6000,
    requiresRomanian: false,
    requiresReasoning: true,
    requiresCreativity: false,
    latencySensitive: true,
    structuredOutput: true,
    costSensitive: true
  },

  [TaskType.CREATIVE_WRITING]: {
    complexity: 'high',
    contextLength: 4000,
    requiresRomanian: false,
    requiresReasoning: false,
    requiresCreativity: true,
    latencySensitive: false,
    structuredOutput: false,
    costSensitive: false
  }
};

// ─── Provider Tiers ──────────────────────────────────────────────────

export const PROVIDER_TIERS: Record<AIProvider, ProviderTier> = {
  [AIProvider.ANTHROPIC]: 'premium',     // Claude Opus - highest quality
  [AIProvider.OPENAI]: 'standard',       // GPT-4o - balanced
  [AIProvider.GOOGLE]: 'economy',        // Gemini - cost-effective
  [AIProvider.PERPLEXITY]: 'specialized', // Web research
  [AIProvider.OPENLLM_RO]: 'specialized', // Romanian expertise
  [AIProvider.AI_GATEWAY]: 'standard'     // Aggregated routing
};

// ─── Optimization Rules ──────────────────────────────────────────────

export interface OptimizationRule {
  condition: (taskType: TaskType, userTier: string, language?: string) => boolean;
  preferredProviders: AIProvider[];
  reasoning: string;
}

export const OPTIMIZATION_RULES: OptimizationRule[] = [
  {
    condition: (taskType, userTier, language) => 
      language === 'ro' && taskType === TaskType.ROMANIAN_LOCALIZATION,
    preferredProviders: [AIProvider.OPENLLM_RO, AIProvider.ANTHROPIC, AIProvider.OPENAI],
    reasoning: 'Romanian localization requires native language understanding'
  },
  
  {
    condition: (taskType, userTier) => 
      userTier === 'free' && TASK_CHARACTERISTICS[taskType].costSensitive,
    preferredProviders: [AIProvider.GOOGLE, AIProvider.OPENAI, AIProvider.AI_GATEWAY],
    reasoning: 'Cost optimization for free tier users'
  },
  
  {
    condition: (taskType) => 
      taskType === TaskType.WEB_RESEARCH,
    preferredProviders: [AIProvider.PERPLEXITY, AIProvider.OPENAI],
    reasoning: 'Perplexity specialized for web research with real-time data'
  },
  
  {
    condition: (taskType) => 
      TASK_CHARACTERISTICS[taskType].complexity === 'high' && 
      !TASK_CHARACTERISTICS[taskType].costSensitive,
    preferredProviders: [AIProvider.ANTHROPIC, AIProvider.OPENAI, AIProvider.GOOGLE],
    reasoning: 'High complexity tasks need premium reasoning capabilities'
  },
  
  {
    condition: (taskType) => 
      TASK_CHARACTERISTICS[taskType].latencySensitive,
    preferredProviders: [AIProvider.GOOGLE, AIProvider.OPENAI, AIProvider.AI_GATEWAY],
    reasoning: 'Latency-sensitive tasks prioritize faster providers'
  },
  
  {
    condition: (taskType) => 
      TASK_CHARACTERISTICS[taskType].contextLength > 50000,
    preferredProviders: [AIProvider.GOOGLE, AIProvider.ANTHROPIC, AIProvider.AI_GATEWAY],
    reasoning: 'Long context tasks require providers with large context windows'
  },
  
  {
    condition: (taskType, userTier) => 
      userTier === 'enterprise' && TASK_CHARACTERISTICS[taskType].requiresReasoning,
    preferredProviders: [AIProvider.ANTHROPIC, AIProvider.OPENAI],
    reasoning: 'Enterprise users get premium reasoning models'
  }
];

// ─── Cost Estimation ─────────────────────────────────────────────────

export function estimateCost(
  provider: AIProvider, 
  inputTokens: number, 
  outputTokens: number
): number {
  const capability = PROVIDER_CAPABILITIES[provider];
  return (inputTokens / 1000 * capability.costPerToken.input) + 
         (outputTokens / 1000 * capability.costPerToken.output);
}

export function getProviderRanking(
  taskType: TaskType,
  userTier: string,
  prioritizeCost: boolean = false,
  prioritizeSpeed: boolean = false
): AIProvider[] {
  // Filter providers that support this task type
  const supportedProviders = Object.entries(PROVIDER_CAPABILITIES)
    .filter(([, cap]) => cap.taskTypes.includes(taskType))
    .map(([provider]) => provider as AIProvider);
  
  // Apply optimization rules
  let rankedProviders = [...supportedProviders];
  
  for (const rule of OPTIMIZATION_RULES) {
    if (rule.condition(taskType, userTier)) {
      const ruleProviders = rule.preferredProviders.filter(p => 
        supportedProviders.includes(p)
      );
      if (ruleProviders.length > 0) {
        rankedProviders = ruleProviders;
        break;
      }
    }
  }
  
  // Sort by optimization criteria
  return rankedProviders.sort((a, b) => {
    const capA = PROVIDER_CAPABILITIES[a];
    const capB = PROVIDER_CAPABILITIES[b];
    
    if (prioritizeCost) {
      const costA = capA.costPerToken.input + capA.costPerToken.output;
      const costB = capB.costPerToken.input + capB.costPerToken.output;
      return costA - costB;
    }
    
    if (prioritizeSpeed) {
      return capA.latencyP99 - capB.latencyP99;
    }
    
    // Default: balanced ranking by reliability and capabilities
    const scoreA = capA.reliability * (1 / capA.latencyP99) * 1000;
    const scoreB = capB.reliability * (1 / capB.latencyP99) * 1000;
    return scoreB - scoreA;
  });
}

// ─── Romanian Optimization ───────────────────────────────────────────

export function getRomanianProviderRanking(taskType: TaskType): AIProvider[] {
  if (taskType === TaskType.ROMANIAN_LOCALIZATION || taskType === TaskType.ROMANIAN_NER) {
    return [AIProvider.OPENLLM_RO, AIProvider.ANTHROPIC, AIProvider.OPENAI];
  }
  
  // For other tasks requiring Romanian context
  return [AIProvider.ANTHROPIC, AIProvider.OPENLLM_RO, AIProvider.OPENAI, AIProvider.GOOGLE];
}

export const ROMANIAN_CULTURAL_CONTEXTS = {
  'formal': ['academic', 'legal', 'government'],
  'business': ['corporate', 'startup', 'sme'],
  'technical': ['engineering', 'research', 'scientific'],
  'casual': ['social', 'personal', 'informal']
};
