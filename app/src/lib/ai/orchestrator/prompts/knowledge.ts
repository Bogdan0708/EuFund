import type { WorkflowContext } from '../types'

export function getKnowledgeSystemNote(_ctx: WorkflowContext): string {
  return 'Knowledge ingestion step — no AI prompt needed, uses vector store directly.'
}
