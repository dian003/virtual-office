/**
 * Lapisan translator presiden<->head (DeepL via profil Hermes `translator`).
 *
 * Keputusan operator 2026-10-19: translator TIDAK memakai LLM bebas sebagai
 * mesin utama — profil `translator` di KIKOY menerjemahkan lewat tool DeepL
 * (satu-satunya tool-nya). Profil membalas JSON {text, engine, billed}:
 *   engine "deepl"        -> hasil DeepL murni
 *   engine "llm-fallback" -> DeepL gagal, profil menerjemahkan sendiri
 * Bila profil tidak terjangkau / balasannya tidak bisa diurai, fungsi di sini
 * mengembalikan teks ASLI apa adanya (engine "passthrough") — task TIDAK
 * boleh gagal hanya karena translator gagal.
 *
 * Aktif hanya bila env TRANSLATOR_ENABLED=1. Semua panggilan DISERIALKAN
 * (satu sesi profil, direset tiap panggilan agar stateless) dan dicatat satu
 * baris JSONL per panggilan ke <DATA_DIR>/translator-log.jsonl:
 *   {ts, task_id, dir, billed_characters, translator_engine, chars}
 */
import { appendFile, mkdir } from 'fs/promises'
import path from 'path'
import { resetChatSession, sendChatMessage } from './chat'

export type TranslateDir = 'id2en' | 'en2id'

export interface TranslationOutcome {
  text: string
  engine: 'deepl' | 'llm-fallback' | 'passthrough'
  billed: number
}

const PROFILE = process.env.TRANSLATOR_PROFILE || 'translator'
const AGENT_KEY = 'translator'
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const LOG_FILE = path.join(DATA_DIR, 'translator-log.jsonl')

export function translatorEnabled(): boolean {
  return process.env.TRANSLATOR_ENABLED === '1'
}

/* Serialisasi: profil punya satu sesi chat; panggilan paralel akan saling
 * menimpa konteks, jadi antrekan. Lalu lintas tugas memang bervolume kecil. */
let chain: Promise<unknown> = Promise.resolve()
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function logLine(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    /* log gagal tidak boleh menggagalkan tugas */
  }
}

function parseProfileReply(reply: string): { text: string; engine: string; billed: number } | null {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
    if (typeof obj.text !== 'string' || typeof obj.engine !== 'string') return null
    return {
      text: obj.text,
      engine: obj.engine,
      billed: typeof obj.billed === 'number' ? obj.billed : 0,
    }
  } catch {
    return null
  }
}

/**
 * Terjemahkan satu teks lewat profil translator. Tidak pernah throw:
 * kegagalan apa pun -> teks asli + engine "passthrough".
 */
export async function translateViaProfile(
  text: string,
  dir: TranslateDir,
  taskId: string,
): Promise<TranslationOutcome> {
  const base: TranslationOutcome = { text, engine: 'passthrough', billed: 0 }
  if (!translatorEnabled() || !text || text.trim().length < 2) return base
  return withLock(async () => {
    try {
      await resetChatSession(AGENT_KEY)
      const payload = JSON.stringify({ task_id: taskId, dir, text })
      const { reply } = await sendChatMessage(AGENT_KEY, PROFILE, payload)
      const parsed = parseProfileReply(reply)
      if (!parsed) {
        await logLine({
          ts: new Date().toISOString(), task_id: taskId, dir,
          billed_characters: 0, translator_engine: 'passthrough',
          chars: text.length, note: 'balasan profil tidak terurai',
        })
        return base
      }
      const engine = parsed.engine === 'deepl' ? 'deepl' : 'llm-fallback'
      await logLine({
        ts: new Date().toISOString(), task_id: taskId, dir,
        billed_characters: parsed.billed, translator_engine: engine,
        chars: text.length,
      })
      return { text: parsed.text, engine, billed: parsed.billed }
    } catch (err) {
      await logLine({
        ts: new Date().toISOString(), task_id: taskId, dir,
        billed_characters: 0, translator_engine: 'passthrough',
        chars: text.length, note: (err as Error).message.slice(0, 200),
      })
      return base
    }
  })
}

/** Presiden (ID) -> head: instruksi diterjemahkan ke EN. */
export function translateOutbound(text: string, taskId: string): Promise<TranslationOutcome> {
  return translateViaProfile(text, 'id2en', taskId)
}

/** Head (EN) -> presiden: laporan diterjemahkan ke ID. */
export function translateInbound(text: string, taskId: string): Promise<TranslationOutcome> {
  return translateViaProfile(text, 'en2id', taskId)
}
