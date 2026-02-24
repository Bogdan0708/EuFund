// ─── Multi-Provider AI Types ─────────────────────────────────────────
// Comprehensive type system for intelligent AI provider routing

export enum AIProvider {
  OPENAI = 'openai',
  ANTHROPIC = 'anthropic', 
  GOOGLE = 'google',
  PERPLEXITY = 'perplexity',
  OPENLLM_RO = 'openllm-ro',
  AI_GATEWAY = 'ai-gateway'
}

export enum TaskType {
  // Generation Tasks
  PROPOSAL_GENERATION = 'proposal_generation',
  SIMPLE_TEXT_GENERATION = 'simple_text_generation',
  ROMANIAN_LOCALIZATION = 'romanian_localization',
  CREATIVE_WRITING = 'creative_writing',

  // Analysis Tasks  
  DOCUMENT_ANALYSIS = 'document_analysis',
  COMPLIANCE_CHECK = 'compliance_check',
  GRANT_MATCHING = 'grant_matching',
  RISK_ASSESSMENT = 'risk_assessment',
  BUDGET_ANALYSIS = 'budget_analysis',

  // Specialized Tasks
  SEMANTIC_SEARCH = 'semantic_search',
  WEB_RESEARCH = 'web_research',
  ROMANIAN_NER = 'romanian_ner',
  LEGAL_ANALYSIS = 'legal_analysis',
  TIMELINE_OPTIMIZATION = 'timeline_optimization',
  PARTNER_MATCHING = 'partner_matching'
}

export interface TaskCharacteristics {
  complexity: 'low' | 'medium' | 'high';
  contextLength: number;
  requiresRomanian: boolean;
  requiresReasoning: boolean;
  requiresCreativity: boolean;
  latencySensitive: boolean;
  structuredOutput: boolean;
  costSensitive: boolean;
}

export interface ProviderCapability {
  taskTypes: TaskType[];
  maxContextLength: number;
  supportsRomanian: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  supportsSystemPrompts: boolean;
  costPerToken: {
    input: number;   // Cost per 1K input tokens in USD
    output: number;  // Cost per 1K output tokens in USD
  };
  latencyP99: number; // P99 latency in milliseconds
  reliability: number; // Uptime percentage (0-1)
}

export interface UserTierLimits {
  tier: 'free' | 'pro' | 'enterprise';
  maxCostPerRequest: number;
  maxRequestsPerHour: number;
  allowExpensiveProviders: boolean;
  prioritizeSpeed: boolean;
  prioritizeCost: boolean;
}

export interface ProviderConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
  timeout: number;
  maxRetries: number;
  enabled: boolean;
}

export interface AIRequest {
  taskType: TaskType;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  userTier: 'free' | 'pro' | 'enterprise';
  userId: string;
  language?: 'ro' | 'en' | 'auto';
  structuredOutput?: boolean;
  schema?: unknown;
  priority: 'low' | 'normal' | 'high';
  cacheKey?: string;
}

export interface AIResponse {
  content: string;
  provider: AIProvider;
  model: string;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
  latency: number;
  cached: boolean;
  requestId: string;
  timestamp: Date;
}

export interface RoutingDecision {
  selectedProvider: AIProvider;
  selectedModel: string;
  reasoning: string;
  confidence: number; // 0-1
  estimatedCost: number;
  estimatedLatency: number;
  fallbackProviders: { provider: AIProvider; model: string }[];
}

export interface ProviderError {
  provider: AIProvider;
  model: string;
  error: string;
  retryable: boolean;
  timestamp: Date;
}

export interface CircuitBreakerState {
  provider: AIProvider;
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure?: Date;
  nextAttempt?: Date;
}

export interface CacheEntry {
  key: string;
  response: AIResponse;
  expiresAt: Date;
  hitCount: number;
}

export interface UsageMetrics {
  provider: AIProvider;
  taskType: TaskType;
  requestCount: number;
  totalCost: number;
  totalTokens: number;
  averageLatency: number;
  successRate: number;
  timeWindow: '1h' | '24h' | '7d' | '30d';
}

export interface RomanianLanguageContext {
  detectedLanguage: 'ro' | 'en' | 'mixed' | 'unknown';
  confidence: number;
  culturalContext: 'formal' | 'academic' | 'bureaucratic' | 'business' | 'casual';
  regionalization: 'ro' | 'md' | 'diaspora' | 'generic';
  complexity: 'simple' | 'moderate' | 'complex' | 'legal';
}

export interface OptimizationStrategy {
  prioritizeCost: boolean;
  prioritizeSpeed: boolean;
  prioritizeQuality: boolean;
  allowCache: boolean;
  maxAcceptableCost: number;
  maxAcceptableLatency: number;
  fallbackBehavior: 'fail' | 'retry' | 'degrade';
}

// Factory interfaces for provider implementations
export interface AIProviderInterface {
  provider: AIProvider;
  generateText(request: AIRequest): Promise<AIResponse>;
  generateObject<T>(request: AIRequest & { schema: unknown }): Promise<AIResponse & { object: T }>;
  embed(text: string): Promise<number[]>;
  isHealthy(): Promise<boolean>;
  getCapabilities(): ProviderCapability;
  estimateCost(request: AIRequest): number;
}

// Configuration interfaces
export interface AIRouterConfig {
  providers: Record<AIProvider, ProviderConfig>;
  routingStrategy: 'cost' | 'speed' | 'quality' | 'balanced';
  enableCaching: boolean;
  cacheProvider: 'redis' | 'memory';
  enableCircuitBreaker: boolean;
  enableMetrics: boolean;
  defaultFallbacks: AIProvider[];
}

export interface RomanianAIConfig {
  openLLMRoEndpoint: string;
  openLLMRoApiKey: string;
  enableCulturalContext: boolean;
  enableRegionalization: boolean;
  fallbackToGlobalModels: boolean;
}

// Error types
export class AIProviderError extends Error {
  constructor(
    public provider: AIProvider,
    public model: string,
    message: string,
    public retryable: boolean = true
  ) {
    super(`${provider}/${model}: ${message}`);
    this.name = 'AIProviderError';
  }
}

export class AIRoutingError extends Error {
  constructor(message: string, public request: AIRequest) {
    super(message);
    this.name = 'AIRoutingError';
  }
}

export class AIRateLimitError extends Error {
  constructor(
    public provider: AIProvider,
    public retryAfter: number
  ) {
    super(`Rate limited by ${provider}, retry after ${retryAfter}ms`);
    this.name = 'AIRateLimitError';
  }
}

// Utility types
export type TaskTypeCategory = 
  | 'generation'
  | 'analysis'
  | 'specialized'
  | 'romanian';

export type ProviderTier = 
  | 'premium'    // Claude Opus, GPT-4o
  | 'standard'   // Claude Sonnet, GPT-4o-mini
  | 'economy'    // Gemini Flash
  | 'specialized'; // Romanian models, Perplexity

export interface ProviderMetrics {
  provider: AIProvider;
  model: string;
  successRate: number;
  averageLatency: number;
  costEfficiency: number; // Quality per dollar
  romanianPerformance?: number; // Romanian-specific quality score
}

// Romanian specialization types
export interface RomanianContextAnalysis {
  requiresRomanianModel: boolean;
  culturalSensitivity: 'low' | 'medium' | 'high';
  technicalTerminology: boolean;
  legalContext: boolean;
  academicContext: boolean;
  businessContext: boolean;
  recommendedProvider: AIProvider;
  fallbackProviders: AIProvider[];
}
