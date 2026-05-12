// One-shot cross-screen channel for "I just created a new trip — pass its id
// to whichever screen wakes up next." Used by VehicleTrackingForm (producer)
// and UserAttendanceScreen / FieldAttendanceDetailScreen (consumers).
//
// Module-level state survives every React Navigation mount / remount /
// unfreeze cycle, which is why this is more reliable than route.params for
// passing data back from a popped screen.

let pending = null;

export const setPendingNewTrip = (tripId) => {
  pending = tripId ? Number(tripId) : null;
};

export const consumePendingNewTrip = () => {
  const t = pending;
  pending = null;
  return t;
};

export const peekPendingNewTrip = () => pending;
