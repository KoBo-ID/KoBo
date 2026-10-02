import type { KosDetail } from '../../../backend/src/trpc/router';
import type { Kos, Review } from '../types';
import { kosCardToKos, walkMinutes } from './kosCard';

/** "Maret 2024" from an ISO timestamp (UTC, so the label does not depend on the viewer's timezone). */
export const formatMonthYear = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "14 Agustus 2026" */
export const formatLongDate = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

/**
 * Adapts `kos.detail` to the legacy `Kos` shape that RoomPicker, StickyBookingSidebar, PoiRadar, RulesAccordion,
 * AmenitiesSection and VisitModal still take. Owner phone/avatar may be absent on the server; they become ''.
 */
export function kosDetailToKos(d: KosDetail): Kos {
  const base = kosCardToKos(d);
  return {
    ...base,
    address: d.address,
    privateAmenities: d.privateAmenities,
    sharedAmenities: d.sharedAmenities,
    campusProximity: {
      campusId: d.nearestCampus?.id ?? '',
      campusName: d.nearestCampus?.shortName ?? '',
      distanceMeters: d.nearestCampusMeters ?? 0,
      walkMinutes: walkMinutes(d.nearestCampusMeters),
    },
    owner: {
      id: d.owner.id,
      name: d.owner.name,
      phone: d.owner.phone ?? '',
      avatar: d.owner.avatar ?? '',
      responseRate: d.owner.responseRate ?? '-',
      memberSince: formatMonthYear(d.owner.memberSince),
      verified: d.owner.verified,
      totalProperties: d.owner.totalProperties,
      bio: d.owner.bio ?? undefined,
    },
    rules: d.rules.map((r) => ({
      id: r.id,
      tier: r.tier as 1 | 2 | 3 | 4,
      categoryTitle: r.categoryTitle,
      rules: r.rules,
      penaltyAmount: r.penaltyAmount ?? undefined,
      penaltyClause: r.penaltyClause ?? undefined,
    })),
    pois: d.pois.map((p) => ({ ...p, category: p.category as Kos['pois'][number]['category'] })),
    rooms: d.rooms.map((r) => ({
      id: r.id,
      kosId: d.id,
      roomNumber: r.roomNumber,
      floor: r.floor,
      roomType: r.type,
      size: r.size,
      bedType: r.bedType,
      priceMonthly: r.priceMonthly,
      status: r.status,
    })),
  };
}

/** Server reviews in the legacy `Review` shape ReviewsSection renders. */
export function reviewsToLegacy(d: KosDetail): Review[] {
  return d.reviews.map((r) => ({
    id: r.id,
    kosId: d.id,
    authorName: r.authorName,
    authorCampus: r.authorCampus ?? 'Penyewa KoBo',
    authorAvatar: r.authorAvatar ?? '',
    ratingOverall: r.rating,
    // Per-review sub-ratings are not rendered; the section shows the kos-level means from `d.subRatings`.
    subRatings: { cleanliness: 0, wifi: 0, owner: 0, quietness: 0 },
    date: formatLongDate(r.createdAt),
    comment: r.comment,
    verifiedStudent: r.verified,
    ownerReply: r.ownerReply
      ? { text: r.ownerReply.text, date: r.ownerReply.at ? formatLongDate(r.ownerReply.at) : '' }
      : undefined,
  }));
}
