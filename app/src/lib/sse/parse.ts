// Async generator parser for fetch-stream SSE responses. Yields one event
// per blank-line-separated chunk. `event:` defaults to `"message"` when
// absent. `data:` values are JSON.parsed; on parse error the chunk is
// yielded as `{ event, data: undefined, raw }` so callers can decide.

export interface SSEEvent {
  event: string
  data: unknown
  raw?: string
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const ev = parseChunk(chunk)
      if (ev) yield ev
    }
  }
  buf += decoder.decode()
  if (buf.trim().length > 0) {
    const ev = parseChunk(buf)
    if (ev) yield ev
  }
}

function parseChunk(chunk: string): SSEEvent | null {
  let event = 'message'
  let raw = ''
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) raw += (raw ? '\n' : '') + line.slice(6)
  }
  if (!raw) return null
  try {
    return { event, data: JSON.parse(raw) }
  } catch {
    return { event, data: undefined, raw }
  }
}
