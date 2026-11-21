const ONES = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas']
const SCALES = ['', 'Ribu', 'Juta', 'Miliar']

/** 1..999 in Indonesian words, Title Case, no trailing currency. */
function below1000(n: number): string[] {
  const out: string[] = []
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h === 1) out.push('Seratus')
  else if (h > 1) out.push(ONES[h]!, 'Ratus')
  if (rest === 0) return out
  if (rest < 12) out.push(ONES[rest]!)
  else if (rest < 20) out.push(ONES[rest - 10]!, 'Belas')
  else {
    out.push(ONES[Math.floor(rest / 10)]!, 'Puluh')
    if (rest % 10) out.push(ONES[rest % 10]!)
  }
  return out
}

/** Integer rupiah 0..999,999,999,999 in Indonesian words: terbilang(1250000) is "Satu Juta Dua Ratus Lima Puluh Ribu Rupiah". */
export function terbilang(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) throw new RangeError('terbilang: integer 0..999999999999 required')
  if (n === 0) return 'Nol Rupiah'
  const words: string[] = []
  const groups = [Math.floor(n / 1_000_000_000), Math.floor(n / 1_000_000) % 1000, Math.floor(n / 1000) % 1000, n % 1000]
  groups.forEach((g, i) => {
    if (g === 0) return
    const scale = SCALES[3 - i]!
    // "Seribu", not "Satu Ribu"; "Satu Juta" and "Satu Miliar" keep Satu.
    if (scale === 'Ribu' && g === 1) words.push('Seribu')
    else words.push(...below1000(g), ...(scale ? [scale] : []))
  })
  return `${words.join(' ')} Rupiah`
}
