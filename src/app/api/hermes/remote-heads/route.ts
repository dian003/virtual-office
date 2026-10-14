import { NextResponse } from 'next/server'
import { listRemoteHeads } from '@/lib/hermes/remote-heads'

export const dynamic = 'force-dynamic'

/**
 * Daftar remote head (registry remote-heads.ts) + status hidupnya.
 *
 * Status diprobe dari health endpoint A2A tiap head (GET <baseUrl>/):
 * semua server head di fleet ini menjawab 200 + JSON di root-nya
 * (bridge Hermes STB, bridge cue, server antrean Muse). Timeout 4 dtk
 * per head, semua paralel, hasil di-cache 10 dtk supaya panel yang
 * mem-poll tidak menghujani head dengan probe.
 */

const PROBE_TIMEOUT_MS = 4000
const CACHE_MS = 10_000

type Head = ReturnType<typeof listRemoteHeads>[number]

type HeadStatus = {
  id: string
  name: string
  baseUrl: string
  agents: string[]
  live: boolean
  httpStatus: number | null
  latencyMs: number
  detail: string
}

let cache: { at: number; heads: HeadStatus[] } | null = null

async function probe(head: Head): Promise<HeadStatus> {
  const started = Date.now()
  const base = { id: head.id, name: head.name, baseUrl: head.baseUrl, agents: head.agents }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${head.baseUrl}/`, { signal: ctrl.signal, cache: 'no-store' })
    let detail = ''
    try {
      const j = (await res.json()) as { name?: string; agent?: string; status?: string }
      detail = j.name || j.agent || j.status || ''
    } catch {
      /* bukan JSON - detail kosong */
    }
    return {
      ...base,
      live: res.status === 200,
      httpStatus: res.status,
      latencyMs: Date.now() - started,
      detail,
    }
  } catch {
    return { ...base, live: false, httpStatus: null, latencyMs: Date.now() - started, detail: 'tidak terjangkau' }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ heads: cache.heads, checkedAt: new Date(cache.at).toISOString(), cached: true })
  }
  const heads = await Promise.all(listRemoteHeads().map(probe))
  cache = { at: Date.now(), heads }
  return NextResponse.json({ heads, checkedAt: new Date(cache.at).toISOString(), cached: false })
}
