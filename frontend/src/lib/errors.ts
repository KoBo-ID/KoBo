/**
 * One place that turns any failure into Indonesian copy for the UI: tRPC errors (`data.code`), better-auth
 * client errors (`{ status, code }`) and network failures. Duck-typed, so it imports nothing.
 */

const NETWORK = 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
const RATE_LIMIT = 'Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.';
const GENERIC = 'Terjadi kesalahan. Silakan coba lagi.';

/** better-auth / KoBo plugin codes with a specific message. */
const AUTH_CODES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email atau kata sandi salah.',
  EMAIL_NOT_VERIFIED: 'Email Anda belum diverifikasi. Masukkan kode 6 digit yang kami kirim ke email Anda.',
  INVALID_OTP: 'Kode salah atau sudah kedaluwarsa.',
  OTP_EXPIRED: 'Kode salah atau sudah kedaluwarsa.',
  TOO_MANY_ATTEMPTS: 'Terlalu banyak percobaan. Kirim ulang kode.',
  INVALID_EMAIL: 'Format email tidak valid.',
  PASSWORD_TOO_SHORT: 'Kata sandi minimal 8 karakter.',
  PASSWORD_TOO_LONG: 'Kata sandi terlalu panjang.',
  USER_ALREADY_EXISTS: 'Email ini sudah terdaftar. Silakan masuk.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Email ini sudah terdaftar. Silakan masuk.',
  INVALID_PASSWORD: 'Kata sandi saat ini salah.',
  INVALID_TOKEN: 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.',
  TOKEN_EXPIRED: 'Tautan sudah kedaluwarsa. Minta tautan baru.',
  INVALID_CAMPUS_EMAIL: 'Format email kampus tidak valid. Contoh: nama@binus.ac.id.',
  CAMPUS_EMAIL_DOMAIN_UNKNOWN: 'Domain email ini belum terdaftar sebagai email mahasiswa kampus. Coba akun Microsoft/Google kampus atau unggah KTM.',
  CAMPUS_EMAIL_NO_MX: 'Domain email ini tidak dapat menerima email. Periksa penulisannya.',
  CAMPUS_CODE_INVALID: 'Kode salah. Periksa kembali 6 digit di email Anda.',
  CAMPUS_CODE_EXPIRED: 'Kode sudah kedaluwarsa atau tidak berlaku. Kirim kode baru.',
  CAMPUS_EMAIL_TAKEN: 'Email kampus ini sudah dipakai akun lain.',
  DEMO_ACCOUNT_READONLY: 'Akun ini bersifat hanya-baca. Buat akun sendiri untuk mengubah data ini.',
  INVALID_PROFILE: 'Nama terlalu panjang (maksimal 80 karakter).',
};

/** Indonesian text for the `?campus=` result the campus-account sign-in redirect back to /profile with. */
export const CAMPUS_RETURN_MESSAGES: Record<string, { tone: 'success' | 'error'; text: string }> = {
  verified: { tone: 'success', text: 'Status mahasiswa Anda terverifikasi.' },
  invalid: { tone: 'error', text: 'Verifikasi tidak berhasil. Kirim kode baru di bawah.' },
  'idp-invalid': { tone: 'error', text: 'Verifikasi akun kampus gagal. Silakan coba lagi.' },
  'idp-cancelled': { tone: 'error', text: 'Verifikasi akun kampus dibatalkan.' },
  'idp-unknown': { tone: 'error', text: 'Kampus Anda belum terdaftar untuk verifikasi akun, coba unggah KTM.' },
  'idp-taken': { tone: 'error', text: 'Akun kampus ini sudah dipakai akun KoBo lain.' },
  'idp-unavailable': { tone: 'error', text: 'Verifikasi lewat akun kampus belum tersedia. Gunakan email kampus atau unggah KTM.' },
};

const GATE_PREFIX = 'Verifikasi status mahasiswa';
/** The server refuses application.create, visit.create and waitlist.join for an unverified student (PRECONDITION_FAILED). */
export function isStudentGateError(error: unknown): boolean {
  const e = error as ErrorLike | null;
  return e?.data?.code === 'PRECONDITION_FAILED' && typeof e.message === 'string' && e.message.startsWith(GATE_PREFIX);
}

/** tRPC codes where the server's own (always Indonesian) message is more useful than a fixed line. Zod validation errors are already collapsed to the generic text server-side (formatTrpcError). */
const SERVER_MESSAGE_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'PRECONDITION_FAILED', 'BAD_GATEWAY', 'BAD_REQUEST']);

const TRPC_FALLBACK: Record<string, string> = {
  UNAUTHORIZED: 'Silakan masuk terlebih dahulu.',
  FORBIDDEN: 'Anda tidak memiliki akses untuk tindakan ini.',
  NOT_FOUND: 'Data yang diminta tidak ditemukan.',
  CONFLICT: 'Data ini sudah ada atau bentrok dengan data lain.',
  TOO_MANY_REQUESTS: RATE_LIMIT,
  BAD_REQUEST: 'Data yang dikirim tidak valid. Periksa kembali isian Anda.',
  BAD_GATEWAY: 'Layanan pihak ketiga sedang tidak dapat dihubungi. Coba lagi nanti.',
};

const STATUS_FALLBACK: Record<number, string> = {
  400: TRPC_FALLBACK.BAD_REQUEST,
  401: TRPC_FALLBACK.UNAUTHORIZED,
  403: TRPC_FALLBACK.FORBIDDEN,
  404: TRPC_FALLBACK.NOT_FOUND,
  409: TRPC_FALLBACK.CONFLICT,
  429: RATE_LIMIT,
};

interface ErrorLike {
  name?: string;
  message?: string;
  status?: number;
  code?: string;
  data?: { code?: string; httpStatus?: number };
}

/** True for a thrown fetch failure (offline, DNS, server down) rather than an HTTP error response. */
export function isNetworkError(error: unknown): boolean {
  const e = error as ErrorLike | null;
  return !!e && typeof e.message === 'string' && /failed to fetch|networkerror|load failed|network request failed/i.test(e.message);
}

export function messageForError(error: unknown): string {
  if (error == null) return GENERIC;
  if (isNetworkError(error)) return NETWORK;
  const e = error as ErrorLike;

  // tRPC: the code lives in data.code.
  const trpcCode = e.data?.code;
  if (trpcCode) {
    if (isStudentGateError(error)) return 'Verifikasi status mahasiswa dulu';
    // Defence in depth: a raw Zod issue dump (JSON) must never reach the user even if the server formatter is bypassed.
    const rawIssues = trpcCode === 'BAD_REQUEST' && /^\s*[[{]/.test(e.message ?? '');
    if (SERVER_MESSAGE_CODES.has(trpcCode) && e.message && !rawIssues) return e.message;
    return TRPC_FALLBACK[trpcCode] ?? GENERIC;
  }

  // better-auth client: { status, code }.
  if (e.status === 429) return RATE_LIMIT;
  if (e.status === 403 && e.code === 'TOO_MANY_ATTEMPTS') return AUTH_CODES.TOO_MANY_ATTEMPTS;
  if (e.code && AUTH_CODES[e.code]) return AUTH_CODES[e.code];
  // Code verification: a bad or expired code is a bare 400, a lockout a 403.
  if (e.status === 400 && (!e.code || e.code === 'INVALID_OTP' || e.code === 'OTP_EXPIRED')) return 'Kode salah atau sudah kedaluwarsa.';
  if (e.status && STATUS_FALLBACK[e.status]) return STATUS_FALLBACK[e.status];
  return GENERIC;
}
