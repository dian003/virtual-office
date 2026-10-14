import { listRemoteHeads, type RemoteHead } from './remote-heads'

/**
 * Probe health endpoint A2A tiap head (GET <baseUrl>/).
 *
 * Semua server head di fleet ini menjawab 200 + JSON di root-nya
 * (bridge Hermes STB, bridge cue, server antrean Muse). Timeout 4 dtk
 * per head, semua paralel. Hasil di-cache 10 dtk dan probe yang sedang
 * berjalan dipakai ulang, supaya banyak pemanggil (panel status, roster
 * ruangan, daftar chat) tidak menghujani head dengan probe.
 */
export const REMOTE_PROBE_TIMEOUT_MS = 4000
const CACHE_MS = 10_000

export type RemoteHeadStatus = {
  id: string
  name: string
  baseUrl: string
  agents: string[]
  live: boolean
  httpStatus: number | null
  latencyMs: number
  detail: string
}

let cache: { at: number; heads: RemoteHeadStatus[] } | null = null
let inFlight: Promise<RemoteHeadStatus[]> | null = null

async function probe(head: RemoteHead): Promise<RemoteHeadStatus> {
  const started = Date.now()
  const base = { id: head.id, name: head.name, baseUrl: head.baseUrl, agents: head.agents }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REMOTE_PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`${head.baseUrl}/`, { signal: ctrl.signal, cache: 'no-store' })
    let detail = ''
    try {
      const j = (await res.json()) as { name?: string; agent?: string; status?: string }
      detail = j.name || j.agent || j.status || ''
    } catch {
      /* bukan JSON — detail kosong */
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

/** Status semua head; hasil di-cache 10 dtk, probe paralel dipakai ulang. */
export async function getRemoteHeadStatuses(): Promise<RemoteHeadStatus[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.heads
  if (inFlight) return inFlight
  inFlight = (async () => {
    const heads = await Promise.all(listRemoteHeads().map(probe))
    cache = { at: Date.now(), heads }
    return heads
  })()
  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}
