// One-shot cross-screen channel for "I just created a new customer visit —
// pass its id to whichever screen wakes up next." Used by VisitForm
// (producer) and UserAttendanceScreen / FieldAttendanceDetailScreen
// (consumers). Mirrors newTripChannel.js.

let pending = null;

export const setPendingNewVisit = (visitId) => {
  pending = visitId ? Number(visitId) : null;
};

export const consumePendingNewVisit = () => {
  const v = pending;
  pending = null;
  return v;
};

export const peekPendingNewVisit = () => pending;
