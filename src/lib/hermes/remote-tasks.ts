/**
 * Tugas untuk agent remote (remote heads) — dikelola 100% di sisi office.
 *
 * Berbeda dari task kanban Hermes (yang dieksekusi worker di gateway),
 * tugas remote TIDAK PERNAH menyentuh gateway: ia disimpan di file JSON office
 * (persisten di volume /app/data, pola yang sama dengan remote-chat.ts),
 * dieksekusi oleh antrean remote-worker (sendA2a ke head-nya), dan status +
 * hasilnya disinkronkan kembali ke store ini. Board membaca proyeksi berbentuk
 * Task sehingga kartu/detail Papan bekerja tanpa perubahan skema kanban.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isRemoteAgentKey, resolveRemoteAgent } from './remote-agents'
import { getRemoteHeadStatuses } from './remote-health'
import { enqueue, getJob, type Job } from './remote-worker'
import type { Task, TaskOrigin, TaskStatus } from '@/types/hermes'

export type RemoteTaskStatus = 'queued' | 'running' | 'done' | 'failed'

export interface RemoteTaskRecord {
  id: string
  title: string
  body?: string
  priority: number
  /** Kunci kanonik `remote:<headId>/<slug>` — identitas routing, bukan label. */
  assignee: string
  /** Snapshot displayName saat dibuat, untuk kartu Papan. */
  displayName: string
  headId: string
  agentSlug: string
  status: RemoteTaskStatus
  /** Teks balasan agent (done) atau pesan error (failed). */
  result?: string
  jobId?: string
  enqueuedAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
  origin?: TaskOrigin
}

export type RemoteBoardTask = Task & { result?: string; assigneeKey: string }

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
function storePath() {
  return path.join(DATA_DIR, 'remote-tasks.json')
}

/** Status untuk kolom Papan: queued→TODO, failed→TERHAMBAT (butuh perhatian). */
const BOARD_STATUS: Record<RemoteTaskStatus, TaskStatus> = {
  queued: 'todo',
  running: 'running',
  done: 'done',
  failed: 'blocked',
}

let seq = 0
let bootReconciled = false

function newTaskId() {
  seq += 1
  return `rt-${Date.now().toString(36)}-${seq}`
}

async function loadRecords(): Promise<RemoteTaskRecord[]> {
  let recs: RemoteTaskRecord[] = []
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) recs = parsed as RemoteTaskRecord[]
  } catch {
    /* belum ada file — mulai kosong */
  }
  if (!bootReconciled) {
    bootReconciled = true
    // Job antrean remote-worker itu in-memory: restart container menghapusnya,
    // jadi tugas yang masih jalan/antre saat boot tidak akan pernah selesai.
    // Tandai gagal dengan jujur daripada menggantung selamanya.
    const now = new Date().toISOString()
    let dirty = false
    for (const r of recs) {
      if (r.status === 'queued' || r.status === 'running') {
        r.status = 'failed'
        r.result = 'Terputus saat office restart — job antrean hilang. Buat ulang tugas bila masih perlu.'
        r.finishedAt = now
        r.updatedAt = now
        dirty = true
      }
    }
    if (dirty) await saveRecords(recs)
  }
  return recs
}

async function saveRecords(recs: RemoteTaskRecord[]): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true })
  await writeFile(storePath(), JSON.stringify(recs, null, 2), 'utf8')
}

function buildTaskPrompt(title: string, body?: string): string {
  return [
    'TUGAS DARI VIRTUAL OFFICE',
    `Judul: ${title}`,
    `Detail / kriteria penerimaan:\n${body && body.trim() ? body.trim() : '(tidak ada)'}`,
    '',
    'Kerjakan tugas di atas, lalu balas dengan HASIL kerjanya dalam teks biasa.',
  ].join('\n')
}

function settleFromJob(taskId: string, job: Job): void {
  void (async () => {
    try {
      const recs = await loadRecords()
      const rec = recs.find((r) => r.id === taskId)
      if (!rec || (rec.status !== 'queued' && rec.status !== 'running')) return
      rec.status = job.status === 'done' ? 'done' : 'failed'
      rec.result = job.result?.ok
        ? job.result.text?.trim() || '(agent membalas kosong)'
        : `GAGAL: ${job.result?.error ?? 'tidak diketahui'}`
      rec.startedAt = job.startedAt ?? rec.startedAt
      rec.finishedAt = job.finishedAt ?? new Date().toISOString()
      rec.updatedAt = new Date().toISOString()
      await saveRecords(recs)
    } catch {
      /* jangan jatuhkan pump worker */
    }
  })()
}

/** Validasi assignee remote untuk pembuatan tugas: kunci sah + head sedang LIVE. */
export async function validateRemoteAssignee(
  key: string,
): Promise<{ ok: true; displayName: string } | { ok: false; message: string }> {
  if (!isRemoteAgentKey(key)) return { ok: false, message: `bukan kunci agent remote: ${key}` }
  const info = resolveRemoteAgent(key)
  if (!info) return { ok: false, message: `agent remote tidak dikenal: ${key}` }
  const heads = await getRemoteHeadStatuses()
  const live = heads.find((h) => h.id === info.headId)?.live ?? false
  if (!live) {
    return { ok: false, message: `head '${info.headId}' sedang tidak live — tugas remote butuh head yang hidup` }
  }
  return { ok: true, displayName: info.displayName }
}

export async function createRemoteTask(input: {
  title: string
  body?: string
  priority?: number
  assignee: string
  origin?: TaskOrigin
}): Promise<RemoteTaskRecord> {
  const v = await validateRemoteAssignee(input.assignee)
  if (!v.ok) throw new Error(v.message)
  const info = resolveRemoteAgent(input.assignee)
  if (!info) throw new Error(`agent remote tidak dikenal: ${input.assignee}`)
  const now = new Date().toISOString()
  const rec: RemoteTaskRecord = {
    id: newTaskId(),
    title: input.title,
    body: input.body,
    priority: input.priority ?? 0,
    assignee: input.assignee,
    displayName: v.displayName,
    headId: info.headId,
    agentSlug: info.agentSlug,
    status: 'queued',
    enqueuedAt: now,
    updatedAt: now,
    origin: input.origin,
  }
  const recs = await loadRecords()
  recs.push(rec)
  await saveRecords(recs)
  // Dispatch lewat antrean remote-worker (bukan HTTP sinkron): agent penuh bisa
  // butuh hitungan menit. onSettled menulis hasil kembali ke store ini.
  const job = enqueue(
    {
      head: info.headId,
      agent: info.agentSlug,
      text: buildTaskPrompt(input.title, input.body),
      timeoutMs: 600_000,
    },
    (j) => settleFromJob(rec.id, j),
  )
  rec.jobId = job.id
  rec.updatedAt = new Date().toISOString()
  await saveRecords(recs)
  return rec
}

/** Sinkronkan status dari job in-memory (queued→running→done/failed) ke store. */
async function syncJobStates(recs: RemoteTaskRecord[]): Promise<boolean> {
  let dirty = false
  const now = new Date().toISOString()
  for (const r of recs) {
    if ((r.status === 'queued' || r.status === 'running') && r.jobId) {
      const j = getJob(r.jobId)
      if (j && j.status !== r.status && j.status !== 'queued') {
        r.status = j.status
        r.startedAt = j.startedAt ?? r.startedAt
        if (j.status === 'done' || j.status === 'failed') {
          r.result = j.result?.ok
            ? j.result.text?.trim() || '(agent membalas kosong)'
            : `GAGAL: ${j.result?.error ?? 'tidak diketahui'}`
          r.finishedAt = j.finishedAt ?? now
        }
        r.updatedAt = now
        dirty = true
      }
    }
  }
  return dirty
}

export async function listRemoteTasks(): Promise<RemoteTaskRecord[]> {
  const recs = await loadRecords()
  if (await syncJobStates(recs)) await saveRecords(recs)
  return recs.sort((a, b) => (a.enqueuedAt < b.enqueuedAt ? 1 : -1))
}

export async function getRemoteTask(id: string): Promise<RemoteTaskRecord | null> {
  const recs = await listRemoteTasks()
  return recs.find((r) => r.id === id) ?? null
}

export function isRemoteTaskId(id: string): boolean {
  return id.startsWith('rt-')
}

/** Proyeksi ke bentuk Task agar Papan/detail bisa menampilkannya apa adanya. */
export function toBoardTask(rec: RemoteTaskRecord): RemoteBoardTask {
  return {
    id: rec.id,
    title: rec.title,
    status: BOARD_STATUS[rec.status],
    assignee: rec.displayName,
    priority: rec.priority,
    body: rec.body,
    createdAt: rec.enqueuedAt,
    updatedAt: rec.updatedAt,
    completedAt: rec.finishedAt,
    origin: rec.origin ?? { kind: 'manual' },
    result: rec.result,
    assigneeKey: rec.assignee,
  }
}

type RemoteMark = { id: string; mark: 'proven' | 'failed' | 'unchecked'; completedAgeSeconds?: number | null; error?: string }

/** Baris evidence untuk id remote (bukti = teks balasan agent itu sendiri). */
export async function remoteEvidenceRows(ids: string[]): Promise<RemoteMark[]> {
  const recs = await listRemoteTasks()
  const byId = new Map(recs.map((r) => [r.id, r]))
  const now = Date.now()
  return ids.map((id) => {
    const r = byId.get(id)
    if (!r) return { id, mark: 'unchecked' as const }
    if (r.status === 'done') {
      const age = r.finishedAt ? Math.max(0, Math.round((now - Date.parse(r.finishedAt)) / 1000)) : null
      return { id, mark: 'proven' as const, completedAgeSeconds: age }
    }
    if (r.status === 'failed') return { id, mark: 'failed' as const, error: r.result?.slice(0, 200) }
    return { id, mark: 'unchecked' as const }
  })
}

/**
 * Baris verifikasi untuk id remote. Klaim agent TIDAK diverifikasi independen
 * oleh office (jujur: 'unchecked'); yang gagal eksekusi ditandai 'failed'.
 */
export async function remoteVerificationRows(
  ids: string[],
): Promise<{ id: string; mark: 'failed' | 'unchecked'; error?: string }[]> {
  const recs = await listRemoteTasks()
  const byId = new Map(recs.map((r) => [r.id, r]))
  return ids.map((id) => {
    const r = byId.get(id)
    if (!r) return { id, mark: 'unchecked' as const }
    if (r.status === 'failed') return { id, mark: 'failed' as const, error: r.result?.slice(0, 200) }
    return { id, mark: 'unchecked' as const }
  })
}
