/**
 * Geolocation utilities — Haversine distance & geofence check.
 */

const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine distance between two lat/lng points, in meters. */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeofenceResult {
  isInside: boolean;
  distanceMeters: number;
}

/** Check if a point is within a store's geofence radius. */
export function checkGeofence(
  userLat: number, userLng: number,
  storeLat: number, storeLng: number,
  radiusMeters: number,
): GeofenceResult {
  const distanceMeters = Math.round(haversineMeters(userLat, userLng, storeLat, storeLng));
  return {
    isInside: distanceMeters <= radiusMeters,
    distanceMeters,
  };
}
