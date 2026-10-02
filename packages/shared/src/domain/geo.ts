export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_METERS = 6371000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const haversineMeters = (a: LatLng, b: LatLng): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h)));
};

export const formatDistance = (meters: number): string => {
  if (meters < 1000) return `${Math.max(meters, 0)} m`;
  const km = meters / 1000;
  return `${km.toFixed(km >= 10 ? 0 : 1).replace('.', ',')} km`;
};

export const averageLatLng = (points: LatLng[]): LatLng | null => {
  if (points.length === 0) return null;
  const total = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 }
  );
  return { lat: total.lat / points.length, lng: total.lng / points.length };
};
