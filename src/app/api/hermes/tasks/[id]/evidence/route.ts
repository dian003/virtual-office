import { NextRequest, NextResponse } from 'next/server'
import { getTaskEvidence } from '@/lib/hermes/kanban'
import { getRemoteTask, isRemoteTaskId, remoteTaskEvidence } from '@/lib/hermes/remote-tasks'

export const dynamic = 'force-dynamic'

/**
 * Bukti hasil kerja SATU task: ringkasan terakhir, run terakhir (outcome + metadata), log,
 * lampiran. Gagal membaca `show` = 502, BUKAN daftar bukti kosong — panel harus bisa
 * membedakan "tidak ada bukti" dari "tidak tahu".
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  // Tugas remote: layani dari store office â JANGAN ke kanban Hermes.
  if (isRemoteTaskId(id)) {
    const rec = await getRemoteTask(id)
    if (!rec) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `tugas remote "${id}" tidak ada`, status: 404 } },
        { status: 404 },
      )
    }
    return NextResponse.json(remoteTaskEvidence(rec))
  }
  try {
    return NextResponse.json(await getTaskEvidence(id))
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'evidence_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
