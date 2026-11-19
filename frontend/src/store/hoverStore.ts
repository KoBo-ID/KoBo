import { useSyncExternalStore } from 'react';

// Search list <-> map hover link. This lives outside React context on purpose: a hover must re-render only the
// card being hovered and the map, never the Search page or the other cards.
let hoveredId: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setHoveredKosId = (id: string | null) => {
  if (hoveredId === id) return;
  hoveredId = id;
  listeners.forEach((listener) => listener());
};

/** The hovered kos id; only for the map. Cards use useIsKosHovered so they re-render only when their own state flips. */
export const useHoveredKosId = (): string | null => useSyncExternalStore(subscribe, () => hoveredId, () => null);

export const useIsKosHovered = (id: string): boolean =>
  useSyncExternalStore(subscribe, () => hoveredId === id, () => false);
