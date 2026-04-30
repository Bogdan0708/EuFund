import type { ProviderClient, GenerateRequest, GenerateResult, ModelConfig, ProviderName } from './types'

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_NET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'])

interface ErrorWithStatus { status?: number; code?: string; name?: string; message?: string }

function isRetryable(err: unknown, internalTimeoutFired: boolean): boolean {
  // Internal timeout: WE aborted because OUR timer fired. Transient on upstream.
  if (internalTimeoutFired) return true

  // External abort (caller cancelled, browser tab closed, upstream cancellation).
  // The signal is aborted but our internal timer did NOT fire. Do NOT fallback —
  // the user no longer wants the response. Throw through.
  if (err instanceof Error && err.name === 'AbortError') return false

  const e = err as ErrorWithStatus
  if (typeof e.status === 'number' && RETRYABLE_HTTP_STATUS.has(e.status)) return true
  if (typeof e.code === 'string' && RETRYABLE_NET_CODES.has(e.code)) return true

  return false
}

/**
 * Single-attempt with timeout-bounded primary + fresh-controller fallback.
 *
 * Contract:
 *   - `fn` MUST accept a single AbortSignal argument and pass it to the
 *     underlying SDK call. The signal is aborted by an internal timer
 *     after `config.timeout` ms.
 *   - On AbortError caused by the internal timer (or any other retryable
 *     error), the fallback provider is invoked with a brand-new
 *     AbortController and a brand-new timer. The two attempts NEVER share
 *     a signal — sharing would let a stale abort race onto the fallback.
 *   - On AbortError NOT caused by the internal timer (external cancellation),
 *     the error is rethrown without fallback.
 *   - On non-retryable errors (4xx other than 408/429), the original error
 *     is rethrown without fallback.
 *   - Fallback errors propagate as-is. There is no second fallback.
 */
/**
 * Race the inner call against the abort signal so that a misbehaving SDK
 * which ignores `signal` cannot hang the request indefinitely. The signal
 * IS still passed to the SDK (well-behaved adapters short-circuit on it),
 * but the race is the belt-and-braces guarantee that a rogue provider
 * client does not hold the request hostage past `config.timeout`.
 */
function raceAgainstAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

export async function withRetry(
  fn: (signal: AbortSignal) => Promise<GenerateResult>,
  config: ModelConfig,
  providers: Record<ProviderName, ProviderClient>,
  originalRequest?: GenerateRequest,
): Promise<GenerateResult> {
  const primaryController = new AbortController()
  let internalTimeoutFired = false
  const primaryTimer = setTimeout(() => {
    internalTimeoutFired = true
    primaryController.abort()
  }, config.timeout)

  try {
    return await raceAgainstAbort(fn(primaryController.signal), primaryController.signal)
  } catch (primaryErr) {
    clearTimeout(primaryTimer)

    if (!isRetryable(primaryErr, internalTimeoutFired)) throw primaryErr
    if (!config.fallback || !originalRequest) throw primaryErr

    // Fallback: brand-new controller and timer. Old signal is NOT reused.
    const fallbackController = new AbortController()
    const fallbackTimer = setTimeout(() => fallbackController.abort(), config.timeout)
    try {
      const fallbackProvider = providers[config.fallback.provider]
      return await raceAgainstAbort(
        fallbackProvider.generate(
          { ...originalRequest, provider: config.fallback.provider, model: config.fallback.model },
          fallbackController.signal,
        ),
        fallbackController.signal,
      )
    } finally {
      clearTimeout(fallbackTimer)
    }
  } finally {
    clearTimeout(primaryTimer)
  }
}
