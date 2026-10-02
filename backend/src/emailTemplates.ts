/** Indonesian copy for every outbox template. Payload shape per template: { name: string, url: string }; waitlist-offer adds { kosName, roomNumber, expiresAt }. */
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
  'verify-email': {
    subject: 'Verifikasi email KoBo Anda',
    intro: 'Terima kasih sudah mendaftar di KoBo. Satu langkah lagi: konfirmasi bahwa ini memang email Anda.',
    action: 'Verifikasi Email',
    outro: 'Jika Anda tidak merasa mendaftar di KoBo, abaikan saja email ini.',
  },
  'reset-password': {
    subject: 'Atur ulang kata sandi KoBo',
    intro: 'Kami menerima permintaan untuk mengatur ulang kata sandi akun KoBo Anda.',
    action: 'Atur Ulang Kata Sandi',
    outro: 'Tautan ini berlaku satu jam. Jika bukan Anda yang meminta, abaikan email ini dan kata sandi Anda tetap aman.',
  },
  'campus-email': {
    subject: 'Verifikasi email kampus Anda di KoBo',
    intro: 'Konfirmasi email kampus ini untuk mendapatkan potongan harga mahasiswa di KoBo.',
    action: 'Verifikasi Email Kampus',
    outro: 'Tautan ini berlaku 24 jam. Jika Anda tidak memintanya, abaikan email ini.',
  },
  'payment-received': {
    subject: 'Pembayaran diterima - KoBo',
    intro: 'Pembayaran sewa kamar Anda sudah kami terima. Kuitansi digital Anda siap dilihat dan dicetak.',
    action: 'Lihat Kuitansi',
    outro: 'Simpan email ini sebagai bukti pembayaran. Tagihan bulan berikutnya tersedia di halaman Kos Saya.',
  },
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
    intro: `Kabar baik: kamar ${p.roomNumber} di ${p.kosName} sekarang tersedia dan kami simpan khusus untukmu. Pesan sebelum ${deadline}, setelah itu kamar ditawarkan ke pengantre berikutnya.`,
    action: 'Pesan Kamar',
    outro: 'Kamu tidak perlu membalas email ini. Jika sudah tidak berminat, abaikan saja atau pilih Lewati di halaman kos.',
  }
}

export function renderEmail(template: string, payload: unknown): RenderedEmail | null {
  const p = payload as Partial<OfferPayload> | null
  const copy = template === 'waitlist-offer' ? (p ? offerCopy(p) : null) : COPY[template]
  if (!copy || !p || typeof p.url !== 'string') return null
  const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Pengguna KoBo'
  const text = `Halo ${name},\n\n${copy.intro}\n\n${copy.action}: ${p.url}\n\n${copy.outro}\n\nTim KoBo`
  const html = `<!doctype html><html lang="id"><body style="margin:0;background:#f6f8f8;font-family:Arial,Helvetica,sans-serif;color:#1b2a2a">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:22px;font-weight:800;margin:0 0 24px">Ko<span style="color:#0f9d92">Bo</span></p>
<div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3eaea">
<p style="margin:0 0 12px">Halo ${esc(name)},</p>
<p style="margin:0 0 24px;line-height:1.55">${esc(copy.intro)}</p>
<p style="margin:0 0 24px"><a href="${esc(p.url)}" style="display:inline-block;background:#0f9d92;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px">${esc(copy.action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6b6b;line-height:1.5">Atau salin tautan ini ke peramban Anda:<br><span style="word-break:break-all">${esc(p.url)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#5b6b6b;line-height:1.5">${esc(copy.outro)}</p>
</div></div></body></html>`
  return { subject: copy.subject, html, text }
}
