// Format times/dates in the OFFICE-configured timezone (from the Odoo late
// config, e.g. "Asia/Muscat") — NOT the device timezone, and NOT raw UTC.
//
// The office tz is cached at module scope so these formatters stay SYNCHRONOUS
// (the UI calls them directly). It is set whenever the late config loads
// (`AttendanceService.getLateConfig` / `getCachedLateConfig` call
// `setOfficeTimezone(config.timezone)`), which the attendance screens do on
// mount — so the tz is available before any time renders.
//
// Every formatter falls back to the device-local rendering when the office tz
// is unknown or `Intl` lacks timeZone support, so nothing regresses.

import AsyncStorage from '@react-native-async-storage/async-storage';

const OFFICE_TZ_KEY = '@cache:officeTimezone';

let _officeTz = null;

export const setOfficeTimezone = (tz) => {
  if (tz && typeof tz === 'string') {
    if (_officeTz !== tz) console.log('[office-tz] setOfficeTimezone:', _officeTz, '->', tz);
    _officeTz = tz;
    // Persist so forms opened without loading the late config can still hydrate.
    AsyncStorage.setItem(OFFICE_TZ_KEY, tz).catch(() => { /* ignore */ });
  }
};

export const getOfficeTimezone = () => _officeTz;

// Seed the in-memory office tz from cache when it hasn't been set this session
// (e.g. VehicleTracking / Visit opened directly, before attendance loaded).
export const hydrateOfficeTimezone = async () => {
  if (_officeTz) return _officeTz;
  try {
    const tz = await AsyncStorage.getItem(OFFICE_TZ_KEY);
    if (tz && !_officeTz) _officeTz = tz;
    console.log('[office-tz] hydrate from cache:', tz, '| active now:', _officeTz);
  } catch { /* ignore */ }
  return _officeTz;
};

// Coerce a JS Date OR an Odoo UTC datetime string ("YYYY-MM-DD HH:MM:SS",
// implicitly UTC) into a Date. Returns null on bad/empty input.
const toDate = (input) => {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  const hasTz = /[zZ]$|[+-]\d\d:?\d\d$/.test(s);
  s = s.replace(' ', 'T');
  const d = new Date(hasTz ? s : `${s}Z`);
  return isNaN(d.getTime()) ? null : d;
};

// "hh:mm AM/PM" in the office timezone.
export const formatTimeOffice = (input, { withSeconds = false, hour12 = true } = {}) => {
  const d = toDate(input);
  if (!d) return '';
  // Office tz not known yet: show nothing rather than the DEVICE time — the
  // value fills in (office time) once the tz hydrates and the screen re-renders.
  if (!_officeTz) return '';
  const opts = { hour: '2-digit', minute: '2-digit', hour12, timeZone: _officeTz };
  if (withSeconds) opts.second = '2-digit';
  try {
    return new Intl.DateTimeFormat('en-US', opts).format(d);
  } catch (e) {
    // Last resort: Intl can't honour this tz on this device — better some time than none.
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12 });
  }
};

// Short date (default day-first "01 Jan 2026") in the office timezone. Uses
// 'en-GB' so the output is day-first (callers that split on spaces rely on
// "DD MMM yyyy" ordering).
export const formatDateOffice = (input, opts = { day: '2-digit', month: 'short', year: 'numeric' }) => {
  const d = toDate(input);
  if (!d) return '';
  // Office tz not known yet: show nothing rather than the device-tz calendar day.
  if (!_officeTz) return '';
  try {
    const o = { ...opts, timeZone: _officeTz };
    return new Intl.DateTimeFormat('en-GB', o).format(d);
  } catch (e) {
    return d.toLocaleDateString('en-GB', opts);
  }
};

// Date + time ("01 Jan 2026, 09:13" 24h by default) in the office timezone.
export const formatDateTimeOffice = (input, opts = {}) => {
  const d = toDate(input);
  if (!d) return '';
  const base = {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    ...opts,
  };
  // Office tz not known yet: show nothing rather than the device timezone.
  if (!_officeTz) return '';
  try {
    const o = { ...base, timeZone: _officeTz };
    return new Intl.DateTimeFormat('en-GB', o).format(d);
  } catch (e) {
    return d.toLocaleString('en-GB', base);
  }
};
