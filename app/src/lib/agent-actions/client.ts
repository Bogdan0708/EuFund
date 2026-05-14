import { csrfFetch } from '@/lib/csrf/client'

export interface ActionErrorBody {
  error: {
    code: string
    messageRo: string
    messageEn: string
    currentStateVersion?: number
    details?: unknown
  }
}

export class ActionError extends Error {
  constructor(
    public code: string,
    public messageRo: string,
    public messageEn: string,
    public currentStateVersion?: number,
  ) {
    super(`${code}: ${messageEn}`)
    this.name = 'ActionError'
  }
}

export async function callAction<T>(
  sessionId: string,
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await csrfFetch(`/api/v1/agent-sessions/${sessionId}/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Partial<ActionErrorBody>
    throw new ActionError(
      err?.error?.code ?? 'UNKNOWN',
      err?.error?.messageRo ?? '',
      err?.error?.messageEn ?? '',
      err?.error?.currentStateVersion,
    )
  }
  return (await res.json()) as T
}
