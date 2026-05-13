import { describe, it, expect } from 'vitest'
import { parseSSEStream } from '@/lib/sse/parse'

function readerFromStrings(parts: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p))
      c.close()
    },
  }).getReader()
}

describe('parseSSEStream', () => {
  it('parses a single event with event + data fields', async () => {
    const reader = readerFromStrings(['event: text_delta\ndata: {"content":"hi"}\n\n'])
    const out: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) out.push({ event: e.event, data: e.data })
    expect(out).toEqual([{ event: 'text_delta', data: { content: 'hi' } }])
  })

  it('parses multiple back-to-back events', async () => {
    const reader = readerFromStrings([
      'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n',
    ])
    const out: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) out.push({ event: e.event, data: e.data })
    expect(out).toEqual([
      { event: 'a', data: { x: 1 } },
      { event: 'b', data: { y: 2 } },
    ])
  })

  it('survives split chunks', async () => {
    const reader = readerFromStrings(['event: a\nda', 'ta: {"v":1}\n\n'])
    const out: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) out.push({ event: e.event, data: e.data })
    expect(out).toEqual([{ event: 'a', data: { v: 1 } }])
  })

  it('defaults event to "message" when no event: line present', async () => {
    // Mirrors the existing /api/ai/agent protocol: data-only chunks.
    const reader = readerFromStrings(['data: {"type":"text_delta","content":"hi"}\n\n'])
    const out: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) out.push({ event: e.event, data: e.data })
    expect(out).toEqual([{ event: 'message', data: { type: 'text_delta', content: 'hi' } }])
  })

  it('returns { data: undefined, raw } for non-JSON data', async () => {
    const reader = readerFromStrings(['event: log\ndata: not-json\n\n'])
    const out: { event: string; data: unknown; raw?: string }[] = []
    for await (const e of parseSSEStream(reader)) out.push(e)
    expect(out).toEqual([{ event: 'log', data: undefined, raw: 'not-json' }])
  })
})
