/** Rupiah with the id-ID grouping and no decimals, e.g. "Rp 1.250.000". The one formatter the whole app uses. */
export const formatRupiah = (value: number): string =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
