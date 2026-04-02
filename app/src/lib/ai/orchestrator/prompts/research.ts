import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getNotebookLmQuery(callTitle: string, program: string): string {
  return `For the call "${callTitle}" under ${program}, provide:
1. The exact Cerere de Finantare section structure (all required headings in order)
2. Mandatory annexes and supporting documents (exact names)
3. Eligibility criteria (organization types, regions, CAEN codes if applicable)
4. Evaluation grid (each criterion and its maximum point value)
5. Co-financing rate and budget constraints (min/max per project)
6. Key deadlines (submission, implementation start, project duration)

Be specific — cite the Ghidul Solicitantului section numbers where possible.`
}

export function getPerplexityFreshnessQuery(callTitle: string, program: string): string {
  return `Is the call "${callTitle}" (${program}) still open for applications as of today?
Check for: deadline extensions, budget amendments, corrigenda, or closure announcements.
Search on mfe.gov.ro, mysmis2021.gov.ro, and oportunitati-ue.gov.ro.
Return: current status (open/closed), any amendments found, current deadline if changed.`
}

export function getResearchPrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are normalizing raw research data about a EU funding call into a structured blueprint.

TASK: Given the raw research findings, extract and normalize:
- requiredSections: array of { title, description, evaluationWeight } — exact section headings from the Ghidul Solicitantului
- mandatoryAnnexes: array of document names
- eligibilityCriteria: array of criteria strings
- evaluationGrid: array of { criterion, maxPoints }
- cofinancingRate: number (e.g., 0.02 for 2%)
- isOpen: boolean
- amendments: array of change descriptions
- warnings: array of risk flags

OUTPUT: Return ONLY valid JSON matching the structure above.`
}
