/**
 * Saldo DeepL untuk panel Sistem: usage SEMUA key di pool translator,
 * ditotal. Key dibaca dari file key profil translator (satu-satunya
 * tempat key disimpan) — file itu tidak pernah disalin ke mana pun;
 * di sini hanya dibaca untuk memanggil GET /v2/usage per key.
 * Hasil di-cache 60 detik agar panel yang mem-poll tidak menghabiskan
 * kuota request.
 */
import { readFile } from 'fs/promises'
import path from 'path'
import { hermesHome } from './kanban'

export interface DeeplKeyUsage {
  index: number
  character_count: number
  character_limit: number
  ratio: number
  status: string
}

export interface DeeplUsageReport {
  keys: DeeplKeyUsage[]
  total: {
    character_count: number
    character_limit: number
    remaining: number
    ratio: number
  }
  at: string
}

const KEY_FILE = () =>
  path.join(hermesHome(), 'profiles', 'translator', 'tools', 'deepl', 'deepl.key')

const CACHE_MS = 60_000
let cache: { at: number; report: DeeplUsageReport } | null = null

async function loadKeys(): Promise<string[]> {
  try {
    const raw = await readFile(KEY_FILE(), 'utf8')
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
  } catch {
    return []
  }
}

async function usageForKey(key: string, index: number): Promise<DeeplKeyUsage> {
  const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'
  try {
    const res = await fetch(`${base}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return {
        index, character_count: 0, character_limit: 0, ratio: 0,
        status: res.status === 401 || res.status === 403 ? 'auth' : `http-${res.status}`,
      }
    }
    const data = (await res.json()) as { character_count?: number; character_limit?: number }
    const count = data.character_count ?? 0
    const limit = data.character_limit ?? 0
    return {
      index,
      character_count: count,
      character_limit: limit,
      ratio: limit > 0 ? count / limit : 0,
      status: 'ok',
    }
  } catch {
    return { index, character_count: 0, character_limit: 0, ratio: 0, status: 'unreachable' }
  }
}

export async function getDeeplUsage(): Promise<DeeplUsageReport> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.report
  const keys = await loadKeys()
  const perKey = await Promise.all(keys.map((k, i) => usageForKey(k, i)))
  const totalCount = perKey.reduce((a, k) => a + k.character_count, 0)
  const totalLimit = perKey.reduce((a, k) => a + k.character_limit, 0)
  const report: DeeplUsageReport = {
    keys: perKey,
    total: {
      character_count: totalCount,
      character_limit: totalLimit,
      remaining: Math.max(0, totalLimit - totalCount),
      ratio: totalLimit > 0 ? totalCount / totalLimit : 0,
    },
    at: new Date().toISOString(),
  }
  cache = { at: Date.now(), report }
  return report
}
