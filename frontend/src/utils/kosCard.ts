import type { KosCard } from '../../../backend/src/trpc/router';
import { CAMPUSES } from '../data/campuses';
import type { Kos } from '../types';

const rb = (n: number) => `Rp ${Math.round(n / 1000)}rb`;

export const studentDiscountLabel = (amount: number) => (amount > 0 ? `Diskon Mhs ${rb(amount)}` : '');

/** Walking time at ~80 m/min, never below one minute. */
export const walkMinutes = (meters: number | null) => Math.max(1, Math.round((meters ?? 0) / 80));

/**
 * Adapts a server card (`kos.list` / `kos.search`) to the legacy `Kos` shape ListingCard renders.
 * Detail-only fields (rooms, rules, owner...) stay empty; Detail uses `kosDetailToKos` instead.
 */
export function kosCardToKos(c: KosCard): Kos {
  const campus = CAMPUSES.find((x) => x.id === c.nearestCampusId);
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    gender: c.gender.toLowerCase() as Kos['gender'],
    address: '',
    district: c.district,
    city: c.city,
    coordinates: { lat: c.lat, lng: c.lng },
    campusProximity: {
      campusId: c.nearestCampusId ?? '',
      campusName: campus?.shortName ?? '',
      distanceMeters: c.nearestCampusMeters ?? 0,
      walkMinutes: walkMinutes(c.nearestCampusMeters),
    },
    rating: c.rating ?? 0,
    reviewCount: c.reviewCount,
    priceMonthlyStart: c.priceMonthlyStart ?? 0,
    studentDiscountAmount: c.studentDiscountAmount,
    studentDiscountLabel: studentDiscountLabel(c.studentDiscountAmount),
    images: c.images,
    privateAmenities: [],
    sharedAmenities: [],
    electricityType: c.electricityType === 'INCLUDED' ? 'included' : 'token',
    totalRooms: c.totalRooms,
    availableRooms: c.availableRooms,
    owner: undefined as unknown as Kos['owner'],
    rules: [],
    pois: [],
    rooms: [],
  };
}
