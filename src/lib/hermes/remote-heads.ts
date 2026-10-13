/**
 * Remote heads — Hermes di server lain yang dipanggil via A2A tunnel.
 *
 * Konsep: Windows = pusat workspace + otot (file/tools/eksekusi).
 * Head (mis. STB) = otak (skills, personality, memory, subagent).
 * Office memanggil head via hook ini; hasil balik, eksekusi di Windows.
 */

export interface RemoteHead {
  /** id unik, mis. 'stb' */
  id: string
  /** nama tampilan */
  name: string
  /** base URL A2A (biasanya via SSH tunnel lokal) */
  baseUrl: string
  /** daftar slug agent di head itu */
  agents: string[]
}

/**
 * Daftar head. Tambah head baru di sini (atau via env REMOTE_HEADS_JSON).
 * Format env: [{"id":"stb","name":"STB","baseUrl":"http://127.0.0.1:9901","agents":["tester","skyla"]}]
 */
export function listRemoteHeads(): RemoteHead[] {
  const fromEnv = process.env.REMOTE_HEADS_JSON
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv)
      if (Array.isArray(parsed)) return parsed as RemoteHead[]
    } catch { /* abaikan, pakai bawaan */ }
  }
  return [
    {
      id: 'stb',
      name: 'STB (infrasec)',
      baseUrl: process.env.STB_A2A_URL || 'http://127.0.0.1:9901',
      agents: ['tester', 'skyla', 'heker3', 'heker4'],
    },
    {
      // zahra-muse = VM asisten (Muse Spark). Bukan Hermes: server A2A
      // bridge di VM-nya punya 2 agent:
      // - 'muse': jalur penuh — tugas masuk antrean, agent betulan dengan
      //   tools/memory memprosesnya (latensi ±1-2 mnt, dukung gambar).
      // - 'muse-fast': jalur cepat — bridge langsung memanggil model via
      //   9Router (latensi ±15-25 dtk, vision OK, TANPA tools/data live).
      // Diteruskan via reverse tunnel STB (100.105.150.118:18789 -> VM:8789).
      // Lampiran gambar: kirim field "images" di body remote-call.
      id: 'zahra-muse',
      name: 'Zahra-Muse (VM asisten)',
      baseUrl: process.env.MUSE_A2A_URL || 'http://100.105.150.118:18789',
      agents: ['muse', 'muse-fast'],
    },
  ]
}

export function getRemoteHead(id: string): RemoteHead | null {
  return listRemoteHeads().find((h) => h.id === id) ?? null
}
