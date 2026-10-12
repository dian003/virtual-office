import { NextResponse } from 'next/server'
import { fanOut, type RemoteCallSpec } from '@/lib/hermes/remote-worker'

export const dynamic = 'force-dynamic'

/**
 * Panggil banyak head/agent PARALEL dalam satu request.
 *
 * POST /api/hermes/remote-fanout
 *   { "calls": [{ "head": "stb", "agent": "tester", "text": "..." }, ...] }
 *
 * Konkurensi dibatasi: maks 2 per head, 8 global (via env
 * REMOTE_PER_HEAD_CONCURRENCY / REMOTE_GLOBAL_CONCURRENCY).
 * Respons: { results: [...] } — urutan sama dengan calls.
 */
export async function POST(req: Request) {
  let body: { calls?: RemoteCallSpec[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'bad_json', message: 'body harus JSON' } },
      { status: 400 },
    )
  }
  const calls = body.calls
  if (!Array.isArray(calls) || calls.length === 0) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'wajib: calls[] (min 1)' } },
      { status: 400 },
    )
  }
  if (calls.length > 50) {
    return NextResponse.json(
      { error: { code: 'too_many', message: 'maks 50 calls per request' } },
      { status: 400 },
    )
  }
  for (const c of calls) {
    if (!c.head || !c.agent || !c.text) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: 'tiap call wajib: head, agent, text' } },
        { status: 400 },
      )
    }
  }
  const started = Date.now()
  const results = await fanOut(calls)
  return NextResponse.json({
    results,
    elapsedMs: Date.now() - started,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  })
}
