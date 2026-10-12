/**
 * Worker paralel multi-head.
 *
 * Konsep: Windows = otot + workspace pusat. Head = otak (STB, dst).
 * Kalau banyak head dipanggil bareng, jangan serial — pakai pool dengan
 * batas konkurensi per head + global, supaya paralel tapi tidak membanjiri.
 *
 * Dua pola:
 *  1. fanOut(calls, concurrency) — panggil banyak head paralel, tunggu semua.
 *  2. enqueue(...) — masuk antrean, worker latar memproses; cek via jobId.
 */
import { getRemoteHead } from './remote-heads'
import { sendA2a, type A2aTurnOk } from './meeting-a2a'

export interface RemoteCallSpec {
  head: string
  agent: string
  text: string
  timeoutMs?: number
}

export interface RemoteCallResult {
  head: string
  agent: string
  ok: boolean
  text?: string
  ctx?: string | null
  error?: string
}

/** Batas paralel per head (cegah satu head kebanjiran). */
const PER_HEAD_CONCURRENCY = parseInt(process.env.REMOTE_PER_HEAD_CONCURRENCY || '2', 10)
/** Batas paralel global. */
const GLOBAL_CONCURRENCY = parseInt(process.env.REMOTE_GLOBAL_CONCURRENCY || '8', 10)

/** Semaphore sederhana per kunci. */
class Semaphore {
  private running = 0
  private waiters: Array<() => void> = []
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.running < this.max) { this.running++; return }
    await new Promise<void>((res) => this.waiters.push(res))
    this.running++
  }
  release(): void {
    this.running--
    const w = this.waiters.shift()
    if (w) w()
  }
}

const globalSem = new Semaphore(GLOBAL_CONCURRENCY)
const headSems = new Map<string, Semaphore>()
function headSem(headId: string): Semaphore {
  let s = headSems.get(headId)
  if (!s) { s = new Semaphore(PER_HEAD_CONCURRENCY); headSems.set(headId, s) }
  return s
}

async function runOne(spec: RemoteCallSpec): Promise<RemoteCallResult> {
  const head = getRemoteHead(spec.head)
  if (!head) return { head: spec.head, agent: spec.agent, ok: false, error: `head '${spec.head}' tidak dikenal` }
  if (!head.agents.includes(spec.agent)) {
    return { head: spec.head, agent: spec.agent, ok: false, error: `agent '${spec.agent}' tidak ada di head '${spec.head}'` }
  }
  const hs = headSem(head.id)
  await globalSem.acquire()
  await hs.acquire()
  try {
    const turn: A2aTurnOk = await sendA2a(head.baseUrl, spec.agent, spec.text, spec.timeoutMs ?? 120_000)
    return { head: head.id, agent: spec.agent, ok: true, text: turn.text, ctx: turn.ctx }
  } catch (err) {
    return { head: head.id, agent: spec.agent, ok: false, error: (err as Error).message }
  } finally {
    hs.release()
    globalSem.release()
  }
}

/**
 * Panggil banyak head paralel (dibatasi konkurensi). Urutan hasil = urutan calls.
 */
export async function fanOut(calls: RemoteCallSpec[]): Promise<RemoteCallResult[]> {
  return Promise.all(calls.map(runOne))
}

/* ---------------- antrean latar ---------------- */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'
export interface Job {
  id: string
  spec: RemoteCallSpec
  status: JobStatus
  result?: RemoteCallResult
  enqueuedAt: string
  startedAt?: string
  finishedAt?: string
}

const jobs = new Map<string, Job>()
const queue: string[] = []
let pumpRunning = false
let jobSeq = 0

function newJobId(): string {
  jobSeq += 1
  return `rq-${Date.now().toString(36)}-${jobSeq}`
}

async function pump(): Promise<void> {
  if (pumpRunning) return
  pumpRunning = true
  try {
    while (queue.length > 0) {
      const id = queue.shift()!
      const job = jobs.get(id)
      if (!job) continue
      job.status = 'running'
      job.startedAt = new Date().toISOString()
      // jalan paralel sampai batas semaphore (tidak menunggu satu per satu)
      runOne(job.spec).then((result) => {
        job.result = result
        job.status = result.ok ? 'done' : 'failed'
        job.finishedAt = new Date().toISOString()
      })
      // beri kesempatan worker lain mulai tanpa menunggu selesai
      await new Promise((r) => setImmediate(r))
    }
  } finally {
    pumpRunning = false
  }
}

export function enqueue(spec: RemoteCallSpec): Job {
  const job: Job = {
    id: newJobId(),
    spec,
    status: 'queued',
    enqueuedAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  queue.push(job.id)
  void pump()
  // batasi memori: simpan 500 job terakhir
  if (jobs.size > 500) {
    const oldest = [...jobs.keys()][0]
    jobs.delete(oldest)
  }
  return job
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null
}

export function queueStats(): { queued: number; running: number; done: number; failed: number } {
  let queued = 0, running = 0, done = 0, failed = 0
  for (const j of jobs.values()) {
    if (j.status === 'queued') queued++
    else if (j.status === 'running') running++
    else if (j.status === 'done') done++
    else failed++
  }
  return { queued, running, done, failed }
}
