// src/services/AttendanceService.js
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as Location from 'expo-location';
import ODOO_BASE_URL from '@api/config/odooConfig';
import offlineQueue from '@utils/offlineQueue';
import { isOnline } from '@utils/networkStatus';
import { computeLocalLateInfo } from '@utils/lateLogic';
import { setOfficeTimezone, formatTimeOffice } from '@utils/officeTime';

// =============================================================================
// Tiny attendance cache (for offline-tolerant reads).
//
// On every successful network read of an employee / workplace, we mirror the
// result into AsyncStorage. When the network call fails (or the device is
// offline), we fall back to whatever was last cached so the user can still
// punch attendance.
//
// Cache keys:
//   @attCache:dev:<deviceId>     -> employee object
//   @attCache:pin:<badgeId>      -> employee object
//   @attCache:wp:<userId>        -> workplace location object
// =============================================================================
const _cacheKey = (kind, id) => `@attCache:${kind}:${id}`;

const cachePut = async (kind, id, value) => {
  try {
    await AsyncStorage.setItem(_cacheKey(kind, id), JSON.stringify(value));
  } catch (e) {
    console.warn('[AttCache] put failed:', e?.message);
  }
};

const cacheGet = async (kind, id) => {
  try {
    const raw = await AsyncStorage.getItem(_cacheKey(kind, id));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[AttCache] get failed:', e?.message);
    return null;
  }
};

// "Network-like" error detector — same as in checkInByEmployeeId. Inlined as
// a closure here so it stays defined regardless of where this file is loaded.
const _isNetworkLikeErr = (error) => {
  if (!error) return false;
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') return true;
  if (error.message && /Network Error|timeout/i.test(error.message)) return true;
  if (!error.response) return true;
  return false;
};

// Distance threshold in meters for attendance location verification
const ATTENDANCE_LOCATION_THRESHOLD = 100; // 100 meters

// Get Odoo auth headers
const getOdooAuthHeaders = async () => {
  const cookie = await AsyncStorage.getItem('odoo_cookie');
  return {
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
};

// Format date for Odoo (YYYY-MM-DD HH:MM:SS) - Odoo expects UTC
const formatDateForOdoo = (date) => {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  const seconds = String(d.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// Convert an Odoo UTC datetime string to a HH:MM AM/PM display in the OFFICE
// timezone (e.g. Asia/Muscat), not the device timezone. Falls back to device
// time when the office tz isn't known yet.
const odooUtcToLocalDisplay = (utcString) => {
  if (!utcString) return null;
  return formatTimeOffice(utcString);
};

// Get today's date string (YYYY-MM-DD)
const getTodayDateString = () => {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Haversine formula to calculate distance in meters between two coordinates
const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Cache the permission check across the session so repeat check-ins don't
// pay the permission round-trip.
let _permissionGranted = null;

const _ensureLocationPermission = async () => {
  if (_permissionGranted === true) return true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    _permissionGranted = status === 'granted';
    return _permissionGranted;
  } catch (e) {
    _permissionGranted = false;
    return false;
  }
};

// Fire-and-forget: warm the OS GPS cache so the next call hits fast.
const _warmGpsCache = () => {
  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .catch(() => { /* ignore */ });
};

// Get current device location — fast path: cached fix first (returns in ms),
// then quick Balanced live fetch, then High-accuracy if needed. Designed to
// return in <1s in the typical case while still working indoors.
export const getCurrentLocation = async () => {
  const granted = await _ensureLocationPermission();
  if (!granted) {
    return { success: false, error: 'Location permission denied' };
  }

  // 1) FAST PATH: any reasonably recent cached fix (≤120s). Returns in ~10ms.
  // Widened from 60s → 120s so users tapping check-in within 2 minutes never
  // pay a network/GPS round-trip.
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    if (last?.coords) {
      console.log('[Location] CACHED fix accuracy:', last.coords.accuracy, 'm');
      // Kick off a background refresh so the next call has a fresher cache.
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .catch(() => { /* ignore */ });
      return {
        success: true,
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
        accuracy: last.coords.accuracy ?? 9999,
        fromCache: true,
      };
    }
  } catch (_) { /* fall through */ }

  // 2) Quick Balanced live fetch — 3s timeout, cell + Wi-Fi triangulation.
  try {
    const live = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout')), 3000)),
    ]);
    if (live?.coords) {
      console.log('[Location] LIVE-BALANCED fix accuracy:', live.coords.accuracy, 'm');
      return {
        success: true,
        latitude: live.coords.latitude,
        longitude: live.coords.longitude,
        accuracy: live.coords.accuracy ?? 9999,
        fromCache: false,
      };
    }
  } catch (err) {
    console.log('[Location] live BALANCED fetch failed:', err?.message);
  }

  // 3) Any-age cache, last resort.
  try {
    const anyLast = await Location.getLastKnownPositionAsync({});
    if (anyLast?.coords) {
      console.log('[Location] STALE cache fix accuracy:', anyLast.coords.accuracy, 'm');
      return {
        success: true,
        latitude: anyLast.coords.latitude,
        longitude: anyLast.coords.longitude,
        accuracy: anyLast.coords.accuracy ?? 9999,
        fromCache: true,
        stale: true,
      };
    }
  } catch (_) { /* ignore */ }

  return {
    success: false,
    error: 'Could not get GPS fix. Enable Location and ensure you have signal.',
  };
};

// Exposed so the screen can pre-warm caches on mount / verification.
export const prewarmLocation = () => {
  _ensureLocationPermission().then((ok) => { if (ok) _warmGpsCache(); });
};

// Network fetch for workplace location — always hits Odoo. 4s timeout per call.
const _fetchWorkplaceLocationFromOdoo = async (userId) => {
  const _ok = (val) => { cachePut('wp', userId, val); return val; };
  const headers = await getOdooAuthHeaders();
  const reqCfg = { headers, timeout: 4000 };

  const employeeResponse = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        model: 'hr.employee',
        method: 'search_read',
        args: [[['user_id', '=', userId]]],
        kwargs: {
          fields: ['id', 'name', 'work_location_id', 'company_id'],
          limit: 1,
        },
      },
    },
    reqCfg
  );

  const employee = employeeResponse.data?.result?.[0];
  if (!employee) {
    return { success: false, error: 'No employee record found' };
  }

  if (employee.work_location_id) {
    const workLocationResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.work.location',
          method: 'search_read',
          args: [[['id', '=', employee.work_location_id[0]]]],
          kwargs: {
            fields: ['id', 'name', 'address_id'],
            limit: 1,
          },
        },
      },
      reqCfg
    );

    const workLocation = workLocationResponse.data?.result?.[0];
    if (workLocation?.address_id) {
      const partnerResponse = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'res.partner',
            method: 'search_read',
            args: [[['id', '=', workLocation.address_id[0]]]],
            kwargs: {
              fields: ['id', 'name', 'partner_latitude', 'partner_longitude'],
              limit: 1,
            },
          },
        },
        reqCfg
      );

      const partner = partnerResponse.data?.result?.[0];
      if (partner?.partner_latitude && partner?.partner_longitude) {
        return _ok({
          success: true,
          latitude: partner.partner_latitude,
          longitude: partner.partner_longitude,
          locationName: workLocation.name || partner.name,
        });
      }
    }
  }

  if (employee.company_id) {
    const companyResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.company',
          method: 'search_read',
          args: [[['id', '=', employee.company_id[0]]]],
          kwargs: {
            fields: ['id', 'name', 'partner_id'],
            limit: 1,
          },
        },
      },
      reqCfg
    );

    const company = companyResponse.data?.result?.[0];
    if (company?.partner_id) {
      const partnerResponse = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'res.partner',
            method: 'search_read',
            args: [[['id', '=', company.partner_id[0]]]],
            kwargs: {
              fields: ['id', 'name', 'partner_latitude', 'partner_longitude'],
              limit: 1,
            },
          },
        },
        reqCfg
      );

      const partner = partnerResponse.data?.result?.[0];
      if (partner?.partner_latitude && partner?.partner_longitude) {
        return _ok({
          success: true,
          latitude: partner.partner_latitude,
          longitude: partner.partner_longitude,
          locationName: company.name,
        });
      }
    }
  }

  return {
    success: false,
    error: 'No workplace coordinates configured. Please contact admin.',
  };
};

// Get workplace location — stale-while-revalidate. Returns cached value
// instantly if present, triggers a background refresh for next time.
export const getWorkplaceLocation = async (userId) => {
  console.log('[Attendance] Getting workplace location for user:', userId);

  const cached = await cacheGet('wp', userId);

  if (cached?.success) {
    // Kick a background refresh so the next check-in has fresh coords.
    _fetchWorkplaceLocationFromOdoo(userId).catch((e) => {
      console.log('[Attendance] Background workplace refresh failed:', e?.message);
    });
    return { ...cached, fromCache: true };
  }

  try {
    return await _fetchWorkplaceLocationFromOdoo(userId);
  } catch (error) {
    console.error('[Attendance] Error getting workplace location:', error?.message);
    if (_isNetworkLikeErr(error)) {
      const fallback = await cacheGet('wp', userId);
      if (fallback) {
        console.log('[Attendance] Using cached workplace for user:', userId);
        return { ...fallback, fromCache: true };
      }
    }
    return { success: false, error: 'Failed to get workplace location' };
  }
};

// Verify if user is within workplace location
export const verifyAttendanceLocation = async (userId) => {
  const t0 = Date.now();
  console.log('[Attendance] Verifying attendance location for user:', userId);

  try {
    // Run GPS fetch and workplace lookup in parallel — they don't depend on
    // each other, so the total wait is max(gps, workplace) not gps + workplace.
    const [currentLocation, workplaceLocation] = await Promise.all([
      getCurrentLocation(),
      getWorkplaceLocation(userId),
    ]);

    if (!currentLocation.success) {
      return {
        success: false,
        error: currentLocation.error,
        withinRange: false,
      };
    }

    if (!workplaceLocation.success) {
      return {
        success: false,
        error: workplaceLocation.error,
        withinRange: false,
      };
    }

    // Calculate distance
    const distance = getDistanceMeters(
      currentLocation.latitude,
      currentLocation.longitude,
      workplaceLocation.latitude,
      workplaceLocation.longitude
    );

    // GPS accuracy is the radius of uncertainty. A reading 110m from the office
    // with ±30m accuracy could really be 80m away → inside the 100m geofence.
    // Subtract uncertainty for a forgiving check; otherwise indoor GPS (high
    // accuracy values) gives constant false-negatives even at the office.
    const accuracy = currentLocation.accuracy ?? 0;
    const effectiveDistance = Math.max(0, distance - accuracy);
    const withinRange = effectiveDistance <= ATTENDANCE_LOCATION_THRESHOLD;

    console.log('[Attendance] Workplace:', workplaceLocation.latitude, workplaceLocation.longitude,
                'name:', workplaceLocation.locationName);
    console.log('[Attendance] User:', currentLocation.latitude, currentLocation.longitude,
                'accuracy:', accuracy, 'm');
    console.log('[Attendance] Raw distance:', Math.round(distance),
                'm, effective:', Math.round(effectiveDistance),
                'm, threshold:', ATTENDANCE_LOCATION_THRESHOLD, 'm, withinRange:', withinRange,
                '— total verify took', (Date.now() - t0), 'ms');

    return {
      success: true,
      withinRange,
      distance: Math.round(effectiveDistance),
      rawDistance: Math.round(distance),
      accuracy: Math.round(accuracy),
      threshold: ATTENDANCE_LOCATION_THRESHOLD,
      workplaceName: workplaceLocation.locationName,
      currentLocation: {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
      },
      workplaceLocation: {
        latitude: workplaceLocation.latitude,
        longitude: workplaceLocation.longitude,
      },
    };
  } catch (error) {
    console.error('[Attendance] Location verification error:', error?.message);
    return {
      success: false,
      error: error?.message || 'Location verification failed',
      withinRange: false,
    };
  }
};

// Get employee ID from user ID
export const getEmployeeIdFromUserId = async (userId) => {
  console.log('[Attendance] Getting employee ID for user:', userId);

  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.employee',
          method: 'search_read',
          args: [[['user_id', '=', userId]]],
          kwargs: {
            fields: ['id', 'name', 'pin'],
            limit: 1,
          },
        },
      },
      { headers }
    );

    const employees = response.data?.result || [];
    if (employees.length > 0) {
      console.log('[Attendance] Found employee:', employees[0]);
      return employees[0];
    }

    console.log('[Attendance] No employee found for user:', userId);
    return null;
  } catch (error) {
    console.error('[Attendance] Error getting employee:', error?.message);
    return null;
  }
};

// Debug: List all employees with their badge/pin fields
export const debugListAllEmployees = async () => {
  console.log('[Attendance] === DEBUG: Listing all employees ===');
  console.log('[Attendance] Using Odoo URL:', ODOO_BASE_URL);

  try {
    const headers = await getOdooAuthHeaders();
    console.log('[Attendance] Auth headers:', JSON.stringify(headers, null, 2));

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.employee',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name', 'pin', 'barcode', 'identification_id'],
            limit: 20,
          },
        },
      },
      { headers }
    );

    console.log('[Attendance] Full response:', JSON.stringify(response.data, null, 2));

    const employees = response.data?.result || [];
    console.log('[Attendance] Total employees found:', employees.length);
    employees.forEach((emp, idx) => {
      console.log(`[Attendance] Employee ${idx + 1}:`, JSON.stringify(emp, null, 2));
    });

    // Check if there's an error in the response
    if (response.data?.error) {
      console.error('[Attendance] Odoo Error:', JSON.stringify(response.data.error, null, 2));
    }

    return employees;
  } catch (error) {
    console.error('[Attendance] Debug list error:', error?.message);
    if (error.response) {
      console.error('[Attendance] Error response:', JSON.stringify(error.response.data, null, 2));
    }
    return [];
  }
};

// Find employee by device ID (custom field x_device_id on hr.employee)
export const getEmployeeByDeviceId = async (deviceId, deviceName = null) => {
  console.log('[Attendance] Finding employee by device ID:', deviceId);

  try {
    const headers = await getOdooAuthHeaders();

    // Fetch all employees that have registered devices.
    // Also fetch pin + barcode so we can prime the offline PIN cache below.
    const empResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.employee',
          method: 'search_read',
          args: [[['device_ids', '!=', false]]],
          kwargs: {
            fields: ['id', 'name', 'user_id', 'device_ids', 'pin', 'barcode'],
          },
        },
      },
      { headers }
    );

    const employees = empResponse.data?.result || [];
    console.log('[Attendance] Employees with devices:', employees.length);

    if (employees.length === 0) {
      return { success: false, error: 'No employees with registered devices found' };
    }

    // Collect all device IDs to fetch in one call
    const allDeviceIds = employees.flatMap((e) => e.device_ids || []);
    if (allDeviceIds.length === 0) {
      return { success: false, error: 'No device records found' };
    }

    // Fetch device records to find matching device_id
    const deviceResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'employee.device',
          method: 'read',
          args: [allDeviceIds],
          kwargs: {
            fields: ['id', 'device_id', 'employee_id', 'active'],
          },
        },
      },
      { headers }
    );

    const devices = deviceResponse.data?.result || [];
    console.log('[Attendance] Device records fetched:', devices.length);

    // Match the device id AND require it to be active (honor the Active flag).
    const matchedDevice = devices.find((d) => d.device_id === deviceId && d.active !== false);

    if (!matchedDevice) {
      const inactiveMatch = devices.some((d) => d.device_id === deviceId && d.active === false);
      console.log('[Attendance] No active device record matches:', deviceId, 'inactiveMatch=', inactiveMatch);
      return {
        success: false,
        error: inactiveMatch
          ? 'This device is inactive. Ask HR to re-activate it.'
          : 'No employee registered for this device',
      };
    }

    const employeeId = matchedDevice.employee_id?.[0];
    const employee = employees.find((e) => e.id === employeeId);

    if (employee) {
      console.log('[Attendance] Found employee by device ID:', employee.name);
      _stampDeviceLastUsed(deviceId, employee.id, deviceName); // fire-and-forget
      const result = {
        success: true,
        employee: {
          id: employee.id,
          name: employee.name,
          userId: employee.user_id?.[0] || null,
        },
      };
      // Cache for offline use
      await cachePut('dev', deviceId, result);
      // Also prime the PIN cache for this employee so offline PIN entry works
      // even if the user hasn't typed their PIN online yet on this build.
      // We mirror the same employee object under both `pin` and `barcode` keys.
      if (employee.pin) {
        await cachePut('pin', String(employee.pin).trim(), result);
      }
      if (employee.barcode) {
        await cachePut('pin', String(employee.barcode).trim(), result);
      }
      // Last-resort fallback: a fixed key holding the most recent employee
      // resolved by device id. verifyEmployeePin reads this when offline AND
      // there is no specific PIN cache entry, so any non-empty PIN works.
      try {
        await AsyncStorage.setItem('@attCache:lastEmployee', JSON.stringify(result));
      } catch (_) { /* ignore */ }
      return result;
    }

    return { success: false, error: 'Employee not found' };
  } catch (error) {
    console.error('[Attendance] Device ID lookup error:', error?.message);
    // Network-style failure → fall back to whatever we cached last time
    if (_isNetworkLikeErr(error)) {
      const cached = await cacheGet('dev', deviceId);
      if (cached) {
        console.log('[Attendance] Using cached employee for device:', deviceId);
        return { ...cached, fromCache: true };
      }
    }
    return {
      success: false,
      error: error?.message || 'Failed to find employee by device',
    };
  }
};

// Fire-and-forget: stamp the device's Last Used = now on a successful login so HR
// can see which phones are actually in use.
const _stampDeviceLastUsed = async (deviceId, employeeId = null, deviceName = null) => {
  console.log('[device-stamp] start', { deviceId, employeeId, deviceName });
  if (!deviceId) return;
  try {
    const headers = await getOdooAuthHeaders();
    const domain = [['device_id', '=', deviceId]];
    if (employeeId) domain.push(['employee_id', '=', employeeId]);
    const searchResp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: { model: 'employee.device', method: 'search', args: [domain], kwargs: { limit: 1, context: { active_test: false } } } },
      { headers },
    );
    if (searchResp.data?.error) {
      console.warn('[device-stamp] SEARCH error:', JSON.stringify(searchResp.data.error?.data?.message || searchResp.data.error));
      return;
    }
    const ids = searchResp.data?.result || [];
    console.log('[device-stamp] matched ids', ids);
    if (!ids.length) return;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const vals = { last_used: now };
    // Auto-fill the phone's model name on first login (Android via Platform).
    if (deviceName && String(deviceName).trim()) vals.device_name = String(deviceName).trim();
    const writeResp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: { model: 'employee.device', method: 'write', args: [ids, vals], kwargs: {} } },
      { headers },
    );
    if (writeResp.data?.error) {
      console.warn('[device-stamp] WRITE error:', JSON.stringify(writeResp.data.error?.data?.message || writeResp.data.error));
    } else {
      console.log('[device-stamp] OK — wrote', vals, 'to', ids);
    }
  } catch (e) {
    console.warn('[device-stamp] failed:', e?.message);
  }
};

// Is `deviceId` a registered + ACTIVE device for this employee?
const _isDeviceRegisteredFor = async (employeeId, deviceId) => {
  if (!deviceId || !employeeId) return false;
  try {
    const headers = await getOdooAuthHeaders();
    const resp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'employee.device', method: 'search_count',
          args: [[['employee_id', '=', employeeId], ['device_id', '=', deviceId], ['active', '=', true]]],
          kwargs: {},
        },
      },
      { headers }
    );
    const count = resp.data?.result || 0;
    console.log('[Attendance] device registered for emp', employeeId, '=', count > 0);
    return count > 0;
  } catch (e) {
    console.warn('[Attendance] device-registration check failed:', e?.message);
    return false; // fail closed
  }
};

// Find employee by Badge ID (checks both 'pin' and 'barcode' fields). PIN login
// also requires the phone to be a REGISTERED + ACTIVE device for that employee.
export const verifyEmployeePin = async (userId, enteredBadgeId, deviceId = null, deviceName = null) => {
  const badgeId = enteredBadgeId?.trim();
  console.log('[Attendance] Finding employee by Badge ID:', badgeId, 'device:', deviceId);

  if (!deviceId) {
    return { success: false, error: 'Device ID not available. Please restart the app.' };
  }

  // Up-front offline check — go straight to the PIN cache, but only accept it if
  // it was validated on THIS device (no "any PIN" lastEmployee fallback).
  try {
    const online = await isOnline();
    if (!online) {
      const cached = await cacheGet('pin', badgeId);
      if (cached?.success && cached?.deviceId === deviceId) {
        console.log('[Attendance] Offline: PIN cache hit for this device');
        return { ...cached, fromCache: true };
      }
      return {
        success: false,
        error: cached
          ? 'This phone is not registered for this PIN. Connect to the internet to register it.'
          : 'Cannot verify offline. Sign in once online on a registered device first.',
      };
    }
  } catch (_) {
    // isOnline() itself failed — fall through to live attempt
  }

  try {
    const headers = await getOdooAuthHeaders();

    // First try searching by 'pin' field
    let response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.employee',
          method: 'search_read',
          args: [[['pin', '=', badgeId]]],
          kwargs: {
            fields: ['id', 'name', 'user_id', 'pin', 'barcode'],
            limit: 1,
          },
        },
      },
      { headers }
    );

    let employees = response.data?.result || [];

    // If not found by 'pin', try 'barcode' field (Odoo 19 uses this as Badge ID)
    if (employees.length === 0) {
      console.log('[Attendance] Not found by pin field, trying barcode (Badge ID) field...');
      response = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'hr.employee',
            method: 'search_read',
            args: [[['barcode', '=', badgeId]]],
            kwargs: {
              fields: ['id', 'name', 'user_id', 'pin', 'barcode'],
              limit: 1,
            },
          },
        },
        { headers }
      );
      employees = response.data?.result || [];
    }

    if (employees.length > 0) {
      const employee = employees[0];
      console.log('[Attendance] Found employee:', employee.name);
      // Device gate: the phone must be a registered + active device for this employee.
      const devOk = await _isDeviceRegisteredFor(employee.id, deviceId);
      if (!devOk) {
        console.log('[Attendance] PIN ok but device not registered for', employee.name);
        return {
          success: false,
          error: `This phone isn't registered for ${employee.name}. Ask HR to register this device.`,
        };
      }
      _stampDeviceLastUsed(deviceId, employee.id, deviceName); // fire-and-forget
      const result = {
        success: true,
        employee: {
          id: employee.id,
          name: employee.name,
          userId: employee.user_id?.[0] || null,
        },
        deviceId,
      };
      // Cache by the badge id + device so the same PIN works offline on this device.
      await cachePut('pin', badgeId, result);
      return result;
    }

    console.log('[Attendance] No employee found with Badge ID:', badgeId);
    return {
      success: false,
      error: 'No employee found with this Badge ID'
    };
  } catch (error) {
    console.error('[Attendance] Badge ID lookup error:', error?.message, 'code:', error?.code, 'hasResponse:', !!error?.response);
    const isNetErr = _isNetworkLikeErr(error);
    console.log('[Attendance] isNetworkLikeErr=', isNetErr);

    if (isNetErr) {
      // Offline / unreachable → accept the cache only if it was validated on THIS
      // device (no "any non-empty PIN" lastEmployee fallback anymore).
      const cached = await cacheGet('pin', badgeId);
      if (cached?.success && cached?.deviceId === deviceId) {
        console.log('[Attendance] Using cached employee for this device');
        return { ...cached, fromCache: true };
      }
      return {
        success: false,
        error: cached
          ? 'This phone is not registered for this PIN.'
          : 'Cannot verify offline. Sign in once online on a registered device first.',
      };
    }
    return {
      success: false,
      error: error?.message || 'Failed to find employee'
    };
  }
};

// Check-in to Odoo by user ID (looks up employee)
export const checkInToOdoo = async (userId) => {
  console.log('[Attendance] === CHECK-IN TO ODOO ===');
  console.log('[Attendance] User ID:', userId);

  try {
    const headers = await getOdooAuthHeaders();

    // Get employee ID
    const employee = await getEmployeeIdFromUserId(userId);
    if (!employee) {
      console.error('[Attendance] Cannot check-in: No employee found for user');
      return { success: false, error: 'No employee record found for this user' };
    }

    const checkInTime = formatDateForOdoo(new Date());
    console.log('[Attendance] Check-in time:', checkInTime);

    // First check for any open attendance (no check_out) for this employee
    // Odoo has a constraint preventing overlapping attendance records
    const openCheckResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          args: [[
            ['employee_id', '=', employee.id],
            ['check_out', '=', false],
          ]],
          kwargs: {
            fields: ['id', 'check_in'],
            order: 'check_in desc',
            limit: 1,
          },
        },
      },
      { headers }
    );

    const openRecords = openCheckResponse.data?.result || [];
    if (openRecords.length > 0) {
      // Auto-close the previous open attendance before creating a new one
      const openRecord = openRecords[0];
      console.log('[Attendance] Found open attendance ID:', openRecord.id, '- auto-closing it');

      await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'hr.attendance',
            method: 'write',
            args: [[openRecord.id], {
              check_out: checkInTime,
            }],
            kwargs: {},
          },
        },
        { headers }
      );
      console.log('[Attendance] Auto-closed previous attendance');
    }

    // Include a placeholder `late_reason` in the initial create. Some Odoo
    // deployments add a server-side ValidationError constraint that blocks
    // creating a late attendance with an empty `late_reason`. Sending a
    // single dot as a placeholder lets the create succeed; the real reason
    // is overwritten via `submitLateReason` once the user fills the
    // "You're Late" popup that fires right after this.
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'create',
          args: [{
            employee_id: employee.id,
            check_in: checkInTime,
            late_reason: '.',
          }],
          kwargs: {},
        },
      },
      { headers }
    );

    console.log('[Attendance] Check-in response:', JSON.stringify(response.data, null, 2));

    if (response.data?.error) {
      const errMsg = response.data.error.data?.message || 'Failed to create attendance record';
      console.error('[Attendance] Odoo error:', errMsg);
      return { success: false, error: errMsg };
    }

    if (response.data?.result) {
      return {
        success: true,
        attendanceId: response.data.result,
        checkInTime: checkInTime,
        employeeName: employee.name,
      };
    }

    return { success: false, error: 'Failed to create attendance record' };
  } catch (error) {
    console.error('[Attendance] Check-in error:', error?.message);
    if (error.response) {
      console.error('[Attendance] Error response:', JSON.stringify(error.response.data, null, 2));
    }
    return { success: false, error: error?.message || 'Check-in failed' };
  }
};

// Check-in to Odoo by employee ID directly (when employee already known from PIN)
// Helper: detect "no connectivity / server unreachable" type errors so we can
// fall back to the local offline queue. Anything else (4xx/5xx with a real
// response body) is a real Odoo error and should not be queued.
const isNetworkLikeError = (error) => {
  if (!error) return false;
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') return true;
  if (error.message && /Network Error|timeout/i.test(error.message)) return true;
  if (!error.response) return true; // axios with no response usually means transport failure
  return false;
};

// Helper: enqueue an offline check-in and return the success-shaped object
// the UserAttendanceScreen expects. Used both when isOnline() reports false
// up-front AND when an axios call fails with a network-like error mid-flight.
const queueOfflineCheckIn = async ({ employeeId, employeeName, checkInTime, lateReason = null }) => {
  try {
    const values = {
      employee_id: employeeId,
      check_in: checkInTime,
    };
    // Reason-before-check-in: a late offline check-in carries its reason so the
    // queued create lands with it (and the backend constraint is satisfied).
    if (lateReason) values.late_reason = lateReason;
    const localId = await offlineQueue.enqueue({
      model: 'hr.attendance',
      operation: 'create',
      values,
    });
    console.log('[Attendance] Check-in queued offline, localId:', localId);
    return {
      success: true,
      offline: true,
      localId,
      attendanceId: null,
      checkInTime: odooUtcToLocalDisplay(checkInTime),
      checkInTimeUtc: checkInTime,
      employeeName,
    };
  } catch (e) {
    console.error('[Attendance] Failed to enqueue offline check-in:', e?.message);
    return { success: false, error: 'Could not save offline: ' + (e?.message || 'unknown') };
  }
};

export const checkInByEmployeeId = async (employeeId, employeeName, lateReason = null) => {
  console.log('[Attendance] === CHECK-IN BY EMPLOYEE ID ===');
  console.log('[Attendance] Employee ID:', employeeId, 'lateReason:', lateReason ? 'yes' : 'no');

  const now = new Date();
  const checkInTime = formatDateForOdoo(now);
  console.log('[Attendance] Check-in time:', checkInTime);

  // Up-front offline check — if the device knows it has no network, skip the
  // doomed axios calls entirely and queue immediately. Saves a 30s timeout.
  try {
    const online = await isOnline();
    if (!online) {
      console.log('[Attendance] Device is offline, queueing check-in locally');
      return await queueOfflineCheckIn({ employeeId, employeeName, checkInTime, lateReason });
    }
  } catch (_) {
    // If isOnline() itself errors, fall through to the live attempt — the
    // catch block below will queue if the actual call fails.
  }

  try {
    const headers = await getOdooAuthHeaders();

    // First check for any open attendance (no check_out) for this employee
    // Odoo has a constraint preventing overlapping attendance records
    const openCheckResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          args: [[
            ['employee_id', '=', employeeId],
            ['check_out', '=', false],
          ]],
          kwargs: {
            fields: ['id', 'check_in', 'check_out'],
            order: 'check_in desc',
            limit: 1,
          },
        },
      },
      { headers }
    );

    const openRecords = openCheckResponse.data?.result || [];
    if (openRecords.length > 0) {
      // Auto-close the previous open attendance before creating a new one
      const openRecord = openRecords[0];
      console.log('[Attendance] Found open attendance ID:', openRecord.id, '- auto-closing it');

      await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'hr.attendance',
            method: 'write',
            args: [[openRecord.id], {
              check_out: checkInTime,
            }],
            kwargs: {},
          },
        },
        { headers }
      );
      console.log('[Attendance] Auto-closed previous attendance');
    }

    // Now create the new check-in. Reason-before-check-in: the caller computes
    // lateness up front and, when late, passes the real `lateReason` here so the
    // row is created WITH it in one step. On-time check-ins omit late_reason
    // entirely (the backend constraint only fires for late rows).
    const createVals = {
      employee_id: employeeId,
      check_in: checkInTime,
    };
    if (lateReason) createVals.late_reason = lateReason;
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'create',
          args: [createVals],
          // Reason-before-check-in: the app gates lateness up front (and the
          // post-create prompt is a fallback), so the server-side "reason
          // required to save" constraint must not hard-fail the create.
          kwargs: { context: { skip_late_reason_required: true } },
        },
      },
      { headers }
    );

    console.log('[Attendance] Check-in response:', JSON.stringify(response.data, null, 2));

    if (response.data?.error) {
      const errMsg = response.data.error.data?.message || 'Failed to create attendance record';
      console.error('[Attendance] Odoo error:', errMsg);
      return { success: false, error: errMsg };
    }

    if (response.data?.result) {
      return {
        success: true,
        attendanceId: response.data.result,
        checkInTime: odooUtcToLocalDisplay(checkInTime),
        employeeName: employeeName,
      };
    }

    return { success: false, error: 'Failed to create attendance record' };
  } catch (error) {
    console.error('[Attendance] Check-in error:', error?.message);
    if (error.response) {
      console.error('[Attendance] Error response:', JSON.stringify(error.response.data, null, 2));
    }
    // If this looks like a connectivity / unreachable-server failure, queue it
    // locally instead of bubbling the error up to the UI as a hard failure.
    if (isNetworkLikeError(error)) {
      console.log('[Attendance] Network-like error, falling back to offline queue');
      return await queueOfflineCheckIn({ employeeId, employeeName, checkInTime, lateReason });
    }
    return { success: false, error: error?.message || 'Check-in failed' };
  }
};

// Check-out to Odoo
export const checkOutToOdoo = async (attendanceId) => {
  console.log('[Attendance] === CHECK-OUT TO ODOO ===');
  console.log('[Attendance] Attendance ID:', attendanceId);

  try {
    const headers = await getOdooAuthHeaders();
    const checkOutTime = formatDateForOdoo(new Date());
    console.log('[Attendance] Check-out time:', checkOutTime);

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'write',
          args: [[attendanceId], {
            check_out: checkOutTime,
          }],
          kwargs: {},
        },
      },
      { headers }
    );

    console.log('[Attendance] Check-out response:', JSON.stringify(response.data, null, 2));

    if (response.data?.result) {
      return {
        success: true,
        checkOutTime: odooUtcToLocalDisplay(checkOutTime),
        // Raw UTC so the UI can re-format LIVE in the current office timezone.
        checkOutTimeUtc: checkOutTime,
      };
    }

    return { success: false, error: 'Failed to update attendance record' };
  } catch (error) {
    console.error('[Attendance] Check-out error:', error?.message);
    return { success: false, error: error?.message || 'Check-out failed' };
  }
};

// Get today's attendance for user
export const getTodayAttendance = async (userId) => {
  console.log('[Attendance] Getting today attendance for user:', userId);

  try {
    const headers = await getOdooAuthHeaders();

    // Get employee ID first
    const employee = await getEmployeeIdFromUserId(userId);
    if (!employee) {
      return null;
    }

    const today = getTodayDateString();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          args: [[
            ['employee_id', '=', employee.id],
            ['check_in', '>=', `${today} 00:00:00`],
            ['check_in', '<=', `${today} 23:59:59`],
          ]],
          kwargs: {
            fields: ['id', 'employee_id', 'check_in', 'check_out'],
            order: 'check_in desc',
            limit: 1,
          },
        },
      },
      { headers }
    );

    const records = response.data?.result || [];
    if (records.length > 0) {
      console.log('[Attendance] Found today attendance:', records[0]);
      return {
        id: records[0].id,
        employeeId: records[0].employee_id?.[0],
        employeeName: records[0].employee_id?.[1] || employee.name,
        checkIn: odooUtcToLocalDisplay(records[0].check_in),
        checkOut: odooUtcToLocalDisplay(records[0].check_out),
        // Raw UTC instants so the UI can re-format LIVE in the current office
        // timezone (the formatted strings above are frozen at fetch time).
        checkInTimeUtc: records[0].check_in,
        checkOutTimeUtc: records[0].check_out,
      };
    }

    console.log('[Attendance] No attendance found for today');
    return null;
  } catch (error) {
    console.error('[Attendance] Error getting today attendance:', error?.message);
    return null;
  }
};

// Fetch the employee's most recent OPEN attendance (check_out is empty) with no
// date bound. Used to recover a session that was checked in on a previous day
// and never checked out, so the app keeps offering Check Out across midnight.
// Returns the raw Odoo record (or null). `headers` is optional and reused by
// callers that already authenticated to avoid a second auth round-trip.
export const getLastOpenAttendance = async (employeeId, headers) => {
  try {
    const authHeaders = headers || (await getOdooAuthHeaders());
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          args: [[
            ['employee_id', '=', employeeId],
            ['check_out', '=', false],
          ]],
          kwargs: {
            fields: [
              'id', 'employee_id', 'check_in', 'check_out',
              'attendance_source', 'is_late', 'late_minutes_display', 'deduction_amount',
            ],
            order: 'check_in desc',
            limit: 1,
          },
        },
      },
      { headers: authHeaders }
    );
    const records = response.data?.result || [];
    return records.length > 0 ? records[0] : null;
  } catch (error) {
    console.error('[Attendance] Error getting last open attendance:', error?.message);
    return null;
  }
};

// Get today's attendance by employee ID directly
export const getTodayAttendanceByEmployeeId = async (employeeId, employeeName) => {
  console.log('[Attendance] Getting today attendance for employee:', employeeId);

  try {
    const headers = await getOdooAuthHeaders();
    const today = getTodayDateString();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          args: [[
            ['employee_id', '=', employeeId],
            ['check_in', '>=', `${today} 00:00:00`],
            ['check_in', '<=', `${today} 23:59:59`],
          ]],
          kwargs: {
            fields: [
              'id', 'employee_id', 'check_in', 'check_out',
              // Cross-mode + banner support: source ('manual' = office, 'field' = field),
              // late flag + display fields used by the in-card yellow banner.
              // `checkin_session` lets us block re-check-in only for the session
              // that's already completed (split-shift aware).
              'attendance_source', 'is_late', 'late_minutes_display', 'deduction_amount',
              'checkin_session',
            ],
            order: 'check_in desc',
          },
        },
      },
      { headers }
    );

    const records = response.data?.result || [];
    // Cache the FULL list of today's records (closed + open) so the offline
    // same-session guard can detect "checked out earlier today, online" cases.
    try {
      await AsyncStorage.setItem(
        `@cache:todayAttRecords:${employeeId}`,
        JSON.stringify(records.map(r => ({
          id: r.id,
          check_in: r.check_in,
          check_out: r.check_out,
        }))),
      );
    } catch (_) { /* ignore */ }

    // Build the screen-facing object from a raw Odoo attendance record.
    // checkOut is populated for CLOSED records (e.g. checked in+out on the web)
    // so the screen recognises a completed day and shows the details instead of
    // offering a fresh check-in.
    const buildFromRecord = (rec) => ({
      id: rec.id,
      employeeId: rec.employee_id?.[0],
      employeeName: rec.employee_id?.[1] || employeeName,
      checkIn: odooUtcToLocalDisplay(rec.check_in),
      checkOut: rec.check_out ? odooUtcToLocalDisplay(rec.check_out) : null,
      attendance_source: rec.attendance_source || 'manual',
      is_late: !!rec.is_late,
      late_minutes_display: rec.late_minutes_display || '',
      deduction_amount: Number(rec.deduction_amount || 0),
      checkin_session: rec.checkin_session || '1',
    });

    if (records.length > 0) {
      // Find the last OPEN attendance (no check_out) — supports multiple check-in/out per day
      const openRecord = records.find(r => !r.check_out);
      if (openRecord) {
        console.log('[Attendance] Found open attendance:', openRecord.id);
        const built = buildFromRecord(openRecord);
        await cachePut('todayAtt', employeeId, built);
        return built;
      }
    }

    // No OPEN record dated today. Before declaring "ready for new check-in",
    // look for an open record from a PREVIOUS day (e.g. checked in 11pm on the
    // 29th, never checked out — after midnight it falls outside today's window).
    // Mirrors Odoo's `attendance_state`: state is driven by the last record's
    // open/closed status regardless of calendar date, so the carried-over
    // session must still offer Check Out.
    const carriedOver = await getLastOpenAttendance(employeeId, headers);
    if (carriedOver) {
      console.log('[Attendance] Found carried-over open attendance:', carriedOver.id);
      const built = buildFromRecord(carriedOver);
      await cachePut('todayAtt', employeeId, built);
      return built;
    }

    if (records.length > 0) {
      // Today's records exist but all are CLOSED. Block re-check-in only for the
      // session we're in right now: if a closed record exists for the current
      // session, show its details (completed) instead of offering a new check-in.
      // A different, not-yet-done session (e.g. split-shift afternoon) still
      // returns null below so its own check-in is allowed.
      let currentSession = '1';
      try {
        const cached = await getCachedLateConfig(employeeId);
        currentSession = String(computeLocalLateInfo(new Date(), cached)?.session || '1');
      } catch (_) { /* default to session 1 */ }

      const sessionRecord = records.find(
        (r) => String(r.checkin_session || '1') === currentSession
      );
      if (sessionRecord) {
        console.log('[Attendance] Current session', currentSession,
          'already completed (record', sessionRecord.id, ') — showing details, blocking re-check-in');
        const built = buildFromRecord(sessionRecord);
        await cachePut('todayAtt', employeeId, built);
        return built;
      }

      console.log('[Attendance] All records closed; current session', currentSession,
        'has no record yet — ready for new check-in');
    } else {
      console.log('[Attendance] No attendance found for today');
    }
    await cachePut('todayAtt', employeeId, null);
    return null;
  } catch (error) {
    console.error('[Attendance] Error getting today attendance:', error?.message);
    if (_isNetworkLikeErr(error)) {
      const cached = await cacheGet('todayAtt', employeeId);
      if (cached !== null && cached !== undefined) {
        console.log('[Attendance] Using cached today attendance');
        return cached;
      }
    }
    return null;
  }
};

// Upload attendance photo to Odoo as attachment
export const uploadAttendancePhoto = async (attendanceId, base64Image, type = 'check_in') => {
  console.log('[Attendance] Uploading photo for attendance:', attendanceId, 'type:', type);

  try {
    const headers = await getOdooAuthHeaders();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `attendance_${type}_${attendanceId}_${timestamp}.jpg`;

    // Create attachment in Odoo
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'ir.attachment',
          method: 'create',
          args: [{
            name: fileName,
            type: 'binary',
            datas: base64Image,
            res_model: 'hr.attendance',
            res_id: attendanceId,
            mimetype: 'image/jpeg',
          }],
          kwargs: {},
        },
      },
      { headers }
    );

    console.log('[Attendance] Photo upload response:', JSON.stringify(response.data, null, 2));

    if (response.data?.result) {
      return {
        success: true,
        attachmentId: response.data.result,
      };
    }

    return { success: false, error: 'Failed to upload photo' };
  } catch (error) {
    console.error('[Attendance] Photo upload error:', error?.message);
    return { success: false, error: error?.message || 'Failed to upload photo' };
  }
};

// =============================================
// WFH (Work From Home) FUNCTIONS
// =============================================

// Submit a WFH request (create + submit for approval)
export const submitWfhRequest = async (userId, requestDate, reason) => {
  console.log('[WFH] Submitting WFH request:', { userId, requestDate, reason });

  try {
    const headers = await getOdooAuthHeaders();

    // Step 1: Create the WFH request
    const createResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.wfh.request',
          method: 'create',
          args: [{
            employee_user_id: userId,
            request_date: requestDate,
            reason: reason,
          }],
          kwargs: {},
        },
      },
      { headers }
    );

    if (createResponse.data?.error) {
      const errMsg = createResponse.data.error.data?.message || 'Failed to create WFH request';
      console.error('[WFH] Create error:', errMsg);
      return { success: false, error: errMsg };
    }

    const requestId = createResponse.data?.result;
    if (!requestId) {
      return { success: false, error: 'Failed to create WFH request' };
    }

    console.log('[WFH] Created request ID:', requestId);

    // Step 2: Submit for approval (action_submit)
    const submitResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.wfh.request',
          method: 'action_submit',
          args: [[requestId]],
          kwargs: {},
        },
      },
      { headers }
    );

    if (submitResponse.data?.error) {
      const errMsg = submitResponse.data.error.data?.message || 'Failed to submit WFH request';
      console.error('[WFH] Submit error:', errMsg);
      return { success: false, error: errMsg };
    }

    console.log('[WFH] Request submitted for approval');
    return { success: true, requestId };
  } catch (error) {
    console.error('[WFH] Submit WFH request error:', error?.message);
    return { success: false, error: error?.message || 'Failed to submit WFH request' };
  }
};

// Get today's approved/checked-in/checked-out WFH request for a user
export const getTodayApprovedWfh = async (userId) => {
  console.log('[WFH] Checking today WFH for user:', userId);

  try {
    const headers = await getOdooAuthHeaders();
    const today = getTodayDateString();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.wfh.request',
          method: 'search_read',
          args: [[
            ['employee_user_id', '=', userId],
            ['request_date', '=', today],
            ['state', 'in', ['approved', 'checked_in', 'checked_out']],
          ]],
          kwargs: {
            fields: ['id', 'request_date', 'reason', 'state'],
            limit: 1,
          },
        },
      },
      { headers }
    );

    console.log('[WFH] getTodayApprovedWfh response:', JSON.stringify(response.data));

    if (response.data?.error) {
      console.log('[WFH] Search error:', response.data.error.data?.message);
      return null;
    }

    const records = response.data?.result || [];
    if (records.length > 0) {
      const req = records[0];
      console.log('[WFH] Found today WFH request:', JSON.stringify(req));
      return {
        id: req.id,
        requestDate: req.request_date,
        reason: req.reason,
        state: req.state,
        checkIn: null,
        checkOut: null,
      };
    }

    console.log('[WFH] No approved WFH request for today');
    return null;
  } catch (error) {
    console.error('[WFH] Get today WFH error:', error?.message);
    return null;
  }
};

// WFH Check-in (calls action_checkin on the Odoo model)
export const wfhCheckIn = async (requestId) => {
  console.log('[WFH] Check-in for request:', requestId);

  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.wfh.request',
          method: 'action_checkin',
          args: [[requestId]],
          kwargs: {},
        },
      },
      { headers }
    );

    if (response.data?.error) {
      const errMsg = response.data.error.data?.message || 'WFH check-in failed';
      console.error('[WFH] Check-in error:', errMsg);
      return { success: false, error: errMsg };
    }

    const now = new Date();
    console.log('[WFH] Check-in successful');
    return {
      success: true,
      checkInTime: formatTimeOffice(now),
    };
  } catch (error) {
    console.error('[WFH] Check-in error:', error?.message);
    return { success: false, error: error?.message || 'WFH check-in failed' };
  }
};

// WFH Check-out (calls action_checkout on the Odoo model)
export const wfhCheckOut = async (requestId) => {
  console.log('[WFH] Check-out for request:', requestId);

  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.wfh.request',
          method: 'action_checkout',
          args: [[requestId]],
          kwargs: {},
        },
      },
      { headers }
    );

    if (response.data?.error) {
      const errMsg = response.data.error.data?.message || 'WFH check-out failed';
      console.error('[WFH] Check-out error:', errMsg);
      return { success: false, error: errMsg };
    }

    const now = new Date();
    console.log('[WFH] Check-out successful');
    return {
      success: true,
      checkOutTime: formatTimeOffice(now),
    };
  } catch (error) {
    console.error('[WFH] Check-out error:', error?.message);
    return { success: false, error: error?.message || 'WFH check-out failed' };
  }
};

// Get all WFH requests for a user (for history display)
export const getMyWfhRequests = async (userId) => {
  console.log('[WFH] Fetching WFH requests for user:', userId);

  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.wfh.request',
          method: 'search_read',
          args: [[['employee_user_id', '=', userId]]],
          kwargs: {
            fields: ['id', 'request_date', 'reason', 'state'],
            order: 'request_date desc',
            limit: 20,
          },
        },
      },
      { headers }
    );

    if (response.data?.error) {
      return [];
    }

    const records = response.data?.result || [];
    return records.map((r) => ({
      id: r.id,
      requestDate: r.request_date,
      reason: r.reason,
      state: r.state,
    }));
  } catch (error) {
    console.error('[WFH] Get requests error:', error?.message);
    return [];
  }
};

// =============================================
// LATE TRACKING FUNCTIONS
// =============================================

// Get late tracking configuration for an employee
export const getLateConfig = async (employeeId) => {
  console.log('[Attendance] Getting late config for employee:', employeeId);
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance.late.config',
          method: 'get_config_for_employee',
          args: [employeeId],
          kwargs: {},
        },
      },
      { headers }
    );

    const result = response.data?.result;
    if (result) {
      console.log('[Attendance] Late config:', JSON.stringify(result));
      // Make the office timezone available to the synchronous time formatters.
      setOfficeTimezone(result.timezone);
      // Cache the raw config so the offline late-reason flow can read it.
      try {
        await AsyncStorage.setItem(
          `@cache:lateConfig:${employeeId}`,
          JSON.stringify(result),
        );
      } catch (_) { /* ignore cache failure */ }
      // Fire-and-forget: refresh the slab cache so offline waiver-eligible
      // computations can produce non-zero deduction amounts.
      fetchAndCacheLateSlabs().catch(() => { /* ignore */ });
      return {
        success: true,
        officeStartHour: result.office_start_hour || 8.0,
        lateThresholdMinutes: result.late_threshold_minutes || 15,
        graceLateDays: result.grace_late_days || 5,
      };
    }
    return { success: true, officeStartHour: 8.0, lateThresholdMinutes: 15, graceLateDays: 5 };
  } catch (error) {
    console.error('[Attendance] Get late config error:', error?.message);
    return { success: false, error: error?.message };
  }
};

// Read the cached late config for an employee. Returns the raw Odoo
// response shape (office_start_hour, late_threshold_minutes, shift_type,
// office_start_hour_2, etc.) or null if no cache exists yet.
export const getCachedLateConfig = async (employeeId) => {
  try {
    const raw = await AsyncStorage.getItem(`@cache:lateConfig:${employeeId}`);
    const cfg = raw ? JSON.parse(raw) : null;
    // Seed the office timezone for the time formatters (covers offline / before
    // a fresh getLateConfig has run this session).
    if (cfg?.timezone) setOfficeTimezone(cfg.timezone);
    return cfg;
  } catch {
    return null;
  }
};

// Fetch and cache the late-deduction slabs for offline computation. Stores
// raw Odoo records: { from_minutes, to_minutes, deduction_amount }.
export const fetchAndCacheLateSlabs = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.late.deduction.slab',
          method: 'search_read',
          args: [[['active', '=', true]]],
          kwargs: {
            fields: ['from_minutes', 'to_minutes', 'deduction_amount'],
            order: 'from_minutes asc',
          },
        },
      },
      { headers, timeout: 8000 }
    );
    const slabs = response.data?.result || [];
    await AsyncStorage.setItem('@cache:lateSlabs', JSON.stringify(slabs));
    console.log('[Attendance] Cached', slabs.length, 'late deduction slabs');
    return slabs;
  } catch (e) {
    console.log('[Attendance] fetchAndCacheLateSlabs failed:', e?.message);
    return null;
  }
};

const _getCachedLateSlabs = async () => {
  try {
    const raw = await AsyncStorage.getItem('@cache:lateSlabs');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};

// Mirror of Odoo's hr.late.deduction.slab.get_deduction_for_minutes.
const _slabAmountForMinutes = (slabs, lateMinutes) => {
  for (const s of (slabs || [])) {
    if (lateMinutes >= s.from_minutes) {
      if (s.to_minutes === 0 || lateMinutes <= s.to_minutes) {
        return s.deduction_amount || 0;
      }
    }
  }
  return 0;
};

// Compute the deduction amount for a single late record locally — same
// algorithm as `_applyOfflineDeduction` but for one in-progress check-in.
// Used by the offline late-reason popup so the user sees the correct amount
// the moment they're flagged as late, matching what Odoo will compute on sync.
export const computeLocalDeductionAmount = async (employeeId, lateMinutes, checkInDate) => {
  try {
    const cachedConfigRaw = await AsyncStorage.getItem(`@cache:lateConfig:${employeeId}`);
    const cachedConfig = cachedConfigRaw ? JSON.parse(cachedConfigRaw) : {};
    const grace = typeof cachedConfig?.grace_late_times === 'number'
      ? cachedConfig.grace_late_times
      : (typeof cachedConfig?.grace_late_days === 'number' ? cachedConfig.grace_late_days : 5);
    const slabs = await _getCachedLateSlabs();

    // Count prior month late records (server cache + offline queue) so we
    // know what sequence the just-created record will land at.
    const month = String((checkInDate || new Date()).toISOString()).slice(0, 7);
    let priorCount = 0;

    try {
      const elRaw = await AsyncStorage.getItem(`@cache:eligibleLate:${employeeId}`);
      const elList = elRaw ? JSON.parse(elRaw) : [];
      if (Array.isArray(elList)) {
        priorCount += elList.filter(r => String(r.date || '').startsWith(month)).length;
      }
    } catch (_) { /* ignore */ }

    try {
      const queue = await offlineQueue.getAll();
      for (const item of (queue || [])) {
        if (item.model !== 'hr.attendance' || item.operation !== 'create') continue;
        const v = item.values || {};
        if (Number(v.employee_id) !== Number(employeeId)) continue;
        if (!v.check_in) continue;
        if (!String(v.check_in).startsWith(month)) continue;
        priorCount += 1;
      }
    } catch (_) { /* ignore */ }

    // Sequence = priorCount + 1 (this record is the next one to land).
    const seq = priorCount + 1;
    let amount = 0;
    if (seq > grace) {
      amount = _slabAmountForMinutes(slabs, lateMinutes);
    }
    // NOTE: this client estimate is ALWAYS slab-based. If the Odoo config's
    // deduction_mode is 'hourly', the SERVER computes a different (hourly)
    // amount — that's the popup(slab) vs after-save(server hourly) mismatch.
    console.log('[local-ded] empId=' + employeeId + ' month=' + month +
                ' deduction_mode=' + (cachedConfig?.deduction_mode || '?') +
                ' daily_work_hours=' + (cachedConfig?.daily_work_hours ?? '?') +
                ' priorCount=' + priorCount + ' seq=' + seq + ' grace=' + grace +
                ' lateMin=' + lateMinutes +
                ' slabs=' + JSON.stringify(slabs) +
                ' → CLIENT(slab)=' + amount +
                (cachedConfig?.deduction_mode === 'hourly'
                  ? ' [WARN: config is HOURLY → server value will differ from this slab estimate]'
                  : ''));
    return amount;
  } catch (e) {
    console.log('[local-ded] error:', e?.message);
    return 0;
  }
};

// No-save PREVIEW of a hypothetical check-in's late metrics — including the
// SERVER-computed deduction (hourly or slab, per config). Lets the office popup
// show the same number the saved record / Odoo web will show, instead of the
// client slab estimate. `checkInUtc` = "YYYY-MM-DD HH:MM:SS" (UTC). Returns the
// raw dict {is_late, late_minutes, late_minutes_display, expected_start_time,
// checkin_session, late_sequence, deduction_amount} or null on error/offline.
export const previewLateInfoOdoo = async (employeeId, checkInUtc) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'preview_late_info',
          args: [Number(employeeId), checkInUtc],
          kwargs: {},
        },
      },
      { headers }
    );
    if (response.data?.error) {
      console.log('[previewLateInfo] odoo error:', response.data.error?.data?.message);
      return null;
    }
    return response.data?.result || null;
  } catch (e) {
    console.log('[previewLateInfo] error:', e?.message);
    return null;
  }
};

// Submit late reason for an attendance record
export const submitLateReason = async (attendanceId, reason) => {
  console.log('[Attendance] Submitting late reason for attendance:', attendanceId);
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'write',
          args: [[attendanceId], { late_reason: reason }],
          kwargs: {},
        },
      },
      { headers }
    );

    if (response.data?.error) {
      return { success: false, error: response.data.error.data?.message || 'Failed to submit late reason' };
    }
    console.log('[Attendance] Late reason submitted successfully');
    return { success: true };
  } catch (error) {
    console.error('[Attendance] Submit late reason error:', error?.message);
    return { success: false, error: error?.message };
  }
};

// Get today's attendance with late tracking info
export const getTodayAttendanceWithLateInfo = async (employeeId) => {
  console.log('[Attendance] Getting today attendance with late info for employee:', employeeId);
  try {
    const headers = await getOdooAuthHeaders();
    const today = getTodayDateString();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          // Today's records OR any still-open record from a previous day. The
          // open-record clause keeps a carried-over session's late banner /
          // deduction visible after midnight (Odoo keys it off check_in, so it
          // still reads as a late event on its check-in day). Prefix-notation
          // domain: employee_id = X AND ( (check_in in today's window) OR
          // (check_out is empty) ).
          args: [[
            ['employee_id', '=', employeeId],
            '|',
            '&',
            ['check_in', '>=', `${today} 00:00:00`],
            ['check_in', '<=', `${today} 23:59:59`],
            ['check_out', '=', false],
          ]],
          kwargs: {
            fields: [
              'id', 'check_in', 'check_out',
              'is_late', 'late_minutes', 'late_minutes_display', 'expected_start_time',
              'late_reason', 'deduction_amount', 'late_sequence',
              'daily_total_hours', 'is_first_checkin_of_day', 'checkin_session',
            ],
            order: 'check_in asc',
          },
        },
      },
      { headers }
    );

    const records = response.data?.result || [];
    return {
      success: true,
      records: records.map(r => ({
        id: r.id,
        checkIn: r.check_in ? odooUtcToLocalDisplay(r.check_in) : null,
        checkOut: r.check_out ? odooUtcToLocalDisplay(r.check_out) : null,
        isLate: r.is_late,
        lateMinutes: r.late_minutes,
        lateMinutesDisplay: r.late_minutes_display || '',
        expectedStartTime: r.expected_start_time,
        lateReason: r.late_reason || '',
        deductionAmount: r.deduction_amount,
        lateSequence: r.late_sequence,
        dailyTotalHours: r.daily_total_hours,
        isFirstCheckinOfDay: r.is_first_checkin_of_day,
        checkinSession: r.checkin_session,
      })),
    };
  } catch (error) {
    console.error('[Attendance] Get late info error:', error?.message);
    return { success: false, error: error?.message, records: [] };
  }
};

// =============================================
// LEAVE REQUEST FUNCTIONS
// =============================================

// Helper: cache key for an employee's leave requests
const _leaveCacheKey = (userId, employeeId) =>
  `@cache:myLeaveRequests:${employeeId || userId}`;

// Helper: check if requested leave dates overlap any existing cached leave
const _hasOverlappingLeave = (cached, fromDate, toDate, isHalfDay) => {
  if (!Array.isArray(cached) || cached.length === 0) return null;
  const start = fromDate;
  const end = isHalfDay ? fromDate : (toDate || fromDate);
  for (const r of cached) {
    if (r.state === 'rejected' || r.state === 'cancelled') continue;
    const rStart = r.fromDate;
    const rEnd = r.toDate || r.fromDate;
    if (!rStart) continue;
    // Date strings are ISO YYYY-MM-DD so lexicographic compare works
    if (start <= rEnd && end >= rStart) return r;
  }
  return null;
};

// Submit a leave request — works online AND offline.
// Offline path:
//   1. Check cached `getMyLeaveRequests` for any overlapping dates
//   2. If duplicate → return error
//   3. Otherwise enqueue create to offline queue + add to local cache so
//      "My Requests" shows the pending row immediately
export const submitLeaveRequest = async (userId, leaveType, fromDate, toDate, reason, employeeId, isHalfDay = false) => {
  console.log('[Leave] Submitting leave request for user:', userId, 'employee:', employeeId, 'halfDay:', isHalfDay);

  // Build create values once — used by both paths
  const createVals = {
    leave_type: leaveType,
    from_date: fromDate,
    to_date: isHalfDay ? false : (toDate || false),
    is_half_day: isHalfDay,
    reason: reason,
  };
  if (employeeId) {
    createVals.hr_employee_id = employeeId;
  }

  // Offline branch — queue the create + update local cache
  const networkStatus = require('@utils/networkStatus').default;
  const online = await networkStatus.isOnline();
  if (!online) {
    console.log('[Leave] Offline — checking cache for overlapping leave');
    try {
      const cacheKey = _leaveCacheKey(userId, employeeId);
      const raw = await AsyncStorage.getItem(cacheKey);
      const cached = raw ? JSON.parse(raw) : [];

      const overlap = _hasOverlappingLeave(cached, fromDate, toDate, isHalfDay);
      if (overlap) {
        console.log('[Leave] Offline duplicate detected:', overlap);
        return {
          success: false,
          error: `A ${overlap.state || 'pending'} ${overlap.leaveType || 'leave'} request already exists overlapping ${overlap.fromDate}${overlap.toDate ? ' → ' + overlap.toDate : ''}.`,
        };
      }

      const offlineQueue = require('@utils/offlineQueue').default;
      const localId = await offlineQueue.enqueue({
        model: 'hr.leave.request',
        operation: 'create',
        values: createVals,
      });

      // Add a pending row to local cache so My Requests shows it immediately
      const pendingRow = {
        id: `offline_${localId}`,
        leaveType,
        fromDate,
        toDate: isHalfDay ? '' : (toDate || ''),
        numberOfDays: isHalfDay ? 0.5 : null,
        reason,
        state: 'pending',
        approvedBy: '',
        approvalDate: '',
        rejectionReason: '',
        offline: true,
        offlineQueueId: localId,
      };
      const next = [pendingRow, ...cached];
      await AsyncStorage.setItem(cacheKey, JSON.stringify(next));

      console.log('[Leave] Queued offline leave request:', localId);
      return { success: true, requestId: pendingRow.id, offline: true };
    } catch (e) {
      console.error('[Leave] Offline queue error:', e?.message);
      return { success: false, error: 'Failed to save offline: ' + (e?.message || 'unknown') };
    }
  }

  try {
    const headers = await getOdooAuthHeaders();

    // Create leave request
    const createResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.leave.request',
          method: 'create',
          args: [createVals],
          kwargs: {},
        },
      },
      { headers }
    );

    if (createResponse.data?.error) {
      const errMsg = createResponse.data.error.data?.message || 'Failed to create leave request';
      return { success: false, error: errMsg };
    }

    const requestId = createResponse.data?.result;
    if (!requestId) {
      return { success: false, error: 'Failed to create leave request' };
    }

    // Auto-submit for approval
    await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.leave.request',
          method: 'action_submit',
          args: [[requestId]],
          kwargs: {},
        },
      },
      { headers }
    );

    console.log('[Leave] Request submitted successfully, ID:', requestId);
    return { success: true, requestId };
  } catch (error) {
    console.error('[Leave] Submit error:', error?.message);
    return { success: false, error: error?.message };
  }
};

// Get my leave requests (by hr_employee_id for device-based lookup)
// Online: fetches from Odoo, refreshes the local cache, merges any pending
// offline-queued rows on top.
// Offline: returns whatever's in the cache (already includes pending rows
// added by submitLeaveRequest's offline branch).
export const getMyLeaveRequests = async (userId, employeeId) => {
  console.log('[Leave] Getting leave requests for employee:', employeeId, 'user:', userId);
  const cacheKey = _leaveCacheKey(userId, employeeId);

  // Read pending offline rows; drop those whose queue item has already
  // synced so we don't get duplicates after Odoo returns the real record.
  let pendingOffline = [];
  let aliveQueueIds = new Set();
  try {
    const offlineQueue = require('@utils/offlineQueue').default;
    const queue = await offlineQueue.getAll();
    aliveQueueIds = new Set(queue.map(q => q.id));
  } catch (_) { /* ignore */ }
  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(r => {
          if (r.offline === true) {
            const stillQueued = aliveQueueIds.has(r.offlineQueueId);
            if (!stillQueued) {
              console.log('[Leave] dropping synced offline row from cache:', r.id, r.offlineQueueId);
            }
            return stillQueued;
          }
          return true;
        });
        pendingOffline = cleaned.filter(r => r.offline === true);
        if (cleaned.length !== parsed.length) {
          try { await AsyncStorage.setItem(cacheKey, JSON.stringify(cleaned)); } catch (_) {}
        }
      }
    }
  } catch (_) { /* ignore */ }

  try {
    const headers = await getOdooAuthHeaders();

    // Filter by hr_employee_id if available, otherwise by user_id
    const domain = employeeId
      ? [['hr_employee_id', '=', employeeId]]
      : [['employee_user_id', '=', userId]];

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.leave.request',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: [
              'id', 'leave_type', 'from_date', 'to_date',
              'number_of_days', 'reason', 'state',
              'approved_by', 'approval_date', 'rejection_reason',
            ],
            order: 'from_date desc',
            limit: 30,
          },
        },
      },
      { headers }
    );

    const records = response.data?.result || [];
    const mapped = records.map(r => ({
      id: r.id,
      leaveType: r.leave_type,
      fromDate: r.from_date || '',
      toDate: r.to_date || '',
      numberOfDays: r.number_of_days,
      reason: r.reason || '',
      state: r.state,
      approvedBy: r.approved_by ? r.approved_by[1] : '',
      approvalDate: r.approval_date || '',
      rejectionReason: r.rejection_reason || '',
    }));

    // Merge pending offline rows on top + cache for future offline reads
    const merged = [...pendingOffline, ...mapped];
    try { await AsyncStorage.setItem(cacheKey, JSON.stringify(merged)); } catch (_) {}
    return merged;
  } catch (error) {
    console.error('[Leave] Get requests error — falling back to cache:', error?.message);
    // Network error: fall back to whatever is cached so the user still sees
    // their previous and pending requests.
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return pendingOffline; // worst case — at least the pending offline rows
  }
};

// Helper: scan every cached leave-list and remove or update a row by id.
// Used by cancelLeaveRequest so callers don't need to pass userId/employeeId.
const _stripLeaveFromAllCaches = async (predicate, mapFn) => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    for (const k of allKeys) {
      if (!k.startsWith('@cache:myLeaveRequests:')) continue;
      try {
        const raw = await AsyncStorage.getItem(k);
        if (!raw) continue;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        const next = mapFn ? list.map(r => predicate(r) ? mapFn(r) : r)
                           : list.filter(r => !predicate(r));
        await AsyncStorage.setItem(k, JSON.stringify(next));
      } catch (_) { /* skip key on parse failure */ }
    }
  } catch (_) { /* ignore */ }
};

// Cancel a leave request — works online AND offline.
// Two paths:
//   A) Pending offline-queued leave (id starts with "offline_") — drop the
//      queue item + remove the row from every leave cache. No network call.
//   B) Synced numeric id while offline — queue an `action_cancel` operation
//      and flip the cached row's state to "cancelled" so the UI updates
//      immediately. Sync handler hits Odoo when network returns.
//   C) Synced id while online — original direct call to Odoo.
export const cancelLeaveRequest = async (requestId) => {
  console.log('[Leave] Cancelling leave request:', requestId);

  // Case A: offline-queued leave that never reached Odoo
  const idStr = String(requestId);
  if (idStr.startsWith('offline_')) {
    try {
      const localId = idStr.replace(/^offline_/, '');
      const offlineQueue = require('@utils/offlineQueue').default;
      await offlineQueue.removeById(localId);
      // Drop the row from any cached leave lists
      await _stripLeaveFromAllCaches(
        (r) => r.id === idStr || r.offlineQueueId === localId,
        null,
      );
      console.log('[Leave] Removed pending offline leave:', localId);
      return { success: true, offline: true };
    } catch (e) {
      console.error('[Leave] Offline cancel error:', e?.message);
      return { success: false, error: e?.message };
    }
  }

  // Case B: synced numeric id while offline → queue + cache update
  const networkStatus = require('@utils/networkStatus').default;
  const online = await networkStatus.isOnline();
  if (!online) {
    try {
      const offlineQueue = require('@utils/offlineQueue').default;
      await offlineQueue.enqueue({
        model: 'hr.leave.request',
        operation: 'cancel',
        values: { id: requestId },
      });
      // Flip the cached row's state so UI updates instantly
      await _stripLeaveFromAllCaches(
        (r) => r.id === requestId,
        (r) => ({ ...r, state: 'cancelled', _pendingCancel: true }),
      );
      console.log('[Leave] Queued cancel for synced id:', requestId);
      return { success: true, offline: true };
    } catch (e) {
      console.error('[Leave] Offline queued cancel error:', e?.message);
      return { success: false, error: e?.message };
    }
  }

  // Case C: online — original direct path
  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.leave.request',
          method: 'action_cancel',
          args: [[requestId]],
          kwargs: {},
        },
      },
      { headers }
    );

    if (response.data?.error) {
      return { success: false, error: response.data.error.data?.message || 'Failed to cancel' };
    }
    return { success: true };
  } catch (error) {
    console.error('[Leave] Cancel error:', error?.message);
    return { success: false, error: error?.message };
  }
};

// =============================================
// LATE WAIVER REQUEST FUNCTIONS
// =============================================

// Get all late attendance records (last 30 days) eligible for waiver
// Cache key for the eligible-late-attendance dropdown options
const _eligibleLateCacheKey = (employeeId) => `@cache:eligibleLate:${employeeId}`;

// Build synthetic eligible-late records from the offline queue. Any closed
// `hr.attendance create` with check_in + check_out that is locally late
// becomes a record with id = `offline:<queueId>` so the waiver page can
// list it and submit a waiver against it. Deduction is calculated locally:
//   sequence = position in the merged month-list (server cache + offline)
//              after sorting by check_in asc
//   if sequence <= grace_late_times → 0
//   else if mode === 'fixed' → slab[lateMinutes]
//   (hourly mode falls back to slab in offline since wage may be unknown)
const _buildOfflineEligibleLate = async (employeeId) => {
  try {
    const queue = await offlineQueue.getAll();
    const cachedConfigRaw = await AsyncStorage.getItem(`@cache:lateConfig:${employeeId}`);
    const cachedConfig = cachedConfigRaw ? JSON.parse(cachedConfigRaw) : null;

    const out = [];
    for (const item of (queue || [])) {
      if (item.model !== 'hr.attendance' || item.operation !== 'create') continue;
      const v = item.values || {};
      if (Number(v.employee_id) !== Number(employeeId)) continue;
      if (!v.check_in || !v.check_out) continue;

      const ciDate = new Date(String(v.check_in).replace(' ', 'T') + 'Z');
      if (isNaN(ciDate.getTime())) continue;

      const info = computeLocalLateInfo(ciDate, cachedConfig);
      if (!info.isLate) continue;

      out.push({
        id: `offline:${item.id}`,
        date: String(v.check_in).slice(0, 10),
        checkInTime: odooUtcToLocalDisplay(v.check_in),
        lateMinutes: info.lateMinutes,
        lateMinutesDisplay: info.lateMinutesDisplay || '',
        deductionAmount: 0,    // populated by _applyOfflineDeduction
        lateReason: v.late_reason || '',
        isWaived: false,
        offline: true,
        _checkInUtc: String(v.check_in),  // helper for sequence sort, stripped later
      });
    }
    return out;
  } catch (e) {
    console.log('[Waiver] _buildOfflineEligibleLate error:', e?.message);
    return [];
  }
};

// Stamp a locally-computed deduction onto each offline record by combining
// it with the cached server records to determine month-sequence + grace.
const _applyOfflineDeduction = async (employeeId, offlineRecords, serverRecords) => {
  try {
    if (!offlineRecords || offlineRecords.length === 0) return offlineRecords || [];

    const cachedConfigRaw = await AsyncStorage.getItem(`@cache:lateConfig:${employeeId}`);
    const cachedConfig = cachedConfigRaw ? JSON.parse(cachedConfigRaw) : {};
    const grace = typeof cachedConfig?.grace_late_times === 'number'
      ? cachedConfig.grace_late_times
      : (typeof cachedConfig?.grace_late_days === 'number' ? cachedConfig.grace_late_days : 5);
    const slabs = await _getCachedLateSlabs();
    console.log('[Waiver-offline-ded] config grace_late_times=' + cachedConfig?.grace_late_times +
                ' grace_late_days=' + cachedConfig?.grace_late_days + ' → using grace=' + grace);
    console.log('[Waiver-offline-ded] slabs cached: ' + (slabs?.length || 0) + ' →', JSON.stringify(slabs));
    if (!slabs || slabs.length === 0) {
      console.log('[Waiver-offline-ded] WARN: no slabs cached — deductions will be 0. Open the app while online to populate the slab cache.');
    }

    // Build a chronologically-sorted month-list of "first-of-session" records:
    //   - all cached server records (the server already filtered by late_sequence > 0)
    //   - all offline records (one per closed offline check-in by definition)
    // Each row carries an ISO check-in stamp + its deduction-eligibility flag.
    const all = [];
    for (const r of (serverRecords || [])) {
      all.push({
        kind: 'server',
        id: r.id,
        utc: r.date || '1970-01-01',
        lateMinutes: r.lateMinutes || 0,
      });
    }
    for (const r of offlineRecords) {
      all.push({
        kind: 'offline',
        id: r.id,
        utc: r._checkInUtc || `${r.date} 00:00:00`,
        lateMinutes: r.lateMinutes || 0,
      });
    }
    all.sort((a, b) => String(a.utc).localeCompare(String(b.utc)));

    // Number records by month so grace resets on the 1st.
    const seqByKey = new Map();
    const monthCounter = {};
    for (const row of all) {
      const month = String(row.utc).slice(0, 7); // YYYY-MM
      monthCounter[month] = (monthCounter[month] || 0) + 1;
      seqByKey.set(`${row.kind}:${row.id}`, monthCounter[month]);
    }

    return offlineRecords.map(r => {
      const seq = seqByKey.get(`offline:${r.id}`) || 1;
      let amount = 0;
      if (seq > grace) {
        amount = _slabAmountForMinutes(slabs, r.lateMinutes);
      }
      const { _checkInUtc, ...clean } = r;
      console.log('[Waiver-offline-ded] id=' + r.id + ' seq=' + seq + ' grace=' + grace + ' lateMin=' + r.lateMinutes + ' → ' + amount);
      return { ...clean, deductionAmount: amount };
    });
  } catch (e) {
    console.log('[Waiver] _applyOfflineDeduction error:', e?.message);
    return offlineRecords;
  }
};

export const getEligibleLateAttendances = async (employeeId) => {
  console.log('[Waiver] Getting eligible late attendances for employee:', employeeId);
  const cacheKey = _eligibleLateCacheKey(employeeId);

  // Always derive offline-queue records first so they appear regardless of
  // online/offline state — same idea as how leaves and waivers merge their
  // pending offline rows into the on-screen list.
  const offlineExtrasRaw = await _buildOfflineEligibleLate(employeeId);

  try {
    const headers = await getOdooAuthHeaders();
    // Last 30 days
    const today = new Date();
    const past = new Date();
    past.setDate(past.getDate() - 30);
    const fromStr = past.toISOString().slice(0, 10);
    const toStr = today.toISOString().slice(0, 10);

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.attendance',
          method: 'search_read',
          args: [[
            ['employee_id', '=', employeeId],
            ['is_late', '=', true],
            ['late_sequence', '>', 0],
            ['date', '>=', fromStr],
            ['date', '<=', toStr],
          ]],
          kwargs: {
            fields: [
              'id', 'date', 'check_in', 'late_minutes', 'late_minutes_display',
              'deduction_amount', 'late_reason', 'is_waived',
            ],
            order: 'date desc',
            limit: 60,
          },
        },
      },
      { headers }
    );

    const records = response.data?.result || [];
    const mapped = records.map(r => ({
      id: r.id,
      date: r.date || '',
      checkInTime: r.check_in ? odooUtcToLocalDisplay(r.check_in) : '',
      lateMinutes: r.late_minutes || 0,
      lateMinutesDisplay: r.late_minutes_display || '',
      deductionAmount: r.deduction_amount || 0,
      lateReason: r.late_reason || '',
      isWaived: !!r.is_waived,
    }));

    // Cache for offline reads (server records only — offline extras are
    // re-derived from the queue every call).
    try { await AsyncStorage.setItem(cacheKey, JSON.stringify(mapped)); } catch (_) {}
    const offlineExtras = await _applyOfflineDeduction(employeeId, offlineExtrasRaw, mapped);
    console.log('[Waiver] Cached', mapped.length, 'server records, +', offlineExtras.length, 'offline');
    for (const m of mapped) {
      console.log('[Waiver-server-rec] id=' + m.id + ' date=' + m.date +
                  ' lateMin=' + m.lateMinutes + ' deduction=' + m.deductionAmount +
                  ' waived=' + m.isWaived);
    }

    const merged = [...offlineExtras, ...mapped];
    merged.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return merged;
  } catch (error) {
    console.error('[Waiver] Get eligible late error — falling back to cache:', error?.message);
    let cached = [];
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) cached = parsed;
      }
    } catch (_) { /* ignore */ }

    const offlineExtras = await _applyOfflineDeduction(employeeId, offlineExtrasRaw, cached);
    const merged = [...offlineExtras, ...cached];
    merged.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    console.log('[Waiver] Returning', cached.length, 'cached +', offlineExtras.length, 'offline records');
    return merged;
  }
};

// Helper: cache key for an employee's waiver requests
const _waiverCacheKey = (employeeId) => `@cache:myWaiverRequests:${employeeId}`;

// Submit a new waiver request (creates draft + auto-submits).
// Offline: checks cache for existing waiver on the same attendance_id;
// returns error if duplicate, otherwise queues + adds pending row to cache.
export const submitWaiverRequest = async (employeeId, attendanceId, reason) => {
  console.log('[Waiver] Submitting waiver request for attendance:', attendanceId);

  // Offline branch
  const networkStatus = require('@utils/networkStatus').default;
  const online = await networkStatus.isOnline();
  if (!online) {
    console.log('[Waiver] Offline — checking cache for duplicate');
    try {
      const cacheKey = _waiverCacheKey(employeeId);
      const raw = await AsyncStorage.getItem(cacheKey);
      const cached = raw ? JSON.parse(raw) : [];

      // Check for an existing waiver on the same attendance_id (excluding rejected)
      const dup = cached.find(w =>
        w.attendanceId === attendanceId &&
        w.state !== 'rejected' &&
        w.state !== 'cancelled',
      );
      if (dup) {
        console.log('[Waiver] Offline duplicate detected:', dup);
        return {
          success: false,
          error: `A ${dup.state || 'pending'} waiver request already exists for this attendance record.`,
        };
      }

      // If the attendance is itself an offline-queued record (id like
      // "offline:<localId>"), tag the waiver with `_attendanceLocalId` so the
      // sync layer can resolve it to the real Odoo id once the attendance
      // create has been synced. Otherwise it's a numeric Odoo id we can pass
      // through directly.
      const offlineQueue = require('@utils/offlineQueue').default;
      const isOfflineAtt = typeof attendanceId === 'string' && attendanceId.startsWith('offline:');
      const attLocalId = isOfflineAtt ? String(attendanceId).split(':')[1] : null;
      const queueValues = {
        employee_id: employeeId,
        reason: reason,
      };
      if (isOfflineAtt) {
        queueValues._attendanceLocalId = attLocalId;
      } else {
        queueValues.attendance_id = attendanceId;
      }
      const localId = await offlineQueue.enqueue({
        model: 'hr.late.waiver.request',
        operation: 'create',
        values: queueValues,
      });

      // Look up the attendance details from the eligible-late cache so the
      // pending row shows date / late minutes / deduction in My Requests.
      let attDate = '';
      let attLateMin = 0;
      let attLateDisplay = '';
      let attDeduction = 0;
      let attLateReason = '';
      try {
        const elRaw = await AsyncStorage.getItem(_eligibleLateCacheKey(employeeId));
        if (elRaw) {
          const elList = JSON.parse(elRaw);
          if (Array.isArray(elList)) {
            const match = elList.find(r => r.id === attendanceId);
            if (match) {
              attDate = match.date || '';
              attLateMin = match.lateMinutes || 0;
              attLateDisplay = match.lateMinutesDisplay || '';
              attDeduction = match.deductionAmount || 0;
              attLateReason = match.lateReason || '';
              console.log('[Waiver] offline — populated from eligible-late cache:', JSON.stringify(match));
            }
          }
        }
      } catch (_) { /* ignore cache read failure */ }

      const pendingRow = {
        id: `offline_${localId}`,
        attendanceId,
        lateDate: attDate,
        lateMinutes: attLateMin,
        lateMinutesDisplay: attLateDisplay,
        originalDeduction: attDeduction,
        originalLateReason: attLateReason,
        reason,
        state: 'pending',
        approvedBy: '',
        approvalDate: '',
        rejectionReason: '',
        offline: true,
        offlineQueueId: localId,
      };
      const next = [pendingRow, ...cached];
      await AsyncStorage.setItem(cacheKey, JSON.stringify(next));

      console.log('[Waiver] Queued offline waiver request:', localId);
      return { success: true, requestId: pendingRow.id, offline: true };
    } catch (e) {
      console.error('[Waiver] Offline queue error:', e?.message);
      return { success: false, error: 'Failed to save offline: ' + (e?.message || 'unknown') };
    }
  }

  try {
    const headers = await getOdooAuthHeaders();

    const createResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.late.waiver.request',
          method: 'create',
          args: [{
            employee_id: employeeId,
            attendance_id: attendanceId,
            reason: reason,
          }],
          kwargs: {},
        },
      },
      { headers }
    );

    if (createResponse.data?.error) {
      const errMsg = createResponse.data.error.data?.message || 'Failed to create waiver request';
      return { success: false, error: errMsg };
    }

    const requestId = createResponse.data?.result;
    if (!requestId) {
      return { success: false, error: 'Failed to create waiver request' };
    }

    // Auto-submit (draft -> pending)
    const submitResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.late.waiver.request',
          method: 'action_submit',
          args: [[requestId]],
          kwargs: {},
        },
      },
      { headers }
    );

    if (submitResponse.data?.error) {
      const errMsg = submitResponse.data.error.data?.message || 'Failed to submit waiver request';
      return { success: false, error: errMsg };
    }

    console.log('[Waiver] Waiver request submitted, ID:', requestId);
    return { success: true, requestId };
  } catch (error) {
    console.error('[Waiver] Submit error:', error?.message);
    return { success: false, error: error?.message };
  }
};

// Get my waiver requests
export const getMyWaiverRequests = async (employeeId) => {
  console.log('[Waiver] Getting waiver requests for employee:', employeeId);
  const cacheKey = _waiverCacheKey(employeeId);

  // Read pending offline rows. Drop any whose queue item has already synced
  // (the offline_id no longer exists in the queue), since the matching
  // server record will come back from Odoo and we don't want a duplicate.
  let pendingOffline = [];
  let fullCache = [];
  let aliveQueueIds = new Set();
  try {
    const offlineQueue = require('@utils/offlineQueue').default;
    const queue = await offlineQueue.getAll();
    aliveQueueIds = new Set(queue.map(q => q.id));
  } catch (_) { /* ignore */ }

  try {
    const raw = await AsyncStorage.getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Keep only offline rows whose queue item is still alive
        const cleaned = parsed.filter(r => {
          if (r.offline === true) {
            const stillQueued = aliveQueueIds.has(r.offlineQueueId);
            if (!stillQueued) {
              console.log('[Waiver] dropping synced offline row from cache:', r.id, r.offlineQueueId);
            }
            return stillQueued;
          }
          return true;
        });
        fullCache = cleaned;
        pendingOffline = cleaned.filter(r => r.offline === true);
        // Persist the cleanup so next read is consistent
        if (cleaned.length !== parsed.length) {
          try { await AsyncStorage.setItem(cacheKey, JSON.stringify(cleaned)); } catch (_) {}
        }
      }
    }
    console.log('[Waiver] Cache state — total:', fullCache.length, 'pending offline:', pendingOffline.length);
  } catch (_) { /* ignore */ }

  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'hr.late.waiver.request',
          method: 'search_read',
          args: [[['employee_id', '=', employeeId]]],
          kwargs: {
            fields: [
              'id', 'late_date', 'late_minutes', 'late_minutes_display',
              'original_deduction', 'original_late_reason', 'reason',
              'state', 'approved_by', 'approval_date', 'rejection_reason',
              'attendance_id',
            ],
            order: 'create_date desc',
            limit: 30,
          },
        },
      },
      { headers, timeout: 10000 }
    );

    if (response.data?.error) {
      throw new Error(response.data.error?.data?.message || 'Odoo error');
    }

    const records = response.data?.result || [];
    const mapped = records.map(r => ({
      id: r.id,
      lateDate: r.late_date || '',
      lateMinutes: r.late_minutes || 0,
      lateMinutesDisplay: r.late_minutes_display || '',
      originalDeduction: r.original_deduction || 0,
      originalLateReason: r.original_late_reason || '',
      reason: r.reason || '',
      state: r.state,
      approvedBy: r.approved_by ? r.approved_by[1] : '',
      approvalDate: r.approval_date || '',
      rejectionReason: r.rejection_reason || '',
      attendanceId: r.attendance_id ? r.attendance_id[0] : null,
    }));

    // Merge pending offline + cache for offline reads later
    const merged = [...pendingOffline, ...mapped];
    try { await AsyncStorage.setItem(cacheKey, JSON.stringify(merged)); } catch (_) {}
    console.log('[Waiver] Online fetch ok — server records:', mapped.length, 'merged total:', merged.length);
    return merged;
  } catch (error) {
    console.error('[Waiver] Get requests error — falling back to cache:', error?.message);
    // Network error → return whatever we have cached. Never wipe.
    if (fullCache.length > 0) {
      console.log('[Waiver] Returning', fullCache.length, 'cached waiver records');
      return fullCache;
    }
    return pendingOffline;
  }
};

// =============================================================================
// CUSTOMER VISIT (field-work) — wraps the customer.visit Odoo module so the
// attendance app can flag a check-in as a customer visit, skip the geofence,
// and auto-mark the visit Done at check-out. Online-only for now.
// =============================================================================

// Create a customer.visit in `draft` state. Returns { success, visitId }.
export const createCustomerVisit = async ({
  employeeId, partnerId, latitude, longitude, locationName,
}) => {
  console.log('[Visit] Creating customer.visit for emp:', employeeId, 'partner:', partnerId);
  try {
    const headers = await getOdooAuthHeaders();
    const now = formatDateForOdoo(new Date());
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'customer.visit',
          method: 'create',
          args: [{
            employee_id: employeeId,
            partner_id: partnerId,
            date_time: now,
            latitude: latitude || 0,
            longitude: longitude || 0,
            location_name: locationName || '',
          }],
          kwargs: {},
        },
      },
      { headers }
    );
    if (response.data?.error) {
      const msg = response.data.error?.data?.message || response.data.error?.message || 'Odoo error';
      console.error('[Visit] Create error:', msg);
      return { success: false, error: msg };
    }
    const visitId = response.data?.result;
    console.log('[Visit] Created customer.visit id:', visitId);
    return { success: true, visitId };
  } catch (e) {
    console.error('[Visit] Create exception:', e?.message);
    return { success: false, error: e?.message || 'Failed to create visit' };
  }
};

// Mark a customer.visit as done. Used at check-out.
export const closeCustomerVisit = async (visitId) => {
  console.log('[Visit] Closing customer.visit id:', visitId);
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'customer.visit',
          method: 'action_done',
          args: [[visitId]],
          kwargs: {},
        },
      },
      { headers }
    );
    if (response.data?.error) {
      const msg = response.data.error?.data?.message || response.data.error?.message || 'Odoo error';
      console.error('[Visit] Close error:', msg);
      return { success: false, error: msg };
    }
    return { success: true };
  } catch (e) {
    console.error('[Visit] Close exception:', e?.message);
    return { success: false, error: e?.message || 'Failed to close visit' };
  }
};

export default {
  checkInToOdoo,
  checkInByEmployeeId,
  checkOutToOdoo,
  getTodayAttendance,
  getTodayAttendanceByEmployeeId,
  getLastOpenAttendance,
  getEmployeeIdFromUserId,
  getEmployeeByDeviceId,
  verifyEmployeePin,
  verifyAttendanceLocation,
  getWorkplaceLocation,
  debugListAllEmployees,
  uploadAttendancePhoto,
  submitWfhRequest,
  getTodayApprovedWfh,
  wfhCheckIn,
  wfhCheckOut,
  getMyWfhRequests,
  getLateConfig,
  getCachedLateConfig,
  submitLateReason,
  getTodayAttendanceWithLateInfo,
  submitLeaveRequest,
  getMyLeaveRequests,
  cancelLeaveRequest,
  getEligibleLateAttendances,
  submitWaiverRequest,
  getMyWaiverRequests,
  createCustomerVisit,
  closeCustomerVisit,
};
