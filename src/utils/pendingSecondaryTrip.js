// Local marker for a "pending" secondary/additional trip — a trip that's
// been created on the server (vehicle.tracking row exists) but whose
// matching customer visit hasn't been entered yet, because the user is
// still driving to the visit location and the visit's lat/lng needs to
// reflect where they actually arrive, not where they filled the form.
//
// Persisted in AsyncStorage so it survives app re-mount / force-close.
// Scoped by attendanceId so a stale marker from yesterday's attendance
// doesn't surface today.
//
// Cleared when:
//   - A trip line is created against this tripId (visit attached).
//   - User checks out for the day.
//   - Attendance id changes between mount and load.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fa:pendingSecondaryTrip';

export const setPendingSecondaryTrip = async (data) => {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[pendingSecondaryTrip] set failed:', e?.message);
  }
};

export const getPendingSecondaryTrip = async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[pendingSecondaryTrip] get failed:', e?.message);
    return null;
  }
};

export const clearPendingSecondaryTrip = async () => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[pendingSecondaryTrip] clear failed:', e?.message);
  }
};
