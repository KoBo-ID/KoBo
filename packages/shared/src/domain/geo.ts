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

/**
 * Pulls a point out of what an owner pastes: "-6.2008, 106.7861", a Google Maps link containing `@lat,lng`, `!3dLAT!4dLNG`
 * or `q=lat,lng`. Short links (maps.app.goo.gl) carry no coordinates and are not resolved here. Returns null when nothing
 * plausible is found (latitude -11..6, longitude 95..141 covers Indonesia, which also rejects swapped values).
 */
export const parseCoordinates = (text: string): LatLng | null => {
  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`@${num},\s*${num}`),
    new RegExp(String.raw`!3d${num}!4d${num}`),
    new RegExp(String.raw`[?&](?:q|ll|query|center)=${num}(?:,|%2C)\s*${num}`),
    new RegExp(String.raw`^\s*${num}\s*[,;\s]\s*${num}\s*$`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (lat >= -11 && lat <= 6 && lng >= 95 && lng <= 141) return { lat, lng };
  }
  return null;
};
