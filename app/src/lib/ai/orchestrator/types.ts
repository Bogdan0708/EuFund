export interface WorkflowContext {
  sessionId: string
  userId: string
  locale: 'ro' | 'en'
  tier: string
  step: number
  enhancedIdea: EnhancedIdea | null
  matchedCalls: MatchedCall[] | null
  validationResults: ValidationResult[] | null
  researchResults: ResearchResult | null
  actionPlan: ActionPlan | null
  projectSections: ProjectSection[] | null
  selectedCallId: string | null
  uploadedFiles: UploadedFile[]
}

export interface EnhancedIdea {
  originalIdea: string
  refinedDescription: string
  sector: string
  region: string
  targetGroup: string
  estimatedBudget: string
  keyObjectives: string[]
}

export interface MatchedCall {
  callId: string
  title: string
  program: string
  score: number
  thematicFit: number
  eligibilityFit: number
  budgetFit: number
  deadline: string
  sourceUrl: string
  reasoning: string
}

export interface ValidationResult {
  callId: string
  isOpen: boolean
  lastVerified: string
  updates: string[]
  warnings: string[]
}

export interface ResearchResult {
  callId: string
  requirements: string[]
  forms: { name: string; url?: string; description: string }[]
  certificates: { name: string; source: string; estimatedTime: string }[]
  deadlines: { item: string; date: string }[]
  additionalSections: string[]
  rawFindings: string
}

export interface ActionPlan {
  matchedCall: {
    title: string
    program: string
    deadline: string
    budget: { min: number; max: number; currency: string }
    sourceUrl: string
  }
  steps: {
    order: number
    title: string
    description: string
    category: 'document' | 'approval' | 'registration' | 'writing' | 'budget'
    deadline?: string
    responsible?: string
    dependencies: number[]
  }[]
  requiredDocuments: {
    name: string
    source: string
    estimatedTime: string
    mandatory: boolean
  }[]
  estimatedTimeline: string
}

export interface ProjectSection {
  title: string
  content: string
  order: number
  source: 'generated' | 'edited'
}

export interface UploadedFile {
  fileId: string
  filename: string
  mimeType: string
  extractedText?: string
}

export interface AgentResult {
  data: Record<string, unknown>
  checkpoint: CheckpointData | null
  tokensUsed?: number
}

export interface CheckpointData {
  question: string
  options?: { id: string; label: string; description?: string }[]
  type: 'select' | 'confirm' | 'freetext'
}

export type SSEEvent = {
  eventId: number
} & (
  | { type: 'step_start'; step: number; label: string }
  | { type: 'step_progress'; step: number; message: string }
  | { type: 'ai_chunk'; step: number; content: string }
  | { type: 'checkpoint'; step: number; data: CheckpointData }
  | { type: 'step_complete'; step: number; summary: string; context?: Partial<WorkflowContext> }
  | { type: 'discovery'; items: unknown[] }
  | { type: 'error'; step: number; message: string; retryable: boolean }
  | { type: 'done'; projectId?: string }
)

// Distributive Omit that preserves union discrimination
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

export type SSEEventPayload = DistributiveOmit<SSEEvent, 'eventId'>

export interface SSEStream {
  send(event: SSEEventPayload): void
  close(): void
}

export interface GatewayClient {
  generate(opts: {
    provider: string
    model: string
    system: string
    messages: { role: string; content: string }[]
    maxTokens?: number
    temperature?: number
    stream?: boolean
  }): Promise<{ content: string; tokensUsed: number }>
  embed(text: string): Promise<number[]>
}

export type AgentFn = (
  ctx: WorkflowContext,
  input: string,
  stream: SSEStream,
  gateway: GatewayClient
) => Promise<AgentResult>

export const STEP_LABELS: Record<number, string> = {
  1: 'Enhancing your idea...',
  2: 'Matching with funding calls...',
  3: 'Validating funding call status...',
  4: 'Researching requirements...',
  5: 'Updating knowledge base...',
  6: 'Creating action plan...',
  7: 'Building your project...',
}
