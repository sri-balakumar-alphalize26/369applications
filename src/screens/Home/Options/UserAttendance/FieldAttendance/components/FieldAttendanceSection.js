import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StyleSheet, Platform,
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
} from '@api/services/generalApi';
import { consumePendingNewTrip } from '@utils/newTripChannel';
import { consumePendingNewVisit } from '@utils/newVisitChannel';
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
}) => {
  const navigation = useNavigation();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

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
    } catch (e) {
      console.error(TAG, 'refresh threw:', e?.message);
      showToastMessage(e?.message || 'Failed to load attendance');
      setState(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [attendanceId]);

  useEffect(() => { refresh(); }, [refresh]);

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
        }
      } catch (e) {
        console.warn(TAG, '  hydrate start_km failed, using state value:', e?.message);
      }
      console.log(TAG, '  → opening Close Previous Trip sheet first');
      setClosePrevMeta({ ref: prev.ref, startKm: actualStartKm });
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
    closeAllSheets();
    navigation.navigate('VehicleTrackingForm', {
      returnTo: 'fieldAttendance',
      prefillSourceId,
      prefillVehicleId,
      prefillStartKm,
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
    // The popup forwards the selected source trip's purpose_of_visit_id so
    // VisitForm can prefill the Purpose dropdown — only this entry path
    // carries that signal.
    const prefillPurposeId = params?.purposeOfVisitId || null;
    console.log(TAG, 'handleCreateNewVisit — lastActiveSheet: outbound, prefillPurposeId:', prefillPurposeId, 'navigate → VisitForm');
    closeAllSheets();
    navigation.navigate('VisitForm', { returnTo: 'fieldAttendance', prefillPurposeId });
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
        openNextSheet(action);
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
    setBusy(true);
    try {
      const res = await createAdditionalTripOdoo(attendanceId, { tripId, visitId, startKm });
      if (res?.error) {
        console.warn(TAG, 'createAdditionalTrip error:', res.error);
        showToastMessage(errMsg(res.error));
        return;
      }
      console.log(TAG, 'createAdditionalTrip OK');
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

  const handleCheckOut = () => {
    console.log(TAG, 'handleCheckOut clicked');
    showAlert({
      message: 'Check out now? Your last open trip will be closed, every visit marked as Done, and the whole page locks.',
      confirmText: 'Check Out',
      cancelText: 'Cancel',
      destructive: true,
      onConfirm: async () => {
        console.log(TAG, 'checkOut confirmed');
        hideAlert();
        setBusy(true);
        try {
          const res = await fieldActionCheckOutOdoo(attendanceId);
          if (res?.error) {
            console.warn(TAG, 'checkOut error:', res.error);
            showToastMessage(errMsg(res.error, 'Check out failed'));
            return;
          }
          console.log(TAG, 'checkOut OK');
          showToastMessage('Checked out successfully');
          await refresh({ silent: true });
          if (typeof onCheckedOut === 'function') onCheckedOut();
        } catch (e) {
          console.error(TAG, 'handleCheckOut threw:', e?.message);
          showToastMessage(e?.message || 'Check out failed');
        } finally {
          setBusy(false);
        }
      },
    });
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
  const showPrimaryTripBtn = !state.source_trip && !isCheckedOut;
  const showSecondaryBtn = !hasTripLines && !isCheckedOut;
  const showAddAdditionalOutboundBtn = hasTripLines && state.show_primary_return_button && !isCheckedOut;
  const showViaOfficeOrDirectBtn = state.show_primary_return_button && !isCheckedOut;
  const showAddAdditionalBottomBtn = state.has_return_trip_lines && !isCheckedOut;
  const showOfficeToHomeBtn = state.show_office_to_home_button && !isCheckedOut;
  const att = state.attendance;

  const inner = (
    <View style={{ padding: embedded ? 0 : 14, paddingBottom: embedded ? 0 : 40 }}>
      {/* Read-only banner */}
      {isCheckedOut ? (
        <View style={styles.readOnlyBanner}>
          <MaterialIcons name="lock" size={16} color="#1565C0" />
          <Text style={styles.readOnlyText}>
            This attendance has been checked out and is now read-only.
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
        />
      ) : (
        <View style={styles.emptyCard}>
          <MaterialIcons name="route" size={22} color="#BDBDBD" />
          <Text style={styles.emptyText}>No primary trip set up yet.</Text>
        </View>
      )}

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

      {/* Built-in Check Out (only when not embedded and host asks for it) */}
      {showCheckOutButton && !isCheckedOut ? (
        <TouchableOpacity style={styles.checkoutBtn} onPress={handleCheckOut} disabled={busy}>
          <MaterialIcons name="logout" size={16} color="#fff" />
          <Text style={styles.checkoutBtnText}>Check Out Now</Text>
        </TouchableOpacity>
      ) : null}
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
        saving={busy}
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
        onClose={() => { setPrimaryOpen(false); setPendingTripId(null); }}
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
        onClose={() => { setOutboundOpen(false); setPendingTripId(null); setPendingVisitId(null); }}
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
        onClose={() => { setReturnOpen(false); setPendingTripId(null); }}
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
        onClose={() => { setOfficeHomeOpen(false); setPendingTripId(null); }}
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
          navigation.navigate('VisitDetails', { visitId: visit?.id, visitDetails: visit });
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
const TripCard = ({ label, trip, visits, readOnly, onOpenTrip, onViewVisits }) => {
  const hasVisits = Array.isArray(visits) && visits.length > 0;
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
      />
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
const ActionRow = ({ readOnly, onOpenTrip, onViewVisits, onAddFuel }) => {
  if (readOnly) return null;
  if (!onOpenTrip && !onViewVisits && !onAddFuel) return null;
  return (
    <View style={styles.cardActionsRow}>
      {onOpenTrip ? (
        <CardBtn icon="open-in-new" label="Open Source Trip" onPress={onOpenTrip} />
      ) : null}
      {onViewVisits ? (
        <CardBtn icon="place" label="View Visits" onPress={onViewVisits} />
      ) : null}
      {onAddFuel ? (
        <CardBtn icon="local-gas-station" label="Add Fuel" onPress={onAddFuel} />
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
