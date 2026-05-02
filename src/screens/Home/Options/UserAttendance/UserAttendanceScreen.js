import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyledAlertModal } from '@components/Modal';
import { View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, Dimensions, Modal, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { RoundedScrollContainer } from '@components/containers';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { OverlayLoader } from '@components/Loader';
import { showToastMessage } from '@components/Toast';
import { useAuthStore } from '@stores/auth';
import { checkInByEmployeeId, checkOutToOdoo, getTodayAttendanceByEmployeeId, getEmployeeByDeviceId, verifyEmployeePin, verifyAttendanceLocation, uploadAttendancePhoto, submitWfhRequest, getTodayApprovedWfh, wfhCheckIn, wfhCheckOut, getMyWfhRequests, getLateConfig, getCachedLateConfig, submitLateReason, getTodayAttendanceWithLateInfo, submitLeaveRequest, getMyLeaveRequests, cancelLeaveRequest, getEligibleLateAttendances, submitWaiverRequest, getMyWaiverRequests, getWorkplaceLocation, prewarmLocation, fetchAndCacheLateSlabs, computeLocalDeductionAmount, createCustomerVisit, closeCustomerVisit } from '@services/AttendanceService';
import { computeLocalLateInfo, floatToHM } from '@utils/lateLogic';
import * as offlineQueue from '@utils/offlineQueue';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { MaterialIcons, Feather, Ionicons } from '@expo/vector-icons';
import { Camera } from 'expo-camera';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Application from 'expo-application';
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

const UserAttendanceScreen = ({ navigation }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [loading, setLoading] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [todayAttendance, setTodayAttendance] = useState(null);
  const [verifiedEmployee, setVerifiedEmployee] = useState(null);
  const [locationStatus, setLocationStatus] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [verificationMethod, setVerificationMethod] = useState(null); // 'fingerprint' | 'pin'
  const currentUser = useAuthStore(state => state.user);

  // Mode selection: null = choosing, 'office' = office attendance, 'wfh' = work from home
  const [attendanceMode, setAttendanceMode] = useState(null);

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
        let id;
        if (Platform.OS === 'android') {
          id = Application.getAndroidId();
        } else {
          id = await Application.getIosIdForVendorAsync();
        }
        console.log('[Attendance] Device ID:', id);
        setDeviceId(id);
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

      // Proceed with check-in or check-out
      if (cameraType === 'check_in') {
        if (attendanceMode === 'wfh') {
          await processWfhCheckIn(photo.base64);
        } else {
          await processCheckIn(photo.base64);
        }
      } else {
        if (attendanceMode === 'wfh') {
          await processWfhCheckOut(photo.base64);
        } else {
          await processCheckOut(photo.base64);
        }
      }
    } catch (error) {
      console.error('Photo capture error:', error);
      showToastMessage('Failed to capture photo');
      closeCamera();
      setLoading(false);
    }
  };

  const loadTodayAttendanceForEmployee = async (employeeId, employeeName) => {
    try {
      const attendance = await getTodayAttendanceByEmployeeId(employeeId, employeeName);
      setTodayAttendance(attendance);
    } catch (error) {
      console.error('Failed to load attendance:', error);
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
              attendanceId = rec.id;
              sessionLabel = rec.checkinSession;
              expectedStartDisplay = rec.expectedStartTime != null
                ? floatToHM(rec.expectedStartTime)
                : undefined;
            }
          }
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

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatTimeOnly = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
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
      const result = await getEmployeeByDeviceId(deviceId);

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
      const result = await verifyEmployeePin(userId, pinInput.trim());

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

      const result = await checkInByEmployeeId(verifiedEmployee.id, verifiedEmployee.name);
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

          if (info.isLate) {
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
            if (justCreated && justCreated.isLate) {
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
            }
          }
        } catch (lateErr) {
          console.log('[Attendance] Late check skipped:', lateErr?.message);
        }
      } else {
        showAlert({ message: result.error || 'Check-in failed' });
      }
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

        const displayTime = now.toLocaleTimeString('en-US', {
          hour: '2-digit', minute: '2-digit', hour12: true,
        });

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
        setTodayAttendance((prev) => prev ? { ...prev, checkOut: result.checkOutTime } : prev);
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
  // RENDER: OFFICE SECTION (existing flow)
  // =============================================
  const renderOfficeSection = () => (
    <View style={styles.detailsSection}>
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
            {todayAttendance?.checkIn || '--:--'}
          </Text>
        </View>

        <View style={[styles.statusCard, todayAttendance?.checkOut ? styles.statusCardActive : styles.statusCardInactive]}>
          <View style={[styles.statusIconContainer, { backgroundColor: todayAttendance?.checkOut ? '#FFEBEE' : '#F5F5F5' }]}>
            <MaterialIcons name="logout" size={scale(20)} color={todayAttendance?.checkOut ? '#F44336' : COLORS.gray} />
          </View>
          <Text style={styles.statusCardLabel}>Check Out</Text>
          <Text style={[styles.statusCardValue, todayAttendance?.checkOut && { color: '#F44336' }]}>
            {todayAttendance?.checkOut || '--:--'}
          </Text>
        </View>
      </View>

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

      {/* Field Visit toggle + customer picker — only show before check-in */}
      {!hasCheckedIn && !hasCheckedOut && (
        <View style={styles.fieldVisitCard}>
          <TouchableOpacity
            style={styles.fieldVisitToggleRow}
            activeOpacity={0.7}
            onPress={() => {
              const next = !fieldVisitMode;
              setFieldVisitMode(next);
              if (!next) setVisitCustomer(null);
            }}
          >
            <MaterialIcons
              name={fieldVisitMode ? 'check-box' : 'check-box-outline-blank'}
              size={scale(22)}
              color={fieldVisitMode ? COLORS.primaryThemeColor : '#999'}
            />
            <Text style={styles.fieldVisitToggleLabel}>Customer Visit (skip office GPS)</Text>
          </TouchableOpacity>

          {fieldVisitMode && (
            <TouchableOpacity
              style={styles.fieldVisitPickerRow}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('CustomerScreen', {
                selectMode: true,
                onSelect: (selected) => setVisitCustomer(selected),
              })}
            >
              <MaterialIcons name="person" size={scale(20)} color="#666" />
              <Text style={[
                styles.fieldVisitPickerText,
                !visitCustomer?.name && styles.fieldVisitPickerPlaceholder,
              ]}>
                {visitCustomer?.name || 'Select customer'}
              </Text>
              <MaterialIcons name="chevron-right" size={scale(20)} color="#999" />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Action Buttons */}
      <View style={styles.buttonContainer}>
        {!hasCheckedIn && !hasCheckedOut && (
          <TouchableOpacity
            style={[
              styles.checkInButton,
              fieldVisitMode && !visitCustomer && styles.checkInButtonDisabled,
            ]}
            onPress={() => {
              if (fieldVisitMode && !visitCustomer) {
                showToastMessage('Please select a customer first');
                return;
              }
              handleCheckIn();
            }}
            disabled={loading || (fieldVisitMode && !visitCustomer)}
            activeOpacity={0.8}
          >
            <View style={styles.buttonIconContainer}>
              <MaterialIcons name="fingerprint" size={scale(22)} color={COLORS.white} />
            </View>
            <View style={styles.buttonTextContainer}>
              <Text style={styles.buttonTitle}>{fieldVisitMode ? 'Start Visit' : 'Check In'}</Text>
              <Text style={styles.buttonSubtitle}>
                {fieldVisitMode
                  ? (visitCustomer ? `For ${visitCustomer.name}` : 'Select customer first')
                  : 'Tap to mark your arrival'}
              </Text>
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
    </View>
  );

  // =============================================
  // MAIN RENDER
  // =============================================
  return (
    <SafeAreaView style={styles.container}>
      <NavigationHeader
        title={attendanceMode === 'wfh' ? 'Work From Home' : attendanceMode === 'office' ? 'Office Attendance' : attendanceMode === 'leave' ? 'Leave Request' : attendanceMode === 'waiver' ? 'Late Waiver Request' : 'Attendance'}
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
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
                  <MaterialIcons name="fingerprint" size={scale(56)} color={attendanceMode === 'wfh' ? '#2196F3' : attendanceMode === 'leave' ? '#FF9800' : COLORS.primaryThemeColor} />
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
                  <MaterialIcons name="dialpad" size={scale(20)} color={attendanceMode === 'wfh' ? '#2196F3' : attendanceMode === 'leave' ? '#FF9800' : COLORS.primaryThemeColor} />
                  <Text style={styles.pinInputTitle}>Enter PIN</Text>
                </View>
                <TextInput
                  style={styles.pinInputField}
                  placeholder="Enter your PIN"
                  placeholderTextColor={COLORS.gray}
                  value={pinInput}
                  onChangeText={setPinInput}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={10}
                />
                <TouchableOpacity
                  style={[styles.pinVerifyButton, { backgroundColor: attendanceMode === 'wfh' ? '#2196F3' : COLORS.primaryThemeColor }]}
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
                  <Text style={styles.deviceIdLabel}>Device ID:</Text>
                  <Text style={styles.deviceIdValue} numberOfLines={1}>{deviceId}</Text>
                </View>
              )}
            </View>
          )}

          {/* Verified Content */}
          {attendanceMode === 'office' && isVerified && renderOfficeSection()}
          {attendanceMode === 'wfh' && isVerified && renderWfhSection()}
          {attendanceMode === 'leave' && isVerified && renderLeaveSection()}
          {attendanceMode === 'waiver' && isVerified && renderWaiverSection()}
        </RoundedScrollContainer>
      </KeyboardAvoidingView>

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
                  {cameraType === 'check_in' ? 'Check In Photo' : 'Check Out Photo'}
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
                console.log('[late-submit] reason="' + reason + '" pendingId=' + pendingLateAttendanceId);
                if (!reason) {
                  console.log('[late-submit] BLOCKED: reason is empty');
                  return;
                }
                if (!pendingLateAttendanceId) {
                  console.log('[late-submit] BLOCKED: no pending attendance id (offline create may have failed to return localId)');
                  showToastMessage('Cannot save reason — try again after sync');
                  setShowLateReasonModal(false);
                  setLateReasonText('');
                  return;
                }
                setLoading(true);
                try {
                  const idStr = String(pendingLateAttendanceId);
                  if (idStr.startsWith('offline:')) {
                    const localId = idStr.split(':')[1];
                    console.log('[late-submit] OFFLINE path — localId=' + localId);

                    // Verify the queue item exists before updating
                    const before = await offlineQueue.getAll();
                    const target = before.find(q => q.id === localId);
                    console.log('[late-submit] queue item BEFORE update:', target ? JSON.stringify(target.values) : 'MISSING');

                    await offlineQueue.updateValues(localId, { late_reason: reason });

                    const after = await offlineQueue.getAll();
                    const updated = after.find(q => q.id === localId);
                    console.log('[late-submit] queue item AFTER update:', updated ? JSON.stringify(updated.values) : 'MISSING (item gone — already synced?)');

                    if (updated && updated.values?.late_reason === reason) {
                      showToastMessage('Late reason saved offline');
                    } else if (!updated) {
                      // Queue item was already synced before user typed. Fall
                      // back to writing the reason via the online path using
                      // an offline_id_map lookup. For now just inform user.
                      showToastMessage('Reason will sync on next online write');
                    } else {
                      showToastMessage('Saved (but value mismatch — check logs)');
                    }
                  } else {
                    console.log('[late-submit] ONLINE path — id=' + idStr);
                    await submitLateReason(pendingLateAttendanceId, reason);
                    showToastMessage('Late reason submitted');
                  }
                } catch (err) {
                  console.log('[late-submit] error:', err?.message, err?.stack);
                }
                setShowLateReasonModal(false);
                setLateReasonText('');
                setPendingLateAttendanceId(null);
                setLoading(false);
              }}
            >
              <Text style={styles.lateSubmitButtonText}>Submit Reason</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
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
});

export default UserAttendanceScreen;
