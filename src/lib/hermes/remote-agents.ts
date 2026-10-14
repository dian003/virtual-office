import { getRemoteHead, listRemoteHeads, type RemoteHead } from './remote-heads'

/**
 * Kunci kanonik agent remote: "remote:<headId>/<agentSlug>".
 *
 * Prefix "remote:" adalah pembeda yang disengaja: tidak ada profil Hermes
 * yang bisa memakai nama ini (form buat-agent menolak ":" dan "/"),
 * sehingga setiap jalur yang khusus-profil bisa menolak kunci remote hanya
 * dengan memeriksa prefix — tanpa daftar pengecualian.
 *
 * Contoh: "remote:zahra-muse/muse-fast", "remote:cue-1/cue".
 */
export const REMOTE_PREFIX = 'remote:'

export function isRemoteAgentKey(name: string): boolean {
  return name.startsWith(REMOTE_PREFIX)
}

export function remoteKey(headId: string, agentSlug: string): string {
  return `${REMOTE_PREFIX}${headId}/${agentSlug}`
}

export function parseRemoteKey(name: string): { headId: string; agentSlug: string } | null {
  if (!isRemoteAgentKey(name)) return null
  const rest = name.slice(REMOTE_PREFIX.length)
  const i = rest.indexOf('/')
  if (i <= 0 || i === rest.length - 1) return null
  return { headId: rest.slice(0, i), agentSlug: rest.slice(i + 1) }
}

export type RemoteAgentInfo = {
  key: string
  headId: string
  headName: string
  agentSlug: string
  displayName: string
  baseUrl: string
}

/** "Cue-1 (Manus cloud, 159 skills)" -> "Cue-1" untuk label ringkas. */
function shortHeadName(head: RemoteHead): string {
  return head.name.split(' (')[0]
}

/** "muse-fast · Zahra-Muse" — label tampil untuk UI. */
export function remoteDisplayName(head: RemoteHead, agentSlug: string): string {
  return `${agentSlug} · ${shortHeadName(head)}`
}

export function listRemoteAgents(): RemoteAgentInfo[] {
  return listRemoteHeads().flatMap((head) =>
    head.agents.map((agentSlug) => ({
      key: remoteKey(head.id, agentSlug),
      headId: head.id,
      headName: head.name,
      agentSlug,
      displayName: remoteDisplayName(head, agentSlug),
      baseUrl: head.baseUrl,
    })),
  )
}

/** Validasi penuh: prefix benar + head ada + slug terdaftar di head itu. */
export function resolveRemoteAgent(
  name: string,
): (RemoteAgentInfo & { head: RemoteHead }) | null {
  const parsed = parseRemoteKey(name)
  if (!parsed) return null
  const head = getRemoteHead(parsed.headId)
  if (!head || !head.agents.includes(parsed.agentSlug)) return null
  return {
    key: remoteKey(head.id, parsed.agentSlug),
    headId: head.id,
    headName: head.name,
    agentSlug: parsed.agentSlug,
    displayName: remoteDisplayName(head, parsed.agentSlug),
    baseUrl: head.baseUrl,
    head,
  }
}
