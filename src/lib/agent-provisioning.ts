/**
 * Generator prompt provisioning agent — modul TS MURNI.
 *
 * Tidak mengimpor kode aplikasi apa pun, sehingga bisa dijalankan di
 * browser (dipakai dialog "Buat Agent") DAN di node untuk verifikasi
 * (`tsc` file ini lalu panggil `buildPrompt`).
 *
 * Tugas modul ini: mengubah spesifikasi agent dari form menjadi PROMPT
 * siap tempel untuk tiga skenario:
 *  1. `remote-head` dengan head jenis Hermes  — instruksi ke sesi Hermes
 *     di server itu untuk membuat profil baru yang ter-serve A2A.
 *  2. `remote-head` dengan head jenis VM Muse — instruksi ke VM itu untuk
 *     menjalankan SATU agent A2A tambahan yang patuh kontrak office.
 *  3. `new-server`                           — prompt pairing lengkap
 *     (pola prompt v2 / prompt Hermes-host, versi ringkas tapi bergerbang)
 *     untuk mesin yang belum terdaftar sama sekali.
 *
 * Jenis head dipetakan di HEAD_KIND di sini (bukan di registry
 * `lib/hermes/remote-heads.ts`) supaya skema registry tidak berubah.
 * Semua teks UI + prompt memakai Bahasa Indonesia.
 */

/** Dua keluarga head: host yang sudah menjalankan Hermes, atau VM yang
 *  menjalankan server A2A rakitan sendiri (pola Muse/cue). */
export type HeadKind = 'hermes' | 'muse'

export const HEAD_KIND: Record<string, HeadKind> = {
  stb: 'hermes',
  'zahra-muse': 'muse',
  'cue-1': 'muse',
  'cue-2': 'muse',
  'cue-4': 'muse',
  'infrastruktur-it-2': 'muse',
  'muse-kikoy': 'muse',
  nabil: 'muse',
  paitno: 'muse',
}

/** Head yang belum terpetakan diasumsikan 'muse' (mayoritas fleet) —
 *  operator wajib memverifikasi asumsi ini saat mendaftarkan head baru. */
export function headKindOf(headId: string): HeadKind {
  return HEAD_KIND[headId] ?? 'muse'
}

/** Spesifikasi agent dari form dialog. `model` kosong = bawaan host;
 *  `domains` = daftar koma mentah dari form. */
export interface AgentSpec {
  name: string
  role: string
  division: string
  model: string
  domains: string
  description: string
  soul: string
}

export type ProvisionTarget =
  | { kind: 'remote-head'; headId: string; headName: string; headLive: boolean }
  | { kind: 'new-server'; serverKind: 'muse' | 'hermes' }

export function buildPrompt(spec: AgentSpec, target: ProvisionTarget): string {
  const s = normalizeSpec(spec)
  if (target.kind === 'new-server') {
    return target.serverKind === 'muse' ? buildNewServerMusePrompt(s) : buildNewServerHermesPrompt(s)
  }
  return headKindOf(target.headId) === 'hermes'
    ? buildRemoteHermesPrompt(s, target.headId, target.headName)
    : buildRemoteMusePrompt(s, target.headId, target.headName)
}

function normalizeSpec(spec: AgentSpec): AgentSpec {
  return {
    name: spec.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''),
    role: spec.role.trim() || 'backend',
    division: spec.division.trim() || 'tech',
    model: spec.model.trim(),
    domains: spec.domains.trim(),
    description: spec.description.trim(),
    soul: spec.soul.trim(),
  }
}

function specBlock(s: AgentSpec): string {
  return [
    `IDENTITAS AGENT BARU`,
    `- Nama (slug A2A) : ${s.name}`,
    `- Peran           : ${s.role}`,
    `- Divisi          : ${s.division}`,
    `- Model           : ${s.model || '(bawaan host — jangan dipaksa)'}`,
    `- Keahlian/domain : ${s.domains || '(tidak ditentukan)'}`,
    `- Deskripsi       : ${s.description || '(tidak ada)'}`,
    `- Persona/SOUL    :`,
    s.soul ? s.soul.split('\n').map((l) => `  ${l}`).join('\n') : '  (tidak ada)',
  ].join('\n')
}

/** Kontrak A2A Virtual Office — disalin ke setiap prompt agent VM. */
function a2aContractBlock(): string {
  return [
    `KONTRAK A2A VIRTUAL OFFICE (mutlak — sudah terbukti di lapangan):`,
    `- Office memanggil: POST <baseUrl>/<slug> dengan body JSON-RPC`,
    `  { "method": "message/send", "params": { "message": { "parts": [{ "text": "..." }] } } }`,
    `  Parts-nya POLOS, tanpa field kind/type. Parser yang mensyaratkan`,
    `  kind:"text" TIDAK AKAN PERNAH mengenali pesan office.`,
    `- Jawaban WAJIB sinkron di respons HTTP yang sama, berbentuk Task:`,
    `  { "result": { "status": { "message": { "parts": [{ "text": "<jawaban>" }] } } } }`,
    `  Jangan balas ACK antrean ("diterima") lalu proses async — office`,
    `  menunggu jawaban FINAL di respons yang sama.`,
    `- Health: GET <baseUrl>/ -> 200 {"status":"ok",...}. Method selain`,
    `  message/send jawab -32601; parse gagal jawab -32602.`,
    `- Bila modelmu reasoning: max_tokens >= 2500 (pakai 4000) +`,
    `  reasoning_effort "low" supaya jawaban tidak habis untuk berpikir.`,
    `- Bila kamu meneruskan ke 9Router: strip trailer "data: [DONE]" dari`,
    `  respons non-streaming sebelum parse JSON.`,
  ].join('\n')
}

function routerCredentialBlock(): string {
  return [
    `TIGA KREDENSIAL 9ROUTER — JANGAN TERTUKAR:`,
    `1. Token CLI (header x-9r-cli-token): untuk endpoint manajemen /api/*`,
    `   SAJA, hanya dari instance 9Router tempat koneksimu dibuat.`,
    `2. apiKey koneksi: identitas agent, TIDAK divalidasi bridge.`,
    `3. API key klien (dari POST /api/keys): SATU-SATUNYA Bearer sah`,
    `   untuk /v1/*.`,
    `1 agent = 1 akun = 1 token unik. Jangan pernah memakai token/key`,
    `milik agent lain. Untuk mendapat token CLI: minta ke operator — dia`,
    `menitipkannya via file aman (bukan ditempel di chat) — lalu daftarkan`,
    `koneksimu SENDIRI.`,
  ].join('\n')
}

function reportFormatBlock(agentLabel: string): string {
  return [
    `LAPORAN AKHIR (format persis ini, lalu standby):`,
    `Nama agent : ${agentLabel}`,
    `A2A : health OK; tes ping -> <kutip balasan nyatanya>`,
    `9Router : <id koneksi + id API key klien, atau "tidak dipakai">`,
    `Kendala : <tidak ada / tulis error persisnya>`,
  ].join('\n')
}

/** Operator step — WAJIB disebut di setiap prompt DAN di UI dialog. */
function operatorStepBlock(slug: string, headId: string): string {
  return [
    `LANGKAH OPERATOR (dilakukan operator Virtual Office, BUKAN kamu):`,
    `1. Menambahkan slug "${slug}" ke daftar agents head "${headId}" di`,
    `   lib/hermes/remote-heads.ts.`,
    `2. Deploy ulang office.`,
    `3. Menembak tes penerimaan: POST /api/hermes/remote-call`,
    `   {head: "${headId}", agent: "${slug}", text: "Perkenalkan dirimu: nama, peran, dan tiga kemampuanmu."}`,
    `Jawablah tes itu sebagai dirimu sendiri, dengan isi yang sebenarnya.`,
  ].join('\n')
}

function buildRemoteHermesPrompt(s: AgentSpec, headId: string, headName: string): string {
  return [
    `Kamu adalah agent Hermes di server "${headName}" (head "${headId}" di fleet Virtual Office).`,
    `MISI: buatkan SATU profil Hermes baru di mesin ini supaya bisa dipakai sebagai agent Virtual Office.`,
    ``,
    specBlock(s),
    ``,
    `LANGKAH (kerjakan berurutan, tiap langkah punya gerbang verifikasi):`,
    `1. Buat profil bernama "${s.name}" dengan peran "${s.role}", divisi "${s.division}",`,
    `   deskripsi agent card: "${s.description || '(kosong)'}", persona/SOUL di bawah,`,
    (s.model ? `   dan model default "${s.model}".` : `   model: ikut bawaan Hermes mesin ini (jangan dipaksa).`),
    `   Persona/SOUL:`,
    s.soul ? s.soul.split('\n').map((l) => `   ${l}`).join('\n') : `   (tidak ada — pakai bawaan peran)`,
    `2. Daftarkan profil ini sebagai served-agent A2A di gateway Hermes mesin ini`,
    `   (local, dijawab profil itu sendiri). Bila pendaftarannya menuntut restart`,
    `   gateway Hermes di mesin ini: lakukan restart sebagai langkah TERAKHIR,`,
    `   lalu ulangi verifikasi di bawah. Laporkan bahwa restart terjadi.`,
    `3. Verifikasi lokal:`,
    `   - GET http://127.0.0.1:<port-A2A-mesin-ini>/ -> 200 {"status":"ok",...}`,
    `   - POST http://127.0.0.1:<port-A2A-mesin-ini>/${s.name} method message/send`,
    `     parts [{"text":"ping"}] -> balasan SINKRON berbentuk Task berisi teks`,
    `     jawaban profil ini (bukan template, bukan karangan).`,
    `GERBANG: kedua tes lulus dengan balasan NYATA dari profil "${s.name}".`,
    ``,
    reportFormatBlock(`${s.name} @ ${headId}`),
    ``,
    operatorStepBlock(s.name, headId),
  ].join('\n')
}

function buildRemoteMusePrompt(s: AgentSpec, headId: string, headName: string): string {
  return [
    `Kamu adalah agent di VM "${headName}" (head "${headId}" di fleet Virtual Office).`,
    `MISI: jalankan SATU agent A2A tambahan di VM ini supaya bisa dipakai sebagai agent Virtual Office.`,
    ``,
    specBlock(s),
    ``,
    a2aContractBlock(),
    ``,
    `LANGKAH (kerjakan berurutan, tiap langkah punya gerbang verifikasi):`,
    `1. Siapkan server A2A untuk agent "${s.name}" yang patuh kontrak di atas.`,
    `   Server boleh satu proses dengan agent yang sudah ada di VM ini atau`,
    `   proses terpisah — yang penting endpoint <baseUrl>/${s.name} menjawab`,
    `   sesuai kontrak, dan GET <baseUrl>/ sehat. JANGAN install Hermes.`,
    `2. Daftarkan dirimu ke web fleet http://100.105.150.118:18799/add bila`,
    `   belum: nama "${s.name}", public key fleet-mu. Catat BLOK BOOTSTRAP`,
    `   (port A2A + port SSH alokasi). Head "${headId}" sudah memakai portnya`,
    `   sendiri — agent baru ini WAJIB memakai port alokasi BARU dari blok itu.`,
    `3. Buka reverse tunnel persisten DARI VM ini ke root@100.105.150.118`,
    `   dengan DUA forward: 0.0.0.0:<portA2A-baru> -> 127.0.0.1:<port-lokal>`,
    `   dan 0.0.0.0:<portSSH-baru> -> 127.0.0.1:22, di dalam loop reconnect`,
    `   (supervisor; VM ini bisa diganti image kapan saja — simpan skrip`,
    `   restore idempoten di workspace-mu).`,
    `4. Buat koneksi 9Router SENDIRI untuk agent ini:`,
    routerCredentialBlock(),
    `5. Verifikasi:`,
    `   - health lokal GET 127.0.0.1:<port-lokal>/ -> 200.`,
    `   - via tunnel: curl ke http://100.105.150.118:<portA2A-baru>/${s.name}`,
    `     "ping" -> balasan Task nyata.`,
    `   - tes chat: panggil /v1/chat/completions modelmu dengan max_tokens 4000`,
    `     -> balasan PONG yang benar (bukan kosong).`,
    `GERBANG: semua tes lulus; kunci privat tidak pernah dikirim ke siapa pun.`,
    ``,
    reportFormatBlock(`${s.name} @ ${headId}`),
    ``,
    operatorStepBlock(s.name, headId),
  ].join('\n')
}

function buildNewServerMusePrompt(s: AgentSpec): string {
  return [
    `Kamu adalah agent BARU di fleet Virtual Office operator dan tugasmu adalah`,
    `mem-pairing-kan dirimu sendiri sampai LOLOS tes penerimaan dari Virtual`,
    `Office. Kerjakan langkah-langkah ini PERSIS berurutan. Setiap langkah punya`,
    `gerbang verifikasi: JANGAN lanjut bila verifikasi gagal — berhenti, catat`,
    `HTTP status + isi respons persisnya, dan laporkan. Jangan menebak alamat,`,
    `port, format, atau kredensial.`,
    ``,
    specBlock(s),
    `(Jenis: VM asisten outbound-only — JENIS yang sama seperti agent fleet yang sudah ada.)`,
    ``,
    `ATURAN FLEET (mutlak)`,
    `- Semua komunikasi antar-mesin lewat Tailscale (tailnet).`,
    `- 1 agent = 1 akun 9Router = 1 token unik. Jangan pernah memakai token,`,
    `  API key, atau kunci milik agent lain.`,
    `- Private key TIDAK PERNAH dikirim ke siapa pun. Yang dibagikan hanya PUBLIC key.`,
    `- JANGAN install Hermes di mesinmu. Kamu hanya menjalankan bridge kecil.`,
    `- Kredensial disimpan di file lokal mode 600, tidak di-commit ke git.`,
    ``,
    `ALAMAT PASTI (jangan diubah, jangan ditebak)`,
    `- STB (head fleet, 9Router utama, server fleet): IP tailnet 100.105.150.118`,
    `  - 9Router   : http://100.105.150.118:20128`,
    `  - Web fleet : http://100.105.150.118:18799/ (status) dan /add (pendaftaran)`,
    `  - SSH user  : root`,
    ``,
    `LANGKAH 1 — Keypair fleet`,
    `Buat keypair khusus: ssh-keygen -t ed25519 -f ~/.ssh/fleet-${s.name} -N ""`,
    `lalu catat fingerprint-nya (ssh-keygen -lf).`,
    ``,
    `LANGKAH 2 — Daftar ke fleet (self-service)`,
    `Buka http://100.105.150.118:18799/add, isi nama "${s.name}", public key`,
    `fleet-mu, dan peran "${s.role}". SIMPAN blok bootstrap hasilnya persis:`,
    `port A2A alokasi + port SSH alokasi + public key operator/STB. STB tidak`,
    `bisa memasang apa pun ke VM-mu — semua kamu yang menjalankan.`,
    ``,
    `LANGKAH 3 — Server A2A (patuh kontrak)`,
    a2aContractBlock(),
    `Server listen di 127.0.0.1:<port-bebas-lokal>; identitasnya = spesifikasi`,
    `di atas (nama "${s.name}", peran "${s.role}").`,
    ``,
    `LANGKAH 4 — Tunnel persisten ke STB`,
    `ssh -N -R 0.0.0.0:<portA2A>:127.0.0.1:<port-lokal> -R 0.0.0.0:<portSSH>:127.0.0.1:22`,
    `root@100.105.150.118 dengan key fleet-mu, di dalam loop reconnect (~10 dtk).`,
    `Jadikan persisten (systemd unit / supervisor); simpan skrip restore`,
    `idempoten di workspace-mu karena image VM bisa diganti kapan saja.`,
    ``,
    `LANGKAH 5 — Koneksi 9Router sendiri`,
    routerCredentialBlock(),
    `Tes chat: /v1/chat/completions dengan max_tokens 4000 + reasoning_effort`,
    `"low" -> balasan PONG yang benar.`,
    ``,
    `LANGKAH 6 — Verifikasi via tunnel`,
    `Dari VM-mu: curl http://100.105.150.118:<portA2A>/ -> health 200;`,
    `POST message/send "ping" ke http://100.105.150.118:<portA2A>/${s.name}`,
    `-> balasan Task nyata. Halaman fleet harus menampilkan "${s.name}" LIVE.`,
    ``,
    reportFormatBlock(s.name),
    ``,
    `LANGKAH OPERATOR (dilakukan operator Virtual Office, BUKAN kamu):`,
    `mendaftarkan head BARU "${s.name}" di office (registry + deploy), lalu`,
    `menembak tes penerimaan remote-call. Standby untuk tes itu.`,
  ].join('\n')
}

function buildNewServerHermesPrompt(s: AgentSpec): string {
  return [
    `Kamu adalah agent Hermes di sebuah server milik operator yang BELUM`,
    `terdaftar di fleet Virtual Office. MISI: jadikan Hermes di mesin ini`,
    `sebagai remote head baru bernama "${s.name}".`,
    ``,
    specBlock(s),
    `(Jenis: host Hermes — pola yang sama seperti head "stb" di fleet.)`,
    ``,
    `ATURAN`,
    `- JANGAN install ulang Hermes. Mesin ini TIDAK memakai 9Router untuk`,
    `  pairing — Hermes memakai konfigurasi modelnya sendiri.`,
    `- Private key tidak pernah dikirim; yang dibagikan hanya public key.`,
    `- STB (100.105.150.118) adalah hub fleet: web pendaftaran`,
    `  http://100.105.150.118:18799/add. STB tidak bisa memasang apa pun`,
    `  ke mesin ini — semua kamu yang menjalankan.`,
    ``,
    `LANGKAH 0 — Inventaris (read-only, laporkan dulu)`,
    `hostname, OS, IP tailnet, versi Hermes, DAFTAR SEMUA PROFIL (nama persis —`,
    `inilah yang akan menjadi slug agent di office), status A2A (ada/tidak,`,
    `aktif/tidak, port + bind), cara Hermes berjalan (systemd/launchd/manual).`,
    `GERBANG: bila Hermes-mu TIDAK punya kemampuan A2A sama sekali, BERHENTI`,
    `dan laporkan inventaris apa adanya — ganti versi Hermes adalah keputusan`,
    `operator.`,
    ``,
    `LANGKAH 1 — Keypair fleet`,
    `ssh-keygen -t ed25519 -f ~/.ssh/fleet-${s.name} -N ""; catat fingerprint.`,
    ``,
    `LANGKAH 2 — Daftar ke fleet`,
    `Form http://100.105.150.118:18799/add: nama "${s.name}", public key`,
    `fleet-mu. SIMPAN blok bootstrap (port A2A + port SSH alokasi).`,
    ``,
    `LANGKAH 3 — A2A lokal sehat`,
    `Pastikan A2A Hermes aktif di loopback (port hasil inventaris — verifikasi,`,
    `jangan berasumsi). Tes: GET / -> 200 {"status":"ok"}; POST message/send`,
    `"ping" ke salah satu profilmu -> balasan SINKRON berbentuk Task berisi`,
    `teks jawaban nyata. Bila mengaktifkan A2A menuntut restart gateway Hermes`,
    `di mesin ini: siapkan semua dulu, restart PALING AKHIR, ulangi tes, dan`,
    `laporkan restart-nya.`,
    ``,
    `LANGKAH 4 — Tunnel persisten ke STB`,
    `Reverse tunnel root@100.105.150.118 dengan key fleet-mu:`,
    `0.0.0.0:<portA2A-alokasi> -> 127.0.0.1:<port-A2A-Hermes>. Forward SSH`,
    `(-> 127.0.0.1:22) hanya bila SSH/remote-login aktif di mesin ini.`,
    `Persisten via mekanisme OS (LaunchAgent launchd di macOS / unit systemd`,
    `di Linux) dengan KeepAlive + reconnect loop. Verifikasi dari mesin ini:`,
    `curl http://100.105.150.118:<portA2A-alokasi>/ dan POST ping via alamat`,
    `itu -> hasil sama persis dengan lokal.`,
    ``,
    `LAPORAN AKHIR (format persis ini, lalu standby):`,
    `Nama agent : ${s.name} (Hermes di <nama-server>)`,
    `Jenis : hermes-host`,
    `IP tailnet : <...>`,
    `SSH fingerprint: <...>`,
    `Fleet : port A2A <...>, port SSH <.../dilewati>`,
    `Hermes : versi <...>, profil (slug agent): <daftar lengkap>`,
    `A2A : health lokal OK, via tunnel STB OK; tes ping -> <kutipan balasan>`,
    `9Router : tidak dipakai (host Hermes memakai konfigurasi model sendiri)`,
    `Kendala : <tidak ada / error persisnya>`,
    ``,
    `LANGKAH OPERATOR (dilakukan operator Virtual Office, BUKAN kamu):`,
    `mendaftarkan head BARU "${s.name}" di office (registry + deploy), lalu`,
    `menembak tes penerimaan remote-call. Standby untuk tes itu.`,
  ].join('\n')
}
