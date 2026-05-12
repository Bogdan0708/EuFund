import type { ToolDefinition, Phase } from '../types'
import { z } from 'zod'

const tools: ToolDefinition[] = []

export function registerTool<TInput = unknown, TOutput = unknown>(
  tool: ToolDefinition<TInput, TOutput>,
): void {
  const registeredTool = tool as unknown as ToolDefinition

  // Deduplicate: real implementations replace placeholders
  const idx = tools.findIndex(t => t.name === registeredTool.name)
  if (idx >= 0) {
    tools[idx] = registeredTool
  } else {
    tools.push(registeredTool)
  }
}

export function getToolRegistry(): ToolDefinition[] {
  return [...tools]
}

// Read tools are always available. Decision/generation tools are phase-gated.
//
// extract_structure is exposed in BOTH research and structuring so the model
// has a path out of research when resolve_call's cache hit returns a blueprint
// without an outline. Without this, the model would have no phase-transition
// tool available — see the V3 phase-progression incident, 2026-05-11.
const PHASE_TOOLS: Record<Phase, string[]> = {
  discovery: ['search_calls'],
  research: ['resolve_call', 'get_call_blueprint', 'retrieve_call_evidence', 'refresh_call_freshness', 'run_eligibility', 'extract_structure'],
  structuring: ['extract_structure', 'run_eligibility'],
  drafting: ['generate_section', 'validate_section', 'list_missing_annexes'],
  review: ['validate_application', 'regenerate_section', 'validate_section'],
}

export function getToolsForPhase(phase: Phase): ToolDefinition[] {
  const readTools = tools.filter(t => t.category === 'read')
  const phaseToolNames = PHASE_TOOLS[phase] ?? []
  const phaseTools = tools.filter(t => phaseToolNames.includes(t.name))
  // Deduplicate (read tools that are also in phase list)
  const seen = new Set<string>()
  const result: ToolDefinition[] = []
  for (const tool of [...readTools, ...phaseTools]) {
    if (!seen.has(tool.name)) {
      seen.add(tool.name)
      result.push(tool)
    }
  }
  return result
}

// Register placeholder tools so the registry is testable.
// These will be replaced by real implementations in later tasks.
// NOTE: search_calls is implemented in search-calls.ts (self-registers on import).

registerTool({
  name: 'generate_section',
  category: 'generation',
  description: 'Generate a section of the funding application',
  inputSchema: z.object({ sectionKey: z.string() }),
  execute: async () => ({ success: true, data: null, telemetry: { latencyMs: 0 } }),
  timeout: 120_000,
})

registerTool({
  name: 'validate_application',
  category: 'decision',
  description: 'Validate the complete application',
  inputSchema: z.object({}),
  execute: async () => ({ success: true, data: null, telemetry: { latencyMs: 0 } }),
  timeout: 30_000,
})
