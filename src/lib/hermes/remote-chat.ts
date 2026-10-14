import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChatMessage, ChatSession } from './chat'

/**
 * Thread store untuk chat dengan agent remote.
 *
 * Percakapan Hermes memakai session store Hermes (state.db) per profil —
 * agent remote tidak punya profil, jadi thread mereka disimpan di sini:
 * satu file JSON di DATA_DIR office (persisten di volume ./data, jadi
 * tidak hilang saat container restart). Bentuk session-nya disamakan
 * dengan ChatSession supaya panel Chat tidak perlu cabang khusus.
 *
 * Satu thread per kunci agent remote ("remote:<head>/<agent>").
 */

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')

function storePath(): string {
  return path.join(DATA_DIR, 'remote-chat-threads.json')
}

export type RemoteThread = {
  key: string
  headId: string
  agentSlug: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

function validThread(v: unknown): v is RemoteThread {
  if (!v || typeof v !== 'object') return false
  const t = v as Partial<RemoteThread>
  return (
    typeof t.key === 'string' &&
    typeof t.headId === 'string' &&
    typeof t.agentSlug === 'string' &&
    typeof t.title === 'string' &&
    Array.isArray(t.messages) &&
    typeof t.createdAt === 'string' &&
    typeof t.updatedAt === 'string'
  )
}

async function readThreads(): Promise<Record<string, RemoteThread>> {
  try {
    const raw = await readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => validThread(v)),
    ) as Record<string, RemoteThread>
  } catch {
    return {}
  }
}

async function writeThreads(threads: Record<string, RemoteThread>): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true })
  await writeFile(storePath(), JSON.stringify(threads, null, 2), 'utf8')
}

function toSession(t: RemoteThread): ChatSession {
  const lastAssistant = [...t.messages].reverse().find((m) => m.role === 'assistant')
  return {
    id: `remote-thread:${t.key}`,
    agent: t.key,
    profile: t.key,
    title: t.title,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messageCount: t.messages.length,
    preview: (lastAssistant?.content ?? '').slice(0, 120),
  }
}

/** Semua thread remote, aktivitas terbaru dulu — bentuknya ChatSession. */
export async function listRemoteChatSessions(): Promise<ChatSession[]> {
  const threads = await readThreads()
  return Object.values(threads)
    .map(toSession)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getRemoteChatThread(
  key: string,
): Promise<{ session: ChatSession; messages: ChatMessage[] } | null> {
  const t = (await readThreads())[key]
  if (!t) return null
  return { session: toSession(t), messages: t.messages }
}

export async function appendRemoteChatTurn(
  key: string,
  headId: string,
  agentSlug: string,
  userText: string,
  reply: string,
): Promise<ChatSession> {
  const threads = await readThreads()
  const now = new Date().toISOString()
  let t = threads[key]
  if (!t) {
    t = {
      key,
      headId,
      agentSlug,
      title: userText.slice(0, 48) || agentSlug,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
  }
  t.messages.push({ role: 'user', content: userText, ts: Date.now() })
  t.messages.push({ role: 'assistant', content: reply, ts: Date.now() })
  t.updatedAt = new Date().toISOString()
  threads[key] = t
  await writeThreads(threads)
  return toSession(t)
}

export async function resetRemoteChatThread(key: string): Promise<boolean> {
  const threads = await readThreads()
  if (!threads[key]) return false
  delete threads[key]
  await writeThreads(threads)
  return true
}

/**
 * Turn chat remote yang SEDANG berjalan di proses server ini — untuk
 * indikator "live" (?live=1) supaya avatar-nya ditarik ke mejanya
 * seperti agent Hermes yang sedang diajak bicara.
 */
const inFlight = new Map<string, number>()

export function remoteChatTurnStart(key: string): void {
  inFlight.set(key, (inFlight.get(key) ?? 0) + 1)
}

export function remoteChatTurnEnd(key: string): void {
  const n = (inFlight.get(key) ?? 1) - 1
  if (n <= 0) inFlight.delete(key)
  else inFlight.set(key, n)
}

export function remoteChatInFlight(): string[] {
  return [...inFlight.keys()].sort()
}
