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
    {
      // cue-1 = komputer cloud Manus (BUKAN Hermes). Bridge A2A sendiri
      // di mesinnya (systemd cue-bridge, bind tailnet via userspace
      // tailscale) dengan 2 agent:
      // - 'cue': jalur penuh — worker agent lokal dengan tool bash
      //   (bisa menjalankan 159 skills di ~/skills). Latensi ±30-240 dtk.
      // - 'cue-fast': jalur cepat — model langsung via 9Router (persona
      //   memuat daftar skills), tanpa eksekusi. Latensi ±10-25 dtk.
      // Otak bridge memakai 9Router lewat relay SSH dari STB
      // (di cue: 127.0.0.1:20129) karena koneksi tailnet keluar dari
      // cue tidak bisa dipakai untuk data.
      id: 'cue-1',
      name: 'Cue-1 (Manus cloud, 159 skills)',
      baseUrl: process.env.CUE1_A2A_URL || 'http://100.74.205.52:8340',
      agents: ['cue', 'cue-fast'],
    },
    {
      // cue-2 = komputer cloud Manus (BUKAN Hermes). Bridge A2A yang
      // sama seperti cue-1 (systemd cue-bridge di mesinnya), 2 agent:
      // 'cue' (worker bash, 149 skills unik) dan 'cue-fast' (model
      // langsung). Otak via relay SSH STB (127.0.0.1:20129 di cue-2).
      id: 'cue-2',
      name: 'Cue-2 (Manus cloud, 149 skills)',
      baseUrl: process.env.CUE2_A2A_URL || 'http://100.120.70.96:8340',
      agents: ['cue', 'cue-fast'],
    },
    {
      // cue-4 = komputer cloud Manus (BUKAN Hermes). Bridge A2A yang
      // sama seperti cue-1 (systemd cue-bridge di mesinnya), 2 agent:
      // 'cue' (worker bash, 62 skills unik) dan 'cue-fast' (model
      // langsung). Otak via relay SSH STB (127.0.0.1:20129 di cue-4).
      id: 'cue-4',
      name: 'Cue-4 (Manus cloud, 62 skills)',
      baseUrl: process.env.CUE4_A2A_URL || 'http://100.113.25.17:8340',
      agents: ['cue', 'cue-fast'],
    },
    {
      // infrastruktur-it-2 = "muse-ade", Muse VM outbound-only —
      // agent pertama yang mendaftar self-service lewat fleet.sh di STB.
      // Server A2A antrean di VM-nya (127.0.0.1:8789) diteruskan via
      // reverse tunnel STB (100.105.150.118:18790 -> VM:8789). Port SSH
      // VM-nya juga diteruskan (STB 10023 -> VM:22) untuk operator.
      id: 'infrastruktur-it-2',
      name: 'Infrastruktur IT 2 (muse-ade)',
      baseUrl: process.env.INFRA2_A2A_URL || 'http://100.105.150.118:18790',
      agents: ['infrastruktur-it-2'],
    },
    {
      // muse-kikoy = Muse VM outbound-only (peran Business Management).
      // Pairing memakai prompt pairing v2; terdaftar self-service lewat
      // fleet web STB (port A2A 18792, port SSH 10025). Server A2A di
      // VM-nya diteruskan via reverse tunnel STB
      // (100.105.150.118:18792 -> VM). Otak: koneksi 9Router
      // muse-muse-kikoy di node musebridge + API key klien sendiri.
      // Balasan A2A format Task dan sinkron - lolos tes langsung dari STB.
      id: 'muse-kikoy',
      name: 'Muse Kikoy (Business Management)',
      baseUrl: process.env.MUSEKIKOY_A2A_URL || 'http://100.105.150.118:18792',
      agents: ['muse-kikoy'],
    },
    {
      // nabil = Muse VM outbound-only (server muse-nabil, peran
      // Assistent). Pairing self-service lewat fleet web STB (port A2A
      // 18793, port SSH 10026). Server A2A di VM-nya diteruskan via
      // reverse tunnel STB (100.105.150.118:18793 -> VM). Balasan A2A
      // format Task dan sinkron - lolos tes langsung dari STB.
      id: 'nabil',
      name: 'Nabil (muse-nabil)',
      baseUrl: process.env.NABIL_A2A_URL || 'http://100.105.150.118:18793',
      agents: ['nabil'],
    },
  ]
}

export function getRemoteHead(id: string): RemoteHead | null {
  return listRemoteHeads().find((h) => h.id === id) ?? null
}
