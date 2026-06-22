// Shared GPS-verification helpers used to confirm the driver is physically at a
// location (e.g. the trip destination) within a radius — not an exact match.
import * as Location from 'expo-location';

// Default radius for "are you at the destination?" checks.
export const DEST_VERIFY_RADIUS_M = 150;

// Haversine distance in metres between two lat/long points.
export const distanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // earth radius (m)
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Get an ACCURATE current GPS fix for verification. We prioritise a FRESH
// high-accuracy live reading (better than a possibly-low-accuracy cached one),
// then keep the most precise candidate. Ladder:
//   foreground permission →
//   live HIGH accuracy (15s) → live Balanced (8s) → fresh cache (≤30s) →
//   any-age cache (`stale`).
// Among the live + cached candidates we keep the one with the SMALLEST accuracy
// radius. Returns { latitude, longitude, accuracy, source } where source ∈
// 'live' | 'cached' | 'stale' | 'unavailable' | 'denied'. Callers treat
// 'stale'/'unavailable'/'denied' as "could not verify".
export const getCurrentFix = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { latitude: null, longitude: null, accuracy: 0, source: 'denied' };
    }

    const candidates = [];
    const withTimeout = (p, ms) => Promise.race([
      p, new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout')), ms)),
    ]);

    // 1) Fresh HIGH-accuracy live fetch (the precise one). 15s — GPS can be slow
    //    to lock to high accuracy, especially on the first read.
    try {
      const live = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
          mayShowUserSettingsDialog: true,
        }), 15000);
      if (live?.coords) candidates.push({ ...live.coords, source: 'live' });
    } catch (_) { /* fall through */ }

    // 2) Balanced live fetch (8s) — only if High didn't return.
    if (!candidates.some((c) => c.source === 'live')) {
      try {
        const live = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 8000);
        if (live?.coords) candidates.push({ ...live.coords, source: 'live' });
      } catch (_) { /* fall through */ }
    }

    // 3) Fresh cached fix (≤30s) — usable when live didn't return.
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 30_000 });
      if (last?.coords) candidates.push({ ...last.coords, source: 'cached' });
    } catch (_) { /* ignore */ }

    // 4) Any-age cache — last resort, unreliable for verify.
    if (!candidates.length) {
      try {
        const any = await Location.getLastKnownPositionAsync({});
        if (any?.coords) candidates.push({ ...any.coords, source: 'stale' });
      } catch (_) { /* ignore */ }
    }

    if (!candidates.length) {
      return { latitude: null, longitude: null, accuracy: 0, source: 'unavailable' };
    }

    // Prefer a LIVE fix; among the eligible pool keep the most precise (smallest
    // accuracy radius) so verification uses the best reading available.
    const live = candidates.filter((c) => c.source === 'live');
    const pool = live.length ? live : candidates;
    pool.sort((a, b) => (a.accuracy ?? 99999) - (b.accuracy ?? 99999));
    const best = pool[0];
    return {
      latitude: best.latitude,
      longitude: best.longitude,
      accuracy: best.accuracy ?? 0,
      source: best.source,
    };
  } catch (e) {
    return { latitude: null, longitude: null, accuracy: 0, source: 'unavailable' };
  }
};

// Verify a current fix against a target within `radiusM`. Returns one of:
//  { status:'verified', distance }  — within radius
//  { status:'too_far', distance }   — measured, outside radius
//  { status:'unavailable' }         — GPS denied / stale / no fix
//  { status:'no_coords' }           — target has no coordinates
export const verifyWithinRadius = async (targetCoords, radiusM = DEST_VERIFY_RADIUS_M) => {
  const tLat = Number(targetCoords?.latitude);
  const tLng = Number(targetCoords?.longitude);
  if (!Number.isFinite(tLat) || !Number.isFinite(tLng)) {
    return { status: 'no_coords' };
  }
  const fix = await getCurrentFix();
  if (fix.source === 'denied' || fix.source === 'stale' || fix.source === 'unavailable') {
    return { status: 'unavailable', source: fix.source };
  }
  const raw = distanceMeters(fix.latitude, fix.longitude, tLat, tLng);
  const effective = Math.max(0, raw - (fix.accuracy || 0));
  return {
    status: effective <= radiusM ? 'verified' : 'too_far',
    distance: effective,
    accuracy: fix.accuracy || 0,
  };
};
