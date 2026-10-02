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
  EMAIL_NOT_VERIFIED: 'Email Anda belum diverifikasi. Buka tautan di email pendaftaran, atau kirim ulang tautannya.',
  INVALID_EMAIL: 'Format email tidak valid.',
  PASSWORD_TOO_SHORT: 'Kata sandi minimal 8 karakter.',
  PASSWORD_TOO_LONG: 'Kata sandi terlalu panjang.',
  USER_ALREADY_EXISTS: 'Email ini sudah terdaftar. Silakan masuk.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'Email ini sudah terdaftar. Silakan masuk.',
  INVALID_TOKEN: 'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.',
  TOKEN_EXPIRED: 'Tautan sudah kedaluwarsa. Minta tautan baru.',
  INVALID_CAMPUS_EMAIL: 'Gunakan email kampus yang berakhiran .ac.id.',
  CAMPUS_EMAIL_TAKEN: 'Email kampus ini sudah dipakai akun lain.',
  DEMO_ACCOUNT_READONLY: 'Akun demo bersifat hanya-baca. Buat akun sendiri untuk mengubah data ini.',
};

/** tRPC codes where the server's own (always Indonesian) message is more useful than a fixed line. */
const SERVER_MESSAGE_CODES = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT']);

const TRPC_FALLBACK: Record<string, string> = {
  UNAUTHORIZED: 'Silakan masuk terlebih dahulu.',
  FORBIDDEN: 'Anda tidak memiliki akses untuk tindakan ini.',
  NOT_FOUND: 'Data yang diminta tidak ditemukan.',
  CONFLICT: 'Data ini sudah ada atau bentrok dengan data lain.',
  TOO_MANY_REQUESTS: RATE_LIMIT,
  BAD_REQUEST: 'Data yang dikirim tidak valid. Periksa kembali isian Anda.',
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
    if (SERVER_MESSAGE_CODES.has(trpcCode) && e.message) return e.message;
    return TRPC_FALLBACK[trpcCode] ?? GENERIC;
  }

  // better-auth client: { status, code }.
  if (e.status === 429) return RATE_LIMIT;
  if (e.code && AUTH_CODES[e.code]) return AUTH_CODES[e.code];
  if (e.status && STATUS_FALLBACK[e.status]) return STATUS_FALLBACK[e.status];
  return GENERIC;
}
