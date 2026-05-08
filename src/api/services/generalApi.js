// Cancel a vehicle tracking trip in Odoo by updating trip_cancel to true
export const cancelVehicleTrackingTripOdoo = async ({ tripId, username = DEFAULT_VEHICLE_TRACKING_USERNAME, password = DEFAULT_VEHICLE_TRACKING_PASSWORD, db = DEFAULT_VEHICLE_TRACKING_DB } = {}) => {
  const baseUrl = (VEHICLE_TRACKING_BASE_URL() || '').replace(/\/$/, '');
  if (!tripId) {
    throw new Error('Trip ID is required to cancel a trip');
  }
  const payload = { trip_cancel: true, start_trip: false };
  console.log('[cancelVehicleTrackingTripOdoo] Payload sent to Odoo:', { id: tripId, ...payload });
  try {
    // Step 1: Authenticate to Odoo
    const loginResp = await loginVehicleTrackingOdoo({ username, password, db });
    // Step 2: Update trip record via JSON-RPC (write method)
    const headers = await getOdooAuthHeaders();
    if (loginResp && loginResp.cookies) headers.Cookie = loginResp.cookies;
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'vehicle.tracking',
          method: 'write',
          args: [[tripId], payload],
          kwargs: {},
        },
      },
      {
        headers,
        withCredentials: true,
        timeout: 15000,
      }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (cancel trip):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }
    return response.data.result;
  } catch (error) {
    console.error('cancelVehicleTrackingTripOdoo error:', error?.message || error);
    if (error && error.response) {
      console.error('cancelVehicleTrackingTripOdoo response status:', error.response.status);
      try { console.error('cancelVehicleTrackingTripOdoo response data:', error.response.data); } catch (e) {}
    }
    throw error;
  }
};
// Fetch vehicle tracking trips from Odoo using JSON-RPC, filtered by date
// Fetch vehicle tracking trips from Odoo using JSON-RPC, filtered by date and vehicle_id
export const fetchVehicleTrackingTripsOdoo = async (params = {}) => {
  // Accept either `vehicleId` or `vehicle_id` to be backward-compatible with callers
  const { date, vehicleId: vIdFromCamel, offset = 0, limit = 50 } = params;
  const vehicleIdRaw = params.vehicleId ?? params.vehicle_id ?? vIdFromCamel;
  const vehicleId = vehicleIdRaw != null && vehicleIdRaw !== '' ? (Number.isNaN(Number(vehicleIdRaw)) ? undefined : Number(vehicleIdRaw)) : undefined;
  try {
    // Filter by date and vehicleId if provided. vehicle.tracking.date is a
    // Date field (YYYY-MM-DD), so match exactly — comparing against datetime
    // strings (with HH:MM:SS) returns no rows.
    let domain = [];
    if (date) {
      domain.push(["date", "=", date]);
    }
    if (typeof vehicleId !== 'undefined') {
      domain.push(["vehicle_id", "=", vehicleId]);
    }
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "vehicle.tracking",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id", "ref", "state", "vehicle_id", "driver_id", "date", "number_plate", "start_km", "end_km", "start_trip", "end_trip", "source_id", "destination_id",
              "coolant_water", "oil_checking", "tyre_checking", "battery_checking", "fuel_checking", "daily_checks", "purpose_of_visit_id", "estimated_time",
              "start_latitude", "start_longitude", "end_latitude", "end_longitude", "trip_cancel", "start_time", "end_time", "amount", "remarks",
              "image_url", "km_travelled", "duration", "invoice_number", "fuel_log_ids"
            ],
            offset,
            limit,
            order: "date desc, id desc",
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.log("Odoo JSON-RPC error (vehicle.tracking):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }
    const trips = response.data.result || [];

    // Filter out cancelled trips and properly handle many2one fields
    const mapped = trips
      .filter(trip => !trip.trip_cancel)
      .map(trip => ({
        estimated_time: trip.estimated_time || '',
        id: trip.id,
        ref: trip.ref || '',
        state: trip.state || 'draft',
        // ✅ Fix: Handle many2one fields properly (they return [id, name] or false)
        vehicle_id: Array.isArray(trip.vehicle_id) ? trip.vehicle_id[0] : (trip.vehicle_id ? trip.vehicle_id : null),
        vehicle_name: Array.isArray(trip.vehicle_id) ? trip.vehicle_id[1] : '',
        driver_id: Array.isArray(trip.driver_id) ? trip.driver_id[0] : (trip.driver_id ? trip.driver_id : null),
        driver_name: Array.isArray(trip.driver_id) ? trip.driver_id[1] : '',
        date: trip.date,
        number_plate: trip.number_plate,
        start_km: trip.start_km,
        end_km: trip.end_km,
        start_trip: trip.start_trip,
        end_trip: trip.end_trip,
        source_id: Array.isArray(trip.source_id) ? trip.source_id[0] : (trip.source_id ? trip.source_id : null),
        source_name: Array.isArray(trip.source_id) ? trip.source_id[1] : '',
        destination_id: Array.isArray(trip.destination_id) ? trip.destination_id[0] : (trip.destination_id ? trip.destination_id : null),
        destination_name: Array.isArray(trip.destination_id) ? trip.destination_id[1] : '',
        vehicleChecklist: {
          coolentWater: trip.coolant_water || false,
          oilChecking: trip.oil_checking || false,
          tyreChecking: trip.tyre_checking || false,
          batteryChecking: trip.battery_checking || false,
          fuelChecking: trip.fuel_checking || false,
          dailyChecks: trip.daily_checks || false,
        },
        purpose_of_visit: Array.isArray(trip.purpose_of_visit_id) ? trip.purpose_of_visit_id[1] : '',
        pre_trip_litres: typeof trip.pre_trip_litres !== 'undefined' ? trip.pre_trip_litres : '',
        start_latitude: typeof trip.start_latitude !== 'undefined' ? trip.start_latitude : '',
        start_longitude: typeof trip.start_longitude !== 'undefined' ? trip.start_longitude : '',
        end_latitude: typeof trip.end_latitude !== 'undefined' ? trip.end_latitude : '',
        end_longitude: typeof trip.end_longitude !== 'undefined' ? trip.end_longitude : '',
        trip_cancel: trip.trip_cancel || false,
        start_time: trip.start_time || null,
        end_time: trip.end_time || null,
        amount: trip.amount || 0,
        remarks: trip.remarks || '',
        // image_url is a Binary field on Odoo (returns base64 or false). Expose
        // it as a ready-to-render data URI for <Image> components in the app.
        image_url: trip.image_url && typeof trip.image_url === 'string' && trip.image_url.length > 0
          ? `data:image/jpeg;base64,${trip.image_url}`
          : null,
        invoice_number: trip.invoice_number || '',
        km_travelled: typeof trip.km_travelled !== 'undefined' ? trip.km_travelled : 0,
        duration: typeof trip.duration !== 'undefined' ? trip.duration : 0,
        // Raw IDs only at this stage; the batched lookup below resolves them.
        _fuel_log_ids: Array.isArray(trip.fuel_log_ids) ? trip.fuel_log_ids : [],
        fuel_logs: [],
      }));

    // Batched fuel-log resolve — one extra round-trip for the page, regardless
    // of how many trips it contains. Mirrors the invoice-line resolve pattern.
    try {
      const allFuelIds = mapped.flatMap(t => t._fuel_log_ids || []);
      if (allFuelIds.length > 0) {
        const fuelResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model: 'vehicle.fuel.log',
              method: 'search_read',
              args: [[['id', 'in', allFuelIds]]],
              kwargs: {
                fields: ['id', 'name', 'amount', 'fuel_level', 'odometer',
                         'create_date', 'driver_id', 'vehicle_tracking_id',
                         'gps_lat', 'gps_long',
                         'odometer_image', 'receipt_image'],
                // Without `bin_size: false` Odoo returns Binary/Image fields as
                // human-readable size strings (e.g. "12.5 KB") instead of the
                // actual base64 bytes — that's why old fuel logs rendered blank
                // in the app even though the images existed in Odoo.
                context: { bin_size: false },
              },
            },
          },
          { headers }
        );
        if (!fuelResp.data?.error) {
          const logs = fuelResp.data.result || [];
          const byTripId = {};
          logs.forEach(l => {
            const tid = Array.isArray(l.vehicle_tracking_id) ? l.vehicle_tracking_id[0] : l.vehicle_tracking_id;
            if (!tid) return;
            // Use Odoo's `/web/image/<model>/<id>/<field>` route — bypasses
            // the unreliable JSON-RPC base64 path. Cache-buster from create_date
            // keeps URL stable per record version.
            const v = l.create_date ? `?v=${encodeURIComponent(l.create_date)}` : '';
            const baseImg = ODOO_BASE_URL();
            const odoUrl = `${baseImg}/web/image/vehicle.fuel.log/${l.id}/odometer_image${v}`;
            const rcptUrl = `${baseImg}/web/image/vehicle.fuel.log/${l.id}/receipt_image${v}`;
            (byTripId[tid] = byTripId[tid] || []).push({
              id: l.id,
              name: l.name || '',
              amount: l.amount || 0,
              fuel_level: l.fuel_level || 0,
              odometer: l.odometer || 0,
              create_date: l.create_date || null,
              driver_name: Array.isArray(l.driver_id) ? l.driver_id[1] : '',
              gps_lat: l.gps_lat || '',
              gps_long: l.gps_long || '',
              odometer_image: odoUrl,
              receipt_image: rcptUrl,
            });
          });
          mapped.forEach(t => { t.fuel_logs = byTripId[t.id] || []; });
        } else {
          console.warn('Fuel-log batch fetch error:', fuelResp.data.error);
        }
      }
    } catch (fuelErr) {
      console.warn('Fuel-log batch fetch failed:', fuelErr?.message);
    }
    // Drop the temporary id-only field — only the resolved fuel_logs is exposed.
    mapped.forEach(t => { delete t._fuel_log_ids; });

    // Cache for offline fallback. Filter cache by date scope so we don't
    // overwrite the full cache when a date-filtered fetch returns a subset.
    if (!params.date && typeof vehicleId === 'undefined') {
      try { await AsyncStorage.setItem('@cache:vehicleTrackingTrips', JSON.stringify(mapped)); } catch (_) {}
    }
    return await _mergeOfflineVehicleTrackingTrips(mapped, params);
  } catch (error) {
    console.error("Error fetching vehicle tracking trips from Odoo:", error?.message || error);
    // Offline fallback — last cached list + still-pending offline rows.
    try {
      const raw = await AsyncStorage.getItem('@cache:vehicleTrackingTrips');
      const cached = raw ? JSON.parse(raw) : [];
      const filtered = _filterVehicleTrackingTripsLocal(cached, params);
      console.log('[fetchVehicleTrackingTrips] OFFLINE — cached=' + cached.length + ' after-filter=' + filtered.length);
      return await _mergeOfflineVehicleTrackingTrips(filtered, params);
    } catch (_) {
      return [];
    }
  }
};

const _filterVehicleTrackingTripsLocal = (rows, { date, vehicleId } = {}) => {
  if (!Array.isArray(rows)) return [];
  const dayOf = (s) => (typeof s === 'string' ? s.slice(0, 10) : '');
  return rows.filter((r) => {
    if (date && dayOf(r.date) !== date) return false;
    if (vehicleId != null && vehicleId !== '' && r.vehicle_id !== Number(vehicleId)) return false;
    return true;
  });
};

const _mergeOfflineVehicleTrackingTrips = async (serverList, params = {}) => {
  try {
    const offlineQueue = require('@utils/offlineQueue').default;
    const queue = await offlineQueue.getAll();
    const pending = (queue || [])
      .filter(q => q.model === 'vehicle.tracking' && q.operation === 'create')
      .map(q => ({
        id: 'offline_' + q.id,
        ref: q.values?.offline_label || 'OFF',
        offline_label: q.values?.offline_label || null,
        state: q.values?.state || 'draft',
        vehicle_id: q.values?.vehicle_id || null,
        vehicle_name: q.values?._vehicleName || '',
        driver_id: q.values?.driver_id || null,
        driver_name: q.values?._driverName || '',
        date: q.values?.date || '',
        number_plate: q.values?.number_plate || '',
        start_km: q.values?.start_km || 0,
        end_km: q.values?.end_km || 0,
        start_trip: q.values?.start_trip || false,
        end_trip: q.values?.end_trip || false,
        source_id: q.values?.source_id || null,
        source_name: q.values?._sourceName || '',
        destination_id: q.values?.destination_id || null,
        destination_name: q.values?._destinationName || '',
        amount: q.values?.amount || 0,
        remarks: q.values?.remarks || '',
        offline: true,
        offlineQueueId: q.id,
      }));
    const filteredPending = (params.date || params.vehicleId)
      ? _filterVehicleTrackingTripsLocal(pending, params)
      : pending;
    // Decorate server rows with their preserved OFF labels (so the OFF ref
    // stays visible alongside the real Odoo ref after sync).
    let labelMap = {};
    try {
      const raw = await AsyncStorage.getItem('@cache:offlineLabels:vehicleTracking');
      labelMap = raw ? JSON.parse(raw) : {};
    } catch (_) {}
    const decoratedServer = (serverList || []).map((v) => ({
      ...v,
      offline_label: labelMap[String(v.id)] || v.offline_label || null,
    }));
    return [...filteredPending, ...decoratedServer];
  } catch (e) {
    console.log('[fetchVehicleTrackingTrips] merge offline failed:', e?.message);
    return serverList || [];
  }
};

// Fetch sources (locations) from Odoo using JSON-RPC (vehicle.location model)
export const fetchSourcesOdoo = async ({ offset = 0, limit = 50, searchText = "" } = {}) => {
  try {
    let domain = [];
    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain = [["name", "ilike", term]]; // Filter by location name
    }
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "vehicle.location",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: ["id", "name", "latitude", "longitude"],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.log("Odoo JSON-RPC error (sources):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }
    const sources = response.data.result || [];
    return sources.map(source => ({
      _id: source.id,
      name: source.name || "",
      latitude: source.latitude || null,
      longitude: source.longitude || null,
    }));
  } catch (error) {
    console.error("Error fetching sources from Odoo:", error);
    throw error;
  }
};
// ---- Vehicle Locations CRUD (vehicle.location) ----
// fetch, create and update vehicle.location records — used by both the
// stand-alone Vehicle Location screen and the source/destination dropdowns
// inside the Vehicle Tracking form. Cached for offline parity.
export const fetchVehicleLocationsOdoo = async ({ offset = 0, limit = 100, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    let domain = [];
    if (searchText && searchText.trim() !== '') {
      domain = [['name', 'ilike', searchText.trim()]];
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'vehicle.location',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'latitude', 'longitude', 'location'],
            offset, limit, order: 'name asc',
          },
        },
      },
      { headers }
    );
    if (response.data?.error) throw new Error(response.data.error.data?.message || 'Odoo error');
    const mapped = (response.data?.result || []).map(r => ({
      id: r.id,
      name: r.name || '',
      latitude: r.latitude ?? 0,
      longitude: r.longitude ?? 0,
      location: r.location || '',
    }));
    if (!searchText) {
      try { await AsyncStorage.setItem('@cache:vehicleLocations', JSON.stringify(mapped)); } catch (_) {}
    }
    return mapped;
  } catch (err) {
    console.error('fetchVehicleLocationsOdoo error:', err?.message || err);
    try {
      const raw = await AsyncStorage.getItem('@cache:vehicleLocations');
      if (raw) {
        const cached = JSON.parse(raw);
        if (searchText) {
          const q = String(searchText).toLowerCase();
          return cached.filter((r) => (r.name || '').toLowerCase().includes(q));
        }
        return cached;
      }
    } catch (_) {}
    return [];
  }
};

export const createVehicleLocationOdoo = async (data) => {
  const headers = await getOdooAuthHeaders();
  const vals = {
    name: data?.name || '',
    latitude: parseFloat(data?.latitude) || 0,
    longitude: parseFloat(data?.longitude) || 0,
    location: data?.location || data?.name || '',
  };
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'vehicle.location',
        method: 'create',
        args: [vals],
        kwargs: {},
      },
    },
    { headers }
  );
  if (response.data?.error) throw new Error(response.data.error.data?.message || 'Odoo error');
  const id = Array.isArray(response.data?.result) ? response.data.result[0] : response.data.result;
  return { id, ...vals };
};

export const updateVehicleLocationOdoo = async (id, data) => {
  const headers = await getOdooAuthHeaders();
  const vals = {};
  if (data?.name !== undefined) vals.name = data.name;
  if (data?.latitude !== undefined) vals.latitude = parseFloat(data.latitude) || 0;
  if (data?.longitude !== undefined) vals.longitude = parseFloat(data.longitude) || 0;
  if (data?.location !== undefined) vals.location = data.location;
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'vehicle.location',
        method: 'write',
        args: [[id], vals],
        kwargs: {},
      },
    },
    { headers }
  );
  if (response.data?.error) throw new Error(response.data.error.data?.message || 'Odoo error');
  return { id, ...vals };
};

// ---- Validate helpers (state actions) ----
// Both modules expose `action_validate` on their main model; calling it
// flips the record into Validated state. Used by the form's admin-only
// Validate button. Online-only — offline validate isn't supported (rare).
export const validateVehicleTrackingOdoo = async (id) => {
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'vehicle.tracking',
        method: 'action_validate',
        args: [[id]],
        kwargs: {},
      },
    },
    { headers }
  );
  if (response.data?.error) throw new Error(response.data.error.data?.message || 'Odoo error');
  return true;
};

export const validateVehicleMaintenanceOdoo = async (id) => {
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'cash.collection',
        method: 'action_validate',
        args: [[id]],
        kwargs: {},
      },
    },
    { headers }
  );
  if (response.data?.error) throw new Error(response.data.error.data?.message || 'Odoo error');
  return true;
};

// ---- Field Attendance (trip + customer visit) ----
// Phase 1 server methods on hr.attendance, both @api.model.

export const fetchTodayFieldAttendanceOdoo = async (employeeId) => {
  if (!employeeId) throw new Error('employeeId is required');
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'hr.attendance',
        method: 'get_today_field_attendance',
        args: [Number(employeeId)],
        kwargs: {},
      },
    },
    { headers, timeout: 15000 }
  );
  if (response.data?.error) {
    throw new Error(response.data.error.data?.message || 'Odoo error');
  }
  return response.data?.result || { status: 'no_trip', trip: null, visits: [], attendance_id: null };
};

export const createFieldAttendanceOdoo = async (employeeId) => {
  if (!employeeId) throw new Error('employeeId is required');
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'hr.attendance',
        method: 'create_field_attendance',
        args: [Number(employeeId)],
        kwargs: {},
      },
    },
    { headers, timeout: 20000 }
  );
  if (response.data?.error) {
    throw new Error(response.data.error.data?.message || 'Odoo error');
  }
  return response.data?.result || { success: false, error: 'No response from server' };
};

// ---- Field Attendance: Office-style check-in / check-out ----

// Start (check-in) a field attendance for today. Server creates an open
// hr.attendance row with check_in=now, no check_out. If today's trip and
// visits already exist, server best-effort auto-links them; otherwise the
// user can pick them later via the Edit Primary Trip / Add Additional Trip
// sheets. Returns { success, attendance_id, is_late, needs_late_reason, ... }.
export const startFieldAttendanceOdoo = async (employeeId) => {
  if (!employeeId) throw new Error('employeeId is required');
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'hr.attendance',
        method: 'start_field_attendance',
        args: [Number(employeeId)],
        kwargs: {},
      },
    },
    { headers, timeout: 20000 }
  );
  if (response.data?.error) {
    throw new Error(response.data.error.data?.message || 'Odoo error');
  }
  return response.data?.result || { success: false, error: 'No response from server' };
};

// Check out a field attendance. Plain write of check_out=now triggers the
// server's _on_checkout_finalize_trips_and_visits hook which auto-ends the
// last open trip and flips its draft visits to done.
export const checkOutFieldAttendanceOdoo = async (attendanceId, checkOutDateTime) => {
  if (!attendanceId) throw new Error('attendanceId is required');
  let stamp;
  if (checkOutDateTime instanceof Date) {
    stamp = checkOutDateTime.toISOString().replace('T', ' ').replace(/\..*/, '');
  } else if (typeof checkOutDateTime === 'string') {
    stamp = checkOutDateTime;
  } else {
    stamp = new Date().toISOString().replace('T', ' ').replace(/\..*/, '');
  }
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'hr.attendance',
        method: 'write',
        args: [[Number(attendanceId)], { check_out: stamp }],
        kwargs: {},
      },
    },
    { headers, timeout: 20000 }
  );
  if (response.data?.error) {
    throw new Error(response.data.error.data?.message || 'Odoo error');
  }
  return true;
};

// ---- Field Attendance: post-creation management ----
// All calls below mirror the rich functionality the hr_field_attendance Odoo
// module exposes via standard ORM (search_read / read / write / create / unlink).
// They are used by the field-attendance detail screen and history tab.

const _fieldRpc = async ({ model, method, args = [], kwargs = {}, timeout = 15000 }) => {
  const headers = await getOdooAuthHeaders();
  const response = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: { model, method, args, kwargs },
    },
    { headers, timeout }
  );
  if (response.data?.error) {
    throw new Error(response.data.error.data?.message || 'Odoo error');
  }
  return response.data?.result;
};

// Search this employee's past field attendance records, with optional filters.
export const searchMyFieldAttendanceOdoo = async (employeeId, opts = {}) => {
  if (!employeeId) throw new Error('employeeId is required');
  const { dateFrom, dateTo, lateOnly, withDeduction, waived, offset = 0, limit = 30 } = opts;
  const domain = [
    ['attendance_source', '=', 'field'],
    ['employee_id', '=', Number(employeeId)],
  ];
  if (dateFrom) domain.push(['check_in', '>=', dateFrom]);
  if (dateTo) domain.push(['check_in', '<=', dateTo]);
  if (lateOnly) domain.push(['is_late', '=', true]);
  if (withDeduction) domain.push(['deduction_amount', '>', 0]);
  if (waived) domain.push(['is_waived', '=', true]);
  const result = await _fieldRpc({
    model: 'hr.attendance',
    method: 'search_read',
    args: [domain],
    kwargs: {
      fields: [
        'id', 'employee_id', 'check_in', 'check_out', 'attendance_source',
        'gps_latitude', 'gps_longitude', 'gps_location_name',
        'source_trip_id', 'source_visit_count',
        'is_late', 'late_minutes', 'late_minutes_display', 'late_reason',
        'deduction_amount', 'is_waived',
      ],
      offset, limit, order: 'check_in desc',
    },
  });
  return Array.isArray(result) ? result : [];
};

// Read full detail of one field attendance record (primary trip + totals + late).
export const readFieldAttendanceDetailOdoo = async (attendanceId) => {
  if (!attendanceId) throw new Error('attendanceId is required');
  const rows = await _fieldRpc({
    model: 'hr.attendance',
    method: 'read',
    args: [[Number(attendanceId)]],
    kwargs: {
      fields: [
        'id', 'employee_id', 'check_in', 'check_out', 'attendance_source',
        'gps_latitude', 'gps_longitude', 'gps_location_name',
        'source_trip_id', 'source_trip_source_location',
        'source_trip_destination_location', 'source_trip_ended',
        'source_visit_ids', 'source_visit_count', 'has_source_visits',
        'trip_line_ids',
        'trip_total_km', 'trip_total_duration',
        'trip_total_fuel_litres', 'trip_total_fuel_amount',
        'is_late', 'late_minutes', 'late_minutes_display', 'late_reason',
        'deduction_amount', 'is_waived', 'expected_start_time',
      ],
    },
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
};

// Read trip-line rows for an attendance.
export const readFieldTripLinesOdoo = async (lineIds) => {
  if (!Array.isArray(lineIds) || lineIds.length === 0) return [];
  const rows = await _fieldRpc({
    model: 'field.attendance.trip.line',
    method: 'read',
    args: [lineIds.map(Number)],
    kwargs: {
      fields: [
        'id', 'sequence', 'attendance_id', 'trip_id',
        'gps_latitude', 'gps_longitude',
        'source_location', 'destination_location',
        'visit_ids', 'has_visits', 'trip_ended',
        'km_travelled', 'duration', 'total_fuel_litres', 'total_fuel_amount',
        'visited_stops_display',
      ],
    },
  });
  return Array.isArray(rows) ? rows : [];
};

// Read available_trip_ids on the attendance, then fetch full trip rows.
// Includes the current source_trip_id so the picker can keep the existing
// selection visible/editable (mirrors the popup view's OR'd domain).
export const searchAvailableTripsOdoo = async (attendanceId) => {
  if (!attendanceId) throw new Error('attendanceId is required');
  const rows = await _fieldRpc({
    model: 'hr.attendance',
    method: 'read',
    args: [[Number(attendanceId)]],
    kwargs: { fields: ['available_trip_ids', 'source_trip_id'] },
  });
  const att = Array.isArray(rows) && rows[0] ? rows[0] : null;
  const ids = new Set();
  if (att) {
    (att.available_trip_ids || []).forEach((id) => ids.add(Number(id)));
    if (Array.isArray(att.source_trip_id) && att.source_trip_id[0]) {
      ids.add(Number(att.source_trip_id[0]));
    }
  }
  if (ids.size === 0) return [];
  return readVehicleTrackingForTripIdsOdoo(Array.from(ids));
};

// Read full trip rows by ids (used by pickers + TripDetailSheet).
export const readVehicleTrackingForTripIdsOdoo = async (tripIds) => {
  if (!Array.isArray(tripIds) || tripIds.length === 0) return [];
  const rows = await _fieldRpc({
    model: 'vehicle.tracking',
    method: 'read',
    args: [tripIds.map(Number)],
    kwargs: {
      fields: [
        'id', 'ref', 'date', 'vehicle_id', 'driver_id',
        'source_id', 'destination_id', 'purpose_of_visit_id',
        'start_time', 'end_time',
        'start_latitude', 'start_longitude', 'end_latitude', 'end_longitude',
        'km_travelled', 'duration',
        'total_fuel_litres', 'total_fuel_amount',
        'trip_status', 'end_trip', 'trip_cancel',
      ],
    },
  });
  return Array.isArray(rows) ? rows : [];
};

// Read draft customer.visit rows for an employee (used by Visit picker).
export const searchDraftCustomerVisitsOdoo = async (employeeId) => {
  if (!employeeId) throw new Error('employeeId is required');
  const rows = await _fieldRpc({
    model: 'customer.visit',
    method: 'search_read',
    args: [[
      ['employee_id', '=', Number(employeeId)],
      ['state', '=', 'draft'],
    ]],
    kwargs: {
      fields: [
        'id', 'name', 'partner_id', 'date_time', 'latitude', 'longitude',
        'location_name', 'purpose_id', 'state',
      ],
      order: 'date_time asc',
      limit: 200,
    },
  });
  return Array.isArray(rows) ? rows : [];
};

// Read customer.visit rows by ids (used by VisitsListSheet).
export const readCustomerVisitsByIdsOdoo = async (visitIds) => {
  if (!Array.isArray(visitIds) || visitIds.length === 0) return [];
  const rows = await _fieldRpc({
    model: 'customer.visit',
    method: 'read',
    args: [visitIds.map(Number)],
    kwargs: {
      fields: [
        'id', 'name', 'partner_id', 'date_time', 'latitude', 'longitude',
        'location_name', 'purpose_id', 'state',
      ],
    },
  });
  return Array.isArray(rows) ? rows : [];
};

// Save changes to the primary trip section of a field attendance.
export const updateFieldAttendancePrimaryTripOdoo = async (attendanceId, vals) => {
  if (!attendanceId) throw new Error('attendanceId is required');
  const writeVals = {};
  if ('source_trip_id' in vals) writeVals.source_trip_id = vals.source_trip_id ? Number(vals.source_trip_id) : false;
  if ('gps_latitude' in vals) writeVals.gps_latitude = Number(vals.gps_latitude) || 0;
  if ('gps_longitude' in vals) writeVals.gps_longitude = Number(vals.gps_longitude) || 0;
  if ('gps_location_name' in vals) writeVals.gps_location_name = vals.gps_location_name || '';
  if ('source_visit_ids' in vals) {
    const ids = Array.isArray(vals.source_visit_ids) ? vals.source_visit_ids.map(Number) : [];
    writeVals.source_visit_ids = [[6, 0, ids]];
  }
  await _fieldRpc({
    model: 'hr.attendance',
    method: 'write',
    args: [[Number(attendanceId)], writeVals],
  });
  return true;
};

// Add an additional trip line to a field attendance. Server-side
// @api.model_create_multi auto-ends the previous trip and flips its draft
// visits to done — see field_attendance_trip_line.py:167-221.
export const createFieldTripLineOdoo = async (attendanceId, tripId, visitIds = []) => {
  if (!attendanceId) throw new Error('attendanceId is required');
  if (!tripId) throw new Error('tripId is required');
  const result = await _fieldRpc({
    model: 'field.attendance.trip.line',
    method: 'create',
    args: [{
      attendance_id: Number(attendanceId),
      trip_id: Number(tripId),
      visit_ids: [[6, 0, (visitIds || []).map(Number)]],
    }],
  });
  return result;
};

// Remove an additional trip line.
export const deleteFieldTripLineOdoo = async (lineId) => {
  if (!lineId) throw new Error('lineId is required');
  await _fieldRpc({
    model: 'field.attendance.trip.line',
    method: 'unlink',
    args: [[Number(lineId)]],
  });
  return true;
};

// Mark a vehicle.tracking trip as ended (used by the Add-Additional-Trip
// confirm-close-previous flow when the user accepts the prompt).
export const endVehicleTripFromAttendanceOdoo = async (tripId, endTime) => {
  if (!tripId) throw new Error('tripId is required');
  // Format: Odoo expects 'YYYY-MM-DD HH:MM:SS' UTC. Caller may pass a Date,
  // an ISO string, or undefined (server fills "now").
  let endStr = null;
  if (endTime instanceof Date) {
    endStr = endTime.toISOString().replace('T', ' ').replace(/\..*/, '');
  } else if (typeof endTime === 'string') {
    endStr = endTime;
  } else {
    endStr = new Date().toISOString().replace('T', ' ').replace(/\..*/, '');
  }
  await _fieldRpc({
    model: 'vehicle.tracking',
    method: 'write',
    args: [[Number(tripId)], { end_trip: true, end_time: endStr }],
  });
  return true;
};

// Create vehicle tracking trip in Odoo (test-vehicle DB) using JSON-RPC
// Create vehicle tracking trip in Odoo (test-vehicle DB) using JSON-RPC
export const createVehicleTrackingTripOdoo = async ({ payload, username = DEFAULT_VEHICLE_TRACKING_USERNAME, password = DEFAULT_VEHICLE_TRACKING_PASSWORD, db = DEFAULT_VEHICLE_TRACKING_DB } = {}) => {
  const baseUrl = (VEHICLE_TRACKING_BASE_URL() || '').replace(/\/$/, '');
  // Defensive: ensure payload is a valid object
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('createVehicleTrackingTripOdoo: Invalid payload', payload);
    throw new Error('Trip payload is invalid (must be a non-null object)');
  }

  // Offline branch — only for fresh creates (no existing payload.id).
  // Edits/updates of an existing trip require the network.
  try {
    const networkStatus = require('@utils/networkStatus').default;
    const online = await networkStatus.isOnline();
    if (!online && (typeof payload.id === 'undefined' || payload.id === null || payload.id === '')) {
      const offlineQueue = require('@utils/offlineQueue').default;
      const offLabel = await _nextOffLabel({
        counterKey: '@cache:vt_off_counter',
        cacheKey: '@cache:vehicleTrackingTrips',
        scope: 'vehicleTracking',
      });
      // Stamp the offline label + denormalized names so the cached pending
      // row shows them without needing a server fetch.
      const enrichedValues = {
        ...payload,
        offline_label: offLabel,
        _vehicleName: payload._vehicleName || '',
        _driverName: payload._driverName || '',
        _sourceName: payload._sourceName || '',
        _destinationName: payload._destinationName || '',
      };
      const localId = await offlineQueue.enqueue({
        model: 'vehicle.tracking',
        operation: 'create',
        values: enrichedValues,
      });
      console.log('[vehicle.tracking] OFFLINE queued create localId=' + localId + ' offLabel=' + offLabel);
      return { id: 'offline_' + localId, ref: offLabel, offline: true };
    }
  } catch (e) {
    console.log('[vehicle.tracking] offline-branch check failed, falling through to online path:', e?.message);
  }
  // Ensure vehicle_id is present for updates
  if (typeof payload.id !== 'undefined' && (typeof payload.vehicle_id === 'undefined' || payload.vehicle_id === null || payload.vehicle_id === '')) {
    console.warn('createVehicleTrackingTripOdoo: vehicle_id is missing in update payload. This will result in missing vehicle info for the trip.');
  }
  // Log payload before sending
  console.log('createVehicleTrackingTripOdoo: Sending payload to Odoo:', payload);
  try {
    // Step 1: Authenticate to Odoo
    const loginResp = await loginVehicleTrackingOdoo({ username, password, db });
// Build trip payload by removing fields that belong to vehicle.fuel.log or are invalid for vehicle.tracking
const tripPayload = { ...payload };

// ✅ FIX: Convert many2one field IDs to integers BEFORE removing fuel fields
if (tripPayload.vehicle_id) {
  tripPayload.vehicle_id = typeof tripPayload.vehicle_id === 'string' 
        ? parseInt(tripPayload.vehicle_id, 10) 
        : tripPayload.vehicle_id;
    }
    
    if (tripPayload.driver_id) {
      tripPayload.driver_id = typeof tripPayload.driver_id === 'string'
        ? parseInt(tripPayload.driver_id, 10)
        : tripPayload.driver_id;
    }
    
    if (tripPayload.source_id) {
      tripPayload.source_id = typeof tripPayload.source_id === 'string'
        ? parseInt(tripPayload.source_id, 10)
        : tripPayload.source_id;
    }
    
    if (tripPayload.destination_id) {
      tripPayload.destination_id = typeof tripPayload.destination_id === 'string'
        ? parseInt(tripPayload.destination_id, 10)
        : tripPayload.destination_id;
    }
    
    if (tripPayload.purpose_of_visit_id) {
      tripPayload.purpose_of_visit_id = typeof tripPayload.purpose_of_visit_id === 'string'
        ? parseInt(tripPayload.purpose_of_visit_id, 10)
        : tripPayload.purpose_of_visit_id;
    }
    
    const removeKeys = [
      'fuel_amount', 'fuel_liters', 'fuel_litres', 'odometer_image',
      'odometer_image_filename', 'odometer_image_uri', 'current_odometer',
      'post_trip_amount', 'post_trip_litres', 'end_fuel_document', 'pre_trip_litres',
      'upload_path'
    ];
    removeKeys.forEach(k => { if (k in tripPayload) delete tripPayload[k]; });

    // Convert image_url from local file URI to base64 (same format as odometer_image)
    if (tripPayload.image_url) {
      try {
        const uri = tripPayload.image_url;
        if (uri && (uri.startsWith('file://') || uri.startsWith('/'))) {
          const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
          if (b64 && b64.length > 0) {
            tripPayload.image_url = b64;
            console.log('Attached image_url base64 length:', b64.length);
          }
        }
      } catch (readErr) {
        console.warn('Could not read image_url file for base64 conversion:', readErr?.message || readErr);
      }
    }
    // CRITICAL: strip empty image_url (and image_filename). Odoo's `fields.Image`
    // tries to decode the value; an empty string raises
    // "This file could not be decoded as an image file".
    if (!tripPayload.image_url || tripPayload.image_url === '') {
      delete tripPayload.image_url;
      delete tripPayload.image_filename;
    }

    // Debug: show sanitized trip payload that will be sent to Odoo
    console.log('createVehicleTrackingTripOdoo: Sanitized tripPayload:', JSON.stringify(tripPayload));

    // Step 2: Create or update trip record via JSON-RPC
    const headers = await getOdooAuthHeaders();
    if (loginResp && loginResp.cookies) headers.Cookie = loginResp.cookies;

    let tripId;
    
    // If payload includes an `id`, perform an update (write) on that record
    if (tripPayload && (typeof tripPayload.id !== 'undefined')) {
      const recordId = tripPayload.id;
      // Remove id from payload before sending write
      const { id: _remove, ...updatePayload } = tripPayload;
      
      // CRITICAL: Validate vehicle_id is present in update
      if (!updatePayload.vehicle_id) {
        console.error('[createVehicleTrackingTripOdoo] CRITICAL WARNING: vehicle_id is missing from update payload!', {
          payload_vehicle_id: payload.vehicle_id,
          tripPayload_vehicle_id: tripPayload.vehicle_id,
          updatePayload_vehicle_id: updatePayload.vehicle_id,
        });
      } else {
        console.log('[createVehicleTrackingTripOdoo] Update payload includes vehicle_id:', updatePayload.vehicle_id, 'type:', typeof updatePayload.vehicle_id);
      }
      
      try {
        const resp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model: 'vehicle.tracking',
              method: 'write',
              args: [[recordId], updatePayload],
              kwargs: {},
            },
          },
          { headers, withCredentials: true, timeout: 15000 }
        );
        if (resp.data.error) {
          console.error('Odoo JSON-RPC error (update trip):', resp.data.error);
          const odooMsg = resp.data.error?.data?.message || resp.data.error?.message || 'Odoo JSON-RPC error';
          throw new Error(odooMsg);
        }
        // On success, return the id that was updated
        console.log('Odoo updateVehicleTrackingTripOdoo wrote id:', recordId);
        tripId = recordId;
      } catch (err) {
        console.error('Odoo updateVehicleTrackingTripOdoo error:', err);
        throw err;
      }
    } else {
      // Create new record
      const response = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'vehicle.tracking',
            method: 'create',
            args: [[tripPayload]],
            kwargs: {},
          },
        },
        {
          headers,
          withCredentials: true,
          timeout: 15000,
        }
      );
      if (response.data.error) {
        console.error('Odoo JSON-RPC error (create trip):', response.data.error);
        const odooMsg = response.data.error?.data?.message || response.data.error?.message || 'Odoo JSON-RPC error';
        throw new Error(odooMsg);
      }
      const tripIdRaw = response.data.result;
      tripId = Array.isArray(tripIdRaw) ? tripIdRaw[0] : (Number.isFinite(Number(tripIdRaw)) ? Number(Number(tripIdRaw)) : tripIdRaw);
      console.log('Odoo createVehicleTrackingTripOdoo response tripIdRaw:', JSON.stringify(tripIdRaw), 'normalized tripId:', tripId);
    }

    // If payload included fuel details, map them to vehicle.fuel.log and create a record
    let createdFuelLog = null;
    try {
      const hasFuel = payload && (payload.fuel_amount || payload.fuel_liters || payload.fuel_litres || payload.current_odometer);
      if (hasFuel) {
        const fuelPayload = {
          vehicle_tracking_id: tripId,
          vehicle_id: payload.vehicle_id ? (Number(payload.vehicle_id) || payload.vehicle_id) : undefined,
          driver_id: payload.driver_id ? (Number(payload.driver_id) || payload.driver_id) : undefined,
          name: payload.invoice_number || undefined,
          amount: payload.fuel_amount ? Number(payload.fuel_amount) : (payload.amount ? Number(payload.amount) : undefined),
          fuel_level: payload.fuel_liters ? Number(payload.fuel_liters) : (payload.fuel_litres ? Number(payload.fuel_litres) : undefined),
          odometer: payload.current_odometer ? Number(payload.current_odometer) : undefined,
          gps_lat: payload.start_latitude ?? payload.gps_lat ?? undefined,
          gps_long: payload.start_longitude ?? payload.gps_long ?? undefined,
          upload_path: payload.upload_path || undefined,
        };
        // Convert upload_path from local file URI to base64 (same format as odometer_image)
        if (fuelPayload.upload_path) {
          try {
            const uri = fuelPayload.upload_path;
            if (uri && (uri.startsWith('file://') || uri.startsWith('/'))) {
              const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
              if (b64 && b64.length > 0) {
                fuelPayload.upload_path = b64;
                console.log('Attached upload_path base64 length:', b64.length);
              }
            }
          } catch (readErr) {
            console.warn('Could not read upload_path file for base64 conversion:', readErr?.message || readErr);
          }
        }
        // If an odometer image URI exists, set filename and try to include binary (base64)
        if (payload.odometer_image) {
          try {
            const parts = payload.odometer_image.split('/');
            fuelPayload.odometer_image_filename = parts[parts.length - 1];
            // Attempt to read the local file and include as base64 so Odoo saves the image
            try {
              const uri = payload.odometer_image;
              if (uri && (uri.startsWith('file://') || uri.startsWith('/'))) {
                const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
                if (b64 && b64.length > 0) {
                  fuelPayload.odometer_image = b64; // Odoo expects raw base64
                  console.log('Attached odometer image base64 length:', b64.length);
                }
              }
            } catch (readErr) {
              console.warn('Could not read odometer image file for upload:', readErr?.message || readErr);
            }
          } catch (e) {}
        }

        // Clean undefined keys
        Object.keys(fuelPayload).forEach(k => fuelPayload[k] === undefined && delete fuelPayload[k]);

        if (Object.keys(fuelPayload).length > 1) {
          // log payload for debugging
          console.log('Creating vehicle.fuel.log with payload:', JSON.stringify(fuelPayload));
          // create vehicle.fuel.log
          const fuelResp = await axios.post(
            `${baseUrl}/web/dataset/call_kw`,
            {
              jsonrpc: '2.0',
              method: 'call',
              params: {
                model: 'vehicle.fuel.log',
                method: 'create',
                args: [[fuelPayload]],
                kwargs: {},
              },
            },
            { headers, withCredentials: true, timeout: 15000 }
          );
          // Log full response for visibility
          try {
            console.log('[fuel.log] create response:', JSON.stringify(fuelResp.data));
          } catch (e) {
            console.log('[fuel.log] create response (non-json)');
          }
          if (fuelResp.data && fuelResp.data.result) {
            const newLogId = Array.isArray(fuelResp.data.result) ? fuelResp.data.result[0] : fuelResp.data.result;
            console.log('[fuel.log] created id:', newLogId, 'linked to trip', tripId);
            // Snapshot the just-created log so the caller can append it to the
            // form's Fuel List without a re-fetch.
            createdFuelLog = {
              id: newLogId,
              amount: fuelPayload.amount || 0,
              fuel_level: fuelPayload.fuel_level || 0,
              odometer: fuelPayload.odometer || 0,
              create_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
              driver_name: payload._driverName || '',
            };
          } else if (fuelResp.data && fuelResp.data.error) {
            // Surface the Odoo-side reason. Common causes: missing required
            // field (vehicle_id / driver_id / amount / fuel_level), invalid
            // many2one id, or fuel_log permissions.
            const err = fuelResp.data.error;
            const odooMsg = err?.data?.message || err?.message || 'Unknown Odoo error';
            console.error('[fuel.log] CREATION FAILED:', odooMsg, 'payload sent was:', JSON.stringify(fuelPayload));
            throw new Error('Fuel log: ' + odooMsg);
          }
        } else {
          console.warn('[fuel.log] payload too sparse — skipping create:', JSON.stringify(fuelPayload));
        }
      } else {
        console.log('[fuel.log] hasFuel=false — no fuel data on payload, skipping');
      }
    } catch (e) {
      console.error('[fuel.log] EXCEPTION while creating fuel log:', e?.message || e);
      // Re-throw so the form's catch block can surface it via toast.
      throw e;
    }

    // Read back the created trip record to verify fields like `image_url` and `vehicle_id` were saved
    try {
      const readResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'vehicle.tracking',
            method: 'search_read',
            args: [[['id', '=', tripId]]],
            kwargs: { fields: ['id', 'image_url', 'number_plate', 'date', 'vehicle_id', 'driver_id'] },
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );
      if (readResp.data && Array.isArray(readResp.data.result) && readResp.data.result.length > 0) {
        console.log('Readback vehicle.tracking record after create/update:', JSON.stringify(readResp.data.result[0]));
      } else {
        console.log('No readback result for created vehicle.tracking. Response:', JSON.stringify(readResp.data));
      }
    } catch (readErr) {
      console.warn('Failed to read back created vehicle.tracking record:', readErr?.message || readErr);
    }

    return { tripId, fuelLog: createdFuelLog };
  } catch (error) {
    console.error('createVehicleTrackingTripOdoo error:', error?.message || error);
    if (error && error.response) {
      console.error('createVehicleTrackingTripOdoo response status:', error.response.status);
      try { console.error('createVehicleTrackingTripOdoo response data:', error.response.data); } catch (e) {}
    }
    throw error;
  }

};

// Standalone vehicle.fuel.log create — used by the Add Fuel popup which adds
// one fuel entry against an EXISTING trip without re-saving the whole trip.
// Returns the created log object on success, throws on failure.
export const createFuelLogOdoo = async ({
  tripId,
  vehicleId,
  driverId,
  amount,
  fuelLevel,
  odometer,
  odometerImageUri,
  fuelInvoiceUri,
  gpsLat,
  gpsLong,
  username = DEFAULT_VEHICLE_TRACKING_USERNAME,
  password = DEFAULT_VEHICLE_TRACKING_PASSWORD,
  db = DEFAULT_VEHICLE_TRACKING_DB,
} = {}) => {
  if (!tripId) throw new Error('tripId is required to create a fuel log');
  const baseUrl = (VEHICLE_TRACKING_BASE_URL() || '').replace(/\/$/, '');
  const loginResp = await loginVehicleTrackingOdoo({ username, password, db });
  const headers = await getOdooAuthHeaders();
  if (loginResp && loginResp.cookies) headers.Cookie = loginResp.cookies;

  const fuelPayload = {
    vehicle_tracking_id: Number(tripId),
    vehicle_id: vehicleId ? Number(vehicleId) : undefined,
    driver_id: driverId ? Number(driverId) : undefined,
    amount: amount != null && amount !== '' ? Number(amount) : undefined,
    fuel_level: fuelLevel != null && fuelLevel !== '' ? Number(fuelLevel) : undefined,
    odometer: odometer != null && odometer !== '' ? Number(odometer) : undefined,
    gps_lat: gpsLat || undefined,
    gps_long: gpsLong || undefined,
  };

  // Optional images — convert local file URI to base64.
  const readB64 = async (uri) => {
    if (!uri || (!uri.startsWith('file://') && !uri.startsWith('/'))) return null;
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      return b64 && b64.length > 0 ? b64 : null;
    } catch (e) {
      console.warn('[fuel.log] failed to read file for base64:', e?.message);
      return null;
    }
  };
  // Lift these to outer scope so we can reuse the in-memory base64 in the
  // snapshot return, regardless of whether Odoo's read-back gives us anything.
  let uploadedOdometerB64 = null;
  let uploadedReceiptB64 = null;
  if (odometerImageUri) {
    const b64 = await readB64(odometerImageUri);
    if (b64) {
      uploadedOdometerB64 = b64;
      fuelPayload.odometer_image = b64;
      const parts = String(odometerImageUri).split('/');
      fuelPayload.odometer_image_filename = parts[parts.length - 1] || 'odometer.jpg';
    }
  }
  if (fuelInvoiceUri) {
    const b64 = await readB64(fuelInvoiceUri);
    if (b64) {
      uploadedReceiptB64 = b64;
      // Receipt now lives on its own Binary field (Odoo `fields.Image`); the
      // legacy `upload_path` Char is no longer written from the app.
      fuelPayload.receipt_image = b64;
      const parts = String(fuelInvoiceUri).split('/');
      fuelPayload.receipt_image_filename = parts[parts.length - 1] || 'receipt.jpg';
    }
  }
  console.log('[createFuelLogOdoo] uploaded odometer b64 len=', uploadedOdometerB64?.length || 0,
    'receipt b64 len=', uploadedReceiptB64?.length || 0);

  Object.keys(fuelPayload).forEach(k => fuelPayload[k] === undefined && delete fuelPayload[k]);

  console.log('[createFuelLogOdoo] payload:', JSON.stringify({ ...fuelPayload, odometer_image: fuelPayload.odometer_image ? '<base64 omitted>' : undefined }));

  const resp = await axios.post(
    `${baseUrl}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        model: 'vehicle.fuel.log',
        method: 'create',
        args: [[fuelPayload]],
        kwargs: {},
      },
    },
    { headers, withCredentials: true, timeout: 15000 }
  );
  if (resp.data?.error) {
    const err = resp.data.error;
    const msg = err?.data?.message || err?.message || 'Unknown Odoo error';
    console.error('[createFuelLogOdoo] FAILED:', msg);
    throw new Error('Fuel log: ' + msg);
  }
  const newId = Array.isArray(resp.data?.result) ? resp.data.result[0] : resp.data?.result;
  if (!newId) throw new Error('Fuel log: no id returned from Odoo');
  console.log('[createFuelLogOdoo] created id:', newId);

  // Re-read the just-saved log with bin_size:false so we get the canonical
  // base64 from Odoo. Falls back to the local file URIs if read-back fails.
  let serverImages = { odometer_image: null, receipt_image: null };
  try {
    const readResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'vehicle.fuel.log',
          method: 'read',
          args: [[newId], ['odometer_image', 'receipt_image', 'name', 'create_date']],
          kwargs: { context: { bin_size: false } },
        },
      },
      { headers, withCredentials: true, timeout: 20000 }
    );
    const row = (readResp.data?.result || [])[0];
    console.log('[createFuelLogOdoo] read-back:',
      'odometer type=', typeof row?.odometer_image, 'len=', row?.odometer_image ? String(row.odometer_image).length : 0,
      '| receipt type=', typeof row?.receipt_image, 'len=', row?.receipt_image ? String(row.receipt_image).length : 0);
    if (row) {
      if (row.odometer_image && typeof row.odometer_image === 'string' && row.odometer_image.length > 0) {
        serverImages.odometer_image = `data:image/jpeg;base64,${row.odometer_image}`;
      }
      if (row.receipt_image && typeof row.receipt_image === 'string' && row.receipt_image.length > 0) {
        serverImages.receipt_image = `data:image/jpeg;base64,${row.receipt_image}`;
      }
    }
  } catch (readErr) {
    console.warn('[createFuelLogOdoo] read-back failed:', readErr?.message);
  }

  // Use the in-memory base64 we already read for the upload — bulletproof
  // fallback if the server read-back returns nothing.
  const localOdometerDataUri = uploadedOdometerB64 ? `data:image/jpeg;base64,${uploadedOdometerB64}` : null;
  const localReceiptDataUri  = uploadedReceiptB64  ? `data:image/jpeg;base64,${uploadedReceiptB64}`  : null;

  const snapshot = {
    id: newId,
    amount: fuelPayload.amount || 0,
    fuel_level: fuelPayload.fuel_level || 0,
    odometer: fuelPayload.odometer || 0,
    create_date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    driver_name: '',
    gps_lat: fuelPayload.gps_lat || '',
    gps_long: fuelPayload.gps_long || '',
    // Priority: Odoo read-back → in-memory upload base64 → raw local file URI.
    odometer_image: serverImages.odometer_image || localOdometerDataUri || odometerImageUri || null,
    receipt_image:  serverImages.receipt_image  || localReceiptDataUri  || fuelInvoiceUri  || null,
  };
  console.log('[createFuelLogOdoo] returning snapshot — odometer_image len=',
    snapshot.odometer_image ? String(snapshot.odometer_image).length : 0,
    'receipt_image len=', snapshot.receipt_image ? String(snapshot.receipt_image).length : 0);
  return snapshot;
};

// api/services/generalApi.js
import axios from "axios";
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import ODOO_BASE_URL, { DEFAULT_ODOO_DB, DEFAULT_USERNAME, DEFAULT_PASSWORD } from '@api/config/odooConfig';
import VEHICLE_TRACKING_BASE_URL, { DEFAULT_VEHICLE_TRACKING_DB, DEFAULT_VEHICLE_TRACKING_USERNAME, DEFAULT_VEHICLE_TRACKING_PASSWORD } from '@api/config/vehicleTrackingConfig';
// Helper: Authenticate to vehicle tracking Odoo DB and return session cookie
export const loginVehicleTrackingOdoo = async ({ username = DEFAULT_VEHICLE_TRACKING_USERNAME, password = DEFAULT_VEHICLE_TRACKING_PASSWORD, db = DEFAULT_VEHICLE_TRACKING_DB } = {}) => {
  const baseUrl = (VEHICLE_TRACKING_BASE_URL() || '').replace(/\/$/, '');
  // Since vehicle tracking uses the same Odoo server, reuse the existing session cookie
  try {
    const stored = await AsyncStorage.getItem('odoo_cookie');
    if (stored) {
      return { session_id: null, cookies: stored };
    }
  } catch (e) {
    // ignore and continue to authenticate
  }
  try {
    const response = await axios.post(
      `${baseUrl}/web/session/authenticate`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          db,
          login: username,
          password,
        },
      },
      { headers: { 'Content-Type': 'application/json' }, withCredentials: true }
    );
    if (response.data.error) {
      console.error('VehicleTracking Odoo login error:', response.data.error);
      throw new Error('VehicleTracking Odoo login error');
    }
    // Extract session cookie from response
    const setCookie = response.headers['set-cookie'] || response.headers['Set-Cookie'];
    // For React Native, axios may not expose cookies directly; use withCredentials and rely on cookie persistence
    // Return axios instance with cookie if possible
    try {
      if (setCookie) {
        const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
        await AsyncStorage.setItem('odoo_cookie', cookieStr);
        return { session_id: response.data.result && response.data.result.session_id, cookies: cookieStr };
      }
    } catch (e) {
      console.warn('Unable to persist vehicle tracking login cookie:', e?.message || e);
    }
    return { session_id: response.data.result && response.data.result.session_id, cookies: setCookie };
  } catch (error) {
    console.error('loginVehicleTrackingOdoo error:', error);
    throw error;
  }
};

// Helper: read stored odoo_cookie and return headers object
const getOdooAuthHeaders = async () => {
  try {
    const cookie = await AsyncStorage.getItem('odoo_cookie');
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    return headers;
  } catch (e) {
    return { 'Content-Type': 'application/json' };
  }
};


import { get } from "./utils";
import { API_ENDPOINTS } from "@api/endpoints";
import { useAuthStore } from '@stores/auth';
import handleApiError from "../utils/handleApiError";
import offlineQueue from '@utils/offlineQueue';
import { isOnline } from '@utils/networkStatus';

// Debugging output for useAuthStore
export const fetchProducts = async ({ offset, limit, categoryId, searchText }) => {
  try {
    const queryParams = {
      ...(searchText !== undefined && { product_name: searchText }),
      offset,
      limit,
      ...(categoryId !== undefined && { category_id: categoryId }),
    };
    // Debugging output for queryParams
    const response = await get(API_ENDPOINTS.VIEW_PRODUCTS, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};



// 🔹 NEW: Fetch products directly from Odoo 19 via JSON-RPC
// Shared category-name resolver. Used offline to rewrite stale cache entries
// and consistently pick: POS category (from @cache:categories) → last segment
// of product.category hierarchy → full hierarchy → empty.
const resolveProductCategoryName = async (posIds, categIdTuple) => {
  const ids = (posIds || []).filter((id) => Number.isFinite(id) && id > 0);
  if (ids.length) {
    try {
      const raw = await AsyncStorage.getItem('@cache:categories');
      if (raw) {
        const map = {};
        JSON.parse(raw).forEach((c) => {
          const id = c._id || c.id;
          if (id !== undefined) map[id] = c.category_name || c.name || '';
        });
        for (const pid of ids) {
          if (map[pid]) return { name: map[pid], source: `pos:${pid}` };
        }
      }
    } catch (_) {}
  }
  if (Array.isArray(categIdTuple) && categIdTuple[1]) {
    const full = String(categIdTuple[1]);
    const leaf = full.split('/').map((s) => s.trim()).filter(Boolean).pop();
    return { name: leaf || full, source: leaf ? 'categ_leaf' : 'categ_full' };
  }
  return { name: '', source: 'none' };
};

// Per-DB product cache key helpers. Each Odoo tenant gets its own namespace
// (`@cache:db:<db>:products[:cat:<id>]`) so DB A's products can never bleed
// into DB B's list — even if a refetch hasn't happened yet on the new DB.
const _currentDb = async () => {
  try { return (await AsyncStorage.getItem('odoo_db')) || ''; } catch (_) { return ''; }
};
const _productKey = async (suffix = '') => {
  const db = await _currentDb();
  const base = db ? `@cache:db:${db}:products` : '@cache:products';
  return suffix ? `${base}:${suffix}` : base;
};
// Filter a list of AsyncStorage keys down to the ones that hold product
// caches for the CURRENT db. Excludes detail keys.
const _currentDbProductKeys = async (allKeys) => {
  const db = await _currentDb();
  const prefix = db ? `@cache:db:${db}:products` : '@cache:products';
  return (allKeys || []).filter((k) => k.startsWith(prefix) && !k.includes('Detail'));
};

export const fetchProductsOdoo = async ({ offset, limit, searchText, categoryId, posCategoryId } = {}) => {
  try {
    console.log('[fetchProductsOdoo] CALLED with:', { offset, limit, searchText, categoryId, posCategoryId });
    // Build domain filters. Use the correct field based on category source:
    //   posCategoryId → pos_categ_ids (POS category many2many)
    //   categoryId    → categ_id (product.category)
    const filters = [];
    if (posCategoryId) {
      filters.push(["pos_categ_ids", "in", [Number(posCategoryId)]]);
    } else if (categoryId) {
      filters.push(["categ_id", "=", Number(categoryId)]);
    }
    if (searchText && searchText.trim() !== "") {
      filters.push(["name", "ilike", searchText.trim()]);
    }
    // Combine filters with AND (& prefix for each additional filter)
    let domain = [];
    if (filters.length === 1) {
      domain = [filters[0]];
    } else if (filters.length === 2) {
      domain = ["&", filters[0], filters[1]];
    }
    console.log('[fetchProductsOdoo] Domain:', JSON.stringify(domain));

    const odooLimit = limit || 50;
    const headers = await getOdooAuthHeaders();
    // Build the field list dynamically — `pos_categ_ids` only exists when the
    // `point_of_sale` module is installed. New tenants without POS would error
    // with "Invalid field 'pos_categ_ids' on 'product.product'", causing the
    // whole fetch to fail and the offline fallback to return stale cache from
    // the previous DB. We try with pos_categ_ids first; if that exact error
    // comes back, we retry without it.
    const baseFields = [
      "id", "name",
      "list_price", "lst_price", "standard_price",
      "product_tmpl_id", "default_code", "barcode",
      "uom_id", "image_128", "taxes_id", "categ_id",
    ];
    const callSearchRead = async (fields) => axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0", method: "call",
        params: {
          model: "product.product", method: "search_read", args: [],
          kwargs: { domain, fields, limit: odooLimit, order: "name asc" },
        },
      },
      { headers }
    );

    let response = await callSearchRead([...baseFields, "pos_categ_ids"]);
    if (response.data?.error) {
      const errMsg = String(response.data.error?.data?.message || response.data.error?.message || '');
      if (/pos_categ_ids/.test(errMsg) && /Invalid field/i.test(errMsg)) {
        console.log("[fetchProductsOdoo] pos_categ_ids not on this DB — retrying without it");
        // If the user filtered by pos category but the field doesn't exist,
        // the filter is meaningless on this DB — drop it and return all.
        if (posCategoryId) {
          const filtered = filters.filter((f) => f[0] !== 'pos_categ_ids');
          domain = filtered.length === 0 ? [] : (filtered.length === 1 ? [filtered[0]] : ["&", filtered[0], filtered[1]]);
        }
        response = await callSearchRead(baseFields);
      }
    }

    if (response.data.error) {
      console.log("Odoo JSON-RPC error (products):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }

    const products = response.data.result || [];
    console.log('[fetchProductsOdoo] Odoo returned', products.length, 'products');
    if (products.length > 0) {
      console.log('[fetchProductsOdoo] First product:', JSON.stringify(products[0]).substring(0, 200));
    }

    // DIAGNOSTIC: if we got 0 products, count total in DB and check permissions
    if (products.length === 0) {
      try {
        const countResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'product.product', method: 'search_count', args: [[]], kwargs: {} },
          },
          { headers }
        );
        console.log('[fetchProductsOdoo] DIAGNOSTIC — product.product count in DB:', countResp.data?.result);

        const tmplCountResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'product.template', method: 'search_count', args: [[]], kwargs: {} },
          },
          { headers }
        );
        console.log('[fetchProductsOdoo] DIAGNOSTIC — product.template count in DB:', tmplCountResp.data?.result);

        const sessionResp = await axios.post(
          `${ODOO_BASE_URL()}/web/session/get_session_info`,
          { jsonrpc: '2.0', method: 'call', params: {} },
          { headers }
        );
        const sess = sessionResp.data?.result || {};
        console.log('[fetchProductsOdoo] DIAGNOSTIC — session db:', sess.db, 'uid:', sess.uid, 'company:', sess.company_id, 'username:', sess.username);
      } catch (e) {
        console.log('[fetchProductsOdoo] DIAGNOSTIC failed:', e?.message);
      }
    }

    // Fetch tax rates for all unique tax IDs
    const allTaxIds = [...new Set(products.flatMap(p => p.taxes_id || []))];
    let taxMap = {};
    if (allTaxIds.length > 0) {
      try {
        const taxResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'account.tax',
              method: 'read',
              args: [allTaxIds],
              kwargs: { fields: ['id', 'name', 'amount', 'amount_type', 'price_include'] },
            },
          },
          { headers }
        );
        (taxResp.data?.result || []).forEach(t => {
          taxMap[t.id] = { name: t.name, amount: t.amount, amount_type: t.amount_type, price_include: t.price_include };
        });
      } catch (e) { console.warn('[fetchProductsOdoo] Could not fetch tax details:', e?.message); }
    }

    // Fetch template sales prices for all products
    let templatePriceMap = {};
    try {
      const tmplIds = [...new Set(products.map(p => Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id).filter(Boolean))];
      if (tmplIds.length > 0) {
        const tmplResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'product.template', method: 'read',
              args: [tmplIds],
              kwargs: { fields: ['id', 'list_price'] },
            },
          },
          { headers }
        );
        if (!tmplResp.data?.error) {
          const templates = tmplResp.data?.result || [];
          const tmplPriceMap = {};
          templates.forEach(t => { tmplPriceMap[t.id] = t.list_price; });
          // Map template prices to product IDs
          for (const p of products) {
            const tmplId = Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id;
            if (tmplId && tmplPriceMap[tmplId] !== undefined) {
              templatePriceMap[p.id] = tmplPriceMap[tmplId];
            }
          }
        }
      }
    } catch (e) {
      console.warn('[fetchProductsOdoo] Template price fetch failed:', e?.message);
    }

    // Resolve POS category names for every pos_categ_ids id across all
    // products — single batched Odoo call so the list always shows the real
    // POS name (e.g. "Drinks") instead of the generic product.category leaf
    // (e.g. "Goods"). Falls back to the last segment of the product.category
    // hierarchy when the product has no POS category.
    let posCatNameById = {};
    const allPosIds = [...new Set(
      products
        .flatMap((p) => Array.isArray(p.pos_categ_ids) ? p.pos_categ_ids : [])
        .filter((id) => Number.isFinite(id) && id > 0)
    )];
    console.log('[fetchProductsOdoo] Unique POS category ids to resolve:', allPosIds);
    if (allPosIds.length > 0) {
      try {
        const posResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'pos.category', method: 'read',
              args: [allPosIds],
              kwargs: { fields: ['id', 'name'] },
            },
          },
          { headers }
        );
        if (posResp.data?.error) {
          console.warn('[fetchProductsOdoo] pos.category.read error:', posResp.data.error?.data?.message);
        } else {
          const posRows = posResp.data?.result || [];
          posRows.forEach((r) => { if (r?.id) posCatNameById[r.id] = r.name || ''; });
          console.log('[fetchProductsOdoo] Resolved POS categories:', posCatNameById);
        }
      } catch (e) {
        console.warn('[fetchProductsOdoo] POS category name fetch failed:', e?.message);
      }
    }
    // Also fall back to the cached category list (picks up offline-created
    // categories) in case some ids weren't in pos.category (e.g. Odoo without
    // POS module uses product.category here).
    try {
      const rawCats = await AsyncStorage.getItem('@cache:categories');
      if (rawCats) {
        const cats = JSON.parse(rawCats);
        cats.forEach((c) => {
          const id = c._id || c.id;
          const name = c.category_name || c.name;
          if (id !== undefined && name && posCatNameById[id] === undefined) {
            posCatNameById[id] = name;
          }
        });
      }
    } catch (_) {}

    const categoryLeaf = (hierarchical) => {
      if (!hierarchical) return '';
      const parts = String(hierarchical).split('/').map((s) => s.trim()).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : String(hierarchical);
    };

    // 🔹 Shape to match existing ProductsList expectations
    const mapped = products.map((p) => {
      // If Odoo returned the image as base64 (image_128), prefer using a data URI
      const hasBase64 = p.image_128 && typeof p.image_128 === 'string' && p.image_128.length > 0;
      const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
      const imageUrl = hasBase64
        ? `data:image/png;base64,${p.image_128}`
        : `${baseUrl}/web/image?model=product.product&id=${p.id}&field=image_128`;

      // Calculate total tax percentage for this product
      const productTaxIds = p.taxes_id || [];
      const productTaxes = productTaxIds.map(tid => taxMap[tid]).filter(Boolean);
      const taxPercent = productTaxes.reduce((sum, t) => {
        if (t.amount_type === 'percent') return sum + (t.amount || 0);
        return sum;
      }, 0);

      // Resolve category name: POS category (from batch fetch) → cached
      // categories fallback → last segment of product.category hierarchy →
      // full categ_id hierarchy path → empty. Log which branch fired per
      // product so we can debug missing names.
      const posIds = Array.isArray(p.pos_categ_ids) ? p.pos_categ_ids.filter((id) => Number.isFinite(id) && id > 0) : [];
      let resolvedCategoryName = '';
      let resolvedFrom = 'none';
      for (const pid of posIds) {
        if (posCatNameById[pid]) { resolvedCategoryName = posCatNameById[pid]; resolvedFrom = `pos:${pid}`; break; }
      }
      if (!resolvedCategoryName && p.categ_id && Array.isArray(p.categ_id)) {
        resolvedCategoryName = categoryLeaf(p.categ_id[1]);
        if (resolvedCategoryName) resolvedFrom = 'categ_leaf';
      }
      if (!resolvedCategoryName && p.categ_id && Array.isArray(p.categ_id) && p.categ_id[1]) {
        resolvedCategoryName = String(p.categ_id[1]);
        resolvedFrom = 'categ_full';
      }
      if (!resolvedCategoryName) {
        console.warn('[fetchProductsOdoo] No category for product id=', p.id, 'name=', p.name, 'pos_categ_ids=', posIds, 'categ_id=', p.categ_id);
      } else {
        console.log('[fetchProductsOdoo] Product', p.id, p.name, '→ category:', resolvedCategoryName, '(from', resolvedFrom + ')');
      }

      return {
        id: p.id,
        product_name: p.name || "",
        image_url: imageUrl,
        price: templatePriceMap[p.id] || p.lst_price || p.list_price || 0,
        list_price: p.list_price || 0,
        standard_price: p.standard_price || 0,
        code: p.default_code || "",
        barcode: p.barcode || "",
        uom: p.uom_id
          ? { uom_id: p.uom_id[0], uom_name: p.uom_id[1] }
          : null,
        tax_percent: taxPercent,
        taxes: productTaxes,
        qty_available: 0,
        categ_id: p.categ_id && Array.isArray(p.categ_id) ? p.categ_id : null,
        category_name: resolvedCategoryName,
        category: resolvedCategoryName ? { category_name: resolvedCategoryName, name: resolvedCategoryName } : null,
        pos_categ_ids: posIds,
      };
    });

    // Cache for offline viewing (only base list, not search results), under
    // a DB-scoped key so each tenant has its own product list.
    if (!searchText) {
      const suffix = (posCategoryId || categoryId) ? `cat:${posCategoryId || categoryId}` : '';
      const key = await _productKey(suffix);
      try { await AsyncStorage.setItem(key, JSON.stringify(mapped)); } catch (_) {}
    }

    return mapped;
  } catch (error) {
    console.error("fetchProductsOdoo error:", error);
    // Offline fallback — return cached products from the current DB only.
    try {
      const preferredSuffix = (posCategoryId || categoryId) ? `cat:${posCategoryId || categoryId}` : '';
      const preferredKey = await _productKey(preferredSuffix);

      let list = [];

      // First try the preferred cache key
      const cached = await AsyncStorage.getItem(preferredKey);
      if (cached) {
        list = JSON.parse(cached);
      }

      // If no category filter (= "All") and preferred cache is missing OR empty,
      // merge ALL cached category lists we've accumulated so far
      if (!posCategoryId && !categoryId) {
        const allKeys = await AsyncStorage.getAllKeys();
        // Restrict the merge to current-DB product keys only — never bleed
        // products from another tenant into "All".
        const productKeys = await _currentDbProductKeys(allKeys);
        const merged = [];
        const seenIds = new Set();
        // Start with whatever was in the main cache
        for (const p of list) {
          if (p?.id && !seenIds.has(p.id)) {
            seenIds.add(p.id);
            merged.push(p);
          }
        }
        // Merge in every category-specific cache
        for (const key of productKeys) {
          if (key === preferredKey) continue; // already included
          try {
            const raw = await AsyncStorage.getItem(key);
            if (raw) {
              const arr = JSON.parse(raw);
              for (const p of arr) {
                if (p?.id && !seenIds.has(p.id)) {
                  seenIds.add(p.id);
                  merged.push(p);
                }
              }
            }
          } catch (_) {}
        }
        list = merged;
      }

      // Re-resolve empty/stale category_name using the cached POS categories
      // so old cache entries (written before the resolver landed) still show
      // the correct category name offline.
      for (const p of list) {
        if (!p.category_name) {
          const { name, source } = await resolveProductCategoryName(p.pos_categ_ids, p.categ_id);
          if (name) {
            p.category_name = name;
            p.category = { category_name: name, name };
            console.log('[fetchProductsOdoo] offline re-resolved category for', p.id, p.product_name, '→', name, '(from', source + ')');
          }
        }
      }

      // Apply search filter client-side when offline
      if (searchText && searchText.trim() !== '') {
        const term = searchText.trim().toLowerCase();
        list = list.filter(p =>
          (p.product_name || '').toLowerCase().includes(term) ||
          (p.code || '').toLowerCase().includes(term)
        );
      }
      console.log('[fetchProductsOdoo] Using cached products, filtered count:', list.length);
      return list;
    } catch (_) {}
    throw error;
  }
};

// Search the AsyncStorage product caches (populated by fetchProductsOdoo) for
// a barcode or default_code match. Returns [match] or [] — never throws.
const _findProductInCacheByBarcode = async (barcode) => {
  const target = String(barcode || '').trim().toLowerCase();
  if (!target) return [];
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const productKeys = await _currentDbProductKeys(allKeys);
    for (const key of productKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const list = JSON.parse(raw);
        const match = list.find((p) => {
          const code = p?.code != null ? String(p.code).trim().toLowerCase() : '';
          const bc = p?.barcode != null ? String(p.barcode).trim().toLowerCase() : '';
          return (code && code === target) || (bc && bc === target);
        });
        if (match) {
          console.log('[fetchProductByBarcodeOdoo] Offline match in', key, 'id:', match.id);
          return [match];
        }
      } catch (_) {}
    }
    // Last-resort: search per-product detail caches — individual products
    // viewed in detail get written to @cache:productDetail:<id> with their
    // barcode, so a scanned product that was previously opened online can
    // still be resolved even if its category list isn't cached.
    const detailKeys = allKeys.filter((k) => k.startsWith('@cache:productDetail:'));
    for (const key of detailKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const p = JSON.parse(raw);
        const code = p?.code != null ? String(p.code).trim().toLowerCase() : '';
        const bc = p?.barcode != null ? String(p.barcode).trim().toLowerCase() : '';
        if ((code && code === target) || (bc && bc === target)) {
          console.log('[fetchProductByBarcodeOdoo] Offline match in detail cache', key, 'id:', p.id);
          return [p];
        }
      } catch (_) {}
    }
  } catch (_) {}
  return [];
};

// Fetch product by barcode from Odoo
export const fetchProductByBarcodeOdoo = async (barcode) => {
  // Offline short-circuit — skip the axios call entirely and use the same
  // cache that the online list view writes to. This matches how the online
  // flow resolves a scanned barcode (search cached products → return match),
  // just without going through Odoo.
  try {
    const online = await isOnline();
    if (!online) {
      return await _findProductInCacheByBarcode(barcode);
    }
  } catch (_) { /* fall through to online path */ }

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "product.product",
          method: "search_read",
          args: [],
          kwargs: {
            domain: [["barcode", "=", barcode]],
            fields: [
              "id",
              "name",
              "list_price",
              "lst_price",
              "standard_price",
              "default_code",
              "barcode",
              "uom_id",
              "image_128",
              "categ_id",
            ],
            limit: 1,
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    const products = response.data.result || [];

    // Fetch template sales prices
    let templatePriceMap = {};
    if (products.length > 0) {
      try {
        // Need product_tmpl_id — fetch it if not already available
        const prodWithTmpl = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'product.product', method: 'read',
              args: [products.map(p => p.id)],
              kwargs: { fields: ['id', 'product_tmpl_id'] },
            },
          },
          { headers }
        );
        const tmplIds = [...new Set((prodWithTmpl.data?.result || []).map(p => Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id).filter(Boolean))];
        if (tmplIds.length > 0) {
          const tmplResp = await axios.post(
            `${ODOO_BASE_URL()}/web/dataset/call_kw`,
            {
              jsonrpc: '2.0', method: 'call',
              params: {
                model: 'product.template', method: 'read',
                args: [tmplIds],
                kwargs: { fields: ['id', 'list_price'] },
              },
            },
            { headers }
          );
          if (!tmplResp.data?.error) {
            const tmplPrices = {};
            (tmplResp.data?.result || []).forEach(t => { tmplPrices[t.id] = t.list_price; });
            (prodWithTmpl.data?.result || []).forEach(p => {
              const tmplId = Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id;
              if (tmplId && tmplPrices[tmplId] !== undefined) {
                templatePriceMap[p.id] = tmplPrices[tmplId];
              }
            });
          }
        }
      } catch (e) { console.warn('[fetchProductByBarcodeOdoo] Template price fetch failed:', e?.message); }
    }

    return products.map((p) => {
      const hasBase64 = p.image_128 && typeof p.image_128 === 'string' && p.image_128.length > 0;
      const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
      const imageUrl = hasBase64
        ? `data:image/png;base64,${p.image_128}`
        : `${baseUrl}/web/image?model=product.product&id=${p.id}&field=image_128`;

      return {
        id: p.id,
        product_name: p.name || "",
        image_url: imageUrl,
        price: templatePriceMap[p.id] || p.lst_price || p.list_price || 0,
        standard_price: p.standard_price || 0,
        code: p.default_code || "",
        barcode: p.barcode || "",
        category: p.categ_id ? p.categ_id[1] : "",
        uom: p.uom_id ? { uom_id: p.uom_id[0], uom_name: p.uom_id[1] } : null,
      };
    });
  } catch (error) {
    console.error("fetchProductByBarcodeOdoo error:", error);
    // Network error fallback — try the same offline cache path.
    const offline = await _findProductInCacheByBarcode(barcode);
    if (offline.length > 0) return offline;
    throw error;
  }
};

// Upsert a product into the cached product lists so an offline barcode scan
// can find it immediately after the product is created/edited — without
// waiting for a full fetchProductsOdoo refresh. Safe to call after a
// successful product save even if we're offline (the product shape coming
// back from create/update matches the cached list shape).
export const upsertProductInBarcodeCache = async (product) => {
  if (!product || !product.id) return;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const productKeys = await _currentDbProductKeys(allKeys);
    // Always write to the main list so an "All" scan finds it, even if the
    // product has no category cache yet.
    const mainKey = await _productKey();
    if (!productKeys.includes(mainKey)) productKeys.push(mainKey);
    for (const key of productKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        const idx = list.findIndex((p) => p.id === product.id);
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...product };
        } else if (key === mainKey) {
          list.unshift(product);
        } else {
          continue; // don't add to a category cache we can't verify membership for
        }
        await AsyncStorage.setItem(key, JSON.stringify(list));
      } catch (_) {}
    }
  } catch (_) {}
};

// Fetch users from Odoo using JSON-RPC (res.users model)
export const fetchUsersOdoo = async ({ offset = 0, limit = 50, searchText = "" } = {}) => {
  try {
    let domain = [["active", "=", true]];
    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain = ["&", ["active", "=", true], ["name", "ilike", term]];
    }

    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.users",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: ["id", "name", "login", "email", "partner_id", "image_128"],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log("Odoo JSON-RPC error (users):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }

    const users = response.data.result || [];

    return users.map((u) => ({
      id: u.id,
      _id: u.id,
      name: u.name || "",
      login: u.login || "",
      email: u.email || "",
      partner_id: u.partner_id ? { id: u.partner_id[0], name: u.partner_id[1] } : null,
      image_url: u.image_128 && typeof u.image_128 === 'string' && u.image_128.length > 0
        ? `data:image/png;base64,${u.image_128}`
        : null,
    }));
  } catch (error) {
    console.error("fetchUsersOdoo error:", error);
    throw error;
  }
};

// src/api/services/generalApi.js
// Ensure this points to your Odoo URL

// Fetch categories directly from Odoo using JSON-RPC
export const fetchCategoriesOdoo = async ({ offset = 0, limit = 50, searchText = "" } = {}) => {
  try {
    let domain = [];
    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain = [["name", "ilike", term]];
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "product.category",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: ["id", "name", "parent_id", "sequence_no", "image_128"],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log("Odoo JSON-RPC error (categories):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }

    const categories = response.data.result || [];

    const mapped = categories.map((c) => {
      const imageUrl = c.image_128 ? `data:image/png;base64,${c.image_128}` : null;
      const seq = c.sequence_no && c.sequence_no !== false ? parseInt(c.sequence_no, 10) : null;
      return {
        _id: c.id,
        name: c.name || "",
        category_name: c.name || "",
        image_url: imageUrl,
        parent_id: c.parent_id ? { id: c.parent_id[0], name: c.parent_id[1] } : null,
        sequence_no: isNaN(seq) ? null : seq,
      };
    });
    // Sort: sequenced categories first (by sequence number), then unsequenced alphabetically
    mapped.sort((a, b) => {
      const aHas = a.sequence_no !== null;
      const bHas = b.sequence_no !== null;
      if (aHas && bHas) return a.sequence_no - b.sequence_no;
      if (aHas) return -1;
      if (bHas) return 1;
      return a.name.localeCompare(b.name);
    });
    return mapped;
  } catch (error) {
    console.error("fetchCategoriesOdoo error:", error);
    throw error;
  }
};

// Fetch product categories (lightweight, for filter chips)
export const fetchProductCategoriesOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'product.category',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: ['id', 'name'], limit: 200, order: 'name asc' },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[fetchProductCategories] error:', response.data.error?.data?.message);
      return [];
    }
    return (response.data.result || []).map(c => ({ id: c.id, name: c.name || '' }));
  } catch (error) {
    console.error('[fetchProductCategories] error:', error?.message || error);
    return [];
  }
};

// Fetch POS categories for home screen display
export const fetchPosCategoriesOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    // Try pos.category first, fall back to product.category if POS module not installed
    let model = 'pos.category';
    let fields = ['id', 'name', 'image_128', 'parent_id', 'color'];
    let response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model, method: 'search_read', args: [[]],
        kwargs: { fields, limit: 100, order: 'sequence asc, name asc' } },
    }, { headers, timeout: 15000 });

    // If pos.category fails (404 or error), try product.category
    if (response.data.error || (typeof response.data === 'string')) {
      console.log('[fetchPosCategoriesOdoo] pos.category not available, using product.category');
      model = 'product.category';
      fields = ['id', 'name', 'parent_id'];
      response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model, method: 'search_read', args: [[]],
          kwargs: { fields, limit: 100, order: 'name asc' } },
      }, { headers, timeout: 15000 });
    }

    if (response.data.error) {
      console.error('[fetchPosCategoriesOdoo] error:', response.data.error?.data?.message);
      // Fall back to cache on Odoo error
      try {
        const cached = await AsyncStorage.getItem('@cache:categories');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
    const mapped = (response.data.result || []).map(c => ({
      _id: c.id,
      id: c.id,
      name: c.name || '',
      category_name: c.name || '',
      image_url: c.image_128 ? `data:image/png;base64,${c.image_128}` : null,
      image_base64: c.image_128 || null,
      parent_id: c.parent_id || null,
      color: c.color ?? 0,
      _source: model, // 'pos.category' or 'product.category' — tells the form which field to set
    }));
    // Cache for offline viewing
    try { await AsyncStorage.setItem('@cache:categories', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('[fetchPosCategoriesOdoo] error:', error?.message || error);
    // Offline fallback — return cached categories
    try {
      const cached = await AsyncStorage.getItem('@cache:categories');
      if (cached) {
        console.log('[fetchPosCategoriesOdoo] Using cached categories');
        return JSON.parse(cached);
      }
    } catch (_) {}
    return [];
  }
};

// Compute per-category counts from the cached product list. Used offline
// and as a fallback when Odoo search_count fails. Iterates @cache:products
// (and per-category slices) and tallies pos_categ_ids / categ_id matches.
const _countCategoriesFromCache = async (categoryIds, source) => {
  const out = { all: 0 };
  try {
    // Merge every product cache key for the CURRENT db (main list + any
    // per-category slices) into a de-duped product array keyed by id.
    const allKeys = await AsyncStorage.getAllKeys();
    const productKeys = await _currentDbProductKeys(allKeys);
    const byId = new Map();
    for (const key of productKeys) {
      try {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) continue;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) continue;
        for (const p of list) {
          if (p && p.id != null && !byId.has(p.id)) byId.set(p.id, p);
        }
      } catch (_) {}
    }
    const products = Array.from(byId.values());
    out.all = products.length;
    for (const cid of categoryIds) {
      let count = 0;
      for (const p of products) {
        if (source === 'pos.category') {
          const ids = Array.isArray(p.pos_categ_ids) ? p.pos_categ_ids : [];
          if (ids.some((x) => Number(x) === Number(cid))) count += 1;
        } else {
          const ci = Array.isArray(p.categ_id) ? p.categ_id[0] : p.categ_id;
          if (Number(ci) === Number(cid)) count += 1;
        }
      }
      out[cid] = count;
    }
  } catch (e) {
    console.warn('[_countCategoriesFromCache] error:', e?.message);
  }
  return out;
};

// Fetch a count of products per POS (or product) category. Returns an
// object keyed by category id with the number of products in that category
// plus a special "all" key with the total product count.
//
// Online: uses parallel Odoo search_count RPCs, caches result for offline.
// Offline: computes counts from @cache:products instead of returning zeros.
export const fetchPosCategoryCountsOdoo = async (categoryIds, source = 'pos.category') => {
  const out = { all: 0 };
  if (!categoryIds || categoryIds.length === 0) return out;

  // Offline short-circuit — count from cached products so chips aren't all zero.
  try {
    const online = await isOnline();
    if (!online) {
      console.log('[fetchPosCategoryCountsOdoo] OFFLINE → computing from cache');
      const local = await _countCategoriesFromCache(categoryIds, source);
      // Prefer last known online counts if we saved them — more accurate
      // than the subset of products currently in the cache.
      try {
        const raw = await AsyncStorage.getItem('@cache:categoryCounts');
        if (raw) {
          const saved = JSON.parse(raw) || {};
          // Merge: saved online counts win, but fill gaps from local tally.
          const merged = { ...local, ...saved };
          return merged;
        }
      } catch (_) {}
      return local;
    }
  } catch (_) { /* fall through to online attempt */ }

  try {
    const headers = await getOdooAuthHeaders();
    const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
    const fieldName = source === 'pos.category' ? 'pos_categ_ids' : 'categ_id';

    const allResp = axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: { model: 'product.product', method: 'search_count', args: [[]], kwargs: {} } },
      { headers, timeout: 15000 }
    );
    const perCatResps = categoryIds.map((cid) =>
      axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0', method: 'call',
          params: {
            model: 'product.product', method: 'search_count',
            args: [[[fieldName, source === 'pos.category' ? 'in' : '=', source === 'pos.category' ? [cid] : cid]]],
            kwargs: {},
          },
        },
        { headers, timeout: 15000 }
      ).then((r) => ({ cid, count: r.data?.result || 0 })).catch(() => ({ cid, count: 0 }))
    );

    const [allCountResp, ...perCat] = await Promise.all([allResp, ...perCatResps]);
    out.all = allCountResp?.data?.result || 0;
    for (const row of perCat) out[row.cid] = row.count;
    // Persist for offline reuse — next time the app is opened without
    // internet the chips show the last known accurate counts.
    try { await AsyncStorage.setItem('@cache:categoryCounts', JSON.stringify(out)); } catch (_) {}
    return out;
  } catch (e) {
    console.warn('[fetchPosCategoryCountsOdoo] error, falling back to cache:', e?.message);
    // Network call failed (timeout, DNS, etc.) — try cache so the UI isn't zero.
    try {
      const raw = await AsyncStorage.getItem('@cache:categoryCounts');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    const local = await _countCategoriesFromCache(categoryIds, source);
    return local;
  }
};

// Create a new POS category in Odoo
export const createPosCategoryOdoo = async ({ name, parentId, color, image }) => {
  const vals = { name };
  if (parentId) vals.parent_id = parentId;
  if (color !== undefined && color !== null) vals.color = color;

  // Offline check — queue without image (Option 3: no images offline)
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({
        model: 'pos.category',
        operation: 'create',
        values: vals,
      });
      // Append to cached category list so it shows immediately on Home and forms
      try {
        const placeholder = {
          _id: `offline_${localId}`,
          id: `offline_${localId}`,
          name: name || '',
          category_name: name || '',
          image_url: null,
          image_base64: null,
          parent_id: parentId || null,
          color: color || 0,
          _source: 'pos.category',
          offline: true,
        };
        const cached = await AsyncStorage.getItem('@cache:categories');
        const list = cached ? JSON.parse(cached) : [];
        list.push(placeholder);
        await AsyncStorage.setItem('@cache:categories', JSON.stringify(list));
      } catch (_) {}
      console.log('[createPosCategoryOdoo] Queued offline, localId:', localId);
      return { offline: true, localId, id: `offline_${localId}`, name };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'pos.category', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 60000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create category');
    const newId = response.data.result;
    // Upload image separately if provided
    if (image && newId) {
      await uploadPosCategoryImageOdoo(newId, image);
    }
    return newId;
  } catch (error) {
    console.error('[createPosCategoryOdoo] error:', error?.message || error);
    throw error;
  }
};

// Update an existing POS category in Odoo
export const updatePosCategoryOdoo = async (id, { name, parentId, color, image }) => {
  // Offline branch — queue the edit, mutate cache in place. Images skipped offline.
  try {
    const online = await isOnline();
    if (!online) {
      const vals = {};
      if (name !== undefined) vals.name = name;
      if (parentId !== undefined) vals.parent_id = parentId || false;
      if (color !== undefined && color !== null) vals.color = color;

      const idStr = String(id);
      if (idStr.startsWith('offline_')) {
        // Edit of an offline-created category that hasn't synced yet —
        // fold the edit into the pending create's values.
        const queueItemId = idStr.replace('offline_', '');
        await offlineQueue.updateValues(queueItemId, vals);
      } else {
        // Edit of a real Odoo record — queue a write op.
        // Resolve category model from cache to call the right Odoo model.
        let model = 'pos.category';
        try {
          const cached = await AsyncStorage.getItem('@cache:categories');
          if (cached) {
            const match = JSON.parse(cached).find(c => (c._id === id || c.id === id));
            if (match?._source) model = match._source;
          }
        } catch (_) {}
        await offlineQueue.enqueue({
          model,
          operation: 'write',
          values: { _recordId: id, ...vals },
        });
      }

      // Mutate cache in place so the UI reflects the edit immediately.
      try {
        const raw = await AsyncStorage.getItem('@cache:categories');
        if (raw) {
          const list = JSON.parse(raw);
          const idx = list.findIndex(c => (c._id === id || c.id === id));
          if (idx >= 0) {
            const merged = { ...list[idx] };
            if (name !== undefined) { merged.name = name; merged.category_name = name; }
            if (parentId !== undefined) merged.parent_id = parentId || null;
            if (color !== undefined && color !== null) merged.color = color;
            list[idx] = merged;
            await AsyncStorage.setItem('@cache:categories', JSON.stringify(list));
          }
        }
      } catch (_) {}

      console.log('[updatePosCategoryOdoo] Queued offline edit for id:', id);
      return { offline: true };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const vals = {};
    if (name !== undefined) vals.name = name;
    if (parentId !== undefined) vals.parent_id = parentId || false;
    if (color !== undefined && color !== null) vals.color = color;
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'pos.category', method: 'write', args: [[id], vals], kwargs: {} },
    }, { headers, timeout: 60000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to update category');
    // Upload image separately if provided
    if (image) {
      await uploadPosCategoryImageOdoo(id, image);
    }
    return response.data.result;
  } catch (error) {
    console.error('[updatePosCategoryOdoo] error:', error?.message || error);
    throw error;
  }
};

// Upload image to POS category - separate call for reliability
export const uploadPosCategoryImageOdoo = async (categoryId, base64Image) => {
  try {
    const headers = await getOdooAuthHeaders();
    console.log('[uploadPosCategoryImage] Uploading image for category', categoryId, 'size:', base64Image.length);
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'pos.category',
        method: 'write',
        args: [[categoryId], { image_128: base64Image }],
        kwargs: {},
      },
    }, { headers, timeout: 120000 });
    if (response.data.error) {
      console.error('[uploadPosCategoryImage] Odoo error:', JSON.stringify(response.data.error));
      throw new Error(response.data.error?.data?.message || 'Failed to upload image');
    }
    console.log('[uploadPosCategoryImage] Success, result:', response.data.result);
    return response.data.result;
  } catch (error) {
    console.error('[uploadPosCategoryImage] error:', error?.message || error);
    // Don't throw — image failure shouldn't block category save
    console.warn('[uploadPosCategoryImage] Image upload failed but category was saved');
  }
};

// Fetch detailed product information for a single Odoo product id
export const fetchProductDetailsOdoo = async (productId) => {
  try {
    if (!productId) return null;

    // 1. Fetch product details
    const headers = await getOdooAuthHeaders();
    const productResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'product.product',
          method: 'search_read',
          args: [[['id', '=', productId]]],
          kwargs: {
            fields: [
              'id', 'name', 'list_price', 'lst_price', 'standard_price', 'default_code', 'barcode', 'uom_id', 'image_128',
              'description_sale', 'categ_id', 'pos_categ_ids'
            ],
            limit: 1,
          },
        },
      },
      { headers }
    );

    if (productResponse.data.error) throw new Error('Odoo JSON-RPC error');
    const results = productResponse.data.result || [];
    const p = results[0];
    if (!p) return null;

    // 2. Fetch warehouse/stock info
    const quantHeaders = await getOdooAuthHeaders();
    const quantResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'stock.quant',
          method: 'search_read',
          args: [[
            ['product_id', '=', productId],
            ['location_id.usage', '=', 'internal'],
          ]],
          kwargs: {
            fields: ['location_id', 'quantity'],
          },
        },
      },
      { headers: quantHeaders }
    );

    let inventory_ledgers = [];
    if (quantResponse.data && quantResponse.data.result) {
      inventory_ledgers = quantResponse.data.result
        .filter(q => q.quantity !== 0)
        .map(q => ({
          warehouse_id: Array.isArray(q.location_id) ? q.location_id[0] : null,
          warehouse_name: Array.isArray(q.location_id) ? q.location_id[1] : '',
          total_warehouse_quantity: q.quantity,
        }));
    }

    // 3. Shape and return
    const hasBase64 = p.image_128 && typeof p.image_128 === 'string' && p.image_128.length > 0;
    const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
    const imageUrl = hasBase64
      ? `data:image/png;base64,${p.image_128}`
      : `${baseUrl}/web/image?model=product.product&id=${p.id}&field=image_128`;

    // Fetch POS category name
    let posCategoryName = '';
    const posCategIds = (p.pos_categ_ids || []).filter((id) => Number.isFinite(id) && id > 0);
    console.log('[fetchProductDetailsOdoo] id=', p.id, 'name=', p.name, 'categ_id=', p.categ_id, 'pos_categ_ids=', posCategIds);

    if (posCategIds.length > 0) {
      try {
        const posCatResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'pos.category',
              method: 'read',
              args: [posCategIds],
              kwargs: { fields: ['id', 'name'] },
            },
          },
          { headers }
        );
        if (posCatResp.data?.error) {
          console.warn('[fetchProductDetailsOdoo] pos.category.read error:', posCatResp.data.error?.data?.message);
        }
        const posCatResult = posCatResp.data?.result || [];
        console.log('[fetchProductDetailsOdoo] POS cat result:', JSON.stringify(posCatResult));
        if (posCatResult.length > 0) {
          // Pick the first non-empty name so one-stale-id doesn't blank the whole thing.
          const match = posCatResult.find((r) => r?.name);
          posCategoryName = match?.name || '';
        }
      } catch (e) { console.warn('[fetchProductDetailsOdoo] POS category fetch failed:', e?.message); }
    }

    // Use POS category name first, then last segment of product.category,
    // then the full hierarchy. Log what we resolved and why.
    const categLeafName = p.categ_id && Array.isArray(p.categ_id)
      ? String(p.categ_id[1] || '').split('/').map((s) => s.trim()).filter(Boolean).pop() || ''
      : '';
    const categFullName = p.categ_id && Array.isArray(p.categ_id) ? String(p.categ_id[1] || '') : '';
    const finalCategoryName = posCategoryName || categLeafName || categFullName || '';
    const resolvedFrom = posCategoryName
      ? 'pos'
      : categLeafName
        ? 'categ_leaf'
        : categFullName
          ? 'categ_full'
          : 'none';
    console.log('[fetchProductDetailsOdoo] finalCategoryName:', finalCategoryName, '(from', resolvedFrom + ')');
    if (!finalCategoryName) {
      console.warn('[fetchProductDetailsOdoo] No category for product id=', p.id, 'pos_categ_ids=', posCategIds, 'categ_id=', p.categ_id);
    }

    const detailObj = {
      id: p.id,
      product_name: p.name || '',
      image_url: imageUrl,
      price: p.lst_price || p.list_price || 0,
      standard_price: p.standard_price || 0,
      minimal_sales_price: p.lst_price || p.list_price || null,
      inventory_ledgers,
      total_product_quantity: p.qty_available ?? p.virtual_available ?? 0,
      inventory_box_products_details: [],
      product_code: p.default_code || '',
      barcode: p.barcode || '',
      uom: p.uom_id ? { uom_id: p.uom_id[0], uom_name: p.uom_id[1] } : null,
      categ_id: p.categ_id && Array.isArray(p.categ_id) ? p.categ_id : null,
      pos_categ_ids: posCategIds,
      category_name: finalCategoryName,
      product_description: p.description_sale || '',
    };
    // Cache this product's details for offline viewing
    try { await AsyncStorage.setItem(`@cache:productDetail:${productId}`, JSON.stringify(detailObj)); } catch (_) {}
    return detailObj;
  } catch (error) {
    console.error('fetchProductDetailsOdoo error:', error);
    // Offline fallback — return cached detail for this product. Re-resolve
    // category_name using the cached POS category list so a stale cache entry
    // (written before the resolver landed) still shows the correct category.
    try {
      const cached = await AsyncStorage.getItem(`@cache:productDetail:${productId}`);
      if (cached) {
        console.log('[fetchProductDetailsOdoo] Using cached detail for product:', productId);
        const obj = JSON.parse(cached);
        if (!obj.category_name) {
          const { name, source } = await resolveProductCategoryName(obj.pos_categ_ids, obj.categ_id);
          if (name) {
            obj.category_name = name;
            console.log('[fetchProductDetailsOdoo] offline re-resolved category →', name, '(from', source + ')');
          }
        }
        return obj;
      }
    } catch (_) {}
    throw error;
  }
};


export const fetchInventoryBoxRequest = async ({ offset, limit, searchText }) => {
  const currentUser = useAuthStore.getState().user; // Correct usage of useAuthStore
  const salesPersonId = currentUser.related_profile._id;

  // Debugging output for salesPersonId
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { name: searchText }),
      ...(salesPersonId !== undefined && { sales_person_id: salesPersonId })
    };
    const response = await get(API_ENDPOINTS.VIEW_INVENTORY_BOX_REQUEST, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchAuditing = async ({ offset, limit }) => {
  // Try Odoo first, fall back to old backend
  try {
    const audits = await fetchAuditingOdoo({ offset, limit });
    return audits;
  } catch (e) {
    console.warn('fetchAuditing: Odoo fetch failed, falling back to old API', e?.message);
  }
  try {
    const queryParams = {
      offset,
      limit,
    };
    const response = await get(API_ENDPOINTS.VIEW_AUDITING, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

// Fetch auditing records from Odoo via JSON-RPC (audit.transaction model)
export const fetchAuditingOdoo = async ({ offset = 0, limit = 50 } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'audit.transaction',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: [
              'id', 'transaction_ref', 'transaction_date', 'partner_id',
              'audit_account_type', 'amount_total', 'amount_untaxed',
              'state', 'salesperson_id',
            ],
            offset,
            limit,
            order: 'transaction_date desc, id desc',
          },
        },
      },
      { headers, timeout: reqTimeout }
    );

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const records = response.data.result || [];
    return records.map(r => ({
      _id: r.id,
      sequence_no: r.transaction_ref || '',
      date: r.transaction_date || '',
      customer_name: Array.isArray(r.partner_id) ? r.partner_id[1] : '',
      supplier_name: '',
      inv_sequence_no: r.transaction_ref || '',
      amount: r.amount_total || 0,
      collection_type_name: r.audit_account_type || '',
      chart_of_accounts_name: '',
      warehouse_name: '',
      sales_person_name: Array.isArray(r.salesperson_id) ? r.salesperson_id[1] : '',
      state: r.state || 'draft',
    }));
  } catch (error) {
    console.error('fetchAuditingOdoo error:', error?.message || error);
    throw error;
  }
};

// Create a Transaction Auditing record in Odoo via JSON-RPC (audit.transaction model)
export const createAuditingOdoo = async (auditingData) => {
  try {
    // Build vals for audit.transaction model
    const vals = {};
    if (auditingData.move_id) vals.move_id = Number(auditingData.move_id);
    if (auditingData.customer_signature) {
      vals.customer_signature = auditingData.customer_signature.replace(/^data:image\/[^;]+;base64,/, '');
    }
    if (auditingData.customer_signed_by) vals.customer_signed_by = String(auditingData.customer_signed_by);
    if (auditingData.customer_signed_date) vals.customer_signed_date = String(auditingData.customer_signed_date);
    if (auditingData.cashier_signature) {
      vals.cashier_signature = auditingData.cashier_signature.replace(/^data:image\/[^;]+;base64,/, '');
    }
    if (auditingData.cashier_signed_by) vals.cashier_signed_by = String(auditingData.cashier_signed_by);
    if (auditingData.cashier_signed_date) vals.cashier_signed_date = String(auditingData.cashier_signed_date);
    if (auditingData.is_courier != null) vals.is_courier = Boolean(auditingData.is_courier);
    if (auditingData.courier_proof) {
      vals.courier_proof = auditingData.courier_proof.replace(/^data:image\/[^;]+;base64,/, '');
    }

    console.log('[createAuditingOdoo] Creating with move_id:', vals.move_id, 'fields:', Object.keys(vals).join(', '));

    // Helper to make the create call
    const doCreate = async (hdrs) => {
      return axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'audit.transaction',
            method: 'create',
            args: [vals],
            kwargs: {},
          },
        },
        { headers: hdrs }
      );
    };

    // Step 1: Try with stored session cookie
    let headers = await getOdooAuthHeaders();
    let response = await doCreate(headers);

    // Step 2: If session expired or invalid, re-authenticate and retry
    if (!response.data?.jsonrpc || response.data?.error?.data?.name === 'odoo.http.SessionExpiredException') {
      console.log('[createAuditingOdoo] Session expired, re-authenticating...');
      const authResp = await axios.post(
        `${ODOO_BASE_URL()}/web/session/authenticate`,
        {
          jsonrpc: '2.0', method: 'call',
          params: { db: (await AsyncStorage.getItem('odoo_db')) || DEFAULT_ODOO_DB, login: DEFAULT_USERNAME, password: DEFAULT_PASSWORD },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      const setCookie = authResp.headers['set-cookie'] || authResp.headers['Set-Cookie'];
      let cookieStr = '';
      if (setCookie) {
        cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      }
      const sid = authResp.data?.result?.session_id;
      if (!cookieStr && sid) cookieStr = `session_id=${sid}`;
      if (cookieStr) await AsyncStorage.setItem('odoo_cookie', cookieStr);
      if (!cookieStr) throw new Error('Failed to authenticate with Odoo. Please log out and log back in.');

      headers = { 'Content-Type': 'application/json', Cookie: cookieStr };
      response = await doCreate(headers);
    }

    if (response.data?.error) {
      const errMsg = response.data.error.data?.message || response.data.error.message || 'Odoo create failed';
      console.error('[createAuditingOdoo] Odoo error:', errMsg);
      throw new Error(errMsg);
    }

    const recordId = response.data?.result;
    console.log('[createAuditingOdoo] Created record ID:', recordId);
    if (!recordId && recordId !== 0) {
      throw new Error('No record ID returned from Odoo.');
    }
    return recordId;
  } catch (error) {
    console.error('[createAuditingOdoo] error:', error?.message || error);
    throw error;
  }
};

export const fetchCustomers = async ({ offset, limit, searchText }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { name: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_CUSTOMERS, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};// 🔹 Fetch customers directly from Odoo 19 via JSON-RPC (no mobile field)
export const fetchCustomersOdoo = async ({ offset = 0, limit = 50, searchText, companyId } = {}) => {
  try {
    // 🔍 Domain for search (optional)
    let domain = [];

    // Company filter — show only global contacts + contacts matching the company
    if (companyId) {
      domain.push('|', ['company_id', '=', false], ['company_id', '=', companyId]);
    }

    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      if (domain.length > 0) {
        domain = ['&', ...domain, '|', ['name', 'ilike', term], ['phone', 'ilike', term]];
      } else {
        domain = ['|', ['name', 'ilike', term], ['phone', 'ilike', term]];
      }
    }
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.partner",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id", "name", "email", "phone", "is_company",
              "street", "street2", "city", "state_id", "zip", "country_id",
              "company_name", "function", "website", "vat", "lang",
              "partner_latitude", "partner_longitude", "image_1920",
            ],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log("Odoo JSON-RPC error:", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }

    const partners = response.data.result || [];

    // 🔙 Shape result for your CustomerScreen
    const mapped = partners.map((p) => ({
      id: p.id,
      name: p.name || "",
      email: p.email || "",
      phone: p.phone || "",
      address: [
        p.street,
        p.street2,
        p.city,
        p.zip,
        p.country_id && Array.isArray(p.country_id) ? p.country_id[1] : ""
      ].filter(Boolean).join(", "),
      latitude: p.partner_latitude || 0,
      longitude: p.partner_longitude || 0,
      image: p.image_1920 || null,
    }));

    // Cache the base list (only when no search filter) for offline viewing.
    if (!searchText && offset === 0) {
      try { await AsyncStorage.setItem('@cache:contacts', JSON.stringify(mapped)); } catch (_) {}
      // Also cache each contact's full detail fields so the edit view works
      // offline for any row in the list — without the user having to open
      // each one while online first.
      try {
        await Promise.all(
          partners.map((p) =>
            AsyncStorage.setItem(`@cache:contactDetail:${p.id}`, JSON.stringify(p)).catch(() => {})
          )
        );
      } catch (_) {}
    }
    return mapped;
  } catch (error) {
    console.error("fetchCustomersOdoo error:", error);
    // Offline fallback — return cached list, filtered client-side by search text.
    try {
      const cached = await AsyncStorage.getItem('@cache:contacts');
      if (cached) {
        let list = JSON.parse(cached);
        if (searchText && searchText.trim() !== '') {
          const term = searchText.trim().toLowerCase();
          list = list.filter((c) =>
            (c.name || '').toLowerCase().includes(term) ||
            (c.phone || '').toLowerCase().includes(term) ||
            (c.email || '').toLowerCase().includes(term)
          );
        }
        console.log('[fetchCustomersOdoo] Using cached contacts, count:', list.length);
        return list;
      }
    } catch (_) {}
    // No cache available — return empty list instead of throwing so the UI
    // shows "No contacts found" rather than an error toast. The screen will
    // repopulate once the user comes back online.
    console.log('[fetchCustomersOdoo] Offline with no cache — returning empty list');
    return [];
  }
};

// Fetch a single contact's full detail (with offline cache fallback).
export const fetchContactDetailOdoo = async (id) => {
  const idStr = String(id);
  try {
    // Offline-created contact — pull only from cache.
    if (idStr.startsWith('offline_')) {
      const cached = await AsyncStorage.getItem(`@cache:contactDetail:${idStr}`);
      if (cached) return JSON.parse(cached);
      throw new Error('Offline contact not found in cache');
    }
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'res.partner', method: 'read', args: [[Number(id)], [
          'name', 'email', 'phone', 'is_company',
          'street', 'street2', 'city', 'state_id', 'zip', 'country_id',
          'company_name', 'function', 'website', 'vat', 'lang',
        ]], kwargs: {},
      },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to load contact');
    const rec = Array.isArray(response.data.result) ? response.data.result[0] : response.data.result;
    try { await AsyncStorage.setItem(`@cache:contactDetail:${id}`, JSON.stringify(rec)); } catch (_) {}
    return rec;
  } catch (error) {
    console.error('[fetchContactDetailOdoo] error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem(`@cache:contactDetail:${id}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    throw error;
  }
};

// Create a contact with offline fallback.
export const createContactOdoo = async (data) => {
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({
        model: 'res.partner',
        operation: 'create',
        values: data,
      });
      const placeholder = {
        id: `offline_${localId}`,
        name: data.name || '',
        email: data.email || '',
        phone: data.phone || '',
        address: [data.street, data.street2, data.city, data.zip].filter(Boolean).join(', '),
        latitude: 0, longitude: 0, image: null, offline: true,
      };
      try {
        const raw = await AsyncStorage.getItem('@cache:contacts');
        const list = raw ? JSON.parse(raw) : [];
        list.unshift(placeholder);
        await AsyncStorage.setItem('@cache:contacts', JSON.stringify(list));
      } catch (_) {}
      try {
        await AsyncStorage.setItem(
          `@cache:contactDetail:offline_${localId}`,
          JSON.stringify({ id: `offline_${localId}`, ...data, offline: true })
        );
      } catch (_) {}
      console.log('[createContactOdoo] Queued offline, localId:', localId);
      return { offline: true, localId };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'res.partner', method: 'create', args: [data], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create contact');
    return response.data.result;
  } catch (error) {
    console.error('[createContactOdoo] error:', error?.message || error);
    throw error;
  }
};

// Update a contact with offline fallback.
export const updateContactOdoo = async (id, data) => {
  try {
    const online = await isOnline();
    if (!online) {
      const idStr = String(id);
      if (idStr.startsWith('offline_')) {
        const queueItemId = idStr.replace('offline_', '');
        await offlineQueue.updateValues(queueItemId, data);
      } else {
        await offlineQueue.enqueue({
          model: 'res.partner',
          operation: 'write',
          values: { _recordId: id, ...data },
        });
      }

      // Mutate cached list entry so the UI reflects the edit offline.
      try {
        const raw = await AsyncStorage.getItem('@cache:contacts');
        if (raw) {
          const list = JSON.parse(raw);
          const idx = list.findIndex((c) => String(c.id) === idStr);
          if (idx >= 0) {
            list[idx] = {
              ...list[idx],
              name: data.name ?? list[idx].name,
              email: data.email || '',
              phone: data.phone || '',
              address: [data.street, data.street2, data.city, data.zip].filter(Boolean).join(', '),
            };
            await AsyncStorage.setItem('@cache:contacts', JSON.stringify(list));
          }
        }
      } catch (_) {}
      // Mutate detail cache too.
      try {
        const detailKey = `@cache:contactDetail:${idStr}`;
        const rawD = await AsyncStorage.getItem(detailKey);
        if (rawD) {
          const prev = JSON.parse(rawD);
          await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, ...data }));
        }
      } catch (_) {}
      console.log('[updateContactOdoo] Queued offline edit for id:', id);
      return { offline: true };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'res.partner', method: 'write', args: [[Number(id)], data], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to update contact');
    return response.data.result;
  } catch (error) {
    console.error('[updateContactOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch customer category counts for dashboard
export const fetchCustomerCategoryCounts = async () => {
  try {
    const headers = await getOdooAuthHeaders();

    // Fetch all customer categories with counts
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.partner",
          method: "search_read",
          args: [[]],
          kwargs: {
            fields: [
              "id", "customer_category", "active", "is_qualified", "customer_rank", "create_date"
            ],
            limit: 10000,
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    const partners = response.data.result || [];
    const today = new Date().toISOString().split('T')[0];

    // Count by categories
    const counts = {
      new: 0,
      registered_leads: 0,
      active_customers: 0,
      open_leads: 0,
      others: 0,
      customer_location_update: 0,
    };

    partners.forEach((p) => {
      // New customers - created today with customer_rank > 0
      if (p.create_date && p.create_date.startsWith(today) && p.customer_rank > 0) {
        counts.new++;
      }

      // Active Customers - active and customer_rank > 0
      if (p.active && p.customer_rank > 0) {
        counts.active_customers++;
      }

      // Others - customer_rank = 0 or not a customer
      if (p.customer_rank === 0) {
        counts.others++;
      }

      // Customer Location Update - all active customers
      if (p.active) {
        counts.customer_location_update++;
      }
    });

    // Fetch leads count for registered_leads and open_leads
    const leadsResponse = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "crm.lead",
          method: "search_read",
          args: [[]],
          kwargs: {
            fields: ["id", "probability", "stage_id"],
            limit: 10000,
          },
        },
      },
      { headers }
    );

    if (!leadsResponse.data.error) {
      const leads = leadsResponse.data.result || [];
      counts.registered_leads = leads.filter(l => l.probability === 0 || !l.stage_id).length;
      counts.open_leads = leads.filter(l => l.probability > 0 || l.stage_id).length;
    }

    return counts;
  } catch (error) {
    console.error("fetchCustomerCategoryCounts error:", error);
    throw error;
  }
};

// Fetch registered leads (CRM Leads)
export const fetchRegisteredLeads = async ({ offset = 0, limit = 50, searchText } = {}) => {
  try {
    let domain = [];

    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain = [
        "|",
        ["name", "ilike", term],
        ["contact_name", "ilike", term],
        "|",
        ["email_from", "ilike", term],
        ["phone", "ilike", term],
      ];
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "crm.lead",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id", "name", "contact_name", "email_from", "phone",
              "probability", "stage_id", "expected_revenue", "user_id", "create_date"
            ],
            offset,
            limit,
            order: "create_date desc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    // Filter to get only leads in New stage (probability = 0)
    const leads = (response.data.result || []).filter(l => !l.probability || l.probability === 0);

    return leads.map((l) => ({
      id: l.id,
      name: l.name || "",
      contactName: l.contact_name || "",
      email: l.email_from || "",
      phone: l.phone || "",
      expectedRevenue: l.expected_revenue || 0,
      salesperson: l.user_id && Array.isArray(l.user_id) ? l.user_id[1] : "",
      stage: l.stage_id && Array.isArray(l.stage_id) ? l.stage_id[1] : "New",
      probability: l.probability || 0,
    }));
  } catch (error) {
    console.error("fetchRegisteredLeads error:", error);
    throw error;
  }
};

// Fetch open leads (CRM Leads with probability > 0)
export const fetchOpenLeads = async ({ offset = 0, limit = 50, searchText } = {}) => {
  try {
    let domain = [["probability", ">", 0]];

    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain.push(["|", ["name", "ilike", term], ["contact_name", "ilike", term]]);
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "crm.lead",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id", "name", "contact_name", "email_from", "phone",
              "probability", "stage_id", "expected_revenue", "user_id", "create_date"
            ],
            offset,
            limit,
            order: "create_date desc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    const leads = response.data.result || [];

    return leads.map((l) => ({
      id: l.id,
      name: l.name || "",
      contactName: l.contact_name || "",
      email: l.email_from || "",
      phone: l.phone || "",
      expectedRevenue: l.expected_revenue || 0,
      salesperson: l.user_id && Array.isArray(l.user_id) ? l.user_id[1] : "",
      stage: l.stage_id && Array.isArray(l.stage_id) ? l.stage_id[1] : "New",
      probability: l.probability || 0,
    }));
  } catch (error) {
    console.error("fetchOpenLeads error:", error);
    throw error;
  }
};

// Fetch customers by category (Active Qualified, Inactive Qualified, etc.)
export const fetchCustomersByCategory = async ({ category, offset = 0, limit = 50, searchText } = {}) => {
  try {
    // 🔍 Domain for category and search
    let domain = [];

    // Filter by customer_category
    if (category) {
      domain.push(["customer_category", "=", category]);
    }

    // Add search filter if provided
    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain.push(["|", ["name", "ilike", term], ["phone", "ilike", term]]);
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.partner",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id", "name", "email", "phone",
              "street", "street2", "city", "zip", "country_id",
              "partner_latitude", "partner_longitude",
              "is_qualified", "customer_category", "active", "image_1920"
            ],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log("Odoo JSON-RPC error (fetchCustomersByCategory):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }

    const partners = response.data.result || [];

    return partners.map((p) => ({
      id: p.id,
      name: p.name || "",
      email: p.email || "",
      phone: p.phone || "",
      address: [
        p.street,
        p.street2,
        p.city,
        p.zip,
        p.country_id && Array.isArray(p.country_id) ? p.country_id[1] : ""
      ].filter(Boolean).join(", "),
      latitude: p.partner_latitude || 0,
      longitude: p.partner_longitude || 0,
      isQualified: p.is_qualified || false,
      customerCategory: p.customer_category || "",
      active: p.active || true,
      image: p.image_1920 || null,
    }));
  } catch (error) {
    console.error("fetchCustomersByCategory error:", error);
    throw error;
  }
};

// Fetch new customers (registered today or recent)
export const fetchNewCustomers = async ({ offset = 0, limit = 50, searchText } = {}) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    let domain = [["create_date", ">=", `${today} 00:00:00`]];

    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain.push(["|", ["name", "ilike", term], ["phone", "ilike", term]]);
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.partner",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id", "name", "email", "phone",
              "street", "street2", "city", "zip", "country_id",
              "partner_latitude", "partner_longitude", "create_date", "image_1920"
            ],
            offset,
            limit,
            order: "create_date desc",
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    const partners = response.data.result || [];

    return partners.map((p) => ({
      id: p.id,
      name: p.name || "",
      email: p.email || "",
      phone: p.phone || "",
      address: [
        p.street,
        p.street2,
        p.city,
        p.zip,
        p.country_id && Array.isArray(p.country_id) ? p.country_id[1] : ""
      ].filter(Boolean).join(", "),
      latitude: p.partner_latitude || 0,
      longitude: p.partner_longitude || 0,
      image: p.image_1920 || null,
    }));
  } catch (error) {
    console.error("fetchNewCustomers error:", error);
    throw error;
  }
};

// Update customer qualification status
export const updateCustomerQualification = async ({ customerId, isQualified }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const payload = {
      is_qualified: isQualified,
    };
    if (isQualified) {
      const today = new Date().toISOString().split('T')[0];
      payload.qualification_date = today;
    }

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.partner",
          method: "write",
          args: [[customerId], payload],
          kwargs: {},
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    return response.data.result;
  } catch (error) {
    console.error("updateCustomerQualification error:", error);
    throw error;
  }
};

// Update customer location (GPS)
export const updateCustomerLocation = async ({ customerId, latitude, longitude }) => {
  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "res.partner",
          method: "write",
          args: [[customerId], {
            geo_lat: latitude,
            geo_lng: longitude,
            location_last_updated: new Date().toISOString(),
          }],
          kwargs: {},
        },
      },
      { headers }
    );

    if (response.data.error) {
      throw new Error("Odoo JSON-RPC error");
    }

    return response.data.result;
  } catch (error) {
    console.error("updateCustomerLocation error:", error);
    throw error;
  }
};


export const fetchPickup = async ({ offset, limit, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
    };
    const response = await get(API_ENDPOINTS.VIEW_PICKUP, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchService = async ({ offset, limit, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
    };
    const response = await get(API_ENDPOINTS.VIEW_SERVICE, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchSpareParts = async ({ offset, limit, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
    };
    const response = await get(API_ENDPOINTS.VIEW_SPARE_PARTS, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchMarketStudy = async ({ offset, limit }) => {
  try {
    const queryParams = {
      offset,
      limit,
    };
    const response = await get(API_ENDPOINTS.VIEW_MARKET_STUDY, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchCustomerVisitList = async ({ offset, limit, fromDate, toDate, customerId, customerName, employeeName, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
      ...(customerName !== undefined && { customer_name: customerName }),
      ...(customerId !== undefined && { customer_id: customerId }),
      ...(employeeName !== undefined && { employee_name: employeeName }),
      ...(fromDate !== undefined && { from_date: fromDate }),
      ...(toDate !== undefined && { to_date: toDate }),
    };
    const response = await get(API_ENDPOINTS.VIEW_CUSTOMER_VISIT_LIST, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchStaffTrackingList = async ({ offset, limit, fromDate, toDate, employeeIds, departmentIds, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
      ...(employeeIds !== undefined && employeeIds.length > 0 && { employee_ids: employeeIds.join(',') }),
      ...(departmentIds !== undefined && departmentIds.length > 0 && { department_ids: departmentIds.join(',') }),
      ...(fromDate !== undefined && { from_date: fromDate }),
      ...(toDate !== undefined && { to_date: toDate }),
    };
    const response = await get(API_ENDPOINTS.VIEW_STAFF_TRACKING, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchEnquiryRegister = async ({ offset, limit, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
    };
    const response = await get(API_ENDPOINTS.VIEW_ENQUIRY_REGISTER, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchPurchaseRequisition = async ({ offset, limit,searchText}) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { sequence_no: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_PURCHASE_REQUISITION,queryParams);
    return response.data;

  } catch(error){
    handleApiError(error);
    throw error;
  }
}

export const fetchPriceEnquiry = async ({ offset, limit,searchText}) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { sequence_no: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_PRICE,queryParams);
    return response.data;

  } catch(error){
    handleApiError(error);
    throw error;
  }
}

export const fetchPurchaseOrder = async ({ offset, limit,searchText}) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { sequence_no: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_PURCHASE_ORDER,queryParams);
    return response.data;

  } catch(error){
    handleApiError(error);
    throw error;
  }
}

export const fetchDeliveryNote = async ({ offset, limit,searchText}) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { sequence_no: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_DELIVERY_NOTE,queryParams);
    return response.data;

  } catch(error){
    handleApiError(error);
    throw error;
  }
}

export const fetchVendorBill = async ({ offset, limit,searchText}) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { sequence_no: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_VENDOR_BILL,queryParams);
    return response.data;

  } catch(error){
    handleApiError(error);
    throw error;
  }
}

export const fetchPaymentMade = async ({ offset, limit,searchText}) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { sequence_no: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_PAYMENT_MADE,queryParams);
    return response.data;

  } catch(error){
    handleApiError(error);
    throw error;
  }
}

// viewPaymentMade

export const fetchLead = async ({ offset, limit, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
      // ...(sequenceNo !== undefined && { sequence_no: sequenceNo }),
    };
    const response = await get(API_ENDPOINTS.VIEW_LEAD, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchPipeline = async ({ offset, limit, date, source, opportunity, customer, loginEmployeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      ...(date !== undefined && { date: date }),
      ...(source !== undefined && { source_name: source }),
      ...(opportunity !== undefined && { opportunity_name: opportunity }),
      ...(customer !== undefined && { customer_name: customer }),
      ...(loginEmployeeId !== undefined && { login_employee_id: loginEmployeeId }),
    };
    const response = await get(API_ENDPOINTS.VIEW_PIPELINE, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchVisitPlan = async ({ offset, limit, date, employeeId }) => {
  try {
    const queryParams = {
      offset,
      limit,
      date: date,
      ...(employeeId !== undefined && { employee_id: employeeId }),
    };
    const response = await get(API_ENDPOINTS.VIEW_VISIT_PLAN, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchBoxInspectionReport = async ({ offset, limit }) => {
  try {
    const queryParams = {
      offset,
      limit,
    };
    const response = await get(API_ENDPOINTS.VIEW_BOX_INSPECTION_REPORT, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchAttendance = async ({ userId, date }) => {
  try {
    const queryParams = {
      user_id: userId,
      date,
    };
    const response = await get(API_ENDPOINTS.VIEW_ATTENDANCE, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

export const fetchKPIDashboard = async ({ userId }) => {
  try {
    const queryParams = { login_employee_id: userId };
    const response = await get(API_ENDPOINTS.VIEW_KPI, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
}

export const fetchVehicles = async ({ offset, limit, searchText }) => {
  // Try Odoo JSON-RPC first (if configured), otherwise fall back to backend API
  try {
    if (ODOO_BASE_URL) {
      try {
        const vehicles = await fetchVehiclesOdoo({ offset, limit, searchText });
        return vehicles;
      } catch (e) {
        // If Odoo fetch fails, log and fall back to the existing API
        console.warn('fetchVehicles: Odoo JSON-RPC fetch failed, falling back to API', e);
      }
    }

    const queryParams = {
      offset,
      limit,
      ...(searchText !== undefined && { name: searchText }),
    };
    const response = await get(API_ENDPOINTS.VIEW_VEHICLES, queryParams);
    return response.data;
  } catch (error) {
    handleApiError(error);
    throw error;
  }
};

// Fetch full customer/partner details (address fields) by id from Odoo
export const fetchCustomerDetailsOdoo = async (partnerId) => {
  try {
    if (!partnerId) return null;
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'search_read',
          args: [[['id', '=', partnerId]]],
          kwargs: {
            fields: ['id', 'name', 'street', 'street2', 'city', 'zip', 'country_id'],
            limit: 1,
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log('Odoo JSON-RPC error (customer details):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }

    const results = response.data.result || [];
    const p = results[0];
    if (!p) return null;

    const address = [p.street, p.street2, p.city, p.zip, p.country_id && Array.isArray(p.country_id) ? p.country_id[1] : '']
      .filter(Boolean)
      .join(', ');

    return {
      id: p.id,
      name: p.name || '',
      address: address || null,
    };
  } catch (error) {
    console.error('fetchCustomerDetailsOdoo error:', error);
    throw error;
  }
};

// Create Account Payment in Odoo via JSON-RPC
export const createAccountPaymentOdoo = async ({ partnerId, journalId, amount, paymentType = 'inbound', ref = '' }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const vals = {
      amount: amount || 0,
      payment_type: paymentType,
    };
    if (partnerId) vals.partner_id = partnerId;
    if (journalId) vals.journal_id = journalId;
    if (ref) vals.ref = ref;

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.payment',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (create account payment):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to create account payment');
    }
    return { result: response.data.result };
  } catch (error) {
    console.error('createAccountPaymentOdoo error:', error?.message || error);
    return { error: error?.message || error };
  }
};

// Fetch Payment Journals from Odoo via JSON-RPC (includes company_id for multi-company support)
export const fetchPaymentJournalsOdoo = async () => {
  // Offline short-circuit — return cached journals so the Payment form
  // dropdown works without internet.
  try {
    const online = await isOnline();
    if (!online) {
      const raw = await AsyncStorage.getItem('@cache:paymentJournals');
      if (raw) return JSON.parse(raw);
      return [];
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.journal',
          method: 'search_read',
          args: [[["type", "in", ["cash", "bank"]]]],
          kwargs: {
            fields: ["id", "name", "type", "code", "company_id"],
            limit: 50,
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (payment journals):', response.data.error);
      // Fall back to cache on Odoo error.
      try {
        const raw = await AsyncStorage.getItem('@cache:paymentJournals');
        if (raw) return JSON.parse(raw);
      } catch (_) {}
      return [];
    }
    const mapped = (response.data.result || []).map(j => ({
      id: j.id,
      name: j.name || '',
      type: j.type || '',
      code: j.code || '',
      company_id: j.company_id ? j.company_id[0] : null,
      company_name: j.company_id ? j.company_id[1] : '',
    }));
    try { await AsyncStorage.setItem('@cache:paymentJournals', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('fetchPaymentJournalsOdoo error:', error?.message || error);
    try {
      const raw = await AsyncStorage.getItem('@cache:paymentJournals');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [];
  }
};


// Fetch warehouses from Odoo
export const fetchWarehousesOdoo = async () => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'stock.warehouse',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: ['id', 'name', 'code', 'company_id'], limit: 50 },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('fetchWarehousesOdoo error:', response.data.error);
      return [];
    }
    const mapped = (response.data.result || []).map(w => ({
      id: w.id, name: w.name, code: w.code, label: w.name,
      company_id: Array.isArray(w.company_id) ? w.company_id[0] : w.company_id,
      company_name: Array.isArray(w.company_id) ? w.company_id[1] : '',
    }));
    try { await AsyncStorage.setItem('@cache:warehouses', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('fetchWarehousesOdoo error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:warehouses');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return [];
  }
};

// Fetch company currency from Odoo
export const fetchCompanyCurrencyOdoo = async () => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Helper to fetch symbol from res.currency by ID
    const fetchCurrencySymbol = async (currencyId, currencyCode) => {
      try {
        const res = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model: 'res.currency',
              method: 'search_read',
              args: [[['id', '=', currencyId]]],
              kwargs: { fields: [], limit: 1 },
            },
          },
          { headers }
        );
        if (!res.data.error) {
          const currencies = res.data.result || [];
          if (currencies.length > 0) {
            const rec = currencies[0];
            const symbol = rec.symbol || rec.currency_unit_label || currencyCode || '$';
            const code = rec.name || currencyCode;
            console.log('[Currency] Resolved:', code, 'Symbol:', symbol);
            return { code, symbol };
          }
        }
      } catch (e) { /* fall through */ }
      return currencyCode ? { code: currencyCode, symbol: currencyCode } : null;
    };

    // Step 1: Try reading currency from an existing easy.sales record
    try {
      const esRes = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'easy.sales',
            method: 'search_read',
            args: [[]],
            kwargs: { fields: [], limit: 1 },
          },
        },
        { headers }
      );
      if (!esRes.data.error) {
        const records = esRes.data.result || [];
        if (records.length > 0) {
          const rec = records[0];
          // Find a currency_id field (could be currency_id, x_currency_id, etc.)
          const currencyField = Object.keys(rec).find(k => k.includes('currency') && Array.isArray(rec[k]) && rec[k].length === 2);
          if (currencyField) {
            const cId = rec[currencyField][0];
            const cCode = rec[currencyField][1];
            console.log('[Currency] Found currency from easy.sales:', cCode, 'field:', currencyField);
            const result = await fetchCurrencySymbol(cId, cCode);
            if (result) return result;
          }
        }
      }
    } catch (e) {
      console.warn('[Currency] easy.sales currency read failed:', e?.message);
    }

    // Step 2: Try reading from the default pricelist
    try {
      const plRes = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'product.pricelist',
            method: 'search_read',
            args: [[]],
            kwargs: { fields: [], limit: 1 },
          },
        },
        { headers }
      );
      if (!plRes.data.error) {
        const pricelists = plRes.data.result || [];
        if (pricelists.length > 0 && pricelists[0].currency_id) {
          const cId = Array.isArray(pricelists[0].currency_id) ? pricelists[0].currency_id[0] : pricelists[0].currency_id;
          const cCode = Array.isArray(pricelists[0].currency_id) ? pricelists[0].currency_id[1] : null;
          console.log('[Currency] Found currency from pricelist:', cCode);
          const result = await fetchCurrencySymbol(cId, cCode);
          if (result) return result;
        }
      }
    } catch (e) {
      console.warn('[Currency] pricelist currency read failed:', e?.message);
    }

    // Step 3: Fallback to company currency
    const companyRes = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.company',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: ['id', 'name', 'currency_id'], limit: 1 },
        },
      },
      { headers }
    );
    if (!companyRes.data.error) {
      const companies = companyRes.data.result || [];
      if (companies.length > 0 && companies[0].currency_id) {
        const cId = Array.isArray(companies[0].currency_id) ? companies[0].currency_id[0] : companies[0].currency_id;
        const cCode = Array.isArray(companies[0].currency_id) ? companies[0].currency_id[1] : null;
        console.log('[Currency] Fallback to company currency:', cCode);
        return await fetchCurrencySymbol(cId, cCode);
      }
    }
    return null;
  } catch (error) {
    console.error('[Currency] fetchCompanyCurrency error:', error?.message || error);
    return null;
  }
};

// ============================================================
// Easy Sales (custom easy.sales model)
// ============================================================

// Fetch list of easy.sales records
export const fetchEasySalesOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let domain = [];
    if (searchText) {
      domain = ['|', ['name', 'ilike', searchText], ['partner_id.name', 'ilike', searchText]];
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'easy.sales',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'date', 'partner_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'payment_state', 'warehouse_id', 'quick_payment_method_id', 'currency_id', 'company_id', 'reference'],
            offset, limit, order: 'date desc, id desc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[EasySales] list error:', response.data.error?.data?.message || response.data.error);
      return [];
    }
    const records = response.data.result || [];
    console.log('[EasySales] Fetched', records.length, 'records');
    // Merge offline_ placeholders so a refetch mid-sync doesn't erase rows
    // the user created offline but the sync service hasn't swapped to a real
    // id yet. Also transfer the persisted `offline_label` from the previous
    // cached row onto the fresh Odoo record, so a row synced from offline
    // keeps its OFF label visible as a Ref sub-line on the list.
    let finalList = records;
    if (!searchText && offset === 0) {
      try {
        const raw = await AsyncStorage.getItem('@cache:easySales');
        if (raw) {
          const oldList = JSON.parse(raw);
          const labelByRealId = {};
          for (const o of oldList) {
            if (o?.id != null && o.offline_label && !String(o.id).startsWith('offline_')) {
              labelByRealId[String(o.id)] = o.offline_label;
            }
          }
          finalList = records.map((r) => {
            const lab = labelByRealId[String(r.id)];
            return lab ? { ...r, offline_label: lab } : r;
          });
          const pendingOffline = oldList.filter((o) => String(o?.id || '').startsWith('offline_'));
          if (pendingOffline.length > 0) finalList = [...pendingOffline, ...finalList];
        }
      } catch (_) {}
      try { await AsyncStorage.setItem('@cache:easySales', JSON.stringify(finalList)); } catch (_) {}
    }
    return finalList;
  } catch (error) {
    console.error('[EasySales] fetchEasySales error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:easySales');
      if (cached) {
        let list = JSON.parse(cached);
        if (searchText && searchText.trim()) {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) =>
            (o.name || '').toLowerCase().includes(term) ||
            (Array.isArray(o.partner_id) ? (o.partner_id[1] || '').toLowerCase().includes(term) : false)
          );
        }
        return list;
      }
    } catch (_) {}
    return [];
  }
};

// Fetch a single easy.sales record by ID
export const fetchEasySaleDetailOdoo = async (saleId) => {
  const idStr = String(saleId);
  if (idStr.startsWith('offline_')) {
    try {
      const cached = await AsyncStorage.getItem(`@cache:easySaleDetail:${idStr}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'easy.sales',
          method: 'read',
          args: [[saleId]],
          kwargs: {
            fields: ['id', 'name', 'date', 'partner_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total',
              'payment_state', 'warehouse_id', 'quick_payment_method_id', 'currency_id', 'company_id',
              'reference', 'notes', 'line_ids', 'sale_order_id', 'invoice_id', 'is_paid', 'amount_paid', 'amount_due'],
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[EasySales] detail error:', response.data.error?.data?.message || response.data.error);
      return null;
    }
    const records = response.data.result || [];
    console.log('[EasySales] Detail record:', records.length > 0 ? records[0].name : 'not found');
    const rec = records.length > 0 ? records[0] : null;
    if (rec) {
      // Fetch line details
      if (rec.line_ids && rec.line_ids.length > 0) {
        try {
          const linesResp = await axios.post(
            `${baseUrl}/web/dataset/call_kw`,
            {
              jsonrpc: '2.0', method: 'call',
              params: {
                model: 'easy.sales.line', method: 'read', args: [rec.line_ids],
                kwargs: { fields: ['id', 'product_id', 'description', 'quantity', 'uom_id', 'price_unit', 'discount', 'subtotal', 'tax_amount', 'total'] },
              },
            },
            { headers }
          );
          rec.lines_detail = linesResp.data?.result || [];
        } catch (_) { rec.lines_detail = []; }
      } else {
        rec.lines_detail = [];
      }
      try { await AsyncStorage.setItem(`@cache:easySaleDetail:${saleId}`, JSON.stringify(rec)); } catch (_) {}
    }
    return rec;
  } catch (error) {
    console.error('[EasySales] fetchEasySaleDetail error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem(`@cache:easySaleDetail:${saleId}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
};

// Fetch easy.sales payment methods
export const fetchEasySalesPaymentMethodsOdoo = async () => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'easy.sales.payment.method',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: ['id', 'name', 'sequence', 'journal_id', 'is_default', 'is_customer_account'], limit: 50, order: 'sequence asc' },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[EasySales] Payment methods error:', response.data.error?.data?.message || response.data.error);
      return [];
    }
    const records = response.data.result || [];
    console.log('[EasySales] Payment methods:', records.length);
    const mapped = records.map(r => ({
      id: r.id,
      name: r.name,
      label: r.name,
      journal_id: r.journal_id ? r.journal_id[0] : null,
      journal_name: r.journal_id ? r.journal_id[1] : '',
      is_default: r.is_default || false,
      is_customer_account: r.is_customer_account || false,
    }));
    try { await AsyncStorage.setItem('@cache:easySalesPaymentMethods', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('[EasySales] fetchPaymentMethods error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:easySalesPaymentMethods');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return [];
  }
};

// Discover easy.sales model fields
export const discoverEasySalesFieldsOdoo = async () => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'easy.sales',
          method: 'fields_get',
          args: [],
          kwargs: { attributes: ['string', 'type', 'relation'] },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[EasySales] fields_get error:', response.data.error?.data?.message);
      return null;
    }
    const fields = response.data.result || {};
    console.log('[EasySales] Model fields:', Object.keys(fields).join(', '));
    return fields;
  } catch (error) {
    console.error('[EasySales] discoverFields error:', error?.message || error);
    return null;
  }
};

// Persistent OFF counter — survives sync (offline_X → real id) and stays
// per-(module, db). Each Odoo database keeps its OWN monotonic stream so
// switching DBs starts a fresh OFF series (or resumes that DB's last value
// if the user already used it).
//
// The cache scan is a defensive safety net that aligns the counter to the
// highest existing OFF in case the persisted counter is behind. It's only
// run when @cache:_dbStamp matches odoo_db — that prevents stale rows from
// a previous DB (cache not yet wiped) from contaminating the new DB's
// counter.
const _nextOffLabel = async ({ counterKey, cacheKey, scope }) => {
  let counter = 0;
  try {
    const r = await AsyncStorage.getItem(counterKey);
    if (r) counter = parseInt(r, 10) || 0;
  } catch (_) {}

  // Verify the cache belongs to the current DB before scanning it. If the
  // user just switched DBs and the wipe hasn't run, skip the scan so the
  // previous DB's OFF labels don't bump the new DB's counter forward.
  let cacheBelongsToCurrentDb = false;
  try {
    const currentDb = await AsyncStorage.getItem('odoo_db');
    const stampedDb = await AsyncStorage.getItem('@cache:_dbStamp');
    cacheBelongsToCurrentDb = !!currentDb && currentDb === stampedDb;
  } catch (_) {}

  if (cacheBelongsToCurrentDb) {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        const list = JSON.parse(raw) || [];
        let max = 0;
        for (const o of list) {
          if (scope && o.payment_type && o.payment_type !== scope) continue;
          const candidates = [o?.name, o?.offline_label].filter((s) => typeof s === 'string');
          for (const c of candidates) {
            const m = c.match(/^OFF(\d+)$/);
            if (m) {
              const n = parseInt(m[1], 10);
              if (n > max) max = n;
            }
          }
        }
        if (max > counter) counter = max;
      }
    } catch (_) {}
  } else {
    console.log('[_nextOffLabel] cache stamp mismatch (or not set) — skipping cross-DB cache scan');
  }
  const next = counter + 1;
  try { await AsyncStorage.setItem(counterKey, String(next)); } catch (_) {}
  console.log('[_nextOffLabel] counter=', counterKey, '→', next);
  return `OFF${String(next).padStart(5, '0')}`;
};

// Create an easy.sales record
export const createEasySaleOdoo = async ({ partnerId, warehouseId, warehouseCompanyId, paymentMethodId, customerRef, orderLines, customerSignature }) => {
  // Offline branch — queue create, cache placeholder
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({
        model: 'easy.sales',
        operation: 'create',
        values: { partnerId, warehouseId, warehouseCompanyId, paymentMethodId, customerRef, orderLines, customerSignature },
      });

      let partnerName = '';
      try {
        const raw = await AsyncStorage.getItem('@cache:contacts');
        if (raw) { const list = JSON.parse(raw); const p = list.find((c) => String(c.id) === String(partnerId)); partnerName = p?.name || ''; }
      } catch (_) {}

      let amountUntaxed = 0;
      (orderLines || []).forEach((l) => { amountUntaxed += (l.qty || l.quantity || 1) * (l.price_unit || l.price || 0); });
      const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);

      // Persistent monotonic OFF counter per (module, db). Scans both
      // pending offline rows and already-synced rows' offline_label so a
      // collision can never happen even after sync moves an id forward.
      const dbForCounter = (await AsyncStorage.getItem('odoo_db')) || '';
      const offLabel = await _nextOffLabel({
        counterKey: `@off_counter:easySales:${dbForCounter}`,
        cacheKey: '@cache:easySales',
      });
      const placeholder = {
        id: `offline_${localId}`,
        name: offLabel,
        offline_label: offLabel,  // preserved through sync for the Ref sub-line
        partner_id: partnerId ? [partnerId, partnerName] : false,
        state: 'draft',
        amount_total: amountUntaxed,
        amount_untaxed: amountUntaxed,
        amount_tax: 0,
        date: nowIso,
        warehouse_id: warehouseId ? [warehouseId, ''] : false,
        currency_id: false,
        company_id: false,
        payment_state: 'not_paid',
        offline: true,
      };

      try {
        const rawList = await AsyncStorage.getItem('@cache:easySales');
        const list = rawList ? JSON.parse(rawList) : [];
        list.unshift(placeholder);
        await AsyncStorage.setItem('@cache:easySales', JSON.stringify(list));
      } catch (_) {}
      try {
        await AsyncStorage.setItem(`@cache:easySaleDetail:offline_${localId}`, JSON.stringify({
          ...placeholder,
          order_lines: (orderLines || []).map((l, i) => ({
            id: `offline_line_${i}`,
            product_id: [l.product_id, l.product_name || `#${l.product_id}`],
            product_uom_qty: l.qty || l.quantity || 1,
            price_unit: l.price_unit || l.price || 0,
          })),
        }));
      } catch (_) {}

      console.log('[createEasySaleOdoo] Queued offline, localId:', localId);
      return { offline: true, localId, id: `offline_${localId}` };
    }
  } catch (_) {}

  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Build vals using exact field names from easy_sales Odoo module
    const vals = { partner_id: partnerId };
    if (warehouseId) vals.warehouse_id = warehouseId;
    if (paymentMethodId) vals.quick_payment_method_id = paymentMethodId;
    if (customerRef) vals.reference = customerRef;

    // Order lines — field: line_ids, line model: easy.sales.line
    // Line qty field: quantity, price field: price_unit
    if (orderLines && orderLines.length > 0) {
      vals.line_ids = orderLines.map((line) => [0, 0, {
        product_id: line.product_id,
        quantity: line.qty || line.quantity || 1,
        price_unit: line.price_unit || line.price || 0,
        ...(line.discount ? { discount: line.discount } : {}),
      }]);
    }

    console.log('[EasySales] Creating with vals:', JSON.stringify(vals).substring(0, 500));

    // Pass allowed_company_ids for multi-company
    const createKwargs = {};
    if (warehouseCompanyId) {
      try {
        const compResp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } },
          },
          { headers }
        );
        const allIds = (compResp.data?.result || []).map((c) => c.id);
        createKwargs.context = { allowed_company_ids: [warehouseCompanyId, ...allIds.filter((id) => id !== warehouseCompanyId)] };
      } catch (e) {
        createKwargs.context = { allowed_company_ids: [warehouseCompanyId] };
      }
    }

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'easy.sales',
          method: 'create',
          args: [vals],
          kwargs: createKwargs,
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('[EasySales] Create error:', response.data.error?.data?.message || response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to create easy sale');
    }

    const saleId = response.data.result;
    console.log('[EasySales] Created ID:', saleId);
    return saleId;
  } catch (error) {
    console.error('[EasySales] createEasySale error:', error?.message || error);
    throw error;
  }
};

// ─── Easy Purchase (easy.purchase) ──────────────────────────────────────────
// Mirrors easy.sales but for vendor purchases. Field names from the
// easy_purchase Odoo module: line_ids, payment_method_id, reference, etc.

export const fetchEasyPurchasesOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let domain = [];
    if (searchText) {
      domain = ['|', ['name', 'ilike', searchText], ['partner_id.name', 'ilike', searchText]];
    }
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'easy.purchase', method: 'search_read', args: [domain],
        kwargs: {
          fields: ['id', 'name', 'date', 'partner_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'payment_state', 'warehouse_id', 'payment_method_id', 'currency_id', 'company_id', 'reference'],
          offset, limit, order: 'date desc, id desc',
        },
      },
    }, { headers });
    if (response.data.error) { console.error('[EasyPurchase] list error:', response.data.error?.data?.message); return []; }
    const records = response.data.result || [];
    // Preserve pending `offline_` placeholders + transfer offline_label from
    // the previous cache so synced rows keep their OFF Ref sub-line.
    let finalList = records;
    if (!searchText && offset === 0) {
      try {
        const raw = await AsyncStorage.getItem('@cache:easyPurchases');
        if (raw) {
          const oldList = JSON.parse(raw);
          const labelByRealId = {};
          for (const o of oldList) {
            if (o?.id != null && o.offline_label && !String(o.id).startsWith('offline_')) {
              labelByRealId[String(o.id)] = o.offline_label;
            }
          }
          finalList = records.map((r) => {
            const lab = labelByRealId[String(r.id)];
            return lab ? { ...r, offline_label: lab } : r;
          });
          const pendingOffline = oldList.filter((o) => String(o?.id || '').startsWith('offline_'));
          if (pendingOffline.length > 0) finalList = [...pendingOffline, ...finalList];
        }
      } catch (_) {}
      try { await AsyncStorage.setItem('@cache:easyPurchases', JSON.stringify(finalList)); } catch (_) {}
    }
    return finalList;
  } catch (error) {
    console.error('[EasyPurchase] fetch error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:easyPurchases');
      if (cached) {
        let list = JSON.parse(cached);
        if (searchText && searchText.trim()) {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) => (o.name || '').toLowerCase().includes(term) || (Array.isArray(o.partner_id) ? (o.partner_id[1] || '').toLowerCase().includes(term) : false));
        }
        return list;
      }
    } catch (_) {}
    return [];
  }
};

export const fetchEasyPurchaseDetailOdoo = async (purchaseId) => {
  const idStr = String(purchaseId);
  if (idStr.startsWith('offline_')) {
    try { const c = await AsyncStorage.getItem(`@cache:easyPurchaseDetail:${idStr}`); if (c) return JSON.parse(c); } catch (_) {}
    return null;
  }
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'easy.purchase', method: 'read', args: [[purchaseId]],
        kwargs: {
          fields: ['id', 'name', 'date', 'partner_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total',
            'payment_state', 'warehouse_id', 'payment_method_id', 'currency_id', 'company_id',
            'reference', 'notes', 'line_ids', 'purchase_order_id', 'invoice_id', 'payment_ids'],
        },
      },
    }, { headers });
    if (response.data.error) return null;
    const rec = (response.data.result || [])[0] || null;
    if (rec && rec.line_ids && rec.line_ids.length > 0) {
      try {
        const lResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: {
            model: 'easy.purchase.line', method: 'read', args: [rec.line_ids],
            kwargs: { fields: ['id', 'product_id', 'description', 'quantity', 'uom_id', 'price_unit', 'discount', 'subtotal', 'tax_amount', 'total'] },
          },
        }, { headers });
        rec.lines_detail = lResp.data?.result || [];
      } catch (_) { rec.lines_detail = []; }
    } else if (rec) { rec.lines_detail = []; }
    if (rec) { try { await AsyncStorage.setItem(`@cache:easyPurchaseDetail:${purchaseId}`, JSON.stringify(rec)); } catch (_) {} }
    return rec;
  } catch (error) {
    console.error('[EasyPurchase] detail error:', error?.message || error);
    try { const c = await AsyncStorage.getItem(`@cache:easyPurchaseDetail:${purchaseId}`); if (c) return JSON.parse(c); } catch (_) {}
    return null;
  }
};

export const fetchEasyPurchasePaymentMethodsOdoo = async () => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'easy.purchase.payment.method', method: 'search_read', args: [[]],
        kwargs: { fields: ['id', 'name', 'sequence', 'journal_id', 'is_default', 'is_vendor_account'], limit: 50, order: 'sequence asc' },
      },
    }, { headers });
    if (response.data.error) return [];
    const mapped = (response.data.result || []).map((r) => ({
      id: r.id, name: r.name, label: r.name,
      journal_id: r.journal_id ? r.journal_id[0] : null,
      is_default: r.is_default || false,
      is_vendor_account: r.is_vendor_account || false,
    }));
    try { await AsyncStorage.setItem('@cache:easyPurchasePaymentMethods', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('[EasyPurchase] paymentMethods error:', error?.message || error);
    try { const c = await AsyncStorage.getItem('@cache:easyPurchasePaymentMethods'); if (c) return JSON.parse(c); } catch (_) {}
    return [];
  }
};

export const createEasyPurchaseOdoo = async ({ partnerId, warehouseId, warehouseCompanyId, paymentMethodId, vendorRef, orderLines }) => {
  // Offline branch
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({
        model: 'easy.purchase', operation: 'create',
        values: { partnerId, warehouseId, warehouseCompanyId, paymentMethodId, vendorRef, orderLines },
      });
      let partnerName = '';
      try { const raw = await AsyncStorage.getItem('@cache:contacts'); if (raw) { const list = JSON.parse(raw); const p = list.find((c) => String(c.id) === String(partnerId)); partnerName = p?.name || ''; } } catch (_) {}
      let amountUntaxed = 0;
      (orderLines || []).forEach((l) => { amountUntaxed += (l.qty || l.quantity || 1) * (l.price_unit || l.price || 0); });
      const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
      // Persistent monotonic OFF counter per (module, db).
      const dbForCounterEP = (await AsyncStorage.getItem('odoo_db')) || '';
      const offLabelEP = await _nextOffLabel({
        counterKey: `@off_counter:easyPurchases:${dbForCounterEP}`,
        cacheKey: '@cache:easyPurchases',
      });
      const placeholder = {
        id: `offline_${localId}`, name: offLabelEP, offline_label: offLabelEP,
        partner_id: partnerId ? [partnerId, partnerName] : false,
        state: 'draft', amount_total: amountUntaxed, amount_untaxed: amountUntaxed, amount_tax: 0,
        date: nowIso, warehouse_id: warehouseId ? [warehouseId, ''] : false,
        currency_id: false, company_id: false, payment_state: 'not_paid', offline: true,
      };
      try { const rawList = await AsyncStorage.getItem('@cache:easyPurchases'); const list = rawList ? JSON.parse(rawList) : []; list.unshift(placeholder); await AsyncStorage.setItem('@cache:easyPurchases', JSON.stringify(list)); } catch (_) {}
      try {
        await AsyncStorage.setItem(`@cache:easyPurchaseDetail:offline_${localId}`, JSON.stringify({
          ...placeholder,
          order_lines: (orderLines || []).map((l, i) => ({
            id: `offline_line_${i}`, product_id: [l.product_id, l.product_name || `#${l.product_id}`],
            quantity: l.qty || l.quantity || 1, price_unit: l.price_unit || l.price || 0,
          })),
        }));
      } catch (_) {}
      return { offline: true, localId, id: `offline_${localId}` };
    }
  } catch (_) {}

  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const vals = { partner_id: partnerId };
    if (warehouseId) vals.warehouse_id = warehouseId;
    if (paymentMethodId) vals.payment_method_id = paymentMethodId;
    if (vendorRef) vals.reference = vendorRef;
    if (orderLines && orderLines.length > 0) {
      vals.line_ids = orderLines.map((l) => [0, 0, {
        product_id: l.product_id,
        quantity: l.qty || l.quantity || 1,
        price_unit: l.price_unit || l.price || 0,
        ...(l.discount ? { discount: l.discount } : {}),
      }]);
    }
    const createKwargs = {};
    if (warehouseCompanyId) {
      try {
        const compResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } }, { headers });
        const allIds = (compResp.data?.result || []).map((c) => c.id);
        createKwargs.context = { allowed_company_ids: [warehouseCompanyId, ...allIds.filter((id) => id !== warehouseCompanyId)] };
      } catch (_) { createKwargs.context = { allowed_company_ids: [warehouseCompanyId] }; }
    }
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'easy.purchase', method: 'create', args: [vals], kwargs: createKwargs },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create easy purchase');
    return response.data.result;
  } catch (error) {
    console.error('[EasyPurchase] create error:', error?.message || error);
    throw error;
  }
};

export const confirmEasyPurchaseOdoo = async (purchaseId, companyId = null) => {
  // Offline branch
  try {
    const online = await isOnline();
    if (!online) {
      const idStr = String(purchaseId);
      if (idStr.startsWith('offline_')) {
        await offlineQueue.updateValues(idStr.replace('offline_', ''), { _confirmAfterCreate: true });
      } else {
        await offlineQueue.enqueue({ model: 'easy.purchase', operation: 'action_confirm', values: { _recordId: purchaseId, companyId } });
      }
      try {
        const raw = await AsyncStorage.getItem('@cache:easyPurchases');
        if (raw) { const list = JSON.parse(raw); const idx = list.findIndex((o) => String(o.id) === idStr); if (idx >= 0) { list[idx] = { ...list[idx], state: 'done', payment_state: 'paid' }; await AsyncStorage.setItem('@cache:easyPurchases', JSON.stringify(list)); } }
      } catch (_) {}
      try {
        const dk = `@cache:easyPurchaseDetail:${idStr}`;
        const rawD = await AsyncStorage.getItem(dk);
        if (rawD) { const prev = JSON.parse(rawD); await AsyncStorage.setItem(dk, JSON.stringify({ ...prev, state: 'done', payment_state: 'paid' })); }
      } catch (_) {}
      return { offline: true };
    }
  } catch (_) {}

  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let targetCompanyId = companyId;
    if (!targetCompanyId) {
      try { const rr = await axios.post(`${baseUrl}/web/dataset/call_kw`, { jsonrpc: '2.0', method: 'call', params: { model: 'easy.purchase', method: 'read', args: [[purchaseId]], kwargs: { fields: ['company_id'] } } }, { headers }); const rec = rr.data?.result?.[0]; if (rec?.company_id) targetCompanyId = Array.isArray(rec.company_id) ? rec.company_id[0] : rec.company_id; } catch (_) {}
    }
    let allCompanyIds = [1];
    try { const cr = await axios.post(`${baseUrl}/web/dataset/call_kw`, { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } }, { headers }); allCompanyIds = (cr.data?.result || []).map((c) => c.id); } catch (_) {}
    const companyIds = targetCompanyId ? [targetCompanyId, ...allCompanyIds.filter((id) => id !== targetCompanyId)] : allCompanyIds;
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'easy.purchase', method: 'action_confirm', args: [[purchaseId]], kwargs: { context: { allowed_company_ids: companyIds } } },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to confirm purchase');
    return response.data.result;
  } catch (error) {
    console.error('[EasyPurchase] confirm error:', error?.message || error);
    throw error;
  }
};

// Confirm an easy.sales record
export const confirmEasySaleOdoo = async (saleId, companyId = null) => {
  // Offline branch
  try {
    const online = await isOnline();
    if (!online) {
      const idStr = String(saleId);
      if (idStr.startsWith('offline_')) {
        const queueItemId = idStr.replace('offline_', '');
        await offlineQueue.updateValues(queueItemId, { _confirmAfterCreate: true });
      } else {
        await offlineQueue.enqueue({ model: 'easy.sales', operation: 'action_confirm', values: { _recordId: saleId, companyId } });
      }
      try {
        const raw = await AsyncStorage.getItem('@cache:easySales');
        if (raw) { const list = JSON.parse(raw); const idx = list.findIndex((o) => String(o.id) === idStr); if (idx >= 0) { list[idx] = { ...list[idx], state: 'done', payment_state: 'paid', is_paid: true }; await AsyncStorage.setItem('@cache:easySales', JSON.stringify(list)); } }
      } catch (_) {}
      try {
        const detailKey = `@cache:easySaleDetail:${idStr}`;
        const rawD = await AsyncStorage.getItem(detailKey);
        if (rawD) { const prev = JSON.parse(rawD); await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, state: 'done', payment_state: 'paid', is_paid: true })); }
      } catch (_) {}
      return { offline: true };
    }
  } catch (_) {}

  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // If no companyId passed, read company_id from the record first
    let targetCompanyId = companyId;
    if (!targetCompanyId) {
      try {
        const readResp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'easy.sales', method: 'read', args: [[saleId]], kwargs: { fields: ['company_id'] } },
          },
          { headers }
        );
        const rec = readResp.data?.result?.[0];
        if (rec?.company_id) {
          targetCompanyId = Array.isArray(rec.company_id) ? rec.company_id[0] : rec.company_id;
        }
      } catch (e) { console.warn('[EasySales] Could not read company_id:', e?.message); }
    }

    // Fetch all companies the user has access to
    let allCompanyIds = [1]; // fallback to "My Company"
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } },
        },
        { headers }
      );
      const companies = compResp.data?.result || [];
      if (companies.length > 0) {
        allCompanyIds = companies.map(c => c.id);
      }
    } catch (e) { console.warn('[EasySales] Could not fetch companies:', e?.message); }

    // Put the target company first (sets env.company), include all others for journal access
    const companyIds = targetCompanyId
      ? [targetCompanyId, ...allCompanyIds.filter(id => id !== targetCompanyId)]
      : allCompanyIds;

    const kwargs = {
      context: { allowed_company_ids: companyIds },
    };

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'easy.sales',
          method: 'action_confirm',
          args: [[saleId]],
          kwargs,
        },
      },
      { headers, withCredentials: true, timeout: 30000 }
    );
    if (response.data.error) {
      console.error('[EasySales] Confirm error:', response.data.error?.data?.message || response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to confirm easy sale');
    }
    console.log('[EasySales] Confirmed ID:', saleId);
    // Patch the cached row so the list + detail screens show done / paid
    // immediately — without waiting for a refetch. Mirrors the offline branch
    // behaviour. The next Odoo refetch will overwrite with the real values.
    try {
      const idStr = String(saleId);
      const raw = await AsyncStorage.getItem('@cache:easySales');
      if (raw) {
        const list = JSON.parse(raw);
        const idx = list.findIndex((o) => String(o.id) === idStr);
        if (idx >= 0) {
          list[idx] = { ...list[idx], state: 'done', payment_state: 'paid', is_paid: true };
          await AsyncStorage.setItem('@cache:easySales', JSON.stringify(list));
        }
      }
      const detailKey = `@cache:easySaleDetail:${idStr}`;
      const rawD = await AsyncStorage.getItem(detailKey);
      if (rawD) {
        const prev = JSON.parse(rawD);
        await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, state: 'done', payment_state: 'paid', is_paid: true }));
      }
    } catch (_) {}
    return response.data.result;
  } catch (error) {
    console.error('[EasySales] confirmEasySale error:', error?.message || error);
    throw error;
  }
};

// Helper — patch a payment row across both per-type caches. Used by offline
// branches and sync handlers so state / name updates land in whichever
// Customer / Vendor cache holds the row.
const _patchPaymentInCache = async (matcher, patch) => {
  for (const key of ['@cache:accountPayments:inbound', '@cache:accountPayments:outbound', '@cache:accountPayments']) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const list = JSON.parse(raw);
      const idx = list.findIndex(matcher);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...patch };
        await AsyncStorage.setItem(key, JSON.stringify(list));
      }
    } catch (_) {}
  }
};

// Fetch account.payment records from Odoo (customer or vendor)
// Uses allowed_company_ids context to fetch across all companies
export const fetchAccountPaymentsOdoo = async ({ paymentType = 'inbound', offset = 0, limit = 20, searchText = '' } = {}) => {
  // Per-type cache key — customer + vendor each have their own slot so
  // parallel fetches (CacheWarmer runs both) don't clobber each other.
  const cacheKey = `@cache:accountPayments:${paymentType}`;
  const legacyKey = '@cache:accountPayments';

  // Offline short-circuit — go straight to the cache instead of waiting for
  // the Odoo call to time out.
  try {
    const online = await isOnline();
    if (!online) {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (raw) {
        let list = JSON.parse(raw);
        if (searchText && searchText.trim() !== '') {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) =>
            (o.name || '').toLowerCase().includes(term) ||
            (o.partner_name || '').toLowerCase().includes(term)
          );
        }
        console.log('[fetchAccountPayments] OFFLINE → cached rows:', list.length, 'type:', paymentType);
        return list;
      }
      // Fallback: older cache key (from a single merged list) still around.
      const legacy = await AsyncStorage.getItem(legacyKey);
      if (legacy) {
        let list = JSON.parse(legacy).filter((o) => (o.payment_type || 'inbound') === paymentType);
        console.log('[fetchAccountPayments] OFFLINE legacy → cached rows:', list.length);
        return list;
      }
      return [];
    }
  } catch (_) { /* fall through */ }

  try {
    const { headers, baseUrl } = await authenticateOdoo();
    console.log('[fetchAccountPayments] auth OK, paymentType:', paymentType);

    // Filter by payment_type and partner_type to match Odoo's Customer/Vendor Payments view
    const partnerType = paymentType === 'inbound' ? 'customer' : 'supplier';
    let domain = [['payment_type', '=', paymentType], ['partner_type', '=', partnerType]];
    if (searchText) {
      domain = ['&', '&', ['payment_type', '=', paymentType], ['partner_type', '=', partnerType], '|', ['partner_id.name', 'ilike', searchText], ['name', 'ilike', searchText]];
    }

    // Fetch actual allowed company IDs from Odoo so payments in any company
    // (not just 1-6) are visible. The hardcoded range missed tenants with
    // higher company ids like `tool_managament`.
    let allCompanyIds = [];
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers }
      );
      allCompanyIds = (compResp.data?.result || []).map((c) => c.id);
    } catch (e) { console.warn('[fetchAccountPayments] company fetch failed:', e?.message); }
    if (allCompanyIds.length === 0) allCompanyIds = [1, 2, 3, 4, 5, 6];

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.payment',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'display_name', 'partner_id', 'amount', 'date', 'state', 'payment_type', 'journal_id', 'memo', 'company_id'],
            offset,
            limit,
            order: 'date desc, id desc',
            context: { allowed_company_ids: allCompanyIds },
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.error('[fetchAccountPayments] Odoo error:', JSON.stringify(response.data.error).substring(0, 500));
      return [];
    }

    const records = response.data.result || [];
    console.log('[fetchAccountPayments] Got', records.length, 'records for paymentType:', paymentType);

    const mapped = records.map(p => ({
      id: p.id,
      name: p.name || p.display_name || '',
      partner_name: p.partner_id ? p.partner_id[1] : '',
      partner_id: p.partner_id ? p.partner_id[0] : null,
      amount: p.amount || 0,
      date: p.date || '',
      state: p.state || '',
      payment_type: p.payment_type || '',
      journal_name: p.journal_id ? p.journal_id[1] : '',
      ref: p.memo || '',
      company_name: p.company_id ? p.company_id[1] : '',
    }));

    // Merge any offline-queued payments still pending sync + transfer the
    // persisted offline_label from the previous cache so synced rows keep
    // their OFF Ref sub-line visible.
    let finalList = mapped;
    if (!searchText && offset === 0) {
      try {
        const raw = await AsyncStorage.getItem(cacheKey);
        if (raw) {
          const oldList = JSON.parse(raw);
          const labelByRealId = {};
          for (const o of oldList) {
            if (o?.id != null && o.offline_label && !String(o.id).startsWith('offline_')) {
              labelByRealId[String(o.id)] = o.offline_label;
            }
          }
          finalList = mapped.map((r) => {
            const lab = labelByRealId[String(r.id)];
            return lab ? { ...r, offline_label: lab } : r;
          });
          const pendingOffline = oldList.filter((o) => String(o?.id || '').startsWith('offline_'));
          if (pendingOffline.length > 0) finalList = [...pendingOffline, ...finalList];
        }
      } catch (_) {}
      // Write to the per-type key so Customer + Vendor caches don't clobber
      // each other when both fetches run in parallel (CacheWarmer).
      try { await AsyncStorage.setItem(cacheKey, JSON.stringify(finalList)); } catch (_) {}
    }
    return finalList;
  } catch (error) {
    console.error('[fetchAccountPayments] FATAL error:', error?.message || error);
    // Offline fallback — show cached payments filtered by paymentType.
    try {
      const raw = await AsyncStorage.getItem('@cache:accountPayments');
      if (raw) {
        let list = JSON.parse(raw);
        list = list.filter((o) => (o.payment_type || 'inbound') === paymentType);
        if (searchText && searchText.trim() !== '') {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) =>
            (o.name || '').toLowerCase().includes(term) ||
            (o.partner_name || '').toLowerCase().includes(term)
          );
        }
        console.log('[fetchAccountPayments] Using cached payments, count:', list.length);
        return list;
      }
    } catch (_) {}
    return [];
  }
};

// Fetch vehicles directly from Odoo using JSON-RPC
export const fetchVehiclesOdoo = async ({ offset = 0, limit = 50, searchText = "" } = {}) => {
  try {
    let domain = [];
    if (searchText && searchText.trim() !== "") {
      const term = searchText.trim();
      domain = [["name", "ilike", term]]; // Filter by vehicle name
    }

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "fleet.vehicle",
          method: "search_read",
          args: [domain],
          kwargs: {
            fields: [
              "id",
              "name",
              "license_plate",
              "model_id",
              "driver_id",
              "image_128"
            ],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.error) {
      console.log("Odoo JSON-RPC error (vehicles):", response.data.error);
      throw new Error("Odoo JSON-RPC error");
    }

    const vehicles = response.data.result || [];
    return vehicles.map(v => ({
      id: v.id,
      name: v.name || "",
      license_plate: v.license_plate || "",
      model: v.model_id ? { id: v.model_id[0], name: v.model_id[1] } : null,
      driver: v.driver_id ? { id: v.driver_id[0], name: v.driver_id[1] } : null,
      image_url: v.image_128 && typeof v.image_128 === 'string' && v.image_128.length > 0
        ? `data:image/png;base64,${v.image_128}`
        : null,
    }));
  } catch (error) {
    console.error("fetchVehiclesOdoo error:", error);
    throw error;
  }
};

// Fetch vehicles from the vehicle-tracking Odoo endpoint (uses vehicleTrackingConfig)
export const fetchVehiclesVehicleTracking = async ({ offset = 0, limit = 50, searchText = "", username = "admin", password = "admin" } = {}) => {
  let domain = [];
  if (searchText && searchText.trim() !== "") {
    const term = searchText.trim();
    domain = [["name", "ilike", term]];
  }
  const baseUrl = (VEHICLE_TRACKING_BASE_URL() || '').replace(/\/$/, '');
  try {
    // Step 1: Authenticate and get session cookie
    const loginResp = await loginVehicleTrackingOdoo({ username, password });
    // Step 2: Fetch vehicles with session
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "fleet.vehicle",
          method: "search_read",
          args: [domain],
          kwargs: {
              fields: ["id", "name", "license_plate", "model_id", "driver_id", "image_128", "tank_capacity"],
            offset,
            limit,
            order: "name asc",
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(loginResp.cookies ? { Cookie: loginResp.cookies } : {}),
        },
        withCredentials: true,
        timeout: 15000,
      }
    );
    if (response.data.error) {
      console.log("VehicleTracking JSON-RPC error (vehicles):", response.data.error);
      throw new Error("VehicleTracking JSON-RPC error");
    }
    const vehicles = response.data.result || [];
      return vehicles.map(v => ({
        id: v.id,
        name: v.name || "",
        license_plate: v.license_plate || "",
        model: v.model_id ? { id: v.model_id[0], name: v.model_id[1] } : null,
        driver: v.driver_id ? { id: v.driver_id[0], name: v.driver_id[1] } : null,
        image_url: v.image_128 && typeof v.image_128 === 'string' && v.image_128.length > 0 ? `data:image/png;base64,${v.image_128}` : null,
        tank_capacity: v.tank_capacity ?? '',
      }));
  } catch (error) {
    console.error('fetchVehiclesVehicleTracking error:', error?.message || error);
    if (error && error.response) {
      console.error('fetchVehiclesVehicleTracking response status:', error.response.status);
      try { console.error('fetchVehiclesVehicleTracking response data:', error.response.data); } catch (e) {}
    }
    throw error;
  }
};

// Resolve any QR / barcode payload to an invoice. Tries (in order):
//   1. URL with /customer-invoices/<id> or /web#id=<id>&model=account.move
//   2. Pure integer string  → match by id
//   3. Anything else         → match by name first, then ref, then number
// Returns the same shape as fetchInvoiceByIdOdoo, or null if nothing matches.
export const fetchInvoiceByQrOdoo = async (rawQr) => {
  try {
    if (!rawQr || typeof rawQr !== 'string') return null;
    const text = rawQr.trim();
    console.log('[fetchInvoiceByQrOdoo] scanned payload:', text);

    // Strategy 1 — URL containing the id
    const urlMatch =
      text.match(/\/customer-invoices\/(\d+)/) ||
      text.match(/[?#&]id=(\d+)/);
    if (urlMatch) {
      const id = parseInt(urlMatch[1], 10);
      if (id > 0) {
        const inv = await fetchInvoiceByIdOdoo(id);
        if (inv) return inv;
      }
    }

    // Strategy 2 — pure integer
    if (/^\d+$/.test(text)) {
      const inv = await fetchInvoiceByIdOdoo(parseInt(text, 10));
      if (inv) return inv;
    }

    // Strategy 3 — search account.move by name / ref
    const headers = await getOdooAuthHeaders();
    const domain = ['|', '|',
      ['name', '=', text],
      ['ref',  '=', text],
      ['name', 'ilike', text],
    ];
    const resp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.move',
          method: 'search_read',
          args: [domain],
          kwargs: { fields: ['id'], limit: 1 },
        },
      },
      { headers }
    );
    if (!resp.data.error) {
      const hit = (resp.data.result || [])[0];
      if (hit && hit.id) return await fetchInvoiceByIdOdoo(hit.id);
    } else {
      console.log('[fetchInvoiceByQrOdoo] name/ref search error:', resp.data.error);
    }

    return null;
  } catch (err) {
    console.error('fetchInvoiceByQrOdoo error:', err?.message || err);
    return null;
  }
};

// Fetch invoice (account.move) by ID from Odoo via JSON-RPC
export const fetchInvoiceByIdOdoo = async (invoiceId) => {
  try {
    if (!invoiceId) return null;

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.move',
          method: 'search_read',
          args: [[['id', '=', Number(invoiceId)]]],
          kwargs: {
            fields: [
              'id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due',
              'amount_total', 'amount_residual', 'amount_untaxed', 'amount_tax',
              'state', 'payment_state', 'move_type', 'currency_id',
              'invoice_line_ids', 'ref', 'narration',
            ],
            limit: 1,
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log('Odoo JSON-RPC error (invoice):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }

    const results = response.data.result || [];
    const inv = results[0];
    if (!inv) return null;

    // Fetch invoice lines
    let invoiceLines = [];
    if (inv.invoice_line_ids && inv.invoice_line_ids.length > 0) {
      const linesResponse = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'account.move.line',
            method: 'search_read',
            args: [[['id', 'in', inv.invoice_line_ids]]],
            kwargs: {
              fields: ['id', 'name', 'product_id', 'quantity', 'price_unit', 'price_subtotal'],
            },
          },
        },
        { headers }
      );

      if (!linesResponse.data.error && linesResponse.data.result) {
        invoiceLines = linesResponse.data.result.map(line => ({
          id: line.id,
          description: line.name || '',
          product_name: Array.isArray(line.product_id) ? line.product_id[1] : '',
          quantity: line.quantity || 0,
          price_unit: line.price_unit || 0,
          price_subtotal: line.price_subtotal || 0,
        }));
      }
    }

    return {
      id: inv.id,
      name: inv.name || '',
      partner_name: Array.isArray(inv.partner_id) ? inv.partner_id[1] : '',
      invoice_date: inv.invoice_date || '',
      invoice_date_due: inv.invoice_date_due || '',
      amount_total: inv.amount_total || 0,
      amount_residual: inv.amount_residual || 0,
      amount_untaxed: inv.amount_untaxed || 0,
      amount_tax: inv.amount_tax || 0,
      state: inv.state || '',
      payment_state: inv.payment_state || '',
      move_type: inv.move_type || '',
      currency_name: Array.isArray(inv.currency_id) ? inv.currency_id[1] : '',
      ref: inv.ref || '',
      narration: inv.narration || '',
      invoice_lines: invoiceLines,
    };
  } catch (error) {
    console.error('fetchInvoiceByIdOdoo error:', error);
    throw error;
  }
};

// Create a Product Enquiry record in Odoo via JSON-RPC
export const createProductEnquiryOdoo = async ({
  date,
  type,
  customer_name,
  customer_no,
  sale_price,
  product_name,
  image_url,
  attachments = [],
}) => {
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
  try {
    // Step 1: Authenticate to Odoo
    const loginResponse = await axios.post(
      `${baseUrl}/web/session/authenticate`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          db: (await AsyncStorage.getItem('odoo_db')) || DEFAULT_ODOO_DB,
          login: DEFAULT_USERNAME,
          password: DEFAULT_PASSWORD,
        },
      },
      { headers: { 'Content-Type': 'application/json' }, withCredentials: true }
    );

    if (loginResponse.data.error) {
      throw new Error('Odoo authentication failed');
    }

    // Extract session cookie
    const setCookie = loginResponse.headers['set-cookie'] || loginResponse.headers['Set-Cookie'];
    const headers = { 'Content-Type': 'application/json' };
    if (setCookie) {
      headers.Cookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    }

    // Step 2: Create product.enquiry record
    const vals = {
      date: date || false,
      type: type || 'product_enquiry',
      customer_name: customer_name || false,
      customer_no: customer_no || false,
      sale_price: sale_price || 0,
      product_name: product_name || false,
      image_url: image_url || false,
    };

    // Handle image attachments — extract base64 from data URI for Odoo Binary field
    if (attachments.length > 0) {
      vals.attachment_ids = attachments.map((imgUri, idx) => {
        const b64Match = imgUri.match(/^data:image\/([^;]+);base64,(.+)$/);
        if (b64Match) {
          const ext = b64Match[1] === 'jpeg' ? 'jpg' : b64Match[1];
          return [0, 0, { attachment: b64Match[2], filename: `enquiry_image_${idx + 1}.${ext}` }];
        }
        return [0, 0, { image_url: imgUri }];
      });
    }

    console.log('[createProductEnquiryOdoo] Sending vals:', JSON.stringify({
      ...vals,
      image_url: vals.image_url ? '(base64 data...)' : false,
      attachment_ids: vals.attachment_ids ? `${vals.attachment_ids.length} attachments` : 'none',
    }));

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'product.enquiry',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 30000 }
    );

    if (response.data.error) {
      console.error('Odoo JSON-RPC error (create product enquiry):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    console.log('[createProductEnquiryOdoo] Created record ID:', response.data.result);
    return response.data.result;
  } catch (error) {
    console.error('createProductEnquiryOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch all product enquiries from Odoo
export const fetchProductEnquiriesOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    let domain = [];
    if (searchText && searchText.trim() !== '') {
      const term = searchText.trim();
      domain = ['|', '|',
        ['product_name', 'ilike', term],
        ['customer_name', 'ilike', term],
        ['customer_no', 'ilike', term],
      ];
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'product.enquiry',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'date', 'type', 'customer_name', 'customer_no', 'sale_price', 'product_name', 'create_date'],
            offset,
            limit,
            order: 'create_date desc',
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log('Odoo JSON-RPC error (product enquiries):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }

    const records = response.data.result || [];
    return records.map((r) => ({
      _id: r.id,
      date: r.date || r.create_date,
      type: r.type || '',
      customer_name: r.customer_name || '',
      customer_no: r.customer_no || '',
      sale_price: r.sale_price || 0,
      product_name: r.product_name || '',
    }));
  } catch (error) {
    console.error('fetchProductEnquiriesOdoo error:', error);
    throw error;
  }
};

// Create account.payment with customer signature and GPS location in Odoo
// Handles multi-company: reads partner's company, finds matching journal, sets correct company context
export const createPaymentWithSignatureOdoo = async ({
  partnerId,
  amount,
  paymentType = 'inbound',
  journalId,
  journalName = '',
  companyId = null,
  companyName = '',
  ref = '',
  customerSignature = null,
  employeeSignature = null,
  latitude = null,
  longitude = null,
  locationName = '',
}) => {
  // Offline branch — queue the payment and return immediately. When the
  // device reconnects, OfflineSyncService handles the create + post against
  // Odoo (company/journal resolution, signatures, GPS, all preserved).
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({
        model: 'account.payment',
        operation: 'create',
        values: {
          partnerId,
          amount: parseFloat(amount) || 0,
          paymentType,
          journalId: journalId || null,
          journalName: journalName || '',
          companyId: companyId || null,
          companyName: companyName || '',
          ref: ref || '',
          customerSignature: customerSignature || null,
          employeeSignature: employeeSignature || null,
          latitude, longitude,
          locationName: locationName || '',
          // No _postAfterCreate — offline behaves like online: creates a
          // Draft, user validates explicitly from PaymentDetailScreen.
        },
      });

      // Add a placeholder row to the cached payments list so it shows up
      // offline immediately.
      try {
        let partnerName = '';
        try {
          const contactsRaw = await AsyncStorage.getItem('@cache:contacts');
          if (contactsRaw && partnerId) {
            const list = JSON.parse(contactsRaw);
            const p = list.find((c) => c.id === partnerId || String(c.id) === String(partnerId));
            partnerName = p?.name || p?.partner_name || '';
          }
        } catch (_) {}
        const perTypeKey = `@cache:accountPayments:${paymentType}`;
        // Persistent monotonic OFF counter per (paymentType, db) — Customer
        // and Vendor each have their own stream, never collides post-sync.
        const dbForCounterPay = (await AsyncStorage.getItem('odoo_db')) || '';
        const offLabelPay = await _nextOffLabel({
          counterKey: `@off_counter:payments:${paymentType}:${dbForCounterPay}`,
          cacheKey: perTypeKey,
          scope: paymentType,
        });
        const placeholder = {
          id: `offline_${localId}`,
          name: offLabelPay,
          offline_label: offLabelPay,
          partner_id: partnerId,
          partner_name: partnerName,
          amount: parseFloat(amount) || 0,
          date: new Date().toISOString().split('T')[0],
          state: 'draft',
          payment_type: paymentType,
          journal_name: journalName || '',
          ref: ref || '',
          company_name: companyName || '',
          offline: true,
        };
        const raw = await AsyncStorage.getItem(perTypeKey);
        const list = raw ? JSON.parse(raw) : [];
        list.unshift(placeholder);
        await AsyncStorage.setItem(perTypeKey, JSON.stringify(list));
      } catch (_) {}

      console.log('[createPayment] Queued offline, localId:', localId);
      return { offline: true, localId };
    }
  } catch (_) { /* fall through to online path */ }

  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
  try {
    // Step 1: Reuse the existing authenticated session cookie instead of
    // re-logging in on every submit — saves 1-3s on slow networks. The cookie
    // was persisted at login. Falls back to a fresh authenticate only if the
    // cookie is missing / expired.
    const headers = await getOdooAuthHeaders();

    // Helper to call Odoo JSON-RPC
    const rpc = async (model, method, args, kwargs = {}) => {
      const resp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } },
        { headers, withCredentials: true, timeout: 15000 }
      );
      if (resp.data.error) throw new Error(resp.data.error.data?.message || 'Odoo RPC error');
      return resp.data.result;
    };

    // Step 2: Resolve company — read partner's and journal's company_id
    // IN PARALLEL. Previously these were sequential and burnt ~2x the time.
    // If the user explicitly picked a company in the form, honor that.
    let targetCompanyId = companyId || null;
    let resolvedJournalId = journalId;

    if (partnerId) {
      const [partners, journals] = await Promise.all([
        rpc('res.partner', 'search_read', [[['id', '=', partnerId]]], { fields: ['id', 'company_id'], limit: 1 }),
        journalId
          ? rpc('account.journal', 'search_read', [[['id', '=', journalId]]], { fields: ['id', 'company_id', 'type'], limit: 1 })
          : Promise.resolve(null),
      ]);
      const partnerCompanyId = partners?.[0]?.company_id ? partners[0].company_id[0] : null;
      console.log('[createPayment] Partner company_id:', partnerCompanyId);

      if (journalId) {
        const journalCompanyId = journals?.[0]?.company_id ? journals[0].company_id[0] : null;
        const journalType = journals?.[0]?.type || 'bank';
        console.log('[createPayment] Journal company_id:', journalCompanyId);

        if (partnerCompanyId && journalCompanyId && partnerCompanyId !== journalCompanyId) {
          // Company mismatch! Find a journal of same type in the partner's company
          console.log('[createPayment] Company mismatch — partner:', partnerCompanyId, 'journal:', journalCompanyId);
          const matchingJournals = await rpc('account.journal', 'search_read', [
            [['type', '=', journalType], ['company_id', '=', partnerCompanyId]]
          ], {
            fields: ['id', 'name', 'type', 'company_id'],
            limit: 5,
          });
          if (matchingJournals && matchingJournals.length > 0) {
            resolvedJournalId = matchingJournals[0].id;
            targetCompanyId = partnerCompanyId;
            console.log('[createPayment] Resolved journal to', matchingJournals[0].name, '(ID:', resolvedJournalId, ') from company', partnerCompanyId);
          } else {
            // No matching journal type — try any cash/bank journal in partner's company
            const fallbackJournals = await rpc('account.journal', 'search_read', [
              [['type', 'in', ['cash', 'bank']], ['company_id', '=', partnerCompanyId]]
            ], {
              fields: ['id', 'name', 'type', 'company_id'],
              limit: 5,
            });
            if (fallbackJournals && fallbackJournals.length > 0) {
              resolvedJournalId = fallbackJournals[0].id;
              targetCompanyId = partnerCompanyId;
              console.log('[createPayment] Fallback journal:', fallbackJournals[0].name, '(ID:', resolvedJournalId, ')');
            } else {
              // Last resort: clear partner's company restriction so payment can go through
              console.log('[createPayment] No journal found in partner company. Using original journal, clearing partner company restriction.');
              targetCompanyId = journalCompanyId;
              try {
                await rpc('res.partner', 'write', [[partnerId], { company_id: false }]);
                console.log('[createPayment] Cleared partner company restriction');
              } catch (writeErr) {
                console.warn('[createPayment] Could not clear partner company:', writeErr?.message);
                targetCompanyId = journalCompanyId;
              }
            }
          }
        } else {
          // No mismatch — use the journal's company (or partner's if partner has one)
          targetCompanyId = partnerCompanyId || journalCompanyId;
        }
      } else {
        targetCompanyId = partnerCompanyId;
      }
    }

    // Step 3: Build vals
    const vals = {
      amount: Math.abs(amount) || 0,
      payment_type: paymentType,
      partner_type: paymentType === 'inbound' ? 'customer' : 'supplier',
    };
    if (partnerId) vals.partner_id = partnerId;
    if (resolvedJournalId) vals.journal_id = resolvedJournalId;
    if (targetCompanyId) vals.company_id = targetCompanyId;
    if (ref) vals.memo = ref;

    // Handle customer/vendor signature (base64 data URI → raw base64)
    if (customerSignature) {
      const sigMatch = customerSignature.match(/^data:image\/[^;]+;base64,(.+)$/);
      vals.customer_signature = sigMatch ? sigMatch[1] : customerSignature;
    }

    // Handle employee signature
    if (employeeSignature) {
      const empSigMatch = employeeSignature.match(/^data:image\/[^;]+;base64,(.+)$/);
      vals.employee_signature = empSigMatch ? empSigMatch[1] : employeeSignature;
    }

    // Handle location
    if (latitude !== null) vals.latitude = latitude;
    if (longitude !== null) vals.longitude = longitude;
    if (locationName) vals.location_name = locationName;

    console.log('[createPayment] Creating payment with vals:', JSON.stringify({
      amount: vals.amount, payment_type: vals.payment_type, partner_id: vals.partner_id,
      journal_id: vals.journal_id, company_id: vals.company_id,
    }));

    // Step 4: Create record with allowed_company_ids context for multi-company
    const createKwargs = {};
    if (targetCompanyId) {
      createKwargs.context = { allowed_company_ids: [targetCompanyId] };
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.payment',
          method: 'create',
          args: [vals],
          kwargs: createKwargs,
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('Odoo JSON-RPC error (create payment):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const paymentId = response.data.result;
    console.log('[createPayment] Created record ID:', paymentId, '(draft — user must Validate from detail)');
    // Intentionally no auto-post. The user validates from PaymentDetailScreen
    // — same flow as Sales Order (create → confirm → invoice).
    return paymentId;
  } catch (error) {
    console.error('createPaymentWithSignatureOdoo error:', error?.message || error);
    throw error;
  }
};

// Search all three payment caches for a row matching this id.
const _findPaymentInAnyCache = async (paymentId) => {
  const key = String(paymentId);
  for (const cacheKey of ['@cache:accountPayments:inbound', '@cache:accountPayments:outbound', '@cache:accountPayments']) {
    try {
      const raw = await AsyncStorage.getItem(cacheKey);
      if (!raw) continue;
      const list = JSON.parse(raw);
      const match = list.find((p) => String(p.id) === key || p.id === Number(paymentId));
      if (match) return match;
    } catch (_) {}
  }
  return null;
};

// Fetch a single payment's full details for the detail screen.
export const fetchPaymentDetailOdoo = async (paymentId) => {
  // Offline-created placeholder (id "offline_…") — go straight to cache.
  // Number('offline_X') is NaN, so Odoo would return nothing anyway.
  const idStr = String(paymentId);
  if (idStr.startsWith('offline_')) {
    const match = await _findPaymentInAnyCache(paymentId);
    if (match) return { ...match, customer_signature: match.customer_signature || null, employee_signature: match.employee_signature || null };
    return null;
  }

  // If offline, read from cache directly.
  try {
    const online = await isOnline();
    if (!online) {
      const match = await _findPaymentInAnyCache(paymentId);
      if (match) return { ...match, customer_signature: match.customer_signature || null, employee_signature: match.employee_signature || null };
      return null;
    }
  } catch (_) {}

  const headers = await getOdooAuthHeaders();
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');

  // Fetch allowed company ids so multi-company payments resolve.
  let allCompanyIds = [];
  try {
    const compResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
      { headers }
    );
    allCompanyIds = (compResp.data?.result || []).map((c) => c.id);
  } catch (_) {}

  // Try full fields first; if that errors (field renamed/missing in this
  // Odoo version), retry with the bare minimum so detail view still loads.
  const fullFields = ['id', 'name', 'display_name', 'partner_id', 'partner_type', 'amount', 'date', 'state',
                      'payment_type', 'journal_id', 'memo', 'company_id', 'currency_id',
                      'customer_signature', 'employee_signature', 'latitude', 'longitude', 'location_name'];
  const minimalFields = ['id', 'name', 'display_name', 'partner_id', 'amount', 'date', 'state',
                         'payment_type', 'journal_id', 'company_id'];

  const tryRead = async (fields) => {
    const resp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'account.payment', method: 'read',
          args: [[Number(paymentId)]],
          kwargs: { fields, context: allCompanyIds.length ? { allowed_company_ids: allCompanyIds } : {} },
        },
      },
      { headers, timeout: 15000 }
    );
    if (resp.data?.error) throw new Error(resp.data.error?.data?.message || 'Odoo error');
    return resp.data?.result?.[0] || null;
  };

  let row = null;
  try {
    row = await tryRead(fullFields);
  } catch (err) {
    console.warn('[fetchPaymentDetail] full fields failed, retrying minimal:', err?.message);
    try {
      row = await tryRead(minimalFields);
    } catch (err2) {
      console.error('[fetchPaymentDetail] minimal fields also failed:', err2?.message);
      // Final fallback — cache across all three keys.
      const cached = await _findPaymentInAnyCache(paymentId);
      if (cached) return { ...cached, customer_signature: null, employee_signature: null };
      throw err2;
    }
  }

  if (!row) {
    // Odoo returned nothing (record invisible to this user / company) —
    // try the cache before giving up.
    const cached = await _findPaymentInAnyCache(paymentId);
    if (cached) return { ...cached, customer_signature: null, employee_signature: null };
    return null;
  }

  return {
    id: row.id,
    name: row.name || row.display_name || '',
    partner_id: Array.isArray(row.partner_id) ? row.partner_id[0] : null,
    partner_name: Array.isArray(row.partner_id) ? row.partner_id[1] : '',
    partner_type: row.partner_type || '',
    amount: row.amount || 0,
    date: row.date || '',
    state: row.state || 'draft',
    payment_type: row.payment_type || 'inbound',
    journal_id: Array.isArray(row.journal_id) ? row.journal_id[0] : null,
    journal_name: Array.isArray(row.journal_id) ? row.journal_id[1] : '',
    company_id: Array.isArray(row.company_id) ? row.company_id[0] : null,
    company_name: Array.isArray(row.company_id) ? row.company_id[1] : '',
    currency_symbol: Array.isArray(row.currency_id) ? row.currency_id[1] : '',
    memo: row.memo || '',
    customer_signature: row.customer_signature || null,
    employee_signature: row.employee_signature || null,
    latitude: row.latitude || null,
    longitude: row.longitude || null,
    location_name: row.location_name || '',
  };
};

// Validate (action_post) a payment — moves state Draft → Posted/Paid.
// Offline-aware: queues the action and patches the cache optimistically.
export const postPaymentOdoo = async (paymentId) => {
  // When the id is still `offline_X`, the record doesn't exist in Odoo yet —
  // Number('offline_X') is NaN, so the online RPC would silently no-op.
  // Always queue the action and let OfflineSyncService resolve offline→real id.
  const isOfflineId = String(paymentId).startsWith('offline_');
  try {
    const online = await isOnline();
    if (!online || isOfflineId) {
      // Read current state from cache so offline Validate steps through
      // draft → in_process on first tap and in_process → paid on second tap
      // (matches Odoo's online two-step flow).
      let currentState = 'draft';
      try {
        for (const k of ['@cache:accountPayments:inbound', '@cache:accountPayments:outbound', '@cache:accountPayments']) {
          const raw = await AsyncStorage.getItem(k);
          if (!raw) continue;
          const list = JSON.parse(raw);
          const match = list.find((p) => p.id === paymentId || String(p.id) === String(paymentId));
          if (match && match.state) { currentState = String(match.state).toLowerCase(); break; }
        }
      } catch (_) {}
      const nextState = currentState === 'in_process' ? 'paid' : 'in_process';

      await offlineQueue.enqueue({
        model: 'account.payment',
        operation: 'action_post',
        values: { _recordId: paymentId },
      });

      // Only flip state — keep the "NEW N(offline)" placeholder name intact
      // while offline. The real PAY number is assigned exclusively at sync
      // time by the OfflineSyncService handlers (create or action_post).
      const patch = { state: nextState };
      await _patchPaymentInCache(
        (p) => p.id === paymentId || String(p.id) === String(paymentId),
        patch
      );
      console.log('[postPayment] OFFLINE queued:', { paymentId, currentState, nextState });
      return { offline: true, state: nextState };
    }
  } catch (_) {}

  const headers = await getOdooAuthHeaders();
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');

  // Read current state so we can detect a real transition. Different Odoo
  // versions expose different methods for "Validate" — some have been
  // deprecated and silently no-op without error. We try each in order and
  // only accept the result when state actually changed.
  const readState = async () => {
    const r = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: { model: 'account.payment', method: 'read', args: [[Number(paymentId)]], kwargs: { fields: ['state'] } } },
      { headers, timeout: 10000 }
    );
    return r.data?.result?.[0]?.state;
  };

  let prevState;
  try { prevState = await readState(); } catch (_) { prevState = null; }
  console.log('[postPayment] id:', paymentId, 'previous state:', prevState);

  // Covers Odoo 16/17/18+. Each one is tried only if the prior method did
  // not transition the state (not just "no error" — the state must move).
  const methodsToTry = ['action_post', 'action_validate', 'mark_as_paid', '_action_post'];
  let lastErr = null;
  for (const method of methodsToTry) {
    try {
      const resp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'account.payment', method, args: [[Number(paymentId)]], kwargs: {} },
        },
        { headers, timeout: 15000 }
      );
      if (resp.data?.error) {
        lastErr = resp.data.error?.data?.message || resp.data.error?.message;
        console.log('[postPayment] via', method, '→ error:', lastErr);
        continue;
      }
      const newState = await readState();
      console.log('[postPayment] via', method, '→ state:', newState);
      if (newState && newState !== prevState) {
        return { success: true, state: newState, method };
      }
      // State didn't change; move on to the next method.
    } catch (e) {
      lastErr = e?.message;
      console.log('[postPayment] via', method, '→ threw:', lastErr);
    }
  }
  throw new Error(
    lastErr
      ? `Validate failed: ${lastErr}`
      : `Validate was accepted but state stayed "${prevState}". The payment may be locked, already processed, or require reconciliation.`
  );
};

// Reset a payment to Draft state — undoes Post / Validate. Standard Odoo
// account.payment.action_draft method. Visible from in_process / paid /
// cancelled states on the Odoo web form.
export const draftPaymentOdoo = async (paymentId) => {
  // Offline or `offline_X` id → queue the action and patch the cache so the
  // UI flips to Draft immediately. OfflineSyncService resolves the real id
  // and applies action_draft on Odoo after the create drains.
  const isOfflineId = String(paymentId).startsWith('offline_');
  try {
    const online = await isOnline();
    if (!online || isOfflineId) {
      await offlineQueue.enqueue({
        model: 'account.payment',
        operation: 'action_draft',
        values: { _recordId: paymentId },
      });
      await _patchPaymentInCache(
        (p) => p.id === paymentId || String(p.id) === String(paymentId),
        { state: 'draft' }
      );
      return { offline: true, state: 'draft' };
    }
  } catch (_) {}

  const headers = await getOdooAuthHeaders();
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
  const readState = async () => {
    const r = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: { model: 'account.payment', method: 'read', args: [[Number(paymentId)]], kwargs: { fields: ['state'] } } },
      { headers, timeout: 10000 }
    );
    return r.data?.result?.[0]?.state;
  };
  const methodsToTry = ['action_draft', 'button_draft', '_action_draft'];
  let lastErr = null;
  for (const method of methodsToTry) {
    try {
      const resp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'account.payment', method, args: [[Number(paymentId)]], kwargs: {} } },
        { headers, timeout: 15000 }
      );
      if (resp.data?.error) { lastErr = resp.data.error?.data?.message; continue; }
      const newState = await readState();
      console.log('[draftPayment] via', method, '→ state:', newState);
      if (newState === 'draft') return { success: true, state: newState, method };
    } catch (e) { lastErr = e?.message; }
  }
  throw new Error(
    lastErr
      ? `Reset failed: ${lastErr}`
      : `Reset was accepted but state did not return to draft. The payment may be reconciled or locked.`
  );
};

// Cancel a payment — offline-aware. Queues action_cancel and flips cache.
// Also takes the queue path when the id is still `offline_X` so Cancel works
// on pending-sync payments (Number('offline_X') would be NaN otherwise).
export const cancelPaymentOdoo = async (paymentId) => {
  const isOfflineId = String(paymentId).startsWith('offline_');
  try {
    const online = await isOnline();
    if (!online || isOfflineId) {
      await offlineQueue.enqueue({
        model: 'account.payment',
        operation: 'action_cancel',
        values: { _recordId: paymentId },
      });
      await _patchPaymentInCache(
        (p) => p.id === paymentId || String(p.id) === String(paymentId),
        { state: 'cancelled' }
      );
      return { offline: true, state: 'cancelled' };
    }
  } catch (_) {}

  const headers = await getOdooAuthHeaders();
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
  const resp = await axios.post(
    `${baseUrl}/web/dataset/call_kw`,
    {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.payment', method: 'action_cancel', args: [[Number(paymentId)]], kwargs: {} },
    },
    { headers, timeout: 15000 }
  );
  if (resp.data?.error) throw new Error(resp.data.error?.data?.message || 'Cancel failed');
  return { success: true };
};

// ============================================================
// POS API Functions
// ============================================================

// Helper: Full Odoo authentication (returns headers with session cookie)
const authenticateOdoo = async () => {
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');

  // Prefer the user's existing session cookie (from their actual login)
  // over a hardcoded DEFAULT_ODOO_DB re-authentication. This prevents the
  // user's database from being silently switched to 'test'.
  try {
    const existingCookie = await AsyncStorage.getItem('odoo_cookie');
    if (existingCookie) {
      return {
        headers: { 'Content-Type': 'application/json', Cookie: existingCookie },
        baseUrl,
      };
    }
  } catch (_) {}

  // No stored session → fall back to hardcoded credentials (only for app first-run)
  // Use the saved odoo_db if available, else DEFAULT_ODOO_DB
  let dbToUse = DEFAULT_ODOO_DB;
  try {
    const savedDb = await AsyncStorage.getItem('odoo_db');
    if (savedDb) dbToUse = savedDb;
  } catch (_) {}

  const loginResponse = await axios.post(
    `${baseUrl}/web/session/authenticate`,
    {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        db: dbToUse,
        login: DEFAULT_USERNAME,
        password: DEFAULT_PASSWORD,
      },
    },
    { headers: { 'Content-Type': 'application/json' }, withCredentials: true }
  );
  if (loginResponse.data.error) throw new Error('Odoo authentication failed');
  const setCookie = loginResponse.headers['set-cookie'] || loginResponse.headers['Set-Cookie'];
  const headers = { 'Content-Type': 'application/json' };
  if (setCookie) {
    headers.Cookie = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
  }
  return { headers, baseUrl };
};

// Fetch POS configurations from Odoo
export const fetchPosConfigsOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.config',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name', 'current_session_id', 'current_session_state'],
            limit: 50,
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (pos.config):', response.data.error);
      return [];
    }
    return (response.data.result || []).map(c => ({
      id: c.id,
      name: c.name || '',
      current_session_id: c.current_session_id ? c.current_session_id[0] : null,
      current_session_state: c.current_session_state || null,
    }));
  } catch (error) {
    console.error('fetchPosConfigsOdoo error:', error?.message || error);
    return [];
  }
};

// Open a POS session in Odoo
export const openPosSessionOdoo = async ({ posConfigId, openingBalance = 0 }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    // Use open_ui on pos.config which opens/creates a session
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.config',
          method: 'open_ui',
          args: [[posConfigId]],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (open POS session):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to open POS session');
    }
    // After open_ui, fetch the newly opened session
    const sessionResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.session',
          method: 'search_read',
          args: [[['config_id', '=', posConfigId], ['state', '=', 'opened']]],
          kwargs: {
            fields: ['id', 'name', 'config_id', 'state', 'start_at'],
            limit: 1,
          },
        },
      },
      { headers, withCredentials: true }
    );
    const sessions = sessionResp.data.result || [];
    if (sessions.length > 0) {
      return {
        id: sessions[0].id,
        name: sessions[0].name,
        config_id: sessions[0].config_id ? sessions[0].config_id[0] : posConfigId,
        state: sessions[0].state,
      };
    }
    return response.data.result;
  } catch (error) {
    console.error('openPosSessionOdoo error:', error?.message || error);
    throw error;
  }
};

// Close a POS session in Odoo
export const closePosSessionOdoo = async ({ sessionId }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.session',
          method: 'action_pos_session_closing_control',
          args: [[sessionId]],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (close POS session):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to close POS session');
    }
    return response.data.result;
  } catch (error) {
    console.error('closePosSessionOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch open POS sessions from Odoo
export const fetchOpenPosSessionOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.session',
          method: 'search_read',
          args: [[['state', '=', 'opened']]],
          kwargs: {
            fields: ['id', 'name', 'config_id', 'state', 'start_at', 'cash_register_balance_start'],
            limit: 10,
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (open POS sessions):', response.data.error);
      return [];
    }
    return (response.data.result || []).map(s => ({
      id: s.id,
      name: s.name || '',
      config_id: s.config_id ? s.config_id[0] : null,
      config_name: s.config_id ? s.config_id[1] : '',
      state: s.state,
      start_at: s.start_at || '',
      opening_balance: s.cash_register_balance_start || 0,
    }));
  } catch (error) {
    console.error('fetchOpenPosSessionOdoo error:', error?.message || error);
    return [];
  }
};

// Create a POS order in Odoo
export const createPosOrderOdoo = async ({ sessionId, partnerId, lines }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Calculate totals from lines
    let amountTotal = 0;
    let amountTax = 0;
    const orderLines = lines.map(line => {
      const qty = line.qty || line.quantity || 1;
      const priceUnit = line.price || line.price_unit || 0;
      const subtotal = qty * priceUnit;
      amountTotal += subtotal;
      return [0, 0, {
        product_id: line.product_id || line.id,
        qty: qty,
        price_unit: priceUnit,
        price_subtotal: subtotal,
        price_subtotal_incl: subtotal,
      }];
    });

    const vals = {
      session_id: sessionId,
      amount_total: amountTotal,
      amount_tax: amountTax,
      amount_paid: 0,
      amount_return: 0,
      lines: orderLines,
    };
    if (partnerId) vals.partner_id = partnerId;

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.order',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('Odoo JSON-RPC error (create POS order):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to create POS order');
    }

    console.log('[createPosOrderOdoo] Created order ID:', response.data.result);
    return { result: response.data.result };
  } catch (error) {
    console.error('createPosOrderOdoo error:', error?.message || error);
    throw error;
  }
};

// Create a POS payment in Odoo
export const createPosPaymentOdoo = async ({ orderId, amount, paymentMethodId }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    const vals = {
      pos_order_id: orderId,
      amount: amount,
      payment_method_id: paymentMethodId,
    };

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.payment',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('Odoo JSON-RPC error (create POS payment):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to create POS payment');
    }

    // Mark the order as paid
    try {
      await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'pos.order',
            method: 'action_pos_order_paid',
            args: [[orderId]],
            kwargs: {},
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );
    } catch (paidErr) {
      console.warn('action_pos_order_paid failed (non-critical):', paidErr?.message);
    }

    console.log('[createPosPaymentOdoo] Created payment ID:', response.data.result);
    return { result: response.data.result };
  } catch (error) {
    console.error('createPosPaymentOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch POS payment methods from Odoo
export const fetchPosPaymentMethodsOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'pos.payment.method',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name', 'type'],
            limit: 50,
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (pos.payment.method):', response.data.error);
      return [];
    }
    return (response.data.result || []).map(m => ({
      id: m.id,
      name: m.name || '',
      type: m.type || '',
    }));
  } catch (error) {
    console.error('fetchPosPaymentMethodsOdoo error:', error?.message || error);
    return [];
  }
};

// Fetch taxes from Odoo (sale taxes)
export const fetchTaxesOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.tax',
          method: 'search_read',
          args: [[['type_tax_use', '=', 'sale']]],
          kwargs: {
            fields: ['id', 'name', 'amount', 'type_tax_use', 'price_include'],
            limit: 50,
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (account.tax):', response.data.error);
      try {
        const cached = await AsyncStorage.getItem('@cache:salesTaxes');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
    const mapped = (response.data.result || []).map(t => ({
      id: t.id,
      name: t.name || '',
      amount: t.amount || 0,
      type_tax_use: t.type_tax_use || '',
      price_include: t.price_include || false,
    }));
    try { await AsyncStorage.setItem('@cache:salesTaxes', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('fetchTaxesOdoo error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:salesTaxes');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return [];
  }
};

// ============================================================
// Sales Order API Functions
// ============================================================

// Fetch all sale.order records from Odoo
export const fetchSaleOrdersOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  // Offline short-circuit — return cached rows (including any pending
  // offline_ placeholders) without trying the network. Without this, a
  // half-failing online attempt could swallow the cache and hide rows the
  // user just created via Place Order while offline.
  try {
    const online = await isOnline();
    if (!online) {
      const cached = await AsyncStorage.getItem('@cache:saleOrders');
      if (cached) {
        let list = JSON.parse(cached) || [];
        if (searchText && searchText.trim()) {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) => {
            const name = (o?.name || '').toLowerCase();
            const partner = Array.isArray(o?.partner_id) ? (o.partner_id[1] || '').toLowerCase() : '';
            return name.includes(term) || partner.includes(term);
          });
        }
        console.log('[SaleOrders] OFFLINE → returning', list.length, 'cached rows');
        return list;
      }
      return [];
    }
  } catch (_) { /* fall through to online path */ }

  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const domain = searchText
      ? ['|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]]
      : [];

    // Fetch all companies for allowed_company_ids
    let allCompanyIds = [1];
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers }
      );
      allCompanyIds = (compResp.data?.result || []).map(c => c.id);
    } catch (e) { /* fallback */ }

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'sale.order',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'state', 'amount_total', 'amount_untaxed', 'amount_tax', 'date_order', 'invoice_status', 'invoice_ids', 'company_id'],
            limit, offset, order: 'id desc',
            context: { allowed_company_ids: allCompanyIds },
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[SaleOrders] list error:', response.data.error?.data?.message || response.data.error);
      // Don't return empty — fall through to the offline-merge step so
      // pending offline_ placeholders still appear on the list.
    }
    let records = response.data.error ? [] : (response.data.result || []);
    console.log('[SaleOrders] Fetched', records.length, 'records from Odoo');

    // Merge offline-created placeholders still in cache (not synced yet) on
    // top of the fresh list. Also transfer the persisted `offline_label`
    // (the OFF) from previously-synced cache rows onto the fresh Odoo
    // record so the Ref sub-line keeps showing across refetches. Same
    // pattern as Easy Sales / Easy Purchase / Register Payment.
    if (!searchText && offset === 0) {
      try {
        const oldRaw = await AsyncStorage.getItem('@cache:saleOrders');
        if (oldRaw) {
          const oldList = JSON.parse(oldRaw);
          const labelByRealId = {};
          for (const o of oldList) {
            if (o?.id != null && o.offline_label && !String(o.id).startsWith('offline_')) {
              labelByRealId[String(o.id)] = o.offline_label;
            }
          }
          records = records.map((r) => {
            const lab = labelByRealId[String(r.id)];
            return lab ? { ...r, offline_label: lab } : r;
          });
          const pendingOffline = oldList.filter((o) => String(o?.id || '').startsWith('offline_'));
          if (pendingOffline.length > 0) {
            records = [...pendingOffline, ...records];
            console.log('[SaleOrders] merged', pendingOffline.length, 'pending offline_ rows on top');
          }
        }
      } catch (_) {}
      try { await AsyncStorage.setItem('@cache:saleOrders', JSON.stringify(records)); } catch (_) {}
    }
    console.log('[SaleOrders] returning', records.length, 'rows');
    return records;
  } catch (error) {
    console.error('[SaleOrders] fetchSaleOrders error:', error?.message || error);
    // Offline fallback — return cached list, filtered client-side by search text.
    try {
      const cached = await AsyncStorage.getItem('@cache:saleOrders');
      if (cached) {
        let list = JSON.parse(cached);
        if (searchText && searchText.trim() !== '') {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) => {
            const name = (o.name || '').toLowerCase();
            const partner = Array.isArray(o.partner_id) ? (o.partner_id[1] || '').toLowerCase() : '';
            return name.includes(term) || partner.includes(term);
          });
        }
        console.log('[SaleOrders] Using cached orders, count:', list.length);
        return list;
      }
    } catch (_) {}
    return [];
  }
};

// Fetch a single sale.order record by ID
export const fetchSaleOrderDetailOdoo = async (orderId) => {
  // Offline-created orders — read from local cache only.
  const idStr = String(orderId);
  if (idStr.startsWith('offline_')) {
    try {
      const cached = await AsyncStorage.getItem(`@cache:saleOrderDetail:${idStr}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Fetch all companies for allowed_company_ids
    let allCompanyIds = [1];
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers }
      );
      allCompanyIds = (compResp.data?.result || []).map(c => c.id);
    } catch (e) { /* fallback */ }

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'sale.order',
          method: 'read',
          args: [[orderId]],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'state', 'amount_total', 'amount_untaxed', 'amount_tax', 'date_order', 'warehouse_id', 'invoice_status', 'invoice_ids', 'order_line', 'company_id', 'currency_id', 'client_order_ref'],
            context: { allowed_company_ids: allCompanyIds },
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[SaleOrders] detail error:', response.data.error?.data?.message || response.data.error);
      return null;
    }
    const records = response.data.result || [];
    if (records.length === 0) return null;

    const record = records[0];

    // Fetch partner phone/mobile from res.partner
    if (record.partner_id) {
      const pid = Array.isArray(record.partner_id) ? record.partner_id[0] : record.partner_id;
      try {
        const phoneResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'res.partner', method: 'read', args: [[pid]], kwargs: { fields: ['phone', 'mobile'] } },
        }, { headers, timeout: 10000 });
        const partner = phoneResp.data?.result?.[0];
        record.partner_phone = partner?.phone || partner?.mobile || '';
      } catch (e) { record.partner_phone = ''; }
    }

    // Fetch order line details
    if (record.order_line && record.order_line.length > 0) {
      try {
        const linesResp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'sale.order.line',
              method: 'read',
              args: [record.order_line],
              kwargs: {
                fields: ['id', 'product_id', 'name', 'product_uom_qty', 'price_unit', 'price_subtotal', 'discount'],
                context: { allowed_company_ids: allCompanyIds },
              },
            },
          },
          { headers }
        );
        record.order_lines_detail = linesResp.data?.result || [];
      } catch (e) { record.order_lines_detail = []; }
    } else {
      record.order_lines_detail = [];
    }

    // Cache the merged detail for offline viewing.
    try { await AsyncStorage.setItem(`@cache:saleOrderDetail:${orderId}`, JSON.stringify(record)); } catch (_) {}
    return record;
  } catch (error) {
    console.error('[SaleOrders] fetchSaleOrderDetail error:', error?.message || error);
    // Offline fallback — return cached detail if we have it.
    try {
      const cached = await AsyncStorage.getItem(`@cache:saleOrderDetail:${orderId}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
};

// ─── Odoo-native Purchase Order (purchase.order) ────────────────────────────
// Used by the new "Purchase" option which mirrors Odoo's Request for Quotation
// screen. Separate from the legacy fetchPurchaseOrder which hits the old backend.

// State mapping mirrors Odoo's purchase.order.state selection:
//   'draft'   → RFQ
//   'sent'    → RFQ Sent
//   'to approve' → To Approve
//   'purchase' → Purchase Order
//   'done'    → Locked
//   'cancel'  → Cancelled
export const fetchPurchaseOrdersOdoo = async ({ offset = 0, limit = 50, searchText = '', state = '' } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const domain = [];
    if (state) domain.push(['state', '=', state]);
    if (searchText) {
      if (domain.length > 0) domain.unshift('&');
      domain.push('|', ['name', 'ilike', searchText], ['partner_id.name', 'ilike', searchText]);
    }

    let allCompanyIds = [1];
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers }
      );
      allCompanyIds = (compResp.data?.result || []).map((c) => c.id);
    } catch (_) {}

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'purchase.order',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'state', 'amount_total', 'amount_untaxed', 'amount_tax', 'date_order', 'date_planned', 'currency_id', 'partner_ref', 'company_id'],
            limit, offset, order: 'id desc',
            context: { allowed_company_ids: allCompanyIds },
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[PurchaseOrdersOdoo] list error:', response.data.error?.data?.message);
      return [];
    }
    const records = response.data.result || [];
    if (!searchText && !state && offset === 0) {
      try { await AsyncStorage.setItem('@cache:purchaseOrdersOdoo', JSON.stringify(records)); } catch (_) {}
    }
    return records;
  } catch (error) {
    console.error('[PurchaseOrdersOdoo] fetch error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:purchaseOrdersOdoo');
      if (cached) {
        let list = JSON.parse(cached);
        if (state) list = list.filter((o) => o.state === state);
        if (searchText && searchText.trim() !== '') {
          const term = searchText.trim().toLowerCase();
          list = list.filter((o) =>
            (o.name || '').toLowerCase().includes(term) ||
            (Array.isArray(o.partner_id) ? (o.partner_id[1] || '').toLowerCase().includes(term) : false)
          );
        }
        return list;
      }
    } catch (_) {}
    return [];
  }
};

export const fetchPurchaseOrderDetailOdoo = async (orderId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'purchase.order', method: 'read', args: [[orderId]],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'state', 'amount_total', 'amount_untaxed', 'amount_tax', 'date_order', 'date_planned', 'currency_id', 'partner_ref', 'company_id', 'order_line', 'notes', 'picking_type_id'],
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('[PurchaseOrderDetailOdoo] error:', response.data.error?.data?.message);
      return null;
    }
    const record = (response.data.result || [])[0];
    if (!record) return null;

    // Fetch order line details
    if (record.order_line && record.order_line.length > 0) {
      try {
        const linesResp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'purchase.order.line',
              method: 'read',
              args: [record.order_line],
              kwargs: { fields: ['id', 'product_id', 'name', 'product_qty', 'price_unit', 'taxes_id', 'price_subtotal', 'price_total'] },
            },
          },
          { headers }
        );
        record.order_lines_detail = linesResp.data?.result || [];
      } catch (_) { record.order_lines_detail = []; }
    } else {
      record.order_lines_detail = [];
    }

    try { await AsyncStorage.setItem(`@cache:purchaseOrderDetailOdoo:${orderId}`, JSON.stringify(record)); } catch (_) {}
    return record;
  } catch (error) {
    console.error('[PurchaseOrderDetailOdoo] fetch error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem(`@cache:purchaseOrderDetailOdoo:${orderId}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
};

// Create a purchase.order (RFQ) in Odoo. Online-only for now; offline comes later.
//
// `orderLines` shape:
//   [{ product_id, product_qty, price_unit, taxes_id: [id, ...] }, ...]
export const createPurchaseOrderOdoo = async ({ partnerId, orderLines, partnerRef, dateOrder, datePlanned, currencyId, pickingTypeId, notes }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const lines = (orderLines || []).map((l) => [0, 0, {
      product_id: l.product_id,
      product_qty: l.product_qty || l.qty || 1,
      price_unit: l.price_unit || 0,
      ...(l.name ? { name: l.name } : {}),
      ...(Array.isArray(l.taxes_id) && l.taxes_id.length > 0 ? { taxes_id: [[6, 0, l.taxes_id]] } : {}),
    }]);
    const vals = { partner_id: partnerId, order_line: lines };
    if (partnerRef) vals.partner_ref = partnerRef;
    if (dateOrder) vals.date_order = dateOrder;
    if (datePlanned) vals.date_planned = datePlanned;
    if (currencyId) vals.currency_id = currencyId;
    if (pickingTypeId) vals.picking_type_id = pickingTypeId;
    if (notes) vals.notes = notes;

    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'purchase.order', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create purchase order');
    return response.data.result;
  } catch (error) {
    console.error('[createPurchaseOrderOdoo] error:', error?.message || error);
    throw error;
  }
};

// Update an existing purchase.order. Same shape as create, minus lines (use
// separate line helpers when you need to edit lines in place).
export const updatePurchaseOrderOdoo = async (orderId, { partnerId, partnerRef, dateOrder, datePlanned, notes }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const vals = {};
    if (partnerId !== undefined) vals.partner_id = partnerId;
    if (partnerRef !== undefined) vals.partner_ref = partnerRef;
    if (dateOrder !== undefined) vals.date_order = dateOrder;
    if (datePlanned !== undefined) vals.date_planned = datePlanned;
    if (notes !== undefined) vals.notes = notes;
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'purchase.order', method: 'write', args: [[Number(orderId)], vals], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to update purchase order');
    return response.data.result;
  } catch (error) {
    console.error('[updatePurchaseOrderOdoo] error:', error?.message || error);
    throw error;
  }
};

// Mark the RFQ as "sent" (Odoo's state 'sent' — the Send RFQ button).
export const sendRfqPurchaseOrderOdoo = async (orderId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'purchase.order', method: 'write', args: [[Number(orderId)], { state: 'sent' }], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to send RFQ');
    return response.data.result;
  } catch (error) {
    console.error('[sendRfqPurchaseOrderOdoo] error:', error?.message || error);
    throw error;
  }
};

// Confirm the RFQ into a Purchase Order (action_confirm → state 'purchase').
export const confirmPurchaseOrderOdoo = async (orderId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'purchase.order', method: 'button_confirm', args: [[Number(orderId)]], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to confirm purchase order');
    return response.data.result;
  } catch (error) {
    console.error('[confirmPurchaseOrderOdoo] error:', error?.message || error);
    throw error;
  }
};

// Cancel any purchase.order regardless of state (button_cancel).
export const cancelPurchaseOrderOdoo = async (orderId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'purchase.order', method: 'button_cancel', args: [[Number(orderId)]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to cancel purchase order');
    return response.data.result;
  } catch (error) {
    console.error('[cancelPurchaseOrderOdoo] error:', error?.message || error);
    throw error;
  }
};

// Create a Sale Order (Quotation) in Odoo
// Per-DB storage key helpers so each Odoo tenant keeps its own A-counter and
// A-map. Switching to a different DB starts a fresh A-sequence based on that
// DB's existing orders; switching back resumes from where it left off.
const _currentDbName = async () => {
  try { return (await AsyncStorage.getItem('odoo_db')) || ''; } catch (_) { return ''; }
};
const _aMapKey = (db) => (db ? `a_map:${db}` : 'a_map');
const _aCounterKey = (db) => (db ? `@a_counter:${db}` : '@a_counter');

// App-local sale-order display counter, scoped to the active Odoo DB. Returns
// the next "A00001" / "A00002" label and persists the new counter value.
// Skips any A-number that's already in use — whether it lives in the
// per-DB a_map, on a cached row's `name`, or as the synthesised
// `A${padded(id)}` label that the list renderer assigns to Odoo-fetched
// orders without a map entry. This prevents both duplicates and large
// gaps caused by Odoo IDs landing on counter values.
const _nextSaleOrderANumber = async () => {
  try {
    const db = await _currentDbName();
    const counterKey = _aCounterKey(db);
    const mapKey = _aMapKey(db);
    const counterRaw = await AsyncStorage.getItem(counterKey);
    let counter = counterRaw ? parseInt(counterRaw, 10) : 0;
    if (!Number.isFinite(counter)) counter = 0;

    // Collect every A-number currently visible to the user.
    const used = new Set();
    try {
      const mapRaw = await AsyncStorage.getItem(mapKey);
      const map = mapRaw ? JSON.parse(mapRaw) : {};
      for (const v of Object.values(map || {})) {
        if (typeof v === 'string' && v.startsWith('A')) used.add(v);
      }
    } catch (_) {}
    try {
      const listRaw = await AsyncStorage.getItem('@cache:saleOrders');
      const list = listRaw ? JSON.parse(listRaw) : [];
      for (const o of list) {
        if (typeof o?.name === 'string' && o.name.startsWith('A')) used.add(o.name);
        const idStr = String(o?.id ?? '');
        if (idStr && !idStr.startsWith('offline_') && /^\d+$/.test(idStr)) {
          // The list renderer falls back to A + padded Odoo id when the
          // record has no map entry — so reserve those values too.
          used.add(`A${idStr.padStart(5, '0')}`);
        }
      }
    } catch (_) {}

    // Walk forward until we land on a free slot.
    let next = counter + 1;
    while (used.has(`A${String(next).padStart(5, '0')}`)) next += 1;
    await AsyncStorage.setItem(counterKey, String(next));
    return `A${String(next).padStart(5, '0')}`;
  } catch (_) {
    return `A${String(Date.now()).slice(-5)}`;
  }
};

// Persist the A-number for an order id (offline_<localId> initially, then
// the real Odoo id after sync — the sync handler copies the value across).
const _saveSaleOrderAName = async (id, aName) => {
  try {
    const db = await _currentDbName();
    const key = _aMapKey(db);
    const raw = await AsyncStorage.getItem(key);
    const map = raw ? JSON.parse(raw) : {};
    map[String(id)] = aName;
    await AsyncStorage.setItem(key, JSON.stringify(map));
  } catch (_) {}
};

export const createSaleOrderOdoo = async ({ partnerId, orderLines, warehouseId }) => {
  // Offline branch — queue the create, cache a placeholder so the order
  // appears in All Orders / list immediately.
  try {
    const online = await isOnline();
    console.log('[createSaleOrderOdoo] entered, isOnline =', online, 'partnerId=', partnerId, 'lines=', (orderLines || []).length);
    if (!online) {
      const lines = (orderLines || []).map(line => [0, 0, {
        product_id: line.product_id || line.id,
        product_uom_qty: line.qty || line.quantity || line.product_uom_qty || 1,
        price_unit: line.price_unit || line.price || line.unit_price || 0,
        discount: line.discount || line.discount_percentage || 0,
      }]);
      const vals = { partner_id: partnerId, order_line: lines };
      if (warehouseId) vals.warehouse_id = warehouseId;

      const localId = await offlineQueue.enqueue({
        model: 'sale.order', operation: 'create', values: vals,
      });

      // Look up partner name (for list display) from cached contacts.
      let partnerName = '';
      try {
        const raw = await AsyncStorage.getItem('@cache:contacts');
        if (raw) {
          const list = JSON.parse(raw);
          const p = list.find((c) => String(c.id) === String(partnerId));
          partnerName = p?.name || '';
        }
      } catch (_) {}

      // Totals for the placeholder.
      let amountUntaxed = 0;
      (orderLines || []).forEach((l) => {
        const qty = l.qty || l.quantity || l.product_uom_qty || 1;
        const price = l.price_unit || l.price || l.unit_price || 0;
        const discount = (l.discount || l.discount_percentage || 0) / 100;
        amountUntaxed += qty * price * (1 - discount);
      });

      const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
      // Assign a persistent OFF00001-style label, same flow as Easy Sales /
      // Easy Purchase / Register Payment. Bold while offline; after sync,
      // bold flips to Odoo's name and OFF moves to a Ref sub-line.
      const dbForCounterSO = (await AsyncStorage.getItem('odoo_db')) || '';
      const offLabelSO = await _nextOffLabel({
        counterKey: `@off_counter:saleOrders:${dbForCounterSO}`,
        cacheKey: '@cache:saleOrders',
      });
      const placeholder = {
        id: `offline_${localId}`,
        name: offLabelSO,
        offline_label: offLabelSO,
        partner_id: partnerId ? [partnerId, partnerName] : false,
        state: 'draft',
        amount_total: amountUntaxed,
        amount_untaxed: amountUntaxed,
        amount_tax: 0,
        date_order: nowIso,
        invoice_status: 'no',
        invoice_ids: [],
        company_id: false,
        offline: true,
      };

      // Append to the cached sale-order list.
      try {
        const rawList = await AsyncStorage.getItem('@cache:saleOrders');
        const list = rawList ? JSON.parse(rawList) : [];
        list.unshift(placeholder);
        await AsyncStorage.setItem('@cache:saleOrders', JSON.stringify(list));
        console.log('[createSaleOrderOdoo] OFFLINE placeholder pushed:', placeholder.name, 'cache size now:', list.length);
      } catch (e) { console.warn('[createSaleOrderOdoo] cache write failed:', e?.message); }

      // Build a detail-cache entry so tapping into it works offline.
      let allCompanyIds = [];
      // Enrich order_lines_detail for display using cached product info.
      let productCache = {};
      try {
        const rawProducts = await AsyncStorage.getItem('@cache:products');
        if (rawProducts) {
          const list = JSON.parse(rawProducts);
          list.forEach((p) => { productCache[p.id] = p; });
        }
      } catch (_) {}

      const detailLines = (orderLines || []).map((l, i) => {
        const pid = l.product_id || l.id;
        const pc = productCache[pid] || {};
        const qty = l.qty || l.quantity || l.product_uom_qty || 1;
        const price = l.price_unit || l.price || l.unit_price || 0;
        const discount = l.discount || l.discount_percentage || 0;
        return {
          id: `offline_line_${i}`,
          product_id: [pid, pc.product_name || pc.name || `#${pid}`],
          name: pc.product_name || pc.name || '',
          product_uom_qty: qty,
          price_unit: price,
          price_subtotal: qty * price * (1 - discount / 100),
          discount,
        };
      });

      const detailRecord = {
        ...placeholder,
        warehouse_id: warehouseId ? [warehouseId, ''] : false,
        currency_id: false,
        client_order_ref: '',
        partner_phone: '',
        order_line: [], order_lines_detail: detailLines,
      };
      try { await AsyncStorage.setItem(`@cache:saleOrderDetail:offline_${localId}`, JSON.stringify(detailRecord)); } catch (_) {}

      // Suppress the "unused allCompanyIds" reference — keep the shape similar to online.
      void allCompanyIds;
      console.log('[createSaleOrderOdoo] Queued offline, localId:', localId);
      return { offline: true, localId, id: `offline_${localId}` };
    }
  } catch (_) {}

  try {
    const { headers, baseUrl } = await authenticateOdoo();

    const lines = orderLines.map(line => [0, 0, {
      product_id: line.product_id || line.id,
      product_uom_qty: line.qty || line.quantity || line.product_uom_qty || 1,
      price_unit: line.price_unit || line.price || line.unit_price || 0,
      discount: line.discount || line.discount_percentage || 0,
    }]);

    const vals = {
      partner_id: partnerId,
      order_line: lines,
    };
    if (warehouseId) vals.warehouse_id = warehouseId;

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'sale.order',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('Odoo JSON-RPC error (create sale order):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to create sale order');
    }

    const newOrderId = response.data.result;
    console.log('[createSaleOrderOdoo] Created sale order ID:', newOrderId);
    // Online creates do NOT consume the OFF counter — only offline-created
    // orders carry an OFF label. Online orders show their Odoo name as bold
    // with no Ref sub-line.
    return newOrderId;
  } catch (error) {
    console.error('[createSaleOrderOdoo] Online path failed:', error?.message || error);
    // Fall back to offline queue for ANY non-business error so the user's
    // order is never lost. Only an explicit Odoo validation rejection
    // ("Failed to create sale order: ...") is allowed to propagate.
    const msg = String(error?.message || '');
    const isOdooBusinessError = msg.includes('Failed to create sale order')
      || msg.includes('does not exist or has been deleted')
      || (error?.response && error?.response?.data?.error);
    if (!isOdooBusinessError) {
      console.log('[createSaleOrderOdoo] Connectivity error detected — falling back to offline queue');
      const localId = await offlineQueue.enqueue({
        model: 'sale.order', operation: 'create', values: vals,
      });
      let partnerName = '';
      try { const raw = await AsyncStorage.getItem('@cache:contacts'); if (raw) { const list = JSON.parse(raw); const p = list.find((c) => String(c.id) === String(partnerId)); partnerName = p?.name || ''; } } catch (_) {}
      let amountUntaxed = 0;
      (orderLines || []).forEach((l) => { const qty = l.qty || l.quantity || l.product_uom_qty || 1; const price = l.price_unit || l.price || l.unit_price || 0; amountUntaxed += qty * price; });
      const nowIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const dbForCounterSOFb = (await AsyncStorage.getItem('odoo_db')) || '';
      const offLabelSOFb = await _nextOffLabel({
        counterKey: `@off_counter:saleOrders:${dbForCounterSOFb}`,
        cacheKey: '@cache:saleOrders',
      });
      const placeholder = { id: `offline_${localId}`, name: offLabelSOFb, offline_label: offLabelSOFb, partner_id: partnerId ? [partnerId, partnerName] : false, state: 'draft', amount_total: amountUntaxed, amount_untaxed: amountUntaxed, amount_tax: 0, date_order: nowIso, invoice_status: 'no', invoice_ids: [], offline: true };
      try { const rawList = await AsyncStorage.getItem('@cache:saleOrders'); const list = rawList ? JSON.parse(rawList) : []; list.unshift(placeholder); await AsyncStorage.setItem('@cache:saleOrders', JSON.stringify(list)); } catch (_) {}
      console.log('[createSaleOrderOdoo] Queued offline (network fallback), localId:', localId);
      return { offline: true, localId, id: `offline_${localId}` };
    }
    throw error;
  }
};

// Confirm a Sale Order (Quotation → Sale Order) in Odoo
export const confirmSaleOrderOdoo = async (orderId, companyId = null) => {
  // Offline branch — queue the confirm action + update cached state.
  try {
    const online = await isOnline();
    if (!online) {
      const idStr = String(orderId);
      if (idStr.startsWith('offline_')) {
        // Fold "confirm" into the pending create by tagging values with a
        // _confirmAfterCreate flag. The sync handler picks it up and calls
        // action_confirm once the order is created in Odoo.
        const queueItemId = idStr.replace('offline_', '');
        await offlineQueue.updateValues(queueItemId, { _confirmAfterCreate: true });
      } else {
        await offlineQueue.enqueue({
          model: 'sale.order',
          operation: 'action_confirm',
          values: { _recordId: orderId, companyId: companyId || null },
        });
      }

      // Update cached state to 'sale' so the list shows it under Sales Order.
      try {
        const raw = await AsyncStorage.getItem('@cache:saleOrders');
        if (raw) {
          const list = JSON.parse(raw);
          const idx = list.findIndex((o) => String(o.id) === idStr);
          if (idx >= 0) { list[idx] = { ...list[idx], state: 'sale' }; await AsyncStorage.setItem('@cache:saleOrders', JSON.stringify(list)); }
        }
      } catch (_) {}
      try {
        const detailKey = `@cache:saleOrderDetail:${idStr}`;
        const rawD = await AsyncStorage.getItem(detailKey);
        if (rawD) {
          const prev = JSON.parse(rawD);
          await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, state: 'sale' }));
        }
      } catch (_) {}

      console.log('[confirmSaleOrderOdoo] Queued offline for id:', orderId);
      return { offline: true };
    }
  } catch (_) {}

  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Fetch all companies for allowed_company_ids
    let allCompanyIds = [1];
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers }
      );
      allCompanyIds = (compResp.data?.result || []).map(c => c.id);
    } catch (e) { /* fallback */ }

    const companyIds = companyId
      ? [companyId, ...allCompanyIds.filter(id => id !== companyId)]
      : allCompanyIds;

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'sale.order',
          method: 'action_confirm',
          args: [[orderId]],
          kwargs: { context: { allowed_company_ids: companyIds } },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (confirm sale order):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to confirm sale order');
    }
    console.log('[confirmSaleOrderOdoo] Confirmed order ID:', orderId);
    return response.data.result;
  } catch (error) {
    console.error('confirmSaleOrderOdoo error:', error?.message || error);
    throw error;
  }
};

// Validate (auto-deliver) all pickings for a confirmed sale order
// This triggers stock.quant updates and allows negative stock via pos_negative_stock module
export const validateSaleOrderPickingsOdoo = async (orderId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // 1. Get picking_ids from sale order
    const soResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['picking_ids'] } },
    }, { headers, timeout: 15000 });
    const pickingIds = soResp.data?.result?.[0]?.picking_ids || [];
    if (pickingIds.length === 0) {
      console.log('[validatePickings] No pickings found for order', orderId);
      return;
    }

    // 2. Read pickings to find unvalidated ones
    const pickResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'stock.picking', method: 'read', args: [pickingIds], kwargs: { fields: ['id', 'state', 'move_ids'] } },
    }, { headers, timeout: 15000 });
    const pickings = (pickResp.data?.result || []).filter(p => !['done', 'cancel'].includes(p.state));

    if (pickings.length === 0) {
      console.log('[validatePickings] All pickings already done/cancelled');
      return;
    }

    // 3. For each picking: force-assign, set quantities, validate
    for (const picking of pickings) {
      // Force-assign the picking (triggers pos_negative_stock override)
      try {
        await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'stock.picking', method: 'action_assign', args: [[picking.id]], kwargs: {} },
        }, { headers, timeout: 15000 });
      } catch (e) { console.warn('[validatePickings] action_assign warning:', e?.message); }

      if (picking.move_ids && picking.move_ids.length > 0) {
        // Read move quantities
        const movesResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'stock.move', method: 'read', args: [picking.move_ids], kwargs: { fields: ['id', 'product_uom_qty'] } },
        }, { headers, timeout: 15000 });

        // Set delivered quantity + picked flag for each move
        for (const move of (movesResp.data?.result || [])) {
          await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'stock.move', method: 'write', args: [[move.id], { quantity: move.product_uom_qty, picked: true }], kwargs: {} },
          }, { headers, timeout: 15000 });
        }
      }

      // Validate the picking
      const validateResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'stock.picking', method: 'button_validate', args: [[picking.id]],
          kwargs: { context: { skip_backorder: true, skip_sms: true, skip_immediate: true } },
        },
      }, { headers, timeout: 15000 });

      const validateResult = validateResp.data?.result;

      // If button_validate returns a wizard action, process it
      if (validateResult && typeof validateResult === 'object' && validateResult.res_model) {
        const wizardModel = validateResult.res_model;
        const wizardId = validateResult.res_id;
        console.log('[validatePickings] Wizard returned:', wizardModel, 'id:', wizardId);

        if (wizardModel === 'stock.backorder.confirmation' || wizardModel === 'stock.immediate.transfer') {
          // Process the wizard to confirm validation
          try {
            const wizardCtx = validateResult.context || {};
            if (wizardId) {
              await axios.post(`${baseUrl}/web/dataset/call_kw`, {
                jsonrpc: '2.0', method: 'call',
                params: { model: wizardModel, method: 'process', args: [[wizardId]], kwargs: { context: wizardCtx } },
              }, { headers, timeout: 15000 });
            } else {
              // No res_id — create wizard and process it
              const createWizResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
                jsonrpc: '2.0', method: 'call',
                params: { model: wizardModel, method: 'create', args: [{}], kwargs: { context: wizardCtx } },
              }, { headers, timeout: 15000 });
              const newWizId = createWizResp.data?.result;
              if (newWizId) {
                await axios.post(`${baseUrl}/web/dataset/call_kw`, {
                  jsonrpc: '2.0', method: 'call',
                  params: { model: wizardModel, method: 'process', args: [[newWizId]], kwargs: { context: wizardCtx } },
                }, { headers, timeout: 15000 });
              }
            }
            console.log('[validatePickings] Wizard processed for picking', picking.id);
          } catch (wizErr) {
            console.warn('[validatePickings] Wizard processing failed:', wizErr?.message);
          }
        }
      } else {
        console.log('[validatePickings] Validated picking', picking.id);
      }
    }
  } catch (error) {
    console.warn('[validatePickings] Error validating pickings for order', orderId, ':', error?.message);
    // Don't throw — picking validation failure should not block invoice creation
  }
};

// Update order lines on a draft sale.order in Odoo
// Changes: array of { lineId, qty, price_unit } to update, or { lineId, delete: true } to remove
// Additions: array of { product_id, qty, price_unit } to add
export const updateSaleOrderLinesOdoo = async (orderId, { changes = [], additions = [], deletions = [] } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Fetch all companies
    let allCompanyIds = [1];
    try {
      const compResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers }
      );
      allCompanyIds = (compResp.data?.result || []).map(c => c.id);
    } catch (e) { /* fallback */ }

    // Build order_line commands using Odoo's (0/1/2) command format
    const lineCommands = [];

    // Update existing lines: [1, lineId, { field: value }]
    changes.forEach(ch => {
      const vals = {};
      if (ch.qty !== undefined) vals.product_uom_qty = ch.qty;
      if (ch.price_unit !== undefined) vals.price_unit = ch.price_unit;
      if (Object.keys(vals).length > 0) {
        lineCommands.push([1, ch.lineId, vals]);
      }
    });

    // Delete lines: [2, lineId, 0]
    deletions.forEach(lineId => {
      lineCommands.push([2, lineId, 0]);
    });

    // Add new lines: [0, 0, { product_id, product_uom_qty, price_unit }]
    additions.forEach(add => {
      lineCommands.push([0, 0, {
        product_id: add.product_id,
        product_uom_qty: add.qty || 1,
        price_unit: add.price_unit || 0,
      }]);
    });

    if (lineCommands.length === 0) return true;

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'sale.order',
          method: 'write',
          args: [[orderId], { order_line: lineCommands }],
          kwargs: { context: { allowed_company_ids: allCompanyIds } },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('[updateSaleOrderLines] error:', response.data.error?.data?.message || response.data.error);
      throw new Error(response.data.error.data?.message || 'Failed to update order lines');
    }

    console.log('[updateSaleOrderLines] Updated order:', orderId);
    return true;
  } catch (error) {
    console.error('[updateSaleOrderLines] error:', error?.message || error);
    throw error;
  }
};

// Create Invoice from a confirmed Sale Order in Odoo
export const createInvoiceFromQuotationOdoo = async (orderId, companyId = null) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    console.log('[createInvoice] === START === orderId:', orderId, 'companyId:', companyId);

    let allCompanyIds = [1];
    try {
      const compResp = await axios.post(`${baseUrl}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: { model: 'res.company', method: 'search_read', args: [[]], kwargs: { fields: ['id'], limit: 100 } } },
        { headers });
      allCompanyIds = (compResp.data?.result || []).map(c => c.id);
    } catch (e) { console.warn('[createInvoice] Company fetch failed:', e?.message); }

    const companyIds = companyId ? [companyId, ...allCompanyIds.filter(id => id !== companyId)] : allCompanyIds;
    const wizardCtx = { allowed_company_ids: companyIds, active_ids: [orderId], active_id: orderId, active_model: 'sale.order' };
    console.log('[createInvoice] Context:', JSON.stringify({ companyIds, orderId }));

    // STEP 0: Check order state first
    try {
      const stateResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['state', 'invoice_status', 'invoice_ids', 'name'] } },
      }, { headers, timeout: 15000 });
      const soState = stateResp.data?.result?.[0];
      console.log('[createInvoice] Order state:', soState?.state, 'invoice_status:', soState?.invoice_status, 'existing_invoices:', soState?.invoice_ids?.length, 'name:', soState?.name);

      // If already invoiced, return existing invoice
      if (soState?.invoice_ids?.length > 0) {
        const existingInvId = soState.invoice_ids[soState.invoice_ids.length - 1];
        console.log('[createInvoice] Order already has invoice:', existingInvId, '— returning it');
        return { result: existingInvId };
      }

      // If order is still draft, confirm it first
      if (soState?.state === 'draft' || soState?.state === 'sent') {
        console.log('[createInvoice] Order is in draft/sent state — confirming first');
        try {
          await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'sale.order', method: 'action_confirm', args: [[orderId]], kwargs: { context: { allowed_company_ids: companyIds } } },
          }, { headers, timeout: 15000 });
          console.log('[createInvoice] Order confirmed');
        } catch (confErr) { console.warn('[createInvoice] Confirm failed:', confErr?.message); }
      }
    } catch (stateErr) { console.warn('[createInvoice] State check failed:', stateErr?.message); }

    // STEP 1: Ensure delivery is done (so 'delivered' method works)
    console.log('[createInvoice] Step 1: Validating pickings for SO', orderId);
    try {
      await validateSaleOrderPickingsOdoo(orderId);
      console.log('[createInvoice] Pickings validated OK');
    } catch (e) {
      console.warn('[createInvoice] Picking validation warning:', e?.message);
    }

    // STEP 2: Get existing invoice_ids
    const soBeforeResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['invoice_ids'] } },
    }, { headers, timeout: 15000 });
    const oldInvoiceIds = soBeforeResp.data?.result?.[0]?.invoice_ids || [];

    // STEP 3: Try wizard with 'delivered' first, then 'percentage' as fallback
    let invoiceId = null;
    const methods = ['delivered', 'percentage'];
    for (const method of methods) {
      try {
        console.log('[createInvoice] Step 3: Trying wizard with method:', method);
        const wizardArgs = { advance_payment_method: method };
        if (method === 'percentage') wizardArgs.amount = 100;

        const wizardResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'sale.advance.payment.inv', method: 'create', args: [wizardArgs], kwargs: { context: wizardCtx } },
        }, { headers, timeout: 15000 });

        if (wizardResp.data.error) {
          console.warn('[createInvoice] Wizard create failed for', method, ':', wizardResp.data.error?.data?.message);
          continue;
        }
        const wizardId = wizardResp.data.result;
        console.log('[createInvoice] Wizard created:', wizardId, 'method:', method);

        const execResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'sale.advance.payment.inv', method: 'create_invoices', args: [[wizardId]], kwargs: { context: wizardCtx } },
        }, { headers, timeout: 30000 });

        if (execResp.data.error) {
          console.warn('[createInvoice] Wizard exec failed for', method, ':', execResp.data.error?.data?.message);
          continue;
        }
        console.log('[createInvoice] Wizard executed with method:', method);

        // Find new invoice
        const soAfterResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['invoice_ids'] } },
        }, { headers, timeout: 15000 });
        const newInvoiceIds = soAfterResp.data?.result?.[0]?.invoice_ids || [];
        invoiceId = newInvoiceIds.find(id => !oldInvoiceIds.includes(id)) || (newInvoiceIds.length > oldInvoiceIds.length ? newInvoiceIds[newInvoiceIds.length - 1] : null);

        if (invoiceId) {
          console.log('[createInvoice] Invoice created:', invoiceId, 'via method:', method);
          break;
        }
      } catch (wizErr) {
        console.warn('[createInvoice] Method', method, 'failed:', wizErr?.message);
      }
    }

    // FALLBACK: If wizard methods failed, create invoice directly via account.move
    if (!invoiceId) {
      console.log('[createInvoice] Wizard methods failed, trying direct account.move create');
      try {
        // Read order lines to build invoice lines
        const soDataResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['partner_id', 'order_line', 'currency_id', 'company_id'] } },
        }, { headers, timeout: 15000 });
        const soData = soDataResp.data?.result?.[0];
        if (soData && soData.order_line && soData.order_line.length > 0) {
          const linesResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'sale.order.line', method: 'read', args: [soData.order_line], kwargs: { fields: ['product_id', 'product_uom_qty', 'price_unit', 'discount', 'name', 'tax_id'] } },
          }, { headers, timeout: 15000 });
          const soLines = linesResp.data?.result || [];

          const invoiceLines = soLines.map((l) => [0, 0, {
            product_id: Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
            quantity: l.product_uom_qty || 1,
            price_unit: l.price_unit || 0,
            discount: l.discount || 0,
            name: l.name || '',
            ...(l.tax_id && l.tax_id.length > 0 ? { tax_ids: [[6, 0, l.tax_id]] } : {}),
          }]);

          const partnerId = Array.isArray(soData.partner_id) ? soData.partner_id[0] : soData.partner_id;
          const moveResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'account.move', method: 'create',
              args: [{
                move_type: 'out_invoice',
                partner_id: partnerId,
                invoice_origin: soData.name || `SO-${orderId}`,
                invoice_line_ids: invoiceLines,
                ...(soData.currency_id ? { currency_id: Array.isArray(soData.currency_id) ? soData.currency_id[0] : soData.currency_id } : {}),
              }],
              kwargs: { context: wizardCtx },
            },
          }, { headers, timeout: 30000 });

          if (!moveResp.data?.error && moveResp.data?.result) {
            invoiceId = moveResp.data.result;
            console.log('[createInvoice] Direct account.move created:', invoiceId);
          } else {
            console.warn('[createInvoice] Direct create failed:', moveResp.data?.error?.data?.message);
          }
        }
      } catch (directErr) {
        console.warn('[createInvoice] Direct fallback failed:', directErr?.message);
      }
    }

    if (!invoiceId) {
      console.error('[createInvoice] All methods failed including direct create');
      throw new Error('Failed to create invoice - all methods failed');
    }

    // STEP 4: Verify invoice has lines
    const verifyResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move', method: 'read', args: [[invoiceId]],
        kwargs: { fields: ['name', 'amount_total', 'state', 'invoice_line_ids'] } },
    }, { headers, timeout: 15000 });
    const inv = verifyResp.data?.result?.[0];
    console.log('[createInvoice] VERIFY - name:', inv?.name, 'total:', inv?.amount_total, 'lines:', inv?.invoice_line_ids?.length, 'state:', inv?.state);

    // STEP 5: Post the invoice
    try {
      const postResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'account.move', method: 'action_post', args: [[invoiceId]], kwargs: { context: wizardCtx } },
      }, { headers, timeout: 15000 });
      if (postResp.data.error) {
        console.warn('[createInvoice] Post error:', postResp.data.error?.data?.message);
      } else {
        console.log('[createInvoice] Invoice posted successfully');
      }
    } catch (postErr) {
      console.warn('[createInvoice] Could not post:', postErr?.message);
    }

    // STEP 6: Force stock decrease — directly update stock.quant for each product
    try {
      console.log('[createInvoice] Step 6: Force stock decrease for SO', orderId);
      // Read sale order lines
      const soLinesResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['order_line'] } },
      }, { headers, timeout: 15000 });
      const orderLineIds = soLinesResp.data?.result?.[0]?.order_line || [];

      if (orderLineIds.length > 0) {
        const linesResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'sale.order.line', method: 'read', args: [orderLineIds], kwargs: { fields: ['product_id', 'product_uom_qty', 'qty_delivered'] } },
        }, { headers, timeout: 15000 });
        const lines = linesResp.data?.result || [];

        for (const line of lines) {
          const productId = Array.isArray(line.product_id) ? line.product_id[0] : line.product_id;
          const qty = line.product_uom_qty || 0;
          if (!productId || qty <= 0) continue;

          // Check if picking already delivered this (qty_delivered > 0 means stock already decreased)
          if (line.qty_delivered >= qty) {
            console.log('[createInvoice] Stock already decreased for product', productId, '- qty_delivered:', line.qty_delivered);
            continue;
          }

          // Search for existing stock.quant for this product in internal locations
          const quantResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: {
              model: 'stock.quant', method: 'search_read',
              args: [[['product_id', '=', productId], ['location_id.usage', '=', 'internal']]],
              kwargs: { fields: ['id', 'quantity', 'location_id'], limit: 1 },
            },
          }, { headers, timeout: 15000 });
          const quants = quantResp.data?.result || [];

          if (quants.length > 0) {
            // Update existing quant — subtract qty
            const quant = quants[0];
            const newQty = (quant.quantity || 0) - qty;
            await axios.post(`${baseUrl}/web/dataset/call_kw`, {
              jsonrpc: '2.0', method: 'call',
              params: { model: 'stock.quant', method: 'write', args: [[quant.id], { quantity: newQty }], kwargs: {} },
            }, { headers, timeout: 15000 });
            console.log('[createInvoice] Stock decreased for product', productId, ':', quant.quantity, '->', newQty);
          } else {
            // No quant exists — find the default warehouse stock location and create negative quant
            const locResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
              jsonrpc: '2.0', method: 'call',
              params: {
                model: 'stock.warehouse', method: 'search_read',
                args: [[]], kwargs: { fields: ['lot_stock_id'], limit: 1 },
              },
            }, { headers, timeout: 15000 });
            const locId = locResp.data?.result?.[0]?.lot_stock_id;
            const locationId = Array.isArray(locId) ? locId[0] : locId;
            if (locationId) {
              await axios.post(`${baseUrl}/web/dataset/call_kw`, {
                jsonrpc: '2.0', method: 'call',
                params: {
                  model: 'stock.quant', method: 'create',
                  args: [{ product_id: productId, location_id: locationId, quantity: -qty }],
                  kwargs: {},
                },
              }, { headers, timeout: 15000 });
              console.log('[createInvoice] Created negative quant for product', productId, ': -' + qty);
            }
          }
        }
      }
    } catch (stockErr) {
      console.warn('[createInvoice] Force stock decrease failed:', stockErr?.message);
      // Don't block — invoice was already created
    }

    return { result: invoiceId };
  } catch (error) {
    console.error('[createInvoice] FATAL ERROR:', error?.message || error);
    throw error;
  }
};

// Search invoices by origin (SO name) - fallback for directly created invoices
export const searchInvoicesByOriginOdoo = async (originName) => {
  try {
    const headers = await getOdooAuthHeaders();
    const resp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move', method: 'search_read',
        args: [[['invoice_origin', 'ilike', originName], ['move_type', '=', 'out_invoice']]],
        kwargs: { fields: ['id'], limit: 10 } },
    }, { headers, timeout: 10000 });
    return resp.data?.result || [];
  } catch (e) {
    console.warn('[searchInvoicesByOrigin] error:', e?.message);
    return [];
  }
};

// Fetch Customer Invoices from Odoo
export const fetchCustomerInvoicesOdoo = async ({ partnerId, offset = 0, limit = 50 } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    let domain = [['move_type', '=', 'out_invoice']];
    if (partnerId) {
      domain = [['move_type', '=', 'out_invoice'], ['partner_id', '=', partnerId]];
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.move',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 'state', 'payment_state', 'currency_id'],
            offset,
            limit,
            order: 'invoice_date desc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (customer invoices):', response.data.error);
      return [];
    }
    return (response.data.result || []).map(inv => ({
      id: inv.id,
      name: inv.name || '',
      partner_id: inv.partner_id ? inv.partner_id[0] : null,
      partner_name: inv.partner_id ? inv.partner_id[1] : '',
      invoice_date: inv.invoice_date || '',
      amount_total: inv.amount_total || 0,
      amount_residual: inv.amount_residual || 0,
      state: inv.state || '',
      payment_state: inv.payment_state || '',
      currency_name: inv.currency_id ? inv.currency_id[1] : '',
    }));
  } catch (error) {
    console.error('fetchCustomerInvoicesOdoo error:', error?.message || error);
    return [];
  }
};

// ============================================================
// Spare Management API Functions (mobile.repair module in Odoo)
// ============================================================

// Fetch spare part requests from Odoo
export const fetchSparePartRequestsOdoo = async ({ offset = 0, limit = 20, searchText = '' } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let domain = [];
    if (searchText) {
      domain = [['name', 'ilike', searchText]];
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'spare.part.request',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: [],
            offset,
            limit,
            order: 'create_date desc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (spare.part.request):', response.data.error);
      return [];
    }
    const records = response.data.result || [];
    if (records.length > 0) {
      console.log('spare.part.request fields:', Object.keys(records[0]));
    }
    return records.map(r => ({
      id: r.id,
      name: r.name || r.display_name || '',
      job_card_id: r.job_card_id ? r.job_card_id[0] : null,
      job_card_name: r.job_card_id ? r.job_card_id[1] : '',
      partner_id: r.partner_id ? r.partner_id[0] : (r.customer_id ? r.customer_id[0] : null),
      partner_name: r.partner_id ? r.partner_id[1] : (r.customer_id ? r.customer_id[1] : ''),
      state: r.state || r.stage || '',
      requested_by: r.requested_by ? r.requested_by[1] : (r.request_by ? r.request_by[1] : ''),
      requested_to: r.requested_to ? r.requested_to[1] : (r.request_to ? r.request_to[1] : ''),
      request_date: r.request_date || r.date || r.create_date || '',
      notes: r.notes || r.note || '',
      line_count: Array.isArray(r.spare_parts_line) ? r.spare_parts_line.length : (Array.isArray(r.line_ids) ? r.line_ids.length : (Array.isArray(r.spare_line_ids) ? r.spare_line_ids.length : 0)),
    }));
  } catch (error) {
    console.error('fetchSparePartRequestsOdoo error:', error?.message || error);
    return [];
  }
};

// Fetch spare part request details from Odoo
export const fetchSparePartRequestDetailsOdoo = async (requestId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    // Read all fields (empty array = all) to handle varying field names
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'spare.part.request',
          method: 'read',
          args: [[requestId]],
          kwargs: { fields: [] },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (spare part request detail):', response.data.error);
      return null;
    }
    const r = (response.data.result || [])[0];
    if (!r) return null;

    console.log('SpareRequestDetails all fields:', Object.keys(r));

    // Helper to extract Many2one display name
    const m2oName = (val) => {
      if (!val || val === false) return '';
      if (Array.isArray(val)) return val[1] || '';
      return String(val);
    };
    const m2oId = (val) => {
      if (!val || val === false) return null;
      if (Array.isArray(val)) return val[0];
      return val;
    };

    // Helper to find first truthy value from multiple field candidates
    const findVal = (candidates) => {
      for (const f of candidates) {
        if (r[f] !== undefined && r[f] !== false) return r[f];
      }
      return null;
    };

    // Find line IDs from multiple possible field names
    const lineIds = findVal(['spare_parts_line', 'line_ids', 'spare_line_ids', 'order_line']) || [];

    // Fetch spare parts line details if line IDs exist
    let spareLines = [];
    if (lineIds.length > 0) {
      try {
        const lineResponse = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model: 'spare.part.request.line',
              method: 'read',
              args: [lineIds],
              kwargs: { fields: [] },
            },
          },
          { headers }
        );
        if (!lineResponse.data.error) {
          const lineResults = lineResponse.data.result || [];

          // Helper for line qty fields
          const getLineField = (l, candidates, def = 0) => {
            for (const f of candidates) {
              if (l[f] !== undefined && l[f] !== false) return l[f];
            }
            return def;
          };

          spareLines = lineResults.map(l => ({
            id: l.id,
            product_id: l.product_id ? l.product_id[0] : null,
            product_name: l.product_id ? l.product_id[1] : '',
            description: l.description || l.name || '',
            requested_qty: getLineField(l, ['requested_qty', 'qty_requested', 'qty', 'product_qty', 'quantity', 'product_uom_qty'], 0),
            uom: m2oName(l.uom_id || l.product_uom) || l.uom || 'Units',
            issued_qty: getLineField(l, ['issued_qty', 'qty_issued', 'issue_qty'], 0),
            returned_qty: getLineField(l, ['returned_qty', 'qty_returned', 'return_qty'], 0),
          }));
        }
      } catch (lineErr) {
        console.warn('Failed to fetch spare part lines:', lineErr?.message);
      }
    }

    const requestedBy = findVal(['requested_by', 'requested_by_id', 'request_by', 'request_user_id', 'user_id']);
    const requestedTo = findVal(['requested_to', 'requested_to_id', 'request_to', 'assigned_to']);
    const approvedBy = findVal(['approved_by', 'approved_by_id', 'approve_by']);
    const approvedDate = findVal(['approved_date', 'approve_date', 'date_approved']);

    return {
      id: r.id,
      name: r.name || r.display_name || '',
      job_card_id: m2oId(r.job_card_id),
      job_card_name: m2oName(r.job_card_id),
      partner_id: m2oId(r.partner_id || r.customer_id),
      partner_name: m2oName(r.partner_id || r.customer_id),
      state: r.state || r.stage || '',
      requested_by: m2oName(requestedBy),
      requested_by_id: m2oId(requestedBy),
      requested_to: m2oName(requestedTo),
      requested_to_id: m2oId(requestedTo),
      request_date: r.request_date || r.date_request || r.create_date || '',
      notes: r.notes || r.note || r.description || '',
      approved_by: m2oName(approvedBy),
      approved_date: approvedDate || '',
      spare_lines: spareLines,
    };
  } catch (error) {
    console.error('fetchSparePartRequestDetailsOdoo error:', error?.message || error);
    return null;
  }
};

// Create a spare part request in Odoo
export const createSparePartRequestOdoo = async ({
  jobCardId,
  customerId,
  requestedById,
  requestedToId,
  requestDate,
  notes,
  lines = [],
}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Step 1: Discover actual field names via fields_get
    const fieldsResponse = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'spare.part.request',
          method: 'fields_get',
          args: [],
          kwargs: { attributes: ['string', 'type', 'relation'] },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    const fieldDefs = fieldsResponse.data?.result || {};
    const fieldNames = Object.keys(fieldDefs);
    console.log('spare.part.request all fields:', fieldNames);

    // Find the One2many line field
    const one2manyFields = fieldNames.filter(f => fieldDefs[f].type === 'one2many');
    console.log('spare.part.request One2many fields:', one2manyFields);

    // Find the line relation model name
    const lineFieldName = one2manyFields.find(f =>
      f.includes('line') || f.includes('spare') || f.includes('part')
    ) || one2manyFields[0] || null;
    const lineModel = lineFieldName ? fieldDefs[lineFieldName].relation : null;
    console.log('Line field:', lineFieldName, '-> model:', lineModel);

    // Step 2: Build vals with discovered field names
    const vals = {};

    // Map header fields - try known field names
    const trySet = (possible, value) => {
      for (const f of possible) {
        if (fieldNames.includes(f)) { vals[f] = value; return; }
      }
    };

    if (jobCardId) trySet(['job_card_id', 'jobcard_id', 'job_card'], jobCardId);
    if (customerId) trySet(['partner_id', 'customer_id', 'client_id'], customerId);
    if (requestedById) trySet(['requested_by', 'request_by', 'requester_id', 'user_id'], requestedById);
    if (requestedToId) trySet(['requested_to', 'request_to', 'assigned_to', 'responsible_id'], requestedToId);
    if (requestDate) trySet(['request_date', 'date', 'date_request', 'date_requested'], requestDate);
    if (notes) trySet(['notes', 'note', 'description', 'internal_notes'], notes);

    // Step 3: Build One2many lines if we found the field
    if (lines.length > 0 && lineFieldName && lineModel) {
      // Discover line model fields too
      const lineFieldsResp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: lineModel,
            method: 'fields_get',
            args: [],
            kwargs: { attributes: ['string', 'type'] },
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );
      const lineFields = Object.keys(lineFieldsResp.data?.result || {});
      console.log(`${lineModel} fields:`, lineFields);

      const findLineField = (possible) => possible.find(f => lineFields.includes(f)) || null;
      const prodField = findLineField(['product_id', 'spare_part_id', 'part_id']);
      const descField = findLineField(['description', 'name', 'desc', 'note']);
      const qtyField = findLineField(['requested_qty', 'quantity', 'qty', 'product_qty', 'req_qty']);

      vals[lineFieldName] = lines.map(l => {
        const lineVals = {};
        if (prodField && l.product_id) lineVals[prodField] = l.product_id;
        if (descField && l.description) lineVals[descField] = l.description;
        if (qtyField) lineVals[qtyField] = l.requested_qty || 1;
        return [0, 0, lineVals];
      });
    }

    console.log('Creating spare.part.request with vals:', JSON.stringify(vals));

    // Step 4: Create the record
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'spare.part.request',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to create spare part request');
    }
    const newId = response.data.result;

    // Step 5: Transition from draft to requested
    if (newId) {
      const submitMethods = ['action_request', 'action_submit', 'action_confirm', 'button_request', 'button_submit'];
      for (const method of submitMethods) {
        try {
          const submitResp = await axios.post(
            `${baseUrl}/web/dataset/call_kw`,
            {
              jsonrpc: '2.0',
              method: 'call',
              params: {
                model: 'spare.part.request',
                method: method,
                args: [[newId]],
                kwargs: {},
              },
            },
            { headers, withCredentials: true, timeout: 10000 }
          );
          if (!submitResp.data.error) {
            console.log(`State transition success using method: ${method}`);
            break;
          }
        } catch (e) {
          console.warn(`Method ${method} failed:`, e?.message);
        }
      }
    }

    return newId;
  } catch (error) {
    console.error('createSparePartRequestOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch spare part products from Odoo
export const fetchSparePartProductsOdoo = async ({ offset = 0, limit = 20, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    let domain = [];
    if (searchText) {
      domain.push(['name', 'ilike', searchText]);
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'product.product',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'default_code', 'list_price'],
            offset,
            limit,
            order: 'name asc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('Odoo JSON-RPC error (spare part products):', response.data.error);
      return [];
    }
    return (response.data.result || []).map(p => ({
      id: p.id,
      name: p.name || p.display_name || '',
      default_code: p.default_code || '',
      list_price: p.list_price || 0,
      qty_available: p.qty_available || 0,
    }));
  } catch (error) {
    console.error('fetchSparePartProductsOdoo error:', error?.message || error);
    return [];
  }
};

// Fetch products by type (service or spare parts) for repair module
export const fetchRepairProductsOdoo = async ({ type = 'service', offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = [['sale_ok', '=', true]];
    if (type === 'service') {
      domain.push(['type', '=', 'service']);
    } else {
      domain.push(['type', 'in', ['product', 'consu']]);
    }
    if (searchText) {
      domain.push('|', ['name', 'ilike', searchText], ['default_code', 'ilike', searchText]);
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'product.product', method: 'search_read', args: [domain],
          kwargs: {
            fields: ['id', 'name', 'default_code', 'list_price', 'standard_price', 'product_template_variant_value_ids'],
            offset, limit, order: 'default_code asc, name asc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) return [];
    return (response.data.result || []).map(p => ({
      id: p.id,
      name: p.name || '',
      default_code: p.default_code || '',
      list_price: p.list_price || 0,
      cost: p.standard_price || 0,
      qty_on_hand: p.qty_available || 0,
      forecasted: p.virtual_available || 0,
    }));
  } catch (error) {
    console.error('fetchRepairProductsOdoo error:', error?.message || error);
    return [];
  }
};

// Fetch job cards from Odoo
export const fetchJobCardsOdoo = async ({ offset = 0, limit = 20, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    let domain = [];
    if (searchText) {
      domain = [['name', 'ilike', searchText]];
    }

    // Try multiple possible model names
    const modelNames = ['mobile.repair.job.card', 'job.card', 'repair.order'];
    let lastError = null;

    for (const modelName of modelNames) {
      try {
        const response = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model: modelName,
              method: 'search_read',
              args: [domain],
              kwargs: {
                fields: [],
                offset,
                limit,
                order: 'create_date desc',
              },
            },
          },
          { headers }
        );
        if (response.data.error) {
          console.warn(`Job card model "${modelName}" failed:`, response.data.error?.data?.message || response.data.error);
          lastError = response.data.error;
          continue;
        }
        const records = response.data.result || [];
        console.log(`Job card model "${modelName}" found ${records.length} records. Fields:`, records.length > 0 ? Object.keys(records[0]) : 'none');
        return records.map(jc => ({
          id: jc.id,
          name: jc.name || jc.display_name || '',
          partner_id: jc.partner_id ? jc.partner_id[0] : (jc.customer_id ? jc.customer_id[0] : null),
          partner_name: jc.partner_id ? jc.partner_id[1] : (jc.customer_id ? jc.customer_id[1] : ''),
          stage: jc.stage_id ? jc.stage_id[1] : (jc.state || ''),
          create_date: jc.create_date || '',
        }));
      } catch (innerErr) {
        console.warn(`Job card model "${modelName}" threw:`, innerErr?.message);
        lastError = innerErr;
        continue;
      }
    }
    console.error('fetchJobCardsOdoo: No valid model found. Last error:', lastError);
    return [];
  } catch (error) {
    console.error('fetchJobCardsOdoo error:', error?.message || error);
    return [];
  }
};

// Approve a spare part request in Odoo
export const approveSparePartRequestOdoo = async (requestId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Try multiple action method names
    const methodsToTry = ['action_approve', 'action_approved', 'button_approve', 'action_confirm', 'button_confirm'];
    for (const method of methodsToTry) {
      try {
        const r = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'spare.part.request', method, args: [[requestId]], kwargs: {} },
        }, { headers, withCredentials: true, timeout: 15000 });
        if (!r.data.error) {
          console.log(`Approve success via method: ${method}`);
          return r.data.result;
        }
      } catch (e) {
        console.warn(`Approve method ${method} failed`);
      }
    }

    // Fallback: direct state write to 'approved'
    console.log('Trying direct state write to approved');
    const r = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'spare.part.request', method: 'write', args: [[requestId], { state: 'approved' }], kwargs: {} },
    }, { headers, withCredentials: true, timeout: 15000 });
    if (!r.data.error) {
      console.log('Direct state write to approved success');
      return r.data.result;
    }

    throw new Error('Failed to approve request - all methods failed');
  } catch (error) {
    console.error('approveSparePartRequestOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch approved spare part requests for issue linking
export const fetchApprovedSpareRequestsOdoo = async ({ limit = 50 } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    // Fetch all requests (not filtered by state) since state values vary across Odoo setups
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'spare.part.request',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: [], offset: 0, limit, order: 'create_date desc' },
        },
      },
      { headers }
    );
    if (response.data.error) {
      console.error('fetchApprovedSpareRequestsOdoo error:', response.data.error);
      return [];
    }
    const records = response.data.result || [];
    if (records.length > 0) {
      console.log('Spare request states found:', [...new Set(records.map(r => r.state))]);
      console.log('Spare request all field keys:', Object.keys(records[0]));
    }

    // Helper to extract Many2one user field { id, name } from multiple possible field names
    const extractUser = (r, candidates) => {
      for (const f of candidates) {
        if (r[f] && r[f] !== false) {
          if (Array.isArray(r[f])) return { id: r[f][0], name: r[f][1] };
          if (typeof r[f] === 'number') return { id: r[f], name: '' };
        }
      }
      return null;
    };

    return records.map(r => {
      const state = r.state || r.stage || 'draft';
      const name = r.name || r.display_name || '';

      const requestedBy = extractUser(r, ['requested_by', 'requested_by_id', 'request_by', 'request_user_id', 'user_id']);
      const requestedTo = extractUser(r, ['requested_to', 'requested_to_id', 'request_to', 'request_to_id', 'assigned_to']);

      return {
        id: r.id,
        name,
        label: `${name} [${state.toUpperCase()}]${r.partner_id ? ' - ' + r.partner_id[1] : (r.customer_id ? ' - ' + r.customer_id[1] : '')}`,
        state,
        job_card_id: r.job_card_id ? r.job_card_id[0] : null,
        job_card_name: r.job_card_id ? r.job_card_id[1] : '',
        partner_name: r.partner_id ? r.partner_id[1] : (r.customer_id ? r.customer_id[1] : ''),
        line_ids: r.spare_parts_line || r.line_ids || r.spare_line_ids || [],
        requested_by: requestedBy,
        requested_to: requestedTo,
      };
    });
  } catch (error) {
    console.error('fetchApprovedSpareRequestsOdoo error:', error?.message || error);
    return [];
  }
};

// Fetch spare part request lines by IDs (with all fields for issue/return tracking)
export const fetchSpareRequestLinesOdoo = async (lineIds) => {
  try {
    if (!lineIds || lineIds.length === 0) return [];
    const { headers, baseUrl } = await authenticateOdoo();

    // Step 1: Discover actual field names via fields_get
    const fieldsResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'spare.part.request.line', method: 'fields_get', args: [], kwargs: { attributes: ['string', 'type'] } },
      },
      { headers }
    );
    const allFieldDefs = fieldsResp.data?.result || {};
    const allFieldNames = Object.keys(allFieldDefs);

    // Find the actual field names by checking candidates
    const findField = (candidates) => candidates.find(f => allFieldNames.includes(f));

    const reqQtyField = findField(['requested_qty', 'qty_requested', 'qty', 'product_qty', 'request_qty', 'quantity', 'product_uom_qty']);
    const issQtyField = findField(['issued_qty', 'qty_issued', 'issue_qty', 'issued_quantity', 'quantity_issued']);
    const retQtyField = findField(['returned_qty', 'qty_returned', 'return_qty', 'returned_quantity', 'quantity_returned']);

    // Also try to find by field label/string if candidates don't match
    const findByLabel = (labels) => {
      for (const [fname, fdef] of Object.entries(allFieldDefs)) {
        const str = (fdef.string || '').toLowerCase();
        for (const lbl of labels) {
          if (str === lbl.toLowerCase()) return fname;
        }
      }
      return null;
    };

    const actualReqField = reqQtyField || findByLabel(['Requested Qty', 'Requested Quantity', 'Quantity Requested', 'Qty']);
    const actualIssField = issQtyField || findByLabel(['Issued Qty', 'Issued Quantity', 'Quantity Issued']);
    const actualRetField = retQtyField || findByLabel(['Returned Qty', 'Returned Quantity', 'Quantity Returned']);

    console.log('spare.part.request.line field discovery:', {
      requestedQty: actualReqField || 'NOT FOUND',
      issuedQty: actualIssField || 'NOT FOUND',
      returnedQty: actualRetField || 'NOT FOUND',
      allQtyRelatedFields: allFieldNames.filter(f =>
        f.includes('qty') || f.includes('quantity') || f.includes('issue') || f.includes('return') || f.includes('request')
      ),
    });

    // Step 2: Read the line records
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'spare.part.request.line',
          method: 'read',
          args: [lineIds],
          kwargs: { fields: [] },
        },
      },
      { headers }
    );
    if (response.data.error) return [];
    const results = response.data.result || [];

    return results.map(l => {
      const reqQty = actualReqField ? (l[actualReqField] || 0) : 1;
      const issQty = actualIssField ? (l[actualIssField] || 0) : 0;
      const retQty = actualRetField ? (l[actualRetField] || 0) : 0;
      console.log(`Line ${l.id} [${l.product_id ? l.product_id[1] : ''}]: requested=${reqQty} (${actualReqField}=${l[actualReqField]}), issued=${issQty} (${actualIssField}=${l[actualIssField]}), returned=${retQty} (${actualRetField}=${l[actualRetField]})`);
      return {
        id: l.id,
        product_id: l.product_id ? l.product_id[0] : null,
        product_name: l.product_id ? l.product_id[1] : '',
        description: l.description || '',
        requested_qty: reqQty,
        issued_qty: issQty,
        returned_qty: retQty,
      };
    });
  } catch (error) {
    console.error('fetchSpareRequestLinesOdoo error:', error?.message || error);
    return [];
  }
};

// Update issued_qty on a spare part request line
export const updateSpareLineIssuedQtyOdoo = async (lineId, issuedQty) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Discover actual field names on the line model
    const fieldsResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'spare.part.request.line', method: 'fields_get', args: [], kwargs: { attributes: ['string', 'type'] } },
      },
      { headers, withCredentials: true, timeout: 10000 }
    );
    const fieldNames = Object.keys(fieldsResp.data?.result || {});
    console.log('spare.part.request.line all fields:', fieldNames);

    // Find the issued_qty field name
    const qtyField = ['issued_qty', 'qty_issued', 'issue_qty'].find(f => fieldNames.includes(f));
    if (!qtyField) {
      throw new Error('Cannot find issued quantity field on spare.part.request.line. Available fields: ' + fieldNames.filter(f => f.includes('qty') || f.includes('issue')).join(', '));
    }

    // Read current value before writing
    const readResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'spare.part.request.line', method: 'read', args: [[lineId]], kwargs: { fields: [qtyField] } },
      },
      { headers, withCredentials: true, timeout: 10000 }
    );
    const currentVal = readResp.data?.result?.[0]?.[qtyField];
    console.log(`updateSpareLineIssuedQty: lineId=${lineId}, field=${qtyField}, currentValue=${currentVal}, writingValue=${issuedQty}`);

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'spare.part.request.line',
          method: 'write',
          args: [[lineId], { [qtyField]: issuedQty }],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 10000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to update issued qty');
    }

    // Verify the value was written correctly
    const verifyResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'spare.part.request.line', method: 'read', args: [[lineId]], kwargs: { fields: [qtyField] } },
      },
      { headers, withCredentials: true, timeout: 10000 }
    );
    const afterVal = verifyResp.data?.result?.[0]?.[qtyField];
    console.log(`updateSpareLineIssuedQty VERIFY: lineId=${lineId}, expected=${issuedQty}, actual=${afterVal}`);

    return response.data.result;
  } catch (error) {
    console.error('updateSpareLineIssuedQtyOdoo error:', error?.message || error);
    throw error;
  }
};

// Update returned_qty on a spare part request line
export const updateSpareLineReturnedQtyOdoo = async (lineId, returnedQty) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    const fieldsResp = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'spare.part.request.line', method: 'fields_get', args: [], kwargs: { attributes: ['string', 'type'] } },
      },
      { headers, withCredentials: true, timeout: 10000 }
    );
    const fieldNames = Object.keys(fieldsResp.data?.result || {});

    const qtyField = ['returned_qty', 'qty_returned', 'return_qty'].find(f => fieldNames.includes(f));
    if (!qtyField) {
      throw new Error('Cannot find returned quantity field on spare.part.request.line. Available fields: ' + fieldNames.filter(f => f.includes('qty') || f.includes('return')).join(', '));
    }

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'spare.part.request.line',
          method: 'write',
          args: [[lineId], { [qtyField]: returnedQty }],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 10000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to update returned qty');
    }
    return response.data.result;
  } catch (error) {
    console.error('updateSpareLineReturnedQtyOdoo error:', error?.message || error);
    throw error;
  }
};

// Transition spare.part.request state (e.g., to 'issued' or 'returned')
// extraFields: { userId, toUserId, date, reason } - optional metadata to write alongside state
export const transitionSpareRequestStateOdoo = async (requestId, targetState, extraFields = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // First, discover actual field names on spare.part.request
    let fieldNames = [];
    try {
      const fieldsResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'spare.part.request', method: 'fields_get', args: [], kwargs: { attributes: ['string', 'type'] } },
      }, { headers, withCredentials: true, timeout: 10000 });
      fieldNames = Object.keys(fieldsResp.data?.result || {});
      console.log('spare.part.request fields for state transition:', fieldNames.filter(f =>
        f.includes('issue') || f.includes('return') || f.includes('date') || f.includes('by') || f.includes('to_') || f.includes('user')
      ));
    } catch (e) {
      console.warn('Failed to fetch spare.part.request fields:', e?.message);
    }

    // Build metadata values to write alongside state
    const metaVals = {};
    const findField = (candidates) => candidates.find(f => fieldNames.includes(f));

    if (targetState === 'issued') {
      // Issued By field
      if (extraFields.userId) {
        const byField = findField(['issued_by', 'issued_by_id', 'issue_by', 'issue_user_id']);
        if (byField) metaVals[byField] = extraFields.userId;
      }
      // Issued To field
      if (extraFields.toUserId) {
        const toField = findField(['issued_to', 'issued_to_id', 'issue_to', 'issue_to_id']);
        if (toField) metaVals[toField] = extraFields.toUserId;
      }
      // Issue Date field
      const dateField = findField(['issue_date', 'issued_date', 'date_issue', 'date_issued']);
      if (dateField) {
        metaVals[dateField] = extraFields.date || new Date().toISOString().split('T')[0];
      }
    } else if (targetState === 'returned') {
      // Returned By field
      if (extraFields.userId) {
        const byField = findField(['returned_by', 'returned_by_id', 'return_by', 'return_user_id']);
        if (byField) metaVals[byField] = extraFields.userId;
      }
      // Returned To field
      if (extraFields.toUserId) {
        const toField = findField(['returned_to', 'returned_to_id', 'return_to', 'return_to_id']);
        if (toField) metaVals[toField] = extraFields.toUserId;
      }
      // Return Date field
      const dateField = findField(['return_date', 'returned_date', 'date_return', 'date_returned']);
      if (dateField) {
        metaVals[dateField] = extraFields.date || new Date().toISOString().split('T')[0];
      }
      // Return Reason field
      if (extraFields.reason) {
        const reasonField = findField(['return_reason', 'reason', 'returned_reason', 'note', 'notes', 'return_notes', 'description', 'return_description']);
        if (reasonField) metaVals[reasonField] = extraFields.reason;
      }
    }

    console.log('Metadata fields to write:', metaVals);

    // Try common action methods for the target state
    const methodsToTry = targetState === 'issued'
      ? ['action_issue', 'action_issued', 'button_issue', 'action_done', 'action_confirm']
      : ['action_return', 'action_returned', 'button_return', 'action_done'];

    for (const method of methodsToTry) {
      try {
        const r = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'spare.part.request', method, args: [[requestId]], kwargs: {} },
        }, { headers, withCredentials: true, timeout: 10000 });
        if (!r.data.error) {
          console.log(`Request state transition success: ${method}`);
          // Write metadata fields after successful action
          if (Object.keys(metaVals).length > 0) {
            await axios.post(`${baseUrl}/web/dataset/call_kw`, {
              jsonrpc: '2.0', method: 'call',
              params: { model: 'spare.part.request', method: 'write', args: [[requestId], metaVals], kwargs: {} },
            }, { headers, withCredentials: true, timeout: 10000 });
            console.log('Metadata fields written successfully');
          }
          return true;
        }
      } catch (e) {
        console.warn(`Request method ${method} failed`);
      }
    }

    // If action methods fail, try direct write on state field + metadata
    try {
      const writeVals = { state: targetState, ...metaVals };
      console.log(`Trying direct state write with metadata:`, writeVals);
      const r = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'spare.part.request',
          method: 'write',
          args: [[requestId], writeVals],
          kwargs: {},
        },
      }, { headers, withCredentials: true, timeout: 10000 });
      if (!r.data.error) {
        console.log(`Direct state write with metadata success: ${targetState}`);
        return true;
      }
    } catch (e) {
      console.warn('Direct state write failed:', e?.message);
    }

    console.warn('All state transition methods failed for request', requestId);
    return false;
  } catch (error) {
    console.error('transitionSpareRequestStateOdoo error:', error?.message || error);
    return false;
  }
};

// Fetch issued spare parts (for return linking)
export const fetchIssuedSparePartsOdoo = async ({ limit = 50 } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const possibleModels = ['spare.part.issue', 'spare.issue', 'spare.part.issued'];

    for (const model of possibleModels) {
      try {
        const response = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model,
              method: 'search_read',
              args: [[]],
              kwargs: { fields: [], offset: 0, limit, order: 'create_date desc' },
            },
          },
          { headers }
        );
        if (!response.data.error) {
          const records = response.data.result || [];
          console.log(`fetchIssuedSparePartsOdoo: found ${records.length} records using model ${model}`);
          if (records.length > 0) {
            console.log('Issue record fields:', Object.keys(records[0]));
          }
          return records.map(r => ({
            id: r.id,
            name: r.name || r.display_name || '',
            job_card_id: r.job_card_id ? r.job_card_id[0] : null,
            job_card_name: r.job_card_id ? r.job_card_id[1] : '',
            product_id: r.product_id ? r.product_id[0] : (r.spare_part_id ? r.spare_part_id[0] : null),
            product_name: r.product_id ? r.product_id[1] : (r.spare_part_id ? r.spare_part_id[1] : ''),
            quantity: r.quantity || r.qty || r.issued_qty || 0,
          }));
        }
      } catch (e) {
        console.warn(`fetchIssuedSparePartsOdoo: model ${model} failed`);
      }
    }
    console.warn('fetchIssuedSparePartsOdoo: no issue model found');
    return [];
  } catch (error) {
    console.error('fetchIssuedSparePartsOdoo error:', error?.message || error);
    return [];
  }
};

// Create a spare part issue in Odoo
export const createSparePartIssueOdoo = async ({ jobCardId, productId, quantity, issuedById, issueDate, notes, requestId }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Try multiple possible model names
    const possibleModels = ['spare.part.issue', 'spare.issue', 'spare.part.issued', 'stock.picking'];
    let modelName = null;
    let fieldNames = [];

    for (const model of possibleModels) {
      try {
        console.log(`Trying model: ${model}`);
        const fieldsResp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { model, method: 'fields_get', args: [], kwargs: { attributes: ['string', 'type'] } },
          },
          { headers, withCredentials: true, timeout: 10000 }
        );
        if (!fieldsResp.data?.error && fieldsResp.data?.result) {
          fieldNames = Object.keys(fieldsResp.data.result);
          if (fieldNames.length > 0) {
            modelName = model;
            console.log(`Found model: ${model}, fields:`, fieldNames);
            break;
          }
        }
      } catch (e) {
        console.warn(`Model ${model} not found, trying next...`);
      }
    }

    if (!modelName) {
      throw new Error('Spare part issue model not found in Odoo. Tried: ' + possibleModels.join(', '));
    }

    const tryField = (possible) => possible.find(f => fieldNames.includes(f)) || null;
    const vals = {};

    const jcField = tryField(['job_card_id', 'jobcard_id', 'job_card']);
    const prodField = tryField(['product_id', 'spare_part_id', 'part_id']);
    const qtyField = tryField(['quantity', 'qty', 'issued_qty', 'product_qty']);
    const issuedByField = tryField(['issued_by', 'issue_by', 'user_id', 'responsible_id']);
    const dateField = tryField(['issue_date', 'date', 'date_issue']);
    const notesField = tryField(['notes', 'note', 'reason', 'description']);
    const reqField = tryField(['request_id', 'spare_request_id', 'spare_part_request_id']);

    if (jcField && jobCardId) vals[jcField] = jobCardId;
    if (prodField && productId) vals[prodField] = productId;
    if (qtyField && quantity) vals[qtyField] = quantity;
    if (issuedByField && issuedById) vals[issuedByField] = issuedById;
    if (dateField && issueDate) vals[dateField] = issueDate;
    if (notesField && notes) vals[notesField] = notes;
    if (reqField && requestId) vals[reqField] = requestId;

    console.log(`Creating ${modelName} with vals:`, JSON.stringify(vals));

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: modelName, method: 'create', args: [vals], kwargs: {} },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to create spare part issue');
    }
    const newId = response.data.result;

    // Try to confirm/done the issue
    if (newId) {
      for (const method of ['action_done', 'action_issue', 'action_confirm', 'button_done']) {
        try {
          const r = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: { model: modelName, method, args: [[newId]], kwargs: {} },
          }, { headers, withCredentials: true, timeout: 10000 });
          if (!r.data.error) { console.log(`Issue state transition success: ${method}`); break; }
        } catch (e) { console.warn(`Issue method ${method} failed`); }
      }
    }
    return newId;
  } catch (error) {
    console.error('createSparePartIssueOdoo error:', error?.message || error);
    throw error;
  }
};

// Create a spare part return in Odoo
export const createSparePartReturnOdoo = async ({ jobCardId, productId, quantity, returnedById, returnDate, reason, issueId }) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Try multiple possible model names
    const possibleModels = ['spare.part.return', 'spare.return', 'spare.part.returned'];
    let modelName = null;
    let fieldNames = [];

    for (const model of possibleModels) {
      try {
        console.log(`Trying return model: ${model}`);
        const fieldsResp = await axios.post(
          `${baseUrl}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { model, method: 'fields_get', args: [], kwargs: { attributes: ['string', 'type'] } },
          },
          { headers, withCredentials: true, timeout: 10000 }
        );
        if (!fieldsResp.data?.error && fieldsResp.data?.result) {
          fieldNames = Object.keys(fieldsResp.data.result);
          if (fieldNames.length > 0) {
            modelName = model;
            console.log(`Found return model: ${model}, fields:`, fieldNames);
            break;
          }
        }
      } catch (e) {
        console.warn(`Model ${model} not found, trying next...`);
      }
    }

    if (!modelName) {
      throw new Error('Spare part return model not found in Odoo. Tried: ' + possibleModels.join(', '));
    }

    const tryField = (possible) => possible.find(f => fieldNames.includes(f)) || null;
    const vals = {};

    const jcField = tryField(['job_card_id', 'jobcard_id', 'job_card']);
    const prodField = tryField(['product_id', 'spare_part_id', 'part_id']);
    const qtyField = tryField(['quantity', 'qty', 'returned_qty', 'product_qty']);
    const retByField = tryField(['returned_by', 'return_by', 'user_id', 'responsible_id']);
    const dateField = tryField(['return_date', 'date', 'date_return']);
    const reasonField = tryField(['reason', 'notes', 'note', 'description']);
    const issField = tryField(['issue_id', 'spare_issue_id', 'spare_part_issue_id']);

    if (jcField && jobCardId) vals[jcField] = jobCardId;
    if (prodField && productId) vals[prodField] = productId;
    if (qtyField && quantity) vals[qtyField] = quantity;
    if (retByField && returnedById) vals[retByField] = returnedById;
    if (dateField && returnDate) vals[dateField] = returnDate;
    if (reasonField && reason) vals[reasonField] = reason;
    if (issField && issueId) vals[issField] = issueId;

    console.log(`Creating ${modelName} with vals:`, JSON.stringify(vals));

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: modelName, method: 'create', args: [vals], kwargs: {} },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to create spare part return');
    }
    const newId = response.data.result;

    // Try to confirm the return
    if (newId) {
      for (const method of ['action_done', 'action_return', 'action_confirm', 'button_done']) {
        try {
          const r = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: { model: modelName, method, args: [[newId]], kwargs: {} },
          }, { headers, withCredentials: true, timeout: 10000 });
          if (!r.data.error) { console.log(`Return state transition success: ${method}`); break; }
        } catch (e) { console.warn(`Return method ${method} failed`); }
      }
    }
    return newId;
  } catch (error) {
    console.error('createSparePartReturnOdoo error:', error?.message || error);
    throw error;
  }
};

// ===================== AUDIT DETAIL FUNCTIONS =====================

// Fetch full audit record details with transaction lines
export const fetchAuditingDetailsOdoo = async (recordId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'audit.transaction',
          method: 'search_read',
          args: [[['id', '=', Number(recordId)]]],
          kwargs: {
            fields: [
              'id', 'transaction_ref', 'transaction_date', 'audit_account_type',
              'partner_id', 'amount_untaxed', 'amount_tax', 'has_tax', 'amount_total',
              'salesperson_id', 'created_by', 'journal_id', 'company_id', 'currency_id',
              'customer_signature', 'customer_signed_by', 'customer_signed_date',
              'cashier_signature', 'cashier_signed_by', 'cashier_signed_date',
              'state', 'audit_line_ids', 'payment_method',
              'is_courier', 'courier_proof', 'courier_proof_filename',
            ],
            limit: 1,
          },
        },
      },
      { headers, timeout: reqTimeout }
    );

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const rec = (response.data.result || [])[0];
    if (!rec) return null;

    // Fetch audit line details if any
    let lines = [];
    if (rec.audit_line_ids && rec.audit_line_ids.length > 0) {
      const linesResp = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'audit.transaction.line',
            method: 'search_read',
            args: [[['id', 'in', rec.audit_line_ids]]],
            kwargs: {
              fields: ['id', 'product_id', 'name', 'quantity', 'price_unit', 'tax_amount', 'subtotal', 'account_id'],
            },
          },
        },
        { headers, timeout: reqTimeout }
      );
      if (!linesResp.data.error && linesResp.data.result) {
        lines = linesResp.data.result.map(l => ({
          id: l.id,
          product_name: Array.isArray(l.product_id) ? l.product_id[1] : '',
          description: l.name || '',
          quantity: l.quantity || 0,
          price_unit: l.price_unit || 0,
          tax_amount: l.tax_amount || 0,
          subtotal: l.subtotal || 0,
          account_name: Array.isArray(l.account_id) ? l.account_id[1] : '',
        }));
      }
    }

    return {
      id: rec.id,
      transaction_ref: rec.transaction_ref || '',
      transaction_date: rec.transaction_date || '',
      audit_account_type: rec.audit_account_type || '',
      partner_name: Array.isArray(rec.partner_id) ? rec.partner_id[1] : '',
      amount_untaxed: rec.amount_untaxed || 0,
      amount_tax: rec.amount_tax || 0,
      has_tax: rec.has_tax || false,
      amount_total: rec.amount_total || 0,
      salesperson_name: Array.isArray(rec.salesperson_id) ? rec.salesperson_id[1] : '',
      created_by_name: Array.isArray(rec.created_by) ? rec.created_by[1] : '',
      journal_name: Array.isArray(rec.journal_id) ? rec.journal_id[1] : '',
      company_name: Array.isArray(rec.company_id) ? rec.company_id[1] : '',
      currency_name: Array.isArray(rec.currency_id) ? rec.currency_id[1] : '',
      customer_signature: rec.customer_signature ? `data:image/png;base64,${rec.customer_signature}` : null,
      customer_signed_by: rec.customer_signed_by || '',
      customer_signed_date: rec.customer_signed_date || '',
      cashier_signature: rec.cashier_signature ? `data:image/png;base64,${rec.cashier_signature}` : null,
      cashier_signed_by: rec.cashier_signed_by || '',
      cashier_signed_date: rec.cashier_signed_date || '',
      state: rec.state || 'draft',
      payment_method: rec.payment_method || '',
      is_courier: rec.is_courier || false,
      courier_proof: rec.courier_proof || null,
      courier_proof_filename: rec.courier_proof_filename || '',
      lines,
    };
  } catch (error) {
    console.error('fetchAuditingDetailsOdoo error:', error?.message || error);
    throw error;
  }
};

// Update audit transaction state (audited/rejected)
export const updateAuditStateOdoo = async (recordId, newState) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'audit.transaction',
          method: 'write',
          args: [[Number(recordId)], { state: newState }],
          kwargs: {},
        },
      },
      { headers, timeout: reqTimeout }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }
    return response.data.result;
  } catch (error) {
    console.error('updateAuditStateOdoo error:', error?.message || error);
    throw error;
  }
};

// Upload audit attachments as ir.attachment records
export const uploadAuditAttachmentsOdoo = async (auditRecordId, imageDataUris) => {
  console.log(`[uploadAuditAttachments] START - auditId=${auditRecordId}, count=${imageDataUris?.length}`);
  if (!imageDataUris || imageDataUris.length === 0) return [];

  let headers = await getOdooAuthHeaders();

  const doCreate = async (hdrs, vals) => {
    return axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'ir.attachment',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers: hdrs, timeout: 120000 }
    );
  };

  const results = [];
  const errors = [];

  for (let i = 0; i < imageDataUris.length; i++) {
    try {
      const uri = imageDataUris[i];
      console.log(`[uploadAuditAttachments] Processing item ${i + 1}, uri=${typeof uri === 'string' ? uri.substring(0, 80) : 'N/A'}`);

      let base64Data = '';
      let mimeType = 'image/jpeg';
      let ext = 'jpg';

      if (typeof uri === 'string' && uri.startsWith('data:')) {
        const commaIdx = uri.indexOf(',');
        if (commaIdx < 0) {
          errors.push(`Item ${i + 1}: Invalid data URI format`);
          continue;
        }
        base64Data = uri.substring(commaIdx + 1);
        const headerPart = uri.substring(0, commaIdx);
        const mimeMatch = headerPart.match(/data:([^;]+)/);
        if (mimeMatch) {
          mimeType = mimeMatch[1];
          if (mimeType.includes('png')) ext = 'png';
          else if (mimeType.includes('pdf')) ext = 'pdf';
          else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
        }
      } else if (typeof uri === 'string' && uri.length > 0) {
        console.log(`[uploadAuditAttachments] Item ${i + 1}: Reading file URI...`);

        let readUri = uri;
        if (uri.startsWith('content://')) {
          try {
            const fileName = uri.split('/').pop() || `attachment_${i}`;
            const cacheUri = `${FileSystem.cacheDirectory}audit_upload_${Date.now()}_${fileName}`;
            await FileSystem.copyAsync({ from: uri, to: cacheUri });
            readUri = cacheUri;
            console.log(`[uploadAuditAttachments] Item ${i + 1}: Copied to cache: ${cacheUri}`);
          } catch (copyErr) {
            console.warn(`[uploadAuditAttachments] Item ${i + 1}: Copy failed, trying direct read:`, copyErr?.message);
          }
        }

        try {
          base64Data = await FileSystem.readAsStringAsync(readUri, { encoding: FileSystem.EncodingType.Base64 });
          console.log(`[uploadAuditAttachments] Item ${i + 1}: Read ${base64Data.length} base64 chars`);
        } catch (readErr) {
          errors.push(`Item ${i + 1}: Cannot read file - ${readErr?.message}`);
          continue;
        }

        const lower = uri.toLowerCase();
        if (lower.endsWith('.png')) { mimeType = 'image/png'; ext = 'png'; }
        else if (lower.endsWith('.pdf')) { mimeType = 'application/pdf'; ext = 'pdf'; }
        else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) { mimeType = 'image/jpeg'; ext = 'jpg'; }
        else { mimeType = 'application/octet-stream'; ext = 'bin'; }
      } else {
        errors.push(`Item ${i + 1}: Empty or invalid URI`);
        continue;
      }

      if (!base64Data || base64Data.length < 50) {
        errors.push(`Item ${i + 1}: File too small or empty`);
        continue;
      }

      const fileName = `audit_voucher_${auditRecordId}_${i + 1}.${ext}`;
      const vals = {
        name: fileName,
        type: 'binary',
        datas: base64Data,
        res_model: 'audit.transaction',
        res_id: Number(auditRecordId),
        mimetype: mimeType,
      };

      console.log(`[uploadAuditAttachments] Item ${i + 1}: Uploading ${fileName} (${(base64Data.length / 1024).toFixed(0)}KB base64, mime=${mimeType})...`);

      let response = await doCreate(headers, vals);

      if (!response.data?.jsonrpc || response.data?.error?.data?.name === 'odoo.http.SessionExpiredException') {
        console.log(`[uploadAuditAttachments] Session expired, re-authenticating...`);
        const authResp = await axios.post(
          `${ODOO_BASE_URL()}/web/session/authenticate`,
          {
            jsonrpc: '2.0', method: 'call',
            params: { db: (await AsyncStorage.getItem('odoo_db')) || DEFAULT_ODOO_DB, login: DEFAULT_USERNAME, password: DEFAULT_PASSWORD },
          },
          { headers: { 'Content-Type': 'application/json' } }
        );
        const setCookie = authResp.headers['set-cookie'] || authResp.headers['Set-Cookie'];
        let cookieStr = '';
        if (setCookie) {
          cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
        }
        const sid = authResp.data?.result?.session_id;
        if (!cookieStr && sid) cookieStr = `session_id=${sid}`;
        if (cookieStr) await AsyncStorage.setItem('odoo_cookie', cookieStr);
        headers = { 'Content-Type': 'application/json', Cookie: cookieStr };
        response = await doCreate(headers, vals);
      }

      if (response.data?.error) {
        const errMsg = response.data.error.data?.message || response.data.error.message || 'Odoo error';
        errors.push(`Item ${i + 1}: ${errMsg}`);
        console.error(`[uploadAuditAttachments] Item ${i + 1}: Odoo error: ${errMsg}`);
        continue;
      }

      const attId = response.data?.result;
      console.log(`[uploadAuditAttachments] Item ${i + 1}: SUCCESS - attachment ID=${attId}`);
      results.push(attId);
    } catch (imgErr) {
      const errMsg = imgErr?.message || String(imgErr);
      errors.push(`Item ${i + 1}: ${errMsg}`);
      console.error(`[uploadAuditAttachments] Item ${i + 1} EXCEPTION:`, errMsg);
    }
  }

  console.log(`[uploadAuditAttachments] DONE - ${results.length}/${imageDataUris.length} uploaded, ${errors.length} errors`);

  if (results.length === 0 && errors.length > 0) {
    throw new Error(`All attachments failed: ${errors[0]}`);
  }

  return results;
};

// Fetch audit attachments with base64 data (includes session retry)
export const fetchAuditAttachmentsOdoo = async (auditRecordId) => {
  try {
    let headers = await getOdooAuthHeaders();

    const doSearch = async (hdrs) => {
      return axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'ir.attachment',
            method: 'search_read',
            args: [[['res_model', '=', 'audit.transaction'], ['res_id', '=', Number(auditRecordId)]]],
            kwargs: {
              fields: ['id', 'name', 'mimetype', 'file_size', 'create_date'],
            },
          },
        },
        { headers: hdrs, timeout: 15000 }
      );
    };

    let response = await doSearch(headers);

    // Session retry
    if (!response.data?.jsonrpc || response.data?.error?.data?.name === 'odoo.http.SessionExpiredException') {
      console.log('[fetchAuditAttachments] Session expired, re-authenticating...');
      const authResp = await axios.post(
        `${ODOO_BASE_URL()}/web/session/authenticate`,
        {
          jsonrpc: '2.0', method: 'call',
          params: { db: (await AsyncStorage.getItem('odoo_db')) || DEFAULT_ODOO_DB, login: DEFAULT_USERNAME, password: DEFAULT_PASSWORD },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );
      const setCookie = authResp.headers['set-cookie'] || authResp.headers['Set-Cookie'];
      let cookieStr = '';
      if (setCookie) {
        cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
      }
      const sid = authResp.data?.result?.session_id;
      if (!cookieStr && sid) cookieStr = `session_id=${sid}`;
      if (cookieStr) await AsyncStorage.setItem('odoo_cookie', cookieStr);
      headers = { 'Content-Type': 'application/json', Cookie: cookieStr };
      response = await doSearch(headers);
    }

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const attachments = response.data.result || [];
    console.log(`[fetchAuditAttachments] Found ${attachments.length} attachments for audit ${auditRecordId}`);

    const results = [];
    for (const att of attachments) {
      let uri = null;
      try {
        const readResp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          {
            jsonrpc: '2.0',
            method: 'call',
            params: {
              model: 'ir.attachment',
              method: 'read',
              args: [[att.id], ['datas']],
              kwargs: {},
            },
          },
          { headers, timeout: 30000 }
        );
        if (!readResp.data.error && readResp.data.result?.[0]?.datas) {
          const mime = att.mimetype || 'image/png';
          uri = `data:${mime};base64,${readResp.data.result[0].datas}`;
        }
      } catch (readErr) {
        console.error(`[fetchAuditAttachments] Failed to read datas for attachment ${att.id}:`, readErr?.message);
      }
      results.push({
        id: att.id,
        name: att.name,
        mimetype: att.mimetype || 'image/png',
        uri,
        file_size: att.file_size,
        create_date: att.create_date,
      });
    }
    return results;
  } catch (error) {
    console.error('fetchAuditAttachmentsOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch posted account.move records for transaction reference dropdown
export const fetchPostedMovesOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.move',
          method: 'search_read',
          args: [[['state', '=', 'posted']]],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'move_type', 'amount_total', 'invoice_date'],
            order: 'create_date desc',
            limit: 200,
          },
        },
      },
      { headers }
    );

    if (response.data.error) {
      console.log('Odoo JSON-RPC error (posted moves):', response.data.error);
      throw new Error('Odoo JSON-RPC error');
    }

    const results = response.data.result || [];
    return results.map((rec) => ({
      id: rec.id,
      name: rec.name || '',
      partner_name: rec.partner_id ? rec.partner_id[1] : '',
      move_type: rec.move_type || '',
      amount_total: rec.amount_total || 0,
      invoice_date: rec.invoice_date || '',
    }));
  } catch (error) {
    console.error('fetchPostedMovesOdoo error:', error);
    throw error;
  }
};

// ===================== STOCK TRANSFER FUNCTIONS =====================

// Fetch intercompany stock transfer requests
export const fetchStockTransfersOdoo = async ({ offset = 0, limit = 50, companyId = null } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = [];
    if (companyId) {
      domain.push('|');
      domain.push(['requesting_company_id', '=', Number(companyId)]);
      domain.push(['source_company_id', '=', Number(companyId)]);
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'intercompany.stock.request',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: [
              'id', 'name', 'date', 'state', 'total_value', 'note', 'urgency',
              'requesting_company_id', 'requesting_location_id',
              'source_company_id', 'source_location_id',
              'currency_id', 'transfer_id', 'transfer_state',
            ],
            offset,
            limit,
            order: 'date desc, id desc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      console.error('Odoo JSON-RPC error (fetchStockRequests):', response.data.error);
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const records = response.data.result || [];
    return records.map(r => ({
      _id: r.id,
      id: r.id,
      name: r.name || '',
      date: r.date || '',
      state: r.state || 'draft',
      total_value: r.total_value || 0,
      note: r.note || '',
      urgency: r.urgency || 'normal',
      requesting_company_id: Array.isArray(r.requesting_company_id) ? r.requesting_company_id[0] : r.requesting_company_id,
      requesting_company_name: Array.isArray(r.requesting_company_id) ? r.requesting_company_id[1] : '',
      requesting_location_name: Array.isArray(r.requesting_location_id) ? r.requesting_location_id[1] : '',
      source_company_id: Array.isArray(r.source_company_id) ? r.source_company_id[0] : r.source_company_id,
      source_company_name: Array.isArray(r.source_company_id) ? r.source_company_id[1] : '',
      source_location_name: Array.isArray(r.source_location_id) ? r.source_location_id[1] : '',
      currency_name: Array.isArray(r.currency_id) ? r.currency_id[1] : '',
      transfer_id: Array.isArray(r.transfer_id) ? r.transfer_id[0] : r.transfer_id,
      transfer_state: r.transfer_state || '',
    }));
  } catch (error) {
    console.error('fetchStockTransfersOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch full stock transfer request details with lines
export const fetchStockTransferDetailsOdoo = async (requestId) => {
  try {
    const headers = await getOdooAuthHeaders();

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'intercompany.stock.request',
          method: 'read',
          args: [[requestId]],
          kwargs: {
            fields: [
              'id', 'name', 'date', 'state', 'total_value', 'note', 'urgency',
              'requesting_company_id', 'requesting_location_id',
              'source_company_id', 'source_location_id',
              'currency_id', 'line_ids',
              'sent_by_id', 'sent_date',
              'approved_by_id', 'approval_date', 'approval_note',
              'requester_signature', 'source_signature',
              'rejection_reason',
              'transfer_id', 'transfer_state',
            ],
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const records = response.data.result || [];
    if (records.length === 0) return null;
    const r = records[0];

    // Fetch request lines
    let lines = [];
    if (r.line_ids && r.line_ids.length > 0) {
      const linesResponse = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'intercompany.stock.request.line',
            method: 'read',
            args: [r.line_ids],
            kwargs: {
              fields: ['id', 'product_id', 'quantity', 'uom_id', 'unit_price', 'subtotal',
                'available_qty', 'stock_status'],
            },
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );

      if (!linesResponse.data.error) {
        lines = (linesResponse.data.result || []).map(l => ({
          id: l.id,
          product_id: Array.isArray(l.product_id) ? l.product_id[0] : l.product_id,
          product_name: Array.isArray(l.product_id) ? l.product_id[1] : '',
          quantity: l.quantity || 0,
          uom_id: Array.isArray(l.uom_id) ? l.uom_id[0] : l.uom_id,
          uom_name: Array.isArray(l.uom_id) ? l.uom_id[1] : '',
          unit_price: l.unit_price || 0,
          subtotal: l.subtotal || 0,
          available_qty: l.available_qty || 0,
          stock_status: l.stock_status || 'unavailable',
        }));
      }
    }

    return {
      id: r.id,
      name: r.name || '',
      date: r.date || '',
      state: r.state || 'draft',
      total_value: r.total_value || 0,
      note: r.note || '',
      urgency: r.urgency || 'normal',
      requesting_company_id: Array.isArray(r.requesting_company_id) ? r.requesting_company_id[0] : r.requesting_company_id,
      requesting_company_name: Array.isArray(r.requesting_company_id) ? r.requesting_company_id[1] : '',
      requesting_location_id: Array.isArray(r.requesting_location_id) ? r.requesting_location_id[0] : r.requesting_location_id,
      requesting_location_name: Array.isArray(r.requesting_location_id) ? r.requesting_location_id[1] : '',
      source_company_id: Array.isArray(r.source_company_id) ? r.source_company_id[0] : r.source_company_id,
      source_company_name: Array.isArray(r.source_company_id) ? r.source_company_id[1] : '',
      source_location_id: Array.isArray(r.source_location_id) ? r.source_location_id[0] : r.source_location_id,
      source_location_name: Array.isArray(r.source_location_id) ? r.source_location_id[1] : '',
      currency_name: Array.isArray(r.currency_id) ? r.currency_id[1] : '',
      lines,
      sent_by_name: Array.isArray(r.sent_by_id) ? r.sent_by_id[1] : '',
      sent_date: r.sent_date || '',
      approved_by_name: Array.isArray(r.approved_by_id) ? r.approved_by_id[1] : '',
      approval_date: r.approval_date || '',
      approval_note: r.approval_note || '',
      requester_signature: r.requester_signature ? `data:image/png;base64,${r.requester_signature}` : null,
      source_signature: r.source_signature ? `data:image/png;base64,${r.source_signature}` : null,
      rejection_reason: r.rejection_reason || '',
      transfer_id: Array.isArray(r.transfer_id) ? r.transfer_id[0] : r.transfer_id,
      transfer_name: Array.isArray(r.transfer_id) ? r.transfer_id[1] : '',
      transfer_state: r.transfer_state || '',
    };
  } catch (error) {
    console.error('fetchStockTransferDetailsOdoo error:', error?.message || error);
    throw error;
  }
};

// Create intercompany stock transfer request with lines
export const createStockTransferOdoo = async (data) => {
  try {
    const headers = await getOdooAuthHeaders();

    // For lines missing uom_id, fetch product's default UoM from Odoo
    const linesToCreate = data.lines || [];
    const missingUomProductIds = linesToCreate
      .filter(l => !l.uom_id || Number(l.uom_id) <= 0)
      .map(l => Number(l.product_id));

    let productUomMap = {};
    if (missingUomProductIds.length > 0) {
      const prodResponse = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'product.product',
            method: 'read',
            args: [missingUomProductIds],
            kwargs: { fields: ['id', 'uom_id'] },
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );
      const prods = prodResponse.data?.result || [];
      prods.forEach(p => {
        if (p.uom_id) {
          productUomMap[p.id] = Array.isArray(p.uom_id) ? p.uom_id[0] : p.uom_id;
        }
      });
    }

    // Build create vals — set state='sent' directly
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const vals = {
      requesting_company_id: Number(data.requesting_company_id),
      source_company_id: Number(data.source_company_id),
      state: 'sent',
      sent_date: now,
    };
    if (data.note) vals.note = data.note;
    if (data.urgency) vals.urgency = data.urgency;
    if (data.requester_signature) {
      vals.requester_signature = data.requester_signature.replace(/^data:image\/[^;]+;base64,/, '');
    }

    if (linesToCreate.length > 0) {
      vals.line_ids = linesToCreate.map(line => {
        const pid = Number(line.product_id);
        const uomId = (line.uom_id && Number(line.uom_id) > 0)
          ? Number(line.uom_id)
          : (productUomMap[pid] || false);

        if (!uomId) {
          console.warn(`[createStockRequest] No UoM found for product ${pid}`);
        }

        return [0, 0, {
          product_id: pid,
          quantity: Number(line.quantity),
          uom_id: uomId,
          unit_price: Number(line.unit_price || 0),
        }];
      });
    }

    console.log('[createStockTransferOdoo] Sending vals:', JSON.stringify(vals, null, 2));

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'intercompany.stock.request',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 30000 }
    );

    if (response.data.error) {
      const errData = response.data.error.data;
      const errMsg = errData?.message || errData?.name || 'Odoo JSON-RPC error';
      console.error('[createStockTransferOdoo] Odoo error:', JSON.stringify(response.data.error));
      throw new Error(errMsg);
    }

    const rawId = response.data.result;
    const recordId = Number(Array.isArray(rawId) ? rawId[0] : rawId);
    console.log('[createStockTransferOdoo] Created record ID:', recordId, 'state: sent');

    return { id: recordId };
  } catch (error) {
    console.error('createStockTransferOdoo error:', error?.message || error);
    throw error;
  }
};

// Update stock transfer request fields
export const updateStockTransferOdoo = async (requestId, data) => {
  try {
    const vals = {};
    if (data.note !== undefined) vals.note = data.note;
    if (data.urgency !== undefined) vals.urgency = data.urgency;
    if (data.rejection_reason !== undefined) vals.rejection_reason = data.rejection_reason;
    if (data.approval_note !== undefined) vals.approval_note = data.approval_note;
    if (data.requester_signature !== undefined) {
      vals.requester_signature = data.requester_signature
        ? data.requester_signature.replace(/^data:image\/[^;]+;base64,/, '')
        : false;
    }
    if (data.source_signature !== undefined) {
      vals.source_signature = data.source_signature
        ? data.source_signature.replace(/^data:image\/[^;]+;base64,/, '')
        : false;
    }

    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'intercompany.stock.request',
          method: 'write',
          args: [[requestId], vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    return response.data.result;
  } catch (error) {
    console.error('updateStockTransferOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch all companies from Odoo
export const fetchCompaniesOdoo = async () => {
  try {
    const online = await isOnline();
    if (!online) {
      const raw = await AsyncStorage.getItem('@cache:companies');
      if (raw) return JSON.parse(raw);
      return [];
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.company',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name'],
            order: 'name asc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    const mapped = (response.data.result || []).map(c => ({
      id: c.id,
      name: c.name,
      label: c.name,
    }));
    try { await AsyncStorage.setItem('@cache:companies', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('fetchCompaniesOdoo error:', error?.message || error);
    // Offline / Odoo-down fallback — return cached companies so dropdowns
    // still work on the Payment form.
    try {
      const raw = await AsyncStorage.getItem('@cache:companies');
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    throw error;
  }
};

// Fetch product stock availability by company
export const fetchProductStockOdoo = async (productIds, companyId) => {
  if (!productIds || !productIds.length || !companyId) return {};
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'stock.quant',
          method: 'search_read',
          args: [[
            ['product_id', 'in', productIds.map(Number)],
            ['company_id', '=', Number(companyId)],
            ['location_id.usage', '=', 'internal'],
          ]],
          kwargs: { fields: ['product_id', 'quantity'] },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) return {};
    const quants = response.data.result || [];
    const stockMap = {};
    quants.forEach(q => {
      const pid = Array.isArray(q.product_id) ? q.product_id[0] : q.product_id;
      stockMap[pid] = (stockMap[pid] || 0) + (q.quantity || 0);
    });
    return stockMap;
  } catch (error) {
    console.error('fetchProductStockOdoo error:', error?.message || error);
    return {};
  }
};

// Execute action on stock transfer request (approve, reject, draft, etc.)
export const stockTransferActionOdoo = async (requestId, action, companyId = null) => {
  try {
    const headers = await getOdooAuthHeaders();
    const kwargs = {};
    // Pass allowed_company_ids so Odoo sets self.env.company correctly
    // Required for approve/reject which check self.source_company_id == self.env.company
    if (companyId) {
      kwargs.context = { allowed_company_ids: [Number(companyId)] };
    }
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'intercompany.stock.request',
          method: action,
          args: [[requestId]],
          kwargs,
        },
      },
      { headers, withCredentials: true, timeout: 30000 }
    );

    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }

    return response.data.result;
  } catch (error) {
    console.error(`stockTransferActionOdoo (${action}) error:`, error?.message || error);
    throw error;
  }
};

// ============================================================
// Vehicle Maintenance (cash.collection) API
// ============================================================

// Fetch maintenance types for dropdown
export const fetchMaintenanceTypesOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'maintenance.type',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name'],
            limit: 100,
            order: 'name asc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }
    return (response.data.result || []).map(t => ({ id: t.id, name: t.name || '' }));
  } catch (error) {
    console.error('fetchMaintenanceTypesOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch vehicles from Odoo (with auth) for Vehicle Maintenance form
export const fetchVehiclesForMaintenanceOdoo = async ({ limit = 200 } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'fleet.vehicle',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name', 'license_plate', 'driver_id'],
            limit,
            order: 'name asc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }
    return (response.data.result || []).map(v => ({
      id: v.id,
      name: v.name || '',
      license_plate: v.license_plate || '',
      driver: v.driver_id ? { id: v.driver_id[0], name: v.driver_id[1] } : null,
    }));
  } catch (error) {
    console.error('fetchVehiclesForMaintenanceOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch partners (res.partner) from Odoo for Handover To dropdown
export const fetchPartnersOdoo = async ({ limit = 200 } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'name'],
            limit,
            order: 'name asc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }
    return (response.data.result || []).map(p => ({ id: p.id, name: p.name || '' }));
  } catch (error) {
    console.error('fetchPartnersOdoo error:', error?.message || error);
    throw error;
  }
};

// Fetch vehicle maintenance records (cash.collection) by date
export const fetchVehicleMaintenanceOdoo = async (params = {}) => {
  const { date, offset = 0, limit = 50 } = params;
  try {
    let domain = [];
    if (date) {
      domain.push(['date', '>=', `${date} 00:00:00`]);
      domain.push(['date', '<=', `${date} 23:59:59`]);
    }
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'cash.collection',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: [
              'id', 'ref', 'date', 'vehicle_id', 'driver_id', 'number_plate',
              'maintenance_type_id', 'company_id', 'current_km', 'amount',
              'handover_from', 'handover_to', 'image_url', 'remarks',
              'handover_to_partner_id',
              'is_validated', 'validated_by', 'validation_date',
            ],
            offset,
            limit,
            order: 'date desc, id desc',
          },
        },
      },
      { headers }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Odoo JSON-RPC error');
    }
    const records = response.data.result || [];
    const mapped = records.map(r => ({
      id: r.id,
      ref: r.ref || '',
      date: r.date || '',
      vehicle_id: Array.isArray(r.vehicle_id) ? r.vehicle_id[0] : null,
      vehicle_name: Array.isArray(r.vehicle_id) ? r.vehicle_id[1] : '',
      driver_id: Array.isArray(r.driver_id) ? r.driver_id[0] : null,
      driver_name: Array.isArray(r.driver_id) ? r.driver_id[1] : '',
      number_plate: r.number_plate || '',
      maintenance_type_id: Array.isArray(r.maintenance_type_id) ? r.maintenance_type_id[0] : null,
      maintenance_type_name: Array.isArray(r.maintenance_type_id) ? r.maintenance_type_id[1] : '',
      handover_to_partner_id: Array.isArray(r.handover_to_partner_id) ? r.handover_to_partner_id[0] : null,
      handover_to_partner_name: Array.isArray(r.handover_to_partner_id) ? r.handover_to_partner_id[1] : '',
      company_id: Array.isArray(r.company_id) ? r.company_id[0] : null,
      current_km: r.current_km || 0,
      amount: r.amount || 0,
      handover_from: r.handover_from || null,
      handover_to: r.handover_to || null,
      image_url: r.image_url || '',
      remarks: r.remarks || '',
      is_validated: !!r.is_validated,
      validated_by: Array.isArray(r.validated_by) ? r.validated_by[1] : '',
      validation_date: r.validation_date || '',
    }));
    if (!date) {
      try { await AsyncStorage.setItem('@cache:vehicleMaintenance', JSON.stringify(mapped)); } catch (_) {}
    }
    return await _mergeOfflineVehicleMaintenance(mapped, params);
  } catch (error) {
    console.error('fetchVehicleMaintenanceOdoo error:', error?.message || error);
    try {
      const raw = await AsyncStorage.getItem('@cache:vehicleMaintenance');
      const cached = raw ? JSON.parse(raw) : [];
      const filtered = _filterVehicleMaintenanceLocal(cached, params);
      console.log('[fetchVehicleMaintenance] OFFLINE — cached=' + cached.length + ' after-filter=' + filtered.length);
      return await _mergeOfflineVehicleMaintenance(filtered, params);
    } catch (_) {
      return [];
    }
  }
};

const _filterVehicleMaintenanceLocal = (rows, { date } = {}) => {
  if (!Array.isArray(rows)) return [];
  const dayOf = (s) => (typeof s === 'string' ? s.slice(0, 10) : '');
  return rows.filter((r) => {
    if (date && dayOf(r.date) !== date) return false;
    return true;
  });
};

const _mergeOfflineVehicleMaintenance = async (serverList, params = {}) => {
  try {
    const offlineQueue = require('@utils/offlineQueue').default;
    const queue = await offlineQueue.getAll();
    const pending = (queue || [])
      .filter(q => q.model === 'cash.collection' && q.operation === 'create')
      .map(q => ({
        id: 'offline_' + q.id,
        ref: q.values?.offline_label || 'OFF',
        offline_label: q.values?.offline_label || null,
        date: q.values?.date || '',
        vehicle_id: q.values?.vehicle_id || null,
        vehicle_name: q.values?._vehicleName || '',
        driver_id: q.values?.driver_id || null,
        driver_name: q.values?._driverName || '',
        number_plate: q.values?.number_plate || '',
        maintenance_type_id: q.values?.maintenance_type_id || null,
        maintenance_type_name: q.values?._maintenanceTypeName || '',
        handover_to_partner_id: q.values?.handover_to_partner_id || null,
        handover_to_partner_name: q.values?._handoverToPartnerName || '',
        current_km: q.values?.current_km || 0,
        amount: q.values?.amount || 0,
        remarks: q.values?.remarks || '',
        is_validated: false,
        validated_by: '',
        validation_date: '',
        offline: true,
        offlineQueueId: q.id,
      }));
    const filteredPending = params.date
      ? _filterVehicleMaintenanceLocal(pending, params)
      : pending;
    let labelMap = {};
    try {
      const raw = await AsyncStorage.getItem('@cache:offlineLabels:vehicleMaintenance');
      labelMap = raw ? JSON.parse(raw) : {};
    } catch (_) {}
    const decoratedServer = (serverList || []).map((v) => ({
      ...v,
      offline_label: labelMap[String(v.id)] || v.offline_label || null,
    }));
    return [...filteredPending, ...decoratedServer];
  } catch (e) {
    console.log('[fetchVehicleMaintenance] merge offline failed:', e?.message);
    return serverList || [];
  }
};

// Create or update a vehicle maintenance record (cash.collection)
export const createVehicleMaintenanceOdoo = async ({ payload, username, password, db } = {}) => {
  // Offline branch — fresh creates only.
  try {
    const networkStatus = require('@utils/networkStatus').default;
    const online = await networkStatus.isOnline();
    if (!online && payload && (typeof payload.id === 'undefined' || payload.id === null || payload.id === '')) {
      const offlineQueue = require('@utils/offlineQueue').default;
      const offLabel = await _nextOffLabel({
        counterKey: '@cache:vm_off_counter',
        cacheKey: '@cache:vehicleMaintenance',
        scope: 'vehicleMaintenance',
      });
      const enrichedValues = {
        ...payload,
        offline_label: offLabel,
        _vehicleName: payload?._vehicleName || '',
        _driverName: payload?._driverName || '',
        _maintenanceTypeName: payload?._maintenanceTypeName || '',
        _handoverToPartnerName: payload?._handoverToPartnerName || '',
      };
      const localId = await offlineQueue.enqueue({
        model: 'cash.collection',
        operation: 'create',
        values: enrichedValues,
      });
      console.log('[cash.collection] OFFLINE queued create localId=' + localId + ' offLabel=' + offLabel);
      return { id: 'offline_' + localId, ref: offLabel, offline: true };
    }
  } catch (e) {
    console.log('[cash.collection] offline-branch check failed, falling through:', e?.message);
  }
  try {
    const loginResp = await loginVehicleTrackingOdoo({ username, password, db });
    const baseUrl = (ODOO_BASE_URL() || '').replace(/\/$/, '');
    const headers = await getOdooAuthHeaders();
    if (loginResp && loginResp.cookies) headers.Cookie = loginResp.cookies;

    const maintenancePayload = { ...payload };

    // Convert many2one string IDs to integers
    ['vehicle_id', 'driver_id', 'maintenance_type_id', 'company_id', 'handover_to_partner_id'].forEach(field => {
      if (maintenancePayload[field] && typeof maintenancePayload[field] === 'string') {
        maintenancePayload[field] = parseInt(maintenancePayload[field], 10);
      }
    });

    // Convert image file URIs to base64 (same format as odometer_image)
    for (const field of ['handover_from', 'handover_to', 'image_url']) {
      if (maintenancePayload[field]) {
        try {
          const uri = maintenancePayload[field];
          if (uri && (uri.startsWith('file://') || uri.startsWith('/'))) {
            const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
            if (b64 && b64.length > 0) {
              maintenancePayload[field] = b64;
              console.log(`Attached ${field} base64 length:`, b64.length);
            }
          }
        } catch (readErr) {
          console.warn(`Could not read ${field} file for base64:`, readErr?.message || readErr);
        }
      }
    }

    // Clean undefined/empty keys
    Object.keys(maintenancePayload).forEach(k => {
      if (maintenancePayload[k] === undefined || maintenancePayload[k] === '') {
        delete maintenancePayload[k];
      }
    });

    let recordId;

    if (maintenancePayload.id) {
      // Update existing record
      recordId = maintenancePayload.id;
      const { id: _remove, ...updatePayload } = maintenancePayload;
      const resp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'cash.collection',
            method: 'write',
            args: [[recordId], updatePayload],
            kwargs: {},
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );
      if (resp.data.error) {
        throw new Error(resp.data.error.data?.message || 'Odoo write error');
      }
    } else {
      // Create new record
      const resp = await axios.post(
        `${baseUrl}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'cash.collection',
            method: 'create',
            args: [[maintenancePayload]],
            kwargs: {},
          },
        },
        { headers, withCredentials: true, timeout: 15000 }
      );
      if (resp.data.error) {
        throw new Error(resp.data.error.data?.message || 'Odoo create error');
      }
      const raw = resp.data.result;
      recordId = Array.isArray(raw) ? raw[0] : (Number.isFinite(Number(raw)) ? Number(raw) : raw);
    }

    console.log('createVehicleMaintenanceOdoo success, recordId:', recordId);
    return recordId;
  } catch (error) {
    console.error('createVehicleMaintenanceOdoo error:', error?.message || error);
    throw error;
  }
};

// ============================================================
// Mobile Repair / Job Card API Functions
// ============================================================

// Ensure valid Odoo session — re-authenticate if cookie is missing or expired
const ensureOdooSession = async () => {
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/+$/, '');
  let headers = await getOdooAuthHeaders();
  // Quick check: if no cookie at all, authenticate immediately
  if (!headers.Cookie) {
    console.log('[MobileRepair] No odoo_cookie found, authenticating...');
    return await _reauthenticateOdoo();
  }
  // Quick verify: make a lightweight call to check session validity
  try {
    const resp = await axios.post(
      `${baseUrl}/web/session/get_session_info`,
      { jsonrpc: '2.0', method: 'call', params: {} },
      { headers, timeout: 8000 }
    );
    if (resp.data?.result?.uid) {
      return headers; // session is valid
    }
    console.log('[MobileRepair] Session invalid (no uid), re-authenticating...');
    return await _reauthenticateOdoo();
  } catch (e) {
    console.log('[MobileRepair] Session check failed, re-authenticating...', e?.message);
    return await _reauthenticateOdoo();
  }
};

const _reauthenticateOdoo = async () => {
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/+$/, '');
  try {
    const authResp = await axios.post(
      `${baseUrl}/web/session/authenticate`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { db: (await AsyncStorage.getItem('odoo_db')) || DEFAULT_ODOO_DB, login: DEFAULT_USERNAME, password: DEFAULT_PASSWORD },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    if (authResp.data?.error) {
      console.error('[MobileRepair] Auth error:', authResp.data.error?.data?.message || authResp.data.error);
      throw new Error('Odoo authentication failed');
    }
    const setCookie = authResp.headers['set-cookie'] || authResp.headers['Set-Cookie'];
    let cookieStr = '';
    if (setCookie) {
      cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    }
    const sid = authResp.data?.result?.session_id;
    if (!cookieStr && sid) cookieStr = `session_id=${sid}`;
    if (cookieStr) {
      await AsyncStorage.setItem('odoo_cookie', cookieStr);
      console.log('[MobileRepair] Re-authenticated successfully, cookie stored');
    } else {
      console.warn('[MobileRepair] Auth succeeded but no cookie/session_id received');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (cookieStr) headers.Cookie = cookieStr;
    return headers;
  } catch (error) {
    console.error('[MobileRepair] _reauthenticateOdoo error:', error?.message || error);
    throw error;
  }
};

const JOB_CARD_MODELS = ['job.card', 'mobile.repair.job.card', 'repair.order'];

// Fuzzy match stage name to a known stage category (used by moveJobCardToNextStageOdoo)
const matchStage = (name) => {
  if (!name) return 'draft';
  const n = name.toLowerCase().trim();
  if (n.includes('draft')) return 'draft';
  if (n.includes('inspect')) return 'inspection';
  if (n.includes('quotation') || n.includes('quote')) return 'quotation';
  if (n.includes('repair') || n.includes('progress')) return 'repair';
  if (n.includes('complete') || n.includes('done')) return 'completed';
  if (n.includes('cancel')) return 'cancelled';
  return 'draft';
};

const callOdooWithModelFallback = async (models, method, args, kwargs, headers, reqTimeout = 15000) => {
  const baseUrl = (ODOO_BASE_URL() || '').replace(/\/+$/, '');
  const url = `${baseUrl}/web/dataset/call_kw`;

  // Check if an RPC error means "model not found" (should try next model)
  const isModelNotFound = (err) => {
    const msg = (err?.data?.message || err?.message || '').toLowerCase();
    return msg.includes('not found') || msg.includes('does not exist') ||
           msg.includes('no module named') || msg.includes('not installed');
  };

  let lastError = null;
  for (const model of models) {
    try {
      console.log(`[MobileRepair] callOdoo: ${model}.${method}`);
      const resp = await axios.post(
        url,
        { jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } },
        { headers, timeout: reqTimeout }
      );
      if (resp.data.error) {
        if (resp.data.error?.data?.name === 'odoo.http.SessionExpiredException') {
          console.log('[MobileRepair] Session expired, re-authenticating...');
          const newHeaders = await _reauthenticateOdoo();
          const retryResp = await axios.post(
            url,
            { jsonrpc: '2.0', method: 'call', params: { model, method, args, kwargs } },
            { headers: newHeaders, timeout: reqTimeout }
          );
          if (retryResp.data.error) {
            lastError = retryResp.data.error;
            if (!isModelNotFound(retryResp.data.error)) throw lastError;
            continue;
          }
          return { result: retryResp.data.result, model };
        }
        const rpcErr = resp.data.error;
        console.log(`[MobileRepair] ${model}.${method} RPC error:`, rpcErr?.data?.message || '');
        lastError = rpcErr;
        // If model exists but call failed (validation error etc), throw immediately
        if (!isModelNotFound(rpcErr)) throw rpcErr;
        continue;
      }
      return { result: resp.data.result, model };
    } catch (e) {
      // If it's a thrown RPC error (not HTTP), re-throw it
      if (e?.data?.message || e?.message?.includes('mandatory')) throw e;
      console.log(`[MobileRepair] ${model}.${method} HTTP error:`, e?.response?.status || e?.message || '');
      lastError = e;
      continue;
    }
  }
  throw lastError || new Error('All model names failed');
};

export const fetchJobCardsListOdoo = async ({ offset = 0, limit = 30, searchText = '' } = {}) => {
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (searchText) {
      domain = ['|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]];
    }
    const { result } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'search_read', [],
      { domain, fields: [], offset, limit, order: 'create_date desc' }, headers
    );
    // Map using correct Odoo field names from job.card model
    return (result || []).map(jc => ({
      id: jc.id,
      ref: jc.name || '',                                               // name = "Job Card No."
      partner_name: Array.isArray(jc.partner_id) ? jc.partner_id[1] : '',
      phone: jc.phone || '',
      device_brand: Array.isArray(jc.brand_id) ? jc.brand_id[1] : '',   // brand_id
      device_model: Array.isArray(jc.model_id) ? jc.model_id[1] : '',   // model_id
      stage_id: Array.isArray(jc.stage_id) ? jc.stage_id[0] : jc.stage_id,
      stage_name: Array.isArray(jc.stage_id) ? jc.stage_id[1] : (jc.state || 'Draft'),
      priority: jc.priority || '0',
      receiving_date: jc.receiving_date || '',
      expected_delivery_date: jc.delivery_date || '',                    // delivery_date
      assigned_to: Array.isArray(jc.assigned_to) ? jc.assigned_to[1] : '',
      repair_team: Array.isArray(jc.team_id) ? jc.team_id[1] : '',      // team_id
      total_amount: jc.total_amount || 0,
      issue_complaint: jc.issue || '',                                   // issue
    }));
  } catch (error) {
    console.error('fetchJobCardsListOdoo error:', error?.message || error);
    return [];
  }
};

// ---- Dashboard Statistics ----
export const fetchJobCardDashboardOdoo = async () => {
  try {
    const headers = await ensureOdooSession();

    // 1. Fetch ALL job cards with ALL fields (fields:[] = return everything)
    const { result: allCards } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'search_read', [],
      { domain: [], fields: [], limit: 0 },
      headers
    );
    const cards = allCards || [];
    console.log('[Dashboard] Total cards fetched:', cards.length);
    // Log all field names from first card to discover actual stage/type field names
    if (cards.length > 0) {
      console.log('[Dashboard] ALL FIELD NAMES:', Object.keys(cards[0]).join(', '));
      // Log fields that might be stage-related
      const stageFields = Object.entries(cards[0]).filter(([k]) =>
        k.includes('stage') || k.includes('state') || k.includes('status') || k.includes('step')
      );
      console.log('[Dashboard] Stage-related fields:', JSON.stringify(stageFields));
      // Log fields that might be inspection/delivery related
      const typeFields = Object.entries(cards[0]).filter(([k]) =>
        k.includes('inspect') || k.includes('delivery') || k.includes('type')
      );
      console.log('[Dashboard] Type-related fields:', JSON.stringify(typeFields));
    }

    // 2. Fetch ALL field metadata so we can find selection labels
    let inspLabels = {};
    let delLabels = {};
    try {
      const { result: fieldsMeta } = await callOdooWithModelFallback(
        JOB_CARD_MODELS, 'fields_get', [],
        { attributes: ['type', 'selection', 'string'] }, headers
      );
      // Find all selection fields and log them
      const selectionFields = Object.entries(fieldsMeta || {}).filter(([, v]) => v.type === 'selection');
      console.log('[Dashboard] Selection fields:', selectionFields.map(([k, v]) => `${k}: ${JSON.stringify(v.selection)}`).join(' | '));

      // Try known field names for inspection/delivery
      const inspField = fieldsMeta?.inspection_type || fieldsMeta?.inspect_type;
      const delField = fieldsMeta?.delivery_type || fieldsMeta?.deliver_type;
      if (inspField?.selection) {
        inspField.selection.forEach(([val, label]) => { inspLabels[val] = label; });
      }
      if (delField?.selection) {
        delField.selection.forEach(([val, label]) => { delLabels[val] = label; });
      }
      console.log('[Dashboard] inspLabels:', JSON.stringify(inspLabels));
      console.log('[Dashboard] delLabels:', JSON.stringify(delLabels));
    } catch (e) {
      console.log('[Dashboard] fields_get failed:', e?.message);
    }

    // 3. Count by stage
    const stageCounts = { draft: 0, inspection: 0, quotation: 0, repair: 0, completed: 0, cancelled: 0 };
    const inspectionTypes = {};
    const deliveryTypes = {};

    cards.forEach((jc, idx) => {
      // --- Stage ---
      // Try multiple possible field names for stage
      const stageVal = jc.stage_id || jc.stage || jc.state || jc.status || '';
      let stageName = '';
      if (Array.isArray(stageVal) && stageVal.length >= 2) {
        stageName = stageVal[1];
      } else if (typeof stageVal === 'string') {
        stageName = stageVal;
      }
      const cat = matchStage(stageName);
      if (idx < 5) console.log(`[Dashboard] Card #${jc.id} stage: raw=${JSON.stringify(stageVal)} name="${stageName}" → ${cat}`);
      if (stageCounts[cat] !== undefined) stageCounts[cat]++;

      // --- Inspection type ---
      const iRaw = jc.inspection_type || jc.inspect_type || '';
      if (iRaw && iRaw !== false) {
        const iLabel = inspLabels[iRaw] || iRaw;
        inspectionTypes[iLabel] = (inspectionTypes[iLabel] || 0) + 1;
      }

      // --- Delivery type ---
      const dRaw = jc.delivery_type || jc.deliver_type || '';
      if (dRaw && dRaw !== false) {
        const dLabel = delLabels[dRaw] || dRaw;
        deliveryTypes[dLabel] = (deliveryTypes[dLabel] || 0) + 1;
      }
    });

    // Add zero-count entries for all selection options
    Object.values(inspLabels).forEach(label => {
      if (inspectionTypes[label] === undefined) inspectionTypes[label] = 0;
    });
    Object.values(delLabels).forEach(label => {
      if (deliveryTypes[label] === undefined) deliveryTypes[label] = 0;
    });

    const total = cards.length;
    const completed = stageCounts.completed;
    const pending = total - completed - stageCounts.cancelled;

    console.log('[Dashboard] stageCounts:', JSON.stringify(stageCounts));
    console.log('[Dashboard] inspectionTypes:', JSON.stringify(inspectionTypes));
    console.log('[Dashboard] deliveryTypes:', JSON.stringify(deliveryTypes));

    return {
      stageCounts,
      statistics: { total, completed, pending },
      inspectionTypes,
      deliveryTypes,
    };
  } catch (error) {
    console.error('fetchJobCardDashboardOdoo error:', error?.message || error);
    return {
      stageCounts: { draft: 0, inspection: 0, quotation: 0, repair: 0, completed: 0, cancelled: 0 },
      statistics: { total: 0, completed: 0, pending: 0 },
      inspectionTypes: {},
      deliveryTypes: {},
    };
  }
};

// Character-by-character tag removal — works on all JS engines including Hermes
const _removeTags = (str) => {
  let out = '';
  let inTag = false;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '<') { inTag = true; continue; }
    if (str[i] === '>') { inTag = false; continue; }
    if (!inTag) out += str[i];
  }
  return out;
};
const _decodeEntities = (str) => {
  let t = str;
  t = t.replace(/&nbsp;/gi, ' ');
  t = t.replace(/&amp;/gi, '&');
  t = t.replace(/&lt;/gi, '<');
  t = t.replace(/&gt;/gi, '>');
  t = t.replace(/&quot;/gi, '"');
  t = t.replace(/&#39;/gi, "'");
  t = t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  t = t.replace(/&[a-zA-Z]+;/g, ' ');
  return t;
};
// Strip ALL HTML from Odoo fields — 3 full passes (strip → decode → strip → decode → strip)
const stripOdooHtml = (html) => {
  if (!html || typeof html !== 'string') return html || '';
  let t = html;
  // Convert block elements to newlines
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<\/p>/gi, '\n');
  t = t.replace(/<\/div>/gi, '\n');
  t = t.replace(/<\/tr>/gi, '\n');
  t = t.replace(/<\/li>/gi, '\n');
  t = t.replace(/<li[^>]*>/gi, '- ');
  // Pass 1: strip tags → decode entities
  t = _removeTags(t);
  t = _decodeEntities(t);
  // Pass 2: strip again → decode again (handles double-encoded)
  t = _removeTags(t);
  t = _decodeEntities(t);
  // Pass 3: final strip
  t = _removeTags(t);
  // Clean whitespace
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
};

export const fetchJobCardDetailsOdoo = async (jobCardId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'read', [[jobCardId]], { fields: [] }, headers
    );
    const jc = Array.isArray(result) && result.length > 0 ? result[0] : null;
    if (!jc) return null;
    console.log('[MobileRepair] Raw job card data - stage_id:', jc.stage_id, 'state:', jc.state, 'status:', jc.status);
    // Log all issue-related fields to find the correct field name
    const issueFields = Object.keys(jc).filter(k => k.includes('issue') || k.includes('complaint') || k.includes('problem') || k.includes('description'));
    console.log('[MobileRepair] Issue-related fields:', JSON.stringify(issueFields.map(f => f + '=' + JSON.stringify(jc[f]))));
    console.log('[MobileRepair] jc.issue =', JSON.stringify(jc.issue), '| jc.issue_description =', JSON.stringify(jc.issue_description), '| jc.complaint =', JSON.stringify(jc.complaint));
    const m2o = (val) => Array.isArray(val) ? { id: val[0], name: val[1] } : (val ? { id: val, name: '' } : null);
    // Stage: try stage_id (Many2one), then fall back to state/status (Selection field)
    let stage = m2o(jc.stage_id);
    if (!stage || !stage.name) {
      const stateName = jc.state || jc.status || '';
      if (stateName) {
        // Convert selection value to display name
        const stateMap = {
          'draft': 'Draft', 'inspection': 'In Inspection', 'in_inspection': 'In Inspection',
          'quotation': 'Quotation', 'quote': 'Quotation',
          'repair': 'Repair', 'in_repair': 'Repair', 'in_progress': 'Repair',
          'done': 'Completed', 'completed': 'Completed', 'complete': 'Completed',
          'cancel': 'Cancelled', 'cancelled': 'Cancelled',
        };
        stage = { id: 0, name: stateMap[stateName.toLowerCase()] || stateName };
      }
    }
    // Map using correct Odoo field names from job.card model
    return {
      id: jc.id, ref: jc.name || '',                          // name = "Job Card No."
      partner: m2o(jc.partner_id), phone: jc.phone || '', email: jc.email || '',
      priority: jc.priority || '0',
      device_brand: m2o(jc.brand_id),                          // brand_id (not device_brand_id)
      device_series: m2o(jc.series_id),                        // series_id (not device_series_id)
      device_model: m2o(jc.model_id),                          // model_id (not device_model_id)
      imei_1: jc.imei_1 || '', imei_2: jc.imei_2 || '',
      device_password: jc.device_password || '',
      physical_condition: jc.device_condition || '',            // device_condition (not physical_condition)
      under_warranty: jc.is_warranty || false,                  // is_warranty (not under_warranty)
      issue_type: m2o(jc.issue_type_id),                          // many2one
      issue_type_ids: jc.issue_type_ids || [],                     // many2many
      // "Issue / Complaint": use issue text, fallback to issue type name if issue is empty/dash
      issue_complaint: (jc.issue && jc.issue !== '-' && jc.issue !== false) ? jc.issue
        : (Array.isArray(jc.issue_type_id) ? jc.issue_type_id[1] : '') || '',
      issue_notes: jc.issue_notes || '',                           // "Additional Issue Details"
      accessories_received: jc.accessories || '',               // accessories (not accessories_received)
      receiving_date: jc.receiving_date || '',
      expected_delivery_date: jc.delivery_date || '',           // delivery_date (not expected_delivery_date)
      delivery_type: jc.delivery_type || '', inspection_type: jc.inspection_type || '',
      repair_team: m2o(jc.team_id),                            // team_id (not repair_team_id)
      assigned_to: m2o(jc.assigned_to),
      responsible: m2o(jc.responsible_id),
      inspection_date: jc.inspection_date || '', completion_date: jc.completion_date || '',
      stage, state: jc.state || '',
      sale_order: m2o(jc.sale_order_id), easy_sales: m2o(jc.easy_sales_id), task: m2o(jc.task_id),
      total_amount: jc.total_amount || 0,
      inspection_notes: stripOdooHtml(jc.inspection_notes || ''),
      checklist_ids: jc.checklist_ids || [],
      repair_step_ids: jc.repair_step_ids || [],
      service_line_ids: jc.service_line_ids || [],
      spare_part_ids: jc.spare_part_line_ids || [],
      total_service_charge: jc.total_service_charge || 0,
      diagnosis_result: stripOdooHtml(jc.ai_diagnosis || ''),   // strip Odoo HTML at API level
      create_date: jc.create_date || '',
      sale_order_count: jc.sale_order_count || 0,
      spare_request_count: jc.spare_request_count || 0,
      // Estimation fields
      estimated_hours: jc.estimated_hours || jc.estimated_time || 0,
      estimated_parts_cost: jc.estimated_parts_cost || jc.parts_cost || 0,
      estimated_labor_cost: jc.estimated_labor_cost || jc.labor_cost || 0,
      total_estimated_cost: jc.total_estimated_cost || jc.estimated_total || jc.total_cost || 0,
      // Symptom IDs
      symptom_ids: jc.symptom_ids || jc.symptom_line_ids || [],
    };
  } catch (error) {
    console.error('fetchJobCardDetailsOdoo error:', error?.message || error);
    return null;
  }
};

// ---- Diagnosis Records ----
const DIAGNOSIS_MODELS = ['job.card.diagnosis', 'diagnosis.line', 'repair.diagnosis', 'mobile.repair.diagnosis'];

export const fetchDiagnosisListOdoo = async ({ jobCardId = null, offset = 0, limit = 50 } = {}) => {
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (jobCardId) {
      domain = [['job_card_id', '=', jobCardId]];
    }
    const { result } = await callOdooWithModelFallback(
      DIAGNOSIS_MODELS, 'search_read', [],
      { domain, fields: [], offset, limit, order: 'id desc' }, headers
    );
    const records = result || [];
    console.log('[Diagnosis] Fetched:', records.length);
    if (records.length > 0) console.log('[Diagnosis] Sample keys:', Object.keys(records[0]).join(', '));
    return records.map(r => ({
      id: r.id,
      job_card_ref: Array.isArray(r.job_card_id) ? r.job_card_id[1] : (r.job_card_id || ''),
      job_card_id: Array.isArray(r.job_card_id) ? r.job_card_id[0] : r.job_card_id,
      test_name: r.test_name || r.name || '',
      category: Array.isArray(r.category_id) ? r.category_id[1] : (r.category || r.category_id || ''),
      result: r.result || r.test_result || r.state || 'not_tested',
      ai_confidence: r.ai_confidence || r.confidence || 0,
      root_cause: Array.isArray(r.root_cause_id) ? r.root_cause_id[1] : (r.root_cause || ''),
    }));
  } catch (error) {
    console.error('fetchDiagnosisListOdoo error:', error?.message || error);
    return [];
  }
};

// ---- Repair Steps ----
const REPAIR_STEP_MODELS = ['repair.step', 'job.card.repair.step', 'repair.step.line', 'mobile.repair.step'];

export const fetchRepairStepsListOdoo = async ({ jobCardId = null, offset = 0, limit = 50 } = {}) => {
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (jobCardId) {
      domain = [['job_card_id', '=', jobCardId]];
    }
    const { result } = await callOdooWithModelFallback(
      REPAIR_STEP_MODELS, 'search_read', [],
      { domain, fields: [], offset, limit, order: 'id asc' }, headers
    );
    const records = result || [];
    console.log('[RepairSteps] Fetched:', records.length);
    if (records.length > 0) console.log('[RepairSteps] Sample keys:', Object.keys(records[0]).join(', '));
    if (records.length > 0) {
      console.log('[RepairSteps] RAW FIRST RECORD:', JSON.stringify(records[0], null, 2));
    }
    return records.map(r => ({
      id: r.id,
      job_card_ref: Array.isArray(r.job_card_id) ? r.job_card_id[1] : (r.job_card_id || ''),
      job_card_id: Array.isArray(r.job_card_id) ? r.job_card_id[0] : r.job_card_id,
      step_title: r.step_title || r.name || '',
      difficulty: r.difficulty || 'easy',
      estimated_minutes: r.estimated_minutes || r.estimated_time || 0,
      status: r.status || r.state || 'pending',
      source: r.source || '',
      technician_notes: r.technician_notes || r.notes || '',
    }));
  } catch (error) {
    console.error('fetchRepairStepsListOdoo error:', error?.message || error);
    return [];
  }
};

export const fetchRepairStepDetailOdoo = async (stepId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      REPAIR_STEP_MODELS, 'read', [[stepId]], { fields: [] }, headers
    );
    const r = Array.isArray(result) ? result[0] : result;
    if (!r) return null;
    console.log('[RepairStepDetail] Keys:', Object.keys(r).join(', '));
    return {
      id: r.id,
      job_card_ref: Array.isArray(r.job_card_id) ? r.job_card_id[1] : (r.job_card_id || ''),
      job_card_id: Array.isArray(r.job_card_id) ? r.job_card_id[0] : r.job_card_id,
      step_title: r.step_title || r.name || '',
      difficulty: r.difficulty || 'easy',
      estimated_minutes: r.estimated_minutes || r.estimated_time || 0,
      status: r.status || r.state || 'pending',
      source: r.source || '',
      source_url: r.source_url || '',
      instructions: r.instructions || r.description || '',
      parts_used: Array.isArray(r.parts_used_ids) ? r.parts_used_ids : (r.parts_used || []),
      part_cost: r.part_cost || r.parts_cost || 0,
      before_photo: r.before_photo || r.before_image || false,
      after_photo: r.after_photo || r.after_image || false,
      technician_notes: r.technician_notes || r.notes || '',
    };
  } catch (error) {
    console.error('fetchRepairStepDetailOdoo error:', error?.message || error);
    return null;
  }
};

export const updateRepairStepStatusOdoo = async (stepId, status) => {
  try {
    const headers = await ensureOdooSession();
    // Try action methods first (action_done, action_skip, action_fail)
    const actionMap = { done: 'action_done', skip: 'action_skip', failed: 'action_fail' };
    const actionMethod = actionMap[status];
    if (actionMethod) {
      try {
        await callOdooWithModelFallback(
          REPAIR_STEP_MODELS, actionMethod, [[stepId]], {}, headers
        );
        console.log(`[RepairStep] ${actionMethod} succeeded for step ${stepId}`);
        return true;
      } catch (e) {
        console.log(`[RepairStep] ${actionMethod} failed, falling back to write:`, e?.message);
      }
    }
    // Fallback: write status directly
    await callOdooWithModelFallback(
      REPAIR_STEP_MODELS, 'write', [[stepId], { status }], {}, headers
    );
    console.log(`[RepairStep] write status=${status} succeeded for step ${stepId}`);
    return true;
  } catch (error) {
    console.error('updateRepairStepStatusOdoo error:', error?.message || error);
    throw new Error('Failed to update repair step status');
  }
};

export const deleteRepairStepOdoo = async (stepId) => {
  try {
    const headers = await ensureOdooSession();
    await callOdooWithModelFallback(
      REPAIR_STEP_MODELS, 'unlink', [[stepId]], {}, headers
    );
    return true;
  } catch (error) {
    console.error('deleteRepairStepOdoo error:', error?.message || error);
    throw error;
  }
};

export const fetchJobCardStagesOdoo = async () => {
  try {
    const headers = await ensureOdooSession();

    // Step 1: Discover the real stage model from job.card's stage_id field
    let stageModelName = null;
    try {
      const { result: fields } = await callOdooWithModelFallback(
        JOB_CARD_MODELS, 'fields_get', [],
        { attributes: ['type', 'relation', 'selection'] }, headers
      );
      if (fields?.stage_id?.type === 'many2one' && fields?.stage_id?.relation) {
        stageModelName = fields.stage_id.relation;
        console.log('[MobileRepair] Discovered stage model:', stageModelName);
      }
    } catch {}

    // Step 2: Try discovered model first, then known fallbacks
    const modelsToTry = [...new Set([
      stageModelName, 'mobile.repair.stage', 'job.card.stage', 'repair.stage',
    ].filter(Boolean))];

    for (const model of modelsToTry) {
      try {
        const resp = await axios.post(
          `${ODOO_BASE_URL()}/web/dataset/call_kw`,
          { jsonrpc: '2.0', method: 'call', params: {
            model, method: 'search_read', args: [],
            kwargs: { domain: [], fields: ['id', 'name', 'sequence'], order: 'sequence asc', limit: 20 },
          }},
          { headers, timeout: reqTimeout }
        );
        if (!resp.data?.error && resp.data?.result?.length > 0) {
          console.log('[MobileRepair] Loaded ' + resp.data.result.length + ' stages from ' + model);
          return resp.data.result.map(s => ({ id: s.id, name: s.name || '', sequence: s.sequence || 0 }));
        }
      } catch { continue; }
    }

    // Step 3: If no stage model works, build stages from state selection values
    try {
      const { result: fields } = await callOdooWithModelFallback(
        JOB_CARD_MODELS, 'fields_get', [],
        { attributes: ['type', 'selection'] }, headers
      );
      if (fields?.state?.selection && Array.isArray(fields.state.selection)) {
        console.log('[MobileRepair] Using state selection values as stages');
        return fields.state.selection.map(([value, label], idx) => ({
          id: value,
          name: label,
          sequence: idx + 1,
          isStateSelection: true,
        }));
      }
    } catch {}

    // Absolute fallback — use state values (not numeric IDs)
    return [
      { id: 'draft', name: 'Draft', sequence: 1, isStateSelection: true },
      { id: 'in_inspection', name: 'In Inspection', sequence: 2, isStateSelection: true },
      { id: 'quotation', name: 'Quotation', sequence: 3, isStateSelection: true },
      { id: 'repair', name: 'Repair', sequence: 4, isStateSelection: true },
      { id: 'done', name: 'Completed', sequence: 5, isStateSelection: true },
    ];
  } catch (error) {
    console.error('fetchJobCardStagesOdoo error:', error?.message || error);
    return [];
  }
};

export const createJobCardOdoo = async (payload) => {
  try {
    const headers = await ensureOdooSession();
    const data = { ...payload };
    // Convert relational fields to integer IDs
    ['partner_id', 'brand_id', 'series_id', 'model_id', 'team_id', 'assigned_to', 'responsible_id', 'issue_type_id'].forEach(f => {
      if (data[f] && typeof data[f] === 'object') data[f] = data[f].id;
      if (data[f] && typeof data[f] === 'string') {
        const n = parseInt(data[f], 10);
        if (!isNaN(n)) data[f] = n; else delete data[f];
      }
    });
    // Remove empty/null values
    Object.keys(data).forEach(k => { if (data[k] === undefined || data[k] === '' || data[k] === null) delete data[k]; });

    // Discover valid fields via fields_get and strip unknown ones (prevents 400/error)
    try {
      const { result: validFields } = await callOdooWithModelFallback(
        JOB_CARD_MODELS, 'fields_get', [], { attributes: ['type'] }, headers
      );
      if (validFields) {
        const validSet = new Set(Object.keys(validFields));
        Object.keys(data).forEach(k => {
          if (k !== 'id' && !validSet.has(k)) {
            console.log(`[MobileRepair] createJobCard: removing unknown field "${k}"`);
            delete data[k];
          }
        });
      }
    } catch (e) {
      console.log('[MobileRepair] fields_get check failed, sending as-is:', e?.message);
    }

    console.log('[MobileRepair] createJobCard payload keys:', Object.keys(data).join(', '));
    console.log('[MobileRepair] createJobCard issue value:', JSON.stringify(data.issue), '| issue_type_id:', data.issue_type_id);

    if (data.id) {
      const id = data.id; delete data.id;
      await callOdooWithModelFallback(JOB_CARD_MODELS, 'write', [[id], data], {}, headers);
      return id;
    } else {
      const { result } = await callOdooWithModelFallback(JOB_CARD_MODELS, 'create', [data], {}, headers);
      return Array.isArray(result) ? result[0] : result;
    }
  } catch (error) {
    console.error('createJobCardOdoo error:', error?.message || error);
    throw error;
  }
};

export const updateJobCardStageOdoo = async (jobCardId, stageId) => {
  try {
    const headers = await ensureOdooSession();
    // If stageId is a string, it's a state selection value — write state field
    if (typeof stageId === 'string') {
      await callOdooWithModelFallback(JOB_CARD_MODELS, 'write', [[jobCardId], { state: stageId }], {}, headers);
    } else {
      await callOdooWithModelFallback(JOB_CARD_MODELS, 'write', [[jobCardId], { stage_id: stageId }], {}, headers);
    }
    return true;
  } catch (error) {
    console.error('updateJobCardStageOdoo error:', error?.message || error);
    throw error;
  }
};

// Move job card to next stage — tries action methods first, then write state/stage_id
export const moveJobCardToNextStageOdoo = async (jobCardId, targetState) => {
  const headers = await ensureOdooSession();

  // Map target state to action method names to try
  const ACTION_METHODS = {
    'inspection': ['action_start_inspection', 'action_inspect', 'action_in_inspection'],
    'quotation': ['action_create_quotation', 'action_quotation'],
    'repair': ['action_start_repair', 'action_repair'],
    'completed': ['action_done', 'action_complete', 'action_mark_completed'],
    'cancelled': ['action_cancel'],
  };

  // Step 1: Try action methods on the model
  const methods = ACTION_METHODS[targetState] || [];
  for (const method of methods) {
    try {
      await callOdooWithModelFallback(JOB_CARD_MODELS, method, [[jobCardId]], {}, headers);
      console.log('[MobileRepair] Stage transition via ' + method + ' succeeded');
      return true;
    } catch (e) {
      console.log('[MobileRepair] Action ' + method + ' failed:', e?.message || e?.data?.message || '');
      continue;
    }
  }

  // Step 2: Try writing state field directly
  const STATE_VALUES = {
    'inspection': ['in_inspection', 'inspection', 'inspect'],
    'quotation': ['quotation', 'quote'],
    'repair': ['repair', 'in_repair', 'in_progress'],
    'completed': ['done', 'completed', 'complete'],
    'cancelled': ['cancelled', 'cancel'],
  };

  const stateValues = STATE_VALUES[targetState] || [targetState];
  for (const stateVal of stateValues) {
    try {
      await callOdooWithModelFallback(JOB_CARD_MODELS, 'write', [[jobCardId], { state: stateVal }], {}, headers);
      console.log('[MobileRepair] Stage transition via state=' + stateVal + ' succeeded');
      return true;
    } catch { continue; }
  }

  // Step 3: Last resort — discover stage model and write stage_id
  try {
    const { result: fields } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'fields_get', [],
      { attributes: ['type', 'relation'] }, headers
    );
    if (fields?.stage_id?.relation) {
      const stageModel = fields.stage_id.relation;
      const resp = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: {
          model: stageModel, method: 'search_read', args: [],
          kwargs: { domain: [], fields: ['id', 'name', 'sequence'], order: 'sequence asc', limit: 20 },
        }},
        { headers, timeout: reqTimeout }
      );
      if (!resp.data?.error && resp.data?.result) {
        const allStages = resp.data.result;
        const target = allStages.find(s => matchStage(s.name) === targetState);
        if (target) {
          await callOdooWithModelFallback(JOB_CARD_MODELS, 'write', [[jobCardId], { stage_id: target.id }], {}, headers);
          console.log('[MobileRepair] Stage transition via stage_id=' + target.id + ' succeeded');
          return true;
        }
      }
    }
  } catch {}

  throw new Error('Failed to move job card to ' + targetState);
};

// ---- Model Discovery via fields_get ----
// Discovers the actual Odoo model names for Many2one fields on job.card
let _discoveredRelatedModels = null;

export const discoverJobCardRelatedModelsOdoo = async () => {
  if (_discoveredRelatedModels) return _discoveredRelatedModels;
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'fields_get', [],
      { attributes: ['type', 'relation', 'string'] }, headers
    );
    if (!result) return null;

    const models = {};
    const fieldMap = {
      'device_brand_id': 'brand',
      'device_series_id': 'series',
      'device_model_id': 'model',
      'repair_team_id': 'team',
      'stage_id': 'stage',
      'assigned_to': 'user',
      'responsible_id': 'responsible',
    };

    for (const [field, key] of Object.entries(fieldMap)) {
      if (result[field] && result[field].relation) {
        models[key] = result[field].relation;
      }
    }
    console.log('[MobileRepair] Discovered related models:', JSON.stringify(models));
    _discoveredRelatedModels = models;
    return models;
  } catch (error) {
    console.error('[MobileRepair] discoverModels error:', error?.message || error);
    return null;
  }
};

// Helper: search_read on a discovered model with fallback names
// Uses kwargs-based domain (matching the working fetchProductsOdoo pattern)
const fetchFromDiscoveredModel = async (discoveredKey, fallbackModels, domain, fields, limit, order) => {
  const headers = await ensureOdooSession();
  const discovered = await discoverJobCardRelatedModelsOdoo();
  const modelNames = discovered?.[discoveredKey]
    ? [discovered[discoveredKey], ...fallbackModels]
    : fallbackModels;
  console.log(`[MobileRepair] Fetching ${discoveredKey} from models:`, modelNames);
  let lastError = null;
  for (const model of modelNames) {
    try {
      const resp = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0', method: 'call',
          params: {
            model, method: 'search_read',
            args: [],
            kwargs: { domain, fields, limit, order },
          },
        },
        { headers, timeout: reqTimeout }
      );
      if (resp.data.error) { lastError = resp.data.error; console.warn(`[MobileRepair] Model ${model} failed:`, resp.data.error?.data?.message || 'error'); continue; }
      console.log(`[MobileRepair] Model ${model} succeeded, got ${(resp.data.result || []).length} records`);
      return resp.data.result || [];
    } catch (e) { lastError = e; console.warn(`[MobileRepair] Model ${model} exception:`, e.message); continue; }
  }
  throw lastError || new Error(`All model names failed for ${discoveredKey}`);
};

export const fetchDeviceBrandsOdoo = async ({ limit = 100 } = {}) => {
  try {
    const result = await fetchFromDiscoveredModel(
      'brand', ['device.brand', 'mobile.brand', 'mobile.repair.brand', 'mobile.repair.device.brand'],
      [], ['id', 'name'], limit, 'name asc'
    );
    console.log(`[MobileRepair] Brands fetched: ${result.length}`);
    return result.map(b => ({ id: b.id, name: b.name || '' }));
  } catch (error) {
    console.error('[MobileRepair] fetchDeviceBrandsOdoo error:', error?.message || error);
    return [];
  }
};

export const fetchDeviceSeriesOdoo = async ({ brandId, limit = 100 } = {}) => {
  try {
    // Try multiple domain field names for brand filter
    const domains = brandId
      ? [['brand_id', '=', brandId]]
      : [];
    const result = await fetchFromDiscoveredModel(
      'series', ['device.series', 'mobile.series', 'mobile.repair.series', 'mobile.repair.device.series'],
      domains, ['id', 'name'], limit, 'name asc'
    );
    console.log(`[MobileRepair] Series fetched: ${result.length}`);
    return result.map(s => ({ id: s.id, name: s.name || '' }));
  } catch (error) {
    console.error('[MobileRepair] fetchDeviceSeriesOdoo error:', error?.message || error);
    // If domain field name is wrong, retry without filter
    if (brandId) {
      try {
        const result = await fetchFromDiscoveredModel(
          'series', ['device.series', 'mobile.series', 'mobile.repair.series', 'mobile.repair.device.series'],
          [], ['id', 'name'], limit, 'name asc'
        );
        return result.map(s => ({ id: s.id, name: s.name || '' }));
      } catch { return []; }
    }
    return [];
  }
};

export const fetchDeviceModelsOdoo = async ({ seriesId, limit = 100 } = {}) => {
  try {
    const domains = seriesId
      ? [['series_id', '=', seriesId]]
      : [];
    const result = await fetchFromDiscoveredModel(
      'model', ['device.model', 'mobile.model', 'mobile.repair.model', 'mobile.repair.device.model'],
      domains, ['id', 'name'], limit, 'name asc'
    );
    console.log(`[MobileRepair] Models fetched: ${result.length}`);
    return result.map(m => ({ id: m.id, name: m.name || '' }));
  } catch (error) {
    console.error('[MobileRepair] fetchDeviceModelsOdoo error:', error?.message || error);
    // If domain field name is wrong, retry without filter
    if (seriesId) {
      try {
        const result = await fetchFromDiscoveredModel(
          'model', ['device.model', 'mobile.model', 'mobile.repair.model', 'mobile.repair.device.model'],
          [], ['id', 'name'], limit, 'name asc'
        );
        return result.map(m => ({ id: m.id, name: m.name || '' }));
      } catch { return []; }
    }
    return [];
  }
};

export const fetchRepairTeamsOdoo = async ({ limit = 50 } = {}) => {
  try {
    const result = await fetchFromDiscoveredModel(
      'team', ['repair.team', 'mobile.repair.team', 'mobile.repair.repair.team'],
      [], ['id', 'name'], limit, 'name asc'
    );
    console.log(`[MobileRepair] Repair teams fetched: ${result.length}`);
    return result.map(t => ({ id: t.id, name: t.name || '' }));
  } catch (error) {
    console.error('[MobileRepair] fetchRepairTeamsOdoo error:', error?.message || error);
    return [];
  }
};

export const fetchCustomersForRepairOdoo = async ({ searchText = '', limit = 100 } = {}) => {
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (searchText) domain = [['name', 'ilike', searchText]];
    const resp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'res.partner', method: 'search_read',
          args: [],
          kwargs: { domain, fields: ['id', 'name', 'phone', 'email'], limit, order: 'name asc' },
        },
      },
      { headers }
    );
    if (resp.data.error) {
      console.error('[MobileRepair] fetchCustomersForRepairOdoo error:', resp.data.error?.data?.message || resp.data.error);
      return [];
    }
    console.log(`[MobileRepair] Customers fetched: ${(resp.data.result || []).length}`);
    return (resp.data.result || []).map(p => ({ id: p.id, name: p.name || '', phone: p.phone || '', email: p.email || '' }));
  } catch (error) {
    console.error('[MobileRepair] fetchCustomersForRepairOdoo error:', error?.message || error);
    return [];
  }
};

// Job Card Action Methods (stage transitions) — all use moveJobCardToNextStageOdoo
export const jobCardCreateQuotationOdoo = async (jobCardId) => {
  return moveJobCardToNextStageOdoo(jobCardId, 'quotation');
};

export const jobCardStartRepairOdoo = async (jobCardId) => {
  return moveJobCardToNextStageOdoo(jobCardId, 'repair');
};

export const jobCardCreateInvoiceOdoo = async (jobCardId) => {
  // Invoice creation is a special action, try dedicated methods
  const headers = await ensureOdooSession();
  for (const method of ['action_create_invoice', 'action_invoice']) {
    try {
      await callOdooWithModelFallback(JOB_CARD_MODELS, method, [[jobCardId]], {}, headers);
      return true;
    } catch { continue; }
  }
  throw new Error('Invoice creation not available');
};

export const jobCardCancelOdoo = async (jobCardId) => {
  return moveJobCardToNextStageOdoo(jobCardId, 'cancelled');
};

export const jobCardMarkCompletedOdoo = async (jobCardId) => {
  return moveJobCardToNextStageOdoo(jobCardId, 'completed');
};

// ---- Generate Steps from Diagnosis ----
export const generateStepsFromDiagnosisOdoo = async (jobCardId) => {
  try {
    const headers = await ensureOdooSession();

    // 1. Try Odoo's built-in method first
    try {
      const { result } = await callOdooWithModelFallback(
        JOB_CARD_MODELS, 'action_generate_repair_steps', [[jobCardId]], {}, headers, 60000
      );
      console.log('[GenerateSteps] Odoo method succeeded');
      return result || true;
    } catch (odooErr) {
      console.log('[GenerateSteps] Odoo method failed, parsing AI report instead:', odooErr?.data?.message || '');
    }

    // 2. Fallback: parse AI diagnosis report and create steps manually
    const { result: jcData } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'read', [[jobCardId]], { fields: ['ai_diagnosis'] }, headers
    );
    const html = jcData?.[0]?.ai_diagnosis || '';
    if (!html) throw new Error('No AI diagnosis report found. Run AI Diagnosis first.');

    // Parse "Repair Plan" section from the HTML
    const repairPlanMatch = html.match(/Repair Plan[\s\S]*?<ol>([\s\S]*?)<\/ol>/i);
    if (!repairPlanMatch) throw new Error('No Repair Plan found in diagnosis report. Run AI Diagnosis first.');

    const liItems = repairPlanMatch[1].match(/<li>([\s\S]*?)<\/li>/gi) || [];
    if (liItems.length === 0) throw new Error('No steps found in Repair Plan.');

    const steps = liItems.map((li, idx) => {
      const text = li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // Extract title: text before first "("
      const titleMatch = text.match(/^(.+?)\s*\(\d+/);
      const title = titleMatch ? titleMatch[1].trim() : text.substring(0, 60);
      // Extract minutes: "(5 min"
      const minMatch = text.match(/\((\d+)\s*min/i);
      const minutes = minMatch ? parseInt(minMatch[1]) : 10;
      // Extract difficulty: "easy/medium/hard/expert"
      const diffMatch = text.match(/\b(easy|medium|hard|expert)\b/i);
      const difficulty = diffMatch ? diffMatch[1].toLowerCase() : 'medium';
      // Instructions: everything after the title/duration part
      const instrStart = text.indexOf(')');
      const instruction = instrStart > 0 ? text.substring(instrStart + 1).trim() : '';

      return {
        job_card_id: jobCardId,
        sequence: (idx + 1) * 10,
        name: title,
        instruction: instruction ? `<p>${instruction}</p>` : '',
        difficulty,
        estimated_minutes: minutes,
        source: 'ai',
        status: 'pending',
      };
    });

    console.log('[GenerateSteps] Parsed', steps.length, 'steps from AI report');

    // 3. Create repair.step records
    for (const step of steps) {
      await callOdooWithModelFallback(['repair.step'], 'create', [step], {}, headers);
    }
    console.log('[GenerateSteps] Created', steps.length, 'repair steps');
    return true;
  } catch (error) {
    console.error('generateStepsFromDiagnosisOdoo error:', error?.message || error);
    throw new Error(error?.message || 'Failed to generate steps');
  }
};

// ---- Service Lines (one2many on job.card) ----
export const fetchServiceLinesOdoo = async (jobCardId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      ['job.card.service.line'], 'search_read', [],
      { domain: [['job_card_id', '=', jobCardId]], fields: ['product_id', 'description', 'quantity', 'uom_id', 'unit_price', 'tax_ids', 'subtotal', 'tax_amount', 'sequence'], order: 'sequence asc', limit: 50 }, headers
    );
    return (result || []).map(r => ({
      id: r.id,
      service: Array.isArray(r.product_id) ? r.product_id[1] : (r.product_id || ''),
      service_id: Array.isArray(r.product_id) ? r.product_id[0] : r.product_id,
      description: r.description || '',
      quantity: r.quantity || 0,
      uom: Array.isArray(r.uom_id) ? r.uom_id[1] : '',
      unit_price: r.unit_price || 0,
      subtotal: r.subtotal || 0,
      tax_amount: r.tax_amount || 0,
    }));
  } catch (error) {
    console.error('fetchServiceLinesOdoo error:', error?.message || error);
    return [];
  }
};

export const addServiceLineOdoo = async (jobCardId, { productId, description, quantity, unitPrice }) => {
  try {
    const headers = await ensureOdooSession();
    const vals = {
      job_card_id: jobCardId,
      product_id: productId || false,
      description: description || '',
      quantity: quantity || 1,
      unit_price: unitPrice || 0,
    };
    const { result } = await callOdooWithModelFallback(['job.card.service.line'], 'create', [vals], {}, headers);
    return result;
  } catch (error) {
    console.error('addServiceLineOdoo error:', error?.message || error);
    throw new Error(error?.data?.message || error?.message || 'Failed to add service line');
  }
};

export const deleteServiceLineOdoo = async (lineId) => {
  try {
    const headers = await ensureOdooSession();
    await callOdooWithModelFallback(['job.card.service.line'], 'unlink', [[lineId]], {}, headers);
    return true;
  } catch (error) {
    console.error('deleteServiceLineOdoo error:', error?.message || error);
    throw new Error(error?.data?.message || error?.message || 'Failed to delete service line');
  }
};

// ---- Diagnosis Results (One2many on job.card) ----
export const fetchDiagnosisResultsOdoo = async (jobCardId) => {
  try {
    const headers = await ensureOdooSession();
    // These are diagnosis_line_ids on the job card — fetch via diagnosis model
    const { result } = await callOdooWithModelFallback(
      DIAGNOSIS_MODELS, 'search_read', [],
      { domain: [['job_card_id', '=', jobCardId]], fields: [], limit: 50, order: 'id asc' }, headers
    );
    const records = result || [];
    console.log('[DiagResults] Fetched:', records.length, 'for job card:', jobCardId);
    if (records.length > 0) {
      console.log('[DiagResults] Sample keys:', Object.keys(records[0]).join(', '));
      // Dump first record raw values so we can see the correct field names
      const r0 = records[0];
      console.log('[DiagResults] RAW FIRST RECORD:', JSON.stringify(r0, null, 2));
    }
    return records.map(r => ({
      id: r.id,
      test_name: r.test_name || r.name || '',
      category: Array.isArray(r.category_id) ? r.category_id[1] : (r.category || ''),
      symptom_tested: Array.isArray(r.symptom_id) ? r.symptom_id[1] : (r.symptom_tested || ''),
      result: r.result || r.test_result || 'not_tested',
      ai_confidence: r.ai_confidence || r.confidence || r.confidence_score || r.ai_confidence_score || 0,
      root_cause: Array.isArray(r.root_cause_id) ? r.root_cause_id[1] : (r.root_cause || ''),
    }));
  } catch (error) {
    console.error('fetchDiagnosisResultsOdoo error:', error?.message || error);
    return [];
  }
};

// Update diagnosis result (pass / fail / not_tested)
export const updateDiagnosisResultOdoo = async (diagId, result) => {
  try {
    const headers = await ensureOdooSession();
    await callOdooWithModelFallback(
      DIAGNOSIS_MODELS, 'write', [[diagId], { result }], {}, headers
    );
    return true;
  } catch (error) {
    console.error('updateDiagnosisResultOdoo error:', error?.message || error);
    throw error;
  }
};

// Delete a diagnosis record
export const deleteDiagnosisOdoo = async (diagId) => {
  try {
    const headers = await ensureOdooSession();
    await callOdooWithModelFallback(
      DIAGNOSIS_MODELS, 'unlink', [[diagId]], {}, headers
    );
    return true;
  } catch (error) {
    console.error('deleteDiagnosisOdoo error:', error?.message || error);
    throw error;
  }
};

// ---- AI Suggested Spare Parts ----
const SUGGESTED_PARTS_MODELS = ['ai.suggested.part', 'job.card.suggested.part', 'repair.suggested.part', 'ai.spare.part.suggestion'];

export const fetchAISuggestedPartsOdoo = async (jobCardId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      SUGGESTED_PARTS_MODELS, 'search_read', [],
      { domain: [['job_card_id', '=', jobCardId]], fields: [], limit: 50, order: 'id asc' }, headers
    );
    const records = result || [];
    console.log('[SuggestedParts] Fetched:', records.length);
    if (records.length > 0) console.log('[SuggestedParts] Sample keys:', Object.keys(records[0]).join(', '));
    return records.map(r => ({
      id: r.id,
      part_name: r.ai_part_name || r.name || r.part_name || '',
      quantity: r.quantity || r.qty || 1,
      estimated_cost: r.estimated_cost || r.cost || 0,
      matched_product: Array.isArray(r.matched_product_id) ? r.matched_product_id[1] : (r.matched_product || ''),
      status: r.status || r.state || '',
      in_stock: r.in_stock || false,
      stock_status: r.stock_status || '',
    }));
  } catch (error) {
    console.error('fetchAISuggestedPartsOdoo error:', error?.message || error);
    return [];
  }
};

// ---- Diagnosis & Repair Steps Counts for Job Card ----
export const fetchJobCardCountsOdoo = async (jobCardId) => {
  try {
    const headers = await ensureOdooSession();
    let diagCount = 0;
    let stepsCount = 0;
    try {
      const { result: d } = await callOdooWithModelFallback(
        DIAGNOSIS_MODELS, 'search_count', [], { domain: [['job_card_id', '=', jobCardId]] }, headers
      );
      diagCount = d || 0;
    } catch (e) { /* model may not exist */ }
    try {
      const { result: s } = await callOdooWithModelFallback(
        REPAIR_STEP_MODELS, 'search_count', [], { domain: [['job_card_id', '=', jobCardId]] }, headers
      );
      stepsCount = s || 0;
    } catch (e) { /* model may not exist */ }
    return { diagnosisCount: diagCount, repairStepsCount: stepsCount };
  } catch (error) {
    return { diagnosisCount: 0, repairStepsCount: 0 };
  }
};

// AI Diagnosis
export const fetchJobCardSymptomsOdoo = async () => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      ['repair.symptom', 'mobile.repair.symptom', 'job.card.symptom'], 'search_read', [],
      { domain: [], fields: ['id', 'name'], limit: 100, order: 'name asc' }, headers
    );
    return (result || []).map(s => ({ id: s.id, name: s.name || '' }));
  } catch (error) { return []; }
};

export const runAIDiagnosisOdoo = async (jobCardId, options = {}) => {
  try {
    const headers = await ensureOdooSession();
    const {
      reportedProblem = '',
      symptomIds = [],
      searchForums = true,
      useAI = true,
      useKnowledgeBase = true,
    } = options;

    // Step 1: Create repair.diagnosis.wizard record
    const wizardVals = {
      job_card_id: jobCardId,
      reported_problem: reportedProblem || '-',
      search_forums: searchForums,
      use_ai: useAI,
      use_knowledge_base: useKnowledgeBase,
    };
    if (symptomIds.length > 0) {
      wizardVals.symptom_ids = [[6, 0, symptomIds]];
    }
    console.log('[AIDiagnosis] Creating wizard with:', JSON.stringify(wizardVals));
    const { result: wizardId } = await callOdooWithModelFallback(['repair.diagnosis.wizard'], 'create', [wizardVals], {}, headers);
    console.log('[AIDiagnosis] Wizard created, ID:', wizardId);

    // Step 2: Call action_run_diagnosis on the wizard
    console.log('[AIDiagnosis] Running action_run_diagnosis...');
    await callOdooWithModelFallback(['repair.diagnosis.wizard'], 'action_run_diagnosis', [[wizardId]], {}, headers, 120000);

    // Step 3: Read back result_text from the wizard
    const { result: wizData } = await callOdooWithModelFallback(['repair.diagnosis.wizard'], 'read', [[wizardId], ['result_text', 'state']], {}, headers);
    const resultHtml = wizData?.[0]?.result_text || '';
    console.log('[AIDiagnosis] Wizard state:', wizData?.[0]?.state, '| result_text length:', resultHtml.length);

    // Step 4: Auto-generate repair steps from the diagnosis
    try {
      await callOdooWithModelFallback(JOB_CARD_MODELS, 'action_generate_repair_steps', [[jobCardId]], {}, headers, 60000);
      console.log('[AIDiagnosis] Repair steps generated');
    } catch (e) {
      console.log('[AIDiagnosis] Generate steps skipped:', e?.data?.message || e?.message || '');
    }

    if (resultHtml) {
      return stripOdooHtml(resultHtml);
    }

    // Fallback: read ai_diagnosis from the job card
    const { result: jcData } = await callOdooWithModelFallback(
      JOB_CARD_MODELS, 'read', [[jobCardId]], { fields: ['ai_diagnosis'] }, headers
    );
    const report = jcData?.[0]?.ai_diagnosis || '';
    return stripOdooHtml(report) || 'AI Diagnosis completed but no report text was returned.';
  } catch (error) {
    console.error('[AIDiagnosis] Error:', error?.data?.message || error?.message || error);
    throw new Error(error?.data?.message || error?.message || 'AI Diagnosis failed');
  }
};

// ---- Vinafix Forum Search ----
const VINAFIX_BASE = 'https://vinafix.com';
const VINAFIX_USER = 'SHINIL';
const VINAFIX_PASS = '@BIOS@';
const VINAFIX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let _vinafixCookies = null;
let _vinafixLoginAttempt = 0;

const _extractCookies = (resp) => {
  // React Native may return set-cookie in different formats
  const raw = resp.headers['set-cookie'] || resp.headers['Set-Cookie'] || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.filter(Boolean).map(c => c.split(';')[0]);
};

const _mergeCookies = (existing, newOnes) => {
  const map = {};
  [...existing, ...newOnes].forEach(c => {
    const eq = c.indexOf('=');
    if (eq > 0) map[c.substring(0, eq).trim()] = c;
  });
  return Object.values(map).join('; ');
};

const _vinafixLogin = async () => {
  _vinafixLoginAttempt++;
  console.log(`[Vinafix] Login attempt #${_vinafixLoginAttempt}...`);
  try {
    // 1. GET login page → CSRF token + cookies
    const loginPage = await axios.get(`${VINAFIX_BASE}/login/`, {
      timeout: 15000,
      headers: { 'User-Agent': VINAFIX_UA, 'Accept': 'text/html' },
    });

    const pageHtml = typeof loginPage.data === 'string' ? loginPage.data : '';
    console.log('[Vinafix] Login page size:', pageHtml.length);

    // Try multiple CSRF token patterns
    let xfToken = '';
    const patterns = [
      /name="_xfToken"\s+value="([^"]+)"/,
      /data-csrf="([^"]+)"/,
      /"csrf"\s*:\s*"([^"]+)"/,
      /_xfToken['"]\s*(?:value|:)\s*['"]\s*([^'"]+)/,
    ];
    for (const p of patterns) {
      const m = pageHtml.match(p);
      if (m) { xfToken = m[1]; break; }
    }
    console.log('[Vinafix] CSRF token:', xfToken ? `${xfToken.substring(0, 20)}...` : 'NOT FOUND');

    let cookieParts = _extractCookies(loginPage);
    console.log('[Vinafix] Login page cookies:', cookieParts.length, cookieParts.map(c => c.split('=')[0]).join(', '));

    // 2. POST login
    const formData = `login=${encodeURIComponent(VINAFIX_USER)}&password=${encodeURIComponent(VINAFIX_PASS)}&_xfToken=${encodeURIComponent(xfToken)}&remember=1&_xfRedirect=${encodeURIComponent('/')}`;
    console.log('[Vinafix] Posting login...');

    const loginResp = await axios.post(`${VINAFIX_BASE}/login/login`, formData, {
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieParts.join('; '),
        'User-Agent': VINAFIX_UA,
        'Referer': `${VINAFIX_BASE}/login/`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    console.log('[Vinafix] Login response status:', loginResp.status);
    const newCookies = _extractCookies(loginResp);
    console.log('[Vinafix] Login response cookies:', newCookies.length, newCookies.map(c => c.split('=')[0]).join(', '));

    const allCookies = _mergeCookies(cookieParts, newCookies);
    _vinafixCookies = allCookies;

    // Check if login succeeded (xf_user cookie should be present)
    const hasUserCookie = allCookies.includes('xf_user');
    console.log('[Vinafix] Login', hasUserCookie ? 'SUCCESSFUL (xf_user cookie found)' : 'may have failed (no xf_user cookie)');

    // If login resp is HTML, check for error messages
    if (typeof loginResp.data === 'string' && loginResp.data.includes('Incorrect password')) {
      throw new Error('Incorrect username or password');
    }

    return allCookies;
  } catch (err) {
    console.error('[Vinafix] Login failed:', err?.message, 'Status:', err?.response?.status);
    _vinafixCookies = null;
    throw new Error('Vinafix login failed: ' + (err?.message || 'Unknown error'));
  }
};

export const searchVinafixForums = async (query) => {
  try {
    if (!query) return [];
    console.log('[Vinafix] Searching for:', query);

    // Login if no session
    if (!_vinafixCookies) await _vinafixLogin();

    // 1. GET search page for CSRF token
    console.log('[Vinafix] Fetching search page...');
    const tokenPage = await axios.get(`${VINAFIX_BASE}/search/`, {
      timeout: 10000,
      headers: { 'Cookie': _vinafixCookies, 'User-Agent': VINAFIX_UA, 'Accept': 'text/html' },
    });

    const tokenHtml = typeof tokenPage.data === 'string' ? tokenPage.data : '';
    // Merge any new cookies
    const tokenCookies = _extractCookies(tokenPage);
    if (tokenCookies.length > 0) {
      _vinafixCookies = _mergeCookies(_vinafixCookies.split('; '), tokenCookies);
    }

    let xfToken = '';
    const tokenMatch = tokenHtml.match(/name="_xfToken"\s+value="([^"]+)"/) ||
                        tokenHtml.match(/"csrf"\s*:\s*"([^"]+)"/) ||
                        tokenHtml.match(/data-csrf="([^"]+)"/);
    if (tokenMatch) xfToken = tokenMatch[1];
    console.log('[Vinafix] Search page token:', xfToken ? 'found' : 'NOT FOUND');

    // Check if we're logged in
    if (tokenHtml.includes('>Log in<') && !tokenHtml.includes(VINAFIX_USER)) {
      console.log('[Vinafix] Not logged in, re-authenticating...');
      _vinafixCookies = null;
      if (_vinafixLoginAttempt < 3) {
        await _vinafixLogin();
        return searchVinafixForums(query);
      }
      throw new Error('Login failed after retries');
    }

    // 2. POST search
    console.log('[Vinafix] Posting search...');
    const searchForm = `keywords=${encodeURIComponent(query)}&type=post&order=relevance&_xfToken=${encodeURIComponent(xfToken)}`;
    const searchResp = await axios.post(`${VINAFIX_BASE}/search/search`, searchForm, {
      timeout: 20000,
      maxRedirects: 5,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': _vinafixCookies,
        'User-Agent': VINAFIX_UA,
        'Referer': `${VINAFIX_BASE}/search/`,
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    const html = typeof searchResp.data === 'string' ? searchResp.data : '';
    console.log('[Vinafix] Search response status:', searchResp.status, 'size:', html.length);
    console.log('[Vinafix] Response URL:', searchResp.request?.responseURL || searchResp.config?.url || 'unknown');

    // Log a sample of the HTML to understand structure
    const sampleIdx = html.indexOf('contentRow');
    if (sampleIdx > -1) {
      console.log('[Vinafix] Found contentRow at index', sampleIdx);
      console.log('[Vinafix] HTML sample:', html.substring(sampleIdx, sampleIdx + 500));
    } else {
      // Try other XenForo patterns
      const altPatterns = ['search-result', 'listPlain', 'block-body', 'js-searchResult', 'data-content-type'];
      for (const pat of altPatterns) {
        const idx = html.indexOf(pat);
        if (idx > -1) {
          console.log(`[Vinafix] Found "${pat}" at index ${idx}`);
          console.log('[Vinafix] HTML sample:', html.substring(Math.max(0, idx - 100), idx + 400));
          break;
        }
      }
      if (!altPatterns.some(p => html.includes(p))) {
        // Log first 1000 chars to see what we actually got
        console.log('[Vinafix] No results patterns found. First 1000 chars:', html.substring(0, 1000));
      }
    }

    // 3. Parse search results — try multiple XenForo HTML patterns
    const results = [];

    // Pattern 1: contentRow-title with thread links
    if (html.includes('contentRow')) {
      const blocks = html.split(/contentRow-title/g);
      for (let i = 1; i < blocks.length && results.length < 10; i++) {
        const block = blocks[i];
        const linkMatch = block.match(/href="([^"]+)"[^>]*>([^<]+)/);
        const snippetMatch = block.match(/contentRow-snippet[^>]*>([\s\S]*?)<\/div/);
        if (linkMatch) {
          const rawUrl = linkMatch[1];
          const url = rawUrl.startsWith('http') ? rawUrl : `${VINAFIX_BASE}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
          const title = linkMatch[2].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').trim();
          const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
          if (title.length > 2) results.push({ title, url, snippet });
        }
      }
    }

    // Pattern 2: XenForo 2.x search results with data-content-type
    if (results.length === 0 && html.includes('data-content-type')) {
      const blocks = html.split(/data-content-type/g);
      for (let i = 1; i < blocks.length && results.length < 10; i++) {
        const block = blocks[i];
        const linkMatch = block.match(/href="([^"]+)"[^>]*class="[^"]*"[^>]*>([^<]+)/);
        if (linkMatch) {
          const rawUrl = linkMatch[1];
          const url = rawUrl.startsWith('http') ? rawUrl : `${VINAFIX_BASE}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
          const title = linkMatch[2].replace(/&#\d+;/g, '').replace(/&amp;/g, '&').trim();
          if (title.length > 2) results.push({ title, url, snippet: '' });
        }
      }
    }

    // Pattern 3: generic link extraction from search results area
    if (results.length === 0) {
      const threadLinks = html.match(/href="(\/threads\/[^"]+)"[^>]*>([^<]{3,})/g) || [];
      const seen = new Set();
      for (const m of threadLinks) {
        if (results.length >= 10) break;
        const parts = m.match(/href="([^"]+)"[^>]*>([^<]+)/);
        if (parts && !seen.has(parts[1])) {
          seen.add(parts[1]);
          const url = `${VINAFIX_BASE}${parts[1]}`;
          const title = parts[2].replace(/&#\d+;/g, '').replace(/&amp;/g, '&').trim();
          if (title.length > 2) results.push({ title, url, snippet: '' });
        }
      }
    }

    console.log('[Vinafix] Parsed results:', results.length);
    _vinafixLoginAttempt = 0; // reset on success
    return results;
  } catch (err) {
    console.error('[Vinafix] Search error:', err?.message);
    _vinafixCookies = null;
    throw new Error('Forum search failed: ' + (err?.message || 'Unknown error'));
  }
};

// ---- AI Estimate / Generate Estimate Wizard ----

// Open the estimate wizard for a job card — discovers wizard model, gets defaults
export const openEstimateWizardOdoo = async (jobCardId) => {
  const headers = await ensureOdooSession();

  // Step 1: Call action method on job.card to get the wizard action dict
  const actionMethods = ['action_generate_estimate', 'action_ai_estimate', 'action_estimate', 'generate_estimate'];
  let wizardAction = null;

  for (const method of actionMethods) {
    try {
      const { result } = await callOdooWithModelFallback(
        JOB_CARD_MODELS, method, [[jobCardId]], {}, headers
      );
      if (result && typeof result === 'object' && result.res_model) {
        wizardAction = result;
        console.log('[MobileRepair] Estimate wizard opened via ' + method + ', model=' + result.res_model);
        break;
      }
    } catch { continue; }
  }

  if (!wizardAction) throw new Error('Estimate wizard not available');

  const wizardModel = wizardAction.res_model;
  const context = wizardAction.context || {};

  // Step 2: Get default values from the wizard model
  let defaults = {};
  try {
    const defaultFields = [
      'job_card_id', 'estimated_hours', 'labor_rate', 'labor_cost',
      'parts_cost', 'total_estimated_cost', 'notes', 'part_line_ids',
    ];
    const resp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: {
        model: wizardModel, method: 'default_get',
        args: [defaultFields],
        kwargs: { context },
      }},
      { headers, timeout: reqTimeout }
    );
    if (!resp.data?.error && resp.data?.result) {
      defaults = resp.data.result;
    }
  } catch (e) {
    console.log('[MobileRepair] default_get failed:', e?.message);
  }

  // Step 3: Also try fields_get to discover field names
  let fieldInfo = {};
  try {
    const resp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      { jsonrpc: '2.0', method: 'call', params: {
        model: wizardModel, method: 'fields_get',
        args: [],
        kwargs: { attributes: ['type', 'string', 'relation'] },
      }},
      { headers, timeout: reqTimeout }
    );
    if (!resp.data?.error && resp.data?.result) {
      fieldInfo = resp.data.result;
    }
  } catch {}

  return { wizardModel, context, defaults, fieldInfo };
};

// Apply estimate — creates wizard record with data and calls apply action
export const applyEstimateOdoo = async (wizardModel, wizardData, context, createQuotation = false) => {
  const headers = await ensureOdooSession();

  // Create wizard record
  const createResp = await axios.post(
    `${ODOO_BASE_URL()}/web/dataset/call_kw`,
    { jsonrpc: '2.0', method: 'call', params: {
      model: wizardModel, method: 'create',
      args: [[wizardData]],
      kwargs: { context },
    }},
    { headers, timeout: reqTimeout }
  );

  if (createResp.data?.error) {
    throw new Error(createResp.data.error?.data?.message || 'Failed to create estimate');
  }
  const wizardId = Array.isArray(createResp.data?.result) ? createResp.data.result[0] : createResp.data?.result;

  // Call the appropriate action
  const applyMethods = createQuotation
    ? ['action_apply_and_create_quotation', 'action_apply_create_quotation', 'apply_and_create_quotation']
    : ['action_apply_estimate', 'action_apply', 'apply_estimate'];

  for (const method of applyMethods) {
    try {
      const resp = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        { jsonrpc: '2.0', method: 'call', params: {
          model: wizardModel, method,
          args: [[wizardId]],
          kwargs: {},
        }},
        { headers, timeout: reqTimeout }
      );
      if (!resp.data?.error) {
        console.log('[MobileRepair] Estimate applied via ' + method);
        return resp.data?.result;
      }
    } catch { continue; }
  }

  throw new Error('Failed to apply estimate');
};

// ============================================================
// ======  CUSTOMER VISIT & VISIT PLAN — Odoo Functions  ======
// ============================================================

const VISIT_MODELS = ['customer.visit'];
const VISIT_PLAN_MODELS = ['visit.plan'];
const VISIT_PURPOSE_MODELS = ['visit.purpose'];

// ---- Visit Purposes (dropdown) ----
export const fetchVisitPurposesOdoo = async () => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_PURPOSE_MODELS, 'search_read', [],
      { domain: [['active', '=', true]], fields: ['id', 'name'], order: 'name' }, headers
    );
    const mapped = (result || []).map(p => ({ id: p.id, name: p.name }));
    try { await AsyncStorage.setItem('@cache:visitPurposes', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (err) {
    console.error('fetchVisitPurposesOdoo error:', err?.message || err);
    // Offline fallback — return last cached purposes so the dropdown still works.
    try {
      const raw = await AsyncStorage.getItem('@cache:visitPurposes');
      if (raw) {
        const cached = JSON.parse(raw);
        console.log('[fetchVisitPurposes] OFFLINE — returning ' + cached.length + ' cached purposes');
        return cached;
      }
    } catch (_) {}
    return [];
  }
};

// ---- Employees (hr.employee) for dropdown ----
export const fetchEmployeesOdoo = async (searchText = '') => {
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (searchText) {
      domain = [['name', 'ilike', searchText]];
    }
    const { result } = await callOdooWithModelFallback(
      ['hr.employee'], 'search_read', [],
      { domain, fields: ['id', 'name', 'department_id', 'parent_id'], limit: 50, order: 'name' }, headers
    );
    const mapped = (result || []).map(e => ({
      id: e.id,
      name: e.name,
      department: Array.isArray(e.department_id) ? e.department_id[1] : '',
      manager_id: Array.isArray(e.parent_id) ? e.parent_id[0] : null,
      manager_name: Array.isArray(e.parent_id) ? e.parent_id[1] : '',
    }));
    // Cache only the unfiltered list (the offline picker can search locally).
    if (!searchText) {
      try { await AsyncStorage.setItem('@cache:employees', JSON.stringify(mapped)); } catch (_) {}
    }
    return mapped;
  } catch (err) {
    console.error('fetchEmployeesOdoo error:', err?.message || err);
    try {
      const raw = await AsyncStorage.getItem('@cache:employees');
      if (raw) {
        const cached = JSON.parse(raw);
        console.log('[fetchEmployees] OFFLINE — returning ' + cached.length + ' cached employees');
        // Apply local filter if a searchText was passed
        if (searchText) {
          const q = String(searchText).toLowerCase();
          return cached.filter((e) => (e.name || '').toLowerCase().includes(q));
        }
        return cached;
      }
    } catch (_) {}
    return [];
  }
};

// ---- Customer Visits ----
// `customerIds` / `employeeIds` accept arrays (multi-select). The legacy single
// `customerId` / `employeeId` keys are still honored (each gets folded into
// the corresponding array) so existing callers keep working.
export const fetchCustomerVisitsOdoo = async ({
  offset = 0, limit = 30, fromDate, toDate, customerId, employeeId,
  customerIds, employeeIds,
} = {}) => {
  const _customerIds = Array.isArray(customerIds) ? customerIds.filter(Boolean)
    : (customerId ? [customerId] : []);
  const _employeeIds = Array.isArray(employeeIds) ? employeeIds.filter(Boolean)
    : (employeeId ? [employeeId] : []);
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (fromDate) domain.push(['date_time', '>=', `${fromDate} 00:00:00`]);
    if (toDate) domain.push(['date_time', '<=', `${toDate} 23:59:59`]);
    if (_customerIds.length === 1) domain.push(['partner_id', '=', _customerIds[0]]);
    else if (_customerIds.length > 1) domain.push(['partner_id', 'in', _customerIds]);
    if (_employeeIds.length === 1) domain.push(['employee_id', '=', _employeeIds[0]]);
    else if (_employeeIds.length > 1) domain.push(['employee_id', 'in', _employeeIds]);
    console.log('[fetchCustomerVisits] domain=' + JSON.stringify(domain) +
                ' offset=' + offset + ' limit=' + limit);

    const { result } = await callOdooWithModelFallback(
      VISIT_MODELS, 'search_read', [],
      {
        domain,
        fields: ['id', 'name', 'partner_id', 'employee_id', 'date_time', 'purpose_id',
          'visit_duration', 'remarks', 'latitude', 'longitude', 'location_name',
          'visit_plan_id', 'state'],
        offset, limit, order: 'date_time desc, id desc'
      }, headers
    );
    console.log('[fetchCustomerVisits] returned ' + (result?.length || 0) + ' records');
    if (Array.isArray(result) && result.length > 0) {
      console.log('[fetchCustomerVisits] first record id=' + result[0].id +
                  ' date=' + result[0].date_time +
                  ' partner=' + JSON.stringify(result[0].partner_id));
    }
    const mapped = (result || []).map(v => ({
      id: v.id,
      name: v.name,
      customer: Array.isArray(v.partner_id) ? { id: v.partner_id[0], name: v.partner_id[1] } : null,
      employee: Array.isArray(v.employee_id) ? { id: v.employee_id[0], name: v.employee_id[1] } : null,
      date_time: v.date_time,
      purpose: Array.isArray(v.purpose_id) ? { id: v.purpose_id[0], name: v.purpose_id[1] } : null,
      visit_duration: v.visit_duration,
      remarks: v.remarks,
      latitude: v.latitude,
      longitude: v.longitude,
      location_name: v.location_name,
      visit_plan_id: Array.isArray(v.visit_plan_id) ? v.visit_plan_id[0] : null,
      state: v.state,
    }));
    // Cache for offline fallback
    try { await AsyncStorage.setItem('@cache:customerVisits', JSON.stringify(mapped)); } catch (_) {}
    // Merge in any still-queued offline visits at the top
    return await _mergeOfflineCustomerVisits(mapped, { fromDate, toDate, _customerIds, _employeeIds });
  } catch (err) {
    console.error('fetchCustomerVisitsOdoo error:', err?.message || err);
    // Offline fallback — return last cached server records + still-pending offline rows.
    // Apply the same filters locally so the Filter modal works without internet.
    try {
      const raw = await AsyncStorage.getItem('@cache:customerVisits');
      const cached = raw ? JSON.parse(raw) : [];
      const filtered = _filterCustomerVisitsLocal(cached, { fromDate, toDate, _customerIds, _employeeIds });
      console.log('[fetchCustomerVisits] OFFLINE — cached=' + cached.length +
                  ' after-filter=' + filtered.length);
      return await _mergeOfflineCustomerVisits(filtered, { fromDate, toDate, _customerIds, _employeeIds });
    } catch (_) {
      return [];
    }
  }
};

// Apply the date / customer / employee filters to a cached visit list so
// offline filtering matches the online Odoo domain.
const _filterCustomerVisitsLocal = (rows, { fromDate, toDate, _customerIds, _employeeIds } = {}) => {
  if (!Array.isArray(rows)) return [];
  // Odoo `date_time` is "YYYY-MM-DD HH:MM:SS" UTC. We compare day-strings
  // against fromDate/toDate (which are already YYYY-MM-DD).
  const dayOf = (s) => (typeof s === 'string' ? s.slice(0, 10) : '');
  return rows.filter((r) => {
    if (fromDate && dayOf(r.date_time) < fromDate) return false;
    if (toDate && dayOf(r.date_time) > toDate) return false;
    if (_customerIds && _customerIds.length > 0) {
      const cid = r?.customer?.id;
      if (!cid || !_customerIds.includes(cid)) return false;
    }
    if (_employeeIds && _employeeIds.length > 0) {
      const eid = r?.employee?.id;
      if (!eid || !_employeeIds.includes(eid)) return false;
    }
    return true;
  });
};

// Merge any still-queued offline customer.visit creates into the list as
// pending rows (with offline: true). Drops cached pending rows whose queue
// item has already been removed (i.e. successfully synced).
const _mergeOfflineCustomerVisits = async (serverList, filterOpts = {}) => {
  try {
    const offlineQueue = require('@utils/offlineQueue').default;
    const queue = await offlineQueue.getAll();
    const pending = (queue || [])
      .filter(q => q.model === 'customer.visit' && q.operation === 'create')
      .map(q => ({
        id: 'offline_' + q.id,
        name: q.values?.offline_label || q.values?._offlineRef || 'OFF',
        offline_label: q.values?.offline_label || q.values?._offlineRef || null,
        customer: q.values?._customerName ? { id: q.values?.partner_id, name: q.values._customerName } : null,
        employee: q.values?._employeeName ? { id: q.values?.employee_id, name: q.values._employeeName } : null,
        date_time: q.values?.date_time,
        visit_duration: q.values?.visit_duration,
        remarks: q.values?.remarks,
        latitude: q.values?.latitude,
        longitude: q.values?.longitude,
        location_name: q.values?.location_name,
        state: q.values?.state || 'draft',
        offline: true,
        offlineQueueId: q.id,
      }));
    // Apply the same filter to the pending rows so offline filtering is
    // consistent across queued and synced records.
    const pendingFiltered = (filterOpts.fromDate || filterOpts.toDate
        || (filterOpts._customerIds && filterOpts._customerIds.length)
        || (filterOpts._employeeIds && filterOpts._employeeIds.length))
      ? _filterCustomerVisitsLocal(pending, filterOpts)
      : pending;

    // Merge in stored offline_labels for already-synced records so the OFF
    // reference stays visible alongside the real Odoo CV/YYYY/NNNNN reference.
    let labelMap = {};
    try {
      const raw = await AsyncStorage.getItem('@cache:offlineLabels:customerVisit');
      labelMap = raw ? JSON.parse(raw) : {};
    } catch (_) {}
    const decoratedServer = (serverList || []).map((v) => ({
      ...v,
      offline_label: labelMap[String(v.id)] || v.offline_label || null,
    }));
    return [...pendingFiltered, ...decoratedServer];
  } catch (e) {
    console.log('[fetchCustomerVisits] merge offline failed:', e?.message);
    return serverList || [];
  }
};

export const fetchCustomerVisitDetailsOdoo = async (visitId) => {
  // Offline-only id (the visit hasn't synced yet) — read straight from the queue.
  if (typeof visitId === 'string' && visitId.startsWith('offline_')) {
    try {
      const offlineQueue = require('@utils/offlineQueue').default;
      const localId = visitId.replace(/^offline_/, '');
      const queue = await offlineQueue.getAll();
      const item = queue.find(q => q.id === localId);
      if (item && item.values) {
        const v = item.values;
        return {
          id: visitId,
          name: 'PENDING SYNC',
          customer: v._customerName ? { id: v.partner_id, name: v._customerName } : null,
          employee: v._employeeName ? { id: v.employee_id, name: v._employeeName } : null,
          date_time: v.date_time,
          purpose: null,
          visit_duration: v.visit_duration,
          remarks: v.remarks,
          latitude: v.latitude,
          longitude: v.longitude,
          location_name: v.location_name,
          state: v.state || 'draft',
          images: [],
          voiceNoteBase64: v.voice_note || null,
          voiceNoteFilename: v.voice_note_filename || null,
          offline: true,
        };
      }
    } catch (e) { console.log('[visitDetails] offline lookup failed:', e?.message); }
    return null;
  }

  try {
    const headers = await ensureOdooSession();
    console.log('[visitDetails] fetching visit id=' + visitId);
    // CRITICAL: bin_size=False forces Odoo to return base64 for Binary fields
    // instead of just the file size as an int. Without this, voice_note comes
    // back as a number and the player shows "No voice note recorded".
    const { result } = await callOdooWithModelFallback(
      VISIT_MODELS, 'read', [[visitId]],
      {
        fields: ['id', 'name', 'partner_id', 'employee_id', 'date_time', 'purpose_id',
          'visit_duration', 'remarks', 'latitude', 'longitude', 'location_name',
          'visit_plan_id', 'state', 'image_ids', 'voice_note', 'voice_note_filename'],
        context: { bin_size: false },
      }, headers
    );
    const v = result?.[0];
    if (!v) {
      console.log('[visitDetails] no record found for id=' + visitId);
      return null;
    }
    console.log('[visitDetails] raw voice_note typeof=' + typeof v.voice_note +
                ' length=' + (typeof v.voice_note === 'string' ? v.voice_note.length : 'n/a') +
                ' value=' + (typeof v.voice_note === 'string' ? v.voice_note.slice(0, 30) + '...' : v.voice_note));
    console.log('[visitDetails] voice_note_filename=' + v.voice_note_filename);
    console.log('[visitDetails] image_ids=' + JSON.stringify(v.image_ids));

    // Fetch each linked image (base64) — also bin_size:false so we get base64.
    let images = [];
    if (Array.isArray(v.image_ids) && v.image_ids.length) {
      try {
        const { result: imgResult } = await callOdooWithModelFallback(
          ['customer.visit.image'], 'read', [v.image_ids],
          {
            fields: ['id', 'image', 'image_filename'],
            context: { bin_size: false },
          }, headers
        );
        images = (imgResult || []).map((row) => ({
          id: row.id,
          filename: row.image_filename || `image_${row.id}.jpg`,
          dataUri: row.image ? `data:image/jpeg;base64,${row.image}` : null,
        })).filter((r) => r.dataUri);
        console.log('[visitDetails] images fetched:', images.length);
      } catch (e) {
        console.log('[visitDetails] image fetch failed:', e?.message);
      }
    }

    // Voice note: even with bin_size:false at the top read, attachment-backed
    // Binary fields sometimes still come back as a number. Re-read from
    // ir.attachment as a defensive fallback, and ALSO pass bin_size:false so
    // the `datas` field actually returns base64 instead of int size.
    let voiceNoteBase64 = null;
    let voiceNoteFilename = v.voice_note_filename || null;
    if (typeof v.voice_note === 'string' && v.voice_note.length > 100) {
      voiceNoteBase64 = v.voice_note;
      console.log('[visitDetails] voice note from main read, length=' + v.voice_note.length);
    } else {
      console.log('[visitDetails] voice_note not in main read (typeof=' + typeof v.voice_note +
                  '), trying ir.attachment fallback');
      try {
        // Permissive search: model + id only, no res_field filter (some Odoo
        // versions don't set res_field on auto-created attachment-Binary
        // attachments). Also list mimetype + name so we can identify the
        // audio attachment among possibly many.
        const { result: attachRes } = await callOdooWithModelFallback(
          ['ir.attachment'], 'search_read',
          [[
            ['res_model', '=', 'customer.visit'],
            ['res_id', '=', v.id],
          ]],
          {
            fields: ['id', 'datas', 'name', 'mimetype', 'res_field'],
            limit: 20,
            context: { bin_size: false },
          },
          headers
        );
        console.log('[visitDetails] ir.attachment lookup result count:', attachRes?.length || 0);
        if (Array.isArray(attachRes) && attachRes.length > 0) {
          for (const a of attachRes) {
            console.log('  - attachment id=' + a.id + ' name=' + a.name +
                        ' mimetype=' + a.mimetype + ' res_field=' + a.res_field);
          }
          // Pick the audio attachment: prefer res_field='voice_note', else
          // anything with audio mime, else anything matching .m4a/.mp3 by name.
          const pickAudio = attachRes.find((a) => a.res_field === 'voice_note')
            || attachRes.find((a) => typeof a.mimetype === 'string' && a.mimetype.startsWith('audio'))
            || attachRes.find((a) => /\.(m4a|mp3|aac|wav|ogg|3gp|webm)$/i.test(a.name || ''));
          if (pickAudio) {
            console.log('[visitDetails] picked audio attachment id=' + pickAudio.id +
                        ' name=' + pickAudio.name);
            const datas = pickAudio.datas;
            console.log('[visitDetails] datas typeof=' + typeof datas +
                        ' length=' + (typeof datas === 'string' ? datas.length : 'n/a'));
            if (typeof datas === 'string' && datas.length > 100) {
              voiceNoteBase64 = datas;
              if (!voiceNoteFilename) voiceNoteFilename = pickAudio.name || null;
              console.log('[visitDetails] voice note recovered via ir.attachment, size:', datas.length);
            } else {
              console.log('[visitDetails] picked attachment had no usable datas');
            }
          } else {
            console.log('[visitDetails] no audio-shaped attachment found among', attachRes.length, 'attachments');
          }
        } else {
          console.log('[visitDetails] no attachments at all for visit', v.id, '— upload likely never happened');
        }
      } catch (e) {
        console.log('[visitDetails] voice attachment lookup failed:', e?.message);
      }
    }
    console.log('[visitDetails] FINAL voiceNoteBase64=' + (voiceNoteBase64 ? 'present (' + voiceNoteBase64.length + ' chars)' : 'NULL'));

    return {
      id: v.id,
      name: v.name,
      customer: Array.isArray(v.partner_id) ? { id: v.partner_id[0], name: v.partner_id[1] } : null,
      employee: Array.isArray(v.employee_id) ? { id: v.employee_id[0], name: v.employee_id[1] } : null,
      date_time: v.date_time,
      purpose: Array.isArray(v.purpose_id) ? { id: v.purpose_id[0], name: v.purpose_id[1] } : null,
      visit_duration: v.visit_duration,
      remarks: v.remarks,
      latitude: v.latitude,
      longitude: v.longitude,
      location_name: v.location_name,
      visit_plan_id: Array.isArray(v.visit_plan_id) ? v.visit_plan_id[0] : null,
      state: v.state,
      images,
      voiceNoteBase64,
      voiceNoteFilename,
    };
  } catch (err) {
    console.error('fetchCustomerVisitDetailsOdoo error:', err?.message || err);
    return null;
  }
};

export const createCustomerVisitOdoo = async (data) => {
  // Build vals once; same shape used both online (POST) and offline (queue).
  const vals = {
    partner_id: data.customerId,
    employee_id: data.employeeId,
    date_time: data.dateTime,
    purpose_id: data.purposeId || false,
    visit_duration: data.visitDuration || false,
    remarks: data.remarks || '',
    latitude: data.latitude || 0,
    longitude: data.longitude || 0,
    location_name: data.locationName || '',
    visit_plan_id: data.visitPlanId || false,
  };
  if (data.images && data.images.length > 0) {
    vals.image_ids = data.images.map((img, index) => [0, 0, {
      image: img.base64,
      image_filename: img.filename || `visit_image_${index + 1}.jpg`,
    }]);
  }
  if (data.voiceBase64) {
    vals.voice_note = data.voiceBase64;
    vals.voice_note_filename = data.voiceFilename || 'voice_note.m4a';
  }
  // Helper labels (denormalized) so the offline list row can render customer
  // / employee names without needing to look them up post-sync.
  if (data.customerName) vals._customerName = data.customerName;
  if (data.employeeName) vals._employeeName = data.employeeName;

  // Offline branch — generate OFFNNNNN label, enqueue + cache.
  const networkStatus = require('@utils/networkStatus').default;
  const online = await networkStatus.isOnline();
  if (!online) {
    try {
      // Same OFF<seq> pattern Easy Sales uses, with its own counter.
      const offLabel = await _nextOffLabel({
        counterKey: 'cv_off_counter',
        cacheKey: '@cache:customerVisits',
        scope: null,
      });
      vals.offline_label = offLabel;
      vals._offlineRef = offLabel;   // stash for the cached row + sync handler
      const offlineQueue = require('@utils/offlineQueue').default;
      const localId = await offlineQueue.enqueue({
        model: 'customer.visit',
        operation: 'create',
        values: vals,
      });
      console.log('[createCustomerVisit] OFFLINE queued localId=' + localId + ' label=' + offLabel);
      return { id: 'offline_' + localId, reference: offLabel, offline: true, offlineLabel: offLabel };
    } catch (e) {
      console.error('[createCustomerVisit] offline enqueue failed:', e?.message);
      throw e;
    }
  }

  // Online — strip the helper underscored fields before sending to Odoo
  // (Odoo would reject unknown _customerName / _employeeName keys).
  delete vals._customerName;
  delete vals._employeeName;

  try {
    const headers = await ensureOdooSession();
    if (data.voiceBase64) {
      console.log('[createCustomerVisit] sending voice_note, base64 length=' +
                  data.voiceBase64.length + ' filename=' + vals.voice_note_filename);
    } else {
      console.log('[createCustomerVisit] NO voice_note in payload (data.voiceBase64=' +
                  typeof data.voiceBase64 + ')');
    }
    // Compute serialized payload size for diagnosis (large payloads can hang
    // some proxies or hit Odoo's request body limit).
    let serialSize = 0;
    try { serialSize = JSON.stringify(vals).length; } catch (_) {}
    console.log('[createCustomerVisit] vals serialized size: ~' +
                Math.round(serialSize / 1024) + ' KB');
    console.log('[createCustomerVisit] >>> calling Odoo create RPC');
    const t0 = Date.now();
    const { result } = await callOdooWithModelFallback(
      VISIT_MODELS, 'create', [[vals]], {}, headers
    );
    console.log('[createCustomerVisit] <<< Odoo returned in ' + (Date.now() - t0) +
                'ms, result=' + JSON.stringify(result));
    // Odoo's create() with a single dict in args returns either a scalar id
    // or a 1-element array depending on the call shape. Unwrap to a scalar.
    const newId = Array.isArray(result) ? result[0] : result;

    // Fetch the auto-generated reference number (e.g. "CV/2026/00002") so the
    // calling screen can show it in a success toast and the list shows it
    // immediately without waiting for a separate refresh.
    let reference = null;
    try {
      const { result: readRes } = await callOdooWithModelFallback(
        VISIT_MODELS, 'read', [[newId]],
        { fields: ['id', 'name'] }, headers
      );
      if (Array.isArray(readRes) && readRes.length > 0) {
        reference = readRes[0]?.name || null;
      }
    } catch (e) {
      console.log('[createCustomerVisit] reference fetch failed:', e?.message);
    }
    console.log('[createCustomerVisit] returning id=' + newId + ' reference=' + reference);
    return { id: newId, reference };
  } catch (err) {
    console.error('createCustomerVisitOdoo error:', err?.message || err);
    throw err;
  }
};

export const updateCustomerVisitOdoo = async (visitId, data) => {
  try {
    const headers = await ensureOdooSession();
    const vals = {};
    if (data.customerId !== undefined) vals.partner_id = data.customerId;
    if (data.employeeId !== undefined) vals.employee_id = data.employeeId;
    if (data.dateTime !== undefined) vals.date_time = data.dateTime;
    if (data.purposeId !== undefined) vals.purpose_id = data.purposeId || false;
    if (data.visitDuration !== undefined) vals.visit_duration = data.visitDuration || false;
    if (data.remarks !== undefined) vals.remarks = data.remarks;
    if (data.latitude !== undefined) vals.latitude = data.latitude;
    if (data.longitude !== undefined) vals.longitude = data.longitude;
    if (data.locationName !== undefined) vals.location_name = data.locationName;
    if (data.contactPerson !== undefined) vals.contact_person = data.contactPerson;
    if (data.contactNumber !== undefined) vals.contact_number = data.contactNumber;
    if (data.timeIn !== undefined) vals.time_in = data.timeIn || false;
    if (data.timeOut !== undefined) vals.time_out = data.timeOut || false;
    if (data.state !== undefined) vals.state = data.state;

    const { result } = await callOdooWithModelFallback(
      VISIT_MODELS, 'write', [[visitId], vals], {}, headers
    );
    return result;
  } catch (err) {
    console.error('updateCustomerVisitOdoo error:', err?.message || err);
    throw err;
  }
};

// Helper: queue a customer.visit method call for later sync. Used when
// offline so the user can mark a visit Done / reset to Draft without internet.
// Also flips cached state in @cache:customerVisits and @cache:customerVisitDetail:<id>
// so the UI reflects the new state instantly without waiting for reconnect.
const _queueCustomerVisitMethod = async (visitId, method) => {
  const offlineQueue = require('@utils/offlineQueue').default;
  const targetId = (typeof visitId === 'string' && visitId.startsWith('offline_'))
    ? visitId   // pass through; sync handler will resolve via @sync:localToServer
    : visitId;
  const targetState = method === 'action_done' ? 'done'
                    : method === 'action_reset_to_draft' ? 'draft'
                    : null;

  const localId = await offlineQueue.enqueue({
    model: 'customer.visit',
    operation: 'method',
    values: { id: targetId, method },
  });

  if (targetState) {
    // 1) Flip state in list cache
    try {
      const raw = await AsyncStorage.getItem('@cache:customerVisits');
      if (raw) {
        const list = JSON.parse(raw) || [];
        const next = list.map(r => r.id === visitId ? { ...r, state: targetState } : r);
        await AsyncStorage.setItem('@cache:customerVisits', JSON.stringify(next));
      }
    } catch (_) {}
    // 2) Flip state in detail cache
    try {
      const dKey = `@cache:customerVisitDetail:${visitId}`;
      const draw = await AsyncStorage.getItem(dKey);
      if (draw) {
        const d = JSON.parse(draw) || {};
        d.state = targetState;
        await AsyncStorage.setItem(dKey, JSON.stringify(d));
      }
    } catch (_) {}
    // 3) Stamp state on a still-pending offline create so when its create
    //    eventually flushes to Odoo, the record carries the latest state.
    if (typeof visitId === 'string' && visitId.startsWith('offline_')) {
      try {
        const localCreateId = visitId.replace(/^offline_/, '');
        const items = await offlineQueue.getAll();
        const creator = items.find(it => String(it.id) === String(localCreateId)
          && it.model === 'customer.visit' && it.operation === 'create');
        if (creator) {
          await offlineQueue.updateValues(localCreateId, {
            ...creator.values,
            state: targetState,
          });
        }
      } catch (_) {}
    }
  }

  console.log('[customer.visit] OFFLINE queued ' + method + ' on visit=' + visitId
              + ' localId=' + localId + ' state→' + targetState);
  return { offline: true, localId, state: targetState };
};

export const markCustomerVisitAsDoneOdoo = async (visitId) => {
  const networkStatus = require('@utils/networkStatus').default;
  if (!(await networkStatus.isOnline())) {
    return await _queueCustomerVisitMethod(visitId, 'action_done');
  }
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_MODELS, 'write', [[visitId], { state: 'done' }], {}, headers
    );
    return result;
  } catch (err) {
    console.error('markCustomerVisitAsDoneOdoo error:', err?.message || err);
    throw err;
  }
};

export const resetCustomerVisitToDraftOdoo = async (visitId) => {
  const networkStatus = require('@utils/networkStatus').default;
  if (!(await networkStatus.isOnline())) {
    return await _queueCustomerVisitMethod(visitId, 'action_reset_to_draft');
  }
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_MODELS, 'write', [[visitId], { state: 'draft' }], {}, headers
    );
    return result;
  } catch (err) {
    console.error('resetCustomerVisitToDraftOdoo error:', err?.message || err);
    throw err;
  }
};

// ---- Visit Plans ----
export const fetchVisitPlansOdoo = async ({ offset = 0, limit = 30, date, employeeId, approvalStatus } = {}) => {
  try {
    const headers = await ensureOdooSession();
    let domain = [];
    if (date) {
      domain.push(['visit_date', '>=', `${date} 00:00:00`]);
      domain.push(['visit_date', '<=', `${date} 23:59:59`]);
    }
    if (employeeId) domain.push(['employee_id', '=', employeeId]);
    if (approvalStatus) domain.push(['approval_status', '=', approvalStatus]);

    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'search_read', [],
      {
        domain,
        fields: ['id', 'name', 'partner_id', 'employee_id', 'created_by_id', 'manager_id',
          'visit_date', 'purpose_id', 'remarks', 'approval_status', 'visit_status'],
        offset, limit, order: 'visit_date desc'
      }, headers
    );
    return (result || []).map(p => ({
      id: p.id,
      name: p.name,
      customer: Array.isArray(p.partner_id) ? { id: p.partner_id[0], name: p.partner_id[1] } : null,
      employee: Array.isArray(p.employee_id) ? { id: p.employee_id[0], name: p.employee_id[1] } : null,
      created_by: Array.isArray(p.created_by_id) ? { id: p.created_by_id[0], name: p.created_by_id[1] } : null,
      manager: Array.isArray(p.manager_id) ? { id: p.manager_id[0], name: p.manager_id[1] } : null,
      visit_date: p.visit_date,
      purpose: Array.isArray(p.purpose_id) ? { id: p.purpose_id[0], name: p.purpose_id[1] } : null,
      remarks: p.remarks,
      approval_status: p.approval_status,
      visit_status: p.visit_status,
    }));
  } catch (err) {
    console.error('fetchVisitPlansOdoo error:', err?.message || err);
    return [];
  }
};

export const fetchVisitPlanDetailsOdoo = async (planId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'read', [[planId]],
      { fields: ['id', 'name', 'partner_id', 'employee_id', 'created_by_id', 'manager_id',
        'visit_date', 'purpose_id', 'remarks', 'approval_status', 'visit_status'] }, headers
    );
    const p = result?.[0];
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      customer: Array.isArray(p.partner_id) ? { id: p.partner_id[0], name: p.partner_id[1] } : null,
      employee: Array.isArray(p.employee_id) ? { id: p.employee_id[0], name: p.employee_id[1] } : null,
      created_by: Array.isArray(p.created_by_id) ? { id: p.created_by_id[0], name: p.created_by_id[1] } : null,
      manager: Array.isArray(p.manager_id) ? { id: p.manager_id[0], name: p.manager_id[1] } : null,
      visit_date: p.visit_date,
      purpose: Array.isArray(p.purpose_id) ? { id: p.purpose_id[0], name: p.purpose_id[1] } : null,
      remarks: p.remarks,
      approval_status: p.approval_status,
      visit_status: p.visit_status,
    };
  } catch (err) {
    console.error('fetchVisitPlanDetailsOdoo error:', err?.message || err);
    return null;
  }
};

export const createVisitPlanOdoo = async (data) => {
  try {
    const headers = await ensureOdooSession();
    const vals = {
      partner_id: data.customerId,
      employee_id: data.employeeId,
      created_by_id: data.createdById || false,
      manager_id: data.managerId || false,
      visit_date: data.visitDate,
      purpose_id: data.purposeId || false,
      remarks: data.remarks || '',
    };
    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'create', [[vals]], {}, headers
    );
    return result;
  } catch (err) {
    console.error('createVisitPlanOdoo error:', err?.message || err);
    throw err;
  }
};

export const updateVisitPlanOdoo = async (planId, data) => {
  try {
    const headers = await ensureOdooSession();
    const vals = {};
    if (data.customerId !== undefined) vals.partner_id = data.customerId;
    if (data.employeeId !== undefined) vals.employee_id = data.employeeId;
    if (data.visitDate !== undefined) vals.visit_date = data.visitDate;
    if (data.purposeId !== undefined) vals.purpose_id = data.purposeId || false;
    if (data.remarks !== undefined) vals.remarks = data.remarks;
    if (data.approvalStatus !== undefined) vals.approval_status = data.approvalStatus;
    if (data.visitStatus !== undefined) vals.visit_status = data.visitStatus;

    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'write', [[planId], vals], {}, headers
    );
    return result;
  } catch (err) {
    console.error('updateVisitPlanOdoo error:', err?.message || err);
    throw err;
  }
};

export const sendVisitPlansForApprovalOdoo = async (planIds) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'write', [planIds, { approval_status: 'pending' }], {}, headers
    );
    return result;
  } catch (err) {
    console.error('sendVisitPlansForApprovalOdoo error:', err?.message || err);
    throw err;
  }
};

export const approveVisitPlanOdoo = async (planId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'write', [[planId], { approval_status: 'approved' }], {}, headers
    );
    return result;
  } catch (err) {
    console.error('approveVisitPlanOdoo error:', err?.message || err);
    throw err;
  }
};

export const rejectVisitPlanOdoo = async (planId) => {
  try {
    const headers = await ensureOdooSession();
    const { result } = await callOdooWithModelFallback(
      VISIT_PLAN_MODELS, 'write', [[planId], { approval_status: 'rejected' }], {}, headers
    );
    return result;
  } catch (err) {
    console.error('rejectVisitPlanOdoo error:', err?.message || err);
    throw err;
  }
};

// =============================================
// ESTIMATE PURCHASE — estimate.purchase model
// =============================================

export const fetchEstimatePurchasesOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = searchText
      ? ['|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]]
      : [];

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'date', 'partner_id', 'company_id', 'currency_id', 'warehouse_id',
                     'payment_method_id', 'state', 'amount_total', 'payment_state', 'reference'],
            offset, limit, order: 'date desc, id desc',
          },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('[EstimatePurchase] list error:', response.data.error?.data?.message || response.data.error);
      return [];
    }
    return response.data.result || [];
  } catch (error) {
    console.error('[EstimatePurchase] fetchList error:', error?.message || error);
    return [];
  }
};

export const fetchEstimatePurchaseDetailOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    // Fetch main record
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase',
          method: 'read',
          args: [[id]],
          kwargs: {
            fields: ['id', 'name', 'date', 'partner_id', 'company_id', 'currency_id', 'warehouse_id',
                     'payment_method_id', 'payment_term_id', 'state', 'amount_total', 'payment_state',
                     'reference', 'notes', 'line_ids', 'purchase_order_id', 'picking_id', 'invoice_id',
                     'is_credit_purchase', 'auto_validate_bill', 'auto_register_payment'],
          },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Odoo error');
    const records = response.data.result || [];
    if (records.length === 0) throw new Error('Record not found');
    const record = records[0];

    // Fetch order lines
    if (record.line_ids && record.line_ids.length > 0) {
      const linesResp = await axios.post(
        `${ODOO_BASE_URL()}/web/dataset/call_kw`,
        {
          jsonrpc: '2.0',
          method: 'call',
          params: {
            model: 'estimate.purchase.line',
            method: 'read',
            args: [record.line_ids],
            kwargs: {
              fields: ['id', 'product_id', 'description', 'quantity', 'uom_id', 'price_unit', 'subtotal', 'display_type', 'name'],
            },
          },
        },
        { headers, timeout: 15000 }
      );
      record.order_lines_detail = linesResp.data.result || [];
    } else {
      record.order_lines_detail = [];
    }
    return record;
  } catch (error) {
    console.error('[EstimatePurchase] fetchDetail error:', error?.message || error);
    throw error;
  }
};

export const createEstimatePurchaseOdoo = async ({ partnerId, warehouseId, paymentMethodId, companyId, reference, notes, orderLines }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const lineCommands = (orderLines || []).map(line => ([0, 0, {
      product_id: line.product_id,
      quantity: line.qty || line.quantity || 1,
      price_unit: line.price_unit || 0,
    }]));

    const vals = {
      partner_id: partnerId,
      line_ids: lineCommands,
    };
    if (warehouseId) vals.warehouse_id = warehouseId;
    if (paymentMethodId) vals.payment_method_id = paymentMethodId;
    if (companyId) vals.company_id = companyId;
    if (reference) vals.reference = reference;
    if (notes) vals.notes = notes;

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create estimate purchase');
    return response.data.result;
  } catch (error) {
    console.error('[EstimatePurchase] create error:', error?.message || error);
    throw error;
  }
};

export const confirmEstimatePurchaseOdoo = async (id, companyId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const context = {};
    if (companyId) context.allowed_company_ids = [companyId];

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase',
          method: 'action_confirm',
          args: [[id]],
          kwargs: { context },
        },
      },
      { headers, timeout: 30000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to confirm');
    return response.data.result;
  } catch (error) {
    console.error('[EstimatePurchase] confirm error:', error?.message || error);
    throw error;
  }
};

export const cancelEstimatePurchaseOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase',
          method: 'action_cancel',
          args: [[id]],
          kwargs: {},
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to cancel');
    return response.data.result;
  } catch (error) {
    console.error('[EstimatePurchase] cancel error:', error?.message || error);
    throw error;
  }
};

export const draftEstimatePurchaseOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase',
          method: 'action_draft',
          args: [[id]],
          kwargs: {},
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to set draft');
    return response.data.result;
  } catch (error) {
    console.error('[EstimatePurchase] draft error:', error?.message || error);
    throw error;
  }
};

export const fetchEstimatePurchasePaymentMethodsOdoo = async (companyId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = companyId ? [['company_id', '=', companyId]] : [];
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'estimate.purchase.payment.method',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'is_default', 'is_vendor_account', 'journal_type'],
            order: 'sequence, id',
          },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) return [];
    return response.data.result || [];
  } catch (error) {
    console.error('[EstimatePurchase] fetchPaymentMethods error:', error?.message || error);
    return [];
  }
};

// =============================================
// ESTIMATE SALE — estimate.sale model
// =============================================

export const fetchEstimateSalesOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = searchText ? ['|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]] : [];
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'name', 'date', 'partner_id', 'state', 'amount_total', 'payment_state', 'reference'], offset, limit, order: 'date desc, id desc' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) return [];
    return response.data.result || [];
  } catch (error) { console.error('[EstimateSale] fetchList error:', error?.message); return []; }
};

export const fetchEstimateSaleDetailOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale', method: 'read', args: [[id]],
        kwargs: { fields: ['id', 'name', 'date', 'partner_id', 'company_id', 'currency_id', 'warehouse_id', 'quick_payment_method_id', 'state', 'amount_total', 'amount_paid', 'amount_due', 'payment_state', 'reference', 'notes', 'line_ids', 'sale_order_id', 'picking_id', 'invoice_id'] } },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Odoo error');
    const records = response.data.result || [];
    if (records.length === 0) throw new Error('Record not found');
    const record = records[0];
    if (record.line_ids && record.line_ids.length > 0) {
      const linesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'estimate.sale.line', method: 'read', args: [record.line_ids],
          kwargs: { fields: ['id', 'product_id', 'description', 'quantity', 'uom_id', 'price_unit', 'subtotal', 'display_type', 'name'] } },
      }, { headers, timeout: 15000 });
      record.order_lines_detail = linesResp.data.result || [];
    } else { record.order_lines_detail = []; }
    return record;
  } catch (error) { console.error('[EstimateSale] fetchDetail error:', error?.message); throw error; }
};

export const createEstimateSaleOdoo = async ({ partnerId, warehouseId, paymentMethodId, reference, notes, orderLines }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const lineCommands = (orderLines || []).map(line => ([0, 0, { product_id: line.product_id, quantity: line.qty || line.quantity || 1, price_unit: line.price_unit || 0 }]));
    const vals = { partner_id: partnerId, line_ids: lineCommands };
    if (warehouseId) vals.warehouse_id = warehouseId;
    if (paymentMethodId) vals.quick_payment_method_id = paymentMethodId;
    if (reference) vals.reference = reference;
    if (notes) vals.notes = notes;
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create');
    return response.data.result;
  } catch (error) { console.error('[EstimateSale] create error:', error?.message); throw error; }
};

export const confirmEstimateSaleOdoo = async (id, companyId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const context = companyId ? { allowed_company_ids: [companyId] } : {};
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale', method: 'action_confirm', args: [[id]], kwargs: { context } },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to confirm');
    return response.data.result;
  } catch (error) { throw error; }
};

export const cancelSaleOrderOdoo = async (id) => {
  // Offline branch — mirrors confirmSaleOrderOdoo. Queue the cancel action
  // and patch the cached state so the UI updates immediately. When the
  // device reconnects, OfflineSyncService runs action_cancel on the real id.
  try {
    const online = await isOnline();
    if (!online) {
      const idStr = String(id);
      if (idStr.startsWith('offline_')) {
        // Fold the cancel into the pending create — the sync handler will
        // create the order then call action_cancel on it.
        const queueItemId = idStr.replace('offline_', '');
        await offlineQueue.updateValues(queueItemId, { _cancelAfterCreate: true });
      } else {
        await offlineQueue.enqueue({
          model: 'sale.order',
          operation: 'action_cancel',
          values: { _recordId: id },
        });
      }

      // Update cached state so the list + detail view show "Cancelled".
      try {
        const raw = await AsyncStorage.getItem('@cache:saleOrders');
        if (raw) {
          const list = JSON.parse(raw);
          const idx = list.findIndex((o) => String(o.id) === idStr);
          if (idx >= 0) { list[idx] = { ...list[idx], state: 'cancel' }; await AsyncStorage.setItem('@cache:saleOrders', JSON.stringify(list)); }
        }
      } catch (_) {}
      try {
        const detailKey = `@cache:saleOrderDetail:${idStr}`;
        const rawD = await AsyncStorage.getItem(detailKey);
        if (rawD) {
          const prev = JSON.parse(rawD);
          await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, state: 'cancel' }));
        }
      } catch (_) {}

      console.log('[cancelSaleOrderOdoo] Queued offline for id:', id);
      return { offline: true };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'sale.order', method: 'action_cancel', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to cancel order');
    return response.data.result;
  } catch (error) { throw error; }
};

export const cancelEstimateSaleOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale', method: 'action_cancel', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to cancel');
    return response.data.result;
  } catch (error) { throw error; }
};

export const draftEstimateSaleOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale', method: 'action_draft', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed');
    return response.data.result;
  } catch (error) { throw error; }
};

export const fetchEstimateSalePaymentMethodsOdoo = async (companyId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = companyId ? [['company_id', '=', companyId]] : [];
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'estimate.sale.payment.method', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'name', 'is_default', 'is_customer_account', 'journal_type'], order: 'sequence, id' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) return [];
    return response.data.result || [];
  } catch (error) { console.error('[EstimateSale] fetchPaymentMethods error:', error?.message); return []; }
};

export const fetchWarehousesSessionOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'stock.warehouse',
          method: 'search_read',
          args: [[]],
          kwargs: { fields: ['id', 'name', 'code', 'company_id'], limit: 50 },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) return [];
    return (response.data.result || []).map(w => ({
      id: w.id, name: w.name, code: w.code, label: w.name,
      company_id: Array.isArray(w.company_id) ? w.company_id[0] : w.company_id,
    }));
  } catch (error) {
    console.error('[fetchWarehousesSessionOdoo] error:', error?.message || error);
    return [];
  }
};

// =============================================
// QUICK PURCHASE RETURN — quick.purchase.return
// =============================================

export const fetchQuickPurchaseReturnsOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = searchText
      ? ['|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]]
      : [];
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'name', 'date', 'partner_id', 'source_invoice_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id'], offset, limit, order: 'date desc, id desc' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) return [];
    return response.data.result || [];
  } catch (error) {
    console.error('[QuickPurchaseReturn] fetchList error:', error?.message || error);
    return [];
  }
};

export const fetchQuickPurchaseReturnDetailOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'read', args: [[id]],
        kwargs: { fields: ['id', 'name', 'date', 'partner_id', 'source_invoice_id', 'company_id', 'currency_id', 'invoice_date', 'warehouse_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'notes', 'line_ids', 'credit_note_id', 'return_picking_id'] } },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Odoo error');
    const records = response.data.result || [];
    if (records.length === 0) throw new Error('Record not found');
    const record = records[0];
    if (record.line_ids && record.line_ids.length > 0) {
      const linesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'quick.purchase.return.line', method: 'read', args: [record.line_ids],
          kwargs: { fields: ['id', 'product_id', 'description', 'purchased_qty', 'already_returned_qty', 'returnable_qty', 'return_qty', 'uom_id', 'price_unit', 'discount', 'subtotal', 'tax_amount', 'total'] } },
      }, { headers, timeout: 15000 });
      record.lines_detail = linesResp.data.result || [];
    } else { record.lines_detail = []; }
    return record;
  } catch (error) {
    console.error('[QuickPurchaseReturn] fetchDetail error:', error?.message || error);
    throw error;
  }
};

export const fetchVendorBillsOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    let domain = [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['source_module', 'in', ['easy_purchase', 'estimate_purchase']]];
    if (searchText && searchText.trim()) {
      domain = ['&', ...domain, '|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]];
    }
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'name', 'partner_id', 'invoice_date', 'amount_total', 'currency_id', 'invoice_origin', 'ref'], offset, limit, order: 'invoice_date desc' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) return [];
    return (response.data.result || []).map(b => {
      const estRef = b.ref || '';
      const origin = b.invoice_origin || '';
      const extra = estRef || origin;
      const billLabel = extra ? `${b.name || ''} (${extra})` : (b.name || '');
      return {
        id: b.id, name: b.name || '', label: billLabel,
        partner_id: b.partner_id, invoice_date: b.invoice_date, amount_total: b.amount_total,
        invoice_origin: origin, currency_id: b.currency_id,
      };
    });
  } catch (error) {
    console.error('[fetchVendorBillsOdoo] error:', error?.message || error);
    return [];
  }
};

export const fetchVendorBillLinesOdoo = async (invoiceId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = [['move_id', '=', invoiceId], ['product_id', '!=', false]];
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move.line', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'product_id', 'name', 'quantity', 'price_unit', 'discount', 'tax_ids', 'product_uom_id'], limit: 200 } },
    }, { headers, timeout: 15000 });
    if (response.data.error) { console.error('[fetchVendorBillLines] error:', response.data.error); return []; }
    return response.data.result || [];
  } catch (error) {
    console.error('[fetchVendorBillLinesOdoo] error:', error?.message || error);
    return [];
  }
};

export const fetchPurchaseOrderWarehouseOdoo = async (poName) => {
  try {
    if (!poName) return null;
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'purchase.order', method: 'search_read',
        args: [[['name', '=', poName]]],
        kwargs: { fields: ['id', 'picking_type_id'], limit: 1 } },
    }, { headers, timeout: 15000 });
    const po = (response.data.result || [])[0];
    if (!po || !po.picking_type_id) return null;
    // Get warehouse from picking type
    const ptResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'stock.picking.type', method: 'read',
        args: [[Array.isArray(po.picking_type_id) ? po.picking_type_id[0] : po.picking_type_id]],
        kwargs: { fields: ['warehouse_id'] } },
    }, { headers, timeout: 15000 });
    const pt = (ptResp.data.result || [])[0];
    if (!pt || !pt.warehouse_id) return null;
    return { id: Array.isArray(pt.warehouse_id) ? pt.warehouse_id[0] : pt.warehouse_id, name: Array.isArray(pt.warehouse_id) ? pt.warehouse_id[1] : '', label: Array.isArray(pt.warehouse_id) ? pt.warehouse_id[1] : '' };
  } catch (error) {
    console.error('[fetchPurchaseOrderWarehouseOdoo] error:', error?.message || error);
    return null;
  }
};

export const fetchAlreadyReturnedQtysOdoo = async (invoiceId) => {
  try {
    const headers = await getOdooAuthHeaders();
    // Step 1: Find all confirmed purchase returns for this invoice
    const returnsResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'quick.purchase.return', method: 'search_read',
        args: [[['source_invoice_id', '=', invoiceId], ['state', '=', 'done']]],
        kwargs: { fields: ['id', 'line_ids'], limit: 200 },
      },
    }, { headers, timeout: 15000 });
    if (returnsResp.data.error) throw new Error(returnsResp.data.error?.data?.message || 'Odoo error');
    const returns = returnsResp.data.result || [];
    const allLineIds = returns.flatMap(r => r.line_ids || []);
    if (allLineIds.length === 0) return {};
    // Step 2: Read the return lines to get returned quantities per source invoice line
    const linesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'quick.purchase.return.line', method: 'read',
        args: [allLineIds],
        kwargs: { fields: ['source_invoice_line_id', 'return_qty'] },
      },
    }, { headers, timeout: 15000 });
    if (linesResp.data.error) throw new Error(linesResp.data.error?.data?.message || 'Odoo error');
    const lineRecords = linesResp.data.result || [];
    // Step 3: Sum return_qty grouped by source_invoice_line_id
    const qtyMap = {};
    lineRecords.forEach(line => {
      const lineId = Array.isArray(line.source_invoice_line_id) ? line.source_invoice_line_id[0] : line.source_invoice_line_id;
      if (lineId) qtyMap[lineId] = (qtyMap[lineId] || 0) + (line.return_qty || 0);
    });
    return qtyMap;
  } catch (error) {
    console.error('[fetchAlreadyReturnedQtysOdoo] error:', error?.message || error);
    return {};
  }
};

export const fetchVendorBillsWithReturnableFilterOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    // Step 1: Fetch all vendor bills
    const bills = await fetchVendorBillsOdoo({ offset, limit, searchText });
    if (bills.length === 0) return [];
    const billIds = bills.map(b => b.id);
    // Step 2: Fetch all bill lines in one batch
    const billLinesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move.line', method: 'search_read',
        args: [[['move_id', 'in', billIds], ['product_id', '!=', false]]],
        kwargs: { fields: ['id', 'move_id', 'quantity'], limit: 1000 } },
    }, { headers, timeout: 15000 });
    const allBillLines = (billLinesResp.data.error ? [] : billLinesResp.data.result) || [];
    // Step 3: Fetch all confirmed purchase returns for these bills
    const returnsResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'search_read',
        args: [[['source_invoice_id', 'in', billIds], ['state', '=', 'done']]],
        kwargs: { fields: ['id', 'line_ids'], limit: 500 } },
    }, { headers, timeout: 15000 });
    const allReturns = (returnsResp.data.error ? [] : returnsResp.data.result) || [];
    const allReturnLineIds = allReturns.flatMap(r => r.line_ids || []);
    // Step 4: Read return line details
    let returnedQtyMap = {}; // { invoiceLineId: totalReturnedQty }
    if (allReturnLineIds.length > 0) {
      const retLinesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'quick.purchase.return.line', method: 'read',
          args: [allReturnLineIds],
          kwargs: { fields: ['source_invoice_line_id', 'return_qty'] } },
      }, { headers, timeout: 15000 });
      const retLines = (retLinesResp.data.error ? [] : retLinesResp.data.result) || [];
      retLines.forEach(rl => {
        const lineId = Array.isArray(rl.source_invoice_line_id) ? rl.source_invoice_line_id[0] : rl.source_invoice_line_id;
        if (lineId) returnedQtyMap[lineId] = (returnedQtyMap[lineId] || 0) + (rl.return_qty || 0);
      });
    }
    // Step 5: Group bill lines by bill and check if fully returned
    const billLinesMap = {}; // { billId: [{ id, quantity }] }
    allBillLines.forEach(l => {
      const billId = Array.isArray(l.move_id) ? l.move_id[0] : l.move_id;
      if (!billLinesMap[billId]) billLinesMap[billId] = [];
      billLinesMap[billId].push({ id: l.id, quantity: l.quantity || 0 });
    });
    return bills.filter(bill => {
      const lines = billLinesMap[bill.id] || [];
      if (lines.length === 0) return true; // keep bills with no lines (edge case)
      return lines.some(l => {
        const returned = returnedQtyMap[l.id] || 0;
        return l.quantity - returned > 0; // has returnable qty
      });
    });
  } catch (error) {
    console.error('[fetchVendorBillsWithReturnableFilterOdoo] error:', error?.message || error);
    return fetchVendorBillsOdoo({ offset, limit, searchText }); // fallback to unfiltered
  }
};

export const fetchCustomerInvoicesWithReturnableFilterOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    // Step 1: Fetch all customer invoices
    const invoices = await fetchPostedCustomerInvoicesForReturnOdoo({ offset, limit, searchText });
    if (invoices.length === 0) return [];
    const invoiceIds = invoices.map(inv => inv.id);
    // Step 2: Fetch all invoice lines in one batch
    const invLinesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move.line', method: 'search_read',
        args: [[['move_id', 'in', invoiceIds], ['product_id', '!=', false]]],
        kwargs: { fields: ['id', 'move_id', 'quantity'], limit: 1000 } },
    }, { headers, timeout: 15000 });
    const allInvLines = (invLinesResp.data.error ? [] : invLinesResp.data.result) || [];
    // Step 3: Fetch all confirmed sales returns for these invoices
    const returnsResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'search_read',
        args: [[['source_invoice_id', 'in', invoiceIds], ['state', '=', 'done']]],
        kwargs: { fields: ['id', 'line_ids'], limit: 500 } },
    }, { headers, timeout: 15000 });
    const allReturns = (returnsResp.data.error ? [] : returnsResp.data.result) || [];
    const allReturnLineIds = allReturns.flatMap(r => r.line_ids || []);
    // Step 4: Read return line details
    let returnedQtyMap = {};
    if (allReturnLineIds.length > 0) {
      const retLinesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'quick.sales.return.line', method: 'read',
          args: [allReturnLineIds],
          kwargs: { fields: ['source_invoice_line_id', 'return_qty'] } },
      }, { headers, timeout: 15000 });
      const retLines = (retLinesResp.data.error ? [] : retLinesResp.data.result) || [];
      retLines.forEach(rl => {
        const lineId = Array.isArray(rl.source_invoice_line_id) ? rl.source_invoice_line_id[0] : rl.source_invoice_line_id;
        if (lineId) returnedQtyMap[lineId] = (returnedQtyMap[lineId] || 0) + (rl.return_qty || 0);
      });
    }
    // Step 5: Group invoice lines by invoice and check if fully returned
    const invLinesMap = {};
    allInvLines.forEach(l => {
      const invId = Array.isArray(l.move_id) ? l.move_id[0] : l.move_id;
      if (!invLinesMap[invId]) invLinesMap[invId] = [];
      invLinesMap[invId].push({ id: l.id, quantity: l.quantity || 0 });
    });
    return invoices.filter(inv => {
      const lines = invLinesMap[inv.id] || [];
      if (lines.length === 0) return true;
      return lines.some(l => {
        const returned = returnedQtyMap[l.id] || 0;
        return l.quantity - returned > 0;
      });
    });
  } catch (error) {
    console.error('[fetchCustomerInvoicesWithReturnableFilterOdoo] error:', error?.message || error);
    return fetchPostedCustomerInvoicesForReturnOdoo({ offset, limit, searchText }); // fallback
  }
};

export const createQuickPurchaseReturnOdoo = async ({ sourceInvoiceId, warehouseId, notes, lines, date }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const lineCommands = (lines || []).filter(l => l.return_qty > 0).map(l => ([0, 0, {
      source_invoice_line_id: l.source_invoice_line_id || false,
      product_id: l.product_id,
      description: l.description || '',
      purchased_qty: l.purchased_qty || 0,
      already_returned_qty: l.already_returned_qty || 0,
      returnable_qty: l.returnable_qty || 0,
      return_qty: l.return_qty,
      price_unit: l.price_unit || 0,
      uom_id: l.uom_id || false,
    }]));
    const vals = { source_invoice_id: sourceInvoiceId, line_ids: lineCommands };
    if (warehouseId) vals.warehouse_id = warehouseId;
    if (notes) vals.notes = notes;
    if (date) vals.date = date;
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create');
    return response.data.result;
  } catch (error) {
    console.error('[QuickPurchaseReturn] create error:', error?.message || error);
    throw error;
  }
};

export const confirmQuickPurchaseReturnOdoo = async (id, companyId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const context = companyId ? { allowed_company_ids: [companyId] } : {};
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'action_confirm', args: [[id]], kwargs: { context } },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to confirm');
    return response.data.result;
  } catch (error) {
    console.error('[QuickPurchaseReturn] confirm error:', error?.message || error);
    throw error;
  }
};

export const cancelQuickPurchaseReturnOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'action_cancel', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to cancel');
    return response.data.result;
  } catch (error) { throw error; }
};

export const draftQuickPurchaseReturnOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.purchase.return', method: 'action_draft', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to set draft');
    return response.data.result;
  } catch (error) { throw error; }
};

// =============================================
// QUICK SALES RETURN — quick.sales.return
// =============================================

export const fetchAlreadyReturnedSalesQtysOdoo = async (invoiceId) => {
  try {
    const headers = await getOdooAuthHeaders();
    // Step 1: Find all confirmed sales returns for this invoice
    const returnsResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'quick.sales.return', method: 'search_read',
        args: [[['source_invoice_id', '=', invoiceId], ['state', '=', 'done']]],
        kwargs: { fields: ['id', 'line_ids'], limit: 200 },
      },
    }, { headers, timeout: 15000 });
    if (returnsResp.data.error) throw new Error(returnsResp.data.error?.data?.message || 'Odoo error');
    const returns = returnsResp.data.result || [];
    const allLineIds = returns.flatMap(r => r.line_ids || []);
    if (allLineIds.length === 0) return {};
    // Step 2: Read the return lines to get returned quantities per source invoice line
    const linesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'quick.sales.return.line', method: 'read',
        args: [allLineIds],
        kwargs: { fields: ['source_invoice_line_id', 'return_qty'] },
      },
    }, { headers, timeout: 15000 });
    if (linesResp.data.error) throw new Error(linesResp.data.error?.data?.message || 'Odoo error');
    const lineRecords = linesResp.data.result || [];
    // Step 3: Sum return_qty grouped by source_invoice_line_id
    const qtyMap = {};
    lineRecords.forEach(line => {
      const lineId = Array.isArray(line.source_invoice_line_id) ? line.source_invoice_line_id[0] : line.source_invoice_line_id;
      if (lineId) qtyMap[lineId] = (qtyMap[lineId] || 0) + (line.return_qty || 0);
    });
    return qtyMap;
  } catch (error) {
    console.error('[fetchAlreadyReturnedSalesQtysOdoo] error:', error?.message || error);
    return {};
  }
};

export const fetchQuickSalesReturnsOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = searchText
      ? ['|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]]
      : [];
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'name', 'date', 'partner_id', 'source_invoice_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id'], offset, limit, order: 'date desc, id desc' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) return [];
    return response.data.result || [];
  } catch (error) {
    console.error('[QuickSalesReturn] fetchList error:', error?.message || error);
    return [];
  }
};

export const fetchQuickSalesReturnDetailOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'read', args: [[id]],
        kwargs: { fields: ['id', 'name', 'date', 'partner_id', 'source_invoice_id', 'company_id', 'currency_id', 'warehouse_id', 'state', 'amount_untaxed', 'amount_tax', 'amount_total', 'notes', 'line_ids', 'credit_note_id', 'return_picking_id'] } },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Odoo error');
    const records = response.data.result || [];
    if (records.length === 0) throw new Error('Record not found');
    const record = records[0];
    if (record.line_ids && record.line_ids.length > 0) {
      const linesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'quick.sales.return.line', method: 'read', args: [record.line_ids],
          kwargs: { fields: ['id', 'product_id', 'description', 'sold_qty', 'already_returned_qty', 'returnable_qty', 'return_qty', 'uom_id', 'price_unit', 'discount', 'subtotal', 'tax_amount', 'total'] } },
      }, { headers, timeout: 15000 });
      record.lines_detail = linesResp.data.result || [];
    } else { record.lines_detail = []; }
    return record;
  } catch (error) {
    console.error('[QuickSalesReturn] fetchDetail error:', error?.message || error);
    throw error;
  }
};

export const fetchPostedCustomerInvoicesForReturnOdoo = async ({ offset = 0, limit = 50, searchText = '' } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    let domain = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['source_module', 'in', ['easy_sale', 'estimate_sale']]];
    if (searchText && searchText.trim()) {
      domain = ['&', ...domain, '|', ['name', 'ilike', searchText], ['partner_id', 'ilike', searchText]];
    }
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'name', 'partner_id', 'invoice_date', 'amount_total', 'currency_id', 'invoice_origin', 'ref'], offset, limit, order: 'invoice_date desc' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) return [];
    return (response.data.result || []).map(b => {
      const estRef = b.ref || '';
      const origin = b.invoice_origin || '';
      const extra = estRef || origin;
      const invoiceLabel = extra ? `${b.name || ''} (${extra})` : (b.name || '');
      return {
        id: b.id, name: b.name || '', label: invoiceLabel,
        partner_id: b.partner_id, invoice_date: b.invoice_date, amount_total: b.amount_total,
        invoice_origin: origin,
      };
    });
  } catch (error) {
    console.error('[fetchPostedCustomerInvoicesForReturnOdoo] error:', error?.message || error);
    return [];
  }
};

export const fetchCustomerInvoiceLinesOdoo = async (invoiceId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const domain = [['move_id', '=', invoiceId], ['product_id', '!=', false]];
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move.line', method: 'search_read', args: [domain],
        kwargs: { fields: ['id', 'product_id', 'name', 'quantity', 'price_unit', 'discount', 'tax_ids', 'product_uom_id'], limit: 200 } },
    }, { headers, timeout: 15000 });
    if (response.data.error) { console.error('[fetchCustomerInvoiceLines] error:', response.data.error); return []; }
    return response.data.result || [];
  } catch (error) {
    console.error('[fetchCustomerInvoiceLinesOdoo] error:', error?.message || error);
    return [];
  }
};

export const fetchSaleOrderWarehouseOdoo = async (soName) => {
  try {
    if (!soName) return null;
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'sale.order', method: 'search_read',
        args: [[['name', '=', soName]]],
        kwargs: { fields: ['id', 'warehouse_id'], limit: 1 } },
    }, { headers, timeout: 15000 });
    const so = (response.data.result || [])[0];
    if (!so || !so.warehouse_id) return null;
    return { id: Array.isArray(so.warehouse_id) ? so.warehouse_id[0] : so.warehouse_id, name: Array.isArray(so.warehouse_id) ? so.warehouse_id[1] : '', label: Array.isArray(so.warehouse_id) ? so.warehouse_id[1] : '' };
  } catch (error) {
    console.error('[fetchSaleOrderWarehouseOdoo] error:', error?.message || error);
    return null;
  }
};

export const createQuickSalesReturnOdoo = async ({ sourceInvoiceId, warehouseId, notes, lines }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const lineCommands = (lines || []).filter(l => l.return_qty > 0).map(l => ([0, 0, {
      source_invoice_line_id: l.source_invoice_line_id || false,
      product_id: l.product_id,
      description: l.description || '',
      sold_qty: l.sold_qty || 0,
      already_returned_qty: l.already_returned_qty || 0,
      returnable_qty: l.returnable_qty || 0,
      return_qty: l.return_qty,
      price_unit: l.price_unit || 0,
      uom_id: l.uom_id || false,
    }]));
    const vals = { source_invoice_id: sourceInvoiceId, line_ids: lineCommands };
    if (warehouseId) vals.warehouse_id = warehouseId;
    if (notes) vals.notes = notes;
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create');
    return response.data.result;
  } catch (error) {
    console.error('[QuickSalesReturn] create error:', error?.message || error);
    throw error;
  }
};

export const confirmQuickSalesReturnOdoo = async (id, companyId) => {
  try {
    const headers = await getOdooAuthHeaders();
    const context = companyId ? { allowed_company_ids: [companyId] } : {};
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'action_confirm', args: [[id]], kwargs: { context } },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to confirm');
    return response.data.result;
  } catch (error) {
    console.error('[QuickSalesReturn] confirm error:', error?.message || error);
    throw error;
  }
};

export const cancelQuickSalesReturnOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'action_cancel', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to cancel');
    return response.data.result;
  } catch (error) { throw error; }
};

export const draftQuickSalesReturnOdoo = async (id) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'quick.sales.return', method: 'action_draft', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to set draft');
    return response.data.result;
  } catch (error) { throw error; }
};

// =============================================
// APP BANNER — app.banner
// =============================================

export const fetchAppBannersOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'app.banner', method: 'search_read', args: [[['active', '=', true]]],
        kwargs: { fields: ['id', 'name', 'image', 'sequence'], order: 'sequence asc, id asc' } },
    }, { headers, timeout: 15000 });
    if (response.data.error) {
      // Fall back to cache on Odoo error (e.g. module missing)
      try {
        const cached = await AsyncStorage.getItem('@cache:banners');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
    const banners = response.data.result || [];
    // Cache for offline
    try { await AsyncStorage.setItem('@cache:banners', JSON.stringify(banners)); } catch (_) {}
    return banners;
  } catch (error) {
    console.error('[AppBanner] fetchList error:', error?.message || error);
    // Fall back to cache on network error
    try {
      const cached = await AsyncStorage.getItem('@cache:banners');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return [];
  }
};

export const createAppBannerOdoo = async ({ name, imageBase64 }) => {
  const vals = { image: imageBase64 };
  if (name) vals.name = name;

  // Offline check up-front — queue immediately if no internet
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({ model: 'app.banner', operation: 'create', values: vals });
      // Also append to cached banner list so Home carousel shows it immediately
      try {
        const cached = await AsyncStorage.getItem('@cache:banners');
        const list = cached ? JSON.parse(cached) : [];
        list.push({ id: `offline_${localId}`, name: name || `banner_${Date.now()}`, image: imageBase64, sequence: 999 });
        await AsyncStorage.setItem('@cache:banners', JSON.stringify(list));
      } catch (_) {}
      console.log('[AppBanner] Queued offline, localId:', localId);
      return { offline: true, localId };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'app.banner', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create banner');
    return response.data.result;
  } catch (error) {
    console.error('[AppBanner] create error:', error?.message || error);
    // Network failure fallback — queue locally
    if (!error.response) {
      const localId = await offlineQueue.enqueue({ model: 'app.banner', operation: 'create', values: vals });
      try {
        const cached = await AsyncStorage.getItem('@cache:banners');
        const list = cached ? JSON.parse(cached) : [];
        list.push({ id: `offline_${localId}`, name: name || `banner_${Date.now()}`, image: imageBase64, sequence: 999 });
        await AsyncStorage.setItem('@cache:banners', JSON.stringify(list));
      } catch (_) {}
      console.log('[AppBanner] Queued offline (network fail), localId:', localId);
      return { offline: true, localId };
    }
    throw error;
  }
};

export const deleteAppBannerOdoo = async (id) => {
  // Offline check up-front
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({ model: 'app.banner', operation: 'delete', values: { id } });
      // Remove from cached banner list immediately
      try {
        const cached = await AsyncStorage.getItem('@cache:banners');
        if (cached) {
          const list = JSON.parse(cached).filter(b => b.id !== id);
          await AsyncStorage.setItem('@cache:banners', JSON.stringify(list));
        }
      } catch (_) {}
      console.log('[AppBanner] Delete queued offline, localId:', localId);
      return { offline: true, localId };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'app.banner', method: 'unlink', args: [[id]], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to delete banner');
    return response.data.result;
  } catch (error) {
    console.error('[AppBanner] delete error:', error?.message || error);
    // Network failure fallback
    if (!error.response) {
      const localId = await offlineQueue.enqueue({ model: 'app.banner', operation: 'delete', values: { id } });
      try {
        const cached = await AsyncStorage.getItem('@cache:banners');
        if (cached) {
          const list = JSON.parse(cached).filter(b => b.id !== id);
          await AsyncStorage.setItem('@cache:banners', JSON.stringify(list));
        }
      } catch (_) {}
      console.log('[AppBanner] Delete queued offline (network fail), localId:', localId);
      return { offline: true, localId };
    }
    throw error;
  }
};

// =============================================
// PRODUCT CREATION — product.product
// =============================================

export const fetchUomsOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'uom.uom', method: 'search_read', args: [[]],
        kwargs: { fields: ['id', 'name'], limit: 200 } },
    }, { headers, timeout: 15000 });
    if (response.data.error) {
      try {
        const cached = await AsyncStorage.getItem('@cache:uoms');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
    const mapped = (response.data.result || []).map(u => ({ id: u.id, name: u.name || '', label: u.name || '' }));
    try { await AsyncStorage.setItem('@cache:uoms', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('[fetchUomsOdoo] error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:uoms');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return [];
  }
};

export const fetchPurchaseTaxesOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.tax', method: 'search_read', args: [[['type_tax_use', '=', 'purchase']]],
        kwargs: { fields: ['id', 'name', 'amount', 'type_tax_use'], limit: 50 } },
    }, { headers, timeout: 15000 });
    if (response.data.error) {
      try {
        const cached = await AsyncStorage.getItem('@cache:purchaseTaxes');
        if (cached) return JSON.parse(cached);
      } catch (_) {}
      return [];
    }
    const mapped = (response.data.result || []).map(t => ({ id: t.id, name: t.name || '', label: t.name || '', amount: t.amount || 0 }));
    try { await AsyncStorage.setItem('@cache:purchaseTaxes', JSON.stringify(mapped)); } catch (_) {}
    return mapped;
  } catch (error) {
    console.error('[fetchPurchaseTaxesOdoo] error:', error?.message || error);
    try {
      const cached = await AsyncStorage.getItem('@cache:purchaseTaxes');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return [];
  }
};

export const createProductOdoo = async ({ name, categId, posCategoryId, listPrice, standardPrice, barcode, defaultCode, uomId, taxesId, supplierTaxesId, image, descriptionSale, onHandQty, companyId }) => {
  // Build the base vals (shared between online and offline paths)
  const vals = {
    name,
    sale_ok: true,
    purchase_ok: true,
  };
  if (companyId) vals.company_id = companyId;
  if (categId) vals.categ_id = categId;
  if (posCategoryId) vals.pos_categ_ids = [[6, 0, [posCategoryId]]];
  if (listPrice !== undefined && listPrice !== '') vals.list_price = parseFloat(listPrice) || 0;
  if (standardPrice !== undefined && standardPrice !== '') vals.standard_price = parseFloat(standardPrice) || 0;
  if (barcode) vals.barcode = barcode;
  if (defaultCode) vals.default_code = defaultCode;
  if (uomId) { vals.uom_id = uomId; vals.uom_po_id = uomId; }
  if (taxesId && taxesId.length > 0) vals.taxes_id = [[6, 0, taxesId]];
  if (supplierTaxesId && supplierTaxesId.length > 0) vals.supplier_taxes_id = [[6, 0, supplierTaxesId]];
  if (descriptionSale) vals.description_sale = descriptionSale;

  // Offline check up-front — queue WITHOUT image (Option 3: no images offline)
  try {
    const online = await isOnline();
    if (!online) {
      const localId = await offlineQueue.enqueue({
        model: 'product.product',
        operation: 'create',
        values: vals,  // no image included — will show "No Image" until edited online
      });
      // Look up the category name from cache so the product detail view shows
      // the right category (instead of "N/A") while offline.
      let categoryName = '';
      const catKeyId = posCategoryId || categId;
      try {
        const catCacheRaw = await AsyncStorage.getItem('@cache:categories');
        if (catCacheRaw && catKeyId) {
          const catList = JSON.parse(catCacheRaw);
          const match = catList.find(c => (c._id === catKeyId || c.id === catKeyId));
          categoryName = match?.category_name || match?.name || '';
        }
      } catch (_) {}
      // Append to cached product lists so user sees it immediately in Products screen + Home
      try {
        const placeholderProduct = {
          id: `offline_${localId}`,
          product_name: name || '',
          image_url: '',
          price: parseFloat(listPrice) || 0,
          list_price: parseFloat(listPrice) || 0,
          standard_price: parseFloat(standardPrice) || 0,
          code: defaultCode || '',
          barcode: barcode || '',
          uom: uomId ? { uom_id: uomId, uom_name: '' } : null,
          tax_percent: 0,
          taxes: [],
          qty_available: parseFloat(onHandQty) || 0,
          categ_id: catKeyId ? [catKeyId, categoryName] : null,
          category_name: categoryName,
          category: catKeyId ? { id: catKeyId, category_name: categoryName, name: categoryName } : null,
          pos_categ_ids: posCategoryId ? [[posCategoryId, categoryName]] : [],
          offline: true,
        };
        // Main cache
        const mainRaw = await AsyncStorage.getItem('@cache:products');
        const mainList = mainRaw ? JSON.parse(mainRaw) : [];
        mainList.push(placeholderProduct);
        await AsyncStorage.setItem('@cache:products', JSON.stringify(mainList));
        // Category-specific cache too (so the Drinks/category filter shows it)
        if (catKeyId) {
          const catKey = `@cache:products:cat:${catKeyId}`;
          const catRaw = await AsyncStorage.getItem(catKey);
          const catList = catRaw ? JSON.parse(catRaw) : [];
          catList.push(placeholderProduct);
          await AsyncStorage.setItem(catKey, JSON.stringify(catList));
        }
        // Per-product detail cache so fetchProductDetailsOdoo returns category
        // info when offline (ProductDetail reads @cache:productDetail:<id>).
        try {
          const detailEntry = {
            id: `offline_${localId}`,
            product_name: name || '',
            image_url: '',
            price: parseFloat(listPrice) || 0,
            standard_price: parseFloat(standardPrice) || 0,
            code: defaultCode || '',
            barcode: barcode || '',
            uom: uomId ? { uom_id: uomId, uom_name: '' } : null,
            categ_id: catKeyId ? [catKeyId, categoryName] : null,
            category_name: categoryName,
            pos_categ_ids: posCategoryId ? [[posCategoryId, categoryName]] : [],
            product_description: descriptionSale || '',
            offline: true,
          };
          await AsyncStorage.setItem(`@cache:productDetail:offline_${localId}`, JSON.stringify(detailEntry));
        } catch (_) {}
      } catch (_) {}
      console.log('[createProductOdoo] Queued offline, localId:', localId, 'category:', categoryName);
      return { offline: true, localId };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    // Image goes only on the ONLINE path
    if (image) vals.image_1920 = image;

    console.log('[createProductOdoo] Sending vals:', JSON.stringify({ ...vals, image_1920: vals.image_1920 ? '(base64)' : undefined }));

    const response = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'product.product', method: 'create', args: [vals], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create product');
    const productId = response.data.result;
    console.log('[createProductOdoo] Created product id:', productId);

    // Verify what was actually saved
    try {
      const verifyResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'product.product', method: 'read', args: [[productId]], kwargs: { fields: ['categ_id', 'pos_categ_ids'] } },
      }, { headers, timeout: 10000 });
      console.log('[createProductOdoo] Verification — saved categ_id:', verifyResp.data?.result?.[0]?.categ_id, 'pos_categ_ids:', verifyResp.data?.result?.[0]?.pos_categ_ids);
    } catch (e) { console.warn('[createProductOdoo] verify failed:', e?.message); }

    // Set initial on-hand stock quantity if provided
    if (onHandQty && parseFloat(onHandQty) > 0 && productId) {
      try {
        // Get default stock location (WH/Stock)
        const locResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'stock.warehouse', method: 'search_read', args: [[]], kwargs: { fields: ['lot_stock_id'], limit: 1 } },
        }, { headers, timeout: 10000 });
        const locationId = locResp.data?.result?.[0]?.lot_stock_id?.[0] || 8; // fallback to 8 (common default)

        // Create stock quant with inventory_quantity
        const quantResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: {
            model: 'stock.quant', method: 'create',
            args: [{ product_id: productId, location_id: locationId, inventory_quantity: parseFloat(onHandQty) }],
            kwargs: {},
          },
        }, { headers, timeout: 10000 });
        const quantId = quantResp.data?.result;

        // Apply inventory to confirm the quantity
        if (quantId) {
          await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
            jsonrpc: '2.0', method: 'call',
            params: { model: 'stock.quant', method: 'action_apply_inventory', args: [[quantId]], kwargs: {} },
          }, { headers, timeout: 10000 });
        }
        console.log('[createProductOdoo] Stock set:', onHandQty, 'for product:', productId);
      } catch (stockErr) {
        console.warn('[createProductOdoo] Stock update failed (product still created):', stockErr?.message);
      }
    }

    return productId;
  } catch (error) {
    console.error('[createProductOdoo] error:', error?.message || error);
    throw error;
  }
};

export const updateProductOdoo = async (productId, { name, posCategoryId, categId, listPrice, standardPrice, barcode, defaultCode, image }) => {
  // Offline branch — queue edit, mutate caches in place. Images skipped offline.
  try {
    const online = await isOnline();
    if (!online) {
      const vals = {};
      if (name !== undefined && name !== '') vals.name = name;
      if (categId) vals.categ_id = categId;
      if (posCategoryId) vals.pos_categ_ids = [[6, 0, [posCategoryId]]];
      if (listPrice !== undefined && listPrice !== '') vals.list_price = parseFloat(listPrice) || 0;
      if (standardPrice !== undefined && standardPrice !== '') vals.standard_price = parseFloat(standardPrice) || 0;
      if (barcode !== undefined) vals.barcode = barcode || false;
      if (defaultCode !== undefined) vals.default_code = defaultCode || false;

      const idStr = String(productId);
      if (idStr.startsWith('offline_')) {
        // Edit of an offline-created product that hasn't synced yet.
        const queueItemId = idStr.replace('offline_', '');
        await offlineQueue.updateValues(queueItemId, vals);
      } else {
        await offlineQueue.enqueue({
          model: 'product.product',
          operation: 'write',
          values: { _recordId: productId, ...vals },
        });
      }

      // Look up category name from cache to keep the cached product display correct.
      const newCatId = posCategoryId || categId;
      let categoryName = '';
      try {
        const catCacheRaw = await AsyncStorage.getItem('@cache:categories');
        if (catCacheRaw && newCatId) {
          const catList = JSON.parse(catCacheRaw);
          const m = catList.find(c => (c._id === newCatId || c.id === newCatId));
          categoryName = m?.category_name || m?.name || '';
        }
      } catch (_) {}

      // Build merge object for the cached product entries.
      const patch = {};
      if (name !== undefined && name !== '') patch.product_name = name;
      if (listPrice !== undefined && listPrice !== '') { patch.price = parseFloat(listPrice) || 0; patch.list_price = parseFloat(listPrice) || 0; }
      if (standardPrice !== undefined && standardPrice !== '') patch.standard_price = parseFloat(standardPrice) || 0;
      if (barcode !== undefined) patch.barcode = barcode || '';
      if (defaultCode !== undefined) patch.code = defaultCode || '';
      if (newCatId) {
        patch.categ_id = [newCatId, categoryName];
        patch.category_name = categoryName;
        patch.category = { id: newCatId, category_name: categoryName, name: categoryName };
        patch.pos_categ_ids = posCategoryId ? [[posCategoryId, categoryName]] : [];
      }

      // Update every product list cache that contains this product.
      try {
        const keys = await AsyncStorage.getAllKeys();
        const productKeys = await _currentDbProductKeys(keys);
        for (const key of productKeys) {
          try {
            const raw = await AsyncStorage.getItem(key);
            if (!raw) continue;
            const list = JSON.parse(raw);
            const idx = list.findIndex(p => p.id === productId);
            if (idx >= 0) {
              list[idx] = { ...list[idx], ...patch };
              await AsyncStorage.setItem(key, JSON.stringify(list));
            }
          } catch (_) {}
        }
      } catch (_) {}

      // Update the per-product detail cache so the detail view reflects edit.
      try {
        const detailKey = `@cache:productDetail:${productId}`;
        const raw = await AsyncStorage.getItem(detailKey);
        if (raw) {
          const prev = JSON.parse(raw);
          await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, ...patch }));
        }
      } catch (_) {}

      console.log('[updateProductOdoo] Queued offline edit for id:', productId);
      return { offline: true };
    }
  } catch (_) {}

  try {
    const headers = await getOdooAuthHeaders();
    const vals = {};
    if (name !== undefined && name !== '') vals.name = name;
    if (categId) vals.categ_id = categId;
    if (posCategoryId) vals.pos_categ_ids = [[6, 0, [posCategoryId]]];
    if (listPrice !== undefined && listPrice !== '') vals.list_price = parseFloat(listPrice) || 0;
    if (standardPrice !== undefined && standardPrice !== '') vals.standard_price = parseFloat(standardPrice) || 0;
    if (barcode !== undefined) vals.barcode = barcode || false;
    if (defaultCode !== undefined) vals.default_code = defaultCode || false;
    if (image) vals.image_1920 = image;

    console.log('[updateProductOdoo] productId:', productId, 'vals:', JSON.stringify(vals));

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'product.product',
          method: 'write',
          args: [[Number(productId)], vals],
          kwargs: {
            context: {},
          },
        },
      },
      { headers, timeout: 30000 }
    );

    console.log('[updateProductOdoo] response:', JSON.stringify(response.data));

    if (response.data.error) {
      const errMsg = response.data.error?.data?.message || response.data.error?.message || 'Failed to update product';
      console.error('[updateProductOdoo] Odoo error:', errMsg);
      throw new Error(errMsg);
    }

    // Patch the cached product lists so an offline scan picks up the new
    // barcode / code immediately without waiting for a product-list refresh.
    try {
      const patch = {};
      if (name !== undefined && name !== '') patch.product_name = name;
      if (listPrice !== undefined && listPrice !== '') { patch.price = parseFloat(listPrice) || 0; patch.list_price = parseFloat(listPrice) || 0; }
      if (standardPrice !== undefined && standardPrice !== '') patch.standard_price = parseFloat(standardPrice) || 0;
      if (barcode !== undefined) patch.barcode = barcode || '';
      if (defaultCode !== undefined) patch.code = defaultCode || '';
      // Include the new image so the list thumbnail updates without waiting
      // for a full product-list refetch. Store both image_128 (raw base64)
      // and image_url (data URI — what the list renderer reads).
      if (image !== undefined && image !== null && image !== '') {
        const cleanBase64 = String(image).replace(/^data:image\/[^;]+;base64,/, '');
        patch.image_128 = cleanBase64;
        patch.image_url = `data:image/png;base64,${cleanBase64}`;
      }
      if (Object.keys(patch).length > 0) {
        const keys = await AsyncStorage.getAllKeys();
        const productKeys = await _currentDbProductKeys(keys);
        for (const key of productKeys) {
          try {
            const raw = await AsyncStorage.getItem(key);
            if (!raw) continue;
            const list = JSON.parse(raw);
            const idx = list.findIndex(p => p.id === Number(productId) || p.id === productId);
            if (idx >= 0) {
              list[idx] = { ...list[idx], ...patch };
              await AsyncStorage.setItem(key, JSON.stringify(list));
            }
          } catch (_) {}
        }
        try {
          const detailKey = `@cache:productDetail:${productId}`;
          const raw = await AsyncStorage.getItem(detailKey);
          if (raw) {
            const prev = JSON.parse(raw);
            await AsyncStorage.setItem(detailKey, JSON.stringify({ ...prev, ...patch }));
          }
        } catch (_) {}
      }
    } catch (_) {}

    return response.data.result;
  } catch (error) {
    console.error('[updateProductOdoo] error:', error?.message || error);
    throw error;
  }
};

export const fetchVendorsOdoo = async ({ offset = 0, limit = 50, searchText } = {}) => {
  try {
    let domain = [];
    if (searchText && searchText.trim() !== '') {
      const term = searchText.trim();
      domain = ['|', ['name', 'ilike', term], ['phone', 'ilike', term]];
    }
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'email', 'phone'],
            offset, limit, order: 'name asc',
          },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) return [];
    return (response.data.result || []).map(p => ({ id: p.id, name: p.name || '', label: p.name || '', email: p.email || '', phone: p.phone || '' }));
  } catch (error) {
    console.error('[fetchVendorsOdoo] error:', error?.message || error);
    return [];
  }
};

export const createCustomerOdoo = async ({ name, phone, email, company }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const vals = {
      name,
      customer_rank: 1,
    };
    if (phone) vals.phone = phone;
    if (email) vals.email = email;
    if (company) vals.company_name = company;

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'res.partner', method: 'create', args: [vals], kwargs: {} },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create customer');
    return response.data.result;
  } catch (error) {
    console.error('[createCustomerOdoo] error:', error?.message || error);
    throw error;
  }
};

export const createVendorOdoo = async ({ name, phone, email, company }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const vals = {
      name,
      supplier_rank: 1,
    };
    if (phone) vals.phone = phone;
    if (email) vals.email = email;
    if (company) vals.company_name = company;

    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: { model: 'res.partner', method: 'create', args: [vals], kwargs: {} },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error(response.data.error?.data?.message || 'Failed to create vendor');
    return response.data.result; // returns the new partner ID
  } catch (error) {
    console.error('[createVendorOdoo] error:', error?.message || error);
    throw error;
  }
};

// =============================================
// SALE COST PROTECTION
// =============================================

export const fetchSaleCostApprovalLogsOdoo = async ({ offset = 0, limit = 50 } = {}) => {
  try {
    const headers = await getOdooAuthHeaders();
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'sale.cost.approval.log',
          method: 'search_read',
          args: [[]],
          kwargs: {
            fields: ['id', 'sale_order_id', 'approver_id', 'approval_date', 'reason', 'action', 'partner_id', 'order_amount_total', 'currency_id', 'salesperson_id', 'below_cost_details'],
            offset, limit,
            order: 'create_date desc',
          },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) throw new Error('Failed to fetch approval logs');
    return response.data.result || [];
  } catch (error) {
    console.error('[fetchSaleCostApprovalLogsOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch product costs (standard_price) for a list of product IDs
export const fetchProductCostsOdoo = async (productIds) => {
  try {
    if (!productIds || productIds.length === 0) return {};
    const headers = await getOdooAuthHeaders();
    console.log('[fetchProductCostsOdoo] Fetching costs for product IDs:', productIds);
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'product.product', method: 'search_read',
          args: [[['id', 'in', productIds]]],
          kwargs: { fields: ['id', 'standard_price', 'name'], limit: productIds.length },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('[fetchProductCostsOdoo] API error:', JSON.stringify(response.data.error));
      throw new Error('Failed to fetch product costs');
    }
    const results = response.data.result || [];
    console.log('[fetchProductCostsOdoo] Results:', JSON.stringify(results));
    const costMap = {};
    results.forEach(p => { costMap[p.id] = p.standard_price || 0; });
    console.log('[fetchProductCostsOdoo] Cost map:', JSON.stringify(costMap));
    return costMap;
  } catch (error) {
    console.error('[fetchProductCostsOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch below cost protection settings from ir.config_parameter
export const fetchBelowCostSettingsOdoo = async () => {
  try {
    const headers = await getOdooAuthHeaders();
    const params = [
      'sale_cost_protection.enable_below_cost_protection',
      'sale_cost_protection.minimum_margin_percentage',
    ];
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'ir.config_parameter', method: 'get_param',
          args: ['sale_cost_protection.enable_below_cost_protection'],
          kwargs: {},
        },
      },
      { headers, timeout: 10000 }
    );
    const enabled = response.data.result === 'True' || response.data.result === true;

    const marginResp = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'ir.config_parameter', method: 'get_param',
          args: ['sale_cost_protection.minimum_margin_percentage'],
          kwargs: {},
        },
      },
      { headers, timeout: 10000 }
    );
    const minimumMargin = parseFloat(marginResp.data.result) || 0;

    return { enabled, minimumMargin };
  } catch (error) {
    console.error('[fetchBelowCostSettingsOdoo] error:', error?.message || error);
    return { enabled: false, minimumMargin: 0 };
  }
};

// Authenticate an approver by attempting Odoo login with their credentials
export const authenticateApproverOdoo = async (login, password) => {
  try {
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/session/authenticate`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          db: (await AsyncStorage.getItem('odoo_db')) || DEFAULT_ODOO_DB,
          login,
          password,
        },
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    if (response.data.error) return { success: false, error: 'Authentication failed' };
    const uid = response.data.result?.uid;
    if (!uid) return { success: false, error: 'Invalid credentials' };
    // Capture session cookie for approver so we can use their session for privileged operations
    const setCookieHeader = response.headers['set-cookie'];
    let sessionId = null;
    if (setCookieHeader) {
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const cookie of cookies) {
        const match = cookie.match(/session_id=([^;]+)/);
        if (match) { sessionId = match[1]; break; }
      }
    }
    return { success: true, uid, name: response.data.result?.name || login, sessionId };
  } catch (error) {
    console.error('[authenticateApproverOdoo] error:', error?.message || error);
    return { success: false, error: error?.message || 'Authentication failed' };
  }
};

// Create a below-cost approval log entry in Odoo using sudo via create_from_mobile
export const createBelowCostApprovalLogOdoo = async ({ saleOrderId, approverId, reason, action, belowCostDetails }) => {
  try {
    const headers = await getOdooAuthHeaders();
    const vals = {
      sale_order_id: saleOrderId,
      approver_id: approverId,
      reason: reason || '',
      action: action || 'approved',
      below_cost_details: belowCostDetails || '',
    };
    console.log('[createBelowCostApprovalLogOdoo] Creating log with vals:', JSON.stringify(vals));
    const response = await axios.post(
      `${ODOO_BASE_URL()}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'sale.cost.approval.log', method: 'create_from_mobile',
          args: [vals],
          kwargs: { context: {} },
        },
      },
      { headers, timeout: 15000 }
    );
    if (response.data.error) {
      console.error('[createBelowCostApprovalLogOdoo] Odoo error:', JSON.stringify(response.data.error));
      throw new Error(response.data.error.data?.message || 'Failed to create approval log');
    }
    console.log('[createBelowCostApprovalLogOdoo] Success, log ID:', response.data.result);
    return response.data.result;
  } catch (error) {
    console.error('[createBelowCostApprovalLogOdoo] error:', error?.message || error);
    throw error;
  }
};

// =============================================
// INVOICE DETAIL
// =============================================

export const fetchInvoiceDetailOdoo = async (invoiceId) => {
  try {
    if (!invoiceId) return null;
    const headers = await getOdooAuthHeaders();
    const resp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'account.move', method: 'read', args: [[invoiceId]],
        kwargs: { fields: ['id', 'name', 'partner_id', 'invoice_date', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual', 'state', 'payment_state', 'currency_id', 'invoice_line_ids', 'company_id'] },
      },
    }, { headers, timeout: 15000 });
    if (resp.data.error) throw new Error(resp.data.error.data?.message || 'Error');
    const invoice = resp.data.result?.[0];
    if (!invoice) return null;
    let lines = [];
    if (invoice.invoice_line_ids && invoice.invoice_line_ids.length > 0) {
      const linesResp = await axios.post(`${ODOO_BASE_URL()}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'account.move.line', method: 'read',
          args: [invoice.invoice_line_ids],
          kwargs: { fields: ['id', 'product_id', 'name', 'quantity', 'price_unit', 'discount', 'price_subtotal', 'price_total', 'display_type'] },
        },
      }, { headers, timeout: 15000 });
      if (!linesResp.data.error) {
        lines = (linesResp.data.result || []).filter(l =>
          l.product_id && (!l.display_type || l.display_type === 'product')
        );
      }
    }
    const partnerId = Array.isArray(invoice.partner_id) ? invoice.partner_id[0] : null;
    let partnerPhone = '';
    if (partnerId) {
      try { partnerPhone = await fetchPartnerPhoneOdoo(partnerId) || ''; } catch (e) { /* ignore */ }
    }
    const shaped = {
      id: invoice.id, name: invoice.name || '',
      partnerId,
      partnerName: Array.isArray(invoice.partner_id) ? invoice.partner_id[1] : '',
      partnerPhone,
      invoiceDate: invoice.invoice_date ? invoice.invoice_date.split('-').reverse().join('-') : '',
      amountUntaxed: invoice.amount_untaxed || 0, amountTax: invoice.amount_tax || 0,
      amountTotal: invoice.amount_total || 0, amountResidual: invoice.amount_residual || 0,
      state: invoice.state || '', paymentState: invoice.payment_state || '',
      currencyName: Array.isArray(invoice.currency_id) ? invoice.currency_id[1] : '',
      companyName: Array.isArray(invoice.company_id) ? invoice.company_id[1] : '',
      lines: lines.map(l => ({
        id: l.id,
        productName: Array.isArray(l.product_id) ? l.product_id[1] : (l.name || '-'),
        quantity: l.quantity || 0, priceUnit: l.price_unit || 0,
        discount: l.discount || 0, subtotal: l.price_subtotal || 0,
      })),
    };
    try { await AsyncStorage.setItem(`@cache:invoiceDetail:${invoiceId}`, JSON.stringify(shaped)); } catch (_) {}
    return shaped;
  } catch (error) {
    console.error('[fetchInvoiceDetailOdoo] error:', error?.message || error);
    // Offline fallback — return cached invoice if we have one.
    try {
      const cached = await AsyncStorage.getItem(`@cache:invoiceDetail:${invoiceId}`);
      if (cached) {
        console.log('[fetchInvoiceDetailOdoo] Using cached invoice for id:', invoiceId);
        return JSON.parse(cached);
      }
    } catch (_) {}
    return null;
  }
};

// Fetch the current user's company name from res.company
export const fetchCompanyNameOdoo = async () => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const resp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'res.company', method: 'search_read', args: [[]],
        kwargs: { fields: ['id', 'name'], limit: 1 },
      },
    }, { headers, timeout: 10000 });
    if (resp.data.error) return null;
    const company = resp.data.result?.[0];
    const name = company?.name || null;
    if (name) {
      try { await AsyncStorage.setItem('@cache:companyName', JSON.stringify(name)); } catch (_) {}
    }
    return name;
  } catch (e) {
    console.warn('[fetchCompanyNameOdoo] error:', e?.message);
    try {
      const cached = await AsyncStorage.getItem('@cache:companyName');
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
};

// Fetch partner phone number by partner ID
export const fetchPartnerPhoneOdoo = async (partnerId) => {
  try {
    if (!partnerId) return null;
    const { headers, baseUrl } = await authenticateOdoo();
    const resp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'res.partner', method: 'read',
        args: [[partnerId]],
        kwargs: { fields: ['phone', 'mobile'] },
      },
    }, { headers, timeout: 10000 });
    if (resp.data.error) return null;
    const partner = resp.data.result?.[0];
    const phone = partner?.phone || partner?.mobile || null;
    if (phone) {
      try { await AsyncStorage.setItem(`@cache:partnerPhone:${partnerId}`, JSON.stringify(phone)); } catch (_) {}
    }
    return phone;
  } catch (e) {
    console.warn('[fetchPartnerPhoneOdoo] error:', e?.message);
    try {
      const cached = await AsyncStorage.getItem(`@cache:partnerPhone:${partnerId}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}
    return null;
  }
};

// Fetch partner ID from invoice record
export const fetchPartnerIdFromInvoice = async (invoiceId) => {
  try {
    if (!invoiceId) return null;
    const { headers, baseUrl } = await authenticateOdoo();
    const resp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.move', method: 'read', args: [[invoiceId]], kwargs: { fields: ['partner_id'] } },
    }, { headers, timeout: 10000 });
    const inv = resp.data?.result?.[0];
    return inv && Array.isArray(inv.partner_id) ? inv.partner_id[0] : null;
  } catch (e) { return null; }
};

// Fetch partner ID from sale order record
export const fetchPartnerIdFromOrder = async (orderId) => {
  try {
    if (!orderId) return null;
    const { headers, baseUrl } = await authenticateOdoo();
    const resp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'sale.order', method: 'read', args: [[orderId]], kwargs: { fields: ['partner_id'] } },
    }, { headers, timeout: 10000 });
    const so = resp.data?.result?.[0];
    return so && Array.isArray(so.partner_id) ? so.partner_id[0] : null;
  } catch (e) { return null; }
};

// Download invoice PDF from Odoo (uses the mobile_invoice_report module)
export const downloadInvoicePdfOdoo = async (invoiceId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Try multiple report names — Odoo versions use different names
    const reportNames = [
      'mobile_invoice_report.report_mobile_invoice',
      'account.report_invoice_with_payments',
      'account.report_invoice',
    ];

    let lastError = null;
    for (const reportName of reportNames) {
      try {
        const reportUrl = `${baseUrl}/report/pdf/${reportName}/${invoiceId}`;
        console.log('[downloadInvoicePdf] Trying:', reportUrl);

        const response = await axios.get(reportUrl, {
          headers,
          responseType: 'arraybuffer',
          timeout: 60000,
        });

        // Convert arraybuffer to base64
        const uint8Array = new Uint8Array(response.data);
        let binary = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binary += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binary);
        console.log('[downloadInvoicePdf] Success with', reportName, 'base64 length:', base64.length);
        return base64;
      } catch (err) {
        console.warn('[downloadInvoicePdf]', reportName, 'failed:', err?.response?.status || err?.message);
        lastError = err;
      }
    }

    throw lastError || new Error('All report formats failed');
  } catch (error) {
    console.error('[downloadInvoicePdf] error:', error?.message || error);
    throw error;
  }
};

// =============================================
// GROSS PROFIT REPORT
// =============================================

export const generateGrossProfitReportOdoo = async ({ period = 'this_month', dateFrom, dateTo, reportType = 'product' } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Step 1: Create wizard
    const wizardVals = { period, report_type: reportType };
    if (period === 'custom' && dateFrom) wizardVals.date_from = dateFrom;
    if (period === 'custom' && dateTo) wizardVals.date_to = dateTo;

    const createResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'gp.report.wizard', method: 'create', args: [wizardVals], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (createResp.data.error) throw new Error(createResp.data.error.data?.message || 'Failed to create wizard');
    const wizardId = createResp.data.result;

    // Step 2: Generate report
    const genResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'gp.report.wizard', method: 'action_generate_report', args: [[wizardId]], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (genResp.data.error) throw new Error(genResp.data.error.data?.message || 'Failed to generate report');

    // Step 3: Read wizard summary
    const summaryResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'gp.report.wizard', method: 'read', args: [[wizardId]],
        kwargs: { fields: ['total_sales', 'total_cogs', 'total_gp', 'total_gp_margin', 'date_from', 'date_to', 'line_ids'] },
      },
    }, { headers, timeout: 15000 });
    if (summaryResp.data.error) throw new Error(summaryResp.data.error.data?.message || 'Failed to read summary');
    const wizard = summaryResp.data.result?.[0] || {};

    // Step 4: Read report lines
    let lines = [];
    if (wizard.line_ids && wizard.line_ids.length > 0) {
      const linesResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'gross.profit.report.line', method: 'read', args: [wizard.line_ids],
          kwargs: { fields: ['product_id', 'product_categ_id', 'salesperson_id', 'partner_id', 'company_id', 'invoice_id', 'quantity', 'sale_amount', 'cost_amount', 'gross_profit', 'gp_margin', 'unit_sale_price', 'unit_cost_price'] },
        },
      }, { headers, timeout: 15000 });
      if (!linesResp.data.error) lines = linesResp.data.result || [];
    }

    return {
      summary: {
        totalSales: wizard.total_sales || 0,
        totalCogs: wizard.total_cogs || 0,
        totalGP: wizard.total_gp || 0,
        totalGPMargin: wizard.total_gp_margin || 0,
        dateFrom: wizard.date_from || '',
        dateTo: wizard.date_to || '',
      },
      lines: lines.map(l => ({
        id: l.id,
        name: _extractName(l, reportType),
        quantity: l.quantity || 0,
        saleAmount: l.sale_amount || 0,
        costAmount: l.cost_amount || 0,
        grossProfit: l.gross_profit || 0,
        gpMargin: l.gp_margin || 0,
      })),
    };
  } catch (error) {
    console.error('[generateGrossProfitReportOdoo] error:', error?.message || error);
    throw error;
  }
};

function _extractName(line, reportType) {
  switch (reportType) {
    case 'product': return Array.isArray(line.product_id) ? line.product_id[1] : (line.product_id || '-');
    case 'salesperson': return Array.isArray(line.salesperson_id) ? line.salesperson_id[1] : (line.salesperson_id || '-');
    case 'customer': return Array.isArray(line.partner_id) ? line.partner_id[1] : (line.partner_id || '-');
    case 'category': return Array.isArray(line.product_categ_id) ? line.product_categ_id[1] : (line.product_categ_id || '-');
    case 'company': return Array.isArray(line.company_id) ? line.company_id[1] : (line.company_id || '-');
    case 'detailed': return Array.isArray(line.invoice_id) ? line.invoice_id[1] : (Array.isArray(line.product_id) ? line.product_id[1] : '-');
    default: return '-';
  }
}

// =============================================
// PARTNER LEDGER DYNAMIC
// =============================================

export const generatePartnerLedgerOdoo = async ({ partnerType = 'customer_supplier', period, dateFrom, dateTo, targetMove = 'posted', partnerIds } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();

    // Step 1: Create wizard
    const wizardVals = {
      result_selection: partnerType,
      target_move: targetMove,
      reconciled: true,
      with_currency: true,
      company_scope: 'all_companies',
    };
    if (partnerIds && partnerIds.length > 0) {
      wizardVals.partner_ids = [[6, 0, partnerIds]];
    }
    if (period && period !== 'custom') wizardVals.period = period;
    if (period === 'custom' && dateFrom) wizardVals.date_from = dateFrom;
    if (period === 'custom' && dateTo) wizardVals.date_to = dateTo;

    const createResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.report.partner.ledger', method: 'create', args: [wizardVals], kwargs: {} },
    }, { headers, timeout: 15000 });
    if (createResp.data.error) throw new Error(createResp.data.error.data?.message || 'Failed to create wizard');
    const wizardId = createResp.data.result;

    // If period is not custom, trigger onchange to calculate dates, then write them
    if (period && period !== 'custom') {
      try {
        const onchangeResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
          jsonrpc: '2.0', method: 'call',
          params: { model: 'account.report.partner.ledger', method: 'write', args: [[wizardId], { period }], kwargs: {} },
        }, { headers, timeout: 10000 });
      } catch (e) { /* ignore onchange errors */ }
    }

    // Step 2: Generate report
    const genResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: { model: 'account.report.partner.ledger', method: 'action_generate_report', args: [[wizardId]], kwargs: {} },
    }, { headers, timeout: 30000 });
    if (genResp.data.error) throw new Error(genResp.data.error.data?.message || 'Failed to generate report');

    const action = genResp.data.result;
    const reportId = action?.res_id;
    if (!reportId) throw new Error('No report ID returned');

    // Step 3: Read report summary
    const reportResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'pl.dynamic.report', method: 'read', args: [[reportId]],
        kwargs: { fields: ['name', 'company_id', 'partner_type', 'date_from', 'date_to', 'report_currency', 'grand_debit', 'grand_credit', 'grand_balance', 'partner_ids'] },
      },
    }, { headers, timeout: 15000 });
    if (reportResp.data.error) throw new Error(reportResp.data.error.data?.message || 'Failed to read report');
    const report = reportResp.data.result?.[0] || {};

    // Step 4: Read partner summary rows
    let partners = [];
    if (report.partner_ids && report.partner_ids.length > 0) {
      const partnersResp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
        jsonrpc: '2.0', method: 'call',
        params: {
          model: 'pl.dynamic.report.partner', method: 'read', args: [report.partner_ids],
          kwargs: { fields: ['id', 'partner_name', 'opening_debit', 'opening_credit', 'opening_balance', 'total_debit', 'total_credit', 'closing_balance'] },
        },
      }, { headers, timeout: 15000 });
      if (!partnersResp.data.error) partners = partnersResp.data.result || [];
    }

    return {
      reportId,
      summary: {
        name: report.name || '',
        companyName: Array.isArray(report.company_id) ? report.company_id[1] : '',
        partnerType: report.partner_type || '',
        dateFrom: report.date_from || '',
        dateTo: report.date_to || '',
        currency: report.report_currency || '',
        grandDebit: report.grand_debit || 0,
        grandCredit: report.grand_credit || 0,
        grandBalance: report.grand_balance || 0,
      },
      partners: partners.map(p => ({
        id: p.id,
        name: p.partner_name || '-',
        openingDebit: p.opening_debit || 0,
        openingCredit: p.opening_credit || 0,
        openingBalance: p.opening_balance || 0,
        totalDebit: p.total_debit || 0,
        totalCredit: p.total_credit || 0,
        closingBalance: p.closing_balance || 0,
      })),
    };
  } catch (error) {
    console.error('[generatePartnerLedgerOdoo] error:', error?.message || error);
    throw error;
  }
};

export const fetchPartnerLedgerLinesOdoo = async (reportId, partnerName) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const domain = [['report_id', '=', reportId]];
    if (partnerName) domain.push(['partner_name', '=', partnerName]);

    const resp = await axios.post(`${baseUrl}/web/dataset/call_kw`, {
      jsonrpc: '2.0', method: 'call',
      params: {
        model: 'pl.dynamic.report.line', method: 'search_read',
        args: [domain],
        kwargs: {
          fields: ['id', 'partner_name', 'date', 'journal_code', 'reference', 'label', 'due_date', 'debit', 'credit', 'balance', 'running_balance'],
          order: 'date, id',
          limit: 500,
        },
      },
    }, { headers, timeout: 15000 });
    if (resp.data.error) throw new Error(resp.data.error.data?.message || 'Failed to fetch lines');
    return (resp.data.result || []).map(l => ({
      id: l.id,
      date: l.date || '',
      journalCode: l.journal_code || '',
      reference: l.reference || '',
      label: l.label || '',
      dueDate: l.due_date || '',
      debit: l.debit || 0,
      credit: l.credit || 0,
      balance: l.balance || 0,
      runningBalance: l.running_balance || 0,
    }));
  } catch (error) {
    console.error('[fetchPartnerLedgerLinesOdoo] error:', error?.message || error);
    throw error;
  }
};

// ---- Credit Management APIs ----

// Fetch credit facility applications from Odoo (All Applications)
export const fetchCreditApplicationsOdoo = async ({ searchText = '', offset = 0, limit = 100, state = '' } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let domain = [];
    if (searchText) {
      domain.push('|', ['name', 'ilike', searchText], ['partner_id.name', 'ilike', searchText]);
    }
    if (state) {
      domain.push(['state', '=', state]);
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'partner_id', 'credit_limit', 'state', 'submission_date', 'credit_issue_date', 'credit_expiry_date', 'company_name', 'phone_number', 'email', 'use_credit_facility', 'currency_id', 'approved_by', 'approval_date', 'rejection_reason'],
            offset,
            limit,
            order: 'submission_date desc, id desc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch credit applications');
    }
    return (response.data.result || []).map(app => ({
      id: app.id,
      name: app.name || '',
      partner_id: Array.isArray(app.partner_id) ? app.partner_id[0] : app.partner_id,
      partner_name: Array.isArray(app.partner_id) ? app.partner_id[1] : '',
      credit_limit: app.credit_limit || 0,
      state: app.state || 'draft',
      submission_date: app.submission_date || '',
      credit_issue_date: app.credit_issue_date || '',
      credit_expiry_date: app.credit_expiry_date || '',
      company_name: app.company_name || '',
      phone_number: app.phone_number || '',
      email: app.email || '',
      use_credit_facility: app.use_credit_facility || '',
      currency: Array.isArray(app.currency_id) ? app.currency_id[1] : '',
      approved_by: Array.isArray(app.approved_by) ? app.approved_by[1] : '',
      approval_date: app.approval_date || '',
      rejection_reason: app.rejection_reason || '',
    }));
  } catch (error) {
    console.error('[fetchCreditApplicationsOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch credit exceeded customers (Credit Exceeded Dashboard)
export const fetchCreditExceededOdoo = async ({ searchText = '', offset = 0, limit = 100 } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    // Query res.partner with custom_credit_limit > 0 (matches Odoo dashboard domain)
    let domain = [['customer_rank', '>', 0], ['custom_credit_limit', '>', 0]];
    if (searchText) {
      domain.push(['name', 'ilike', searchText]);
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'custom_credit_limit', 'total_due', 'available_credit', 'risk_score', 'risk_level', 'is_credit_hold', 'phone', 'email', 'country_id'],
            offset,
            limit,
            order: 'risk_score desc, id desc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch credit exceeded data');
    }
    return (response.data.result || []).map(p => ({
      id: p.id,
      name: p.name || '',
      custom_credit_limit: p.custom_credit_limit || 0,
      total_due: p.total_due || 0,
      available_credit: p.available_credit || 0,
      risk_score: p.risk_score || 0,
      risk_level: p.risk_level || 'low',
      is_credit_hold: p.is_credit_hold || false,
      phone: p.phone || '',
      email: p.email || '',
      country: Array.isArray(p.country_id) ? p.country_id[1] : '',
    }));
  } catch (error) {
    console.error('[fetchCreditExceededOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch credit risk history records from Odoo
export const fetchCreditRiskHistoryOdoo = async ({ searchText = '', offset = 0, limit = 100 } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let domain = [];
    if (searchText) {
      domain.push(['partner_id.name', 'ilike', searchText]);
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'risk.score.history',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'partner_id', 'old_risk_score', 'new_risk_score', 'old_risk_level', 'new_risk_level', 'change_date', 'reason'],
            offset,
            limit,
            order: 'change_date desc, id desc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch risk history');
    }
    return (response.data.result || []).map(r => ({
      id: r.id,
      partner_id: Array.isArray(r.partner_id) ? r.partner_id[0] : (r.partner_id || null),
      partner_name: Array.isArray(r.partner_id) ? r.partner_id[1] : '',
      old_risk_score: r.old_risk_score || 0,
      new_risk_score: r.new_risk_score || 0,
      old_risk_level: r.old_risk_level || '',
      new_risk_level: r.new_risk_level || '',
      change_date: r.change_date || '',
      reason: r.reason || '',
    }));
  } catch (error) {
    console.error('[fetchCreditRiskHistoryOdoo] error:', error?.message || error);
    throw error;
  }
};

// Create a new credit facility application in Odoo
export const createCreditFacilityOdoo = async (data = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const vals = {};
    // Header fields
    if (data.partner_id) vals.partner_id = data.partner_id;
    if (data.credit_limit) vals.credit_limit = parseFloat(data.credit_limit) || 0;
    if (data.use_credit_facility) vals.use_credit_facility = data.use_credit_facility;

    // Company Information
    if (data.company_name) vals.company_name = data.company_name;
    if (data.company_address) vals.company_address = data.company_address;
    if (data.phone_number) vals.phone_number = data.phone_number;
    if (data.email) vals.email = data.email;
    if (data.fax) vals.fax = data.fax;
    if (data.trade_license_no) vals.trade_license_no = data.trade_license_no;
    if (data.po_box) vals.po_box = data.po_box;
    if (data.license_issue_date) vals.license_issue_date = data.license_issue_date;
    if (data.license_expiry_date) vals.license_expiry_date = data.license_expiry_date;
    if (data.credit_issue_date) vals.credit_issue_date = data.credit_issue_date;
    if (data.credit_expiry_date) vals.credit_expiry_date = data.credit_expiry_date;

    // Branch Details
    if (data.branch_mobile_no) vals.branch_mobile_no = data.branch_mobile_no;
    if (data.branch_tele) vals.branch_tele = data.branch_tele;
    if (data.branch_fax) vals.branch_fax = data.branch_fax;

    // Business & Proprietors
    if (data.local_sponsor) vals.local_sponsor = data.local_sponsor;
    if (data.occupation) vals.occupation = data.occupation;
    if (data.proprietor_name_1) vals.proprietor_name_1 = data.proprietor_name_1;
    if (data.proprietor_nationality_1) vals.proprietor_nationality_1 = data.proprietor_nationality_1;
    if (data.proprietor_holding_1) vals.proprietor_holding_1 = data.proprietor_holding_1;
    if (data.proprietor_name_2) vals.proprietor_name_2 = data.proprietor_name_2;
    if (data.proprietor_nationality_2) vals.proprietor_nationality_2 = data.proprietor_nationality_2;
    if (data.proprietor_holding_2) vals.proprietor_holding_2 = data.proprietor_holding_2;
    if (data.proprietor_name_3) vals.proprietor_name_3 = data.proprietor_name_3;
    if (data.proprietor_nationality_3) vals.proprietor_nationality_3 = data.proprietor_nationality_3;
    if (data.proprietor_holding_3) vals.proprietor_holding_3 = data.proprietor_holding_3;

    // Authorized Signatories
    if (data.signatory_name_1) vals.signatory_name_1 = data.signatory_name_1;
    if (data.signatory_nationality_1) vals.signatory_nationality_1 = data.signatory_nationality_1;
    if (data.signatory_signature_1) vals.signatory_signature_1 = data.signatory_signature_1;
    if (data.signatory_name_2) vals.signatory_name_2 = data.signatory_name_2;
    if (data.signatory_nationality_2) vals.signatory_nationality_2 = data.signatory_nationality_2;
    if (data.signatory_signature_2) vals.signatory_signature_2 = data.signatory_signature_2;
    if (data.signatory_name_3) vals.signatory_name_3 = data.signatory_name_3;
    if (data.signatory_nationality_3) vals.signatory_nationality_3 = data.signatory_nationality_3;
    if (data.signatory_signature_3) vals.signatory_signature_3 = data.signatory_signature_3;

    // Purchasing Contacts
    if (data.purchasing_name_1) vals.purchasing_name_1 = data.purchasing_name_1;
    if (data.purchasing_title_1) vals.purchasing_title_1 = data.purchasing_title_1;
    if (data.purchasing_tele_1) vals.purchasing_tele_1 = data.purchasing_tele_1;
    if (data.purchasing_fax_1) vals.purchasing_fax_1 = data.purchasing_fax_1;
    if (data.purchasing_email_1) vals.purchasing_email_1 = data.purchasing_email_1;
    if (data.purchasing_signature_1) vals.purchasing_signature_1 = data.purchasing_signature_1;
    if (data.purchasing_name_2) vals.purchasing_name_2 = data.purchasing_name_2;
    if (data.purchasing_title_2) vals.purchasing_title_2 = data.purchasing_title_2;
    if (data.purchasing_tele_2) vals.purchasing_tele_2 = data.purchasing_tele_2;
    if (data.purchasing_fax_2) vals.purchasing_fax_2 = data.purchasing_fax_2;
    if (data.purchasing_email_2) vals.purchasing_email_2 = data.purchasing_email_2;
    if (data.purchasing_signature_2) vals.purchasing_signature_2 = data.purchasing_signature_2;

    // Accounts Contact
    if (data.accounts_name) vals.accounts_name = data.accounts_name;
    if (data.accounts_tele) vals.accounts_tele = data.accounts_tele;
    if (data.accounts_fax) vals.accounts_fax = data.accounts_fax;
    if (data.accounts_email) vals.accounts_email = data.accounts_email;
    if (data.accounts_signature) vals.accounts_signature = data.accounts_signature;
    if (data.date_business_started) vals.date_business_started = data.date_business_started;
    if (data.any_other_business) vals.any_other_business = data.any_other_business;
    if (data.business_description) vals.business_description = data.business_description;

    // Financial Information
    if (data.sales_volume) vals.sales_volume = data.sales_volume;
    if (data.sales_days) vals.sales_days = data.sales_days;
    if (data.bank_name_1) vals.bank_name_1 = data.bank_name_1;
    if (data.bank_account_1) vals.bank_account_1 = data.bank_account_1;
    if (data.bank_branch_1) vals.bank_branch_1 = data.bank_branch_1;
    if (data.bank_country_1) vals.bank_country_1 = data.bank_country_1;
    if (data.bank_tele_1) vals.bank_tele_1 = data.bank_tele_1;
    if (data.bank_fax_1) vals.bank_fax_1 = data.bank_fax_1;
    if (data.bank_name_2) vals.bank_name_2 = data.bank_name_2;
    if (data.bank_account_2) vals.bank_account_2 = data.bank_account_2;
    if (data.bank_branch_2) vals.bank_branch_2 = data.bank_branch_2;
    if (data.bank_country_2) vals.bank_country_2 = data.bank_country_2;
    if (data.bank_tele_2) vals.bank_tele_2 = data.bank_tele_2;
    if (data.bank_fax_2) vals.bank_fax_2 = data.bank_fax_2;

    // Document Uploads (base64)
    if (data.trade_license_file) vals.trade_license_file = data.trade_license_file;
    if (data.tax_registration_file) vals.tax_registration_file = data.tax_registration_file;
    if (data.nationality_id_file) vals.nationality_id_file = data.nationality_id_file;
    if (data.passport_copy_file) vals.passport_copy_file = data.passport_copy_file;
    if (data.credit_application_file) vals.credit_application_file = data.credit_application_file;

    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'create',
          args: [vals],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 30000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to create credit facility');
    }
    return response.data.result;
  } catch (error) {
    console.error('[createCreditFacilityOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch a single credit facility application with ALL fields
export const fetchCreditFacilityDetailOdoo = async (facilityId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'read',
          args: [[facilityId]],
          kwargs: {
            fields: [
              'id', 'name', 'partner_id', 'credit_limit', 'state', 'submission_date',
              'use_credit_facility', 'currency_id', 'approved_by', 'approval_date', 'rejection_reason',
              'company_name', 'company_address', 'fax', 'phone_number', 'trade_license_no', 'po_box', 'email',
              'license_issue_date', 'license_expiry_date', 'credit_issue_date', 'credit_expiry_date',
              'branch_mobile_no', 'branch_tele', 'branch_fax',
              'local_sponsor', 'occupation',
              'proprietor_name_1', 'proprietor_nationality_1', 'proprietor_holding_1',
              'proprietor_name_2', 'proprietor_nationality_2', 'proprietor_holding_2',
              'proprietor_name_3', 'proprietor_nationality_3', 'proprietor_holding_3',
              'signatory_name_1', 'signatory_nationality_1', 'signatory_signature_1',
              'signatory_name_2', 'signatory_nationality_2', 'signatory_signature_2',
              'signatory_name_3', 'signatory_nationality_3', 'signatory_signature_3',
              'purchasing_name_1', 'purchasing_title_1', 'purchasing_tele_1', 'purchasing_fax_1', 'purchasing_email_1', 'purchasing_signature_1',
              'purchasing_name_2', 'purchasing_title_2', 'purchasing_tele_2', 'purchasing_fax_2', 'purchasing_email_2', 'purchasing_signature_2',
              'accounts_name', 'accounts_tele', 'accounts_fax', 'accounts_email', 'accounts_signature',
              'date_business_started', 'any_other_business', 'business_description',
              'sales_volume', 'sales_days',
              'bank_name_1', 'bank_account_1', 'bank_branch_1', 'bank_country_1', 'bank_tele_1', 'bank_fax_1',
              'bank_name_2', 'bank_account_2', 'bank_branch_2', 'bank_country_2', 'bank_tele_2', 'bank_fax_2',
              'trade_license_file', 'tax_registration_file', 'nationality_id_file', 'passport_copy_file', 'credit_application_file',
            ],
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch credit facility detail');
    }
    const records = response.data.result || [];
    if (records.length === 0) throw new Error('Credit facility not found');
    const app = records[0];
    return {
      ...app,
      partner_name: Array.isArray(app.partner_id) ? app.partner_id[1] : '',
      partner_id_val: Array.isArray(app.partner_id) ? app.partner_id[0] : app.partner_id,
      currency: Array.isArray(app.currency_id) ? app.currency_id[1] : '',
      approved_by_name: Array.isArray(app.approved_by) ? app.approved_by[1] : '',
    };
  } catch (error) {
    console.error('[fetchCreditFacilityDetailOdoo] error:', error?.message || error);
    throw error;
  }
};

// Approve a credit facility application
export const approveCreditFacilityOdoo = async (facilityId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'action_approve',
          args: [[facilityId]],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to approve credit facility');
    }
    return response.data.result;
  } catch (error) {
    console.error('[approveCreditFacilityOdoo] error:', error?.message || error);
    throw error;
  }
};

// Reject a credit facility application
export const rejectCreditFacilityOdoo = async (facilityId, rejectionReason) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    // First write the rejection reason
    await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'write',
          args: [[facilityId], { rejection_reason: rejectionReason || '' }],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    // Then call action_reject
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'action_reject',
          args: [[facilityId]],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to reject credit facility');
    }
    return response.data.result;
  } catch (error) {
    console.error('[rejectCreditFacilityOdoo] error:', error?.message || error);
    throw error;
  }
};

// Reset a credit facility application to draft
export const resetCreditFacilityToDraftOdoo = async (facilityId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'action_reset_to_draft',
          args: [[facilityId]],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to reset credit facility');
    }
    return response.data.result;
  } catch (error) {
    console.error('[resetCreditFacilityToDraftOdoo] error:', error?.message || error);
    throw error;
  }
};

// Submit a credit facility application for approval
export const submitCreditFacilityOdoo = async (facilityId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'credit.facility',
          method: 'action_submit',
          args: [[facilityId]],
          kwargs: {},
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to submit credit facility');
    }
    return response.data.result;
  } catch (error) {
    console.error('[submitCreditFacilityOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch customers with credit-related fields from Odoo
export const fetchCustomerCreditsOdoo = async ({ searchText = '', offset = 0, limit = 100 } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    let domain = [['customer_rank', '>', 0]];
    if (searchText) {
      domain = ['&', ['customer_rank', '>', 0], ['name', 'ilike', searchText]];
    }
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'credit_limit', 'credit', 'debit', 'phone', 'email'],
            offset,
            limit,
            order: 'name asc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch customer credits');
    }
    return (response.data.result || []).map(p => ({
      id: p.id,
      name: p.name || '',
      credit_limit: p.credit_limit || 0,
      credit: p.credit || 0,
      debit: p.debit || 0,
      phone: p.phone || '',
      email: p.email || '',
    }));
  } catch (error) {
    console.error('[fetchCustomerCreditsOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch posted customer invoices/refunds for a specific partner
export const fetchCustomerCreditInvoicesOdoo = async (partnerId, { offset = 0, limit = 20 } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const domain = [
      ['partner_id', '=', partnerId],
      ['move_type', 'in', ['out_invoice', 'out_refund']],
      ['state', '=', 'posted'],
    ];
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.move',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'name', 'date', 'invoice_date', 'move_type', 'amount_total', 'amount_residual', 'state', 'payment_state'],
            offset,
            limit,
            order: 'date desc, id desc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 15000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch invoices');
    }
    return (response.data.result || []).map(inv => ({
      id: inv.id,
      name: inv.name || '',
      date: inv.date || inv.invoice_date || '',
      move_type: inv.move_type || '',
      amount_total: inv.amount_total || 0,
      amount_residual: inv.amount_residual || 0,
      state: inv.state || '',
      payment_state: inv.payment_state || '',
    }));
  } catch (error) {
    console.error('[fetchCustomerCreditInvoicesOdoo] error:', error?.message || error);
    throw error;
  }
};

// Fetch unreconciled receivable lines for aging analysis
export const fetchCreditAgingOdoo = async ({ limit = 500 } = {}) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const domain = [
      ['partner_id.customer_rank', '>', 0],
      ['account_type', '=', 'asset_receivable'],
      ['reconciled', '=', false],
      ['amount_residual', '>', 0],
    ];
    const response = await axios.post(
      `${baseUrl}/web/dataset/call_kw`,
      {
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'account.move.line',
          method: 'search_read',
          args: [domain],
          kwargs: {
            fields: ['id', 'partner_id', 'date_maturity', 'date', 'amount_residual'],
            limit,
            order: 'date_maturity asc',
          },
        },
      },
      { headers, withCredentials: true, timeout: 30000 }
    );
    if (response.data.error) {
      throw new Error(response.data.error.data?.message || 'Failed to fetch aging data');
    }
    return (response.data.result || []).map(l => ({
      id: l.id,
      partner_id: Array.isArray(l.partner_id) ? l.partner_id[0] : l.partner_id,
      partner_name: Array.isArray(l.partner_id) ? l.partner_id[1] : '',
      date_maturity: l.date_maturity || l.date || '',
      amount_residual: l.amount_residual || 0,
    }));
  } catch (error) {
    console.error('[fetchCreditAgingOdoo] error:', error?.message || error);
    throw error;
  }
};

export const downloadPartnerLedgerExcelOdoo = async (reportId) => {
  try {
    const { headers, baseUrl } = await authenticateOdoo();
    const resp = await axios.get(`${baseUrl}/pl_dynamic/excel/${reportId}`, {
      headers,
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    const base64 = Buffer.from(resp.data, 'binary').toString('base64');
    return base64;
  } catch (error) {
    console.error('[downloadPartnerLedgerExcelOdoo] error:', error?.message || error);
    throw error;
  }
};