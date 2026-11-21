/** Indonesian copy for every outbox template. Payload shape per template: { name: string, url: string }, except verify-email and campus-email which are code-only { name, code } (no link: mail scanners open links); waitlist-offer adds { kosName, roomNumber, expiresAt }. */
export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

interface LinkPayload {
  name: string
  url: string
}

interface OfferPayload extends LinkPayload {
  kosName: string
  roomNumber: string
  /** ISO timestamp of the offer deadline. */
  expiresAt: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

interface Copy {
  subject: string
  intro: string
  action: string
  outro: string
}

const COPY: Record<string, Copy> = {
  'reset-password': {
    subject: 'Atur ulang kata sandi KoBo',
    intro: 'Kami menerima permintaan untuk mengatur ulang kata sandi akun KoBo Anda.',
    action: 'Atur Ulang Kata Sandi',
    outro: 'Tautan ini berlaku satu jam. Jika bukan Anda yang meminta, abaikan email ini dan kata sandi Anda tetap aman.',
  },
  'payment-received': {
    subject: 'Pembayaran diterima - KoBo',
    intro: 'Pembayaran sewa kamar Anda sudah kami terima. Kuitansi digital Anda siap dilihat dan dicetak.',
    action: 'Lihat Kuitansi',
    outro: 'Simpan email ini sebagai bukti pembayaran. Tagihan bulan berikutnya tersedia di halaman Kos Saya.',
  },
  // Owner document review. Deliberately no document details: the reason is read inside KoBo after signing in.
  'owner-approved': {
    subject: 'Verifikasi pemilik kos Anda disetujui - KoBo',
    intro: 'Dokumen kepemilikan Anda sudah diperiksa dan disetujui. Anda sekarang dapat memasang kos di KoBo.',
    action: 'Buka Dasbor Pemilik',
    outro: 'Terima kasih sudah melengkapi verifikasi. Berkas dokumen Anda dihapus otomatis 90 hari setelah keputusan.',
  },
  'owner-rejected': {
    subject: 'Verifikasi pemilik kos perlu diperbaiki - KoBo',
    intro: 'Dokumen kepemilikan Anda belum dapat kami setujui. Alasannya dapat dilihat setelah Anda masuk ke KoBo, lalu Anda dapat mengunggah ulang dokumen yang diminta.',
    action: 'Lihat Alasan dan Unggah Ulang',
    outro: 'Pemeriksaan berikutnya memakan waktu maksimal 2×24 jam kerja. Berkas dokumen Anda dihapus otomatis 90 hari setelah keputusan.',
  },
  // Student KTM review. Deliberately no card details (no NIM, no photo): the reject reason is a fixed instruction, not card data.
  'student-approved': {
    subject: 'Status mahasiswa terverifikasi - KoBo',
    intro: 'Status mahasiswa Anda sudah terverifikasi. Anda kini dapat memakai fitur khusus mahasiswa di KoBo.',
    action: 'Cari Kos',
    outro: 'Foto KTM Anda dihapus otomatis 30 hari setelah keputusan.',
  },
  // Teman Sekamar. Deliberately no message text, no contact and no profile detail: only that something is waiting inside KoBo.
  'matching-request': {
    subject: 'Ada permintaan teman sekamar baru - KoBo',
    intro: 'Ada permintaan teman sekamar baru untuk Anda. Buka KoBo untuk melihat profilnya dan memutuskan.',
    action: 'Lihat Permintaan',
    outro: 'Permintaan berlaku 14 hari. Anda dapat mematikan email Teman Sekamar di halaman Pengaturan.',
  },
  'matching-accept': {
    subject: 'Permintaan teman sekamar Anda diterima - KoBo',
    intro: 'Permintaan teman sekamar Anda diterima. Kalian kini terhubung dan bisa saling berkirim pesan di KoBo.',
    action: 'Buka Pesan',
    outro: 'Jaga keamanan: bertemulah di tempat umum dan jangan transfer uang sebelum yakin. Anda dapat mematikan email Teman Sekamar di halaman Pengaturan.',
  },
}

/** Digest: the sender's display name only (payload { name, url, from }), never the message. Falls back to a generic subject. */
function matchingDigestCopy(p: { from?: unknown }): Copy {
  const from = typeof p.from === 'string' && p.from.trim() ? p.from.trim().slice(0, 60) : 'teman sekamar Anda'
  return {
    subject: `Ada pesan baru dari ${from} - KoBo`,
    intro: `Ada pesan baru dari ${from} yang belum Anda baca. Buka KoBo untuk membacanya.`,
    action: 'Buka Pesan',
    outro: 'Kami mengirim maksimal satu email per percakapan setiap 6 jam. Anda dapat mematikan email Teman Sekamar di halaman Pengaturan.',
  }
}

/** Code-only mails (sign-up and campus-email verification). There is deliberately no URL, button or link in them. */
const CODE_COPY: Record<string, Copy> = {
  'verify-email': {
    subject: 'Kode verifikasi KoBo Anda',
    intro: 'Terima kasih sudah mendaftar di KoBo. Masukkan kode ini di KoBo untuk memverifikasi email Anda.',
    action: '',
    outro: 'Berlaku 10 menit. Jangan bagikan kode ini. Jika Anda tidak merasa mendaftar di KoBo, abaikan saja email ini.',
  },
  'campus-email': {
    subject: 'Kode verifikasi email kampus Anda di KoBo',
    intro: 'Masukkan kode ini di halaman Profil KoBo untuk memverifikasi status mahasiswa Anda.',
    action: '',
    outro: 'Berlaku 10 menit dan hanya bisa dipakai sekali. Jangan bagikan kode ini. Jika Anda tidak memintanya, abaikan email ini.',
  },
}

function renderCodeEmail(copy: Copy, p: { name?: unknown; code?: unknown }): RenderedEmail | null {
  if (typeof p.code !== 'string' || !/^\d{6}$/.test(p.code)) return null
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Pengguna KoBo'
  const text = `Halo ${name},

${copy.intro}

Kode verifikasi KoBo Anda: ${p.code}

${copy.outro}

Tim KoBo`
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;background:#f6f8f8;font-family:Arial,Helvetica,sans-serif;color:#1b2a2a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">Kode verifikasi KoBo Anda: ${esc(p.code)}</div>
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:22px;font-weight:800;margin:0 0 24px">Ko<span style="color:#0f9d92">Bo</span></p>
<div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3eaea">
<p style="margin:0 0 12px">Halo ${esc(name)},</p>
<p style="margin:0 0 16px;line-height:1.55">${esc(copy.intro)}</p>
<p style="margin:0 0 4px;font-size:13px;color:#5b6b6b">Kode verifikasi KoBo Anda:</p>
<p style="margin:0 0 20px;font-size:32px;font-weight:800;letter-spacing:8px">${esc(p.code)}</p>
<p style="margin:16px 0 0;font-size:13px;color:#5b6b6b;line-height:1.5">${esc(copy.outro)}</p>
<p style="margin:16px 0 0">Tim KoBo</p>
</div></div></body></html>`
  return { subject: copy.subject, html, text }
}

const WIB_DATE = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'long', year: 'numeric' })
const WIB_TIME = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** "3 Oktober 2026 pukul 14.30 WIB" */
function deadlineWIB(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${WIB_DATE.format(d)} pukul ${WIB_TIME.format(d).replace(':', '.')} WIB`
}

/** The daftar tunggu offer names the kos, the room and the deadline, so its copy is built per payload. */
function offerCopy(p: Partial<OfferPayload>): Copy | null {
  if (typeof p.kosName !== 'string' || typeof p.roomNumber !== 'string' || typeof p.expiresAt !== 'string') return null
  const deadline = deadlineWIB(p.expiresAt)
  if (!deadline) return null
  return {
    subject: `Kamar di ${p.kosName} tersedia untukmu`,
    intro: `Kabar baik: kamar ${p.roomNumber} di ${p.kosName} sekarang tersedia dan kami simpan khusus untukmu. Ajukan sewa sebelum ${deadline}. Tawaran ini ditahan selama pemilik meninjau pengajuan Anda; jika tidak ada pengajuan sampai batas itu, kamar ditawarkan ke pengantre berikutnya.`,
    action: 'Ajukan Sewa',
    outro: 'Anda tidak perlu membalas email ini. Jika sudah tidak berminat, abaikan saja atau pilih Lewati di halaman kos.',
  }
}

interface OwnerPaymentPayload extends LinkPayload {
  tenantName: string
  kosName: string
  roomNumber: string
  amount: number
}

interface StudentRejectedPayload extends LinkPayload {
  reason: string
  attempt: number
  max: number
}

/** The reason is one of the fixed instructions (or an operator note), never card data. */
function studentRejectedCopy(p: Partial<StudentRejectedPayload>): Copy | null {
  if (typeof p.reason !== 'string' || typeof p.attempt !== 'number' || typeof p.max !== 'number') return null
  const out = p.attempt >= p.max ? 'Batas percobaan KTM sudah habis. Gunakan Cara lain (email kampus atau akun kampus) atau hubungi KoBo.' : 'Anda dapat mengunggah ulang KTM dari halaman Profil.'
  return {
    subject: 'Verifikasi KTM perlu diperbaiki - KoBo',
    intro: `KTM Anda belum dapat kami setujui. ${p.reason} (Percobaan ${p.attempt} dari ${p.max}.)`,
    action: 'Buka Profil',
    outro: `${out} Foto KTM Anda dihapus otomatis 30 hari setelah keputusan.`,
  }
}

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

/** Tells the owner a rent payment was verified. It deliberately says nothing about payout timing. */
function ownerPaymentCopy(p: Partial<OwnerPaymentPayload>): Copy | null {
  if (typeof p.tenantName !== 'string' || typeof p.kosName !== 'string' || typeof p.roomNumber !== 'string' || typeof p.amount !== 'number') return null
  return {
    subject: `Pembayaran terverifikasi - Kamar ${p.roomNumber}`,
    intro: `${p.tenantName} membayar ${rupiah(p.amount)} untuk kamar ${p.roomNumber} di ${p.kosName}, dan pembayaran ini sudah terverifikasi oleh KoBo. Kamar kini berstatus terisi.`,
    action: 'Lihat Kuitansi',
    outro: 'Email ini hanya memastikan pembayaran penyewa terverifikasi. Ini bukan pemberitahuan pencairan dana ke rekening Anda.',
  }
}

interface ReminderPayload extends LinkPayload {
  kosName: string
  roomNumber: string
  amount: number
  /** YYYY-MM-DD */
  dueDate: string
  /** Days until the due date (0 = today). */
  days: number
}

/** H-7 / H-3 / H-1 payment reminder to the student. */
function reminderCopy(p: Partial<ReminderPayload>): Copy | null {
  if (typeof p.kosName !== 'string' || typeof p.roomNumber !== 'string' || typeof p.amount !== 'number' || typeof p.dueDate !== 'string' || typeof p.days !== 'number') return null
  const when = p.days <= 0 ? 'hari ini' : p.days === 1 ? 'besok' : `${p.days} hari lagi`
  return {
    subject: `Pengingat: tagihan sewa kamar ${p.roomNumber} jatuh tempo ${when}`,
    intro: `Tagihan sewa ${rupiah(p.amount)} untuk kamar ${p.roomNumber} di ${p.kosName} jatuh tempo ${when} (${p.dueDate}). Bayar lewat KoBo agar kamar Anda tetap aman.`,
    action: 'Bayar di KoBo',
    outro: 'Abaikan email ini jika Anda sudah membayar. Anda dapat mematikan pengingat di halaman Profil.',
  }
}

export function renderEmail(template: string, payload: unknown): RenderedEmail | null {
  const codeCopy = CODE_COPY[template]
  if (codeCopy) return payload && typeof payload === 'object' ? renderCodeEmail(codeCopy, payload) : null
  const p = payload as (Partial<OfferPayload> & Partial<OwnerPaymentPayload> & Partial<ReminderPayload> & Partial<StudentRejectedPayload> & { from?: unknown }) | null
  const copy = template === 'waitlist-offer' ? (p ? offerCopy(p) : null) : template === 'payment-received-owner' ? (p ? ownerPaymentCopy(p) : null) : template === 'invoice-reminder' ? (p ? reminderCopy(p) : null) : template === 'matching-digest' ? (p ? matchingDigestCopy(p) : null) : template === 'student-rejected' ? (p ? studentRejectedCopy(p) : null) : COPY[template]
  if (!copy || !p || typeof p.url !== 'string') return null
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Pengguna KoBo'
  const text = `Halo ${name},\n\n${copy.intro}\n\n${copy.action}: ${p.url}\n\n${copy.outro}\n\nTim KoBo`
  // A full document with <title> and a hidden preheader (the inbox preview line) reads less like bulk mail to filters.
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(copy.subject)}</title></head>
<body style="margin:0;background:#f6f8f8;font-family:Arial,Helvetica,sans-serif;color:#1b2a2a">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(copy.intro)}</div>
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:22px;font-weight:800;margin:0 0 24px">Ko<span style="color:#0f9d92">Bo</span></p>
<div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3eaea">
<p style="margin:0 0 12px">Halo ${esc(name)},</p>
<p style="margin:0 0 24px;line-height:1.55">${esc(copy.intro)}</p>
<p style="margin:0 0 24px"><a href="${esc(p.url)}" style="display:inline-block;background:#0f9d92;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">${esc(copy.action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6b6b;line-height:1.5">Atau salin tautan ini ke peramban Anda:<br><span style="word-break:break-all">${esc(p.url)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#5b6b6b;line-height:1.5">${esc(copy.outro)}</p>
<p style="margin:16px 0 0">Tim KoBo</p>
</div></div></body></html>`
  return { subject: copy.subject, html, text }
}
