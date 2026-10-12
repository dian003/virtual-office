import { NextResponse } from 'next/server'
import { enqueue, getJob, queueStats, type RemoteCallSpec } from '@/lib/hermes/remote-worker'

export const dynamic = 'force-dynamic'

/**
 * Antrean latar untuk panggilan remote head.
 *
 * POST /api/hermes/remote-queue  { head, agent, text } -> { jobId, status }
 * GET  /api/hermes/remote-queue?stats=1               -> { queued, running, done, failed }
 *
 * Worker memproses paralel (dibatasi semaphore); hasil diambil via
 * GET /api/hermes/remote-queue/<jobId>.
 */
export async function POST(req: Request) {
  let body: RemoteCallSpec
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'bad_json', message: 'body harus JSON' } },
      { status: 400 },
    )
  }
  if (!body.head || !body.agent || !body.text) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'wajib: head, agent, text' } },
      { status: 400 },
    )
  }
  const job = enqueue({ head: body.head, agent: body.agent, text: body.text, timeoutMs: body.timeoutMs })
  return NextResponse.json({ jobId: job.id, status: job.status, enqueuedAt: job.enqueuedAt })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('stats') === '1') {
    return NextResponse.json(queueStats())
  }
  return NextResponse.json(
    { error: { code: 'bad_request', message: 'pakai ?stats=1 atau GET /api/hermes/remote-queue/<jobId>' } },
    { status: 400 },
  )
}
