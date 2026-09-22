export type KosGender = 'campur' | 'putra' | 'putri';

export type RoomStatus = 'paid' | 'due' | 'overdue' | 'vacant' | 'booking';

export interface Room {
  id: string;
  kosId: string;
  roomNumber: string;
  floor: number;
  roomType: string;
  size: string; // e.g. "3 x 4 m"
  bedType: string; // e.g. "Single Bed (120x200)"
  priceMonthly: number;
  status: RoomStatus;
  tenantName?: string;
  tenantPhone?: string;
  tenantCampus?: string;
  dueDate?: string; // ISO date or "YYYY-MM-DD"
  daysOverdue?: number;
  lastPaymentDate?: string;
  activeBookingRef?: string;
}

export type PoiCategory = 'campus' | 'food' | 'laundry' | 'print' | 'market' | 'health';

export interface Poi {
  id: string;
  category: PoiCategory;
  name: string;
  distanceMeters: number;
  walkMinutes: number;
  description: string;
}

export interface HouseRule {
  id: string;
  tier: 1 | 2 | 3 | 4;
  categoryTitle: string;
  rules: string[];
  penaltyAmount?: number;
  penaltyClause?: string;
}

export interface ReviewSubRatings {
  cleanliness: number;
  wifi: number;
  owner: number;
  quietness: number;
}

export interface Review {
  id: string;
  kosId: string;
  authorName: string;
  authorCampus: string;
  authorAvatar: string;
  ratingOverall: number;
  subRatings: ReviewSubRatings;
  date: string;
  comment: string;
  verifiedStudent: boolean;
  ownerReply?: {
    text: string;
    date: string;
  };
}

export interface CampusProximity {
  campusId: string;
  campusName: string;
  distanceMeters: number;
  walkMinutes: number;
}

export interface OwnerInfo {
  id: string;
  name: string;
  phone: string;
  avatar: string;
  responseRate: string;
  memberSince: string;
  verified: boolean;
  totalProperties: number;
  bio?: string;
}

export interface Kos {
  id: string;
  name: string;
  slug: string;
  gender: KosGender;
  address: string;
  district: string;
  city: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  campusProximity: CampusProximity;
  rating: number;
  reviewCount: number;
  priceMonthlyStart: number;
  studentDiscountAmount: number;
  studentDiscountLabel: string;
  images: string[];
  privateAmenities: string[];
  sharedAmenities: string[];
  electricityType: 'included' | 'token';
  totalRooms: number;
  availableRooms: number;
  owner: OwnerInfo;
  rules: HouseRule[];
  pois: Poi[];
  rooms: Room[];
}

export interface Campus {
  id: string;
  name: string;
  shortName: string;
  city: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  suggestedDistricts: string[];
}

export type LocationSource = 'preset' | 'geolocation' | 'kos';

export interface LocationPin {
  id: string;
  label: string;
  area: string;
  city: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  source: LocationSource;
  aliases?: string[];
}

export interface VisitBooking {
  id: string;
  kosId: string;
  kosName: string;
  studentName: string;
  studentPhone: string;
  studentCampus: string;
  date: string;
  timeSlot: 'pagi' | 'siang'; // 'pagi' = 09.00 - 12.00, 'siang' = 13.00 - 17.00
  notes?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  createdAt: string;
}

export interface RentalBooking {
  id: string;
  kosId: string;
  kosName: string;
  kosImage: string;
  kosAddress: string;
  roomId: string;
  roomNumber: string;
  studentName: string;
  studentPhone: string;
  studentCampus: string;
  ktmVerified: boolean;
  monthlyRent: number;
  applicationFee: number;
  studentDiscount: number;
  totalPaid: number;
  paymentMethod: 'bca_va' | 'mandiri_va' | 'bri_va' | 'qris';
  paymentStatus: 'paid' | 'pending';
  leaseStartDate: string;
  leaseDurationMonths: number;
  nextDueDate: string;
  digitalReceiptNumber: string;
  createdAt: string;
  ownerName: string;
  ownerPhone: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'student' | 'owner';
  campus?: string;
  avatar: string;
  ktmVerified: boolean;
  savedKosIds: string[];
}
