'use client'

import { useEffect, useRef, useState } from 'react'
import FullPanel from './FullPanel'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import { fetchJson } from '@/lib/api'
import { DIVISION_LABEL, type AgentDivision, type AgentRole } from '@/types/hermes'
import { ROLE_LABEL } from '@/lib/hermes/soul'
import { buildPrompt, headKindOf, type AgentSpec } from '@/lib/agent-provisioning'

export type CreateTarget = 'local' | 'remote' | 'new'

type TargetSel = 'local' | 'new' | `head:${string}`

interface HeadRow {
  id: string
  name?: string
  live?: boolean
  agents?: string[]
}

const ROLE_OPTIONS = Object.entries(ROLE_LABEL) as [AgentRole, string][]
const DIVISION_OPTIONS = Object.entries(DIVISION_LABEL) as [AgentDivision, string][]

function slugify(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
}

function errMsg(res: { error?: unknown }): string {
  const e = res.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message?: unknown }).message ?? '')
  return 'gagal membuat agent'
}

/**
 * Dialog "Buat Agent" yang sadar arsitektur multi-server.
 *
 * Satu dialog untuk semua jalur pembuatan agent:
 *  - Target "Hermes lokal (KIKOY)" → profil dibuat BENAR-BENAR lewat
 *    POST /api/hermes/agents (kontrak sama persis seperti form lama
 *    AgentSpawnPanel: role, division, domains, description, soul, model,
 *    serveA2a default nyala, advertisedToolsets kosong).
 *  - Target head remote yang ada → menghasilkan PROMPT PROVISIONING siap
 *    tempel (isi terisi dari form) + tombol Salin/Unduh. Office tidak
 *    punya kanal admin ke server remote — agent lahir di server itu
 *    sendiri; langkah operator sesudah laporan dicantumkan di prompt
 *    DAN di catatan UI.
 *  - Target "Server baru" → prompt pairing lengkap (pola prompt v2 untuk
 *    VM Muse, pola prompt Hermes-host untuk host Hermes).
 */
export default function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  /** Dipanggil HANYA bila agent lokal benar-benar terbuat. */
  onCreated?: (name: string, target: CreateTarget) => void
}) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState<TargetSel>('local')
  const [serverKind, setServerKind] = useState<'muse' | 'hermes'>('muse')
  const [role, setRole] = useState<AgentRole>('backend')
  const [division, setDivision] = useState<AgentDivision>('tech')
  const [model, setModel] = useState('')
  const [domains, setDomains] = useState('')
  const [description, setDescription] = useState('')
  const [soul, setSoul] = useState('')
  const [serveA2a, setServeA2a] = useState(true)

  const [models, setModels] = useState<ModelChoice[]>([])
  const [heads, setHeads] = useState<HeadRow[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)
  const [operatorNote, setOperatorNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let alive = true
    fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
      if (alive && res.ok) setModels(res.data?.models || [])
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setDone(null)
    setPrompt(null)
    setOperatorNote(null)
    setErr(null)
    setCopied(false)
    let alive = true
    fetchJson<{ heads?: HeadRow[] } | HeadRow[]>('/api/hermes/remote-heads', { cache: 'no-store' }).then((res) => {
      if (!alive || !res.ok) return
      const d = res.data
      setHeads(Array.isArray(d) ? d : d?.heads || [])
    })
    return () => {
      alive = false
    }
  }, [open ])

  if (!open) return null

  const slug = slugify(name)
  const headId = target.startsWith('head:') ? target.slice(5) : null
  const headRow = headId ? heads.find((h) => h.id === headId) : null
  const headKind = headId ? headKindOf(headId) : null

  function spec(): AgentSpec {
    return { name: slug, role, division, model, domains, description, soul }
  }

  async function submitLocal() {
    if (!slug) {
      setErr('nama agent hanya huruf kecil, angka, - dan _')
      return
    }
    setBusy(true)
    setErr(null)
    setDone(null)
    try {
      const hit = models.find((m) => m.model === model)
      const res = await fetchJson<{
        name?: string
        soulPreview?: string
        model?: string | null
        modelError?: string | null
        domains?: string[]
        a2aRegistered?: boolean | null
        a2aError?: string | null
        a2aNote?: string | null
      }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: slug,
          description: description.trim(),
          role,
          division,
          soul: soul.trim(),
          domains: domains.trim(),
          advertisedToolsets: [],
          serveA2a,
          model: model || undefined,
          provider: model ? hit?.provider : undefined,
        }),
      })
      if (!res.ok || !res.data) {
        setErr(errMsg(res))
        return
      }
      // Laporkan model dari BALASAN server, bukan dari pilihan di form.
      const modelNote = res.data.model
        ? `model ${res.data.model}`
        : res.data.modelError
          ? `model GAGAL diset (${res.data.modelError}) — sementara pakai bawaan Hermes`
          : 'model bawaan Hermes'
      const domNote = res.data.domains?.length ? `keahlian: ${res.data.domains.join(', ')}. ` : ''
      const a2aNote =
        res.data.a2aRegistered === true
          ? `${res.data.a2aNote ?? 'Terdaftar A2A. Berlaku setelah gateway di-restart.'} `
          : res.data.a2aRegistered === false
            ? `GAGAL didaftarkan A2A (${res.data.a2aError ?? 'sebab tak terbaca'}) — profilnya ada tapi belum terdaftar. `
            : ''
      setDone(`profil "${res.data.name ?? slug}" dibuat, ${modelNote}. ${domNote}${a2aNote}Agent berjalan masuk lewat pintu utama.`)
      onCreated?.(slug, 'local')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function makePrompt() {
    if (!slug) {
      setErr('nama agent hanya huruf kecil, angka, - dan _')
      return
    }
    setErr(null)
    if (target === 'new') {
      setPrompt(buildPrompt(spec(), { kind: 'new-server', serverKind }))
      setOperatorNote(
        'Setelah mesin/agent baru itu melapor balik selesai, operator mendaftarkan head BARU di office ' +
          '(tambah entri registry di lib/hermes/remote-heads.ts + deploy ulang), lalu menembak tes penerimaan remote-call.',
      )
      return
    }
    if (headId) {
      setPrompt(
        buildPrompt(spec(), {
          kind: 'remote-head',
          headId,
          headName: headRow?.name ?? headId,
          headLive: headRow?.live !== false,
        }),
      )
      setOperatorNote(
        `Setelah agent di "${headRow?.name ?? headId}" melapor balik selesai, operator menambahkan slug "${slug}" ` +
          `ke daftar agents head "${headId}" di lib/hermes/remote-heads.ts, deploy ulang office, lalu menembak tes penerimaan remote-call.`,
      )
    }
  }

  async function copyPrompt() {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      promptRef.current?.select()
      document.execCommand('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  function downloadPrompt() {
    if (!prompt) return
    const blob = new Blob([prompt], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `provision-${slug}${headId ? `-${headId}` : target === 'new' ? '-server-baru' : ''}.md`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <FullPanel onClose={onClose} label="Buat Agent" title="Buat Agent" bodyClassName="vp-pad flex flex-col gap-3">
      {err && <div className="vp-err">{err}</div>}
      {done && <div className="vp-ok">{done}</div>}

      <div className="vp-sub">NAMA AGENT (SLUG)</div>
      <input
        className="vp-input"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        placeholder="cth: riset-sdr"
      />
      <div className="vp-note">Huruf kecil, angka, - dan _. Dipakai sebagai nama profil / slug A2A.</div>

      <div className="vp-sub">TARGET — AGENT DIBUAT DI MANA</div>
      <select
        className="vp-input"
        value={target}
        onChange={(e) => {
          setTarget(e.target.value as TargetSel)
          setPrompt(null)
          setOperatorNote(null)
        }}
      >
        <option value="local">Hermes lokal (KIKOY) — buat langsung sekarang</option>
        {heads.map((h) => {
          const live = h.live !== false
          return (
            <option key={h.id} value={`head:${h.id}`} disabled={!live}>
              {h.name ?? h.id} — {live ? 'LIVE' : 'DOWN'}
            </option>
          )
        })}
        <option value="new">Server baru (belum terdaftar di fleet)</option>
      </select>
      {headId && (
        <div className="vp-note">
          Head jenis: {headKind === 'hermes' ? 'host Hermes' : 'VM Muse'} — prompt provisioning dibuat sesuai jenisnya.
          {headRow?.live === false && ' (head sedang DOWN — hidupkan dulu sebelum provisioning)'}
        </div>
      )}
      {target === 'new' && (
        <>
          <div className="vp-sub">JENIS SERVER BARU</div>
          <select className="vp-input" value={serverKind} onChange={(e) => setServerKind(e.target.value as 'muse' | 'hermes')}>
            <option value="muse">VM Muse — server A2A rakitan (pola pairing v2)</option>
            <option value="hermes">Host Hermes — sudah ada Hermes (pola head STB)</option>
          </select>
        </>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <div className="vp-sub">PERAN</div>
          <select className="vp-input" value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
            {ROLE_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <div className="vp-sub">DIVISI</div>
          <select className="vp-input" value={division} onChange={(e) => setDivision(e.target.value as AgentDivision)}>
            {DIVISION_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="vp-sub">MODEL</div>
      <ModelPicker
        value={model}
        onChange={setModel}
        models={models}
        disabled={busy}
        emptyLabel="bawaan Hermes"
        title="Model untuk agent ini (kosong = bawaan host)"
      />

      <div className="vp-sub">KEAHLIAN / DOMAIN (PISAH KOMA)</div>
      <input
        className="vp-input"
        value={domains}
        onChange={(e) => setDomains(e.target.value)}
        placeholder="cth: meta-ads, reporting, budget"
      />

      <div className="vp-sub">DESKRIPSI SINGKAT</div>
      <textarea
        className="vp-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Dibaca agent lain saat discovery — tulis kosakata domain yang akan dicari."
        rows={2}
      />

      <div className="vp-sub">PERSONA / SOUL</div>
      <textarea
        className="vp-input"
        value={soul}
        onChange={(e) => setSoul(e.target.value)}
        placeholder="cth: Budi adalah CEO visioner — ambil keputusan akhir, bagi tugas ke tiap divisi. Gaya: tegas, ringkas."
        rows={4}
      />

      {target === 'local' ? (
        <>
          <label className="flex items-center gap-2" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={serveA2a} disabled={busy} onChange={(e) => setServeA2a(e.target.checked)} />
            <span title="Daftarkan profil ini di platforms.a2a.agents. Berlaku setelah gateway di-restart.">
              Bisa dihubungi agent lain (A2A) — otomatis terdaftar A2A; berlaku setelah gateway di-restart
            </span>
          </label>
          <button className="vp-btn" disabled={busy || !slug} onClick={submitLocal}>
            {busy ? 'Membuat…' : 'Buat di Hermes lokal'}
          </button>
          {done && (
            <button className="vp-btn" onClick={onClose}>
              Selesai
            </button>
          )}
        </>
      ) : (
        <>
          <button className="vp-btn" disabled={busy || !slug} onClick={makePrompt}>
            Buat prompt provisioning
          </button>
          {prompt && (
            <>
              <div className="vp-note">
                Tempel prompt ini ke {headId ? `sesi di "${headRow?.name ?? headId}"` : 'mesin baru itu'}. Office tidak punya
                kanal admin ke server remote — agent lahir di server itu sendiri.
              </div>
              <textarea
                ref={promptRef}
                className="vp-input"
                value={prompt}
                readOnly
                rows={14}
                style={{ fontFamily: 'monospace', fontSize: 11 }}
              />
              <div className="flex gap-2">
                <button className="vp-btn" onClick={copyPrompt}>
                  {copied ? '✓ Tersalin' : 'Salin prompt'}
                </button>
                <button className="vp-btn" onClick={downloadPrompt}>
                  Unduh .md
                </button>
              </div>
              {operatorNote && <div className="vp-note">{operatorNote}</div>}
            </>
          )}
        </>
      )}
    </FullPanel>
  )
}
