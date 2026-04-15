// Shared helpers for managed-pilot smoke scripts. Each script sends an
// HTTP request against the deployed pilot service (fondeu-pilot), so
// these helpers centralise env-var validation and the POST shape.
//
// ENV VARS
//   PILOT_URL             — base URL of the pilot service.
//   PILOT_SESSION_COOKIE  — authenticated session cookie for TARGET_USER_ID.
//   TARGET_USER_ID        — uuid used to filter DB verification queries.
//   DATABASE_URL          — read-only postgres URL for DB verification.

export function env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`missing env ${key}`)
  return v
}

export async function postAgent(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${env('PILOT_URL')}/api/ai/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: env('PILOT_SESSION_COOKIE'),
    },
    body: JSON.stringify(body),
  })
}

export function uuid(): string {
  return crypto.randomUUID()
}

export function report(smoke: string, status: 'pass' | 'fail', extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ smoke, status, ...extra }))
}

export async function drainSSE(res: Response): Promise<string> {
  return await res.text()
}

/** Wait for a prompt from the operator before continuing. Manual-assisted smokes use this. */
export async function prompt(msg: string, timeoutMs = 5 * 60_000): Promise<void> {
  process.stdout.write(`\n[operator] ${msg}\n[operator] press Enter when ready (timeout ${timeoutMs / 1000}s): `)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('operator-action timeout')), timeoutMs)
    process.stdin.resume()
    process.stdin.once('data', () => {
      clearTimeout(timer)
      process.stdin.pause()
      resolve()
    })
  })
}
