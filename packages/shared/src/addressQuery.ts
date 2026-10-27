// Turns an address typed the Indonesian way into geocoder queries, most specific first. Pure.
//
// OpenStreetMap rarely knows house numbers, blocks or clusters in Indonesia, and it never contains the words "Kelurahan" or
// "Kecamatan", so one long free-text query often returns nothing. We clean the noise, try the whole address, then drop the
// most specific part (the street, the cluster) until the kelurahan and kecamatan are left. A result from such a shortened
// query is an area, not the building, and the owner is told so.

export interface AddressCandidate {
  query: string
  /** `exact`: the whole cleaned address. `area`: some leading parts were dropped, so the point is a centre of the named area. */
  precision: 'exact' | 'area'
}

const ADMIN_WORD = /^(kelurahan|kel\.?|kecamatan|kec\.?|desa|kota|kabupaten|kab\.?)\s+/i
const NOISE: RegExp[] = [
  /\b(rt|rw)\.?\s*\d+(\s*\/\s*(rt|rw)?\.?\s*\d+)?/gi, // RT 02/RW 11, RT.03
  /\b(no|nomor)\.?\s*[a-z]?\d+[a-z]?\b/gi, // No. 27, Nomor 5A
  /\bblok\.?\s*[a-z0-9-]+\b/gi, // Blok FB
  /\b\d{5}\b/g, // postal code
]

/** One part of the address with admin words and numbering noise removed. */
export function cleanPart(part: string): string {
  let out = part.trim().replace(ADMIN_WORD, '')
  for (const re of NOISE) out = out.replace(re, ' ')
  return out.replace(/\s+/g, ' ').replace(/^[\s,.-]+|[\s,.-]+$/g, '')
}

export function addressCandidates(input: string, max = 4): AddressCandidate[] {
  const parts = input
    .split(/[,\n]/)
    .map(cleanPart)
    .filter((p) => p.length > 0)
  if (parts.length === 0) return []
  const out: AddressCandidate[] = []
  const seen = new Set<string>()
  const push = (query: string, precision: AddressCandidate['precision']) => {
    const key = query.toLowerCase()
    if (!query || seen.has(key) || out.length >= max) return
    seen.add(key)
    out.push({ query, precision })
  }
  push(parts.join(', '), 'exact')
  for (let i = 1; i < parts.length - 1 || (i === 1 && parts.length === 2); i++) {
    if (parts.length - i < 1) break
    push(parts.slice(i).join(', '), 'area')
    if (parts.length - i <= 2) break
  }
  return out
}
