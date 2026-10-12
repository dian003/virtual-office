import { NextResponse } from 'next/server'
import { getJob } from '@/lib/hermes/remote-worker'

export const dynamic = 'force-dynamic'

/** GET /api/hermes/remote-queue/<jobId> -> status + hasil. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const job = getJob(id)
  if (!job) {
    return NextResponse.json(
      { error: { code: 'not_found', message: `job '${id}' tidak ada` } },
      { status: 404 },
    )
  }
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    spec: job.spec,
    result: job.result ?? null,
    enqueuedAt: job.enqueuedAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
  })
}
