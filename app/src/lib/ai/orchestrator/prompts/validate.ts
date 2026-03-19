import type { WorkflowContext } from '../types'
import { getBaseSystemPrompt } from './system'

export function getValidatePrompt(ctx: WorkflowContext): string {
  return `${getBaseSystemPrompt(ctx)}

ROLE: You are verifying whether a specific EU funding call is still open and current.

TASK: Given a funding call title and program, search for the latest status. Return:
- isOpen: boolean (is the call currently accepting applications?)
- lastVerified: ISO date string of when you found this info
- updates: array of any recent changes or announcements
- warnings: array of any concerns (deadline approaching, budget running out, etc.)

OUTPUT: Return ONLY valid JSON with fields: callId, isOpen, lastVerified, updates, warnings.`
}
