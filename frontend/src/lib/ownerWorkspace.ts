import { useOutletContext } from 'react-router-dom';
import type { OwnerKos } from '../../../backend/src/trpc/router';

/** What OwnerLayout hands to every owner page through the router's outlet context. */
export interface OwnerWorkspace {
  kosList: OwnerKos[];
  /** The kos picked in the sidebar (URL `?kos=`), or the first one; null when the owner has none yet. */
  selectedKos: OwnerKos | null;
  selectKos: (id: string) => void;
}

export const useOwnerWorkspace = () => useOutletContext<OwnerWorkspace>();

/** Resolves the selected kos from the `?kos=` value, falling back to the first. */
export function pickKos(kosList: OwnerKos[], id: string | null): OwnerKos | null {
  return kosList.find((k) => k.id === id) ?? kosList[0] ?? null;
}

export const formatRupiah = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);

/** 'YYYY-MM-DD' (a WIB calendar day) as "5 Okt". */
export const formatDueDate = (value?: string | null): string => {
  if (!value) return '-';
  const d = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
};
