import { NextResponse } from 'next/server'
import { getRemoteHead, listRemoteHeads } from '@/lib/hermes/remote-heads'
import { sendA2a, a2aEndpoint } from '@/lib/hermes/meeting-a2a'
import { translateInbound, translateOutbound } from '@/lib/hermes/translator'

export const dynamic = 'force-dynamic'

/**
 * Hook: panggil agent Hermes di head remote (mis. STB) via A2A.
 *
 * POST /api/hermes/remote-call
 *   { "head": "stb", "agent": "tester", "text": "...", "timeoutMs": 120000 }
 *
 * GET /api/hermes/remote-call  -> daftar head + agentnya
 *
 * Head hanya menyumbang otak (skills/personality/memory/subagent);
 * eksekusi file/tools tetap di Windows berdasarkan hasil ini.
 *
 * Jalur presiden<->head: teks keluar diterjemahkan ID->EN dan hasil
 * diterjemahkan EN->ID lewat profil translator (DeepL) — lihat
 * lib/hermes/translator.ts. Matikan per panggilan dengan
 * "translate": false, atau global lewat env TRANSLATOR_ENABLED.
 */

const DEFAULT_TIMEOUT_MS = 120_000

export async function GET() {
  try {
    const heads = listRemoteHeads().map((h) => ({
      id: h.id, name: h.name, baseUrl: h.baseUrl, agents: h.agents,
    }))
    return NextResponse.json({ heads })
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'remote_heads_failed', message: (err as Error).message } },
      { status: 500 },
    )
  }
}

export async function POST(req: Request) {
  let body: {
    head?: string
    agent?: string
    text?: string
    timeoutMs?: number
    /** Lampiran gambar: base64 murni atau data URI. Diteruskan sebagai A2A file parts. */
    images?: { data: string; mimeType?: string; name?: string }[]
    /** false = lewati translator untuk panggilan ini. */
    translate?: boolean
    taskId?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'bad_json', message: 'body harus JSON' } },
      { status: 400 },
    )
  }
  const { head: headId, agent, text } = body
  const timeoutMs = body.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!headId || !agent || !text) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'wajib: head, agent, text' } },
      { status: 400 },
    )
  }
  const head = getRemoteHead(headId)
  if (!head) {
    return NextResponse.json(
      { error: { code: 'unknown_head', message: `head '${headId}' tidak dikenal` } },
      { status: 404 },
    )
  }
  if (!head.agents.includes(agent)) {
    return NextResponse.json(
      { error: { code: 'unknown_agent', message: `agent '${agent}' tidak ada di head '${headId}'` } },
      { status: 404 },
    )
  }
  const fileParts = (body.images ?? []).slice(0, 4).map((img, i) => {
    const data = img.data.startsWith('data:')
      ? img.data.slice(img.data.indexOf(',') + 1)
      : img.data
    return {
      file: {
        name: img.name ?? `image-${i + 1}`,
        mimeType: img.mimeType ?? 'image/png',
        bytes: data,
      },
    }
  })
  try {
    const taskId = body.taskId || `rc-${head.id}-${agent}-${Date.now().toString(36)}`
    const useTranslator = body.translate !== false
    const outT = useTranslator
      ? await translateOutbound(text, taskId)
      : { text, engine: 'passthrough' as const, billed: 0 }
    const turn = await sendA2a(head.baseUrl, agent, outT.text, timeoutMs, fileParts)
    const inT = useTranslator
      ? await translateInbound(turn.text, taskId)
      : { text: turn.text, engine: 'passthrough' as const, billed: 0 }
    return NextResponse.json({
      head: head.id,
      agent,
      endpoint: a2aEndpoint(head.baseUrl, agent),
      text: inT.text,
      ctx: turn.ctx,
      translation: { taskId, out: outT, in: inT },
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: {
          code: 'remote_call_failed',
          message: (err as Error).message,
          head: head.id,
          agent,
        },
      },
      { status: 502 },
    )
  }
}
