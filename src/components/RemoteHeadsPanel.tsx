'use client'

import { useCallback, useEffect, useState } from 'react'
import FullPanel from './FullPanel'

/**
 * Panel "REMOTE HEADS" - head A2A di luar profil Hermes (VM Muse,
 * komputer cue) yang terdaftar di registry remote-heads dan dipanggil
 * lewat remote-call / remote-fanout / ruang rapat.
 *
 * Sengaja terpisah dari daftar Agent (profil Hermes): remote head tidak
 * punya profil dan tidak bisa di-spawn/kill/ganti model dari office.
 * Panel ini hanya menampilkan keberadaan + status health endpoint
 * A2A-nya (GET <baseUrl>/), diperiksa ulang otomatis tiap 30 detik.
 */

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

export default function RemoteHeadsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [heads, setHeads] = useState<HeadStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/hermes/remote-heads', { cache: 'no-store' })
      const j = (await r.json()) as { heads?: HeadStatus[] }
      if (Array.isArray(j.heads)) {
        setHeads(j.heads)
        setError(null)
      } else {
        setError('respons tidak dikenal')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load()
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
  }, [open, load])

  if (!open) return null

  const liveCount = heads?.filter((h) => h.live).length ?? 0

  return (
    <FullPanel
      onClose={onClose}
      label="Remote Heads"
      title="Remote Heads"
      actions={
        <button className="vp-btn vp-btn-ghost" onClick={() => void load()} disabled={loading}>
          {loading ? 'Memeriksa…' : 'Periksa ulang'}
        </button>
      }
    >
      <p className="vp-muted">
        Head A2A di luar profil Hermes — dipanggil lewat remote-call, remote-fanout, dan ruang rapat.
        Status dari health endpoint tiap head (GET baseUrl/), diperiksa otomatis tiap 30 detik.
      </p>
      {error && <p style={{ color: '#e0655f' }}>Gagal memuat: {error}</p>}
      {!heads && !error && <p className="vp-muted">Memuat…</p>}
      {heads && (
        <p>
          <b>{liveCount}</b> dari <b>{heads.length}</b> head LIVE
        </p>
      )}
      <div>
        {heads?.map((h) => (
          <div
            key={h.id}
            className="flex items-start gap-3"
            style={{ padding: '10px 0', borderTop: '1px solid rgba(127,127,127,.25)' }}
          >
            <span className={`vp-dot ${h.live ? 'ok' : 'bad'}`} style={{ marginTop: 6 }} />
            <div style={{ flex: 1 }}>
              <div className="flex items-center gap-2">
                <b>{h.name}</b>
                <span className="vp-muted">{h.id}</span>
              </div>
              <div className="vp-muted" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {h.baseUrl}
              </div>
              <div className="vp-muted" style={{ fontSize: 12 }}>
                agent: {h.agents.join(', ')} ·{' '}
                {h.live ? `LIVE · ${h.latencyMs} ms` : `DOWN${h.httpStatus ? ` · HTTP ${h.httpStatus}` : ''}`}
                {h.detail ? ` · ${h.detail}` : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </FullPanel>
  )
}
