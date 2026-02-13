// ─── AI Configuration ────────────────────────────────────────────
// Centralized AI provider config with GDPR-compliant defaults

export const AI_CONFIG = {
  // Primary model for generation tasks
  generation: {
    provider: 'openai' as const,
    model: process.env.AI_GENERATION_MODEL || 'gpt-4o',
    temperature: 0.7,
    maxTokens: 4096,
  },
  // Model for analysis/classification
  analysis: {
    provider: 'openai' as const,
    model: process.env.AI_ANALYSIS_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    maxTokens: 2048,
  },
  // Embedding model
  embedding: {
    provider: 'openai' as const,
    model: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    dimensions: 1536,
  },
  // Romanian BERT for local text processing
  romanianBert: {
    model: 'dumitrescustefan/bert-base-romanian-cased-v1',
    // Used for: tokenization, NER, text classification
    // Runs via HuggingFace Inference API or local
    endpoint: process.env.ROMANIAN_BERT_ENDPOINT || 'https://api-inference.huggingface.co/models/dumitrescustefan/bert-base-romanian-cased-v1',
  },
  // Vector store
  vectorStore: {
    provider: (process.env.VECTOR_PROVIDER || 'memory') as 'qdrant' | 'memory',
    qdrantUrl: process.env.QDRANT_URL || 'http://localhost:6333',
    collectionName: process.env.VECTOR_COLLECTION || 'eu_legislation',
  },
  // Rate limits per user
  rateLimits: {
    proposalGenerationsPerDay: 10,
    documentAnalysesPerDay: 20,
    grantMatchesPerDay: 50,
    complianceChecksPerDay: 30,
  },
  // GDPR: Data processing agreement references
  gdpr: {
    legalBasis: 'contract' as const,
    sccReference: 'SCC-2021/914-EU', // Standard Contractual Clauses
    dpiaReference: 'DPIA-FONDEU-AI-001',
    dataRetentionDays: 90, // AI-generated content retention
  },
} as const;

export type AIProvider = typeof AI_CONFIG.generation.provider;
