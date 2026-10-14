import { NextRequest, NextResponse } from 'next/server'
import { EVIDENCE_BATCH_CAP } from '@/lib/hermes/evidence'
import { evidenceMarks, type EvidenceMarkRow } from '@/lib/hermes/kanban'
import { isRemoteTaskId, remoteEvidenceRows } from '@/lib/hermes/remote-tasks'

export const dynamic = 'force-dynamic'

/**
 * Penanda bukti untuk banyak task sekaligus (papan Kanban). POST hanya karena daftar id ada di
 * body — ini bacaan, tidak mengubah apa pun.
 *
 * RINGKAS: hanya `kanban show --json` per id (ringkasan + runs), tanpa log dan lampiran.
 * Maksimal EVIDENCE_BATCH_CAP id diperiksa; sisanya `unchecked` (netral, tidak dinilai).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const ids: unknown = body?.ids
  if (!Array.isArray(ids)) {
    return NextResponse.json(
      { error: { code: 'invalid_request', message: 'ids (array) wajib diisi', status: 400 } },
      { status: 400 },
    )
  }
  try {
    const allIds = ids.filter((x): x is string => typeof x === 'string')
    // Id remote tidak dikenal gateway: buktinya = teks balasan agent di store office.
    const remoteRows = await remoteEvidenceRows(allIds.filter(isRemoteTaskId))
    const localRows: EvidenceMarkRow[] = allIds.some((x) => !isRemoteTaskId(x))
      ? await evidenceMarks(allIds.filter((x) => !isRemoteTaskId(x)))
      : []
    const byId = new Map<string, EvidenceMarkRow>()
    for (const r of [...remoteRows, ...localRows]) byId.set(r.id, r as EvidenceMarkRow)
    const marks: EvidenceMarkRow[] = allIds.map(
      (x) => byId.get(x) ?? ({ id: x, mark: 'unchecked' } as EvidenceMarkRow),
    )
    return NextResponse.json({
      mode: 'ringkas',
      note: 'ringkas: hanya show+runs per id, tanpa log dan lampiran; panel detail membaca semuanya',
      cap: EVIDENCE_BATCH_CAP,
      ageSeconds: 0,
      readAt: new Date().toISOString(),
      marks,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'evidence_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
