import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { consumePendingNewTrip } from '@utils/newTripChannel';
import { consumePendingNewVisit } from '@utils/newVisitChannel';
import { getPendingSecondaryTrip, clearPendingSecondaryTrip } from '@utils/pendingSecondaryTrip';
import { StyledAlertModal } from '@components/Modal';
import { View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, Dimensions, Modal, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { RoundedScrollContainer } from '@components/containers';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { OverlayLoader } from '@components/Loader';
import { showToastMessage } from '@components/Toast';
import { useAuthStore } from '@stores/auth';
import { checkInByEmployeeId, checkOutToOdoo, getTodayAttendanceByEmployeeId, getLastOpenAttendance, getEmployeeByDeviceId, verifyEmployeePin, verifyAttendanceLocation, getCurrentLocation, uploadAttendancePhoto, submitWfhRequest, getTodayApprovedWfh, wfhCheckIn, wfhCheckOut, getMyWfhRequests, getLateConfig, getCachedLateConfig, submitLateReason, getTodayAttendanceWithLateInfo, submitLeaveRequest, getMyLeaveRequests, cancelLeaveRequest, getEligibleLateAttendances, submitWaiverRequest, getMyWaiverRequests, getWorkplaceLocation, prewarmLocation, fetchAndCacheLateSlabs, computeLocalDeductionAmount, previewLateInfoOdoo, createCustomerVisit, closeCustomerVisit } from '@services/AttendanceService';
import {
  fetchTodayFieldAttendanceOdoo,
  createFieldAttendanceOdoo,
  searchMyFieldAttendanceOdoo,
  searchMyOfficeAttendanceOdoo,
  startFieldAttendanceOdoo,
  checkOutFieldAttendanceOdoo,
  readFieldAttendanceDetailOdoo,
  readFieldTripLinesOdoo,
  searchAvailableTripsOdoo,
  searchDraftCustomerVisitsOdoo,
  readVehicleTrackingForTripIdsOdoo,
  readCustomerVisitsByIdsOdoo,
  getFieldAttendanceStateOdoo,
  updateFieldAttendancePrimaryTripOdoo,
  createFieldTripLineOdoo,
  deleteFieldTripLineOdoo,
  endVehicleTripFromAttendanceOdoo,
  markCustomerVisitsDoneOdoo,
} from '@api/services/generalApi';
import HistoryListItem from '@screens/Home/Options/UserAttendance/FieldAttendance/components/HistoryListItem';
import HistoryFiltersSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/HistoryFiltersSheet';
// NEW: shared field-attendance section that mirrors the hr_field_attendance
// Odoo module's flow (Setup Primary / Secondary, Add Additional Trip,
// Primary Trip Via Office or Direct, Office to Home, cycle, freeze on
// checkout). Same component is also used by FieldAttendanceDetailScreen.
import FieldAttendanceSection from '@screens/Home/Options/UserAttendance/FieldAttendance/components/FieldAttendanceSection';
import TripDetailSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripDetailSheet';
import VisitsListSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitsListSheet';
import ClosePreviousTripSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/ClosePreviousTripSheet';
import { computeLocalLateInfo, floatToHM } from '@utils/lateLogic';
import { formatTimeOffice, formatDateOffice, hydrateOfficeTimezone, getOfficeTimezone } from '@utils/officeTime';
import * as offlineQueue from '@utils/offlineQueue';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { MaterialIcons, Feather, Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Application from 'expo-application';
import { toShortDeviceCode } from '@utils/shortDeviceId';
import AsyncStorage from '@react-native-async-storage/async-storage';
import networkStatus from '@utils/networkStatus';

const { width, height } = Dimensions.get('window');
const isSmall = width < 360;
// Cap effective width so the UI doesn't blow up on tablets / large screens.
// Phones <= 430px scale linearly; anything wider (tablets) uses the same base
// scale as a 430px phone, so fonts, icons and paddings stay phone-sized.
const BASE_WIDTH = 390;
const MAX_SCALE_WIDTH = 430;
const effectiveWidth = Math.min(width, MAX_SCALE_WIDTH);
const scale = (size) => Math.round((effectiveWidth / BASE_WIDTH) * size);
// Content column width — phones use full width, tablets get a centered column.
const CONTENT_MAX_WIDTH = MAX_SCALE_WIDTH;

// Convert raw vehicle.tracking read() output (m2o pairs as [id, name]) into
// the flat shape VehicleTrackingForm.js's state initializer expects.
// Mirrors the heavy mapping fetchVehicleTrackingTripsOdoo does for entries
// coming from the regular VehicleTracking list page. The form's destructure
// uses `(in_progress && *_name) ? *_name : (legacyKey || '')` for many fields,
// so we set BOTH the *_name AND the legacy lowercase keys to make the form
// populate regardless of trip status. All checklist booleans + photo + notes
// pass through unchanged via `...trip`.
const flattenTripForForm = (trip) => {
  if (!trip) return null;
  const flatten = (m2o) => Array.isArray(m2o)
    ? { id: m2o[0], name: m2o[1] || '' }
    : { id: m2o || '', name: '' };
  const veh = flatten(trip.vehicle_id);
  const drv = flatten(trip.driver_id);
  const src = flatten(trip.source_id);
  const dst = flatten(trip.destination_id);
  const purp = flatten(trip.purpose_of_visit_id);
  return {
    ...trip,
    // Vehicle: snake + name + legacy fallback
    vehicle_id: veh.id,
    vehicle_name: veh.name,
    vehicle: veh.name,
    // Driver
    driver_id: drv.id,
    driver_name: drv.name,
    driver: drv.name,
    // Source location
    source_id: src.id,
    source_name: src.name,
    source: src.name,
    // Destination location
    destination_id: dst.id,
    destination_name: dst.name,
    destination: dst.name,
    // Purpose of visit
    purpose_of_visit_id: purp.id,
    purpose_of_visit_name: purp.name,
    purpose_of_visit: purp.name,
    // Plate number (camelCase fallback)
    plateNumber: trip.number_plate || '',
    // KM (camelCase fallback)
    startKM: trip.start_km != null ? String(trip.start_km) : '',
    endKM: trip.end_km != null ? String(trip.end_km) : '',
    // Estimated time (camelCase fallback)
    estimatedTime: trip.estimated_time != null ? String(trip.estimated_time) : '',
    // Pre-trip checklist — form expects a nested camelCase object that
    // mirrors the snake_case booleans from vehicle.tracking.
    vehicleChecklist: {
      coolentWater:    !!trip.coolant_water,
      oilChecking:     !!trip.oil_checking,
      tyreChecking:    !!trip.tyre_checking,
      batteryChecking: !!trip.battery_checking,
      fuelChecking:    !!trip.fuel_checking,
      dailyChecks:     !!trip.daily_checks,
    },
  };
};

const UserAttendanceScreen = ({ navigation, route }) => {
  const initialMode = route?.params?.initialMode || null;
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [todayAttendance, setTodayAttendance] = useState(null);
  // True while the office today-attendance is being fetched — gates the office
  // section so it shows a loader instead of flashing the Check-In button before
  // the real (cached/server) state is known.
  const [officeLoading, setOfficeLoading] = useState(true);
  const [verifiedEmployee, setVerifiedEmployee] = useState(null);
  const [locationStatus, setLocationStatus] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [deviceName, setDeviceName] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [verificationMethod, setVerificationMethod] = useState(null); // 'fingerprint' | 'pin'
  const currentUser = useAuthStore(state => state.user);

  // Mode selection: null = choosing, 'office' = office attendance, 'wfh' = work from home
  const [attendanceMode, setAttendanceMode] = useState(initialMode);

  // WFH state
  const [wfhReason, setWfhReason] = useState('');
  const [todayWfhRequest, setTodayWfhRequest] = useState(null);
  const [wfhRequests, setWfhRequests] = useState([]);

  // Leave request state
  const [leaveType, setLeaveType] = useState('casual');
  const [leaveFromDate, setLeaveFromDate] = useState(new Date());
  const [leaveToDate, setLeaveToDate] = useState(null);
  const [leaveReason, setLeaveReason] = useState('');
  const [showLeaveFromPicker, setShowLeaveFromPicker] = useState(false);
  const [showLeaveToPicker, setShowLeaveToPicker] = useState(false);
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [leaveTab, setLeaveTab] = useState('form'); // 'form' | 'history'

  // Late reason state
  const [showLateReasonModal, setShowLateReasonModal] = useState(false);
  const [lateReasonText, setLateReasonText] = useState('');
  const [pendingLateAttendanceId, setPendingLateAttendanceId] = useState(null);
  // Reason-before-check-in: when set, the late modal's Submit runs this action
  // with the typed reason — it performs the ACTUAL check-in (office or field)
  // that was deferred until a reason was given. Falls back to the legacy
  // "patch an already-created record" path (pendingLateAttendanceId) when null.
  const [pendingLateAction, setPendingLateAction] = useState(null);
  const [lateInfo, setLateInfo] = useState(null); // { isLate, lateMinutes, lateSequence }

  // Customer Visit (field-work) state — when on, geofence check is skipped
  // and a customer.visit record is created at check-in / closed at check-out.
  const [fieldVisitMode, setFieldVisitMode] = useState(false);
  const [visitCustomer, setVisitCustomer] = useState(null);    // { id, name, ... }
  const [linkedVisitId, setLinkedVisitId] = useState(null);     // server-side customer.visit id

  // Waiver request state
  const [waiverTab, setWaiverTab] = useState('form'); // 'form' | 'history'
  const [eligibleLateAttendances, setEligibleLateAttendances] = useState([]);
  const [selectedWaiverAttendanceId, setSelectedWaiverAttendanceId] = useState(null);
  const [waiverReason, setWaiverReason] = useState('');
  const [waiverRequests, setWaiverRequests] = useState([]);

  // Field Attendance state — driven by hr.attendance.get_today_field_attendance
  // status values: 'loading' | 'no_trip' | 'no_visit' | 'trip_open'
  //              | 'manual_exists' | 'already_field' | 'eligible'
  const [fieldStatus, setFieldStatus] = useState('loading');
  const [fieldData, setFieldData] = useState(null);
  const [fieldSubmitting, setFieldSubmitting] = useState(false);

  // Field Attendance — inline detail state for Today tab post-check-in.
  const [fieldDetail, setFieldDetail] = useState(null);  // hr.attendance row + computed totals
  const [fieldLines, setFieldLines] = useState([]);      // trip-line rows
  const [editPrimaryOpen, setEditPrimaryOpen] = useState(false);
  const [editPrimarySaving, setEditPrimarySaving] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [addLineSaving, setAddLineSaving] = useState(false);
  const [tripSheetOpen, setTripSheetOpen] = useState(false);
  const [tripSheetTrip, setTripSheetTrip] = useState(null);
  const [tripSheetLoading, setTripSheetLoading] = useState(false);
  const [visitsSheetOpen, setVisitsSheetOpen] = useState(false);
  const [visitsSheetRows, setVisitsSheetRows] = useState([]);
  const [visitsSheetLoading, setVisitsSheetLoading] = useState(false);
  const [checkOutSubmitting, setCheckOutSubmitting] = useState(false);
  const [fieldBusy, setFieldBusy] = useState(false);     // generic busy flag for delete/end-trip
  // End-KM prompt shown before field check-out when the day's last trip is
  // still open. Captures end_km on that trip and bulk-marks every linked
  // visit as done before the checkout fires.
  const [endKmPrompt, setEndKmPrompt] = useState({
    visible: false,
    tripId: null,
    tripRef: '',
    startKm: 0,
    saving: false,
  });
  // After Create-New-Trip → VehicleTrackingForm → Start Trip, we want to
  // re-open the picker the user came from. These flags track that.
  const [pendingFieldPickerReopen, setPendingFieldPickerReopen] = useState(null);  // 'edit' | 'add' | null
  const [autoOpenPickerEdit, setAutoOpenPickerEdit] = useState(false);
  const [autoOpenPickerAdd, setAutoOpenPickerAdd] = useState(false);
  const [fieldNewTripIdToHighlight, setFieldNewTripIdToHighlight] = useState(null);
  const [fieldNewVisitIdToHighlight, setFieldNewVisitIdToHighlight] = useState(null);
  const [pendingFieldVisitReopen, setPendingFieldVisitReopen] = useState(null);   // 'edit' | 'add' | null
  const [autoOpenVisitPickerEdit, setAutoOpenVisitPickerEdit] = useState(false);
  const [autoOpenVisitPickerAdd, setAutoOpenVisitPickerAdd] = useState(false);
  // Same idea for "Open in Vehicle Tracking" from TripDetailSheet — remember
  // the trip + parent sheet so we can restore them on focus return.
  const [pendingTripDetailReopen, setPendingTripDetailReopen] = useState(null);  // { tripId, parentSheet: 'edit' | 'add' | null }
  // Same idea for tap-a-visit → VisitDetails. Snapshots which parent sheet
  // was open + the linked-visit ids so we can re-open both on return.
  const [pendingFieldVisitDetailReopen, setPendingFieldVisitDetailReopen] = useState(null); // { parentSheet, visitsListIds } | null
  // End-KM prompt before Add Additional Trip — captures the previous trip's
  // end odometer reading and writes it onto the trip during auto-end.
  // Tick we bump after a successful check-out so the embedded FA section
  // (which doesn't see UA's focus events while the user stays on the same
  // screen) re-fetches its server state and locks down — banner shows, all
  // "next trip" CTAs hide, Add Fuel disappears, etc.
  const [faRefreshTick, setFaRefreshTick] = useState(0);
  const [endKmPromptVisible, setEndKmPromptVisible] = useState(false);
  const [endKmPromptTripId, setEndKmPromptTripId] = useState(null);
  const [endKmPromptTripRef, setEndKmPromptTripRef] = useState('');
  const [endKmPromptValue, setEndKmPromptValue] = useState('');

  // Field Attendance — tab + history state
  const [fieldTab, setFieldTab] = useState('today'); // 'today' | 'history'
  const [fieldHistoryRows, setFieldHistoryRows] = useState([]);
  const [fieldHistoryLoading, setFieldHistoryLoading] = useState(false);
  const [fieldHistoryFilters, setFieldHistoryFilters] = useState({
    dateFrom: null, dateTo: null,
    lateOnly: false, withDeduction: false, waived: false,
  });
  const [fieldHistoryHasMore, setFieldHistoryHasMore] = useState(false);
  const [fieldHistoryOffset, setFieldHistoryOffset] = useState(0);
  const [fieldFiltersOpen, setFieldFiltersOpen] = useState(false);

  // Office Attendance — tab + history state (mirror of field)
  const [officeTab, setOfficeTab] = useState('today'); // 'today' | 'history'
  const [officeHistoryRows, setOfficeHistoryRows] = useState([]);
  const [officeHistoryLoading, setOfficeHistoryLoading] = useState(false);
  const [officeHistoryFilters, setOfficeHistoryFilters] = useState({
    dateFrom: null, dateTo: null,
    lateOnly: false, withDeduction: false, waived: false,
  });
  const [officeHistoryHasMore, setOfficeHistoryHasMore] = useState(false);
  const [officeHistoryOffset, setOfficeHistoryOffset] = useState(0);
  const [officeFiltersOpen, setOfficeFiltersOpen] = useState(false);
  const [officeDetailRow, setOfficeDetailRow] = useState(null);
  const [officeDetailOpen, setOfficeDetailOpen] = useState(false);
  // Update-reason editor (Today view only — allowed until checkout)
  const [officeUpdateOpen, setOfficeUpdateOpen] = useState(false);
  const [officeUpdateText, setOfficeUpdateText] = useState('');
  const [officeUpdateSaving, setOfficeUpdateSaving] = useState(false);

  // Camera state
  const [cameraPermission, requestCameraPermission] = Camera.useCameraPermissions();
  const [showCamera, setShowCamera] = useState(false);
  const [cameraType, setCameraType] = useState('check_in');
  const [countdown, setCountdown] = useState(3);
  const [isCapturing, setIsCapturing] = useState(false);
  const cameraRef = useRef(null);

  // Single styled alert modal state for all in-screen confirmations/errors.
  // Use showAlert({ message, confirmText?, cancelText?, destructive?, onConfirm?, onCancel? })
  // to open; buttons auto-close the modal after firing their callback.
  const [alertModal, setAlertModal] = useState({
    visible: false,
    message: '',
    confirmText: 'OK',
    cancelText: '',
    destructive: false,
    onConfirm: null,
    onCancel: null,
  });
  const hideAlert = useCallback(() => {
    setAlertModal((s) => ({ ...s, visible: false }));
  }, []);
  const showAlert = useCallback((opts) => {
    setAlertModal({
      visible: true,
      message: opts?.message || '',
      confirmText: opts?.confirmText || 'OK',
      cancelText: opts?.cancelText || '',
      destructive: !!opts?.destructive,
      onConfirm: opts?.onConfirm || null,
      onCancel: opts?.onCancel || null,
    });
  }, []);

  // Track device connectivity so we can show an OFFLINE banner and disable
  // network-only features. Subscribes via the same poll-based helper used by
  // OfflineSyncService — fires when state flips between online/offline.
  const [offline, setOffline] = useState(false);
  // Seed the office timezone on mount so attendance/leave/waiver/field times
  // render in office time (not the device timezone) even before the late config
  // loads. getLateConfig/getCachedLateConfig refresh it once the employee is verified.
  useEffect(() => {
    hydrateOfficeTimezone();
  }, []);

  useEffect(() => {
    let mounted = true;
    networkStatus.isOnline().then((online) => {
      if (mounted) setOffline(!online);
    });
    const unsubscribe = networkStatus.subscribe((online) => {
      if (mounted) setOffline(!online);
    });
    return () => { mounted = false; unsubscribe && unsubscribe(); };
  }, []);

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Get device ID on mount
  useEffect(() => {
    const fetchDeviceId = async () => {
      try {
        let rawId;
        if (Platform.OS === 'android') {
          rawId = Application.getAndroidId();
        } else {
          rawId = await Application.getIosIdForVendorAsync();
        }
        // Use a short, stable 10-digit code (derived from the OS id) everywhere —
        // easier for HR to register; same stability as the raw id.
        const shortId = toShortDeviceCode(rawId);
        // Device model name — from RN Platform.constants (no extra package).
        // Android exposes Brand/Manufacturer/Model; iOS only the OS name.
        const c = Platform.constants || {};
        const name = Platform.OS === 'android'
          ? [c.Manufacturer || c.Brand, c.Model].filter(Boolean).join(' ').trim()
          : (c.systemName || 'iOS');
        console.log('[Attendance] Device ID (raw):', rawId, '→ code:', shortId, 'name:', name);
        setDeviceId(shortId);
        setDeviceName(name || Platform.OS);
      } catch (error) {
        console.error('[Attendance] Failed to get device ID:', error);
      }
    };
    fetchDeviceId();
  }, []);

  // Pre-warm GPS + workplace cache as soon as the employee is verified, so the
  // location step on Check In / Check Out returns in milliseconds instead of
  // blocking on a cold GPS lock and 3 serial Odoo calls.
  useEffect(() => {
    if (!isVerified) return;
    if (offline) return;
    const uid = verifiedEmployee?.userId || currentUser?.uid;
    if (!uid) return;

    prewarmLocation();
    getWorkplaceLocation(uid).catch((e) => {
      console.log('[Attendance] Prewarm workplace failed:', e?.message);
    });
  }, [isVerified, verifiedEmployee, currentUser, offline]);

  // Auto-refresh WFH status every 5 seconds when waiting for approval
  useEffect(() => {
    let interval;
    const uid = verifiedEmployee?.userId || currentUser?.uid;
    // Skip the 5-second poll entirely when offline — no point hammering a
    // network we know is unreachable, and it pollutes logs.
    if (!offline && attendanceMode === 'wfh' && isVerified && !todayWfhRequest && uid) {
      interval = setInterval(async () => {
        console.log('[WFH] Auto-refreshing for user:', uid);
        try {
          const wfhReq = await getTodayApprovedWfh(uid);
          if (wfhReq) {
            setTodayWfhRequest(wfhReq);
            showToastMessage('WFH request approved!');
          }
          const reqs = await getMyWfhRequests(uid);
          if (reqs && reqs.length > 0) {
            setWfhRequests(reqs);
          }
        } catch (error) {
          console.error('[WFH] Auto-refresh error:', error);
        }
      }, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [attendanceMode, isVerified, todayWfhRequest, verifiedEmployee, offline]);

  // Field Attendance — fetch today's trip + visit + attendance state.
  // Encapsulated as a callback so we can reuse it from both an effect (when
  // mode/verification changes) and a focus listener (when the user comes
  // back from Vehicle Tracking / Customer Visit screens after creating a
  // new entry).
  const refreshFieldAttendance = useCallback(async ({ silent = false } = {}) => {
    if (!verifiedEmployee?.id) return;
    if (offline) {
      if (!silent) setFieldStatus('loading');
      return;
    }
    if (!silent) {
      setFieldStatus('loading');
      setFieldData(null);
    }
    try {
      const result = await fetchTodayFieldAttendanceOdoo(verifiedEmployee.id);
      setFieldStatus(result?.status || 'no_trip');
      setFieldData(result || null);

      // -------------------------------------------------------------------
      // [FA-DIAG] Cross-midnight diagnostic logging.
      // Field state is decided server-side by get_today_field_attendance,
      // which filters to TODAY's window — so after midnight a still-open
      // record from a previous day is reported as 'eligible' (Check In)
      // instead of 'checked_in_open' (Check Out). The server's 'eligible'
      // response carries no dates, so we ALSO query the last open record
      // (date-agnostic) here purely to print the truth. Logging only — does
      // not change any behavior. Remove once the field fix is verified.
      // -------------------------------------------------------------------
      try {
        console.log('[FA-DIAG] device now=', new Date().toString());
        console.log('[FA-DIAG] server verdict → status=', result?.status,
          'attId=', result?.attendance_id, 'checkIn=', result?.check_in, 'checkOut=', result?.check_out);
        const openRec = await getLastOpenAttendance(verifiedEmployee.id);
        if (openRec) {
          console.log('[FA-DIAG] ACTUAL last OPEN record → id=', openRec.id,
            'check_in=', openRec.check_in, 'check_out=', openRec.check_out,
            'source=', openRec.attendance_source);
          console.log('[FA-DIAG] → Check OUT should be shown for attendance', openRec.id,
            '(server status was', (result?.status) + ')');
        } else {
          console.log('[FA-DIAG] no open record anywhere → Check In is correct');
        }
      } catch (diagErr) {
        console.log('[FA-DIAG] diagnostic skipped:', diagErr?.message);
      }
    } catch (e) {
      console.error('[FieldAttendance] fetch error:', e?.message);
      setFieldStatus('no_trip');
      setFieldData(null);
    }
  }, [verifiedEmployee, offline]);

  useEffect(() => {
    if (attendanceMode !== 'field' || !isVerified || !verifiedEmployee?.id) return;
    refreshFieldAttendance();
  }, [attendanceMode, isVerified, verifiedEmployee, offline, refreshFieldAttendance]);

  // Office: fetch today's attendance whenever office mode is active + verified so
  // the section shows a loader (officeLoading) until the real state is known,
  // instead of flashing the Check-In button from stale/empty state.
  useEffect(() => {
    if (attendanceMode !== 'office' || !isVerified || !verifiedEmployee?.id) return;
    setOfficeLoading(true);
    loadTodayAttendanceForEmployee(verifiedEmployee.id, verifiedEmployee.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMode, isVerified, verifiedEmployee?.id]);

  // Field Attendance history loader. `reset=true` for first page / new filters,
  // `reset=false` to append the next page.
  const PAGE_SIZE = 30;
  const loadFieldHistory = useCallback(async ({ reset = true, filters } = {}) => {
    if (!verifiedEmployee?.id) return;
    if (offline) return;
    const useFilters = filters || fieldHistoryFilters;
    setFieldHistoryLoading(true);
    try {
      const offset = reset ? 0 : fieldHistoryOffset;
      const rows = await searchMyFieldAttendanceOdoo(verifiedEmployee.id, {
        dateFrom: useFilters.dateFrom,
        dateTo: useFilters.dateTo,
        lateOnly: useFilters.lateOnly,
        withDeduction: useFilters.withDeduction,
        waived: useFilters.waived,
        offset, limit: PAGE_SIZE,
      });
      setFieldHistoryHasMore(rows.length === PAGE_SIZE);
      setFieldHistoryOffset(offset + rows.length);
      setFieldHistoryRows((prev) => (reset ? rows : [...prev, ...rows]));
    } catch (e) {
      console.error('[FieldAttendance] history load error:', e?.message);
      if (reset) setFieldHistoryRows([]);
    } finally {
      setFieldHistoryLoading(false);
    }
  }, [verifiedEmployee, offline, fieldHistoryFilters, fieldHistoryOffset]);

  // Refresh the first page every time the user enters the History tab — always
  // reload (not only when empty) so a trip/record checked out since the list was
  // last shown reflects its updated check-out time instead of a stale "--:--".
  useEffect(() => {
    if (attendanceMode !== 'field' || !isVerified || fieldTab !== 'history') return;
    loadFieldHistory({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMode, isVerified, fieldTab]);

  const applyFieldFilters = useCallback((next) => {
    setFieldHistoryFilters(next);
    setFieldFiltersOpen(false);
    setFieldHistoryOffset(0);
    setFieldHistoryRows([]);
    loadFieldHistory({ reset: true, filters: next });
  }, [loadFieldHistory]);

  const openFieldDetail = useCallback((id) => {
    if (!id) return;
    navigation.navigate('FieldAttendanceDetailScreen', { attendanceId: Number(id) });
  }, [navigation]);

  const fieldFilterCount = (
    (fieldHistoryFilters.dateFrom ? 1 : 0) +
    (fieldHistoryFilters.dateTo ? 1 : 0) +
    (fieldHistoryFilters.lateOnly ? 1 : 0) +
    (fieldHistoryFilters.withDeduction ? 1 : 0) +
    (fieldHistoryFilters.waived ? 1 : 0)
  );

  // ---- Office Attendance history (mirror of field history above) ----
  const loadOfficeHistory = useCallback(async ({ reset = true, filters } = {}) => {
    if (!verifiedEmployee?.id) return;
    if (offline) return;
    const useFilters = filters || officeHistoryFilters;
    setOfficeHistoryLoading(true);
    try {
      const offset = reset ? 0 : officeHistoryOffset;
      const rows = await searchMyOfficeAttendanceOdoo(verifiedEmployee.id, {
        dateFrom: useFilters.dateFrom,
        dateTo: useFilters.dateTo,
        lateOnly: useFilters.lateOnly,
        withDeduction: useFilters.withDeduction,
        waived: useFilters.waived,
        offset, limit: PAGE_SIZE,
      });
      setOfficeHistoryHasMore(rows.length === PAGE_SIZE);
      setOfficeHistoryOffset(offset + rows.length);
      setOfficeHistoryRows((prev) => (reset ? rows : [...prev, ...rows]));
    } catch (e) {
      console.error('[OfficeAttendance] history load error:', e?.message);
      if (reset) setOfficeHistoryRows([]);
    } finally {
      setOfficeHistoryLoading(false);
    }
  }, [verifiedEmployee, offline, officeHistoryFilters, officeHistoryOffset]);

  // Refresh the first page every time the user enters the office History tab.
  // Always reload (not only when empty) so a record that was checked out since
  // the list was last shown reflects its updated check-out time — otherwise the
  // cached open record (check_out = false) keeps showing "--:--" after checkout.
  useEffect(() => {
    if (attendanceMode !== 'office' || !isVerified || officeTab !== 'history') return;
    loadOfficeHistory({ reset: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMode, isVerified, officeTab]);

  const applyOfficeFilters = useCallback((next) => {
    setOfficeHistoryFilters(next);
    setOfficeFiltersOpen(false);
    setOfficeHistoryOffset(0);
    setOfficeHistoryRows([]);
    loadOfficeHistory({ reset: true, filters: next });
  }, [loadOfficeHistory]);

  const officeFilterCount = (
    (officeHistoryFilters.dateFrom ? 1 : 0) +
    (officeHistoryFilters.dateTo ? 1 : 0) +
    (officeHistoryFilters.lateOnly ? 1 : 0) +
    (officeHistoryFilters.withDeduction ? 1 : 0) +
    (officeHistoryFilters.waived ? 1 : 0)
  );

  // ============================================================
  // Field Attendance — Today tab inline detail + check-in/out
  // ============================================================

  // Pull the rich detail (primary trip, trip lines, totals, late info) for
  // inline rendering in the Today tab. Called after check-in and on refresh.
  const refreshFieldDetail = useCallback(async (attendanceId) => {
    if (!attendanceId) {
      setFieldDetail(null);
      setFieldLines([]);
      return;
    }
    try {
      const att = await readFieldAttendanceDetailOdoo(attendanceId);
      console.log('[late-flow][field] SERVER deduction on record', attendanceId, '=',
        att?.deduction_amount, '(is_late=', att?.is_late, 'late_minutes=', att?.late_minutes,
        ') — compare against the CLIENT [local-ded] slab estimate shown in the popup');
      setFieldDetail(att);
      const ids = Array.isArray(att?.trip_line_ids) ? att.trip_line_ids : [];
      if (ids.length > 0) {
        const lines = await readFieldTripLinesOdoo(ids);
        lines.sort((a, b) => (a.sequence - b.sequence) || (a.id - b.id));
        setFieldLines(lines);
      } else {
        setFieldLines([]);
      }
    } catch (e) {
      console.error('[FieldAttendance] detail refresh:', e?.message);
    }
  }, []);

  // Whenever eligibility refresh returns checked_in_open / checked_out with
  // an attendance_id, fetch the rich detail for inline rendering.
  useEffect(() => {
    if (fieldData?.attendance_id && (fieldStatus === 'checked_in_open' || fieldStatus === 'checked_out')) {
      refreshFieldDetail(fieldData.attendance_id);
    } else {
      setFieldDetail(null);
      setFieldLines([]);
    }
  }, [fieldData, fieldStatus, refreshFieldDetail]);

  // Check In — confirm → camera (3s countdown auto-capture) → start field
  // attendance + upload photo. Mirrors Office mode's handleCheckIn flow.
  const handleFieldCheckIn = useCallback(() => {
    if (!verifiedEmployee?.id || fieldSubmitting) return;
    showAlert({
      message: `Are you sure you want to check in at ${formatTimeOnly(new Date())}?`,
      confirmText: 'YES',
      cancelText: 'NO',
      onConfirm: async () => {
        hideAlert();
        setFieldSubmitting(true);
        const opened = await openCamera('field_check_in');
        if (!opened) setFieldSubmitting(false);
      },
      onCancel: hideAlert,
    });
  }, [verifiedEmployee, fieldSubmitting, showAlert, hideAlert]);

  // Camera capture finished → start the field attendance + upload photo.
  // Reason-before-check-in: the backend GATES on lateness — when late and no
  // reason is supplied it returns needs_late_reason WITHOUT creating the row, so
  // we show the modal and re-call (doStart) with the reason. The on-time path
  // and the post-reason path share doStart, which also uploads the photo.
  const processFieldCheckIn = async (photoBase64) => {
    const doStart = async (lateReason = null) => {
      console.log('[late-flow][field] startFieldAttendance call — lateReason=', lateReason || '(none)');
      const res = await startFieldAttendanceOdoo(verifiedEmployee.id, lateReason);
      console.log('[late-flow][field] response:', JSON.stringify({
        success: res?.success,
        needs_late_reason: res?.needs_late_reason,
        is_late: res?.is_late,
        late_minutes: res?.late_minutes,
        attendance_id: res?.attendance_id,
        error: res?.error,
      }));
      if (!res?.success) {
        if (res?.needs_late_reason) {
          console.log('[late-flow][field] BRANCH=pre-create gate → opening late modal (reason-first)');
          // Use the SERVER-computed deduction from the gate (preview_late_info),
          // which honors the config's hourly/slab mode — so the popup shows the
          // same amount as the saved record / Odoo web (not a client slab guess).
          console.log('[late-flow][field] server deduction=', res.deduction_amount);
          setLateInfo({
            isLate: true,
            lateMinutes: res.late_minutes || 0,
            lateMinutesDisplay: res.late_minutes_display || '',
            session: res.checkin_session,
            expectedStartDisplay: res.expected_start_time != null
              ? floatToHM(res.expected_start_time)
              : undefined,
            deductionAmount: Number(res.deduction_amount || 0),
          });
          setPendingLateAttendanceId(null);
          setPendingLateAction(() => async (reason) => { await doStart(reason); });
          setShowLateReasonModal(true);
          return;
        }
        console.log('[late-flow][field] BRANCH=error (no needs_late_reason) →', res?.error);
        showAlert({ message: res?.error || 'Failed to check in' });
        return;
      }
      console.log('[late-flow][field] BRANCH=success — row created. needs_late_reason on success?', !!res?.needs_late_reason, '(no popup shown in this branch)');
      showToastMessage('Field check-in marked');
      if (res.attendance_id && photoBase64) {
        try {
          await uploadAttendancePhoto(res.attendance_id, photoBase64, 'check_in');
        } catch (e) {
          console.warn('[FieldAttendance] photo upload (check-in) failed:', e?.message);
        }
      }
      await refreshFieldAttendance({ silent: true });
    };
    try {
      await doStart(null);
    } catch (e) {
      showAlert({ message: e?.message || 'Failed to check in' });
    } finally {
      setFieldSubmitting(false);
    }
  };

  // Locate the most recent trip on the attendance, REGARDLESS of trip_ended
  // flag. Used at check-out to verify End KM server-side (the trip_ended
  // cached flag can be stale — createAdditionalTripOdoo's server hook sets
  // it to true even though end_km may still be 0). We then hydrate the
  // trip and gate the End-KM popup on `end_km`, not on `trip_ended`.
  const findMostRecentTripIdFromState = useCallback(() => {
    if (fieldLines && fieldLines.length > 0) {
      const last = fieldLines[fieldLines.length - 1];
      const id = Array.isArray(last?.trip_id) ? last.trip_id[0] : null;
      const ref = Array.isArray(last?.trip_id) ? last.trip_id[1] : '';
      if (id) return { tripId: Number(id), tripRef: ref };
    }
    if (Array.isArray(fieldDetail?.source_trip_id) && fieldDetail.source_trip_id[0]) {
      return {
        tripId: Number(fieldDetail.source_trip_id[0]),
        tripRef: fieldDetail.source_trip_id[1] || '',
      };
    }
    return null;
  }, [fieldLines, fieldDetail]);

  // Resolve the day's last still-open trip — mirrors the server logic and
  // the openAddTrip handler. Last trip line (if any) takes precedence over
  // the primary trip. Returns null when everything is already closed.
  const resolveLastOpenTrip = useCallback(() => {
    if (fieldLines && fieldLines.length > 0) {
      const last = fieldLines[fieldLines.length - 1];
      if (last && !last.trip_ended) {
        const id = Array.isArray(last.trip_id) ? last.trip_id[0] : null;
        const ref = Array.isArray(last.trip_id) ? last.trip_id[1] : '';
        if (id) return { tripId: Number(id), tripRef: ref };
      }
    }
    if (Array.isArray(fieldDetail?.source_trip_id) && fieldDetail.source_trip_id[0] && !fieldDetail?.source_trip_ended) {
      return {
        tripId: Number(fieldDetail.source_trip_id[0]),
        tripRef: fieldDetail.source_trip_id[1] || '',
      };
    }
    return null;
  }, [fieldLines, fieldDetail]);

  // Collect every visit linked to today's attendance — manually attached
  // (source_visit_ids, trip_line.visit_ids) AND auto-derived (each
  // vehicle.tracking trip's own visit_ids) — and bulk-mark them done.
  // Safe to call multiple times; the write is idempotent.
  const markAllDayVisitsDone = useCallback(async () => {
    const tripIds = new Set();
    if (Array.isArray(fieldDetail?.source_trip_id) && fieldDetail.source_trip_id[0]) {
      tripIds.add(Number(fieldDetail.source_trip_id[0]));
    }
    (fieldLines || []).forEach((line) => {
      if (Array.isArray(line?.trip_id) && line.trip_id[0]) tripIds.add(Number(line.trip_id[0]));
    });
    const visitIds = new Set();
    (fieldDetail?.source_visit_ids || []).forEach((id) => visitIds.add(Number(id)));
    (fieldLines || []).forEach((line) => {
      (line?.visit_ids || []).forEach((id) => visitIds.add(Number(id)));
    });
    if (tripIds.size > 0) {
      try {
        const tripRows = await readVehicleTrackingForTripIdsOdoo(Array.from(tripIds));
        (tripRows || []).forEach((t) => (t?.visit_ids || []).forEach((id) => visitIds.add(Number(id))));
      } catch (e) {
        console.warn('[FieldCheckOut] read trips for visit collection failed:', e?.message);
      }
    }
    if (visitIds.size > 0) {
      try {
        await markCustomerVisitsDoneOdoo(Array.from(visitIds));
      } catch (e) {
        console.warn('[FieldCheckOut] bulk mark visits done failed:', e?.message);
      }
    }
  }, [fieldDetail, fieldLines]);

  // Runs the original confirm + camera + checkout flow. Extracted so the
  // end-KM prompt path and the no-open-trip path can share it.
  const proceedWithFieldCheckOut = useCallback(() => {
    showAlert({
      message: 'Check out now? This will close your latest open trip and mark all draft visits as done.',
      confirmText: 'Check Out',
      cancelText: 'Cancel',
      onConfirm: async () => {
        hideAlert();
        setCheckOutSubmitting(true);
        const opened = await openCamera('field_check_out');
        if (!opened) setCheckOutSubmitting(false);
      },
      onCancel: hideAlert,
    });
  }, [showAlert, hideAlert]);

  // Check Out — if the last trip is still open, prompt for end_km first
  // and bulk-mark draft visits done; then run the existing confirm + camera
  // + checkout flow. Server hook auto-ends the trip and flips visits done
  // server-side too, but doing it client-side first guarantees end_km is
  // captured and works regardless of whether the addon is upgraded.
  const handleFieldCheckOut = useCallback(() => {
    console.log('[UA-CHECKOUT] handleFieldCheckOut tapped', { attendanceId: fieldData?.attendance_id });
    if (!fieldData?.attendance_id) {
      console.log('[UA-CHECKOUT]   no fieldData.attendance_id → bail');
      return;
    }
    // Pending secondary trip = trip created via Start Trip without a visit
    // yet attached. There's no `trip_line` for it on the server, so
    // resolveLastOpenTrip() can't find it — we detect it via the local
    // pendingSecondaryTrip marker and route through the same End-KM popup
    // (ClosePreviousTripSheet) used elsewhere. On Save the trip is closed
    // server-side and check-out continues.
    (async () => {
      const pending = await getPendingSecondaryTrip();
      if (pending && Number(pending.attendanceId) === Number(fieldData.attendance_id)) {
        console.log('[UA-CHECKOUT]   pending secondary trip detected — opening End KM popup',
          { tripId: pending.tripId, startKm: pending.startKm });
        setEndKmPrompt({
          visible: true,
          tripId: pending.tripId,
          tripRef: pending.ref || `Trip #${pending.tripId}`,
          startKm: Number(pending.startKm) || 0,
          saving: false,
        });
        return;
      }
      // Server-truth fallback: use the same RPC the FA section trusts
      // (getFieldAttendanceStateOdoo). UA's own fieldLines lags behind
      // after the two-phase create flow, so we re-fetch the canonical
      // state and look at the most recent trip's end_km directly. If
      // end_km is missing/0, surface the End KM popup before check-out.
      try {
        const faState = await getFieldAttendanceStateOdoo(fieldData.attendance_id);
        console.log('[UA-CHECKOUT]   fa-state for end-km gate:', {
          tripLines: faState?.trip_lines?.length || 0,
          returnLines: faState?.return_lines?.length || 0,
          hasSourceTrip: !!faState?.source_trip,
        });
        const allTrips = [
          ...(faState?.trip_lines || []).map((l) => l?.trip),
          ...(faState?.return_lines || []).map((l) => l?.trip),
        ].filter(Boolean);
        const lastTrip = allTrips.length ? allTrips[allTrips.length - 1] : faState?.source_trip;
        if (lastTrip?.id) {
          const tripId = Number(lastTrip.id);
          const startKm = Number(lastTrip.start_km) || 0;
          const endKm = Number(lastTrip.end_km) || 0;
          if (!endKm) {
            console.log('[UA-CHECKOUT]   trip has no end_km — opening End KM popup',
              { tripId, startKm });
            setEndKmPrompt({
              visible: true,
              tripId,
              tripRef: lastTrip.ref || `Trip #${tripId}`,
              startKm,
              saving: false,
            });
            return;
          }
          console.log('[UA-CHECKOUT]   trip already closed (end_km>0) — proceeding', { endKm });
        } else {
          console.log('[UA-CHECKOUT]   no trip on FA state — proceeding with check-out');
        }
      } catch (e) {
        console.warn('[UA-CHECKOUT]   fa-state lookup failed:', e?.message);
        // Defensive: fall through on transient errors so check-out isn't blocked.
      }
      // No pending trip, no open trip — proceed with the existing flow.
      _continueFieldCheckOut();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldData, showAlert, hideAlert]);

  // Original check-out body extracted so the pending-trip guard above can
  // short-circuit without duplicating the rest of the logic.
  const _continueFieldCheckOut = useCallback(() => {
    // Cross-mode guard: if the open attendance was created via Office
    // (attendance_source = 'manual'), block field check-out and direct
    // the user back to Office mode. Defensive — usually fieldData would
    // be null for an office record so this branch is rare.
    if (todayAttendance?.attendance_source && todayAttendance.attendance_source !== 'field' && todayAttendance.id === fieldData.attendance_id) {
      console.log('[UA-CHECKOUT]   blocked: attendance is office mode, not field');
      showAlert({
        message: 'You checked in via Office Attendance. Switch to Office mode to check out.',
        confirmText: 'OK',
        cancelText: null,
        onConfirm: hideAlert,
        onCancel: hideAlert,
      });
      return;
    }
    const lastOpen = resolveLastOpenTrip();
    console.log('[UA-CHECKOUT]   resolveLastOpenTrip →', lastOpen);
    if (lastOpen?.tripId) {
      // Hydrate start_km from vehicle.tracking so the popup can block when
      // End KM <= Start KM. Mirrors FieldAttendanceSection's pre-popup
      // hydration; `_serialize_trip` historically didn't include start_km.
      (async () => {
        let startKm = 0;
        try {
          console.log('[UA-CHECKOUT]   hydrating prev trip start_km from server', { tripId: lastOpen.tripId });
          const rows = await readVehicleTrackingForTripIdsOdoo([Number(lastOpen.tripId)]);
          const full = rows?.[0];
          if (full && typeof full.start_km === 'number') {
            startKm = full.start_km;
            console.log('[UA-CHECKOUT]   hydrated start_km:', startKm);
          } else {
            console.log('[UA-CHECKOUT]   hydrate returned no start_km, defaulting to 0');
          }
        } catch (e) {
          console.warn('[UA-CHECKOUT]   hydrate start_km failed, defaulting to 0:', e?.message);
        }
        console.log('[UA-CHECKOUT]   opening End KM prompt', {
          tripId: lastOpen.tripId,
          tripRef: lastOpen.tripRef,
          startKm,
        });
        setEndKmPrompt({
          visible: true,
          tripId: lastOpen.tripId,
          tripRef: lastOpen.tripRef,
          startKm,
          saving: false,
        });
      })();
      return;
    }
    // No open trip — still mark any straggler draft visits done, then
    // jump straight into the confirm/camera/checkout flow.
    console.log('[UA-CHECKOUT]   no open trip — marking visits done and proceeding to confirm/camera');
    (async () => {
      await markAllDayVisitsDone();
      proceedWithFieldCheckOut();
    })();
  }, [fieldData, todayAttendance, showAlert, hideAlert, resolveLastOpenTrip, markAllDayVisitsDone, proceedWithFieldCheckOut]);

  // Save handler — receives the already-validated End KM (Number) from
  // ClosePreviousTripSheet's own validation (n > 0 AND n > startKm).
  // Closes the trip with that value, bulk-marks linked visits done, then
  // runs the existing confirm + camera + checkout flow.
  const submitEndKmAndCheckout = useCallback(async (km) => {
    const n = Number(km);
    if (!Number.isFinite(n) || n <= 0) {
      console.warn('[UA-CHECKOUT] submitEndKmAndCheckout: invalid km', { km });
      showToastMessage('Enter a valid End KM');
      return;
    }
    console.log('[UA-CHECKOUT] submitEndKmAndCheckout', {
      tripId: endKmPrompt.tripId,
      startKm: endKmPrompt.startKm,
      endKm: n,
    });
    setEndKmPrompt((s) => ({ ...s, saving: true }));
    try {
      await endVehicleTripFromAttendanceOdoo(endKmPrompt.tripId, null, n);
      console.log('[UA-CHECKOUT]   trip ended OK → bulk-marking visits done');
      // Clear the pending-secondary-trip marker (if any) since the trip
      // is now closed on the server. Harmless when no marker exists.
      try { await clearPendingSecondaryTrip(); } catch (_) {}
      await markAllDayVisitsDone();
      setEndKmPrompt({ visible: false, tripId: null, tripRef: '', startKm: 0, saving: false });
      if (fieldData?.attendance_id) {
        await refreshFieldDetail(fieldData.attendance_id);
      }
      console.log('[UA-CHECKOUT]   chaining into proceedWithFieldCheckOut');
      proceedWithFieldCheckOut();
    } catch (e) {
      console.warn('[UA-CHECKOUT]   end trip failed:', e?.message);
      setEndKmPrompt((s) => ({ ...s, saving: false }));
      showToastMessage(e?.message || 'Failed to finalize trip');
    }
  }, [endKmPrompt, markAllDayVisitsDone, proceedWithFieldCheckOut, fieldData, refreshFieldDetail]);

  const processFieldCheckOut = async (photoBase64) => {
    try {
      await checkOutFieldAttendanceOdoo(fieldData.attendance_id);
      if (fieldData.attendance_id && photoBase64) {
        try {
          await uploadAttendancePhoto(fieldData.attendance_id, photoBase64, 'check_out');
        } catch (e) {
          console.warn('[FieldAttendance] photo upload (check-out) failed:', e?.message);
        }
      }
      showToastMessage('Field attendance checked out');
      await refreshFieldAttendance({ silent: true });
      // Tell the embedded FA section to re-fetch so its UI locks down
      // (read-only banner + hidden CTAs + hidden Add Fuel).
      setFaRefreshTick((t) => t + 1);
    } catch (e) {
      showAlert({ message: e?.message || 'Failed to check out' });
    } finally {
      setCheckOutSubmitting(false);
    }
  };

  // Loaders for the bottom-sheet pickers.
  // Primary picker keeps the current source_trip_id visible (for edit-in-place).
  const fieldLoadAvailableTripsPrimary = useCallback(async () => {
    if (!fieldData?.attendance_id) return [];
    return await searchAvailableTripsOdoo(fieldData.attendance_id, { includeCurrent: true });
  }, [fieldData]);
  // Additional picker excludes the primary trip (already used + now ended).
  const fieldLoadAvailableTripsAdditional = useCallback(async () => {
    if (!fieldData?.attendance_id) return [];
    return await searchAvailableTripsOdoo(fieldData.attendance_id);
  }, [fieldData]);

  const fieldLoadDraftVisitsPrimary = useCallback(async () => {
    if (!verifiedEmployee?.id) return [];
    return await searchDraftCustomerVisitsOdoo(verifiedEmployee.id);
  }, [verifiedEmployee]);
  // Additional picker excludes visits already attached to this attendance
  // (primary's source_visit_ids ∪ any trip line's visit_ids).
  const fieldLoadDraftVisitsAdditional = useCallback(async () => {
    if (!verifiedEmployee?.id) return [];
    const all = await searchDraftCustomerVisitsOdoo(verifiedEmployee.id);
    const used = new Set();
    (fieldDetail?.source_visit_ids || []).forEach((id) => used.add(Number(id)));
    (fieldLines || []).forEach((line) => {
      (line?.visit_ids || []).forEach((id) => used.add(Number(id)));
    });
    return (all || []).filter((v) => !used.has(Number(v.id)));
  }, [verifiedEmployee, fieldDetail, fieldLines]);
  const fieldLoadVisitsByIds = useCallback(async (ids) => {
    return await readCustomerVisitsByIdsOdoo(ids);
  }, []);

  const handleFieldSavePrimary = async (vals) => {
    if (vals?.error) {
      showToastMessage(vals.error);
      return;
    }
    if (!fieldData?.attendance_id) {
      showToastMessage('No attendance to save against — refresh and try again.');
      return;
    }
    console.log('[FieldAttendance] save primary — attendance_id:', fieldData.attendance_id, 'vals:', vals);
    setEditPrimarySaving(true);
    try {
      await updateFieldAttendancePrimaryTripOdoo(fieldData.attendance_id, vals);
      console.log('[FieldAttendance] save primary — write OK');
      showToastMessage('Primary trip saved');
      setEditPrimaryOpen(false);
      setFieldNewTripIdToHighlight(null);
      setFieldNewVisitIdToHighlight(null);
      // Optimistic patch so the card updates instantly. Survives the
      // fieldStatus/fieldData useEffect that can momentarily clear fieldDetail
      // while the follow-up refreshes are in flight.
      if (vals.source_trip_id) {
        setFieldDetail((prev) => prev ? ({
          ...prev,
          source_trip_id: [Number(vals.source_trip_id), prev?.source_trip_id?.[1] || `Trip #${vals.source_trip_id}`],
          source_visit_ids: Array.isArray(vals.source_visit_ids) ? vals.source_visit_ids.map(Number) : prev.source_visit_ids,
          source_visit_count: Array.isArray(vals.source_visit_ids) ? vals.source_visit_ids.length : prev.source_visit_count,
          gps_latitude: vals.gps_latitude ?? prev.gps_latitude,
          gps_longitude: vals.gps_longitude ?? prev.gps_longitude,
          gps_location_name: vals.gps_location_name ?? prev.gps_location_name,
        }) : prev);
      }
      await refreshFieldDetail(fieldData.attendance_id);
      await refreshFieldAttendance({ silent: true });
      console.log('[FieldAttendance] save primary — refresh done');
    } catch (e) {
      console.error('[FieldAttendance] save primary error:', e?.message);
      showToastMessage(e?.message || 'Failed to save');
    } finally {
      setEditPrimarySaving(false);
    }
  };

  const handleFieldSaveTripLine = async ({ trip_id, visit_ids }) => {
    if (!fieldData?.attendance_id) return;
    setAddLineSaving(true);
    try {
      await createFieldTripLineOdoo(fieldData.attendance_id, trip_id, visit_ids);
      showToastMessage('Trip added');
      setAddLineOpen(false);
      setFieldNewTripIdToHighlight(null);
      setFieldNewVisitIdToHighlight(null);
      await refreshFieldDetail(fieldData.attendance_id);
    } catch (e) {
      showToastMessage(e?.message || 'Failed to add trip');
    } finally {
      setAddLineSaving(false);
    }
  };

  const handleFieldDeleteLine = (line) => {
    if (line?.trip_ended) {
      showToastMessage('Cannot delete a line whose trip is already ended.');
      return;
    }
    showAlert({
      message: 'Delete this additional trip line? This cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
      onConfirm: async () => {
        hideAlert();
        setFieldBusy(true);
        try {
          await deleteFieldTripLineOdoo(line.id);
          showToastMessage('Trip line deleted');
          await refreshFieldDetail(fieldData.attendance_id);
        } catch (e) {
          showToastMessage(e?.message || 'Failed to delete');
        } finally {
          setFieldBusy(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  const handleFieldOpenTrip = async (m2oOrId) => {
    const tripId = Array.isArray(m2oOrId) ? m2oOrId[0] : Number(m2oOrId);
    if (!tripId) return;
    setTripSheetOpen(true);
    setTripSheetLoading(true);
    setTripSheetTrip(null);
    try {
      const rows = await readVehicleTrackingForTripIdsOdoo([tripId]);
      setTripSheetTrip(rows[0] || null);
    } catch (e) {
      showToastMessage('Failed to load trip');
    } finally {
      setTripSheetLoading(false);
    }
  };

  const handleFieldViewVisits = async (visitIds) => {
    const ids = (visitIds || []).map(Number);
    if (ids.length === 0) {
      showToastMessage('No visits linked');
      return;
    }
    setVisitsSheetOpen(true);
    setVisitsSheetLoading(true);
    setVisitsSheetRows([]);
    try {
      const rows = await readCustomerVisitsByIdsOdoo(ids);
      setVisitsSheetRows(rows || []);
    } catch (e) {
      showToastMessage('Failed to load visits');
    } finally {
      setVisitsSheetLoading(false);
    }
  };

  // Open a specific linked visit's detail page (parity with how trip rows
  // navigate to VehicleTrackingForm). Snapshots which parent sheet was open
  // so the focus-return effect can re-open it after the user taps back.
  const handleFieldOpenVisitDetail = useCallback((visit, ctx = {}) => {
    const parentSheet = editPrimaryOpen ? 'edit' : (addLineOpen ? 'add' : null);
    setPendingFieldVisitDetailReopen({
      parentSheet,
      visitsListIds: ctx.visitsListIds || null,
    });
    setEditPrimaryOpen(false);
    setAddLineOpen(false);
    setVisitsSheetOpen(false);
    navigation.navigate('VisitDetails', {
      visitId: Number(visit?.id || visit),
      visitDetails: visit && typeof visit === 'object' ? visit : undefined,
      returnTo: 'fieldAttendance',
    });
  }, [navigation, editPrimaryOpen, addLineOpen]);

  // Add Additional Trip — auto-end-with-confirm flow.
  const handleFieldAddAdditionalTrip = useCallback(() => {
    if (!fieldData?.attendance_id) return;
    let prevTripId = null;
    let prevTripRef = '';
    let prevTripEnded = false;
    if (fieldLines.length > 0) {
      const last = fieldLines[fieldLines.length - 1];
      prevTripId = Array.isArray(last?.trip_id) ? last.trip_id[0] : null;
      prevTripRef = Array.isArray(last?.trip_id) ? last.trip_id[1] : '';
      prevTripEnded = !!last?.trip_ended;
    } else if (Array.isArray(fieldDetail?.source_trip_id)) {
      prevTripId = fieldDetail.source_trip_id[0];
      prevTripRef = fieldDetail.source_trip_id[1];
      prevTripEnded = !!fieldDetail?.source_trip_ended;
    }

    if (prevTripId && !prevTripEnded) {
      // Capture end_km BEFORE auto-ending the previous trip, so it lands on
      // the record. Submission of the modal continues into endTripAndOpenAddLine.
      setEndKmPromptTripId(prevTripId);
      setEndKmPromptTripRef(prevTripRef || `#${prevTripId}`);
      setEndKmPromptValue('');
      setEndKmPromptVisible(true);
      return;
    }
    setAddLineOpen(true);
  }, [fieldData, fieldLines, fieldDetail]);

  // Submit handler for the end-km prompt — auto-ends the previous trip
  // (passing the captured end_km), then opens the Add Trip Line popup.
  const submitEndKmAndAddLine = useCallback(async (endKmStr) => {
    if (!endKmPromptTripId) return;
    setEndKmPromptVisible(false);
    setFieldBusy(true);
    try {
      await endVehicleTripFromAttendanceOdoo(endKmPromptTripId, undefined, endKmStr);
      await refreshFieldDetail(fieldData.attendance_id);
      setAddLineOpen(true);
    } catch (e) {
      showToastMessage(e?.message || 'Failed to close previous trip');
    } finally {
      setFieldBusy(false);
    }
  }, [endKmPromptTripId, fieldData, refreshFieldDetail]);

  // Create a new vehicle.tracking trip from inside the trip picker —
  // mirrors Odoo's "Create..." inline option. Closes the field popups
  // before navigating, then on focus return the popups + inner picker are
  // re-opened explicitly via pendingFieldPickerReopen + autoOpenPicker flags.
  const handleCreateNewTrip = useCallback((context) => {
    setEditPrimaryOpen(false);
    setAddLineOpen(false);
    setFieldNewTripIdToHighlight(null);
    setPendingFieldPickerReopen(context || 'edit');
    navigation.navigate('VehicleTrackingForm', { returnTo: 'fieldAttendance' });
  }, [navigation]);

  // Same pattern but for "+ Create New Visit" inside the visit picker.
  const handleCreateNewVisit = useCallback((context) => {
    setEditPrimaryOpen(false);
    setAddLineOpen(false);
    setFieldNewVisitIdToHighlight(null);
    setPendingFieldVisitReopen(context || 'edit');
    navigation.navigate('VisitForm', { returnTo: 'fieldAttendance' });
  }, [navigation]);

  // Re-run when the screen regains focus (e.g. user just came back from
  // Vehicle Tracking after creating a new trip). Silent refresh — keeps the
  // current rendered card on screen and updates in place. ALSO re-opens the
  // field popups the user came from based on pending* flags.
  useFocusEffect(
    useCallback(() => {
      if (attendanceMode !== 'field' || !isVerified || !verifiedEmployee?.id || offline) return;
      refreshFieldAttendance({ silent: true });

      // Case A: came back from "Create New Trip" flow — restore the picker
      // and highlight the just-created trip (VTF passes newTripId via the
      // previous route's params before goBack).
      if (pendingFieldPickerReopen) {
        const ctx = pendingFieldPickerReopen;
        const fromChannel = consumePendingNewTrip();
        const fromParams = route?.params?.newTripId ? Number(route.params.newTripId) : null;
        const newTripId = fromChannel ?? fromParams;
        setPendingFieldPickerReopen(null);
        setFieldNewTripIdToHighlight(newTripId);
        setTimeout(() => {
          if (ctx === 'edit') {
            setAutoOpenPickerEdit(true);
            setEditPrimaryOpen(true);
          } else if (ctx === 'add') {
            setAutoOpenPickerAdd(true);
            setAddLineOpen(true);
          }
        }, 350);
        if (route?.params?.newTripId || route?.params?.refreshKey) {
          navigation.setParams({ newTripId: undefined, refreshKey: undefined, fromSheet: undefined });
        }
      }

      // Case B: came back from "Open in Vehicle Tracking" — restore the
      // parent sheet (if any) AND re-open TripDetailSheet for the same trip.
      if (pendingTripDetailReopen) {
        const { tripId, parentSheet } = pendingTripDetailReopen;
        setPendingTripDetailReopen(null);
        setTimeout(() => {
          if (parentSheet === 'edit') setEditPrimaryOpen(true);
          if (parentSheet === 'add') setAddLineOpen(true);
          if (tripId) handleFieldOpenTrip(tripId);
        }, 350);
      }

      // Case C: came back from "Create New Visit" flow — restore the
      // parent sheet AND auto-open the visit picker, highlighting the
      // freshly-created visit via the newVisitChannel.
      if (pendingFieldVisitReopen) {
        const ctx = pendingFieldVisitReopen;
        const newVisitId = consumePendingNewVisit();
        setPendingFieldVisitReopen(null);
        setFieldNewVisitIdToHighlight(newVisitId);
        setTimeout(() => {
          if (ctx === 'edit') {
            setAutoOpenVisitPickerEdit(true);
            setEditPrimaryOpen(true);
          } else if (ctx === 'add') {
            setAutoOpenVisitPickerAdd(true);
            setAddLineOpen(true);
          }
        }, 350);
      }

      // Case D: came back from "Open Visit Detail" — restore the parent
      // sheet AND re-open VisitsListSheet for the same set of visit ids.
      if (pendingFieldVisitDetailReopen) {
        const { parentSheet, visitsListIds } = pendingFieldVisitDetailReopen;
        setPendingFieldVisitDetailReopen(null);
        setTimeout(() => {
          if (parentSheet === 'edit') setEditPrimaryOpen(true);
          if (parentSheet === 'add') setAddLineOpen(true);
          if (visitsListIds && visitsListIds.length > 0) handleFieldViewVisits(visitsListIds);
        }, 350);
      }
    }, [
      attendanceMode, isVerified, verifiedEmployee, offline,
      refreshFieldAttendance, pendingFieldPickerReopen, pendingTripDetailReopen,
      pendingFieldVisitReopen, pendingFieldVisitDetailReopen,
    ])
  );

  // Camera countdown and auto-capture
  useEffect(() => {
    let timer;
    if (showCamera && countdown > 0) {
      timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
    } else if (showCamera && countdown === 0 && !isCapturing) {
      capturePhoto();
    }
    return () => clearTimeout(timer);
  }, [showCamera, countdown, isCapturing]);

  const openCamera = async (type) => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        showToastMessage('Camera permission is required');
        return false;
      }
    }
    setCameraType(type);
    setCountdown(3);
    setIsCapturing(false);
    setShowCamera(true);
    return true;
  };

  const closeCamera = () => {
    setShowCamera(false);
    setCountdown(3);
    setIsCapturing(false);
  };

  const capturePhoto = async () => {
    if (isCapturing || !cameraRef.current) return;

    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
      });

      console.log('[Attendance] Photo captured, size:', photo.base64?.length);
      closeCamera();

      // Proceed with check-in or check-out (office / wfh / field).
      if (cameraType === 'check_in') {
        if (attendanceMode === 'wfh') {
          await processWfhCheckIn(photo.base64);
        } else {
          await processCheckIn(photo.base64);
        }
      } else if (cameraType === 'check_out') {
        if (attendanceMode === 'wfh') {
          await processWfhCheckOut(photo.base64);
        } else {
          await processCheckOut(photo.base64);
        }
      } else if (cameraType === 'field_check_in') {
        await processFieldCheckIn(photo.base64);
      } else if (cameraType === 'field_check_out') {
        await processFieldCheckOut(photo.base64);
      }
    } catch (error) {
      console.error('Photo capture error:', error);
      showToastMessage('Failed to capture photo');
      closeCamera();
      setLoading(false);
    }
  };

  const loadTodayAttendanceForEmployee = async (employeeId, employeeName) => {
    setOfficeLoading(true);
    try {
      const attendance = await getTodayAttendanceByEmployeeId(employeeId, employeeName);
      setTodayAttendance(attendance);
    } catch (error) {
      console.error('Failed to load attendance:', error);
    } finally {
      setOfficeLoading(false);
    }
  };

  // Restore an in-progress customer visit (if any) when the screen mounts
  // or when verifiedEmployee changes — so the "On Visit: <Customer>" banner
  // reappears after the user navigated away or restarted the app, and the
  // check-out flow can still find the linked visit id.
  useEffect(() => {
    (async () => {
      if (!verifiedEmployee?.id) return;
      try {
        const raw = await AsyncStorage.getItem(`@fieldVisit:active:${verifiedEmployee.id}`);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed?.visitId) {
          setLinkedVisitId(parsed.visitId);
          if (parsed.customer) setVisitCustomer(parsed.customer);
          console.log('[Visit] Restored active visit id:', parsed.visitId);
        }
      } catch (e) {
        console.log('[Visit] Restore skipped:', e?.message);
      }
    })();
  }, [verifiedEmployee?.id]);

  // Prefetch the late config + slabs and stash in AsyncStorage whenever the
  // user is verified AND online. Re-runs on every online flip so the caches
  // stay fresh — guarantees the offline late-reason popup uses the same
  // session-start values as Odoo, AND the offline waiver page can compute
  // non-zero deduction amounts from the slab table.
  useEffect(() => {
    (async () => {
      if (!verifiedEmployee?.id) return;
      if (offline) return;
      try {
        await getLateConfig(verifiedEmployee.id);
        await fetchAndCacheLateSlabs();
        console.log('[offline-late] prefetched late config + slabs for employee', verifiedEmployee.id);
      } catch (e) {
        console.log('[offline-late] prefetch skipped:', e?.message);
      }
    })();
  }, [verifiedEmployee?.id, offline]);

  // Re-pull the office timezone / late config every time this screen regains
  // focus (online + verified). The prefetch effect above only runs when the
  // verified employee changes, so an admin's change to the Office Timezone
  // would otherwise not show until the user re-verifies or restarts the app.
  // Refreshing on focus makes a config change appear on the next visit; the
  // per-second clock tick re-renders the times into the new timezone.
  useFocusEffect(
    useCallback(() => {
      if (!verifiedEmployee?.id || offline) return;
      console.log('[office-tz] focus refresh: pulling late config for employee', verifiedEmployee.id, '| tz before:', getOfficeTimezone());
      getLateConfig(verifiedEmployee.id)
        .then(() => console.log('[office-tz] focus refresh done | tz after:', getOfficeTimezone()))
        .catch(() => { /* ignore — cached tz stays */ });
    }, [verifiedEmployee?.id, offline])
  );

  // Re-prompt the user with the You're Late popup if today's check-in is
  // late and has no `late_reason` recorded yet — works online (queries
  // Odoo) AND offline (recomputes locally and reads the offline queue).
  useEffect(() => {
    (async () => {
      if (!verifiedEmployee?.id || !todayAttendance) return;
      try {
        let isLate = false;
        let lateMin = 0;
        let lateDisplay = '';
        let sequence = null;
        let deduction = null;
        let hasReason = false;
        let attendanceId = todayAttendance.id;
        let sessionLabel;
        let expectedStartDisplay;
        let totalHours = null;
        let reasonText = '';

        const online = await networkStatus.isOnline();

        if (online && todayAttendance.id) {
          const lateResult = await getTodayAttendanceWithLateInfo(verifiedEmployee.id);
          if (lateResult.success && lateResult.records?.length > 0) {
            const rec = lateResult.records.find(r => r.id === todayAttendance.id)
                     || lateResult.records[lateResult.records.length - 1];
            if (rec) {
              isLate = !!rec.isLate;
              lateMin = rec.lateMinutes || 0;
              lateDisplay = rec.lateMinutesDisplay || '';
              sequence = rec.lateSequence;
              deduction = rec.deductionAmount;
              hasReason = !!(rec.lateReason && rec.lateReason.trim());
              reasonText = rec.lateReason || '';
              attendanceId = rec.id;
              sessionLabel = rec.checkinSession;
              expectedStartDisplay = rec.expectedStartTime != null
                ? floatToHM(rec.expectedStartTime)
                : undefined;
              totalHours = rec.dailyTotalHours;
            }
          }
          // Persist the late + total-hours figures onto todayAttendance so the
          // "Today's Details" card (after checkout) can render them.
          setTodayAttendance(prev => prev ? {
            ...prev,
            is_late: isLate,
            late_minutes: lateMin,
            late_minutes_display: lateDisplay,
            deduction_amount: Number(deduction || 0),
            daily_total_hours: totalHours != null ? Number(totalHours) : prev.daily_total_hours,
            late_reason: reasonText,
          } : prev);
        } else {
          // Offline path — recompute from cached config + check queue.
          // checkInTimeUtc is "YYYY-MM-DD HH:MM:SS" UTC; must append 'Z' so
          // JS parses it as UTC, not local. Without the Z, IST shifts by 5:30
          // → math gives "2h 30m" instead of the real "8h" past Session 2 start.
          const cached = await getCachedLateConfig(verifiedEmployee.id);
          const utcStr = todayAttendance.checkInTimeUtc;
          const checkInDt = utcStr
            ? new Date(utcStr.replace(' ', 'T') + 'Z')
            : null;
          if (checkInDt && !isNaN(checkInDt.getTime())) {
            const info = computeLocalLateInfo(checkInDt, cached);
            isLate = info.isLate;
            lateMin = info.lateMinutes || 0;
            lateDisplay = info.lateMinutesDisplay || '';
            sessionLabel = info.session;
            expectedStartDisplay = info.expectedStartDisplay;
            if (isLate) {
              deduction = await computeLocalDeductionAmount(
                verifiedEmployee.id, lateMin, checkInDt
              );
            }
          }
          if (todayAttendance.offlineQueueId) {
            const queue = await offlineQueue.getAll();
            const item = queue.find(q => q.id === todayAttendance.offlineQueueId);
            hasReason = !!(item?.values?.late_reason && String(item.values.late_reason).trim());
            attendanceId = `offline:${todayAttendance.offlineQueueId}`;
          }
        }

        if (isLate && !hasReason && attendanceId) {
          setLateInfo({
            isLate: true,
            lateMinutes: lateMin,
            lateMinutesDisplay: lateDisplay,
            lateSequence: sequence,
            deductionAmount: deduction,
            session: sessionLabel,
            expectedStartDisplay: expectedStartDisplay,
          });
          setPendingLateAttendanceId(attendanceId);
          setShowLateReasonModal(true);
        }
      } catch (e) {
        console.log('[Attendance] late-reason re-prompt skipped:', e?.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayAttendance?.id, todayAttendance?.offlineQueueId, verifiedEmployee?.id]);

  // All three render in the OFFICE timezone (from the Odoo config), not the
  // device clock — so the live time + stamps match Odoo web / the office.
  const formatDate = (date) =>
    formatDateOffice(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const formatTime = (date) => formatTimeOffice(date, { withSeconds: true });

  const formatTimeOnly = (date) => formatTimeOffice(date);

  // Format a check-in/out time LIVE from its raw UTC instant, so it always
  // reflects the CURRENT office timezone (the pre-formatted checkIn/checkOut
  // strings are frozen at fetch time and would otherwise show the old tz until
  // a re-fetch / PIN re-entry). Falls back to the frozen string, then '--:--'.
  const _ltLogRef = useRef({});
  const liveCheckTime = (utc, frozen) => {
    const out = utc ? (formatTimeOffice(utc) || frozen || '--:--') : (frozen || '--:--');
    if (utc) {
      // Log only when the value actually changes (avoid per-second clock spam).
      const sig = `${getOfficeTimezone()}|${utc}|${out}`;
      if (_ltLogRef.current[utc] !== sig) {
        _ltLogRef.current[utc] = sig;
        console.log('[office-tz] liveCheckTime tz=', getOfficeTimezone(), 'utc=', utc, '-> frozen=', frozen, '| live=', out);
      }
    }
    return out;
  };

  const getTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // =============================================
  // FINGERPRINT SCAN
  // =============================================
  const handleFingerprintScan = async () => {
    if (!deviceId) {
      showToastMessage('Device ID not available. Please restart the app.');
      return;
    }

    setLoading(true);
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) {
        showToastMessage('Biometric hardware not available on this device');
        setLoading(false);
        return;
      }

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) {
        showToastMessage('No fingerprint enrolled. Please set up in device settings.');
        setLoading(false);
        return;
      }

      const authResult = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Scan fingerprint for attendance',
        fallbackLabel: 'Use device PIN',
        disableDeviceFallback: false,
      });

      if (!authResult.success) {
        showToastMessage('Authentication failed');
        setLoading(false);
        return;
      }

      console.log('[Attendance] Fingerprint authenticated, looking up device ID:', deviceId);
      const result = await getEmployeeByDeviceId(deviceId, deviceName);

      if (result.success) {
        setIsVerified(true);
        setVerifiedEmployee(result.employee);
        setVerificationMethod('fingerprint');
        showToastMessage(`Welcome, ${result.employee.name}!`);

        // Fire-and-forget: prime the workplace cache for offline use.
        if (attendanceMode === 'office') {
          const uidForWp = result.employee.userId || currentUser?.uid;
          if (uidForWp) {
            getWorkplaceLocation(uidForWp).catch(() => {});
          }
          await loadTodayAttendanceForEmployee(result.employee.id, result.employee.name);
        } else if (attendanceMode === 'wfh') {
          // Check if there's an approved WFH request for today
          const userId = result.employee.userId || currentUser?.uid;
          if (userId) {
            const wfhReq = await getTodayApprovedWfh(userId);
            setTodayWfhRequest(wfhReq);
            // Also load WFH request history
            const requests = await getMyWfhRequests(userId);
            setWfhRequests(requests);  
          }
        }
      } else {
        showToastMessage(result.error || 'No employee found for this device');
      }
    } catch (error) {
      console.error('Fingerprint auth error:', error);
      showToastMessage('Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  // =============================================
  // PIN VERIFICATION
  // =============================================
  const handlePinVerify = async () => {
    if (!pinInput.trim()) {
      showToastMessage('Please enter your PIN');
      return;
    }

    setLoading(true);
    try {
      const userId = currentUser?.uid;
      const result = await verifyEmployeePin(userId, pinInput.trim(), deviceId, deviceName);

      if (result.success) {
        setIsVerified(true);
        setVerifiedEmployee(result.employee);
        setVerificationMethod('pin');
        setPinInput('');
        showToastMessage(`Welcome, ${result.employee.name}!`);

        // Fire-and-forget: prime the workplace cache so offline check-in
        // works without requiring a prior full online check-in. Errors are
        // ignored — if it fails (offline), we'll just rely on whatever
        // workplace was cached the last time it succeeded.
        if (attendanceMode === 'office') {
          const uidForWp = result.employee.userId || currentUser?.uid;
          if (uidForWp) {
            getWorkplaceLocation(uidForWp).catch(() => {});
          }
          await loadTodayAttendanceForEmployee(result.employee.id, result.employee.name);
        } else if (attendanceMode === 'wfh') {
          const uid = result.employee.userId || currentUser?.uid;
          if (uid) {
            const wfhReq = await getTodayApprovedWfh(uid);
            setTodayWfhRequest(wfhReq);
            const requests = await getMyWfhRequests(uid);
            setWfhRequests(requests);
          }
        }
      } else {
        showToastMessage(result.error || 'Invalid PIN');
      }
    } catch (error) {
      console.error('PIN verification error:', error);
      showToastMessage('PIN verification failed');
    } finally {
      setLoading(false);
    }
  };

  // =============================================
  // OFFICE CHECK-IN / CHECK-OUT
  // =============================================
  const handleCheckIn = async () => {
    if (!verifiedEmployee?.id) {
      showToastMessage('Please scan fingerprint first');
      return;
    }

    showAlert({
      message: `Are you sure you want to check in at ${formatTimeOnly(new Date())}?`,
      confirmText: 'YES',
      cancelText: 'NO',
      onConfirm: async () => {
        hideAlert();
        setLoading(true);
        const cameraOpened = await openCamera('check_in');
        if (!cameraOpened) {
          setLoading(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  const processCheckIn = async (photoBase64) => {
    try {
      // Field-visit mode bypasses the office-geofence check, but we still
      // capture the user's GPS so the customer.visit record stores it.
      let visitGpsCoords = null;
      if (fieldVisitMode && visitCustomer?.id) {
        const loc = await getCurrentLocation();
        if (loc.success) {
          visitGpsCoords = { latitude: loc.latitude, longitude: loc.longitude };
        }
        setLocationStatus({
          verified: true,
          fieldVisit: true,
          customerName: visitCustomer.name,
        });
      } else {
        const locationResult = await verifyAttendanceLocation(verifiedEmployee.userId || currentUser?.uid);

        if (!locationResult.success) {
          showAlert({ message: locationResult.error || 'Location verification failed' });
          setLocationStatus({ verified: false, error: locationResult.error });
          setLoading(false);
          return;
        }

        if (!locationResult.withinRange) {
          showAlert({
            message:
              `You are ${locationResult.distance}m away from ${locationResult.workplaceName || 'workplace'}.\n` +
              `(GPS: ±${locationResult.accuracy ?? '?'}m, raw distance ${locationResult.rawDistance ?? locationResult.distance}m)\n` +
              `Must be within ${locationResult.threshold}m. ` +
              `If you're at the office, move outdoors briefly for a better GPS lock.`,
          });
          setLocationStatus({
            verified: false,
            distance: locationResult.distance,
            threshold: locationResult.threshold,
            workplaceName: locationResult.workplaceName,
          });
          setLoading(false);
          return;
        }

        setLocationStatus({
          verified: true,
          distance: locationResult.distance,
          workplaceName: locationResult.workplaceName,
        });
      }

      // OFFLINE GUARD — block re-check-in for the same session today.
      // The Odoo constraint `_check_no_reentry_same_session` enforces this
      // online but not offline. We replicate the check locally using:
      //   (a) cached online attendance records (today's closed sessions)
      //   (b) the offline queue (offline check-in/out done earlier)
      try {
        const online = await networkStatus.isOnline();
        if (!online) {
          const cached = await getCachedLateConfig(verifiedEmployee.id);
          const now = new Date();
          const myInfo = computeLocalLateInfo(now, cached);
          const mySession = myInfo.session || '1';
          const todayStr = now.toISOString().slice(0, 10);

          // (a) Closed records done ONLINE earlier today (cached from last fetch).
          let closedOnlineSameSession = null;
          try {
            const raw = await AsyncStorage.getItem(`@cache:todayAttRecords:${verifiedEmployee.id}`);
            const list = raw ? JSON.parse(raw) : [];
            closedOnlineSameSession = (list || []).find(r => {
              if (!r.check_in || !r.check_out) return false;
              const ciStr = String(r.check_in);
              if (!ciStr.startsWith(todayStr)) return false;
              const ciDate = new Date(ciStr.replace(' ', 'T') + 'Z');
              const ciInfo = computeLocalLateInfo(ciDate, cached);
              return (ciInfo.session || '1') === mySession;
            });
          } catch (_) { /* ignore */ }

          // (b) Closed records done OFFLINE earlier (still in the queue).
          const queue = await offlineQueue.getAll();
          const closedOfflineSameSession = queue.find(q => {
            if (q.model !== 'hr.attendance' || q.operation !== 'create') return false;
            const v = q.values || {};
            if (!v.check_in || !v.check_out) return false;
            const ciStr = String(v.check_in);
            if (!ciStr.startsWith(todayStr)) return false;
            const ciDate = new Date(ciStr.replace(' ', 'T') + 'Z');
            const ciInfo = computeLocalLateInfo(ciDate, cached);
            return (ciInfo.session || '1') === mySession;
          });

          if (closedOnlineSameSession || closedOfflineSameSession) {
            console.log('[checkin-guard] OFFLINE block — same session already closed today',
              { online: closedOnlineSameSession, offline: closedOfflineSameSession?.values });
            showAlert({
              message: `You have already checked out of Session ${mySession} today.\n\nOnce you check out of a session, you cannot check in again to the same session on the same day.`,
            });
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.log('[checkin-guard] offline guard skipped:', e?.message);
      }

      // The actual check-in, deferred behind the late-reason gate below. When
      // `lateReason` is provided the row is created WITH it in one step; the
      // post-create late prompts are skipped (we already have the reason).
      const finalizeCheckIn = async (lateReason = null) => {
      console.log('[late-flow][office] finalizeCheckIn running — lateReason=', lateReason || '(none)');
      const result = await checkInByEmployeeId(verifiedEmployee.id, verifiedEmployee.name, lateReason);
      if (result.success && result.offline) {
        // Offline path — record was queued locally; will flush when online.
        // Skip photo upload (no server id yet) and skip the late-check query
        // (which would also fail offline). Still update local UI so the user
        // sees themselves as checked in.
        showToastMessage('Saved offline. Will sync when online.');
        const offlineAttendance = {
          id: null,
          checkIn: result.checkInTime,
          checkOut: null,
          employeeName: result.employeeName,
          offline: true,
          // Store the queue item id + raw UTC check-in time so the check-out
          // flow can replace this entry with a combined create record.
          offlineQueueId: result.localId || null,
          checkInTimeUtc: result.checkInTimeUtc || null,
        };
        setTodayAttendance(offlineAttendance);
        // Persist to the same cache key that getTodayAttendanceByEmployeeId
        // reads on re-entry. This way if the user leaves and comes back while
        // still offline, the screen will show Check Out instead of Check In.
        try {
          const empId = verifiedEmployee?.id;
          if (empId) {
            await AsyncStorage.setItem(
              `@attCache:todayAtt:${empId}`,
              JSON.stringify(offlineAttendance),
            );
          }
        } catch (_) { /* ignore */ }

        // Local lateness check using cached late config — works offline.
        // Verbose logging + hardcoded defaults inside `computeLocalLateInfo`
        // guarantee the popup fires for genuinely-late check-ins even when
        // the cache is empty (first install, or user never online before).
        try {
          const cached = await getCachedLateConfig(verifiedEmployee.id);
          // Prefer the raw UTC string the offline branch already saves; it
          // parses reliably. Fall back to display string if needed.
          const utcStr = result.checkInTimeUtc;
          const checkInDt = utcStr
            ? new Date(utcStr.replace(' ', 'T') + 'Z')
            : new Date(result.checkInTime || Date.now());
          const info = computeLocalLateInfo(checkInDt, cached);

          console.log('[offline-late] cached config:', cached ? 'present' : 'MISSING (using defaults)');
          console.log('[offline-late] check-in raw utc:', utcStr, '→ parsed:', checkInDt?.toString?.());
          console.log('[offline-late] info:', JSON.stringify(info));

          if (info.isLate && !lateReason) {
            console.log('[offline-late] FIRING popup (lateMin=' + info.lateMinutes + ')');
            // Compute deduction locally using cached slabs + grace + month seq.
            const localDed = await computeLocalDeductionAmount(
              verifiedEmployee.id, info.lateMinutes, checkInDt
            );
            setLateInfo({
              isLate: true,
              lateMinutes: info.lateMinutes,
              lateMinutesDisplay: info.lateMinutesDisplay,
              lateSequence: null,    // unknown offline (server-only field)
              deductionAmount: localDed,
              session: info.session,
              expectedStartDisplay: info.expectedStartDisplay,
            });
            setPendingLateAttendanceId(
              result.localId ? `offline:${result.localId}` : null
            );
            setShowLateReasonModal(true);
          } else {
            console.log('[offline-late] not late — popup skipped');
          }
        } catch (e) {
          console.log('[offline-late] error:', e?.message, e?.stack);
        }
      } else if (result.success) {
        if (photoBase64) {
          const uploadResult = await uploadAttendancePhoto(result.attendanceId, photoBase64, 'check_in');
          if (uploadResult.success) {
            console.log('[Attendance] Check-in photo uploaded successfully');
          }
        }

        showToastMessage('Check-in successful!');
        setTodayAttendance({
          id: result.attendanceId,
          checkIn: result.checkInTime,
          checkOut: null,
          employeeName: result.employeeName,
        });

        // Field-visit mode → create the linked customer.visit record now.
        if (fieldVisitMode && visitCustomer?.id) {
          try {
            const visitRes = await createCustomerVisit({
              employeeId: verifiedEmployee.id,
              partnerId: visitCustomer.id,
              latitude: visitGpsCoords?.latitude || 0,
              longitude: visitGpsCoords?.longitude || 0,
              locationName: visitCustomer.name,
            });
            if (visitRes.success) {
              setLinkedVisitId(visitRes.visitId);
              await AsyncStorage.setItem(
                `@fieldVisit:active:${verifiedEmployee.id}`,
                JSON.stringify({ visitId: visitRes.visitId, customer: visitCustomer }),
              );
              showToastMessage(`Visit started: ${visitCustomer.name}`);
            } else {
              console.log('[Visit] Create failed:', visitRes.error);
              showToastMessage('Visit log failed — attendance still saved');
            }
          } catch (e) {
            console.log('[Visit] Create exception:', e?.message);
          }
        }

        // Check if the just-created check-in is late and prompt for reason.
        // Target the record we just created (by attendanceId) — not "first of
        // the day" — so the popup also fires for split-shift session-2 and any
        // subsequent late check-in, per the Odoo late config.
        try {
          const lateResult = await getTodayAttendanceWithLateInfo(verifiedEmployee.id);
          if (lateResult.success && lateResult.records.length > 0) {
            const justCreated = lateResult.records.find(r => r.id === result.attendanceId);
            if (justCreated && justCreated.isLate && !lateReason) {
              setLateInfo({
                isLate: true,
                lateMinutes: justCreated.lateMinutes,
                lateMinutesDisplay: justCreated.lateMinutesDisplay,
                lateSequence: justCreated.lateSequence,
                deductionAmount: justCreated.deductionAmount,
                session: justCreated.checkinSession,
                expectedStartDisplay: justCreated.expectedStartTime != null
                  ? floatToHM(justCreated.expectedStartTime)
                  : undefined,
              });
              setPendingLateAttendanceId(justCreated.id);
              setShowLateReasonModal(true);
              // Persist late fields onto todayAttendance so the in-card yellow
              // banner can render after the popup is dismissed.
              setTodayAttendance(prev => prev ? {
                ...prev,
                is_late: true,
                late_minutes_display: justCreated.lateMinutesDisplay || '',
                deduction_amount: Number(justCreated.deductionAmount || 0),
                daily_total_hours: justCreated.dailyTotalHours != null
                  ? Number(justCreated.dailyTotalHours) : prev.daily_total_hours,
              } : prev);
            }
          }
        } catch (lateErr) {
          console.log('[Attendance] Late check skipped:', lateErr?.message);
        }
      } else {
        showAlert({ message: result.error || 'Check-in failed' });
      }
      }; // end finalizeCheckIn

      // Late gate (reason-before-check-in): compute lateness for NOW *before*
      // any record is created. If late → show the reason modal and defer the
      // check-in until the reason is submitted. On-time → check in immediately.
      try {
        // Prefer the SERVER's late metrics (incl. the correct hourly/slab
        // deduction) when online — same source as field + the Today's Details
        // card. Fall back to the client estimate only when offline / call fails.
        let info = null;
        let serverDeduction = null;
        try {
          const online = await networkStatus.isOnline();
          if (online) {
            const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
            const pv = await previewLateInfoOdoo(verifiedEmployee.id, nowUtc);
            if (pv) {
              info = {
                isLate: !!pv.is_late,
                lateMinutes: pv.late_minutes || 0,
                lateMinutesDisplay: pv.late_minutes_display || '',
                session: pv.checkin_session,
                expectedStartDisplay: pv.expected_start_time != null ? floatToHM(pv.expected_start_time) : undefined,
              };
              serverDeduction = Number(pv.deduction_amount || 0);
            }
          }
        } catch (_) { /* fall back to client estimate below */ }

        if (!info) {
          const cached = await getCachedLateConfig(verifiedEmployee.id);
          info = computeLocalLateInfo(new Date(), cached);
        }
        console.log('[late-flow][office] info=', JSON.stringify({
          isLate: info.isLate, lateMinutes: info.lateMinutes, session: info.session, serverDeduction,
        }));
        if (info.isLate) {
          console.log('[late-flow][office] BRANCH=late → opening late modal (reason-first), deferring check-in');
          // Use the server deduction when we have it; else the client estimate.
          let ded = serverDeduction;
          if (ded == null) {
            try {
              ded = await computeLocalDeductionAmount(verifiedEmployee.id, info.lateMinutes, new Date());
            } catch (_) { ded = 0; }
          }
          setLateInfo({
            isLate: true,
            lateMinutes: info.lateMinutes,
            lateMinutesDisplay: info.lateMinutesDisplay,
            lateSequence: null,
            deductionAmount: ded || 0,
            session: info.session,
            expectedStartDisplay: info.expectedStartDisplay,
          });
          setPendingLateAttendanceId(null);
          // Defer the real check-in: it runs only when the reason is submitted.
          setPendingLateAction(() => async (reason) => { await finalizeCheckIn(reason); });
          setShowLateReasonModal(true);
          setLoading(false);
          return;
        }
        console.log('[late-flow][office] BRANCH=on-time → checking in directly (no popup)');
      } catch (e) {
        console.log('[late-flow][office] gate compute failed, proceeding ungated:', e?.message);
      }

      await finalizeCheckIn(null);
    } catch (error) {
      console.error('Check-in error:', error);
      showAlert({ message: error?.message || 'Failed to check in' });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    // Allow check-out when we have a server ID OR an offline check-in (id=null but offline=true)
    if (!todayAttendance?.id && !todayAttendance?.offline) {
      showToastMessage('No check-in record found');
      return;
    }

    if (!verifiedEmployee?.id) {
      showToastMessage('Please scan fingerprint first');
      return;
    }

    // Cross-mode guard: if the open attendance was created via Field
    // Attendance, block office check-out and direct the user to switch
    // modes. Source on hr.attendance is 'manual' for office and 'field'
    // for field — anything other than 'manual' is treated as field-side.
    if (todayAttendance?.attendance_source === 'field') {
      showAlert({
        message: 'You checked in via Field Attendance. Switch to Field mode to check out.',
        confirmText: 'OK',
        cancelText: null,
        onConfirm: hideAlert,
        onCancel: hideAlert,
      });
      return;
    }

    showAlert({
      message: `Are you sure you want to check out at ${formatTimeOnly(new Date())}?\n\nOnce checked out, you cannot check in again to this session today.`,
      confirmText: 'YES, CHECK OUT',
      cancelText: 'CANCEL',
      destructive: true,
      onConfirm: async () => {
        hideAlert();
        if (verificationMethod === 'fingerprint') {
          try {
            const authResult = await LocalAuthentication.authenticateAsync({
              promptMessage: 'Scan fingerprint to check out',
              fallbackLabel: 'Use device PIN',
              disableDeviceFallback: false,
            });

            if (!authResult.success) {
              showToastMessage('Authentication failed');
              return;
            }
          } catch (error) {
            console.error('Fingerprint re-auth error:', error);
            showToastMessage('Authentication failed');
            return;
          }
        }

        setLoading(true);
        const cameraOpened = await openCamera('check_out');
        if (!cameraOpened) {
          setLoading(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  const processCheckOut = async (photoBase64) => {
    try {
      // Skip location verification when offline OR when this attendance is
      // linked to an active customer.visit (employee is at the customer's site,
      // not the office, so the office geofence MUST be skipped).
      let activeVisitForCheckout = linkedVisitId;
      if (!activeVisitForCheckout && verifiedEmployee?.id) {
        try {
          const raw = await AsyncStorage.getItem(`@fieldVisit:active:${verifiedEmployee.id}`);
          if (raw) activeVisitForCheckout = JSON.parse(raw)?.visitId;
        } catch (_) { /* ignore */ }
      }
      const skipGeofence = offline || !!activeVisitForCheckout;

      if (!skipGeofence) {
        const locationResult = await verifyAttendanceLocation(verifiedEmployee.userId || currentUser?.uid);

        if (!locationResult.success) {
          showAlert({ message: locationResult.error || 'Location verification failed' });
          setLocationStatus({ verified: false, error: locationResult.error });
          setLoading(false);
          return;
        }

        if (!locationResult.withinRange) {
          showAlert({
            message:
              `You are ${locationResult.distance}m away from ${locationResult.workplaceName || 'workplace'}.\n` +
              `(GPS: ±${locationResult.accuracy ?? '?'}m, raw distance ${locationResult.rawDistance ?? locationResult.distance}m)\n` +
              `Must be within ${locationResult.threshold}m. ` +
              `If you're at the office, move outdoors briefly for a better GPS lock.`,
          });
          setLocationStatus({
            verified: false,
            distance: locationResult.distance,
            threshold: locationResult.threshold,
            workplaceName: locationResult.workplaceName,
          });
          setLoading(false);
          return;
        }

        setLocationStatus({
          verified: true,
          distance: locationResult.distance,
          workplaceName: locationResult.workplaceName,
        });
      }

      // If the check-in was done offline (no server attendance ID), replace
      // the check-in queue entry with a single combined create that has BOTH
      // check_in and check_out. The Odoo offline_sync module only supports
      // 'create' and 'method' operations — a combined create is the cleanest
      // way to land a complete attendance record in one shot.
      if (todayAttendance?.offline && !todayAttendance?.id) {
        const now = new Date();
        const checkOutTimeUtc = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')} ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;

        const offlineQueue = require('@utils/offlineQueue').default;

        // CRITICAL: read the original queue item's values BEFORE removing it
        // so we can carry over fields like `late_reason` (typed by the user
        // in the offline late-popup) into the new combined create.
        let preservedValues = {};
        if (todayAttendance.offlineQueueId) {
          try {
            const queue = await offlineQueue.getAll();
            const original = queue.find(q => q.id === todayAttendance.offlineQueueId);
            if (original?.values) {
              preservedValues = { ...original.values };
              console.log('[checkout-offline] preserving values from check-in:', JSON.stringify(preservedValues));
            }
          } catch (e) {
            console.log('[checkout-offline] could not read original values:', e?.message);
          }
          await offlineQueue.removeById(todayAttendance.offlineQueueId);
        }

        // Enqueue a single combined create — spread `preservedValues` first
        // so the explicit fields below override any duplicates and we keep
        // anything else (notably `late_reason`).
        const combinedValues = {
          ...preservedValues,
          employee_id: verifiedEmployee.id,
          check_in: todayAttendance.checkInTimeUtc || checkOutTimeUtc,
          check_out: checkOutTimeUtc,
        };
        console.log('[checkout-offline] combined values:', JSON.stringify(combinedValues));
        await offlineQueue.enqueue({
          model: 'hr.attendance',
          operation: 'create',
          values: combinedValues,
        });

        const displayTime = formatTimeOffice(now);

        showToastMessage('Check-out saved offline. Will sync when online.');
        // Show "All Done" for this session so the user sees the confirmation
        setTodayAttendance({
          ...todayAttendance,
          checkOut: displayTime,
          offline: true,
        });
        // Clear the cache so next re-entry shows Check In (allows multiple
        // check-in/check-out cycles per day, e.g. lunch break)
        try {
          const empId = verifiedEmployee?.id;
          if (empId) {
            await AsyncStorage.setItem(
              `@attCache:todayAtt:${empId}`,
              JSON.stringify(null),
            );
          }
        } catch (_) { /* ignore */ }
        setLoading(false);
        return;
      }

      const result = await checkOutToOdoo(todayAttendance.id);
      if (result.success) {
        if (photoBase64) {
          const uploadResult = await uploadAttendancePhoto(todayAttendance.id, photoBase64, 'check_out');
          if (uploadResult.success) {
            console.log('[Attendance] Check-out photo uploaded successfully');
          }
        }

        // If a customer.visit was linked at check-in, mark it Done now.
        let activeVisitId = linkedVisitId;
        if (!activeVisitId && verifiedEmployee?.id) {
          try {
            const raw = await AsyncStorage.getItem(`@fieldVisit:active:${verifiedEmployee.id}`);
            if (raw) activeVisitId = JSON.parse(raw)?.visitId;
          } catch (_) { /* ignore */ }
        }
        if (activeVisitId) {
          try {
            const closeRes = await closeCustomerVisit(activeVisitId);
            if (closeRes.success) {
              console.log('[Visit] Closed visit id:', activeVisitId);
              showToastMessage('Visit completed');
            } else {
              console.log('[Visit] Close failed:', closeRes.error);
            }
          } catch (e) {
            console.log('[Visit] Close exception:', e?.message);
          }
          await AsyncStorage.removeItem(`@fieldVisit:active:${verifiedEmployee.id}`);
          setLinkedVisitId(null);
          setVisitCustomer(null);
          setFieldVisitMode(false);
        }

        showToastMessage('Check-out successful!');
        // Keep the record visible in this session — show the checkout time in the box.
        // The whole record is cleared when the user leaves the screen via handleBackPress.
        setTodayAttendance((prev) => prev ? { ...prev, checkOut: result.checkOutTime, checkOutTimeUtc: result.checkOutTimeUtc } : prev);

        // Pull the FINAL late + worked-hours figures (daily_total_hours is only
        // complete once check_out exists) so the "Today's Details" card shows the
        // accurate, server-computed values after checkout.
        try {
          const online = await networkStatus.isOnline();
          if (online && verifiedEmployee?.id) {
            const lateResult = await getTodayAttendanceWithLateInfo(verifiedEmployee.id);
            if (lateResult?.success && lateResult.records?.length > 0) {
              const rec = lateResult.records.find(r => r.id === todayAttendance?.id)
                       || lateResult.records[lateResult.records.length - 1];
              if (rec) {
                setTodayAttendance(prev => prev ? {
                  ...prev,
                  is_late: !!rec.isLate,
                  late_minutes: rec.lateMinutes || 0,
                  late_minutes_display: rec.lateMinutesDisplay || '',
                  deduction_amount: Number(rec.deductionAmount || 0),
                  daily_total_hours: rec.dailyTotalHours != null
                    ? Number(rec.dailyTotalHours) : prev.daily_total_hours,
                  late_reason: rec.lateReason || '',
                } : prev);
              }
            }
          }
        } catch (e) {
          console.log('[Attendance] post-checkout details refresh skipped:', e?.message);
        }
      } else {
        showAlert({ message: result.error || 'Check-out failed' });
      }
    } catch (error) {
      console.error('Check-out error:', error);
      showAlert({ message: error?.message || 'Failed to check out' });
    } finally {
      setLoading(false);
    }
  };

  // =============================================
  // WFH REQUEST SUBMIT
  // =============================================
  const handleWfhSubmit = async () => {
    if (!wfhReason.trim()) {
      showToastMessage('Please enter a reason for WFH');
      return;
    }

    const userId = verifiedEmployee?.userId || currentUser?.uid;
    if (!userId) {
      showToastMessage('User ID not available');
      return;
    }

    showAlert({
      message: `Submit work from home request for today?\n\nReason: ${wfhReason.trim()}`,
      confirmText: 'SUBMIT',
      cancelText: 'CANCEL',
      onConfirm: async () => {
        hideAlert();
        setLoading(true);
        const today = getTodayDateString();
        const result = await submitWfhRequest(userId, today, wfhReason.trim());

        if (result.success) {
          showToastMessage('WFH request submitted for approval!');
          setWfhReason('');
          const requests = await getMyWfhRequests(userId);
          setWfhRequests(requests);
        } else {
          showToastMessage(result.error || 'Failed to submit WFH request');
        }
        setLoading(false);
      },
      onCancel: hideAlert,
    });
  };

  // =============================================
  // WFH CHECK-IN / CHECK-OUT
  // =============================================
  const handleWfhCheckIn = async () => {
    if (!todayWfhRequest?.id) {
      showToastMessage('No approved WFH request found');
      return;
    }

    showAlert({
      message: `Check in for Work From Home at ${formatTimeOnly(new Date())}?`,
      confirmText: 'YES',
      cancelText: 'NO',
      onConfirm: async () => {
        hideAlert();
        setLoading(true);
        try {
          const result = await wfhCheckIn(todayWfhRequest.id);
          if (result.success) {
            showToastMessage('WFH Check-in successful!');
            setTodayWfhRequest({
              ...todayWfhRequest,
              state: 'checked_in',
              checkIn: result.checkInTime,
            });
          } else {
            showToastMessage(result.error || 'WFH check-in failed');
          }
        } catch (error) {
          console.error('WFH check-in error:', error);
          showToastMessage('Failed to check in');
        } finally {
          setLoading(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  const handleWfhCheckOut = async () => {
    if (!todayWfhRequest?.id) {
      showToastMessage('No WFH check-in found');
      return;
    }

    showAlert({
      message: `Check out from Work From Home at ${formatTimeOnly(new Date())}?`,
      confirmText: 'YES',
      cancelText: 'NO',
      destructive: true,
      onConfirm: async () => {
        hideAlert();
        if (verificationMethod === 'fingerprint') {
          try {
            const authResult = await LocalAuthentication.authenticateAsync({
              promptMessage: 'Scan fingerprint to check out',
              fallbackLabel: 'Use device PIN',
              disableDeviceFallback: false,
            });

            if (!authResult.success) {
              showToastMessage('Authentication failed');
              return;
            }
          } catch (error) {
            showToastMessage('Authentication failed');
            return;
          }
        }

        setLoading(true);
        try {
          const result = await wfhCheckOut(todayWfhRequest.id);
          if (result.success) {
            showToastMessage('WFH Check-out successful!');
            setTodayWfhRequest({
              ...todayWfhRequest,
              state: 'checked_out',
              checkOut: result.checkOutTime,
            });
          } else {
            showToastMessage(result.error || 'WFH check-out failed');
          }
        } catch (error) {
          console.error('WFH check-out error:', error);
          showToastMessage('Failed to check out');
        } finally {
          setLoading(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  // =============================================
  // HELPERS
  // =============================================
  const userName = verifiedEmployee?.name || currentUser?.name || currentUser?.user_name || currentUser?.login || 'User';
  const hasCheckedIn = todayAttendance && !todayAttendance.checkOut;
  const hasCheckedOut = !!(todayAttendance && todayAttendance.checkOut);

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  // Convert late minutes to "Hh Mm" format matching the Odoo module's minutes_to_hm.
  // Examples: 30 -> "30m", 60 -> "1h 00m", 90 -> "1h 30m", 145 -> "2h 25m"
  const formatLateDuration = (minutes, preformatted) => {
    // Prefer the server-formatted value (H:MM) if present, but display it as "Xh YYm".
    if (preformatted && typeof preformatted === 'string' && preformatted.includes(':')) {
      const [h, m] = preformatted.split(':');
      const hh = parseInt(h, 10) || 0;
      const mm = parseInt(m, 10) || 0;
      if (hh <= 0) return `${mm}m`;
      return `${hh}h ${String(mm).padStart(2, '0')}m`;
    }
    const total = parseInt(minutes, 10) || 0;
    if (total <= 0) return '0m';
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    if (hh <= 0) return `${mm}m`;
    return `${hh}h ${String(mm).padStart(2, '0')}m`;
  };

  const getStateLabel = (state) => {
    const labels = {
      draft: 'Draft',
      pending: 'Pending Approval',
      approved: 'Approved',
      rejected: 'Rejected',
      checked_in: 'Checked In',
      checked_out: 'Checked Out',
      cancelled: 'Cancelled',
      expired: 'Expired',
    };
    return labels[state] || state;
  };

  const getStateColor = (state) => {
    const colors = {
      draft: '#9E9E9E',
      pending: '#FF9800',
      approved: '#4CAF50',
      rejected: '#F44336',
      checked_in: '#2196F3',
      checked_out: '#4CAF50',
      cancelled: '#9E9E9E',
      expired: '#9E9E9E',
    };
    return colors[state] || '#9E9E9E';
  };

  const handleBackPress = () => {
    if (attendanceMode && !isVerified) {
      setAttendanceMode(null);
    } else if (attendanceMode && isVerified) {
      setIsVerified(false);
      setVerifiedEmployee(null);
      setVerificationMethod(null);
      setTodayAttendance(null);
      setTodayWfhRequest(null);
      setLocationStatus(null);
      setAttendanceMode(null);
    } else {
      navigation.goBack();
    }
  };

  // Open the in-app HTML guide for a specific manual id.
  const openUserManual = (id) => {
    console.log('[UserGuide] open manual from attendance card:', id);
    navigation.navigate('ManualViewerScreen', { id });
  };

  // =============================================
  // RENDER: MODE SELECTION
  // =============================================
  const renderModeSelection = () => (
    <View style={styles.modeSelectionContainer}>
      <Text style={styles.modeTitle}>Select Attendance Type</Text>
      <Text style={styles.modeSubtitle}>How are you working today?</Text>

      <TouchableOpacity
        style={styles.modeCard}
        onPress={() => setAttendanceMode('office')}
        activeOpacity={0.8}
      >
        <View style={[styles.modeIconContainer, { backgroundColor: '#E8F5E9' }]}>
          <MaterialIcons name="business" size={scale(32)} color="#4CAF50" />
        </View>
        <View style={styles.modeTextContainer}>
          <Text style={styles.modeCardTitle}>Office</Text>
          <Text style={styles.modeCardSubtitle}>Check in from office with location verification</Text>
          <TouchableOpacity
            style={styles.manualLink}
            activeOpacity={0.7}
            onPress={() => openUserManual('office-attendance')}
          >
            <MaterialIcons name="menu-book" size={scale(13)} color={COLORS.primaryThemeColor} />
            <Text style={styles.manualLinkText}>View user manual</Text>
          </TouchableOpacity>
        </View>
        <Feather name="chevron-right" size={scale(20)} color={COLORS.gray} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.modeCard}
        onPress={() => setAttendanceMode('leave')}
        activeOpacity={0.8}
      >
        <View style={[styles.modeIconContainer, { backgroundColor: '#FFF3E0' }]}>
          <MaterialIcons name="event-busy" size={scale(32)} color="#FF9800" />
        </View>
        <View style={styles.modeTextContainer}>
          <Text style={styles.modeCardTitle}>Leave Request</Text>
          <Text style={styles.modeCardSubtitle}>Apply for leave with manager approval</Text>
          <TouchableOpacity
            style={styles.manualLink}
            activeOpacity={0.7}
            onPress={() => openUserManual('leave-request')}
          >
            <MaterialIcons name="menu-book" size={scale(13)} color={COLORS.primaryThemeColor} />
            <Text style={styles.manualLinkText}>View user manual</Text>
          </TouchableOpacity>
        </View>
        <Feather name="chevron-right" size={scale(20)} color={COLORS.gray} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.modeCard}
        onPress={() => setAttendanceMode('waiver')}
        activeOpacity={0.8}
      >
        <View style={[styles.modeIconContainer, { backgroundColor: '#F3E5F5' }]}>
          <MaterialIcons name="gavel" size={scale(32)} color="#9C27B0" />
        </View>
        <View style={styles.modeTextContainer}>
          <Text style={styles.modeCardTitle}>Late Waiver Request</Text>
          <Text style={styles.modeCardSubtitle}>Request waiver for a late arrival deduction</Text>
          <TouchableOpacity
            style={styles.manualLink}
            activeOpacity={0.7}
            onPress={() => openUserManual('late-waiver-request')}
          >
            <MaterialIcons name="menu-book" size={scale(13)} color={COLORS.primaryThemeColor} />
            <Text style={styles.manualLinkText}>View user manual</Text>
          </TouchableOpacity>
        </View>
        <Feather name="chevron-right" size={scale(20)} color={COLORS.gray} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.modeCard}
        onPress={() => setAttendanceMode('field')}
        activeOpacity={0.8}
      >
        <View style={[styles.modeIconContainer, { backgroundColor: '#E3F2FD' }]}>
          <MaterialIcons name="map" size={scale(32)} color="#1976D2" />
        </View>
        <View style={styles.modeTextContainer}>
          <Text style={styles.modeCardTitle}>Field Attendance (Customer Visit)</Text>
          <Text style={styles.modeCardSubtitle}>Mark today using your trip and customer visits</Text>
          <TouchableOpacity
            style={styles.manualLink}
            activeOpacity={0.7}
            onPress={() => openUserManual('field-attendance')}
          >
            <MaterialIcons name="menu-book" size={scale(13)} color={COLORS.primaryThemeColor} />
            <Text style={styles.manualLinkText}>View user manual</Text>
          </TouchableOpacity>
        </View>
        <Feather name="chevron-right" size={scale(20)} color={COLORS.gray} />
      </TouchableOpacity>
    </View>
  );

  // =============================================
  // RENDER: WFH SECTION (after fingerprint)
  // =============================================
  const renderWfhSection = () => {
    const wfhCheckedIn = todayWfhRequest?.state === 'checked_in';
    const wfhCheckedOut = todayWfhRequest?.state === 'checked_out';
    const wfhApproved = todayWfhRequest?.state === 'approved';

    return (
      <View style={styles.detailsSection}>
        {/* Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: '#2196F3' }]}>
              <Text style={styles.avatarText}>
                {userName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={[styles.statusDot, { backgroundColor: '#2196F3' }]} />
          </View>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingText}>{getGreeting()}</Text>
            <Text style={styles.userNameText}>{userName}</Text>
          </View>
          <View style={styles.wfhBadge}>
            <Text style={styles.wfhBadgeText}>WFH</Text>
          </View>
        </View>

        {/* If approved WFH exists — show check-in/check-out */}
        {(wfhApproved || wfhCheckedIn || wfhCheckedOut) ? (
          <>
            {/* Status Cards */}
            <View style={styles.statusCardsContainer}>
              <View style={[styles.statusCard, todayWfhRequest?.checkIn ? styles.statusCardActive : styles.statusCardInactive]}>
                <View style={[styles.statusIconContainer, { backgroundColor: todayWfhRequest?.checkIn ? '#E8F5E9' : '#F5F5F5' }]}>
                  <MaterialIcons name="login" size={scale(20)} color={todayWfhRequest?.checkIn ? '#4CAF50' : COLORS.gray} />
                </View>
                <Text style={styles.statusCardLabel}>Check In</Text>
                <Text style={[styles.statusCardValue, todayWfhRequest?.checkIn && { color: '#4CAF50' }]}>
                  {todayWfhRequest?.checkIn || '--:--'}
                </Text>
              </View>

              <View style={[styles.statusCard, todayWfhRequest?.checkOut ? styles.statusCardActive : styles.statusCardInactive]}>
                <View style={[styles.statusIconContainer, { backgroundColor: todayWfhRequest?.checkOut ? '#FFEBEE' : '#F5F5F5' }]}>
                  <MaterialIcons name="logout" size={scale(20)} color={todayWfhRequest?.checkOut ? '#F44336' : COLORS.gray} />
                </View>
                <Text style={styles.statusCardLabel}>Check Out</Text>
                <Text style={[styles.statusCardValue, todayWfhRequest?.checkOut && { color: '#F44336' }]}>
                  {todayWfhRequest?.checkOut || '--:--'}
                </Text>
              </View>
            </View>

            {/* WFH Location info */}
            <View style={[styles.locationStatusCard, styles.locationVerified]}>
              <View style={styles.locationIconContainer}>
                <MaterialIcons name="home" size={scale(20)} color="#2196F3" />
              </View>
              <View style={styles.locationTextContainer}>
                <Text style={styles.locationStatusTitle}>Work From Home</Text>
                <Text style={styles.locationStatusSubtitle}>Location verification not required</Text>
              </View>
            </View>

            {/* Current Time */}
            <View style={styles.currentTimeCard}>
              <Feather name="clock" size={scale(16)} color="#2196F3" />
              <Text style={styles.currentTimeLabel}>Current Time:</Text>
              <Text style={[styles.currentTimeValue, { color: '#2196F3' }]}>{formatTimeOnly(currentTime)}</Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.buttonContainer}>
              {wfhApproved && (
                <TouchableOpacity
                  style={[styles.checkInButton, { backgroundColor: '#2196F3', shadowColor: '#2196F3' }]}
                  onPress={handleWfhCheckIn}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <View style={styles.buttonIconContainer}>
                    <MaterialIcons name="home" size={scale(22)} color={COLORS.white} />
                  </View>
                  <View style={styles.buttonTextContainer}>
                    <Text style={styles.buttonTitle}>WFH Check In</Text>
                    <Text style={styles.buttonSubtitle}>Start your work from home day</Text>
                  </View>
                  <Feather name="chevron-right" size={scale(20)} color={COLORS.white} />
                </TouchableOpacity>
              )}

              {wfhCheckedIn && (
                <TouchableOpacity
                  style={[styles.checkOutButton, { backgroundColor: '#F44336' }]}
                  onPress={handleWfhCheckOut}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  <View style={styles.buttonIconContainer}>
                    <MaterialIcons name="home" size={scale(22)} color={COLORS.white} />
                  </View>
                  <View style={styles.buttonTextContainer}>
                    <Text style={styles.buttonTitle}>WFH Check Out</Text>
                    <Text style={styles.buttonSubtitle}>End your work from home day</Text>
                  </View>
                  <Feather name="chevron-right" size={scale(20)} color={COLORS.white} />
                </TouchableOpacity>
              )}

              {wfhCheckedOut && (
                <View style={styles.completedContainer}>
                  <View style={styles.completedIconContainer}>
                    <Ionicons name="checkmark-circle" size={scale(36)} color="#4CAF50" />
                  </View>
                  <Text style={styles.completedTitle}>All Done!</Text>
                  <Text style={styles.completedText}>Your WFH attendance is complete for today</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            {/* No approved WFH — show request form */}
            <View style={styles.wfhFormCard}>
              <Text style={styles.wfhFormTitle}>Request Work From Home</Text>
              <Text style={styles.wfhFormSubtitle}>Submit a request for manager approval</Text>

              <View style={styles.wfhDateRow}>
                <MaterialIcons name="event" size={scale(18)} color={COLORS.primaryThemeColor} />
                <Text style={styles.wfhDateText}>Date: {formatDate(currentTime)}</Text>
              </View>

              <Text style={styles.wfhInputLabel}>Reason *</Text>
              <TextInput
                style={styles.wfhReasonInput}
                placeholder="Why do you need to work from home?"
                placeholderTextColor={COLORS.gray}
                value={wfhReason}
                onChangeText={setWfhReason}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={styles.wfhSubmitButton}
                onPress={handleWfhSubmit}
                disabled={loading || !wfhReason.trim()}
                activeOpacity={0.8}
              >
                <MaterialIcons name="send" size={scale(18)} color={COLORS.white} />
                <Text style={styles.wfhSubmitText}>Submit Request</Text>
              </TouchableOpacity>
            </View>

            {/* WFH Request History */}
            {wfhRequests.length > 0 && (
              <View style={styles.wfhHistoryCard}>
                <Text style={styles.wfhHistoryTitle}>Recent Requests</Text>
                {wfhRequests.slice(0, 5).map((req) => (
                  <View key={req.id} style={styles.wfhHistoryItem}>
                    <View style={styles.wfhHistoryLeft}>
                      <Text style={styles.wfhHistoryDate}>{req.requestDate}</Text>
                      <Text style={styles.wfhHistoryReason} numberOfLines={1}>{req.reason}</Text>
                    </View>
                    <View style={[styles.wfhStatusBadge, { backgroundColor: getStateColor(req.state) + '20' }]}>
                      <Text style={[styles.wfhStatusText, { color: getStateColor(req.state) }]}>
                        {getStateLabel(req.state)}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  // =============================================
  // RENDER: LEAVE REQUEST SECTION
  // =============================================
  const LEAVE_TYPES = [
    { value: 'sick', label: 'Sick Leave', icon: 'local-hospital', color: '#E74C3C' },
    { value: 'casual', label: 'Casual Leave', icon: 'event-available', color: '#FF9800' },
    { value: 'annual', label: 'Annual Leave', icon: 'beach-access', color: '#2196F3' },
    { value: 'personal', label: 'Personal Leave', icon: 'person', color: '#9C27B0' },
    { value: 'emergency', label: 'Emergency Leave', icon: 'warning', color: '#F44336' },
    { value: 'other', label: 'Other', icon: 'more-horiz', color: '#607D8B' },
  ];

  const fetchLeaveHistory = async () => {
    const uid = verifiedEmployee?.userId || currentUser?.uid;
    const empId = verifiedEmployee?.id || null;
    if (!uid && !empId) return;
    const requests = await getMyLeaveRequests(uid, empId);
    setLeaveRequests(requests);
  };

  const formatLeaveDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Imperative date picker openers — bypass show/hide state bugs on Android.
  // The OS dialog only fires onChange once per interaction so the picked date
  // never gets clobbered by a stray dismiss event.
  const openLeaveFromPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: leaveFromDate || new Date(),
        mode: 'date',
        minimumDate: new Date(),
        onChange: (event, date) => {
          if (event?.type === 'set' && date instanceof Date) {
            setLeaveFromDate(date);
            if (leaveToDate && date > leaveToDate) setLeaveToDate(null);
          }
        },
      });
    } else {
      setShowLeaveFromPicker(true);
    }
  };

  const openLeaveToPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: leaveToDate || leaveFromDate || new Date(),
        mode: 'date',
        minimumDate: leaveFromDate || new Date(),
        onChange: (event, date) => {
          if (event?.type === 'set' && date instanceof Date) {
            setLeaveToDate(date);
          }
        },
      });
    } else {
      setShowLeaveToPicker(true);
    }
  };

  const formatLeaveDateForOdoo = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getLeaveStateColor = (state) => {
    switch (state) {
      case 'draft': return '#9E9E9E';
      case 'pending': return '#FF9800';
      case 'approved': return '#4CAF50';
      case 'rejected': return '#F44336';
      case 'cancelled': return '#9E9E9E';
      default: return '#9E9E9E';
    }
  };

  const getLeaveStateLabel = (state) => {
    switch (state) { case 'draft': return 'Draft'; case 'pending': return 'Pending'; case 'approved': return 'Approved'; case 'rejected': return 'Rejected'; case 'cancelled': return 'Cancelled'; default: return state; }
  };

  const handleLeaveSubmit = () => {
    if (!leaveReason.trim()) {
      showToastMessage('Please enter a reason for leave');
      return;
    }
    const fromStr = formatLeaveDateForOdoo(leaveFromDate);
    const toStr = leaveToDate ? formatLeaveDateForOdoo(leaveToDate) : null;
    const typeLabel = LEAVE_TYPES.find(t => t.value === leaveType)?.label || leaveType;

    showAlert({
      message: `Type: ${typeLabel}\nFrom: ${formatLeaveDate(leaveFromDate)}\n${leaveToDate ? `To: ${formatLeaveDate(leaveToDate)}` : '(Single day)'}\n\nReason: ${leaveReason.trim()}`,
      confirmText: 'SUBMIT',
      cancelText: 'CANCEL',
      onConfirm: async () => {
        hideAlert();
        setLoading(true);
        try {
          const uid = verifiedEmployee?.userId || currentUser?.uid;
          const empId = verifiedEmployee?.id || null;
          const result = await submitLeaveRequest(uid, leaveType, fromStr, isHalfDay ? null : toStr, leaveReason.trim(), empId, isHalfDay);
          if (result.success) {
            showToastMessage('Leave request submitted for approval!');
            setLeaveReason('');
            setLeaveToDate(null);
            setLeaveFromDate(new Date());
            setLeaveType('casual');
            setIsHalfDay(false);
            await fetchLeaveHistory();
            setLeaveTab('history');
          } else {
            showAlert({ message: result.error || 'Failed to submit' });
          }
        } catch (error) {
          showAlert({ message: error?.message || 'Failed to submit' });
        } finally {
          setLoading(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  const handleLeaveCancel = (requestId) => {
    showAlert({
      message: 'Cancel this leave request?',
      confirmText: 'YES',
      cancelText: 'NO',
      destructive: true,
      onConfirm: async () => {
        hideAlert();
        setLoading(true);
        const result = await cancelLeaveRequest(requestId);
        if (result.success) { showToastMessage('Cancelled'); await fetchLeaveHistory(); }
        else { showToastMessage(result.error || 'Failed'); }
        setLoading(false);
      },
      onCancel: hideAlert,
    });
  };

  const renderLeaveSection = () => (
    <View style={{ flex: 1 }}>
      {/* Tab Bar */}
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', marginBottom: scale(8) }}>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: leaveTab === 'form' ? 2 : 0, borderBottomColor: '#FF9800' }}
          onPress={() => setLeaveTab('form')}
        >
          <MaterialIcons name="add-circle-outline" size={scale(16)} color={leaveTab === 'form' ? '#FF9800' : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: leaveTab === 'form' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: leaveTab === 'form' ? '#FF9800' : '#999' }}>New Request</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: leaveTab === 'history' ? 2 : 0, borderBottomColor: '#FF9800' }}
          onPress={() => { setLeaveTab('history'); fetchLeaveHistory(); }}
        >
          <MaterialIcons name="history" size={scale(16)} color={leaveTab === 'history' ? '#FF9800' : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: leaveTab === 'history' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: leaveTab === 'history' ? '#FF9800' : '#999' }}>My Requests</Text>
        </TouchableOpacity>
      </View>

      {leaveTab === 'form' ? (
        <View style={{ paddingHorizontal: scale(4) }}>
          {/* Leave Type */}
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginBottom: scale(6) }}>Leave Type *</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: scale(6), marginBottom: scale(10) }}>
            {LEAVE_TYPES.map(type => (
              <TouchableOpacity
                key={type.value}
                style={{
                  flexDirection: 'row', alignItems: 'center', paddingHorizontal: scale(10), paddingVertical: scale(6),
                  borderRadius: scale(16), borderWidth: 1, gap: scale(4),
                  borderColor: leaveType === type.value ? type.color : '#E0E0E0',
                  backgroundColor: leaveType === type.value ? type.color + '20' : '#FAFAFA',
                }}
                onPress={() => setLeaveType(type.value)}
              >
                <MaterialIcons name={type.icon} size={scale(14)} color={leaveType === type.value ? type.color : '#999'} />
                <Text style={{ fontSize: scale(11), fontFamily: leaveType === type.value ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: leaveType === type.value ? type.color : '#666' }}>{type.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* From Date */}
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginBottom: scale(6) }}>From Date *</Text>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(10), gap: scale(8), marginBottom: scale(10) }}
            onPress={openLeaveFromPicker}
          >
            <MaterialIcons name="event" size={scale(18)} color="#FF9800" />
            <Text style={{ flex: 1, fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: '#333' }}>{formatLeaveDate(leaveFromDate)}</Text>
            <MaterialIcons name="arrow-drop-down" size={scale(18)} color="#999" />
          </TouchableOpacity>
          {Platform.OS === 'ios' && showLeaveFromPicker && (
            <DateTimePicker
              value={leaveFromDate || new Date()}
              mode="date"
              display="inline"
              minimumDate={new Date()}
              onChange={(event, date) => {
                if (event?.type === 'set' && date instanceof Date) {
                  setLeaveFromDate(date);
                  if (leaveToDate && date > leaveToDate) setLeaveToDate(null);
                  setShowLeaveFromPicker(false);
                } else if (event?.type === 'dismissed') {
                  setShowLeaveFromPicker(false);
                }
              }}
            />
          )}

          {/* Half Day Toggle */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isHalfDay ? '#FFF3E0' : '#fff', borderWidth: 1, borderColor: isHalfDay ? '#FF9800' : '#E0E0E0', borderRadius: scale(10), padding: scale(12), gap: scale(10), marginBottom: scale(10) }}
            onPress={() => { setIsHalfDay(!isHalfDay); if (!isHalfDay) setLeaveToDate(null); }}
          >
            <MaterialIcons name={isHalfDay ? 'check-box' : 'check-box-outline-blank'} size={scale(22)} color={isHalfDay ? '#FF9800' : '#999'} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: isHalfDay ? '#FF9800' : '#333' }}>Half Day Leave</Text>
              <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888' }}>Apply for 0.5 day leave</Text>
            </View>
          </TouchableOpacity>

          {/* To Date (hidden when half day) */}
          {!isHalfDay && (
          <>
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginBottom: scale(6) }}>To Date (optional)</Text>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(10), gap: scale(8), marginBottom: scale(6) }}
            onPress={openLeaveToPicker}
          >
            <MaterialIcons name="event" size={scale(18)} color={leaveToDate ? '#FF9800' : '#CCC'} />
            <Text style={{ flex: 1, fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: leaveToDate ? '#333' : '#999' }}>{leaveToDate ? formatLeaveDate(leaveToDate) : 'Single day leave'}</Text>
            {leaveToDate && (
              <TouchableOpacity onPress={() => setLeaveToDate(null)} style={{ marginRight: scale(4) }}>
                <MaterialIcons name="close" size={scale(16)} color="#999" />
              </TouchableOpacity>
            )}
            <MaterialIcons name="arrow-drop-down" size={scale(18)} color="#999" />
          </TouchableOpacity>
          {Platform.OS === 'ios' && showLeaveToPicker && (
            <DateTimePicker
              value={leaveToDate || leaveFromDate || new Date()}
              mode="date"
              display="inline"
              minimumDate={leaveFromDate || new Date()}
              onChange={(event, date) => {
                if (event?.type === 'set' && date instanceof Date) {
                  setLeaveToDate(date);
                  setShowLeaveToPicker(false);
                } else if (event?.type === 'dismissed') {
                  setShowLeaveToPicker(false);
                }
              }}
            />
          )}
          </>
          )}

          {/* Days count */}
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', borderRadius: scale(8), padding: scale(8), gap: scale(6), marginBottom: scale(10) }}>
            <MaterialIcons name="date-range" size={scale(16)} color="#FF9800" />
            <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: '#FF9800' }}>
              {isHalfDay ? '0.5 day' : leaveToDate && leaveToDate >= leaveFromDate ? `${Math.ceil((leaveToDate - leaveFromDate) / (1000 * 60 * 60 * 24)) + 1} day(s)` : '1 day'}
            </Text>
          </View>

          {/* Reason */}
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginBottom: scale(6) }}>Reason *</Text>
          <TextInput
            style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(10), fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: '#333', backgroundColor: '#fff', minHeight: scale(80) }}
            placeholder="Enter the reason for your leave..."
            placeholderTextColor="#999"
            multiline
            numberOfLines={3}
            value={leaveReason}
            onChangeText={setLeaveReason}
            textAlignVertical="top"
          />

          {/* Submit */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: !leaveReason.trim() ? '#CCC' : '#FF9800', borderRadius: scale(10), padding: scale(12), marginTop: scale(12), gap: scale(6) }}
            disabled={!leaveReason.trim() || loading}
            onPress={handleLeaveSubmit}
          >
            <MaterialIcons name="send" size={scale(18)} color="#fff" />
            <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>Submit Request</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* History Tab */
        <View>
          {leaveRequests.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: scale(40) }}>
              <MaterialIcons name="event-available" size={scale(40)} color="#4CAF50" />
              <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginTop: scale(10) }}>No leave requests</Text>
            </View>
          ) : (
            leaveRequests.map(req => {
              const stateColor = getLeaveStateColor(req.state);
              const typeInfo = LEAVE_TYPES.find(t => t.value === req.leaveType);
              const canCancel = ['draft', 'pending', 'approved'].includes(req.state);
              return (
                <View key={req.id} style={{ backgroundColor: '#fff', borderRadius: scale(10), padding: scale(12), marginBottom: scale(8), elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: scale(8) }}>
                    <View style={{ paddingHorizontal: scale(8), paddingVertical: scale(3), borderRadius: scale(10), backgroundColor: (typeInfo?.color || '#607D8B') + '20' }}>
                      <Text style={{ fontSize: scale(10), fontFamily: FONT_FAMILY.urbanistBold, color: typeInfo?.color || '#607D8B' }}>{typeInfo?.label || req.leaveType}</Text>
                    </View>
                    <View style={{ paddingHorizontal: scale(8), paddingVertical: scale(3), borderRadius: scale(10), backgroundColor: stateColor + '20' }}>
                      <Text style={{ fontSize: scale(10), fontFamily: FONT_FAMILY.urbanistBold, color: stateColor }}>{getLeaveStateLabel(req.state)}</Text>
                    </View>
                  </View>
                  <View style={{ backgroundColor: '#FAFAFA', borderRadius: scale(6), padding: scale(8), gap: scale(4) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                      <Feather name="calendar" size={scale(12)} color="#888" />
                      <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }}>
                        {formatLeaveDate(req.fromDate)}{req.toDate ? ` → ${formatLeaveDate(req.toDate)}` : ' (Single day)'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                      <Feather name="clock" size={scale(12)} color="#888" />
                      <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }}>{req.numberOfDays} day(s)</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                      <Feather name="file-text" size={scale(12)} color="#888" />
                      <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }} numberOfLines={2}>{req.reason}</Text>
                    </View>
                    {req.approvedBy ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                        <Feather name="user-check" size={scale(12)} color="#888" />
                        <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }}>By: {req.approvedBy}</Text>
                      </View>
                    ) : null}
                    {req.rejectionReason ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                        <Feather name="x-circle" size={scale(12)} color="#E74C3C" />
                        <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#E74C3C' }}>{req.rejectionReason}</Text>
                      </View>
                    ) : null}
                  </View>
                  {canCancel && (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: scale(8), paddingTop: scale(6), borderTopWidth: 1, borderTopColor: '#F0F0F0', gap: scale(4) }}
                      onPress={() => handleLeaveCancel(req.id)}
                    >
                      <MaterialIcons name="cancel" size={scale(14)} color="#E74C3C" />
                      <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#E74C3C' }}>Cancel Request</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );

  // =============================================
  // WAIVER REQUEST: helpers, fetchers & handler
  // =============================================
  const fetchEligibleLateAttendances = async () => {
    const empId = verifiedEmployee?.id;
    if (!empId) return;
    const records = await getEligibleLateAttendances(empId);
    setEligibleLateAttendances(records);
  };

  const fetchWaiverRequests = async () => {
    const empId = verifiedEmployee?.id;
    if (!empId) return;
    const records = await getMyWaiverRequests(empId);
    setWaiverRequests(records);
  };

  const handleWaiverSubmit = () => {
    if (!selectedWaiverAttendanceId) {
      showToastMessage('Please select a late attendance record');
      return;
    }
    if (!waiverReason.trim()) {
      showToastMessage('Please enter a reason for the waiver');
      return;
    }
    const selected = eligibleLateAttendances.find(r => r.id === selectedWaiverAttendanceId);
    showAlert({
      message: `Date: ${selected?.date || ''}\nLate: ${formatLateDuration(selected?.lateMinutes, selected?.lateMinutesDisplay)}\nDeduction: ${selected?.deductionAmount || 0}\n\nReason: ${waiverReason.trim()}`,
      confirmText: 'SUBMIT',
      cancelText: 'CANCEL',
      onConfirm: async () => {
        hideAlert();
        setLoading(true);
        try {
          const empId = verifiedEmployee?.id;
          const result = await submitWaiverRequest(empId, selectedWaiverAttendanceId, waiverReason.trim());
          if (result.success) {
            showToastMessage('Waiver request submitted for approval!');
            setWaiverReason('');
            setSelectedWaiverAttendanceId(null);
            await fetchWaiverRequests();
            await fetchEligibleLateAttendances();
            setWaiverTab('history');
          } else {
            showAlert({ message: result.error || 'Failed to submit' });
          }
        } catch (error) {
          showAlert({ message: error?.message || 'Failed to submit' });
        } finally {
          setLoading(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  // Auto-fetch eligible records & waiver list when entering waiver mode.
  // Also opportunistically refresh the slab cache so offline-deduction math
  // has the latest values; silent if offline. Then poll every 4s while in
  // waiver mode so the dropdown + My Requests reflect background sync events
  // (offline check-in/out → queue → eligible record; sync → real Odoo data)
  // without requiring the user to manually re-open the tab.
  useEffect(() => {
    if (attendanceMode === 'waiver' && isVerified && verifiedEmployee?.id) {
      let cancelled = false;
      let pollId = null;

      (async () => {
        try {
          const isOn = await networkStatus.isOnline();
          if (isOn) {
            await getLateConfig(verifiedEmployee.id);
            await fetchAndCacheLateSlabs();
            console.log('[Waiver] mount — refreshed late config + slabs');
          }
        } catch (e) {
          console.log('[Waiver] mount-prefetch skipped:', e?.message);
        }
        if (!cancelled) {
          fetchEligibleLateAttendances();
          fetchWaiverRequests();
        }
        pollId = setInterval(() => {
          if (cancelled) return;
          fetchEligibleLateAttendances();
          fetchWaiverRequests();
        }, 4000);
      })();

      return () => {
        cancelled = true;
        if (pollId) clearInterval(pollId);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendanceMode, isVerified, verifiedEmployee]);

  const getWaiverStateColor = (state) => {
    switch (state) {
      case 'draft': return '#9E9E9E';
      case 'pending': return '#FF9800';
      case 'approved': return '#4CAF50';
      case 'rejected': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  const getWaiverStateLabel = (state) => {
    switch (state) {
      case 'draft': return 'Draft';
      case 'pending': return 'Pending';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      default: return state;
    }
  };

  const renderWaiverSection = () => (
    <View style={{ flex: 1 }}>
      {/* Tab Bar */}
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', marginBottom: scale(8) }}>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: waiverTab === 'form' ? 2 : 0, borderBottomColor: '#9C27B0' }}
          onPress={() => { setWaiverTab('form'); fetchEligibleLateAttendances(); }}
        >
          <MaterialIcons name="add-circle-outline" size={scale(16)} color={waiverTab === 'form' ? '#9C27B0' : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: waiverTab === 'form' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: waiverTab === 'form' ? '#9C27B0' : '#999' }}>New Request</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: waiverTab === 'history' ? 2 : 0, borderBottomColor: '#9C27B0' }}
          onPress={() => { setWaiverTab('history'); fetchWaiverRequests(); }}
        >
          <MaterialIcons name="history" size={scale(16)} color={waiverTab === 'history' ? '#9C27B0' : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: waiverTab === 'history' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: waiverTab === 'history' ? '#9C27B0' : '#999' }}>My Requests</Text>
        </TouchableOpacity>
      </View>

      {waiverTab === 'form' ? (
        <View style={{ paddingHorizontal: scale(4) }}>
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginBottom: scale(6) }}>Select Late Attendance *</Text>
          <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginBottom: scale(8) }}>Last 30 days · only un-waived records</Text>

          {eligibleLateAttendances.length === 0 ? (
            <View style={{ alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: scale(10), padding: scale(20), marginBottom: scale(10) }}>
              <MaterialIcons name="check-circle" size={scale(36)} color="#4CAF50" />
              <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginTop: scale(8) }}>No late records found</Text>
              <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: scale(4), textAlign: 'center' }}>You have no eligible late attendances to waive.</Text>
            </View>
          ) : (
            <View style={{ marginBottom: scale(10) }}>
              {eligibleLateAttendances.map(rec => {
                const isSelected = selectedWaiverAttendanceId === rec.id;
                const isDisabled = rec.isWaived;
                return (
                  <TouchableOpacity
                    key={rec.id}
                    disabled={isDisabled}
                    activeOpacity={0.7}
                    onPress={() => setSelectedWaiverAttendanceId(rec.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', backgroundColor: isSelected ? '#F3E5F5' : '#fff',
                      borderWidth: 1, borderColor: isSelected ? '#9C27B0' : '#E0E0E0',
                      borderRadius: scale(10), padding: scale(10), gap: scale(10), marginBottom: scale(6),
                      opacity: isDisabled ? 0.5 : 1,
                    }}
                  >
                    <MaterialIcons name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'} size={scale(20)} color={isSelected ? '#9C27B0' : '#999'} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: '#333' }}>
                        {rec.date} · {rec.checkInTime}
                      </Text>
                      <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: scale(2) }}>
                        Late {formatLateDuration(rec.lateMinutes, rec.lateMinutesDisplay)} · Deduction: {rec.deductionAmount}
                      </Text>
                      {rec.lateReason ? (
                        <Text style={{ fontSize: scale(10), fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: scale(2) }} numberOfLines={1}>
                          "{rec.lateReason}"
                        </Text>
                      ) : null}
                    </View>
                    {rec.isWaived && (
                      <View style={{ paddingHorizontal: scale(6), paddingVertical: scale(2), borderRadius: scale(8), backgroundColor: '#E8F5E9' }}>
                        <Text style={{ fontSize: scale(9), fontFamily: FONT_FAMILY.urbanistBold, color: '#4CAF50' }}>WAIVED</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Reason */}
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginBottom: scale(6) }}>Reason for Waiver *</Text>
          <TextInput
            style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(10), fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: '#333', backgroundColor: '#fff', minHeight: scale(80) }}
            placeholder="e.g., office errand, client visit, traffic incident..."
            placeholderTextColor="#999"
            multiline
            numberOfLines={3}
            value={waiverReason}
            onChangeText={setWaiverReason}
            textAlignVertical="top"
          />

          {/* Submit */}
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: (!selectedWaiverAttendanceId || !waiverReason.trim()) ? '#CCC' : '#9C27B0', borderRadius: scale(10), padding: scale(12), marginTop: scale(12), gap: scale(6) }}
            disabled={!selectedWaiverAttendanceId || !waiverReason.trim() || loading}
            onPress={handleWaiverSubmit}
          >
            <MaterialIcons name="send" size={scale(18)} color="#fff" />
            <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>Submit Waiver Request</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* History Tab */
        <View>
          {waiverRequests.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: scale(40) }}>
              <MaterialIcons name="gavel" size={scale(40)} color="#9C27B0" />
              <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginTop: scale(10) }}>No waiver requests</Text>
            </View>
          ) : (
            waiverRequests.map(req => {
              const stateColor = getWaiverStateColor(req.state);
              return (
                <View key={req.id} style={{ backgroundColor: '#fff', borderRadius: scale(10), padding: scale(12), marginBottom: scale(8), elevation: 2, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: scale(8) }}>
                    <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: '#333' }}>
                      {req.lateDate}
                    </Text>
                    <View style={{ paddingHorizontal: scale(8), paddingVertical: scale(3), borderRadius: scale(10), backgroundColor: stateColor + '20' }}>
                      <Text style={{ fontSize: scale(10), fontFamily: FONT_FAMILY.urbanistBold, color: stateColor }}>{getWaiverStateLabel(req.state)}</Text>
                    </View>
                  </View>
                  <View style={{ backgroundColor: '#FAFAFA', borderRadius: scale(6), padding: scale(8), gap: scale(4) }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                      <Feather name="clock" size={scale(12)} color="#888" />
                      <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }}>
                        Late {formatLateDuration(req.lateMinutes, req.lateMinutesDisplay)} · Deduction: {req.originalDeduction}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: scale(6) }}>
                      <Feather name="file-text" size={scale(12)} color="#888" style={{ marginTop: scale(2) }} />
                      <Text style={{ flex: 1, fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }}>{req.reason}</Text>
                    </View>
                    {req.approvedBy ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6) }}>
                        <Feather name="user-check" size={scale(12)} color="#888" />
                        <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#555' }}>By: {req.approvedBy}</Text>
                      </View>
                    ) : null}
                    {req.rejectionReason ? (
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: scale(6) }}>
                        <Feather name="x-circle" size={scale(12)} color="#E74C3C" style={{ marginTop: scale(2) }} />
                        <Text style={{ flex: 1, fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#E74C3C' }}>{req.rejectionReason}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );

  // =============================================
  // RENDER: FIELD ATTENDANCE SECTION
  // =============================================
  // Field check-in, with reason-before-check-in. The backend GATES on lateness
  // (field check-in time = the trip's start time, which only the server knows):
  // when late and no reason is supplied it returns needs_late_reason WITHOUT
  // creating the row, so we show the modal and re-call with the reason. Both the
  // on-time path and the post-reason path share this one function.
  const doFieldCheckIn = async (lateReason = null) => {
    const result = await createFieldAttendanceOdoo(verifiedEmployee.id, lateReason);
    if (result?.success) {
      showToastMessage('Field attendance marked');
      // Refresh state by re-querying — keeps the rendered card consistent
      // with what the server now sees.
      const refreshed = await fetchTodayFieldAttendanceOdoo(verifiedEmployee.id).catch(() => null);
      setFieldStatus(refreshed?.status || 'already_field');
      setFieldData(refreshed || { status: 'already_field', attendance_id: result.attendance_id });
      return;
    }
    // Server says: would be late — collect the reason first, then re-call.
    if (result?.needs_late_reason) {
      setLateInfo({
        isLate: !!result.is_late,
        lateMinutes: result.late_minutes || 0,
        lateMinutesDisplay: result.late_minutes_display || '',
        session: result.checkin_session,
        expectedStartDisplay: result.expected_start_time
          ? floatToHM(result.expected_start_time)
          : undefined,
      });
      setPendingLateAttendanceId(null);
      setPendingLateAction(() => async (reason) => { await doFieldCheckIn(reason); });
      setShowLateReasonModal(true);
      return;
    }
    showAlert({
      message: result?.error || 'Could not mark field attendance.',
      confirmText: 'OK',
    });
  };

  const handleMarkFieldAttendance = async () => {
    if (fieldSubmitting || !verifiedEmployee?.id) return;
    setFieldSubmitting(true);
    try {
      await doFieldCheckIn(null);
    } catch (e) {
      showAlert({
        message: e?.message || 'Network error while marking field attendance.',
        confirmText: 'OK',
      });
    } finally {
      setFieldSubmitting(false);
    }
  };

  // Cross-mode guard banner: the day's attendance was started through the OTHER
  // mode, so this mode must NOT show its own check-in UI. Centered yellow card,
  // red font, with a button that jumps to the correct mode. `goTo` is the mode to
  // switch to ('field' shown inside Office, 'office' shown inside Field).
  const renderCrossModeBanner = (goTo) => {
    const otherLabel = goTo === 'field' ? 'Field Attendance' : 'Office Attendance';
    return (
      <View style={styles.crossModeWrap}>
        <View style={styles.crossModeBanner}>
          <MaterialIcons name="info-outline" size={scale(32)} color="#C62828" />
          <Text style={styles.crossModeText}>
            Check-in done through {otherLabel}.{'\n'}Please go there to continue.
          </Text>
          <TouchableOpacity
            style={styles.crossModeBtn}
            onPress={() => setAttendanceMode(goTo)}
            activeOpacity={0.85}
          >
            <MaterialIcons name="arrow-forward" size={scale(16)} color="#fff" />
            <Text style={styles.crossModeBtnText}>Go to {otherLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderFieldSection = () => {
    // Started through Office/Manual today → show only the "go to Office" banner.
    if (fieldStatus === 'manual_exists') {
      return renderCrossModeBanner('office');
    }
    const FIELD_COLOR = '#1976D2';
    const trip = fieldData?.trip;
    const visits = fieldData?.visits || [];

    const renderTabBar = () => (
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEE', marginHorizontal: -scale(4) }}>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: fieldTab === 'today' ? 2 : 0, borderBottomColor: FIELD_COLOR }}
          onPress={() => setFieldTab('today')}
          activeOpacity={0.7}
        >
          <MaterialIcons name="today" size={scale(16)} color={fieldTab === 'today' ? FIELD_COLOR : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: fieldTab === 'today' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: fieldTab === 'today' ? FIELD_COLOR : '#999' }}>Today</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: fieldTab === 'history' ? 2 : 0, borderBottomColor: FIELD_COLOR }}
          onPress={() => setFieldTab('history')}
          activeOpacity={0.7}
        >
          <MaterialIcons name="history" size={scale(16)} color={fieldTab === 'history' ? FIELD_COLOR : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: fieldTab === 'history' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: fieldTab === 'history' ? FIELD_COLOR : '#999' }}>History</Text>
        </TouchableOpacity>
      </View>
    );

    const renderHistoryTab = () => (
      <View style={{ marginTop: scale(10) }}>
        {/* Filter chip */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: scale(8) }}>
          <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: '#444' }}>
            My Records ({fieldHistoryRows.length})
          </Text>
          <View style={{ flexDirection: 'row', gap: scale(6) }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: scale(4), paddingVertical: scale(6), paddingHorizontal: scale(10), borderRadius: scale(8), backgroundColor: fieldFilterCount ? FIELD_COLOR : '#fff', borderWidth: 1, borderColor: FIELD_COLOR }}
              onPress={() => setFieldFiltersOpen(true)}
              activeOpacity={0.85}
            >
              <MaterialIcons name="filter-list" size={scale(14)} color={fieldFilterCount ? '#fff' : FIELD_COLOR} />
              <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistBold, color: fieldFilterCount ? '#fff' : FIELD_COLOR }}>
                Filters{fieldFilterCount ? ` · ${fieldFilterCount}` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ padding: scale(6) }}
              onPress={() => loadFieldHistory({ reset: true })}
              activeOpacity={0.7}
            >
              <MaterialIcons name="refresh" size={scale(18)} color={FIELD_COLOR} />
            </TouchableOpacity>
          </View>
        </View>

        {offline && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', borderRadius: scale(10), padding: scale(10), gap: scale(8), marginBottom: scale(8) }}>
            <MaterialIcons name="wifi-off" size={scale(16)} color="#7a4f00" />
            <Text style={{ flex: 1, fontSize: scale(11), color: '#7a4f00', fontFamily: FONT_FAMILY.urbanistMedium }}>
              Offline — connect to load history.
            </Text>
          </View>
        )}

        {fieldHistoryLoading && fieldHistoryRows.length === 0 ? (
          <View style={{ paddingVertical: scale(40), alignItems: 'center' }}>
            <MaterialIcons name="hourglass-empty" size={scale(28)} color={FIELD_COLOR} />
            <Text style={{ fontSize: scale(12), color: '#666', marginTop: scale(8), fontFamily: FONT_FAMILY.urbanistMedium }}>
              Loading…
            </Text>
          </View>
        ) : fieldHistoryRows.length === 0 ? (
          <View style={{ alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: scale(12), padding: scale(20), borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed' }}>
            <MaterialIcons name="inbox" size={scale(32)} color="#BDBDBD" />
            <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: scale(8) }}>
              No records yet
            </Text>
            <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: scale(2), textAlign: 'center' }}>
              {fieldFilterCount > 0 ? 'Try clearing filters or pick a different date range.' : 'Mark a field attendance to see it here.'}
            </Text>
          </View>
        ) : (
          <>
            {fieldHistoryRows.map((row) => (
              <HistoryListItem
                key={row.id}
                row={row}
                onPress={() => openFieldDetail(row.id)}
              />
            ))}
            {fieldHistoryHasMore ? (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: scale(6), backgroundColor: '#fff', borderRadius: scale(10), borderWidth: 1, borderColor: FIELD_COLOR, paddingVertical: scale(11), marginTop: scale(8) }}
                onPress={() => loadFieldHistory({ reset: false })}
                disabled={fieldHistoryLoading}
                activeOpacity={0.85}
              >
                <MaterialIcons name="expand-more" size={scale(16)} color={FIELD_COLOR} />
                <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR }}>
                  {fieldHistoryLoading ? 'Loading…' : 'Load more'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}

        <HistoryFiltersSheet
          visible={fieldFiltersOpen}
          initial={fieldHistoryFilters}
          onApply={applyFieldFilters}
          onClose={() => setFieldFiltersOpen(false)}
        />
      </View>
    );

    const renderEmpty = (icon, title, subtitle, ctaLabel, ctaTarget) => (
      <View style={[styles.detailsSection, { paddingTop: scale(8) }]}>
        <View style={{ alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: scale(12), padding: scale(20), marginTop: scale(8) }}>
          <MaterialIcons name={icon} size={scale(40)} color={FIELD_COLOR} />
          <Text style={{ fontSize: scale(15), fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginTop: scale(10), textAlign: 'center' }}>{title}</Text>
          <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: scale(4), textAlign: 'center' }}>{subtitle}</Text>
          <View style={{ flexDirection: 'row', gap: scale(8), marginTop: scale(14) }}>
            {ctaLabel && ctaTarget ? (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: FIELD_COLOR, borderRadius: scale(10), paddingVertical: scale(10), paddingHorizontal: scale(14), gap: scale(6) }}
                onPress={() => navigation.navigate(ctaTarget)}
              >
                <MaterialIcons name="arrow-forward" size={scale(16)} color="#fff" />
                <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>{ctaLabel}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: FIELD_COLOR, borderRadius: scale(10), paddingVertical: scale(10), paddingHorizontal: scale(14), gap: scale(6) }}
              onPress={() => refreshFieldAttendance()}
            >
              <MaterialIcons name="refresh" size={scale(16)} color={FIELD_COLOR} />
              <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR }}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );

    return (
      <View style={styles.detailsSection}>
        {/* Greeting Card */}
        <View style={styles.greetingCard}>
          <View style={styles.avatarContainer}>
            <View style={[styles.avatar, { backgroundColor: FIELD_COLOR }]}>
              <Text style={styles.avatarText}>{userName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={[styles.statusDot, { backgroundColor: FIELD_COLOR }]} />
          </View>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingText}>{getGreeting()}</Text>
            <Text style={styles.userNameText}>{userName}</Text>
          </View>
          <View style={[styles.wfhBadge, { backgroundColor: '#E3F2FD' }]}>
            <Text style={[styles.wfhBadgeText, { color: FIELD_COLOR }]}>FIELD</Text>
          </View>
        </View>

        {renderTabBar()}

        {fieldTab === 'history' ? renderHistoryTab() : (
          <View>
        {/* Offline */}
        {offline && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', borderRadius: scale(10), padding: scale(10), marginTop: scale(8), gap: scale(8) }}>
            <MaterialIcons name="wifi-off" size={scale(18)} color="#7a4f00" />
            <Text style={{ flex: 1, fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistMedium, color: '#7a4f00' }}>
              Offline — connect to mark field attendance.
            </Text>
          </View>
        )}

        {/* Loading */}
        {fieldStatus === 'loading' && !offline && (
          <View style={{ alignItems: 'center', padding: scale(28) }}>
            <MaterialIcons name="hourglass-empty" size={scale(36)} color={FIELD_COLOR} />
            <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: scale(10) }}>
              Loading…
            </Text>
          </View>
        )}

        {/* Manual conflict — non-field attendance already exists today */}
        {fieldStatus === 'manual_exists' && !offline && (
          <View style={{ backgroundColor: '#EFEBE9', borderRadius: scale(12), padding: scale(14), marginTop: scale(8), borderLeftWidth: 4, borderLeftColor: '#6D4C41' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(8) }}>
              <MaterialIcons name="lock" size={scale(20)} color="#6D4C41" />
              <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#333' }}>Already punched in manually</Text>
            </View>
            <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: scale(6) }}>
              You already have an attendance record for today via Office or Manual mode. Field attendance can't replace it.
            </Text>
          </View>
        )}

        {/* Eligible — Office-style Check-In button */}
        {fieldStatus === 'eligible' && !offline && (
          <View style={{ marginTop: scale(8) }}>
            <View style={styles.statusCardsContainer}>
              <View style={[styles.statusCard, styles.statusCardInactive]}>
                <View style={[styles.statusIconContainer, { backgroundColor: '#F5F5F5' }]}>
                  <MaterialIcons name="login" size={scale(20)} color={COLORS.gray} />
                </View>
                <Text style={styles.statusCardLabel}>Check In</Text>
                <Text style={styles.statusCardValue}>--:--</Text>
              </View>
              <View style={[styles.statusCard, styles.statusCardInactive]}>
                <View style={[styles.statusIconContainer, { backgroundColor: '#F5F5F5' }]}>
                  <MaterialIcons name="logout" size={scale(20)} color={COLORS.gray} />
                </View>
                <Text style={styles.statusCardLabel}>Check Out</Text>
                <Text style={styles.statusCardValue}>--:--</Text>
              </View>
            </View>
            <View style={styles.currentTimeCard}>
              <Feather name="clock" size={scale(16)} color={FIELD_COLOR} />
              <Text style={styles.currentTimeLabel}>Current Time:</Text>
              <Text style={[styles.currentTimeValue, { color: FIELD_COLOR }]}>{formatTimeOnly(currentTime)}</Text>
            </View>
            <TouchableOpacity
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                backgroundColor: fieldSubmitting ? '#90CAF9' : FIELD_COLOR,
                borderRadius: scale(12), padding: scale(14), marginTop: scale(14), gap: scale(8),
              }}
              disabled={fieldSubmitting}
              onPress={handleFieldCheckIn}
            >
              <MaterialIcons name={fieldSubmitting ? 'hourglass-empty' : 'login'} size={scale(20)} color="#fff" />
              <Text style={{ fontSize: scale(15), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>
                {fieldSubmitting ? 'Checking in…' : 'Check In'}
              </Text>
            </TouchableOpacity>
            <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', textAlign: 'center', marginTop: scale(8) }}>
              You can pick a primary trip and link visits after checking in.
            </Text>
          </View>
        )}

        {/* Checked In (open) — full trip management UI + Check Out */}
        {(fieldStatus === 'checked_in_open' || fieldStatus === 'checked_out') && !offline && (
          <View style={{ marginTop: scale(8) }}>
            {/* Time chips */}
            <View style={styles.statusCardsContainer}>
              <View style={[styles.statusCard, fieldData?.check_in ? styles.statusCardActive : styles.statusCardInactive]}>
                <View style={[styles.statusIconContainer, { backgroundColor: fieldData?.check_in ? '#E8F5E9' : '#F5F5F5' }]}>
                  <MaterialIcons name="login" size={scale(20)} color={fieldData?.check_in ? '#4CAF50' : COLORS.gray} />
                </View>
                <Text style={styles.statusCardLabel}>Check In</Text>
                <Text style={[styles.statusCardValue, fieldData?.check_in && { color: '#4CAF50' }]}>
                  {fieldData?.check_in ? (formatTimeOffice(fieldData.check_in, { hour12: false }) || '--:--') : '--:--'}
                </Text>
              </View>
              <View style={[styles.statusCard, fieldData?.check_out ? styles.statusCardActive : styles.statusCardInactive]}>
                <View style={[styles.statusIconContainer, { backgroundColor: fieldData?.check_out ? '#FFEBEE' : '#F5F5F5' }]}>
                  <MaterialIcons name="logout" size={scale(20)} color={fieldData?.check_out ? '#F44336' : COLORS.gray} />
                </View>
                <Text style={styles.statusCardLabel}>Check Out</Text>
                <Text style={[styles.statusCardValue, fieldData?.check_out && { color: '#F44336' }]}>
                  {fieldData?.check_out ? (formatTimeOffice(fieldData.check_out, { hour12: false }) || '--:--') : '--:--'}
                </Text>
              </View>
            </View>

            {/* Late banner */}
            {fieldDetail?.is_late ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6), backgroundColor: '#FFF8E1', borderRadius: scale(8), padding: scale(8), marginTop: scale(8), borderLeftWidth: 3, borderLeftColor: '#FB8C00' }}>
                <MaterialIcons name="schedule" size={scale(14)} color="#FB8C00" />
                <Text style={{ flex: 1, fontSize: scale(11.5), color: '#7a4f00', fontFamily: FONT_FAMILY.urbanistBold }}>
                  Late by {fieldDetail.late_minutes_display || `${fieldDetail.late_minutes || 0}m`}
                  {Number(fieldDetail.deduction_amount || 0) > 0 ? ` · Deduction ${Number(fieldDetail.deduction_amount).toFixed(2)}` : ''}
                </Text>
              </View>
            ) : null}

            {/* NEW Field Attendance flow — shared section drives the full
                hr_field_attendance state machine: Setup Primary Trip /
                Setup Secondary Trip on entry, Add Additional Trip loop,
                Primary Trip (Via Office or Direct), Office to Home,
                close-previous-trip with End KM, freeze-on-checkout, etc.
                The screen-level Check Out button below still handles the
                physical checkout for non-field flows; for field attendance
                the section's own internal state listens to the resulting
                refresh and renders the read-only banner once check_out
                is set on the server. */}
            {fieldDetail?.id ? (
              <FieldAttendanceSection attendanceId={fieldDetail.id} embedded refreshTrigger={faRefreshTick} />
            ) : null}

            {/* Action footer */}
            {fieldStatus === 'checked_in_open' ? (
              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: checkOutSubmitting ? '#EF9A9A' : '#E53935',
                  borderRadius: scale(12), padding: scale(14), marginTop: scale(16), gap: scale(8),
                }}
                disabled={checkOutSubmitting}
                onPress={handleFieldCheckOut}
              >
                <MaterialIcons name={checkOutSubmitting ? 'hourglass-empty' : 'logout'} size={scale(20)} color="#fff" />
                <Text style={{ fontSize: scale(15), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>
                  {checkOutSubmitting ? 'Checking out…' : 'Check Out'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(8), backgroundColor: '#E8F5E9', borderRadius: scale(12), padding: scale(14), marginTop: scale(16), borderLeftWidth: 4, borderLeftColor: '#2E7D32' }}>
                <MaterialIcons name="check-circle" size={scale(22)} color="#2E7D32" />
                <Text style={{ flex: 1, fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#1B5E20' }}>
                  Field attendance complete
                </Text>
              </View>
            )}
          </View>
        )}

          </View>
        )}
      </View>
    );
  };

  // =============================================
  // RENDER: OFFICE SECTION (existing flow)
  // =============================================
  const renderOfficeSection = () => {
    const OFFICE_COLOR = COLORS.primaryThemeColor;

    // Still fetching today's record → show a loader so the Check-In button never
    // flashes from stale/empty state before the real data arrives.
    if (officeLoading) {
      return (
        <View style={styles.crossModeWrap}>
          <ActivityIndicator size="large" color={OFFICE_COLOR} />
          <Text style={styles.officeLoadingText}>Loading your attendance…</Text>
        </View>
      );
    }

    // Started through Field today → show only the "go to Field" banner, hide the
    // office check-in UI so the user can't create a conflicting record here.
    if (todayAttendance?.attendance_source === 'field') {
      return renderCrossModeBanner('field');
    }

    const renderOfficeHistoryTab = () => (
      <View style={{ marginTop: scale(10) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: scale(8) }}>
          <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: '#444' }}>
            My Records ({officeHistoryRows.length})
          </Text>
          <View style={{ flexDirection: 'row', gap: scale(6) }}>
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', gap: scale(4), paddingVertical: scale(6), paddingHorizontal: scale(10), borderRadius: scale(8), backgroundColor: officeFilterCount ? OFFICE_COLOR : '#fff', borderWidth: 1, borderColor: OFFICE_COLOR }}
              onPress={() => setOfficeFiltersOpen(true)}
              activeOpacity={0.85}
            >
              <MaterialIcons name="filter-list" size={scale(14)} color={officeFilterCount ? '#fff' : OFFICE_COLOR} />
              <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistBold, color: officeFilterCount ? '#fff' : OFFICE_COLOR }}>
                Filters{officeFilterCount ? ` · ${officeFilterCount}` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ padding: scale(6) }} onPress={() => loadOfficeHistory({ reset: true })} activeOpacity={0.7}>
              <MaterialIcons name="refresh" size={scale(18)} color={OFFICE_COLOR} />
            </TouchableOpacity>
          </View>
        </View>

        {offline && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF3E0', borderRadius: scale(10), padding: scale(10), gap: scale(8), marginBottom: scale(8) }}>
            <MaterialIcons name="wifi-off" size={scale(16)} color="#7a4f00" />
            <Text style={{ flex: 1, fontSize: scale(11), color: '#7a4f00', fontFamily: FONT_FAMILY.urbanistMedium }}>
              Offline — connect to load history.
            </Text>
          </View>
        )}

        {officeHistoryLoading && officeHistoryRows.length === 0 ? (
          <View style={{ paddingVertical: scale(40), alignItems: 'center' }}>
            <MaterialIcons name="hourglass-empty" size={scale(28)} color={OFFICE_COLOR} />
            <Text style={{ fontSize: scale(12), color: '#666', marginTop: scale(8), fontFamily: FONT_FAMILY.urbanistMedium }}>Loading…</Text>
          </View>
        ) : officeHistoryRows.length === 0 ? (
          <View style={{ alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: scale(12), padding: scale(20), borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed' }}>
            <MaterialIcons name="inbox" size={scale(32)} color="#BDBDBD" />
            <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: scale(8) }}>No records yet</Text>
            <Text style={{ fontSize: scale(11), fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: scale(2), textAlign: 'center' }}>
              {officeFilterCount > 0 ? 'Try clearing filters or pick a different date range.' : 'Check in to office to see it here.'}
            </Text>
          </View>
        ) : (
          <>
            {officeHistoryRows.map((row) => (
              <HistoryListItem
                key={row.id}
                row={row}
                title="Office Attendance"
                accentColor={OFFICE_COLOR}
                onPress={() => { setOfficeDetailRow(row); setOfficeDetailOpen(true); }}
              />
            ))}
            {officeHistoryHasMore ? (
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: scale(6), backgroundColor: '#fff', borderRadius: scale(10), borderWidth: 1, borderColor: OFFICE_COLOR, paddingVertical: scale(11), marginTop: scale(8) }}
                onPress={() => loadOfficeHistory({ reset: false })}
                disabled={officeHistoryLoading}
                activeOpacity={0.85}
              >
                <MaterialIcons name="expand-more" size={scale(16)} color={OFFICE_COLOR} />
                <Text style={{ fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: OFFICE_COLOR }}>
                  {officeHistoryLoading ? 'Loading…' : 'Load more'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        )}

        <HistoryFiltersSheet
          visible={officeFiltersOpen}
          initial={officeHistoryFilters}
          onApply={applyOfficeFilters}
          onClose={() => setOfficeFiltersOpen(false)}
        />

        {/* Tap-a-row detail popup — uses the fields already on the history row. */}
        <Modal visible={officeDetailOpen} transparent animationType="fade" onRequestClose={() => setOfficeDetailOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: scale(24) }}>
            <View style={{ backgroundColor: '#fff', borderRadius: scale(16), padding: scale(18) }}>
              {(() => {
                const r = officeDetailRow || {};
                // Office timezone (from config), not raw UTC / device clock.
                const fmtT = (s) => (s ? (formatTimeOffice(s, { hour12: false }) || '—') : '—');
                const fmtD = (s) => {
                  if (!s) return '';
                  return formatDateOffice(s, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
                    || String(s).slice(0, 10);
                };
                const isLate = !!r.is_late;
                const ded = Number(r.deduction_amount || 0);
                const hrs = Number(r.daily_total_hours || 0);
                const Row = ({ label, value, color }) => (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: scale(5) }}>
                    <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#777' }}>{label}</Text>
                    <Text style={{ flexShrink: 1, textAlign: 'right', marginLeft: scale(10), fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistBold, color: color || '#222' }}>{value}</Text>
                  </View>
                );
                return (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(8), marginBottom: scale(10) }}>
                      <MaterialIcons name="event-available" size={scale(20)} color={COLORS.primaryThemeColor} />
                      <Text style={{ flex: 1, fontSize: scale(15), fontFamily: FONT_FAMILY.urbanistBold, color: COLORS.primaryThemeColor }}>
                        {fmtD(r.check_in)}
                      </Text>
                      {r.is_waived ? (
                        <View style={{ paddingHorizontal: scale(7), paddingVertical: scale(2), borderRadius: scale(5), borderWidth: 1, borderColor: '#9C27B0', backgroundColor: '#F3E5F5' }}>
                          <Text style={{ fontSize: scale(9), fontFamily: FONT_FAMILY.urbanistBold, color: '#9C27B0' }}>WAIVED</Text>
                        </View>
                      ) : null}
                    </View>

                    <Row label="Session" value={String(r.checkin_session || '1')} />
                    <Row label="Check In" value={fmtT(r.check_in)} color="#2E7D32" />
                    <Row label="Check Out" value={fmtT(r.check_out)} color="#C62828" />
                    <Row label="Total Hours" value={hrs > 0 ? `${hrs.toFixed(2)} h` : '—'} />
                    {isLate ? <Row label="Late by" value={r.late_minutes_display || `${r.late_minutes || 0}m`} color="#B26A00" /> : null}
                    {ded > 0 ? <Row label="Deduction" value={ded.toFixed(2)} color="#C62828" /> : null}
                    {r.late_reason && String(r.late_reason).trim() ? (
                      <View style={{ marginTop: scale(6) }}>
                        <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#777', marginBottom: scale(2) }}>Late reason</Text>
                        <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#333' }}>{r.late_reason}</Text>
                      </View>
                    ) : null}

                    <TouchableOpacity
                      style={{ marginTop: scale(16), backgroundColor: COLORS.primaryThemeColor, borderRadius: scale(10), paddingVertical: scale(12), alignItems: 'center' }}
                      onPress={() => setOfficeDetailOpen(false)}
                      activeOpacity={0.85}
                    >
                      <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>Close</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>
          </View>
        </Modal>
      </View>
    );

    return (
    <View style={styles.detailsSection}>
      {/* Today | History tab bar */}
      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEE', marginHorizontal: -scale(4), marginBottom: scale(6) }}>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: officeTab === 'today' ? 2 : 0, borderBottomColor: OFFICE_COLOR }}
          onPress={() => setOfficeTab('today')}
          activeOpacity={0.7}
        >
          <MaterialIcons name="today" size={scale(16)} color={officeTab === 'today' ? OFFICE_COLOR : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: officeTab === 'today' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: officeTab === 'today' ? OFFICE_COLOR : '#999' }}>Today</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: scale(10), gap: scale(4), borderBottomWidth: officeTab === 'history' ? 2 : 0, borderBottomColor: OFFICE_COLOR }}
          onPress={() => setOfficeTab('history')}
          activeOpacity={0.7}
        >
          <MaterialIcons name="history" size={scale(16)} color={officeTab === 'history' ? OFFICE_COLOR : '#999'} />
          <Text style={{ fontSize: scale(12), fontFamily: officeTab === 'history' ? FONT_FAMILY.urbanistBold : FONT_FAMILY.urbanistMedium, color: officeTab === 'history' ? OFFICE_COLOR : '#999' }}>History</Text>
        </TouchableOpacity>
      </View>

      {officeTab === 'history' ? renderOfficeHistoryTab() : (
        <>
      {/* Greeting Card */}
      <View style={styles.greetingCard}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {userName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.statusDot} />
        </View>
        <View style={styles.greetingTextContainer}>
          <Text style={styles.greetingText}>{getGreeting()}</Text>
          <Text style={styles.userNameText}>{userName}</Text>
        </View>
      </View>

      {/* Status Cards */}
      <View style={styles.statusCardsContainer}>
        <View style={[styles.statusCard, todayAttendance?.checkIn ? styles.statusCardActive : styles.statusCardInactive]}>
          <View style={[styles.statusIconContainer, { backgroundColor: todayAttendance?.checkIn ? '#E8F5E9' : '#F5F5F5' }]}>
            <MaterialIcons name="login" size={scale(20)} color={todayAttendance?.checkIn ? '#4CAF50' : COLORS.gray} />
          </View>
          <Text style={styles.statusCardLabel}>Check In</Text>
          <Text style={[styles.statusCardValue, todayAttendance?.checkIn && { color: '#4CAF50' }]}>
            {liveCheckTime(todayAttendance?.checkInTimeUtc, todayAttendance?.checkIn)}
          </Text>
        </View>

        <View style={[styles.statusCard, todayAttendance?.checkOut ? styles.statusCardActive : styles.statusCardInactive]}>
          <View style={[styles.statusIconContainer, { backgroundColor: todayAttendance?.checkOut ? '#FFEBEE' : '#F5F5F5' }]}>
            <MaterialIcons name="logout" size={scale(20)} color={todayAttendance?.checkOut ? '#F44336' : COLORS.gray} />
          </View>
          <Text style={styles.statusCardLabel}>Check Out</Text>
          <Text style={[styles.statusCardValue, todayAttendance?.checkOut && { color: '#F44336' }]}>
            {liveCheckTime(todayAttendance?.checkOutTimeUtc, todayAttendance?.checkOut)}
          </Text>
        </View>
      </View>

      {/* Late banner — mirrors the field-mode banner. Renders whenever the
          open attendance is flagged late, regardless of whether the user is
          looking at the late-reason popup. */}
      {todayAttendance?.is_late ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6), backgroundColor: '#FFF8E1', borderRadius: scale(8), padding: scale(8), marginTop: scale(8), borderLeftWidth: 3, borderLeftColor: '#FB8C00' }}>
          <MaterialIcons name="schedule" size={scale(14)} color="#FB8C00" />
          <Text style={{ flex: 1, fontSize: scale(11.5), color: '#7a4f00', fontFamily: FONT_FAMILY.urbanistBold }}>
            Late by {todayAttendance.late_minutes_display || `${todayAttendance.late_minutes || 0}m`}
            {Number(todayAttendance.deduction_amount || 0) > 0 ? ` · Deduction ${Number(todayAttendance.deduction_amount).toFixed(2)}` : ''}
          </Text>
        </View>
      ) : null}

      {/* Late reason + Update — reason shows read-only; the Update button is only
          available UNTIL checkout (while the attendance is still open). */}
      {todayAttendance?.is_late ? (
        <View style={{ backgroundColor: '#fff', borderRadius: scale(10), padding: scale(10), marginTop: scale(8), borderWidth: 1, borderColor: '#ECECEC' }}>
          <Text style={{ fontSize: scale(11.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#777' }}>Late reason</Text>
          <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: '#333', marginTop: scale(2) }}>
            {todayAttendance.late_reason && String(todayAttendance.late_reason).trim() ? todayAttendance.late_reason : '—'}
          </Text>
          {hasCheckedIn && !hasCheckedOut && todayAttendance?.id ? (
            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: scale(4), marginTop: scale(8), paddingVertical: scale(6), paddingHorizontal: scale(10), borderRadius: scale(8), borderWidth: 1, borderColor: COLORS.primaryThemeColor }}
              onPress={() => { setOfficeUpdateText(todayAttendance.late_reason || ''); setOfficeUpdateOpen(true); }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="edit" size={scale(14)} color={COLORS.primaryThemeColor} />
              <Text style={{ fontSize: scale(11.5), fontFamily: FONT_FAMILY.urbanistBold, color: COLORS.primaryThemeColor }}>Update Reason</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Office Update-Reason editor modal (pre-filled with the current reason) */}
      <Modal visible={officeUpdateOpen} transparent animationType="fade" onRequestClose={() => setOfficeUpdateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: scale(24) }}>
          <View style={{ backgroundColor: '#fff', borderRadius: scale(16), padding: scale(18) }}>
            <Text style={{ fontSize: scale(15), fontFamily: FONT_FAMILY.urbanistBold, color: COLORS.primaryThemeColor, marginBottom: scale(10) }}>Update Late Reason</Text>
            <TextInput
              style={{ borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(10), minHeight: scale(80), textAlignVertical: 'top', fontFamily: FONT_FAMILY.urbanistRegular, fontSize: scale(13), color: '#222' }}
              placeholder="Enter your reason for being late..."
              placeholderTextColor="#999"
              multiline
              value={officeUpdateText}
              onChangeText={setOfficeUpdateText}
            />
            <TouchableOpacity
              style={{ marginTop: scale(14), backgroundColor: (!officeUpdateText.trim() || officeUpdateSaving) ? '#CCC' : COLORS.primaryThemeColor, borderRadius: scale(10), paddingVertical: scale(12), alignItems: 'center' }}
              disabled={!officeUpdateText.trim() || officeUpdateSaving}
              onPress={async () => {
                const text = officeUpdateText.trim();
                if (!text || !todayAttendance?.id) return;
                setOfficeUpdateSaving(true);
                try {
                  const res = await submitLateReason(todayAttendance.id, text);
                  if (res?.success) {
                    setTodayAttendance(prev => prev ? { ...prev, late_reason: text } : prev);
                    showToastMessage('Late reason updated');
                    setOfficeUpdateOpen(false);
                  } else {
                    showToastMessage(res?.error || 'Could not update reason', 'error');
                  }
                } catch (e) {
                  showToastMessage('Could not update reason', 'error');
                } finally {
                  setOfficeUpdateSaving(false);
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: '#fff' }}>{officeUpdateSaving ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: scale(10), paddingVertical: scale(10), alignItems: 'center' }} onPress={() => setOfficeUpdateOpen(false)}>
              <Text style={{ fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistSemiBold, color: '#666' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Today's Details — shown after checkout, mirrors the field summary:
          Check In, Check Out, Total Hours, and (if late) Late by + Deduction. */}
      {hasCheckedOut && (
        <View style={{ backgroundColor: '#fff', borderRadius: scale(12), padding: scale(14), marginTop: scale(12), borderWidth: 1, borderColor: '#ECECEC' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: scale(6), marginBottom: scale(10) }}>
            <MaterialIcons name="event-available" size={scale(18)} color={COLORS.primaryThemeColor} />
            <Text style={{ fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistBold, color: COLORS.primaryThemeColor }}>Today's Details</Text>
          </View>
          {[
            { label: 'Check In', value: liveCheckTime(todayAttendance?.checkInTimeUtc, todayAttendance?.checkIn) },
            { label: 'Check Out', value: liveCheckTime(todayAttendance?.checkOutTimeUtc, todayAttendance?.checkOut) },
            {
              label: 'Total Hours',
              value: (todayAttendance?.daily_total_hours != null && Number(todayAttendance.daily_total_hours) > 0)
                ? `${Number(todayAttendance.daily_total_hours).toFixed(2)} h`
                : '--',
            },
          ].map((row) => (
            <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: scale(5) }}>
              <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#777' }}>{row.label}</Text>
              <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistBold, color: '#222' }}>{row.value}</Text>
            </View>
          ))}
          {todayAttendance?.is_late ? (
            <>
              <View style={{ height: 1, backgroundColor: '#F0F0F0', marginVertical: scale(6) }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: scale(5) }}>
                <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#B26A00' }}>Late by</Text>
                <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistBold, color: '#B26A00' }}>
                  {todayAttendance.late_minutes_display || `${todayAttendance.late_minutes || 0}m`}
                </Text>
              </View>
              {Number(todayAttendance.deduction_amount || 0) > 0 ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: scale(5) }}>
                  <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistMedium, color: '#C62828' }}>Deduction</Text>
                  <Text style={{ fontSize: scale(12.5), fontFamily: FONT_FAMILY.urbanistBold, color: '#C62828' }}>
                    {Number(todayAttendance.deduction_amount).toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      )}

      {/* Location Status */}
      {locationStatus && (
        <View style={[styles.locationStatusCard, locationStatus.verified ? styles.locationVerified : styles.locationNotVerified]}>
          <View style={styles.locationIconContainer}>
            <MaterialIcons
              name={locationStatus.verified ? "location-on" : "location-off"}
              size={scale(20)}
              color={locationStatus.verified ? '#4CAF50' : '#F44336'}
            />
          </View>
          <View style={styles.locationTextContainer}>
            <Text style={styles.locationStatusTitle}>
              {locationStatus.verified ? 'Location Verified' : 'Outside Workplace Range'}
            </Text>
            {locationStatus.distance !== undefined && (
              <Text style={styles.locationStatusSubtitle}>
                {locationStatus.distance}m from {locationStatus.workplaceName || 'workplace'}
                {!locationStatus.verified && ` (max ${locationStatus.threshold}m)`}
              </Text>
            )}
            {locationStatus.error && (
              <Text style={styles.locationStatusSubtitle}>{locationStatus.error}</Text>
            )}
          </View>
        </View>
      )}

      {/* Current Time */}
      <View style={styles.currentTimeCard}>
        <Feather name="clock" size={scale(16)} color={COLORS.primaryThemeColor} />
        <Text style={styles.currentTimeLabel}>Current Time:</Text>
        <Text style={styles.currentTimeValue}>{formatTimeOnly(currentTime)}</Text>
      </View>

      {/* Active Customer Visit banner */}
      {linkedVisitId && visitCustomer && (
        <View style={styles.activeVisitBanner}>
          <MaterialIcons name="place" size={scale(18)} color="#fff" />
          <Text style={styles.activeVisitBannerText}>
            On Visit: {visitCustomer.name}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.buttonContainer}>
        {!hasCheckedIn && !hasCheckedOut && (
          <TouchableOpacity
            style={styles.checkInButton}
            onPress={handleCheckIn}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={styles.buttonIconContainer}>
              <MaterialIcons name="fingerprint" size={scale(22)} color={COLORS.white} />
            </View>
            <View style={styles.buttonTextContainer}>
              <Text style={styles.buttonTitle}>Check In</Text>
              <Text style={styles.buttonSubtitle}>Tap to mark your arrival</Text>
            </View>
            <Feather name="chevron-right" size={scale(20)} color={COLORS.white} />
          </TouchableOpacity>
        )}

        {hasCheckedIn && (
          <TouchableOpacity
            style={styles.checkOutButton}
            onPress={handleCheckOut}
            disabled={loading}
            activeOpacity={0.8}
          >
            <View style={styles.buttonIconContainer}>
              <MaterialIcons name="fingerprint" size={scale(22)} color={COLORS.white} />
            </View>
            <View style={styles.buttonTextContainer}>
              <Text style={styles.buttonTitle}>Check Out</Text>
              <Text style={styles.buttonSubtitle}>Tap to mark your departure</Text>
            </View>
            <Feather name="chevron-right" size={scale(20)} color={COLORS.white} />
          </TouchableOpacity>
        )}

        {hasCheckedOut && (
          <View style={styles.completedContainer}>
            <View style={styles.completedIconContainer}>
              <Ionicons name="checkmark-circle" size={scale(36)} color="#4CAF50" />
            </View>
            <Text style={styles.completedTitle}>All Done!</Text>
            <Text style={styles.completedText}>Your attendance is complete for today</Text>
          </View>
        )}
      </View>

      {/* Quick switch to Field Attendance — keeps the verified employee. */}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: scale(10) }}>
        <TouchableOpacity
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: scale(6),
            backgroundColor: '#E3F2FD',
            borderRadius: scale(20),
            paddingVertical: scale(8),
            paddingHorizontal: scale(14),
            borderWidth: 1,
            borderColor: '#1976D2',
          }}
          activeOpacity={0.85}
          onPress={() => setAttendanceMode('field')}
        >
          <MaterialIcons name="open-in-new" size={scale(14)} color="#1976D2" />
          <Text style={{ fontSize: scale(12), color: '#1976D2', fontFamily: FONT_FAMILY.urbanistBold }}>
            Open Field Att
          </Text>
        </TouchableOpacity>
      </View>
        </>
      )}
    </View>
    );
  };

  // =============================================
  // MAIN RENDER
  // =============================================
  return (
    <SafeAreaView style={styles.container}>
      <NavigationHeader
        title={attendanceMode === 'wfh' ? 'Work From Home' : attendanceMode === 'office' ? 'Office Attendance' : attendanceMode === 'leave' ? 'Leave Request' : attendanceMode === 'waiver' ? 'Late Waiver Request' : attendanceMode === 'field' ? 'Field Attendance' : 'Attendance'}
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={handleBackPress}
      />

      {offline && (
        <View style={styles.offlineBanner}>
          <MaterialIcons name="wifi-off" size={scale(16)} color="#7a4f00" />
          <Text style={styles.offlineBannerText}>
            OFFLINE MODE — punches will sync automatically when you reconnect
          </Text>
        </View>
      )}

      {/* RoundedScrollContainer already wraps its children in a
          KeyboardAvoidingView internally — adding a second KAV here was
          causing an Android "double-handler" race where the keyboard
          sometimes failed to appear on the first tap of the PIN field.
          Replaced the outer KAV with a plain View. */}
      <View style={{ flex: 1 }}>
        <RoundedScrollContainer style={styles.content}>
          {/* Header Card */}
          <View style={styles.headerCard}>
            <View style={styles.headerTop}>
              <View style={styles.dateSection}>
                <View style={styles.iconCircle}>
                  <Feather name="calendar" size={scale(18)} color={COLORS.white} />
                </View>
                <View style={styles.dateTextContainer}>
                  <Text style={styles.dateLabel}>Today</Text>
                  <Text style={styles.dateValue}>{formatDate(currentTime)}</Text>
                </View>
              </View>
            </View>

            <View style={styles.timeSection}>
              <View style={styles.timeIconContainer}>
                <Ionicons name="time-outline" size={scale(22)} color={COLORS.primaryThemeColor} />
              </View>
              <Text style={styles.timeValue}>{formatTime(currentTime)}</Text>
              <Text style={styles.timeLabel}>Live Time</Text>
            </View>
          </View>

          {/* Mode Selection */}
          {!attendanceMode && renderModeSelection()}

          {/* Fingerprint + PIN Section (shown when mode selected but not yet verified) */}
          {attendanceMode && !isVerified && (
            <View style={styles.pinSection}>
              <View style={styles.pinHeader}>
                <TouchableOpacity
                  style={styles.fingerprintButton}
                  onPress={handleFingerprintScan}
                  disabled={loading}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="fingerprint" size={scale(56)} color={attendanceMode === 'wfh' ? '#2196F3' : attendanceMode === 'leave' ? '#FF9800' : attendanceMode === 'field' ? '#1976D2' : COLORS.primaryThemeColor} />
                </TouchableOpacity>
                <Text style={styles.pinTitle}>Scan Fingerprint</Text>
                <Text style={styles.pinSubtitle}>Tap to verify your identity</Text>
              </View>

              {/* OR Divider */}
              <View style={styles.orDivider}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>OR</Text>
                <View style={styles.orLine} />
              </View>

              {/* PIN Input */}
              <View style={styles.pinInputSection}>
                <View style={styles.pinInputHeader}>
                  <MaterialIcons name="dialpad" size={scale(20)} color={attendanceMode === 'wfh' ? '#2196F3' : attendanceMode === 'leave' ? '#FF9800' : attendanceMode === 'field' ? '#1976D2' : COLORS.primaryThemeColor} />
                  <Text style={styles.pinInputTitle}>Enter PIN</Text>
                </View>
                <TextInput
                  style={styles.pinInputField}
                  placeholder="Enter your PIN"
                  placeholderTextColor={COLORS.gray}
                  value={pinInput}
                  onChangeText={(t) => {
                    console.log('[PIN] onChangeText length=', t.length);
                    setPinInput(t);
                  }}
                  onFocus={() => console.log('[PIN] onFocus — soft keyboard should be visible now')}
                  onBlur={() => console.log('[PIN] onBlur — soft keyboard dismissed')}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={10}
                  // Android occasionally suppresses the soft keyboard on focus
                  // when other inputs/modals have recently dismissed it. Force
                  // it on every focus to dodge that race.
                  showSoftInputOnFocus
                  returnKeyType="done"
                  blurOnSubmit
                />
                <TouchableOpacity
                  style={[styles.pinVerifyButton, { backgroundColor: attendanceMode === 'wfh' ? '#2196F3' : attendanceMode === 'field' ? '#1976D2' : COLORS.primaryThemeColor }]}
                  onPress={handlePinVerify}
                  disabled={loading || !pinInput.trim()}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name="check" size={scale(18)} color={COLORS.white} />
                  <Text style={styles.pinVerifyText}>Verify PIN</Text>
                </TouchableOpacity>
              </View>

              {deviceId && (
                <View style={styles.deviceIdContainer}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.deviceIdLabel}>Device ID:</Text>
                      <Text style={styles.deviceIdValue} numberOfLines={1}>{deviceId}</Text>
                    </View>
                    {deviceName ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: scale(3) }}>
                        <Text style={styles.deviceIdLabel}>Device:</Text>
                        <Text style={styles.deviceIdValue} numberOfLines={1}>{deviceName}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Verified Content */}
          {attendanceMode === 'office' && isVerified && renderOfficeSection()}
          {attendanceMode === 'wfh' && isVerified && renderWfhSection()}
          {attendanceMode === 'leave' && isVerified && renderLeaveSection()}
          {attendanceMode === 'waiver' && isVerified && renderWaiverSection()}
          {attendanceMode === 'field' && isVerified && renderFieldSection()}
        </RoundedScrollContainer>
      </View>

      <OverlayLoader visible={loading && !showCamera} />

      {/* Camera Modal */}
      <Modal
        visible={showCamera}
        animationType="slide"
        onRequestClose={closeCamera}
      >
        <View style={styles.cameraContainer}>
          <Camera
            ref={cameraRef}
            style={styles.camera}
            type={Camera.Constants.Type.front}
          >
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraHeader}>
                <TouchableOpacity
                  style={styles.cameraCloseButton}
                  onPress={() => {
                    closeCamera();
                    setLoading(false);
                  }}
                >
                  <MaterialIcons name="close" size={scale(28)} color={COLORS.white} />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>
                  {cameraType === 'check_in' || cameraType === 'field_check_in' ? 'Check In Photo' : 'Check Out Photo'}
                </Text>
                <View style={{ width: scale(40) }} />
              </View>

              <View style={styles.faceGuideContainer}>
                <View style={styles.faceGuide}>
                  <MaterialIcons name="face" size={scale(120)} color="rgba(255,255,255,0.3)" />
                </View>
                <Text style={styles.faceGuideText}>Position your face in the frame</Text>
              </View>

              <View style={styles.countdownContainer}>
                {countdown > 0 ? (
                  <>
                    <Text style={styles.countdownNumber}>{countdown}</Text>
                    <Text style={styles.countdownText}>Taking photo in...</Text>
                  </>
                ) : (
                  <>
                    <MaterialIcons name="camera" size={scale(48)} color={COLORS.white} />
                    <Text style={styles.countdownText}>Capturing...</Text>
                  </>
                )}
              </View>
            </View>
          </Camera>
        </View>
      </Modal>

      {/* Late Reason Modal */}
      <Modal
        visible={showLateReasonModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.lateModalOverlay}>
          <View style={styles.lateModalContainer}>
            <View style={styles.lateModalHeader}>
              <MaterialIcons name="schedule" size={scale(28)} color="#E74C3C" />
              <Text style={styles.lateModalTitle}>You're Late</Text>
            </View>
            <Text style={styles.lateModalSubtitle}>
              You are {formatLateDuration(lateInfo?.lateMinutes, lateInfo?.lateMinutesDisplay)} late
              {lateInfo?.session ? ` for Session ${lateInfo.session}` : ' today'}
              {lateInfo?.lateSequence ? ` (Late #${lateInfo.lateSequence} this month)` : ''}
            </Text>
            {lateInfo?.expectedStartDisplay && (
              <Text style={styles.lateModalDetail}>
                Expected start: {lateInfo.expectedStartDisplay}
              </Text>
            )}
            {lateInfo?.deductionAmount > 0 && (
              <Text style={styles.lateDeductionText}>
                Salary deduction: {lateInfo.deductionAmount}
              </Text>
            )}
            <Text style={styles.lateReasonLabel}>Please provide a reason:</Text>
            <TextInput
              style={styles.lateReasonInput}
              placeholder="Enter your reason for being late..."
              placeholderTextColor="#999"
              multiline
              numberOfLines={3}
              value={lateReasonText}
              onChangeText={setLateReasonText}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.lateSubmitButton, !lateReasonText.trim() && styles.lateSubmitButtonDisabled]}
              disabled={!lateReasonText.trim()}
              onPress={async () => {
                const reason = lateReasonText.trim();
                if (!reason) {
                  console.log('[late-submit] BLOCKED: reason is empty');
                  return;
                }
                setLoading(true);
                try {
                  if (pendingLateAction) {
                    // Reason-before-check-in: run the deferred check-in (office
                    // or field) WITH the reason — the row is created now.
                    console.log('[late-submit] reason-first path — running deferred check-in');
                    await pendingLateAction(reason);
                  } else if (pendingLateAttendanceId) {
                    // Legacy path: patch the reason onto an already-created row
                    // (re-prompt for older late records lacking a reason).
                    const idStr = String(pendingLateAttendanceId);
                    if (idStr.startsWith('offline:')) {
                      const localId = idStr.split(':')[1];
                      console.log('[late-submit] OFFLINE path — localId=' + localId);
                      await offlineQueue.updateValues(localId, { late_reason: reason });
                      const after = await offlineQueue.getAll();
                      const updated = after.find(q => q.id === localId);
                      if (updated && updated.values?.late_reason === reason) {
                        showToastMessage('Late reason saved offline');
                      } else if (!updated) {
                        showToastMessage('Reason will sync on next online write');
                      } else {
                        showToastMessage('Saved (but value mismatch — check logs)');
                      }
                    } else {
                      console.log('[late-submit] ONLINE path — id=' + idStr);
                      await submitLateReason(pendingLateAttendanceId, reason);
                      showToastMessage('Late reason submitted');
                    }
                  } else {
                    showToastMessage('Cannot save reason — try again');
                  }
                } catch (err) {
                  console.log('[late-submit] error:', err?.message, err?.stack);
                }
                setShowLateReasonModal(false);
                setLateReasonText('');
                setPendingLateAttendanceId(null);
                setPendingLateAction(null);
                setLoading(false);
              }}
            >
              <Text style={styles.lateSubmitButtonText}>Submit Reason</Text>
            </TouchableOpacity>

            {/* Cancel — reason-first flow only: dismissing aborts the check-in
                entirely (no record is created, since we gated before creating). */}
            {pendingLateAction && (
              <TouchableOpacity
                style={styles.lateCancelButton}
                onPress={() => {
                  setShowLateReasonModal(false);
                  setLateReasonText('');
                  setPendingLateAttendanceId(null);
                  setPendingLateAction(null);
                  showToastMessage('Check-in cancelled — enter a reason to check in');
                }}
              >
                <Text style={styles.lateCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Field-attendance bottom sheets used to live here (EditPrimaryTripSheet
          + AddTripLineSheet). They were removed when the inline flow was
          migrated to <FieldAttendanceSection/>. That component mounts its
          own sheets internally, driven by the new server state machine. */}
      <TripDetailSheet
        visible={tripSheetOpen}
        trip={tripSheetTrip}
        loading={tripSheetLoading}
        onClose={() => setTripSheetOpen(false)}
        onOpenInVehicleTracking={(trip) => {
          // Snapshot which sheet was open underneath so we can restore it on
          // focus return, then close everything and navigate to the form.
          // Flatten m2o pairs so VehicleTrackingForm finds the data in the
          // shape its state initializer expects (vehicle_name / source_name /
          // primitive *_id, etc).
          const parentSheet = editPrimaryOpen ? 'edit' : (addLineOpen ? 'add' : null);
          const target = trip || tripSheetTrip;
          const formattedTrip = flattenTripForForm(target);
          setPendingTripDetailReopen({
            tripId: target?.id || null,
            parentSheet,
          });
          setTripSheetOpen(false);
          setEditPrimaryOpen(false);
          setAddLineOpen(false);
          navigation.navigate('VehicleTrackingForm', {
            tripData: formattedTrip,
            returnTo: 'fieldAttendance',
          });
        }}
      />
      <VisitsListSheet
        visible={visitsSheetOpen}
        visits={visitsSheetRows}
        loading={visitsSheetLoading}
        onClose={() => setVisitsSheetOpen(false)}
        onVisitPress={(v) => handleFieldOpenVisitDetail(v, {
          visitsListIds: (visitsSheetRows || []).map((r) => r.id),
        })}
        onOpenInVisits={(visitsSheetRows || []).length > 0
          ? () => handleFieldOpenVisitDetail(visitsSheetRows[0], {
              visitsListIds: visitsSheetRows.map((r) => r.id),
            })
          : undefined}
      />

      {/* End-KM prompt — shown before field check-out when the day's last trip
          is still open. Reuses ClosePreviousTripSheet's styling (yellow
          banner, "> startKm" placeholder, blocking validation so end_km
          must be > start_km). On Save we close the trip with the entered KM
          and bulk-mark every linked visit done, then continue to
          camera+checkout. */}
      <ClosePreviousTripSheet
        visible={endKmPrompt.visible}
        previousTripRef={endKmPrompt.tripRef}
        previousStartKm={endKmPrompt.startKm}
        saving={endKmPrompt.saving}
        title={`End KM for ${endKmPrompt.tripRef || `Trip #${endKmPrompt.tripId || ''}`}`}
        disclaimer={"Enter the trip's end odometer reading. We'll close the trip with this value and mark its visits done before checking you out."}
        saveLabel="Save & Checkout"
        onSave={submitEndKmAndCheckout}
        onClose={() => {
          if (!endKmPrompt.saving) {
            console.log('[UA-CHECKOUT] End KM prompt closed by user');
            setEndKmPrompt({ visible: false, tripId: null, tripRef: '', startKm: 0, saving: false });
          }
        }}
      />

      {/* Styled alert modal — matches the logout popup design */}
      <StyledAlertModal
        isVisible={alertModal.visible}
        message={alertModal.message}
        confirmText={alertModal.confirmText}
        cancelText={alertModal.cancelText}
        destructive={alertModal.destructive}
        onConfirm={() => {
          const cb = alertModal.onConfirm;
          if (cb) cb(); else hideAlert();
        }}
        onCancel={() => {
          const cb = alertModal.onCancel;
          if (cb) cb(); else hideAlert();
        }}
      />

      {/* End-KM prompt before Add Additional Trip — captures the previous
          trip's odometer reading, then auto-ends + opens AddTripLine. */}
      <Modal
        visible={endKmPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEndKmPromptVisible(false)}
      >
        <View style={styles.endKmOverlay}>
          <View style={styles.endKmSheet}>
            <Text style={styles.endKmTitle}>End KM — Trip {endKmPromptTripRef}</Text>
            <Text style={styles.endKmHint}>
              Enter the end odometer reading for the previous trip before adding a new one.
            </Text>
            <TextInput
              value={endKmPromptValue}
              onChangeText={setEndKmPromptValue}
              keyboardType="numeric"
              placeholder="e.g. 45230"
              placeholderTextColor="#999"
              style={styles.endKmInput}
              autoFocus
            />
            <View style={styles.endKmButtonRow}>
              <TouchableOpacity
                style={[styles.endKmBtn, styles.endKmBtnSecondary]}
                onPress={() => setEndKmPromptVisible(false)}
              >
                <Text style={styles.endKmBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.endKmBtn,
                  styles.endKmBtnPrimary,
                  !endKmPromptValue && { opacity: 0.5 },
                ]}
                disabled={!endKmPromptValue}
                onPress={() => submitEndKmAndAddLine(endKmPromptValue)}
              >
                <Text style={styles.endKmBtnPrimaryText}>Save & Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  endKmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16,
  },
  endKmSheet: {
    width: '100%', maxWidth: 420, backgroundColor: '#fff',
    borderRadius: 14, padding: 18,
  },
  endKmTitle: { fontSize: 16, fontWeight: '700', color: '#222', marginBottom: 6 },
  endKmHint: { fontSize: 12, color: '#666', marginBottom: 12 },
  endKmInput: {
    borderWidth: 1, borderColor: '#CCC', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#222',
    marginBottom: 14,
  },
  endKmButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  endKmBtn: { borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  endKmBtnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#BDBDBD' },
  endKmBtnSecondaryText: { color: '#444', fontSize: 13, fontWeight: '700' },
  endKmBtnPrimary: { backgroundColor: '#1976D2' },
  endKmBtnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF3CD',
    borderBottomWidth: 1,
    borderBottomColor: '#FFE69C',
    paddingHorizontal: scale(12),
    paddingVertical: scale(8),
    gap: scale(8),
  },
  offlineBannerText: {
    flex: 1,
    fontSize: scale(11),
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#7a4f00',
  },
  content: { flex: 1, padding: scale(12) },
  headerCard: { backgroundColor: COLORS.white, borderRadius: scale(16), padding: scale(14), marginBottom: scale(10), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  headerTop: { marginBottom: scale(10) },
  dateSection: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: scale(32), height: scale(32), borderRadius: scale(16), backgroundColor: COLORS.primaryThemeColor, justifyContent: 'center', alignItems: 'center', marginRight: scale(10) },
  dateTextContainer: { flex: 1 },
  dateLabel: { fontSize: scale(11), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: 1 },
  dateValue: { fontSize: scale(14), fontWeight: '600', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold },
  timeSection: { alignItems: 'center', paddingTop: scale(10), borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  timeIconContainer: { marginBottom: scale(4) },
  timeValue: { fontSize: scale(30), fontWeight: 'bold', color: COLORS.primaryThemeColor, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 2 },
  timeLabel: { fontSize: scale(10), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 2, textTransform: 'uppercase', letterSpacing: 1 },

  // Mode Selection
  modeSelectionContainer: { marginBottom: scale(10) },
  modeTitle: { fontSize: scale(18), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 2 },
  modeSubtitle: { fontSize: scale(13), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: scale(12) },
  modeCard: { backgroundColor: COLORS.white, borderRadius: scale(14), padding: scale(14), flexDirection: 'row', alignItems: 'center', marginBottom: scale(8), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  modeIconContainer: { width: scale(46), height: scale(46), borderRadius: scale(12), justifyContent: 'center', alignItems: 'center', marginRight: scale(12) },
  modeTextContainer: { flex: 1 },
  modeCardTitle: { fontSize: scale(16), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 2 },
  modeCardSubtitle: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium },
  manualLink: { flexDirection: 'row', alignItems: 'center', marginTop: scale(6), alignSelf: 'flex-start' },
  manualLinkText: { marginLeft: 4, fontSize: scale(12), fontFamily: FONT_FAMILY.urbanistBold, color: COLORS.primaryThemeColor, textDecorationLine: 'underline' },

  // Fingerprint
  pinSection: { backgroundColor: COLORS.white, padding: scale(16), borderRadius: scale(16), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  pinHeader: { alignItems: 'center', marginBottom: scale(8) },
  pinTitle: { fontSize: scale(16), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 2 },
  pinSubtitle: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium },
  fingerprintButton: { width: scale(90), height: scale(90), borderRadius: scale(45), backgroundColor: '#F0F4FF', justifyContent: 'center', alignItems: 'center', marginBottom: scale(10), borderWidth: 2, borderColor: COLORS.primaryThemeColor, borderStyle: 'dashed' },
  deviceIdContainer: { backgroundColor: '#F8F9FA', borderRadius: scale(10), padding: scale(10), flexDirection: 'row', alignItems: 'center', marginTop: scale(10) },
  deviceIdLabel: { fontSize: scale(11), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginRight: 6 },
  deviceIdValue: { fontSize: scale(11), color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, flex: 1 },

  // OR Divider
  orDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: scale(10) },
  orLine: { flex: 1, height: 1, backgroundColor: '#E0E0E0' },
  orText: { fontSize: scale(12), fontWeight: 'bold', color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistBold, marginHorizontal: scale(12) },

  // PIN Input
  pinInputSection: { marginBottom: scale(4) },
  pinInputHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: scale(8) },
  pinInputTitle: { fontSize: scale(14), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: scale(8) },
  pinInputField: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(12), fontSize: scale(16), fontFamily: FONT_FAMILY.urbanistMedium, color: COLORS.black, backgroundColor: '#FAFAFA', textAlign: 'center', letterSpacing: 6, marginBottom: scale(10) },
  pinVerifyButton: { borderRadius: scale(10), padding: scale(12), flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pinVerifyText: { fontSize: scale(14), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: scale(6) },

  // Details
  detailsSection: { flex: 1 },
  greetingCard: { backgroundColor: COLORS.white, borderRadius: scale(16), padding: scale(14), flexDirection: 'row', alignItems: 'center', marginBottom: scale(10), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  avatarContainer: { position: 'relative', marginRight: scale(12) },
  avatar: { width: scale(44), height: scale(44), borderRadius: scale(22), backgroundColor: COLORS.primaryThemeColor, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: scale(20), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold },
  statusDot: { position: 'absolute', bottom: 1, right: 1, width: scale(12), height: scale(12), borderRadius: scale(6), backgroundColor: '#4CAF50', borderWidth: 2, borderColor: COLORS.white },
  greetingTextContainer: { flex: 1 },
  greetingText: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: 1 },
  userNameText: { fontSize: scale(16), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold },

  // WFH Badge
  wfhBadge: { backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: scale(10), paddingVertical: 4 },
  wfhBadgeText: { fontSize: scale(12), fontWeight: 'bold', color: '#2196F3', fontFamily: FONT_FAMILY.urbanistBold },

  // Status Cards
  // Cross-mode guard banner — centered yellow card with red font.
  crossModeWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: scale(40), paddingHorizontal: scale(16) },
  crossModeBanner: { width: '100%', alignItems: 'center', backgroundColor: '#FFF8E1', borderRadius: scale(14), borderWidth: 1, borderColor: '#FFE082', paddingVertical: scale(28), paddingHorizontal: scale(20), gap: scale(14) },
  crossModeText: { color: '#C62828', fontFamily: FONT_FAMILY.urbanistBold, fontSize: scale(15), textAlign: 'center', lineHeight: scale(22) },
  crossModeBtn: { flexDirection: 'row', alignItems: 'center', gap: scale(6), backgroundColor: '#C62828', borderRadius: scale(10), paddingVertical: scale(10), paddingHorizontal: scale(20) },
  crossModeBtnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: scale(13) },
  officeLoadingText: { marginTop: scale(12), fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', textAlign: 'center' },
  statusCardsContainer: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: scale(10) },
  statusCard: { flex: 1, backgroundColor: COLORS.white, borderRadius: scale(12), padding: scale(10), alignItems: 'center', marginHorizontal: scale(4), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  statusCardActive: { borderWidth: 1, borderColor: '#E8E8E8' },
  statusCardInactive: { borderWidth: 1, borderColor: '#F0F0F0' },
  statusIconContainer: { width: scale(36), height: scale(36), borderRadius: scale(18), justifyContent: 'center', alignItems: 'center', marginBottom: scale(6) },
  statusCardLabel: { fontSize: scale(10), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: 2 },
  statusCardValue: { fontSize: scale(12), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold },

  // Time & Location
  currentTimeCard: { backgroundColor: '#F0F4FF', borderRadius: scale(10), padding: scale(10), flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: scale(12) },
  currentTimeLabel: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginLeft: 6 },
  currentTimeValue: { fontSize: scale(14), fontWeight: 'bold', color: COLORS.primaryThemeColor, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 4 },
  locationStatusCard: { borderRadius: scale(10), padding: scale(10), flexDirection: 'row', alignItems: 'center', marginBottom: scale(8) },
  locationVerified: { backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#C8E6C9' },
  locationNotVerified: { backgroundColor: '#FFEBEE', borderWidth: 1, borderColor: '#FFCDD2' },
  locationIconContainer: { width: scale(34), height: scale(34), borderRadius: scale(17), backgroundColor: COLORS.white, justifyContent: 'center', alignItems: 'center', marginRight: scale(10) },
  locationTextContainer: { flex: 1 },
  locationStatusTitle: { fontSize: scale(12), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold },
  locationStatusSubtitle: { fontSize: scale(11), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 1 },

  // Action Buttons
  buttonContainer: { marginTop: 2 },
  checkInButton: { backgroundColor: '#4CAF50', borderRadius: scale(14), padding: scale(14), flexDirection: 'row', alignItems: 'center', shadowColor: '#4CAF50', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3 },
  checkInButtonDisabled: { backgroundColor: '#A5D6A7', shadowOpacity: 0, elevation: 0 },
  fieldVisitCard: { backgroundColor: '#fff', borderRadius: scale(12), padding: scale(12), marginBottom: scale(10), borderWidth: 1, borderColor: '#E0E0E0' },
  fieldVisitToggleRow: { flexDirection: 'row', alignItems: 'center' },
  fieldVisitToggleLabel: { fontSize: scale(13), color: COLORS.darkText || '#333', fontFamily: FONT_FAMILY.urbanistMedium, marginLeft: scale(8) },
  fieldVisitPickerRow: { flexDirection: 'row', alignItems: 'center', marginTop: scale(10), paddingHorizontal: scale(10), paddingVertical: scale(10), backgroundColor: '#F5F5F5', borderRadius: scale(8) },
  fieldVisitPickerText: { flex: 1, fontSize: scale(13), color: COLORS.darkText || '#333', fontFamily: FONT_FAMILY.urbanistMedium, marginLeft: scale(8) },
  fieldVisitPickerPlaceholder: { color: '#999' },
  activeVisitBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryThemeColor || '#5C2D91', paddingVertical: scale(8), paddingHorizontal: scale(12), borderRadius: scale(8), marginBottom: scale(8) },
  activeVisitBannerText: { flex: 1, color: '#fff', fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistBold, marginLeft: scale(8) },
  checkOutButton: { backgroundColor: '#F44336', borderRadius: scale(14), padding: scale(14), flexDirection: 'row', alignItems: 'center', shadowColor: '#F44336', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3 },
  buttonIconContainer: { width: scale(40), height: scale(40), borderRadius: scale(20), backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: scale(12) },
  buttonTextContainer: { flex: 1 },
  buttonTitle: { fontSize: scale(15), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 1 },
  buttonSubtitle: { fontSize: scale(11), color: 'rgba(255,255,255,0.8)', fontFamily: FONT_FAMILY.urbanistMedium },
  completedContainer: { backgroundColor: COLORS.white, padding: scale(20), borderRadius: scale(16), alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  completedIconContainer: { marginBottom: scale(8) },
  completedTitle: { fontSize: scale(18), fontWeight: 'bold', color: '#4CAF50', fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 2 },
  completedText: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, textAlign: 'center' },

  // WFH Form
  wfhFormCard: { backgroundColor: COLORS.white, borderRadius: scale(16), padding: scale(14), marginBottom: scale(10), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  wfhFormTitle: { fontSize: scale(16), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 2 },
  wfhFormSubtitle: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: scale(12) },
  wfhDateRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F4FF', borderRadius: scale(8), padding: scale(10), marginBottom: scale(12) },
  wfhDateText: { fontSize: scale(13), color: COLORS.black, fontFamily: FONT_FAMILY.urbanistMedium, marginLeft: 6 },
  wfhInputLabel: { fontSize: scale(12), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: 6 },
  wfhReasonInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(12), fontSize: scale(13), fontFamily: FONT_FAMILY.urbanistMedium, color: COLORS.black, minHeight: scale(80), marginBottom: scale(12), backgroundColor: '#FAFAFA' },
  wfhSubmitButton: { backgroundColor: '#2196F3', borderRadius: scale(10), padding: scale(12), flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  wfhSubmitText: { fontSize: scale(14), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold, marginLeft: 6 },

  // WFH History
  wfhHistoryCard: { backgroundColor: COLORS.white, borderRadius: scale(16), padding: scale(14), marginBottom: scale(10), shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  wfhHistoryTitle: { fontSize: scale(14), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: scale(8) },
  wfhHistoryItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: scale(8), borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  wfhHistoryLeft: { flex: 1, marginRight: scale(10) },
  wfhHistoryDate: { fontSize: scale(12), fontWeight: 'bold', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold },
  wfhHistoryReason: { fontSize: scale(11), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 1 },
  wfhStatusBadge: { borderRadius: 6, paddingHorizontal: scale(8), paddingVertical: 3 },
  wfhStatusText: { fontSize: scale(10), fontWeight: 'bold', fontFamily: FONT_FAMILY.urbanistBold },

  // Camera
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'space-between' },
  cameraHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: scale(16), paddingTop: scale(50), paddingBottom: scale(16) },
  cameraCloseButton: { width: scale(40), height: scale(40), borderRadius: scale(20), backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  cameraTitle: { fontSize: scale(18), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold },
  faceGuideContainer: { alignItems: 'center', justifyContent: 'center' },
  faceGuide: { width: width * 0.52, height: width * 0.52, borderRadius: width * 0.26, borderWidth: 3, borderColor: 'rgba(255,255,255,0.5)', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', marginBottom: scale(16) },
  faceGuideText: { fontSize: scale(16), color: COLORS.white, fontFamily: FONT_FAMILY.urbanistMedium },
  countdownContainer: { alignItems: 'center', paddingBottom: scale(80) },
  countdownNumber: { fontSize: scale(64), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold },
  countdownText: { fontSize: scale(16), color: COLORS.white, fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 8 },

  // Late Reason Modal
  lateModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: scale(20) },
  lateModalContainer: { backgroundColor: COLORS.white, borderRadius: scale(16), padding: scale(20), width: '100%', maxWidth: 400, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  lateModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: scale(8) },
  lateModalTitle: { fontSize: scale(20), fontWeight: 'bold', color: '#E74C3C', fontFamily: FONT_FAMILY.urbanistBold, marginLeft: scale(8) },
  lateModalSubtitle: { fontSize: scale(14), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, textAlign: 'center', marginBottom: scale(6) },
  lateModalDetail: { fontSize: scale(12), color: COLORS.gray, fontFamily: FONT_FAMILY.urbanistMedium, textAlign: 'center', marginBottom: scale(8) },
  lateDeductionText: { fontSize: scale(13), color: '#E74C3C', fontFamily: FONT_FAMILY.urbanistBold, textAlign: 'center', marginBottom: scale(10), backgroundColor: '#FDE8E8', paddingVertical: scale(6), paddingHorizontal: scale(12), borderRadius: scale(8) },
  lateReasonLabel: { fontSize: scale(13), fontWeight: '600', color: COLORS.black, fontFamily: FONT_FAMILY.urbanistBold, marginBottom: scale(6), marginTop: scale(4) },
  lateReasonInput: { borderWidth: 1, borderColor: '#E0E0E0', borderRadius: scale(10), padding: scale(12), fontSize: scale(14), fontFamily: FONT_FAMILY.urbanistMedium, color: COLORS.black, backgroundColor: '#FAFAFA', minHeight: scale(80), marginBottom: scale(14) },
  lateSubmitButton: { backgroundColor: COLORS.primaryThemeColor, borderRadius: scale(10), padding: scale(14), alignItems: 'center' },
  lateSubmitButtonDisabled: { backgroundColor: '#CCC' },
  lateSubmitButtonText: { fontSize: scale(15), fontWeight: 'bold', color: COLORS.white, fontFamily: FONT_FAMILY.urbanistBold },
  lateCancelButton: { marginTop: scale(10), borderRadius: scale(10), padding: scale(12), alignItems: 'center', borderWidth: 1, borderColor: '#CCC' },
  lateCancelButtonText: { fontSize: scale(14), color: '#666', fontFamily: FONT_FAMILY.urbanistSemiBold },
});

export default UserAttendanceScreen;
