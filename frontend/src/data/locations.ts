import { LocationPin } from '../types';

export const PRESET_LOCATIONS: LocationPin[] = [
  {
    id: 'loc-kemanggisan',
    label: 'Kemanggisan',
    area: 'Kemanggisan',
    city: 'Jakarta Barat',
    coordinates: { lat: -6.1993, lng: 106.7878 },
    source: 'preset',
    aliases: ['kemanggisan', 'syahdan', 'binus syahdan', 'jakarta barat', 'binus'],
  },
  {
    id: 'loc-kebon-jeruk',
    label: 'Kebon Jeruk',
    area: 'Kebon Jeruk',
    city: 'Jakarta Barat',
    coordinates: { lat: -6.1942, lng: 106.7834 },
    source: 'preset',
    aliases: ['kebon jeruk', 'anggrek', 'binus anggrek', 'sukabumi utara'],
  },
  {
    id: 'loc-palmerah',
    label: 'Palmerah',
    area: 'Palmerah',
    city: 'Jakarta Barat',
    coordinates: { lat: -6.2087, lng: 106.7872 },
    source: 'preset',
    aliases: ['palmerah', 'kijang', 'binus kijang', 'kemanggisan ilir'],
  },
  {
    id: 'loc-pondok-cina',
    label: 'Pondok Cina',
    area: 'Pondok Cina',
    city: 'Depok',
    coordinates: { lat: -6.3641, lng: 106.8292 },
    source: 'preset',
    aliases: ['pondok cina', 'pocin', 'depok', 'margonda', 'ui', 'universitas indonesia'],
  },
  {
    id: 'loc-dago',
    label: 'Dago',
    area: 'Dago',
    city: 'Bandung',
    coordinates: { lat: -6.8908, lng: 107.6127 },
    source: 'preset',
    aliases: ['dago', 'bandung', 'itb', 'coblong', 'gelap nyawang', 'dipatiukur'],
  },
];

export const findPresetLocation = (query: string): LocationPin | undefined => {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  return PRESET_LOCATIONS.find(
    (loc) =>
      loc.label.toLowerCase() === q ||
      loc.city.toLowerCase() === q ||
      loc.aliases?.some((alias) => alias === q) ||
      loc.aliases?.some((alias) => q.includes(alias)) ||
      `${loc.label}, ${loc.city}`.toLowerCase() === q
  );
};

export const matchPresetLocations = (query: string): LocationPin[] => {
  const q = query.trim().toLowerCase();
  if (!q) return PRESET_LOCATIONS;
  return PRESET_LOCATIONS.filter(
    (loc) =>
      loc.label.toLowerCase().includes(q) ||
      loc.city.toLowerCase().includes(q) ||
      loc.aliases?.some((alias) => alias.includes(q))
  );
};
