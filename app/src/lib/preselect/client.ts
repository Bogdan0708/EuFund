// Client-side fetch wrapper for /api/v1/projects/preselect.
// Keeps useAgent purely SSE-focused; this file owns the preselect handshake.

export interface Candidate {
  callId: string
  title: string
  score: number
  program?: string
  sourceUrl?: string
}

export type PreselectResponse =
  | {
      kind: 'selected'
      sessionId: string
      selectedCallId: string
      candidates: Candidate[]
      // Optional because override mode responses omit these fields —
      // setSelectedCall doesn't re-fetch the blueprint or change phase.
      // Rank and confirm modes always populate them.
      blueprintKind?: 'structured' | 'raw_evidence' | 'none'
      phase?: 'structuring' | 'research'
    }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'no_match'; reason: string }

export interface PreselectError {
  kind: 'error'
  httpStatus: number
  code: string
  message: string
}

export interface PreselectRequest {
  description: string
  locale: 'ro' | 'en'
  sessionId?: string
  expectedStateVersion?: number
  confirmCandidateId?: string
  excludeCallIds?: string[]
}

export async function preselect(
  body: PreselectRequest,
): Promise<PreselectResponse | PreselectError> {
  let res: Response
  try {
    res = await fetch('/api/v1/projects/preselect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return {
      kind: 'error',
      httpStatus: 0,
      code: 'NETWORK_ERROR',
      message: e instanceof Error ? e.message : 'network error',
    }
  }

  const json = await res.json().catch(() => null)

  if (!res.ok) {
    return {
      kind: 'error',
      httpStatus: res.status,
      code: json?.error?.code ?? 'UNKNOWN',
      message: json?.error?.message ?? `HTTP ${res.status}`,
    }
  }

  return json as PreselectResponse
}
