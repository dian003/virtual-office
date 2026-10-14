'use client'

import { useEffect, useState } from 'react'
import { fetchJson } from '@/lib/api'
import ModelPicker, { type ModelChoice } from './ModelPicker'
import type { AgentDivision, AgentRole } from '@/types/hermes'
import { DIVISION_LABEL } from '@/types/hermes'
import { ROLE_LABEL } from '@/lib/hermes/soul'
import FullPanel from './FullPanel'
import CreateAgentDialog from './CreateAgentDialog'

/**
 * Spawn / hide / kill control.
 *
 * "Sembunyikan" and "Spawn" toggle office MEMBERSHIP
 * (src/lib/hermes/office-membership.ts): the avatar leaves or enters, the profile
 * and its tasks are untouched. "Kill" is the destructive one — it deletes the
 * profile and purges its tasks — so it is only offered when a profile exists and
 * asks for a second click.
 */

type Row = {
  name: string
  total: number
  /** The profile exists on disk, not only as a task assignee. */
  profile: boolean
  /** Label tampil untuk agent remote (kunci "remote:<head>/<agent>"). */
  displayName?: string
  /** True untuk baris agent remote — tidak ada aksi profil yang berlaku. */
  remote?: boolean
  headName?: string
  live?: boolean
  inOffice: boolean
  reason: string | null
  /** The profile's default model, when it has one. */
  model?: string | null
  /** Role dari route agents GET; null/undefined bila backend lama. */
  role?: AgentRole | string | null
  /** Divisi dari route agents GET; null/undefined bila backend lama. */
  division?: AgentDivision | string | null
  /** True bila profil punya SOUL.md sendiri. */
  soulExists?: boolean | null
  /** Keahlian/domain (dipakai office, bukan A2A). */
  domains?: string[]
  /**
   * Status A2A jujur: 'served' = terdaftar di platforms.a2a.agents,
   * 'unlisted' = belum didaftarkan. Bukan "aktif" — berlaku pasca-restart.
   */
  a2a?: 'served' | 'unlisted' | null
}

/** Batas izin per role dari route agents GET (tabel tunggal di control.ts). */
type Permissions = Record<string, { allow: string[]; deny: string[]; anyTask: boolean }>

const DIVISION_OPTIONS = Object.entries(DIVISION_LABEL) as [AgentDivision, string][]

export default function AgentSpawnPanel({
  open,
  onClose,
  onChanged,
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [perms, setPerms] = useState<Permissions>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** Dialog "Buat Agent" — satu-satunya jalur pembuatan di panel ini. */
  const [createOpen, setCreateOpen] = useState(false)
  /**
   * Keahlian/domain: freetext koma ("meta-ads, reporting"). Disimpan di
   * marker SOUL.md (pemetaan office), TIDAK diumumkan ke A2A — skills di
   * agent card hanya bisa berisi toolset Hermes yang nyata.
   */
  /**
   * Toolset yang diumumkan di agent card. Kosong = semua toolset.
   * Hanya nama toolset nyata (dari /api/hermes/toolsets), bukan tag bebas.
   */
  /**
   * Toggle A2A: default NYALA (permintaan operator: spawn dari mana pun harus
   * langsung A2A). Hidup = daftarkan served-agent (local:false). Berlaku
   * setelah gateway di-restart — form tidak janji "langsung aktif".
   */
  /** Domain yang tidak punya pemilik: dinyatakan apa adanya, bukan diarang. */
  const [domainOwners, setDomainOwners] = useState<Record<string, string | null>>({})
  /** Model untuk profil yang SEDANG dibuat; '' = bawaan Hermes. Terpisah dari `pick`
   *  (ganti model profil yang sudah ada) supaya dua alur itu tidak saling menimpa. */
  const [divFilter, setDivFilter] = useState<'all' | AgentDivision>('all')
  const [note, setNote] = useState<string | null>(null)
  /** id awaiting the second click before a destructive delete. */
  const [confirmKill, setConfirmKill] = useState<string | null>(null)
  const [models, setModels] = useState<ModelChoice[]>([])
  /** name -> model being picked but not yet saved. */
  const [pick, setPick] = useState<Record<string, string>>({})
  /**
   * Keadaan "butuh restart" dari server (SATU sumber kebenaran — pembanding
   * yang sama dipakai doctor). null = tak bisa dipastikan (tampil abu).
   */
  const [needsGatewayRestart, setNeedsGatewayRestart] = useState<boolean | null>(null)
  /** Pop up "silahkan restart server" — tampil setelah pendaftaran A2A sukses. */

  // A click anywhere else cancels a pending delete.
  useEffect(() => {
    if (!confirmKill) return
    const cancel = () => setConfirmKill(null)
    window.addEventListener('click', cancel)
    return () => window.removeEventListener('click', cancel)
  }, [confirmKill])

  async function load() {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetchJson<{ available?: Row[]; permissions?: Permissions; domainOwners?: Record<string, string | null>; needsGatewayRestart?: boolean | null }>('/api/hermes/agents', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(res.error || 'gagal memuat daftar agent')
      setRows(res.data?.available || [])
      setPerms(res.data?.permissions || {})
      setDomainOwners(res.data?.domainOwners || {})
      setNeedsGatewayRestart(res.data?.needsGatewayRestart ?? null)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  // Katalog toolset + model: config, bukan roster — fetch sekali per buka.
  useEffect(() => {
    if (!open) return
    if (!models.length) {
      let alive = true
      fetchJson<{ models?: ModelChoice[] }>('/api/hermes/models', { cache: 'no-store' }).then((res) => {
        if (alive && res.ok) setModels(res.data?.models || [])
      })
      return () => {
        alive = false
      }
    }
  }, [open, models.length])

  async function setModel(name: string, model: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const hit = models.find((m) => m.model === model)
      const res = await fetchJson('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-model', name, model, provider: hit?.provider }),
      })
      if (!res.ok) throw new Error(res.error || 'gagal menyimpan model')
      setNote(`Model "${name}" diset ke ${model} — berlaku pada spawn/chat berikutnya.`)
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function act(action: 'spawn' | 'hide' | 'kill' | 'serve' | 'unserve', name: string) {
    setBusy(name)
    setErr(null)
    setNote(null)
    try {
      const res = await fetchJson<{
        purged?: number
        a2aNote?: string | null
        peerAdded?: boolean | null
        peerError?: string | null
        toolsetAdded?: boolean | null
        toolsetError?: string | null
        needsGatewayRestart?: boolean | null
      }>('/api/hermes/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      })
      if (!res.ok) throw new Error(res.error || 'aksi gagal')
      const d = res.data
      if (action === 'kill') {
        const n = Number(d?.purged ?? 0)
        setNote(
          n > 0
            ? `"${name}" dihapus permanen bersama ${n} tugasnya`
            : `"${name}" dihapus permanen`,
        )
      } else if (action === 'hide') {
        setNote(`"${name}" disembunyikan — tugasnya tetap di papan`)
      } else if (action === 'serve') {
        // SELFREPAIR-1 Celah 1: jujur — terdaftar, tapi BERLAKU SETELAH
        // restart gateway (bukan langsung "siap"). A2A-CALL-1: pratinjau +
        // laporan kemampuan MEMANGGIL (peer + toolset, idempoten).
        const callBits: string[] = []
        if (d?.toolsetAdded === true) callBits.push('toolset a2a ditambahkan (bisa memanggil)')
        else if (d?.toolsetAdded === false && d?.toolsetError) callBits.push(`toolset a2a GAGAL (${d.toolsetError})`)
        else callBits.push('toolset a2a sudah ada (bisa memanggil)')
        if (d?.peerAdded === true) callBits.push(`peer ${name}-local didaftarkan`)
        else if (d?.peerAdded === false && d?.peerError) callBits.push(`peer GAGAL (${d.peerError})`)
        else callBits.push(`peer ${name}-local sudah ada`)
        setNote(`"${name}" ${d?.a2aNote ?? 'terdaftar. Berlaku setelah gateway di-restart.'} ${callBits.join(' · ')}.`)
        if (d?.needsGatewayRestart != null) setNeedsGatewayRestart(d.needsGatewayRestart)
      } else if (action === 'unserve') {
        setNote(`"${name}" ${d?.a2aNote ?? 'tercabut dari config.'}`)
      }
      await load()
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }


  if (!open) return null

  const matchDiv = (r: Row) => divFilter === 'all' || r.division === divFilter
  const inOffice = rows.filter((r) => r.inOffice && matchDiv(r))
  const out = rows.filter((r) => !r.inOffice && matchDiv(r))

  /** Badge role + divisi + indikator soul + status A2A. Aman bila field null (backend lama). */
  function badges(r: Row) {
    // Agent remote bukan profil Hermes: tidak ada checklist A2A gateway di
    // sini — yang ditampilkan identitas head-nya dan status health-nya.
    if (r.remote) {
      return (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
          <span className="vp-chip" title={`head A2A: ${r.headName ?? ''}`}>
            Remote · {r.headName ?? 'head'}
          </span>
          {r.live ? (
            <span className="vp-chip" title="health endpoint head menjawab">
              LIVE
            </span>
          ) : (
            <span className="vp-tag-warn" title="head tidak terjangkau — chat tidak akan dijawab">
              DOWN
            </span>
          )}
        </span>
      )
    }
    const roleLabel = r.role ? (ROLE_LABEL as Record<string, string>)[r.role] ?? r.role : null
    const divLabel = r.division ? (DIVISION_LABEL as Record<string, string>)[r.division] ?? null : null
    return (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
        {roleLabel && (
          <span className="vp-chip" title={`role: ${r.role}`}>
            {roleLabel}
          </span>
        )}
        {divLabel && (
          <span className="vp-chip" title={`divisi: ${r.division}`}>
            {divLabel}
          </span>
        )}
        {(r.domains?.length ?? 0) > 0 && (
          <span className="vp-chip" title={`keahlian (pemetaan office, bukan A2A): ${(r.domains ?? []).join(', ')}`}>
            {(r.domains ?? []).join(', ')}
          </span>
        )}
        {r.soulExists === true && (
          <span className="vp-chip" title="Profil ini punya SOUL.md sendiri">
            soul ✓
          </span>
        )}
        {r.soulExists === false && <span className="vp-tag-warn">tanpa soul</span>}
        {a2aBadge(r)}
      </span>
    )
  }

  /**
   * Checklist "A2A Ready" per agent — tiga nilai jujur, SATU sumber kebenaran
   * (entri served + needsGatewayRestart dari server, pembanding yang sama
   * dipakai doctor):
   * - ✅ A2A Ready: terdaftar DAN gateway sudah restart sesudahnya.
   * - 🟡 Terdaftar, belum aktif: ada entri tapi config lebih baru dari start.
   * - ❌ Belum terdaftar: tidak ada entri served.
   * needsGatewayRestart null = tak bisa dipastikan → abu, bukan hijau.
   */
  function a2aBadge(r: Row) {
    if (r.a2a !== 'served') {
      // SELFREPAIR-1 Celah 1: agent `unlisted` (profil ada, belum didaftarkan)
      // bisa didaftarkan dari UI — aksi `serve` + kalimat jujur (berlaku
      // setelah restart). Profil tak ada (null) = tak ada tombol.
      if (r.a2a === 'unlisted' && r.profile) {
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className="vp-tag-warn" title="Tidak ada entri di platforms.a2a.agents">
              ❌ Belum terdaftar A2A
            </span>
            <button
              className="vp-chip-btn"
              disabled={busy === r.name}
              onClick={(e) => {
                e.stopPropagation()
                void act('serve', r.name)
              }}
              title="Daftarkan profil ini di platforms.a2a.agents (local:false). Berlaku setelah gateway di-restart."
            >
              {busy === r.name ? '…' : 'daftarkan ke A2A'}
            </button>
          </span>
        )
      }
      return (
        <span className="vp-tag-warn" title="Tidak ada entri di platforms.a2a.agents — nyalakan A2A untuk agent ini">
          ❌ Belum terdaftar A2A — nyalakan A2A untuk agent ini
        </span>
      )
    }
    if (needsGatewayRestart === true) {
      return (
        <span className="vp-tag-warn" title="Ada di platforms.a2a.agents, tapi config.yaml lebih baru dari start gateway — daftar baru berlaku setelah restart">
          🟡 Terdaftar, belum aktif — butuh restart gateway
        </span>
      )
    }
    if (needsGatewayRestart === false) {
      return (
        <span className="vp-chip" title="Terdaftar DAN gateway sudah restart sesudahnya — benar-benar bisa dipanggil">
          ✅ A2A siap — agent ini bisa dipanggil sekarang
        </span>
      )
    }
    return (
      <span className="vp-tag-warn" title="Terdaftar, tapi waktu start gateway tak terbaca — tidak bisa dipastikan sudah aktif">
        A2A terdaftar (tak pasti aktif — start gateway tak terbaca)
      </span>
    )
  }

  /** Satu baris batas izin untuk role agent ini. Kosong bila role/tabel tidak ada. */
  function limits(r: Row) {
    const p = r.role ? perms[r.role] : undefined
    if (!p) return null
    const allow = p.allow.length
      ? p.allow.join(', ') + (p.anyTask ? '' : ' (task sendiri)')
      : '—'
    return (
      <span className="vp-muted" style={{ fontSize: 11 }} title="Batas izin bila aksi diminta atas nama agent ini">
        boleh: {allow} · tidak boleh: {p.deny.length ? p.deny.join(', ') : '—'}
      </span>
    )
  }

  return (
    <FullPanel onClose={onClose} label="Agent" title="Agent" bodyClassName="vp-pad flex flex-col gap-3">
      <div className="vp-kv">
        <span>di kantor</span>
        <b>{inOffice.length}</b>
      </div>
      <div className="vp-kv">
        <span>profil tersedia</span>
        <b>{rows.length}</b>
      </div>
      {needsGatewayRestart === true && (
        <div className="vp-err">
          🟡 Config lebih baru dari start gateway — entri served tersimpan tapi BELUM aktif. Restart gateway untuk
          mengaktifkannya.
        </div>
      )}

      {err && <div className="vp-err">{err}</div>}
      {note && <div className="vp-ok">{note}</div>}
      {loading && <div className="vp-muted">memuat…</div>}

      <div className="vp-sub">BUAT AGENT</div>
      <div className="vp-note">
        Satu dialog untuk semua target: Hermes lokal dibuat langsung; head remote / server baru
        menghasilkan prompt provisioning siap tempel.
      </div>
      <button className="vp-btn" onClick={() => setCreateOpen(true)}>
        + Buat agent
      </button>
      <CreateAgentDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void load()
          onChanged()
        }}
      />

      <button className="vp-btn vp-btn-rosy" disabled={!!busy} onClick={load}>
        Segarkan
      </button>

      {/*
        Pemetaan domain→pemilik (dipakai office, bukan A2A). Domain tanpa
        pemilik = null → TAMPILKAN "tidak ada pemilik", jangan mengarang.
      */}
      {Object.keys(domainOwners).length > 0 && (
        <>
          <div className="vp-sub">SIAPA PEGANG APA (OFFICE, BUKAN A2A)</div>
          <div className="flex flex-col gap-1">
            {Object.entries(domainOwners).map(([d, owner]) => (
              <div key={d} className="vp-kv">
                <span>{d}</span>
                <b>{owner ?? 'tidak ada pemilik'}</b>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="vp-sub">FILTER DIVISI</div>
      <select
        className="vp-input"
        value={divFilter}
        onChange={(e) => setDivFilter(e.target.value as 'all' | AgentDivision)}
        title="Filter daftar agent per divisi"
      >
        <option value="all">Semua</option>
        {DIVISION_OPTIONS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>

      <div className="vp-sub">DI KANTOR ({inOffice.length})</div>
      <div className="flex flex-col gap-2">
        {inOffice.map((r) => (
          <div key={r.name} className="vp-agent-row">
            <div className="vp-agent-meta">
              <b>
                {r.displayName ?? r.name}
                {!r.profile && <span className="vp-tag-warn">tanpa profil</span>}
              </b>
              <i>{r.total} tugas</i>
              {badges(r)}
              {limits(r)}
            </div>
            {/* The profile's default model: what its workers and chats run.
                Saving here writes `model.default` for that profile, so it
                applies to every future spawn — not just one task. */}
            {r.profile && (
              <div className="vp-agent-model">
                <ModelPicker
                  value={pick[r.name] ?? r.model ?? ''}
                  onChange={(model) => setPick((p) => ({ ...p, [r.name]: model }))}
                  models={models}
                  disabled={busy === r.name}
                  emptyLabel="bawaan Hermes"
                  title="Model bawaan profil ini"
                />
                <button
                  className="vp-btn"
                  disabled={busy === r.name || (pick[r.name] ?? r.model ?? '') === (r.model ?? '')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void setModel(r.name, pick[r.name] ?? '')
                  }}
                >
                  {busy === r.name ? '…' : 'Set'}
                </button>
              </div>
            )}
            {/* Two different things, so two different buttons, and now two
                different actions. A name with no profile on disk is an assignee
                left behind by a task whose profile was deleted — there is
                nothing to delete, and hiding it is the ONLY safe operation:
                sending it to `kill` purged its tasks permanently while the
                button said "tanpa menghapus apa pun". */}
            <div className="flex gap-2">
              {/* Agent remote tidak punya konsep hide/show profil — barisnya
                  selalu tampil selama head-nya terdaftar di registry. */}
              {!r.remote && (
                <button
                  className="vp-btn"
                  disabled={busy === r.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    void act('hide', r.name)
                  }}
                  title="Keluarkan nama ini dari kantor tanpa menghapus apa pun"
                >
                  {busy === r.name ? '…' : 'Sembunyikan'}
                </button>
              )}
              {r.profile && (
                <button
                  className={`vp-btn vp-btn-danger ${confirmKill === r.name ? 'vp-btn-armed' : ''}`}
                  disabled={busy === r.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmKill !== r.name) {
                      setConfirmKill(r.name)
                      return
                    }
                    void act('kill', r.name)
                  }}
                  title="Menghapus profil ini permanen, termasuk sesi dan kuncinya"
                >
                  {busy === r.name ? '…' : confirmKill === r.name ? 'Yakin hapus?' : 'Kill'}
                </button>
              )}
            </div>
          </div>
        ))}
        {confirmKill && (
          <div className="vp-cron-err">
            Menghapus <b>{confirmKill}</b> permanen — profil, sesi, memori, kunci,
            <b> dan {inOffice.find((x) => x.name === confirmKill)?.total ?? 0} tugasnya</b>.
            Klik di tempat lain untuk batal.
          </div>
        )}
        {!inOffice.length && <span className="vp-muted">kosong</span>}
      </div>

      {out.length > 0 && (
        <>
          <div className="vp-sub">DI LUAR ({out.length})</div>
          <div className="flex flex-col gap-2">
            {out.map((r) => (
              <div key={r.name} className="vp-agent-row off">
                <div className="vp-agent-meta">
                  <b>
                    {r.displayName ?? r.name}
                    {!r.profile && <span className="vp-tag-warn">tanpa profil</span>}
                  </b>
                  <i>
                    {r.reason === 'hidden'
                      ? 'disembunyikan'
                      : r.reason === 'no_profile'
                        ? 'tanpa profil di disk'
                        : 'tanpa tugas'}
                  </i>
                  {badges(r)}
                  {limits(r)}
                </div>
                <button
                  className="vp-btn"
                  disabled={busy === r.name}
                  onClick={() => act('spawn', r.name)}
                  title="Agent masuk lewat pintu utama dan berjalan ke mejanya"
                >
                  {busy === r.name ? '…' : 'Spawn'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </FullPanel>
  )
}
