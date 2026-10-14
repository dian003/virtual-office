import { NextRequest, NextResponse } from 'next/server'
import { VERIFICATION_BATCH_CAP } from '@/lib/hermes/verification'
import { verificationMarks, type VerificationMarkRow } from '@/lib/hermes/kanban'
import { isRemoteTaskId, remoteVerificationRows } from '@/lib/hermes/remote-tasks'

export const dynamic = 'force-dynamic'

/**
 * Penanda verifikasi untuk banyak task sekaligus (papan Kanban). POST hanya karena daftar id ada di
 * body — ini bacaan, tidak mengubah apa pun.
 *
 * RINGKAS: hanya `kanban show --json` per id (status + events), tanpa log dan lampiran.
 * Maksimal VERIFICATION_BATCH_CAP id diperiksa; sisanya `unchecked` (netral, tidak dinilai).
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
    // Tugas remote: klaim agent tidak diverifikasi independen (jujur: 'unchecked').
    const remoteRows = await remoteVerificationRows(allIds.filter(isRemoteTaskId))
    const localRows: VerificationMarkRow[] = allIds.some((x) => !isRemoteTaskId(x))
      ? await verificationMarks(allIds.filter((x) => !isRemoteTaskId(x)))
      : []
    const remoteById = new Map(remoteRows.map((r) => [r.id, r]))
    const localById = new Map(localRows.map((r) => [r.id, r]))
    const marks = allIds.map(
      (x) => remoteById.get(x) ?? localById.get(x) ?? { id: x, mark: 'unchecked' as const },
    )
    return NextResponse.json({
      mode: 'ringkas',
      note: 'ringkas: hanya show (status+events) per id; panel detail membaca task yang sama',
      cap: VERIFICATION_BATCH_CAP,
      ageSeconds: 0,
      readAt: new Date().toISOString(),
      marks,
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'verification_failed', message: (err as Error).message, status: 502 } },
      { status: 502 },
    )
  }
}
