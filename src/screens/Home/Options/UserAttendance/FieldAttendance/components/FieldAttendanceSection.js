import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Platform, Modal, TextInput,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { StyledAlertModal } from '@components/Modal';
import { showToastMessage } from '@components/Toast';
import { FONT_FAMILY } from '@constants/theme';
import {
  getFieldAttendanceStateOdoo,
  closePreviousTripOdoo,
  setupPrimaryTripOdoo,
  createAdditionalTripOdoo,
  createReturnTripOdoo,
  fieldActionCheckOutOdoo,
  readVehicleTrackingForTripIdsOdoo,
  readFieldAttendanceDetailOdoo,
  readVehicleLocationsOdoo,
} from '@api/services/generalApi';
import { submitLateReason } from '@services/AttendanceService';
import { consumePendingNewTrip } from '@utils/newTripChannel';
import { consumePendingNewVisit } from '@utils/newVisitChannel';
import {
  getPendingSecondaryTrip,
  clearPendingSecondaryTrip,
} from '@utils/pendingSecondaryTrip';
import TripDetailSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripDetailSheet';
import VisitsListSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitsListSheet';
import VisitDetailSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitDetailSheet';
import AddFuelSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/AddFuelSheet';
import WorkflowBanner from '@screens/Home/Options/UserAttendance/FieldAttendance/components/WorkflowBanner';
import ClosePreviousTripSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/ClosePreviousTripSheet';
import TripFormSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripFormSheet';

const FIELD_COLOR = '#1976D2';

// Grep "[FA-SECTION]" in Metro / device log to follow the section's lifecycle
// regardless of which parent screen (UserAttendanceScreen or
// FieldAttendanceDetailScreen) is hosting it.
const TAG = '[FA-SECTION]';

const ERROR_MESSAGES = {
  start_km_required: 'Start KM is required and must be greater than 0.',
  start_km_invalid: 'Start KM must be a valid number.',
  end_km_too_low: 'End KM must be greater than the trip\'s Start KM.',
  end_km_invalid: 'End KM must be a valid number.',
  trip_not_found: 'Trip not found.',
  no_previous_trip: 'No previous trip to close.',
  already_closed: 'The previous trip is already closed.',
  already_checked_out: 'Attendance is already checked out.',
  checked_out: 'Cannot edit a checked-out attendance.',
  invalid_leg_type: 'Please choose Via Office or Direct.',
  not_found: 'Attendance record not found.',
};
const errMsg = (code, fallback = 'Operation failed') => ERROR_MESSAGES[code] || fallback;

/**
 * Reusable Field-Attendance flow section. Owns its own state + RPC traffic
 * but renders inline so the parent screen (e.g. UserAttendanceScreen) keeps
 * control of the SafeAreaView / NavigationHeader / check-in widgets.
 *
 * Props:
 *   - attendanceId       : number (required) — the hr.attendance to drive.
 *   - embedded           : bool   — when true, omit the internal ScrollView so
 *                                   the parent's ScrollView handles scrolling.
 *                                   Also omits the "Check Out Now" button (parent
 *                                   typically renders its own).
 *   - showCheckOutButton : bool   — when true (and not embedded), render the
 *                                   built-in Check Out Now button. Default false.
 *   - onCheckedOut       : fn     — called after a successful check-out.
 */
const FieldAttendanceSection = ({
  attendanceId,
  embedded = false,
  showCheckOutButton = false,
  onCheckedOut,
  // Parent (e.g. UserAttendanceScreen) bumps this after a successful
  // check-out so the embedded section re-fetches and locks down the UI
  // (read-only banner, hidden CTAs, hidden Add Fuel). Initial 0 → skipped.
  refreshTrigger = 0,
}) => {
  const navigation = useNavigation();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Late info (is_late / reason / deduction) — fetched separately because the
  // trip-state RPC doesn't carry it. Drives the Late card + Update Reason.
  const [lateDetail, setLateDetail] = useState(null);
  const [lateUpdateOpen, setLateUpdateOpen] = useState(false);
  const [lateUpdateText, setLateUpdateText] = useState('');
  const [lateUpdateSaving, setLateUpdateSaving] = useState(false);

  // Remembers which "Setup ..." sheet was open when the user tapped "Create
  // New Trip / Visit" inside the picker. On focus return from
  // VehicleTrackingForm / VisitForm, we use this to:
  //   - auto-attach the new trip if primary
  //   - re-open the same sheet otherwise (user picks normally)
  // See the useFocusEffect below.
  const lastActiveSheetRef = useRef(null);
  // Trip id captured before navigating from TripDetailSheet to
  // VehicleTrackingForm, so the detail popup can be re-fetched and
  // re-opened on back-navigation return.
  const lastDetailTripIdRef = useRef(null);
  // Set when the user taps the edit pencil inside a trip picker so that on
  // back-navigation return, the restored TripFormSheet also re-opens its
  // internal Pick-a-Trip picker (the layer the user was actually viewing).
  const [autoOpenPickerOnRestore, setAutoOpenPickerOnRestore] = useState(false);

  // Stashes the freshly-created trip/visit id captured in `useFocusEffect`
  // (from `consumePendingNewTrip` / `consumePendingNewVisit`) so the
  // re-opened TripFormSheet can auto-select it via `initialSelected*` props.
  // Cleared via setter after one render so a subsequent manual open doesn't
  // stick a stale selection.
  const [pendingTripId, setPendingTripId] = useState(null);
  const [pendingVisitId, setPendingVisitId] = useState(null);

  // Two-phase secondary/additional flow: a "pending" trip is a vehicle.tracking
  // row already created by Start Trip whose customer.visit hasn't been entered
  // yet. The marker is persisted in AsyncStorage and reflected on the FA
  // screen as a Pending Trip Card so the user knows to enter the visit when
  // they reach the visit location (and the visit's lat/lng is captured there).
  const [pendingSecondary, setPendingSecondary] = useState(null);
  // Hydrated server-side details for the pending trip (ref, etc.) — fetched
  // on demand so the card can render the actual VT-#### reference.
  const [pendingTripHydrated, setPendingTripHydrated] = useState(null);

  // Sheets driven by per-card button taps (Open Trip / View Visits).
  const [tripDetailOpen, setTripDetailOpen] = useState(false);
  const [tripDetailLoading, setTripDetailLoading] = useState(false);
  const [tripDetailTrip, setTripDetailTrip] = useState(null);
  const [visitsListOpen, setVisitsListOpen] = useState(false);
  const [visitsListRows, setVisitsListRows] = useState([]);
  // Visit detail popup — mirrors trip detail (Open Trip → TripDetailSheet).
  // Tapping a row in VisitsListSheet opens this overview popup; the user
  // then taps "Open in Customer Visit" inside the popup to navigate to
  // the full Customer Visit screen.
  const [visitDetailOpen, setVisitDetailOpen] = useState(false);
  const [visitDetailVisit, setVisitDetailVisit] = useState(null);
  // Add Fuel popup — opens directly in FA section (no navigation to VTF).
  const [addFuelOpen, setAddFuelOpen] = useState(false);
  const [addFuelTrip, setAddFuelTrip] = useState(null);

  const handleOpenTrip = async (tripId) => {
    if (!tripId) return;
    console.log(TAG, 'handleOpenTrip', { tripId });
    setTripDetailOpen(true);
    setTripDetailLoading(true);
    setTripDetailTrip(null);
    try {
      const rows = await readVehicleTrackingForTripIdsOdoo([Number(tripId)]);
      setTripDetailTrip(rows?.[0] || null);
    } catch (e) {
      console.error(TAG, 'handleOpenTrip threw:', e?.message);
      showToastMessage('Failed to load trip');
    } finally {
      setTripDetailLoading(false);
    }
  };

  const handleViewVisits = (visits) => {
    const rows = Array.isArray(visits) ? visits.filter(Boolean) : (visits ? [visits] : []);
    console.log(TAG, 'handleViewVisits', { count: rows.length });
    if (rows.length === 0) {
      showToastMessage('No visits attached');
      return;
    }
    // Single visit (the common case for outbound/return trip lines) — skip
    // the intermediate list popup and open the detail overview directly.
    // Multi-visit cases (e.g. primary trip's source_visits array) still go
    // through the list so the user can pick which one to inspect.
    if (rows.length === 1) {
      console.log(TAG, '  single visit — opening VisitDetailSheet directly', { visitId: rows[0]?.id });
      setVisitDetailVisit(rows[0]);
      setVisitDetailOpen(true);
      return;
    }
    setVisitsListRows(rows);
    setVisitsListOpen(true);
  };

  // Sheet visibility
  const [closePrevOpen, setClosePrevOpen] = useState(false);
  const [closePrevMeta, setClosePrevMeta] = useState({ ref: '', startKm: 0 });
  const [pendingNextAction, setPendingNextAction] = useState(null);
  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [outboundOpen, setOutboundOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [officeHomeOpen, setOfficeHomeOpen] = useState(false);

  const [alertModal, setAlertModal] = useState({
    visible: false, message: '', confirmText: 'OK', cancelText: '',
    destructive: false, onConfirm: null,
  });
  const hideAlert = useCallback(() => setAlertModal((s) => ({ ...s, visible: false })), []);
  const showAlert = useCallback((opts) => {
    setAlertModal({
      visible: true,
      message: opts?.message || '',
      confirmText: opts?.confirmText || 'OK',
      cancelText: opts?.cancelText || '',
      destructive: !!opts?.destructive,
      onConfirm: opts?.onConfirm || null,
    });
  }, []);

  // ---------- State load ----------
  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!attendanceId) {
      console.log(TAG, 'refresh: no attendanceId, skipping');
      return;
    }
    console.log(TAG, 'refresh', { attendanceId, silent });
    if (!silent) setLoading(true);
    try {
      const data = await getFieldAttendanceStateOdoo(attendanceId);
      if (data?.error) {
        console.warn(TAG, 'refresh server error:', data.error);
        showToastMessage(errMsg(data.error, 'Failed to load attendance'));
        setState(null);
      } else {
        setState(data);
        console.log(TAG, 'refresh OK — state updated');
      }
      // Pull late info (is_late / reason / deduction) — separate from the
      // trip-state RPC. Best-effort; failure just hides the Late card.
      try {
        const det = await readFieldAttendanceDetailOdoo(attendanceId);
        if (det) setLateDetail(det);
      } catch (lateErr) {
        console.log(TAG, 'late detail fetch skipped:', lateErr?.message);
      }
    } catch (e) {
      console.error(TAG, 'refresh threw:', e?.message);
      showToastMessage(e?.message || 'Failed to load attendance');
      setState(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [attendanceId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Parent-triggered refresh (e.g. UA bumps it post-checkout). The user
  // stays on the same screen during check-out, so neither useFocusEffect
  // nor a prop change to attendanceId fires — without this hook the
  // embedded FA section would keep showing pre-checkout CTAs.
  useEffect(() => {
    if (!attendanceId) return;
    if (!refreshTrigger) return; // ignore the initial 0
    console.log(TAG, 'refreshTrigger changed — re-fetching state', { refreshTrigger });
    refresh({ silent: true });
  }, [refreshTrigger, attendanceId, refresh]);

  // Load (or scrub) the pending-secondary-trip marker on mount and whenever
  // the attendanceId changes. The marker is scoped by attendanceId so a
  // stale entry from yesterday's attendance never surfaces on today's.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getPendingSecondaryTrip();
      if (cancelled) return;
      if (!stored) { setPendingSecondary(null); return; }
      if (Number(stored.attendanceId) !== Number(attendanceId)) {
        console.log(TAG, 'pending marker is for a different attendance — clearing', stored);
        await clearPendingSecondaryTrip();
        setPendingSecondary(null);
        return;
      }
      console.log(TAG, 'loaded pending secondary trip marker', stored);
      setPendingSecondary(stored);
    })();
    return () => { cancelled = true; };
  }, [attendanceId]);

  // After every server refresh, check whether the pending trip already has
  // a trip line on the server (i.e. the visit was attached). If so, the
  // marker is stale — clear it so the Pending card disappears.
  useEffect(() => {
    if (!pendingSecondary || !state) return;
    const attached = (state.trip_lines || []).some(
      (l) => Number(l?.trip?.id) === Number(pendingSecondary.tripId),
    );
    if (attached) {
      console.log(TAG, 'pending trip is now attached as a trip_line — clearing marker', pendingSecondary.tripId);
      clearPendingSecondaryTrip();
      setPendingSecondary(null);
      setPendingTripHydrated(null);
    }
  }, [state, pendingSecondary]);

  // Hydrate the actual trip details (ref, etc.) for the pending card so we
  // can display VT-#### properly. The local marker stores only the slim
  // snapshot needed for instant render; the ref is fetched once.
  useEffect(() => {
    if (!pendingSecondary) { setPendingTripHydrated(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await readVehicleTrackingForTripIdsOdoo([Number(pendingSecondary.tripId)]);
        if (cancelled) return;
        const full = rows?.[0] || null;
        if (full) setPendingTripHydrated(full);
      } catch (e) {
        console.warn(TAG, 'pending trip hydrate failed:', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [pendingSecondary]);

  // On focus return — refresh, then handle the "I just created a new trip
  // or visit" handshake from VehicleTrackingForm / VisitForm. The OLD flow
  // used the same channel pattern; we adapted it for the new state machine.
  useFocusEffect(useCallback(() => {
    if (!attendanceId) return;
    let cancelled = false;
    (async () => {
      await refresh({ silent: true });
      if (cancelled) return;
      const pendingTripId = consumePendingNewTrip();
      const pendingVisitId = consumePendingNewVisit?.() || null;
      const sheet = lastActiveSheetRef.current;
      lastActiveSheetRef.current = null;

      // Two-phase secondary flow: user came back from VisitForm via
      // "Enter Visits" on the Pending Trip Card. Take the new visit id
      // and attach it to the pending trip via createAdditionalTripOdoo —
      // this finalises the trip line just like the popup's Save would,
      // but with the visit's lat/lng baked in at the moment of the save
      // (which is the actual visit location).
      if (sheet === 'pending_attach' && pendingVisitId) {
        const stored = await getPendingSecondaryTrip();
        if (stored && Number(stored.attendanceId) === Number(attendanceId)) {
          try {
            console.log(TAG, 'pending_attach: linking visit to pending trip',
              { tripId: stored.tripId, visitId: pendingVisitId, startKm: stored.startKm });
            await createAdditionalTripOdoo(attendanceId, {
              tripId: stored.tripId,
              visitId: Number(pendingVisitId),
              startKm: Number(stored.startKm) || 0,
            });
            await clearPendingSecondaryTrip();
            setPendingSecondary(null);
            setPendingTripHydrated(null);
            await refresh({ silent: true });
          } catch (e) {
            console.error(TAG, 'pending_attach RPC failed:', e?.message);
            showToastMessage(e?.message || 'Failed to attach visit to pending trip');
          }
          return;
        }
      }

      if (!sheet) return;

      // NOTE: the old "primary + pendingTripId → auto-attach silently" branch
      // was removed because the user wants Start Trip to redirect to the
      // popup (consistent with outbound), not skip to the bare FA page. The
      // popup will reopen via the generic branch below; tapping Save in the
      // popup calls setupPrimaryTripOdoo which performs the attach.

      // Any other create-new return → stash the new id so the re-opened
      // sheet auto-selects it, then re-open the sheet. We do NOT auto-open
      // the picker here — the trip is already shown in the locked Source
      // Trip field, so popping the picker on top would be redundant.
      //
      // Explicitly RESET autoOpenPickerOnRestore here so a stale `true`
      // left over from a previous edit-pencil tap doesn't bleed into this
      // create-new return path. The edit-pencil flow (handleEditTripFromPicker)
      // sets the flag and the plain-back branch below consumes it; this
      // branch must zero it out for the Create-New path.
      if (pendingTripId || pendingVisitId) {
        console.log(TAG, 'pending new record detected — re-opening', sheet,
          { pendingTripId, pendingVisitId });
        if (pendingTripId) setPendingTripId(Number(pendingTripId));
        if (pendingVisitId) setPendingVisitId(Number(pendingVisitId));
        setAutoOpenPickerOnRestore(false);
        openNextSheet(sheet);
        return;
      }

      // Plain back from VehicleTrackingForm (no save) — restore whichever
      // popup the user had open before navigating. TripDetail re-fetches
      // and re-displays via handleOpenTrip; main sheets just toggle visible.
      if (sheet === 'trip_detail' && lastDetailTripIdRef.current) {
        console.log(TAG, 'restoring TripDetailSheet on back', { tripId: lastDetailTripIdRef.current });
        const tid = lastDetailTripIdRef.current;
        lastDetailTripIdRef.current = null;
        handleOpenTrip(tid);
        return;
      }
      if (sheet) {
        console.log(TAG, 'restoring sheet on back', sheet);
        openNextSheet(sheet);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceId, refresh]));

  const onPullRefresh = async () => {
    setRefreshing(true);
    await refresh({ silent: true });
    setRefreshing(false);
  };

  // ---------- Helpers ----------
  const isCheckedOut = !!state?.attendance?.is_checked_out;

  const lastOpenTripInfo = () => {
    if (!state) return null;
    const all = [
      ...(state.trip_lines || []).map((l) => l.trip),
      ...(state.return_lines || []).map((l) => l.trip),
    ].filter(Boolean);
    const lastFromLines = all.length ? all[all.length - 1] : null;
    const t = lastFromLines || state.source_trip;
    if (!t) return null;
    const ended = t.trip_status === 'ended' || t.end_time;
    return {
      tripId: t.id,
      ref: t.ref || `#${t.id}`,
      startKm: t.start_km || 0,
      endKm: t.end_km || 0,
      // Trip records can carry vehicle_id as a flat int OR an Odoo M2O tuple.
      vehicleId: Array.isArray(t.vehicle_id) ? t.vehicle_id[0] : t.vehicle_id,
      isOpen: !ended,
    };
  };

  // Resolve the trip's DESTINATION coordinates so the close-previous-trip popup
  // can verify the driver is at the destination. The trip read only gives
  // destination_id as [id, name]; lat/long live on vehicle.location.
  const resolveDestCoords = async (full) => {
    try {
      const destId = Array.isArray(full?.destination_id) ? full.destination_id[0] : full?.destination_id;
      const destName = full?.destination_name
        || (Array.isArray(full?.destination_id) ? full.destination_id[1] : '') || '';
      if (!destId) return { destCoords: null, destName };
      const locs = await readVehicleLocationsOdoo([destId]);
      const loc = locs?.[0];
      if (loc && loc.latitude != null && loc.longitude != null) {
        return {
          destCoords: { latitude: Number(loc.latitude), longitude: Number(loc.longitude) },
          destName: destName || loc.name || '',
        };
      }
      return { destCoords: null, destName };
    } catch (e) {
      console.warn(TAG, '  resolveDestCoords failed:', e?.message);
      return { destCoords: null, destName: '' };
    }
  };

  const startNextTripFlow = async (nextAction) => {
    console.log(TAG, 'startNextTripFlow', { nextAction, isCheckedOut });
    if (isCheckedOut) {
      console.log(TAG, '  blocked: attendance is checked out');
      return;
    }
    // Wipe any leftover pendingTripId/pendingVisitId from a previous
    // create-new flow. Otherwise the popup we're about to open will
    // pre-select the OLD trip (the user just-tapped button is supposed
    // to open a fresh popup for a NEW trip).
    setPendingTripId(null);
    setPendingVisitId(null);
    const prev = lastOpenTripInfo();
    console.log(TAG, '  previous trip info:', prev);
    if (prev?.isOpen) {
      // Hydrate the trip's ACTUAL start_km from the vehicle.tracking record.
      // `_serialize_trip` historically didn't include start_km, so the
      // state's trip object reports 0. Pulling the full record guarantees the
      // popup shows the real value even before the backend serialiser change
      // is loaded.
      let actualStartKm = prev.startKm;
      let destCoords = null;
      let destName = '';
      try {
        const tripId = prev.tripId;
        if (tripId) {
          console.log(TAG, '  hydrating prev trip start_km from server', { tripId });
          const rows = await readVehicleTrackingForTripIdsOdoo([Number(tripId)]);
          const full = rows?.[0];
          if (full && typeof full.start_km === 'number') {
            actualStartKm = full.start_km;
            console.log(TAG, '  hydrated start_km:', actualStartKm);
          }
          const d = await resolveDestCoords(full);
          destCoords = d.destCoords;
          destName = d.destName;
        }
      } catch (e) {
        console.warn(TAG, '  hydrate start_km failed, using state value:', e?.message);
      }
      console.log(TAG, '  → opening Close Previous Trip sheet first', { destCoords, destName });
      setClosePrevMeta({ ref: prev.ref, startKm: actualStartKm, destCoords, destName });
      setPendingNextAction(nextAction);
      setClosePrevOpen(true);
      return;
    }
    openNextSheet(nextAction);
  };

  const openNextSheet = (action) => {
    console.log(TAG, 'openNextSheet:', action);
    if (action === 'primary') setPrimaryOpen(true);
    else if (action === 'outbound') setOutboundOpen(true);
    else if (action === 'return') setReturnOpen(true);
    else if (action === 'office_to_home') setOfficeHomeOpen(true);
  };

  // "Create New Trip / Visit" — invoked by the picker's green top row.
  // Close any open sheet first (otherwise the create form opens on top
  // and the user has two stacked modals to dismiss), then navigate to
  // the existing creation screen. `useFocusEffect` re-runs `refresh` on
  // return so the new record appears in `available_trip_ids` /
  // `available_visit_ids` next time the picker opens.
  const closeAllSheets = () => {
    setPrimaryOpen(false);
    setOutboundOpen(false);
    setReturnOpen(false);
    setOfficeHomeOpen(false);
  };

  const handleCreateNewTrip = async () => {
    // Snapshot which sheet was open so we can re-open / auto-attach on return.
    lastActiveSheetRef.current =
      primaryOpen ? 'primary' :
      outboundOpen ? 'outbound' :
      returnOpen ? 'return' :
      officeHomeOpen ? 'office_to_home' :
      null;
    const prefillSourceId = state?.previous_trip_destination_id || null;
    // Pull vehicle + end_km from the last attendance trip so the new trip
    // starts on the same vehicle and continues the odometer. Both stay
    // editable in VehicleTrackingForm — the user can override if needed.
    const prev = lastOpenTripInfo();
    let prefillVehicleId = prev?.vehicleId || null;
    // Backend _serialize_trip in older module versions (pre-19.0.1.15.3)
    // doesn't include vehicle_id, so prev.vehicleId is often null even when
    // the trip has a vehicle. Fetch the full trip record as a fallback —
    // mirrors the start_km hydration pattern in startNextTripFlow.
    if (!prefillVehicleId && prev?.tripId) {
      try {
        console.log(TAG, 'handleCreateNewTrip — hydrating vehicle_id from server', { tripId: prev.tripId });
        const rows = await readVehicleTrackingForTripIdsOdoo([Number(prev.tripId)]);
        const full = rows?.[0];
        if (full?.vehicle_id) {
          prefillVehicleId = Array.isArray(full.vehicle_id) ? full.vehicle_id[0] : full.vehicle_id;
          console.log(TAG, '  hydrated vehicle_id:', prefillVehicleId);
        } else {
          console.log(TAG, '  vehicle_id not on fetched row either; leaving null');
        }
      } catch (e) {
        console.warn(TAG, '  hydrate vehicle_id failed:', e?.message);
      }
    }
    const prefillStartKm = prev?.endKm || null;
    console.log(TAG, 'handleCreateNewTrip — previous trip snapshot:', prev);
    console.log(TAG, 'handleCreateNewTrip — lastActiveSheet:', lastActiveSheetRef.current,
      'prefillSourceId:', prefillSourceId,
      'prefillVehicleId:', prefillVehicleId,
      'prefillStartKm:', prefillStartKm,
      'navigate → VehicleTrackingForm');
    // Snapshot the FA mode (primary | outbound | return | office_to_home)
    // so VehicleTrackingForm knows whether to persist a pending-secondary
    // marker on Start Trip. Only `outbound` triggers the two-phase flow.
    const faMode = lastActiveSheetRef.current;
    closeAllSheets();
    navigation.navigate('VehicleTrackingForm', {
      returnTo: 'fieldAttendance',
      prefillSourceId,
      prefillVehicleId,
      prefillStartKm,
      faMode,
      attendanceId,
    });
  };

  // Pending Trip Card → "Enter Visits" button. The user has driven to the
  // actual visit location and is ready to create the customer.visit record;
  // its lat/lng will be captured at this moment, then the FA section's
  // useFocusEffect catches the new visit id and links it to the pending
  // trip via createAdditionalTripOdoo (see the 'pending_attach' branch).
  const handlePendingEnterVisits = (p) => {
    if (!p?.tripId) return;
    // Forward the trip's purpose_of_visit_id so VisitForm can prefill its
    // Purpose dropdown (same name-match logic used elsewhere). Read from
    // the hydrated trip record; fall back to null if not yet hydrated.
    const purposeRaw = pendingTripHydrated?.purpose_of_visit_id;
    const purposeArr = Array.isArray(purposeRaw) ? purposeRaw : null;
    const prefillPurposeId = purposeArr ? purposeArr[0] : (purposeRaw || null);
    const prefillPurposeName = purposeArr ? purposeArr[1] : null;
    console.log(TAG, 'handlePendingEnterVisits — navigating to VisitForm',
      { tripId: p.tripId, prefillPurposeId, prefillPurposeName });
    lastActiveSheetRef.current = 'pending_attach';
    navigation.navigate('VisitForm', {
      returnTo: 'fieldAttendance',
      attachToPendingTripId: p.tripId,
      prefillPurposeId,
      prefillPurposeName,
    });
  };

  // Tapping the edit pencil on a draft row inside the trip picker → close
  // the popup chain and forward to VehicleTrackingForm in edit mode.
  // React Navigation's stack preserves the FA screen below, so the device
  // back-button returns the user here.
  // Add Fuel button on trip cards → opens the Add Fuel popup directly in
  // the FA section. Fetches the full trip so we have vehicle_id / driver_id
  // for the fuel.log payload, then sets state to show the popup.
  const handleAddFuel = async (tripId) => {
    if (!tripId) return;
    console.log(TAG, 'handleAddFuel — opening popup in place', { tripId });
    setBusy(true);
    try {
      const rows = await readVehicleTrackingForTripIdsOdoo([Number(tripId)]);
      const trip = rows?.[0];
      if (!trip) {
        showToastMessage('Could not load trip');
        return;
      }
      setAddFuelTrip(trip);
      setAddFuelOpen(true);
    } catch (e) {
      console.error(TAG, 'handleAddFuel threw:', e?.message);
      showToastMessage('Failed to open Add Fuel');
    } finally {
      setBusy(false);
    }
  };

  const handleEditTripFromPicker = (trip) => {
    console.log(TAG, 'edit trip from picker', { tripId: trip?.id, ref: trip?.ref });
    // Remember which main popup was open under the picker so back from
    // VehicleTrackingForm restores it. The trip picker is always opened
    // from one of the four main outbound/return/etc. popups.
    lastActiveSheetRef.current =
      primaryOpen ? 'primary' :
      outboundOpen ? 'outbound' :
      returnOpen ? 'return' :
      officeHomeOpen ? 'office_to_home' :
      null;
    // The user was looking at the trip picker (one level above the form),
    // so signal the restored TripFormSheet to also re-open its internal
    // picker on visibility.
    setAutoOpenPickerOnRestore(true);
    closeAllSheets();
    // `returnTo: 'fieldAttendance'` makes VehicleTrackingForm route its
    // post-Save / post-Start-Trip navigation back HERE (via the pending-
    // channel + goBack), instead of falling through to the VTF list page.
    navigation.navigate('VehicleTrackingForm', { tripData: trip, returnTo: 'fieldAttendance' });
  };

  const handleCreateNewVisit = (params) => {
    // Visit picker is only reachable from outbound mode.
    lastActiveSheetRef.current = 'outbound';
    // The popup forwards both the id and the name of the source trip's
    // purpose so VisitForm can prefill the Purpose dropdown — name is the
    // reliable matcher across the two Odoo models. It also forwards the
    // currently-selected sourceTripId so we can stash it before navigating;
    // otherwise picker selection is lost across the visit-create round trip.
    const prefillPurposeId = params?.purposeOfVisitId || null;
    const prefillPurposeName = params?.purposeOfVisitName || null;
    const sourceTripId = params?.sourceTripId || null;
    console.log(TAG, 'handleCreateNewVisit — lastActiveSheet: outbound', { prefillPurposeId, prefillPurposeName, sourceTripId });
    if (sourceTripId) setPendingTripId(Number(sourceTripId));
    closeAllSheets();
    navigation.navigate('VisitForm', { returnTo: 'fieldAttendance', prefillPurposeId, prefillPurposeName });
  };

  // ---------- Mutations ----------
  const handleClosePreviousTrip = async (endKm) => {
    console.log(TAG, 'handleClosePreviousTrip start', { endKm });
    setBusy(true);
    try {
      const res = await closePreviousTripOdoo(attendanceId, endKm);
      if (res?.error) {
        console.warn(TAG, 'closePreviousTrip error:', res.error);
        // Belt-and-braces: when the server tells us the real start_km in the
        // error payload, update the popup's metadata so the helper text and
        // client-side validation match reality on the next attempt — even if
        // the initial hydration RPC failed or the backend serialiser hasn't
        // been reloaded yet.
        if (res.error === 'end_km_too_low' && typeof res.start_km === 'number') {
          console.log(TAG, '  patching closePrevMeta.startKm from server error:', res.start_km);
          setClosePrevMeta((m) => ({ ...m, startKm: res.start_km }));
        }
        showToastMessage(errMsg(res.error, 'Failed to close previous trip')
          + (res.start_km ? ` (Start KM was ${res.start_km})` : ''));
        return;
      }
      console.log(TAG, 'closePreviousTrip OK');
      setClosePrevOpen(false);
      await refresh({ silent: true });
      if (pendingNextAction) {
        const action = pendingNextAction;
        console.log(TAG, '  chaining to queued next sheet:', action);
        setPendingNextAction(null);
        if (action === 'checkout') {
          console.log(TAG, '  chaining to checkout RPC after close-prev save');
          await runCheckOutRpc();
        } else {
          openNextSheet(action);
        }
      }
    } catch (e) {
      console.error(TAG, 'handleClosePreviousTrip threw:', e?.message);
      showToastMessage(e?.message || 'Failed to close previous trip');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePrimary = async ({ tripId, startKm }) => {
    console.log(TAG, 'handleSavePrimary start', { tripId, startKm });
    setBusy(true);
    try {
      const res = await setupPrimaryTripOdoo(attendanceId, { tripId, startKm });
      if (res?.error) {
        console.warn(TAG, 'setupPrimaryTrip error:', res.error);
        showToastMessage(errMsg(res.error));
        return;
      }
      console.log(TAG, 'setupPrimaryTrip OK');
      showToastMessage('Primary trip saved');
      setPrimaryOpen(false);
      setPendingTripId(null);
      setPendingVisitId(null);
      await refresh({ silent: true });
    } catch (e) {
      console.error(TAG, 'handleSavePrimary threw:', e?.message);
      showToastMessage(e?.message || 'Failed to save');
    } finally { setBusy(false); }
  };

  const handleSaveOutbound = async ({ tripId, visitId, startKm }) => {
    console.log(TAG, 'handleSaveOutbound start', { tripId, visitId, startKm });
    // Two-phase secondary flow branch: when the user taps Save in the popup
    // without picking a visit, we DON'T call createAdditionalTripOdoo (that
    // would require a visit_id). VehicleTrackingForm already persisted the
    // pending marker after Start Trip; here we just close the popup and
    // surface the Pending Trip Card on FA so the user can drive to the
    // visit location and add the visit later via "Enter Visits".
    if (!visitId) {
      console.log(TAG, 'handleSaveOutbound — no visit picked → committing as pending');
      try {
        const stored = await getPendingSecondaryTrip();
        if (stored && Number(stored.attendanceId) === Number(attendanceId)
            && Number(stored.tripId) === Number(tripId)) {
          setPendingSecondary(stored);
          console.log(TAG, 'handleSaveOutbound — pending marker promoted to UI state', stored);
        } else {
          console.warn(TAG, 'handleSaveOutbound — no matching pending marker found for tripId=', tripId,
            'stored=', stored);
        }
        showToastMessage('Trip saved — enter customer visit when you arrive');
        setOutboundOpen(false);
        setPendingTripId(null);
        setPendingVisitId(null);
      } catch (e) {
        console.error(TAG, 'handleSaveOutbound pending-branch threw:', e?.message);
        showToastMessage(e?.message || 'Failed to save trip');
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      const res = await createAdditionalTripOdoo(attendanceId, { tripId, visitId, startKm });
      if (res?.error) {
        console.warn(TAG, 'createAdditionalTrip error:', res.error);
        showToastMessage(errMsg(res.error));
        return;
      }
      console.log(TAG, 'createAdditionalTrip OK — trip line created with visit attached');
      showToastMessage('Trip added');
      setOutboundOpen(false);
      setPendingTripId(null);
      setPendingVisitId(null);
      await refresh({ silent: true });
    } catch (e) {
      console.error(TAG, 'handleSaveOutbound threw:', e?.message);
      showToastMessage(e?.message || 'Failed to add trip');
    } finally { setBusy(false); }
  };

  const handleSaveReturn = async ({ tripId, startKm, returnLegType }) => {
    console.log(TAG, 'handleSaveReturn start', { tripId, startKm, returnLegType });
    setBusy(true);
    try {
      const res = await createReturnTripOdoo(attendanceId, {
        tripId, startKm, returnLegType, isOfficeToHome: false,
      });
      if (res?.error) {
        console.warn(TAG, 'createReturnTrip error:', res.error);
        showToastMessage(errMsg(res.error));
        return;
      }
      console.log(TAG, 'createReturnTrip OK');
      showToastMessage('Return trip added');
      setReturnOpen(false);
      setPendingTripId(null);
      setPendingVisitId(null);
      await refresh({ silent: true });
    } catch (e) {
      console.error(TAG, 'handleSaveReturn threw:', e?.message);
      showToastMessage(e?.message || 'Failed to add return trip');
    } finally { setBusy(false); }
  };

  const handleSaveOfficeToHome = async ({ tripId, startKm }) => {
    console.log(TAG, 'handleSaveOfficeToHome start', { tripId, startKm });
    setBusy(true);
    try {
      const res = await createReturnTripOdoo(attendanceId, {
        tripId, startKm, returnLegType: 'via_office', isOfficeToHome: true,
      });
      if (res?.error) {
        console.warn(TAG, 'createReturnTrip (office→home) error:', res.error);
        showToastMessage(errMsg(res.error));
        return;
      }
      console.log(TAG, 'createReturnTrip (office→home) OK');
      showToastMessage('Office → Home leg added');
      setOfficeHomeOpen(false);
      setPendingTripId(null);
      setPendingVisitId(null);
      await refresh({ silent: true });
    } catch (e) {
      console.error(TAG, 'handleSaveOfficeToHome threw:', e?.message);
      showToastMessage(e?.message || 'Failed to add Office to Home leg');
    } finally { setBusy(false); }
  };

  // Hoisted so both the direct-checkout path (no open trip) and the chained
  // close-prev → checkout path land in the same RPC + toast + refresh code.
  const runCheckOutRpc = async () => {
    console.log(TAG, 'runCheckOutRpc start', { attendanceId });
    setBusy(true);
    try {
      const res = await fieldActionCheckOutOdoo(attendanceId);
      if (res?.error) {
        console.warn(TAG, 'checkOut error:', res.error);
        showToastMessage(errMsg(res.error, 'Check out failed'));
        return;
      }
      console.log(TAG, 'checkOut OK');
      // The day is done — any pending secondary trip marker is now stale.
      try {
        await clearPendingSecondaryTrip();
        setPendingSecondary(null);
        setPendingTripHydrated(null);
      } catch (_) {}
      showToastMessage('Checked out successfully');
      await refresh({ silent: true });
      if (typeof onCheckedOut === 'function') onCheckedOut();
    } catch (e) {
      console.error(TAG, 'handleCheckOut threw:', e?.message);
      showToastMessage(e?.message || 'Check out failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckOut = async () => {
    console.log(TAG, 'handleCheckOut clicked — FORCE-opening Close Previous Trip popup');
    // Block check-out while a pending secondary trip is still waiting for
    // its customer visit. The user must complete the trip+visit pair
    // (via Enter Visits on the pending card) before they can check out.
    if (pendingSecondary) {
      console.log(TAG, '  blocked: pending secondary trip has no visit yet', pendingSecondary);
      showAlert({
        message: 'You have a pending trip without a customer visit. Please tap "Enter Visits" on the pending trip card and complete the visit before checking out.',
        confirmText: 'OK',
      });
      return;
    }
    // FORCE: always open the Close Previous Trip popup when the user taps
    // Check Out. The popup itself is the confirmation step (user enters
    // End KM and taps Save & Checkout). No prior alert, no isOpen guard.
    const prev = lastOpenTripInfo();
    console.log(TAG, '  checkout: lastOpenTripInfo →', prev);
    // Fall back to source_trip directly, then to a blank record, so the
    // popup ALWAYS has something to show even when there's no open leg.
    let ref = prev?.ref || state?.source_trip?.ref || '';
    let startKm = prev?.startKm ?? state?.source_trip?.start_km ?? 0;
    const tripId = prev?.tripId || state?.source_trip?.id || null;
    let destCoords = null;
    let destName = '';
    if (tripId) {
      try {
        console.log(TAG, '  checkout: hydrating start_km from server', { tripId });
        const rows = await readVehicleTrackingForTripIdsOdoo([Number(tripId)]);
        const full = rows?.[0];
        if (full && typeof full.start_km === 'number') {
          startKm = full.start_km;
          console.log(TAG, '  checkout: hydrated start_km:', startKm);
        }
        if (full?.ref) ref = full.ref;
        const d = await resolveDestCoords(full);
        destCoords = d.destCoords;
        destName = d.destName;
      } catch (e) {
        console.warn(TAG, '  checkout: hydrate start_km failed:', e?.message);
      }
    } else {
      console.log(TAG, '  checkout: no trip on attendance — opening popup with blank defaults');
    }
    console.log(TAG, '  opening Close Previous Trip popup for checkout', { ref, tripId, startKm, isOpen: prev?.isOpen, destCoords, destName });
    setClosePrevMeta({
      ref,
      startKm,
      mode: 'checkout',
      isOpen: prev?.isOpen ?? true,
      destCoords,
      destName,
    });
    setPendingNextAction('checkout');
    setClosePrevOpen(true);
  };

  // ---------- Render ----------
  if (loading) {
    return (
      <View style={styles.loadingFull}>
        <ActivityIndicator color={FIELD_COLOR} size="large" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }
  if (!state) {
    return (
      <View style={styles.loadingFull}>
        <MaterialIcons name="error-outline" size={32} color="#888" />
        <Text style={styles.loadingText}>Attendance not found.</Text>
      </View>
    );
  }

  // Button-row visibility — mirrors the backend (hr_attendance_views.xml)
  // exactly:
  //   - Setup Primary Trip       : !source_trip               (initial empty)
  //   - Setup Secondary Trip     : !trip_line_ids             (no outbound yet,
  //                                                            irrespective of source_trip)
  //   - Add Additional Trip      : trip_line_ids && show_primary_return_button
  //   - Primary Trip (Via .../Direct) : show_primary_return_button
  //   - Office to Home           : show_office_to_home_button
  //   - Add Additional (bottom)  : has_return_trip_lines      (after return cycle starts)
  // All gated by !is_checked_out.
  const hasTripLines = (state.trip_lines || []).length > 0;
  // Hide the primary-trip CTA once any trip line has been created — the
  // user has clearly skipped the Home→Office leg and gone straight to a
  // secondary trip, so offering "Setup Primary Trip" is no longer relevant.
  // While a pending secondary trip is waiting for its visit, block the
  // "start another trip" CTAs — the user must finish the current pair
  // first. A hint is rendered next to the disabled button (see JSX below).
  const blockedByPending = !!pendingSecondary;
  const showPrimaryTripBtn = !state.source_trip && !hasTripLines && !isCheckedOut && !blockedByPending;
  const showSecondaryBtn = !hasTripLines && !isCheckedOut && !blockedByPending;
  const showAddAdditionalOutboundBtn = hasTripLines && state.show_primary_return_button && !isCheckedOut && !blockedByPending;
  const showViaOfficeOrDirectBtn = state.show_primary_return_button && !isCheckedOut && !blockedByPending;
  const showAddAdditionalBottomBtn = state.has_return_trip_lines && !isCheckedOut && !blockedByPending;
  const showOfficeToHomeBtn = state.show_office_to_home_button && !isCheckedOut;
  const att = state.attendance;

  const inner = (
    <View style={{ padding: embedded ? 0 : 14, paddingBottom: embedded ? 0 : 40 }}>
      {/* Read-only banner */}
      {isCheckedOut ? (
        <View style={styles.readOnlyBanner}>
          <MaterialIcons name="lock" size={16} color="#1565C0" />
          <Text style={styles.readOnlyText}>
            This attendance has been checked out and is now read-only. You can view your trips and visits below but no further edits are allowed.
          </Text>
        </View>
      ) : (
        <WorkflowBanner />
      )}

      {/* PRIMARY TRIP */}
      <Text style={styles.sectionTitle}>Primary Trip</Text>
      {state.source_trip ? (
        <TripCard
          label="Source Trip"
          trip={state.source_trip}
          visits={state.source_visits}
          readOnly={isCheckedOut}
          onOpenTrip={() => handleOpenTrip(state.source_trip.id)}
          onViewVisits={() => handleViewVisits(state.source_visits)}
          onAddFuel={() => handleAddFuel(state.source_trip.id)}
        />
      ) : (hasTripLines || pendingSecondary) ? (
        // Employee skipped the Home→Office primary and went straight to a
        // Home→Visit secondary. The empty-state card would read as an error;
        // a yellow info banner makes it clear this is a valid alternate flow.
        // Also fires while a secondary trip is in the pending phase
        // (trip created, visit not yet attached) so the user doesn't see
        // the misleading "No primary trip set up yet" between Start Trip
        // and entering the visit.
        <View style={styles.infoBanner}>
          <MaterialIcons name="info-outline" size={18} color="#856404" />
          <Text style={styles.infoBannerText}>
            The employee directly went Home to Visit, so no primary trip (Home to Office) required.
          </Text>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <MaterialIcons name="route" size={22} color="#BDBDBD" />
          <Text style={styles.emptyText}>No primary trip set up yet.</Text>
        </View>
      )}

      {/* PENDING SECONDARY TRIP — visible while a vehicle.tracking exists
          for outbound but the matching customer.visit hasn't been entered
          yet. User taps Enter Visits when they reach the visit location. */}
      {pendingSecondary ? (
        <PendingTripCard
          pending={pendingSecondary}
          hydrated={pendingTripHydrated}
          busy={busy}
          onEnterVisits={() => handlePendingEnterVisits(pendingSecondary)}
        />
      ) : null}

      {/* Hint shown when the next-trip CTAs are blocked because a pending
          secondary trip is still waiting for its visit. */}
      {blockedByPending && !isCheckedOut ? (
        <Text style={styles.disabledHint}>
          Complete the visit for your pending trip before adding another.
        </Text>
      ) : null}

      {/* INITIAL BUTTONS (no trips yet) */}
      {(showPrimaryTripBtn || showSecondaryBtn) ? (
        <View style={styles.btnRow}>
          {showPrimaryTripBtn && (
            <ActionBtn icon="add" label="Setup Primary Trip (Home → Office)"
              onPress={() => startNextTripFlow('primary')} disabled={busy} variant="primary" />
          )}
          {showSecondaryBtn && (
            // Label mirrors the backend's two-state behaviour:
            //   - No primary trip yet   → "Setup Secondary Trip (Home → Visit)"
            //   - Primary trip is set   → just "Secondary Trip" (user is at the
            //                            office, not at home — old label was wrong)
            <ActionBtn
              icon="add"
              label={state.source_trip ? 'Secondary Trip' : 'Setup Secondary Trip (Home → Visit)'}
              onPress={() => startNextTripFlow('outbound')}
              disabled={busy}
              variant="primary"
            />
          )}
        </View>
      ) : null}

      {/* SECONDARY / ADDITIONAL TRIPS */}
      {hasTripLines ? (
        <>
          <Text style={styles.sectionTitle}>
            {state.trip_lines.length === 1 ? 'Secondary Trip' : 'Additional Trips'}
          </Text>
          {state.trip_lines.map((line, idx) => (
            <TripLineRow
              key={line.id}
              line={line}
              index={idx}
              readOnly={isCheckedOut}
              onOpenTrip={() => handleOpenTrip(line.trip?.id)}
              onViewVisits={line.visit ? () => handleViewVisits(line.visit) : null}
              onAddFuel={() => handleAddFuel(line.trip?.id)}
            />
          ))}
        </>
      ) : null}

      {/* MIDDLE BUTTONS — Add Additional / Via Office or Direct */}
      {(showAddAdditionalOutboundBtn || showViaOfficeOrDirectBtn) ? (
        <View style={styles.btnRow}>
          {showAddAdditionalOutboundBtn && (
            <ActionBtn icon="add" label="Add Additional Trip"
              onPress={() => startNextTripFlow('outbound')} disabled={busy} variant="primary" />
          )}
          {showViaOfficeOrDirectBtn && (
            <ActionBtn icon="home" label="Primary Trip (Via Office or Direct)"
              onPress={() => startNextTripFlow('return')} disabled={busy} variant="return" />
          )}
        </View>
      ) : null}

      {/* RETURN HOME */}
      {state.has_return_trip_lines ? (
        <>
          <Text style={styles.sectionTitle}>Return Home</Text>
          {state.return_lines.map((line, idx) => (
            <TripLineRow
              key={line.id}
              line={line}
              index={idx}
              isReturn
              readOnly={isCheckedOut}
              onOpenTrip={() => handleOpenTrip(line.trip?.id)}
              onAddFuel={() => handleAddFuel(line.trip?.id)}
            />
          ))}
        </>
      ) : null}

      {/* BOTTOM BUTTONS — Office to Home / Add Additional */}
      {(showOfficeToHomeBtn || showAddAdditionalBottomBtn) ? (
        <View style={styles.btnRow}>
          {showOfficeToHomeBtn && (
            <ActionBtn icon="home" label="Primary Trip (Office to Home)"
              onPress={() => startNextTripFlow('office_to_home')} disabled={busy} variant="home" />
          )}
          {showAddAdditionalBottomBtn && (
            <ActionBtn icon="add" label="Add Additional Trip"
              onPress={() => startNextTripFlow('outbound')} disabled={busy} variant="primary" />
          )}
        </View>
      ) : null}

      {/* TRIP TOTALS */}
      {state.source_trip ? (
        <View style={styles.totalsCard}>
          <Text style={styles.totalsTitle}>Trip Totals</Text>
          <View style={styles.totalsRow}>
            <TotalCell label="Total KM" value={String(att.trip_total_km || 0)} />
            <TotalCell label="Duration (Hrs)" value={String(att.trip_total_duration || 0)} />
          </View>
          <View style={styles.totalsRow}>
            <TotalCell label="Total Fuel (L)" value={String(att.trip_total_fuel_litres || 0)} />
            <TotalCell label="Total Fuel Amt" value={String(att.trip_total_fuel_amount || 0)} />
          </View>
        </View>
      ) : null}

      {/* LATE card — shows late-by / deduction / reason. The "Update Reason"
          button is only available UNTIL checkout (while still open). */}
      {(lateDetail?.is_late || (lateDetail?.late_reason && String(lateDetail.late_reason).trim())) ? (
        <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: '#ECECEC' }}>
          {lateDetail?.is_late ? (
            <Text style={{ fontSize: 12.5, fontFamily: FONT_FAMILY.urbanistBold, color: '#B26A00' }}>
              Late by {lateDetail.late_minutes_display || `${lateDetail.late_minutes || 0}m`}
              {Number(lateDetail.deduction_amount || 0) > 0 ? ` · Deduction ${Number(lateDetail.deduction_amount).toFixed(2)}` : ''}
            </Text>
          ) : null}
          <Text style={{ fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#777', marginTop: 6 }}>Late reason</Text>
          <Text style={{ fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium, color: '#333', marginTop: 2 }}>
            {lateDetail?.late_reason && String(lateDetail.late_reason).trim() ? lateDetail.late_reason : '—'}
          </Text>
          {!isCheckedOut ? (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: FIELD_COLOR }}
              onPress={() => { setLateUpdateText(lateDetail?.late_reason || ''); setLateUpdateOpen(true); }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="edit" size={14} color={FIELD_COLOR} />
              <Text style={{ fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR }}>Update Reason</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Built-in Check Out (only when not embedded and host asks for it) */}
      {showCheckOutButton && !isCheckedOut ? (
        <TouchableOpacity style={styles.checkoutBtn} onPress={handleCheckOut} disabled={busy}>
          <MaterialIcons name="logout" size={16} color="#fff" />
          <Text style={styles.checkoutBtnText}>Check Out Now</Text>
        </TouchableOpacity>
      ) : null}

      {/* Update-Reason editor (pre-filled). Only reachable while not checked out. */}
      <Modal visible={lateUpdateOpen} transparent animationType="fade" onRequestClose={() => setLateUpdateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18 }}>
            <Text style={{ fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR, marginBottom: 10 }}>Update Late Reason</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: 10, padding: 10, minHeight: 80, textAlignVertical: 'top', fontFamily: FONT_FAMILY.urbanistRegular, fontSize: 13, color: '#222' }}
              placeholder="Enter your reason for being late..."
              placeholderTextColor="#999"
              multiline
              value={lateUpdateText}
              onChangeText={setLateUpdateText}
            />
            <TouchableOpacity
              style={{ marginTop: 14, backgroundColor: (!lateUpdateText.trim() || lateUpdateSaving) ? '#CCC' : FIELD_COLOR, borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}
              disabled={!lateUpdateText.trim() || lateUpdateSaving}
              onPress={async () => {
                const text = lateUpdateText.trim();
                if (!text || !attendanceId) return;
                setLateUpdateSaving(true);
                try {
                  const res = await submitLateReason(attendanceId, text);
                  if (res?.success) {
                    setLateDetail((prev) => prev ? { ...prev, late_reason: text } : prev);
                    showToastMessage('Late reason updated');
                    setLateUpdateOpen(false);
                  } else {
                    showToastMessage(res?.error || 'Could not update reason');
                  }
                } catch (e) {
                  showToastMessage('Could not update reason');
                } finally {
                  setLateUpdateSaving(false);
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>{lateUpdateSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center' }} onPress={() => setLateUpdateOpen(false)}>
              <Text style={{ fontSize: 13, fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#666' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );

  return (
    <>
      {embedded ? (
        inner
      ) : (
        <ScrollView
          style={{ flex: 1, backgroundColor: '#F8F9FA' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh}
            colors={[FIELD_COLOR]} tintColor={FIELD_COLOR} />}
        >
          {inner}
        </ScrollView>
      )}

      {/* Sheets — always mounted, visibility driven by state */}
      <ClosePreviousTripSheet
        visible={closePrevOpen}
        previousTripRef={closePrevMeta.ref}
        previousStartKm={closePrevMeta.startKm}
        // Checkout flow gets module-style copy — "End KM for VT-0056
        // (Trip Started)" title + clearer disclaimer + "Save & Checkout"
        // button. Defaults retained for the next-trip flow (Save & Exit).
        title={closePrevMeta.mode === 'checkout'
          ? `End KM for ${closePrevMeta.ref || 'this trip'} (${closePrevMeta.isOpen ? 'Trip Started' : 'Trip Ended'})`
          : undefined}
        disclaimer={closePrevMeta.mode === 'checkout'
          ? "Enter the trip's end odometer reading. We'll close the trip with this value and mark its visits done before checking you out."
          : undefined}
        saveLabel={closePrevMeta.mode === 'checkout' ? 'Save & Checkout' : 'Save & Exit'}
        saving={busy}
        destinationCoords={closePrevMeta.destCoords}
        destinationName={closePrevMeta.destName}
        onSave={handleClosePreviousTrip}
        onClose={() => { setClosePrevOpen(false); setPendingNextAction(null); }}
      />
      <TripFormSheet
        visible={primaryOpen}
        mode="primary"
        title="Setup Primary Trip (Home → Office)"
        availableTripIds={state.available_trip_ids}
        availableVisitIds={[]}
        previousDestinationId={state.previous_trip_destination_id}
        initialSelectedTripId={pendingTripId}
        saving={busy}
        onSave={handleSavePrimary}
        onClose={() => { setPrimaryOpen(false); }}
        onCreateNewTrip={handleCreateNewTrip}
        onEditTrip={handleEditTripFromPicker}
        autoOpenPicker={autoOpenPickerOnRestore}
        onAutoOpenPickerHandled={() => setAutoOpenPickerOnRestore(false)}
      />
      <TripFormSheet
        visible={outboundOpen}
        mode="outbound"
        title="Add Additional Trip"
        availableTripIds={state.available_trip_ids}
        availableVisitIds={state.available_visit_ids}
        previousDestinationId={state.previous_trip_destination_id}
        initialSelectedTripId={pendingTripId}
        initialSelectedVisitId={pendingVisitId}
        saving={busy}
        onSave={handleSaveOutbound}
        onClose={() => { setOutboundOpen(false); }}
        onCreateNewTrip={handleCreateNewTrip}
        onCreateNewVisit={handleCreateNewVisit}
        onEditTrip={handleEditTripFromPicker}
        autoOpenPicker={autoOpenPickerOnRestore}
        onAutoOpenPickerHandled={() => setAutoOpenPickerOnRestore(false)}
      />
      <TripFormSheet
        visible={returnOpen}
        mode="return"
        title="Primary Trip (Via Office or Direct)"
        availableTripIds={state.available_trip_ids}
        availableVisitIds={[]}
        previousDestinationId={state.previous_trip_destination_id}
        initialSelectedTripId={pendingTripId}
        saving={busy}
        onSave={handleSaveReturn}
        onClose={() => { setReturnOpen(false); }}
        onCreateNewTrip={handleCreateNewTrip}
        onEditTrip={handleEditTripFromPicker}
        autoOpenPicker={autoOpenPickerOnRestore}
        onAutoOpenPickerHandled={() => setAutoOpenPickerOnRestore(false)}
      />
      <TripFormSheet
        visible={officeHomeOpen}
        mode="office_to_home"
        title="Primary Trip (Office to Home)"
        availableTripIds={state.available_trip_ids}
        availableVisitIds={[]}
        previousDestinationId={state.previous_trip_destination_id}
        initialSelectedTripId={pendingTripId}
        saving={busy}
        onSave={handleSaveOfficeToHome}
        onClose={() => { setOfficeHomeOpen(false); }}
        onCreateNewTrip={handleCreateNewTrip}
        onEditTrip={handleEditTripFromPicker}
        autoOpenPicker={autoOpenPickerOnRestore}
        onAutoOpenPickerHandled={() => setAutoOpenPickerOnRestore(false)}
      />

      {/* Per-card inspection sheets — Open Trip + View Visits. */}
      <TripDetailSheet
        visible={tripDetailOpen}
        trip={tripDetailTrip}
        loading={tripDetailLoading}
        onClose={() => setTripDetailOpen(false)}
        onOpenInVehicleTracking={(trip) => {
          // Close the popup and forward to VehicleTrackingForm in edit mode.
          // Stash the detail trip id so the focus-effect can re-open the
          // popup when the user backs out of VehicleTrackingForm. returnTo
          // routes Save/Start-Trip back to FA instead of the VTF list page.
          console.log(TAG, 'TripDetail → open in Vehicle Tracking', { tripId: trip?.id });
          lastActiveSheetRef.current = 'trip_detail';
          lastDetailTripIdRef.current = trip?.id || null;
          setTripDetailOpen(false);
          navigation.navigate('VehicleTrackingForm', { tripData: trip, returnTo: 'fieldAttendance' });
        }}
      />
      <VisitsListSheet
        visible={visitsListOpen}
        visits={visitsListRows}
        loading={false}
        onClose={() => setVisitsListOpen(false)}
        onVisitPress={(visit) => {
          // Two-step like Open Trip: row tap opens the OVERVIEW popup
          // (VisitDetailSheet) — the popup itself has an "Open in Customer
          // Visit" button that navigates to the full Customer Visit page.
          console.log(TAG, 'VisitsList → open VisitDetailSheet', { visitId: visit?.id });
          setVisitsListOpen(false);
          setVisitDetailVisit(visit);
          setVisitDetailOpen(true);
        }}
      />
      <VisitDetailSheet
        visible={visitDetailOpen}
        visit={visitDetailVisit}
        loading={false}
        onClose={() => setVisitDetailOpen(false)}
        onOpenInVisits={(visit) => {
          console.log(TAG, 'VisitDetail → open Customer Visit page', { visitId: visit?.id });
          setVisitDetailOpen(false);
          // returnTo: 'fieldAttendance' suppresses the Reset-to-Draft button
          // on the Customer Visit page (existing guard in VisitDetails.js).
          navigation.navigate('VisitDetails', { visitId: visit?.id, visitDetails: visit, returnTo: 'fieldAttendance' });
        }}
      />
      <AddFuelSheet
        visible={addFuelOpen}
        trip={addFuelTrip}
        onClose={() => setAddFuelOpen(false)}
        onSaved={async () => {
          showToastMessage('Fuel entry added');
          await refresh({ silent: true });
        }}
      />

      <StyledAlertModal
        isVisible={alertModal.visible}
        message={alertModal.message}
        confirmText={alertModal.confirmText}
        cancelText={alertModal.cancelText}
        destructive={alertModal.destructive}
        onConfirm={() => { const cb = alertModal.onConfirm; if (cb) cb(); else hideAlert(); }}
        onCancel={hideAlert}
      />
    </>
  );
};

// ============================================================================
// Sub-components
// ============================================================================
const TripCard = ({ label, trip, visits, readOnly, onOpenTrip, onViewVisits, onAddFuel }) => {
  const hasVisits = Array.isArray(visits) && visits.length > 0;
  const fuelCount = Number(trip?.fuel_log_count || 0);
  const fuelAdded = fuelCount > 0 || Number(trip?.total_fuel_litres || 0) > 0;
  const fuelBadge = fuelAdded
    ? (fuelCount > 0 ? `${fuelCount} fuel log${fuelCount === 1 ? '' : 's'} added` : 'Fuel added')
    : '';
  return (
    <View style={styles.tripCard}>
      <Row k={`${label}:`} v={trip.ref || `#${trip.id}`} />
      <Row k="From:" v={trip.source || ''} />
      <Row k="To:" v={trip.destination || ''} />
      <Row k="Status:" v={trip.trip_status || 'draft'} />
      <ActionRow
        readOnly={readOnly}
        onOpenTrip={onOpenTrip}
        onViewVisits={hasVisits ? onViewVisits : null}
        onAddFuel={trip?.trip_status === 'in_progress' && onAddFuel ? onAddFuel : null}
        fuelBadge={fuelBadge}
      />
    </View>
  );
};

// Pending Trip Card — shown while a secondary trip's vehicle.tracking
// exists but its visit hasn't been entered yet (two-phase outbound flow).
// Left column shows the trip details so the user can confirm what trip
// they're on; right column has the "Enter Visits" button that they tap
// once they've physically arrived at the visit location.
const PendingTripCard = ({ pending, hydrated, busy, onEnterVisits }) => {
  const ref = hydrated?.ref || hydrated?.name || pending?.ref || '—';
  const source = pending?.source || '';
  const destination = pending?.destination || '';
  const vehicleName = pending?.vehicleName || '';
  const driverName = pending?.driverName || '';
  const startKm = pending?.startKm != null ? String(pending.startKm) : '—';
  return (
    <View style={styles.pendingCard}>
      <View style={styles.infoBanner}>
        <MaterialIcons name="info-outline" size={18} color="#856404" />
        <Text style={styles.infoBannerText}>
          Once you reach the visit, enter the customer details.
        </Text>
      </View>
      <View style={styles.pendingRow}>
        <View style={styles.pendingLeft}>
          <Text style={styles.twoColHeader}>TRIP DETAILS</Text>
          <ColRow k="Ref" v={ref} />
          <ColRow k="Source" v={source} />
          <ColRow k="Destination" v={destination} />
          <ColRow k="Vehicle" v={vehicleName} />
          <ColRow k="Driver" v={driverName} />
          <ColRow k="Start KM" v={startKm} />
        </View>
        <View style={styles.pendingRight}>
          <TouchableOpacity
            style={[styles.enterVisitsBtn, busy && { opacity: 0.5 }]}
            onPress={onEnterVisits}
            disabled={busy}
            activeOpacity={0.85}
          >
            <MaterialIcons name="add-location-alt" size={18} color="#fff" />
            <Text style={styles.enterVisitsText}>Enter Visits</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

// Mirrors the Odoo module's secondary-trip card layout: two side-by-side
// columns — TRIP DETAILS on the left, VISIT DETAILS on the right — plus
// Open Source Trip / View Visits / Add Fuel buttons at the bottom.
const TripLineRow = ({ line, index, isReturn, readOnly, onOpenTrip, onViewVisits, onAddFuel }) => {
  let badge = null;
  if (isReturn) {
    if (line.is_office_to_home_leg) badge = 'Office → Home';
    else if (line.return_leg_type === 'via_office') badge = 'Visit → Office';
    else if (line.return_leg_type === 'direct') badge = 'Visit → Home';
  }
  const trip = line.trip;
  const visit = line.visit;
  const fuelCount = Number(trip?.fuel_log_count || 0);
  const fuelAdded = fuelCount > 0 || Number(trip?.total_fuel_litres || 0) > 0;
  const fuelBadge = fuelAdded
    ? (fuelCount > 0 ? `${fuelCount} fuel log${fuelCount === 1 ? '' : 's'} added` : 'Fuel added')
    : '';
  const tripStatusLabel =
    trip?.trip_status === 'in_progress' ? 'Trip Started' :
    trip?.trip_status === 'ended' ? 'Trip Ended' :
    trip?.trip_status === 'cancelled' ? 'Cancelled' :
    (trip?.trip_status || 'draft');
  const fmtDuration = (h) => {
    const n = Number(h);
    if (!Number.isFinite(n) || n <= 0) return '00:00';
    const hh = Math.floor(n);
    const mm = Math.round((n - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  const fmtDT = (s) => (s ? String(s).slice(0, 16).replace('T', ' ') : '—');
  return (
    <View style={[styles.tripCard, isReturn && styles.tripCardReturn]}>
      {badge ? <Text style={styles.legBadge}>{badge}</Text> : null}
      <View style={styles.twoColRow}>
        {/* Left column — Trip Details */}
        <View style={styles.twoColCol}>
          <Text style={styles.twoColHeader}>TRIP DETAILS</Text>
          <ColRow k="Source Trip" v={`${trip?.ref || `#${trip?.id}`} (${tripStatusLabel})`} />
          <ColRow k="Source" v={trip?.source} />
          <ColRow k="Destination" v={trip?.destination} />
          <ColRow k="KM Travelled" v={String(line.km_travelled || 0)} />
          <ColRow k="Duration (Hrs)" v={fmtDuration(line.duration)} />
          <ColRow k="GPS Lat" v={trip?.start_latitude || '—'} />
          <ColRow k="GPS Lng" v={trip?.start_longitude || '—'} />
        </View>
        {/* Right column — Visit Details (omitted for return legs without a
            visit attached). */}
        {visit ? (
          <View style={styles.twoColCol}>
            <Text style={styles.twoColHeader}>VISIT DETAILS</Text>
            <ColRow k="Visit" v={visit.name || `#${visit.id}`} />
            <ColRow k="Customer" v={visit.customer || (Array.isArray(visit.partner_id) ? visit.partner_id[1] : '')} />
            <ColRow k="Date / Time" v={fmtDT(visit.date_time)} />
            <ColRow k="Location" v={visit.location_name} />
            <ColRow k="Latitude" v={visit.latitude || '—'} />
            <ColRow k="Longitude" v={visit.longitude || '—'} />
          </View>
        ) : null}
      </View>
      <ActionRow
        readOnly={readOnly}
        onOpenTrip={onOpenTrip}
        onViewVisits={visit && onViewVisits ? onViewVisits : null}
        onAddFuel={trip?.trip_status === 'in_progress' && onAddFuel ? onAddFuel : null}
        fuelBadge={fuelBadge}
      />
    </View>
  );
};

// Small key/value row used inside the two-column card layout.
const ColRow = ({ k, v }) => (
  <View style={styles.colRow}>
    <Text style={styles.colRowKey} numberOfLines={1}>{k}:</Text>
    <Text style={styles.colRowVal} numberOfLines={2}>{v || '—'}</Text>
  </View>
);

// Row of small chip-style action buttons rendered at the bottom of every
// trip card. Hidden once the attendance is checked out. Add Fuel only
// appears for in_progress trips (matches the module — can't add fuel to
// an ended or cancelled trip).
const ActionRow = ({ readOnly, onOpenTrip, onViewVisits, onAddFuel, fuelBadge }) => {
  // After checkout we keep the navigation actions visible (Open Source
  // Trip, View Visits) and the fuel badge — they're read-only. Only the
  // genuinely-edit action (Add Fuel) is suppressed, mirroring the Odoo
  // web module's locked-card layout.
  const effectiveAddFuel = readOnly ? null : onAddFuel;
  if (!onOpenTrip && !onViewVisits && !effectiveAddFuel && !fuelBadge) return null;
  return (
    <View style={styles.cardActionsRow}>
      {onOpenTrip ? (
        <CardBtn icon="open-in-new" label="Open Source Trip" onPress={onOpenTrip} />
      ) : null}
      {onViewVisits ? (
        <CardBtn icon="place" label="View Visits" onPress={onViewVisits} />
      ) : null}
      {effectiveAddFuel ? (
        <CardBtn icon="local-gas-station" label="Add Fuel" onPress={effectiveAddFuel} />
      ) : null}
      {fuelBadge ? (
        <View style={styles.fuelBadge}>
          <MaterialIcons name="check-circle" size={12} color="#2E7D32" />
          <Text style={styles.fuelBadgeText}>{fuelBadge}</Text>
        </View>
      ) : null}
    </View>
  );
};

const CardBtn = ({ icon, label, onPress }) => (
  <TouchableOpacity onPress={onPress} style={styles.cardBtn} activeOpacity={0.85}>
    <MaterialIcons name={icon} size={14} color={FIELD_COLOR} />
    <Text style={styles.cardBtnText}>{label}</Text>
  </TouchableOpacity>
);

const Row = ({ k, v }) => (
  <View style={styles.tripCardRow}>
    <Text style={styles.tripCardLabel}>{k}</Text>
    <Text style={styles.tripCardValue}>{v}</Text>
  </View>
);

const ActionBtn = ({ icon, label, onPress, disabled, variant = 'primary' }) => (
  <TouchableOpacity
    style={[styles.actionBtn, styles[`actionBtn_${variant}`], disabled && { opacity: 0.55 }]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.85}
  >
    <MaterialIcons name={icon} size={18} color="#fff" />
    <Text style={styles.actionBtnText}>{label}</Text>
  </TouchableOpacity>
);

const TotalCell = ({ label, value }) => (
  <View style={styles.totalCell}>
    <Text style={styles.totalLabel}>{label}</Text>
    <Text style={styles.totalValue}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  loadingFull: { padding: 30, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  readOnlyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#E3F2FD', borderLeftWidth: 3, borderLeftColor: '#1565C0',
    padding: 12, borderRadius: 8, marginTop: 10,
  },
  readOnlyText: { flex: 1, fontSize: 12, color: '#1565C0', fontFamily: FONT_FAMILY.urbanistBold },
  sectionTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 14, marginBottom: 4 },
  tripCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: '#EEE',
    borderLeftWidth: 3, borderLeftColor: FIELD_COLOR,
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2 },
    }),
  },
  tripCardReturn: { borderLeftColor: '#009688' },
  tripCardRow: { flexDirection: 'row', gap: 6, marginBottom: 3 },
  tripCardLabel: { fontSize: 11.5, color: '#777', fontFamily: FONT_FAMILY.urbanistMedium, width: 65 },
  tripCardValue: { flex: 1, fontSize: 12.5, color: '#222', fontFamily: FONT_FAMILY.urbanistBold },
  legBadge: {
    alignSelf: 'flex-start', fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold, color: '#00695C',
    backgroundColor: '#E0F2F1', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, marginBottom: 6, overflow: 'hidden',
  },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FAFAFA', borderRadius: 12, padding: 12, marginTop: 6,
    borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed',
  },
  emptyText: { flex: 1, fontSize: 12, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium },
  // Yellow info banner — same palette as the "Late by X" warning above.
  infoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF3CD', borderColor: '#FFE69C', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6,
  },
  infoBannerText: { flex: 1, fontSize: 12, color: '#856404', fontFamily: FONT_FAMILY.urbanistMedium },
  // Pending Trip Card — outbound trip awaiting its customer.visit
  pendingCard: {
    backgroundColor: '#FFFBEA',
    borderColor: '#F5C76E',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  pendingRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  pendingLeft: { flex: 1.4 },
  pendingRight: { flex: 1, alignItems: 'stretch', justifyContent: 'center' },
  enterVisitsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#198754', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12,
  },
  enterVisitsText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  // Hint under disabled "Add Additional Trip" buttons when blocked by pending.
  disabledHint: {
    fontSize: 11.5, color: '#856404',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginTop: 8, marginBottom: 2, paddingHorizontal: 4,
  },
  btnRow: { gap: 10, marginTop: 14, marginBottom: 4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 14, paddingVertical: 13,
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
    }),
  },
  actionBtn_primary: { backgroundColor: FIELD_COLOR },
  actionBtn_return:  { backgroundColor: '#009688' },
  actionBtn_home:    { backgroundColor: '#E65100' },
  actionBtnText: { color: '#fff', fontSize: 13.5, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.2 },
  // Two-column TRIP DETAILS / VISIT DETAILS layout inside the secondary
  // trip card — mirrors the Odoo module's side-by-side panels.
  twoColRow: {
    flexDirection: 'row', gap: 8, marginTop: 4,
  },
  twoColCol: {
    flex: 1,
    backgroundColor: '#FAFAFA',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1, borderColor: '#EEE',
  },
  twoColHeader: {
    fontSize: 10.5,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#666',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  colRow: { flexDirection: 'row', marginBottom: 3, gap: 4 },
  colRowKey: { fontSize: 10.5, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium, width: 78 },
  colRowVal: { flex: 1, fontSize: 11, color: '#222', fontFamily: FONT_FAMILY.urbanistBold },
  cardActionsRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 10, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: '#F0F0F0',
  },
  cardBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#E3F2FD', borderRadius: 8,
  },
  cardBtnText: { fontSize: 12, color: FIELD_COLOR, fontFamily: FONT_FAMILY.urbanistBold },
  // Small green chip rendered next to Add Fuel when one or more fuel.logs
  // are attached to this trip. Mirrors the Odoo module's "N fuel log added"
  // indicator on the secondary trip card.
  fuelBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#E8F5E9', borderRadius: 8,
  },
  fuelBadgeText: { fontSize: 11, color: '#2E7D32', fontFamily: FONT_FAMILY.urbanistBold },
  totalsCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginTop: 14,
    borderWidth: 1, borderColor: '#EEE',
  },
  totalsTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginBottom: 6 },
  totalsRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  totalCell: { flex: 1, backgroundColor: '#F8F9FA', borderRadius: 8, padding: 8 },
  totalLabel: { fontSize: 11, color: '#777', fontFamily: FONT_FAMILY.urbanistMedium },
  totalValue: { fontSize: 14, color: '#222', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 2 },
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#E65100', borderRadius: 10, paddingVertical: 12, marginTop: 16,
  },
  checkoutBtnText: { color: '#fff', fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold },
});

export default FieldAttendanceSection;
