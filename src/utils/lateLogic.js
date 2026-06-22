// Pure helper that computes whether a given check-in time is late, based
// on a cached Odoo late-config payload. Used in the offline check-in flow
// where we can't ask the server for `is_late` / `late_minutes`.
//
// Mirrors the session-detection logic in
// odoo_modules/hr_attendance_late/models/hr_attendance.py:
//   - Anything at/after office_start_hour_2 (split shift) → Session 2
//   - Otherwise → Session 1
// Late if check-in > session-start + threshold minutes.

/**
 * @param {Date} checkInDate            local Date object (employee's tz)
 * @param {object|null} lateConfig      raw cached config from
 *                                      `hr.attendance.late.config.get_config_for_employee`
 * @returns {{
 *   isLate: boolean,
 *   lateMinutes?: number,
 *   lateMinutesDisplay?: string,
 *   session?: '1'|'2',
 *   expectedStart?: number,
 * }}
 */
// Convert a float hour (e.g. 13.25) to "HH:MM" matching Odoo's display.
export const floatToHM = (h) => {
  const total = Math.round((h ?? 0) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

// Wall-clock {hour, minute} for `date` in the OFFICE timezone (e.g.
// "Asia/Muscat"), so late detection matches the Odoo server (which computes in
// the config timezone via pytz). Without this, a phone set to a different tz
// (e.g. IST) over/under-counts late minutes by the offset. Falls back to the
// device clock when no timezone is given or the runtime lacks Intl tz support.
const wallClockInTz = (date, timeZone) => {
  if (!timeZone) {
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(date);
    let hour = parseInt(parts.find((p) => p.type === 'hour')?.value, 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value, 10);
    if (hour === 24) hour = 0; // some impls render midnight as "24"
    if (Number.isNaN(hour) || Number.isNaN(minute)) {
      return { hour: date.getHours(), minute: date.getMinutes() };
    }
    return { hour, minute };
  } catch (e) {
    console.log('[late-calc] Intl tz unsupported, using device clock:', e?.message);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
};

export const computeLocalLateInfo = (checkInDate, lateConfig) => {
  if (!checkInDate || isNaN(checkInDate?.getTime?.())) return { isLate: false };

  // Hardcoded sensible defaults if no cached config exists yet (first run,
  // or user never went online before checking in offline). This guarantees
  // the popup still fires for genuinely-late check-ins instead of silently
  // skipping because of a null cache.
  const config = lateConfig || {
    shift_type: 'split',
    office_start_hour: 8.0,
    office_start_hour_2: 14.0,
    late_threshold_minutes: 15,
  };

  const session2Start = typeof config.office_start_hour_2 === 'number' ? config.office_start_hour_2 : 14.0;
  const session1Start = typeof config.office_start_hour === 'number' ? config.office_start_hour : 8.0;
  const threshold = typeof config.late_threshold_minutes === 'number' ? config.late_threshold_minutes : 15;
  const shiftType = config.shift_type ?? 'split';

  // Read the check-in wall clock in the OFFICE timezone (not the device's), so
  // this matches the server's pytz-based late computation.
  const { hour, minute } = wallClockInTz(checkInDate, config.timezone);
  const localHour = hour + minute / 60;

  const isSession2 = shiftType === 'split' && localHour >= session2Start;
  const officeStart = isSession2 ? session2Start : session1Start;

  // Compare purely in wall-clock minutes within the office tz — avoids the
  // Date arithmetic that previously mixed device-local and office time.
  const nowMin = hour * 60 + minute;
  const officeMin = Math.floor(officeStart) * 60 + Math.round((officeStart % 1) * 60);
  const allowedMin = officeMin + threshold;

  console.log('[late-calc] config session1:', session1Start, 'session2:', session2Start,
              'threshold:', threshold, 'shift:', shiftType, 'tz:', config.timezone || '(device)',
              '→ chose session', isSession2 ? '2' : '1', 'expectedStart:', officeStart,
              'checkInLocalHour:', localHour.toFixed(3));

  if (nowMin <= allowedMin) {
    return {
      isLate: false,
      session: isSession2 ? '2' : '1',
      expectedStart: officeStart,
      expectedStartDisplay: floatToHM(officeStart),
    };
  }

  const lateMinutes = nowMin - officeMin;
  const h = Math.floor(lateMinutes / 60);
  const m = lateMinutes % 60;

  return {
    isLate: true,
    lateMinutes,
    lateMinutesDisplay: `${h}:${String(m).padStart(2, '0')}`,
    session: isSession2 ? '2' : '1',
    expectedStart: officeStart,
    expectedStartDisplay: floatToHM(officeStart),
  };
};
