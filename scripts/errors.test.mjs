import { test } from 'node:test'
import assert from 'node:assert/strict'
import { messageForError } from '../frontend/src/lib/errors.ts'

const trpc = (code, message = '') => Object.assign(new Error(message), { data: { code } })

test('maps tRPC codes to Indonesian', () => {
  assert.match(messageForError(trpc('UNAUTHORIZED')), /masuk/i)
  assert.equal(messageForError(trpc('FORBIDDEN', 'Akun demo bersifat hanya-baca.')), 'Akun demo bersifat hanya-baca.')
  assert.match(messageForError(trpc('NOT_FOUND')), /tidak ditemukan/)
  assert.match(messageForError(trpc('TOO_MANY_REQUESTS')), /Terlalu banyak/)
  assert.match(messageForError(trpc('BAD_REQUEST', 'zod internals')), /tidak valid/)
  assert.doesNotMatch(messageForError(trpc('BAD_REQUEST', 'zod internals')), /zod/)
  assert.match(messageForError(trpc('INTERNAL_SERVER_ERROR', 'boom')), /Terjadi kesalahan/)
})

test('maps better-auth errors, rate limits and network failures', () => {
  assert.equal(messageForError({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' }), 'Email atau kata sandi salah.')
  assert.match(messageForError({ status: 403, code: 'EMAIL_NOT_VERIFIED' }), /belum diverifikasi/)
  assert.match(messageForError({ status: 429 }), /Terlalu banyak/)
  assert.match(messageForError({ status: 400, code: 'INVALID_CAMPUS_EMAIL' }), /\.ac\.id/)
  assert.match(messageForError(new TypeError('Failed to fetch')), /terhubung/)
  assert.match(messageForError({ status: 500 }), /Terjadi kesalahan/)
})
