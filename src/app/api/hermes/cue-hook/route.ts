import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Hook penerima dari server Cue (Manus cloud computers).
 *
 * POST /api/hermes/cue-hook
 *   {
 *     "cue": "cue-1",           // ID server cue (cue-1..cue-5)
 *     "action": "task",         // aksi: task | result | ping | event
 *     "payload": { ... }        // data bebas sesuai aksi
 *   }
 *
 * GET /api/hermes/cue-hook  -> status + daftar cue terdaftar
 *
 * Kontrak ini disiapkan untuk interface hook yang dibangun user
 * di sisi cue. Endpoint ini fleksibel: payload diteruskan apa adanya.
 */

interface CueHookBody {
  cue?: string
  action?: string
  payload?: unknown
}

// Daftar cue yang dikenal (bisa via env CUE_SERVERS_JSON)
function listCues() {
  const env = process.env.CUE_SERVERS_JSON
  if (env) {
    try {
      return JSON.parse(env) as Array<{ id: string; ip: string; role: string }>
    } catch {
      // fall through ke default
    }
  }
  return [
    { id: 'cue-1', ip: '100.74.205.52', role: 'VIDEO+SOSMED' },
    { id: 'cue-2', ip: '100.120.70.96', role: 'BUSINESS+FINANCE' },
    { id: 'cue-3', ip: '100.124.26.114', role: 'IDEATION+REVIEWER' },
    { id: 'cue-4', ip: '100.113.25.17', role: 'MECHANIC+ELECTRONIC' },
    { id: 'cue-5', ip: '100.71.110.65', role: 'BUILDER+spare' },
  ]
}

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      cues: listCues(),
      contract: {
        endpoint: 'POST /api/hermes/cue-hook',
        fields: ['cue', 'action', 'payload'],
        actions: ['task', 'result', 'ping', 'event'],
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'cue_hook_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  let body: CueHookBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'bad_json', message: 'Body harus JSON valid' } },
      { status: 400 },
    )
  }

  const { cue, action = 'event', payload } = body

  if (!cue) {
    return NextResponse.json(
      { error: { code: 'missing_cue', message: 'Field "cue" wajib diisi (cue-1..cue-5)' } },
      { status: 400 },
    )
  }

  const known = listCues().find((c) => c.id === cue)
  if (!known) {
    return NextResponse.json(
      { error: { code: 'unknown_cue', message: `Cue "${cue}" tidak terdaftar` } },
      { status: 400 },
    )
  }

  const receivedAt = new Date().toISOString()

  // TODO: routing aksi spesifik (task -> queue, result -> callback, dsb.)
  // Untuk sekarang: terima, catat, akui.
  console.log(`[cue-hook] ${cue} action=${action} at=${receivedAt}`)

  return NextResponse.json({
    ok: true,
    cue,
    action,
    receivedAt,
    // Echo kembali agar pengirim bisa verifikasi
    payloadReceived: payload !== undefined,
  })
}
