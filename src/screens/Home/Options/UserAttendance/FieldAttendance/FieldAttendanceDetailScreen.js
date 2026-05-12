import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { StyledAlertModal } from '@components/Modal';
import { showToastMessage } from '@components/Toast';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import {
  readFieldAttendanceDetailOdoo,
  readFieldTripLinesOdoo,
  searchAvailableTripsOdoo,
  searchDraftCustomerVisitsOdoo,
  readVehicleTrackingForTripIdsOdoo,
  readCustomerVisitsByIdsOdoo,
  updateFieldAttendancePrimaryTripOdoo,
  createFieldTripLineOdoo,
  deleteFieldTripLineOdoo,
  endVehicleTripFromAttendanceOdoo,
} from '@api/services/generalApi';
import PrimaryTripCard from '@screens/Home/Options/UserAttendance/FieldAttendance/components/PrimaryTripCard';
import TripLineCard from '@screens/Home/Options/UserAttendance/FieldAttendance/components/TripLineCard';
import TripTotalsSection from '@screens/Home/Options/UserAttendance/FieldAttendance/components/TripTotalsSection';
import EditPrimaryTripSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/EditPrimaryTripSheet';
import AddTripLineSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/AddTripLineSheet';
import TripDetailSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripDetailSheet';
import VisitsListSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitsListSheet';

const FIELD_COLOR = '#1976D2';

const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const fmtDateOnly = (s) => {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

// Flatten raw vehicle.tracking m2o pairs + set legacy lowercase keys so
// VehicleTrackingForm's state-conditional destructure picks up the values
// regardless of trip status (draft vs in_progress). Checklist booleans + photo
// + notes pass through unchanged via `...trip`.
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
    vehicle_id: veh.id,
    vehicle_name: veh.name,
    vehicle: veh.name,
    driver_id: drv.id,
    driver_name: drv.name,
    driver: drv.name,
    source_id: src.id,
    source_name: src.name,
    source: src.name,
    destination_id: dst.id,
    destination_name: dst.name,
    destination: dst.name,
    purpose_of_visit_id: purp.id,
    purpose_of_visit_name: purp.name,
    purpose_of_visit: purp.name,
    plateNumber: trip.number_plate || '',
    startKM: trip.start_km != null ? String(trip.start_km) : '',
    endKM: trip.end_km != null ? String(trip.end_km) : '',
    estimatedTime: trip.estimated_time != null ? String(trip.estimated_time) : '',
    // Pre-trip checklist — nested camelCase object the form expects.
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

const FieldAttendanceDetailScreen = ({ navigation, route }) => {
  const attendanceId = Number(route?.params?.attendanceId);

  const [attendance, setAttendance] = useState(null);
  const [tripLines, setTripLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit Primary Trip sheet
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  // Add Additional Trip sheet
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  // Trip picker auto-reopen handshake (return from VehicleTrackingForm)
  const [editAutoOpenPicker, setEditAutoOpenPicker] = useState(false);
  const [addAutoOpenPicker, setAddAutoOpenPicker] = useState(false);
  const [newTripIdToHighlight, setNewTripIdToHighlight] = useState(null);
  const [awaitingTripCreation, setAwaitingTripCreation] = useState(null); // 'primary' | 'additional' | null

  // Trip Detail sheet
  const [tripSheetOpen, setTripSheetOpen] = useState(false);
  const [tripSheetTrip, setTripSheetTrip] = useState(null);
  const [tripSheetLoading, setTripSheetLoading] = useState(false);

  // Visits List sheet
  const [visitsSheetOpen, setVisitsSheetOpen] = useState(false);
  const [visitsSheetRows, setVisitsSheetRows] = useState([]);
  const [visitsSheetLoading, setVisitsSheetLoading] = useState(false);

  // Confirmation alert
  const [alertModal, setAlertModal] = useState({
    visible: false, message: '', confirmText: 'OK', cancelText: '',
    destructive: false, onConfirm: null, onCancel: null,
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
      onCancel: opts?.onCancel || null,
    });
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!attendanceId) return;
    if (!silent) setLoading(true);
    try {
      const att = await readFieldAttendanceDetailOdoo(attendanceId);
      setAttendance(att);
      const ids = Array.isArray(att?.trip_line_ids) ? att.trip_line_ids : [];
      if (ids.length > 0) {
        const lines = await readFieldTripLinesOdoo(ids);
        // Sort by sequence/id like the model's _order
        lines.sort((a, b) => (a.sequence - b.sequence) || (a.id - b.id));
        setTripLines(lines);
      } else {
        setTripLines([]);
      }
    } catch (e) {
      console.error('[FieldAttendanceDetail] refresh error:', e?.message);
      showToastMessage('Failed to load attendance');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [attendanceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when returning from Vehicle Tracking / Visits screens.
  useFocusEffect(
    useCallback(() => {
      if (attendanceId) refresh({ silent: true });
    }, [attendanceId, refresh])
  );

  // Launch VehicleTrackingForm to create a new trip, remembering which trip
  // sheet (primary vs additional) the user was on. The focus effect below
  // re-opens that sheet + its picker when the user comes back.
  const handleCreateNewTripFrom = useCallback((fromSheet) => {
    setAwaitingTripCreation(fromSheet);
    if (fromSheet === 'primary') setEditOpen(false);
    if (fromSheet === 'additional') setAddOpen(false);
    navigation.navigate('VehicleTrackingForm', {
      returnTo: 'fieldAttendance',
      fromSheet,
    });
  }, [navigation]);

  // Primary handshake — driven by route params VehicleTrackingForm pushes on
  // Save / Start Trip / End Trip. Idempotent via lastHandledRefreshKey, so
  // any number of intermediate re-renders or silent refreshes cannot replay it.
  const lastHandledRefreshKey = useRef(null);
  useEffect(() => {
    const rk = route?.params?.refreshKey;
    const fromSheet = route?.params?.fromSheet;
    const newTripId = route?.params?.newTripId;
    if (!rk || !fromSheet) return;
    if (lastHandledRefreshKey.current === rk) return;
    lastHandledRefreshKey.current = rk;

    setNewTripIdToHighlight(newTripId ? Number(newTripId) : null);
    if (fromSheet === 'primary') {
      setEditOpen(true);
      setEditAutoOpenPicker(true);
    } else if (fromSheet === 'additional') {
      setAddOpen(true);
      setAddAutoOpenPicker(true);
    }
    setAwaitingTripCreation(null);
    navigation.setParams({ newTripId: undefined, fromSheet: undefined, refreshKey: undefined });
  }, [route?.params?.refreshKey, route?.params?.fromSheet, route?.params?.newTripId, navigation]);

  // Fallback — user opened VTF via "Create New Trip" but came back without
  // saving (no refreshKey from VTF). Reopen the source sheet without highlight.
  useFocusEffect(
    useCallback(() => {
      if (!awaitingTripCreation) return;
      // Route-param path owns successful saves — defer to it.
      if (route?.params?.refreshKey && route?.params?.fromSheet) return;
      const fromSheet = awaitingTripCreation;
      setNewTripIdToHighlight(null);
      if (fromSheet === 'primary') {
        setEditOpen(true);
        setEditAutoOpenPicker(true);
      } else if (fromSheet === 'additional') {
        setAddOpen(true);
        setAddAutoOpenPicker(true);
      }
      setAwaitingTripCreation(null);
    }, [awaitingTripCreation, route?.params?.refreshKey, route?.params?.fromSheet])
  );

  const onPullRefresh = async () => {
    setRefreshing(true);
    await refresh({ silent: true });
    setRefreshing(false);
  };

  // ---- Primary Trip — Edit/Setup ----
  const openEdit = () => setEditOpen(true);

  const handleSavePrimary = async (vals) => {
    if (vals?.error) {
      showToastMessage(vals.error);
      return;
    }
    console.log('[FieldAttendanceDetail] save primary — vals:', vals);
    setEditSaving(true);
    try {
      await updateFieldAttendancePrimaryTripOdoo(attendanceId, vals);
      console.log('[FieldAttendanceDetail] save primary — write OK for attendanceId:', attendanceId);
      showToastMessage('Primary trip saved');
      setEditOpen(false);
      setNewTripIdToHighlight(null);
      // Optimistic patch — show the picked trip immediately so the user sees
      // feedback even if the subsequent refresh is slow or hits a stale read.
      if (vals.source_trip_id) {
        setAttendance((prev) => prev ? ({
          ...prev,
          source_trip_id: [Number(vals.source_trip_id), prev?.source_trip_id?.[1] || `Trip #${vals.source_trip_id}`],
          source_visit_ids: Array.isArray(vals.source_visit_ids) ? vals.source_visit_ids.map(Number) : prev.source_visit_ids,
          source_visit_count: Array.isArray(vals.source_visit_ids) ? vals.source_visit_ids.length : prev.source_visit_count,
          gps_latitude: vals.gps_latitude ?? prev.gps_latitude,
          gps_longitude: vals.gps_longitude ?? prev.gps_longitude,
          gps_location_name: vals.gps_location_name ?? prev.gps_location_name,
        }) : prev);
      }
      await refresh({ silent: true });
      console.log('[FieldAttendanceDetail] save primary — refresh done');
    } catch (e) {
      console.error('[FieldAttendanceDetail] save primary error:', e?.message);
      showToastMessage(e?.message || 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  // ---- Additional Trip — Add ----
  const openAddTrip = () => {
    // Find the previous (latest) open trip on this attendance.
    let prevTripId = null;
    let prevTripRef = '';
    let prevTripEnded = false;
    if (tripLines.length > 0) {
      const last = tripLines[tripLines.length - 1];
      prevTripId = Array.isArray(last?.trip_id) ? last.trip_id[0] : null;
      prevTripRef = Array.isArray(last?.trip_id) ? last.trip_id[1] : '';
      prevTripEnded = !!last?.trip_ended;
    } else if (Array.isArray(attendance?.source_trip_id)) {
      prevTripId = attendance.source_trip_id[0];
      prevTripRef = attendance.source_trip_id[1];
      prevTripEnded = !!attendance?.source_trip_ended;
    }

    if (prevTripId && !prevTripEnded) {
      // Auto-end-with-confirm flow.
      showAlert({
        message: `Close trip ${prevTripRef || `#${prevTripId}`} now and add a new trip?\n\nThe previous trip will be marked as ended at the current time, and its draft visits will be marked as done.`,
        confirmText: 'Close & Continue',
        cancelText: 'Cancel',
        destructive: false,
        onConfirm: async () => {
          hideAlert();
          setBusy(true);
          try {
            await endVehicleTripFromAttendanceOdoo(prevTripId);
            await refresh({ silent: true });
            setAddOpen(true);
          } catch (e) {
            showToastMessage(e?.message || 'Failed to close previous trip');
          } finally {
            setBusy(false);
          }
        },
        onCancel: hideAlert,
      });
      return;
    }
    setAddOpen(true);
  };

  const handleSaveTripLine = async ({ trip_id, visit_ids }) => {
    setAddSaving(true);
    try {
      await createFieldTripLineOdoo(attendanceId, trip_id, visit_ids);
      showToastMessage('Trip added');
      setAddOpen(false);
      setNewTripIdToHighlight(null);
      await refresh({ silent: true });
    } catch (e) {
      console.error('[FieldAttendanceDetail] add line error:', e?.message);
      showToastMessage(e?.message || 'Failed to add trip');
    } finally {
      setAddSaving(false);
    }
  };

  // ---- Delete trip line ----
  const handleDeleteLine = (line) => {
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
        setBusy(true);
        try {
          await deleteFieldTripLineOdoo(line.id);
          showToastMessage('Trip line deleted');
          await refresh({ silent: true });
        } catch (e) {
          showToastMessage(e?.message || 'Failed to delete');
        } finally {
          setBusy(false);
        }
      },
      onCancel: hideAlert,
    });
  };

  // ---- Open Source Trip sheet ----
  const handleOpenTrip = async (m2oOrId) => {
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

  // ---- View Visits sheet ----
  const handleViewVisits = async (visitIds) => {
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
      setVisitsSheetRows(rows);
    } catch (e) {
      showToastMessage('Failed to load visits');
    } finally {
      setVisitsSheetLoading(false);
    }
  };

  // Loaders for the sheets — passed as callbacks to keep them lazy.
  // Primary picker keeps the current source_trip_id visible (for edit-in-place).
  const loadAvailableTripsPrimary = useCallback(async () => {
    return await searchAvailableTripsOdoo(attendanceId, { includeCurrent: true });
  }, [attendanceId]);
  // Additional picker excludes the primary trip (already used + now ended).
  const loadAvailableTripsAdditional = useCallback(async () => {
    return await searchAvailableTripsOdoo(attendanceId);
  }, [attendanceId]);

  const employeeId = Array.isArray(attendance?.employee_id) ? attendance.employee_id[0] : null;
  const loadDraftVisitsPrimary = useCallback(async () => {
    if (!employeeId) return [];
    return await searchDraftCustomerVisitsOdoo(employeeId);
  }, [employeeId]);
  // Additional picker excludes visits already attached to this attendance
  // (primary's source_visit_ids ∪ any trip line's visit_ids).
  const loadDraftVisitsAdditional = useCallback(async () => {
    if (!employeeId) return [];
    const all = await searchDraftCustomerVisitsOdoo(employeeId);
    const used = new Set();
    (attendance?.source_visit_ids || []).forEach((id) => used.add(Number(id)));
    tripLines.forEach((line) => {
      (line?.visit_ids || []).forEach((id) => used.add(Number(id)));
    });
    return (all || []).filter((v) => !used.has(Number(v.id)));
  }, [employeeId, attendance, tripLines]);

  const loadVisitsByIds = useCallback(async (ids) => {
    return await readCustomerVisitsByIdsOdoo(ids);
  }, []);

  const headerTitle = attendance?.check_in
    ? `Field Attendance · ${fmtDateOnly(attendance.check_in)}`
    : 'Field Attendance';

  // Render-time projection of "return from Create New Trip" route params onto
  // sheet visibility. The route-param useEffect above still promotes these
  // into state for long-term tracking, but the immediate render uses the
  // params directly so the modal opens on the very first frame after FAD
  // focuses/remounts — no waiting for setState batching to flush.
  const rpFromSheet = route?.params?.fromSheet;
  const rpRefreshKey = route?.params?.refreshKey;
  const rpNewTripId = route?.params?.newTripId;
  const returnFromCreate = !!(rpRefreshKey && rpFromSheet);

  const effectiveEditOpen = editOpen || (returnFromCreate && rpFromSheet === 'primary');
  const effectiveAddOpen = addOpen || (returnFromCreate && rpFromSheet === 'additional');
  const effectiveEditAutoOpenPicker = editAutoOpenPicker || (returnFromCreate && rpFromSheet === 'primary');
  const effectiveAddAutoOpenPicker = addAutoOpenPicker || (returnFromCreate && rpFromSheet === 'additional');
  const effectiveNewTripId = newTripIdToHighlight ?? (rpNewTripId ? Number(rpNewTripId) : null);

  return (
    <SafeAreaView backgroundColor={COLORS.white}>
      <NavigationHeader
        title={headerTitle}
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={() => navigation.goBack()}
      />

      {loading ? (
        <View style={styles.loadingFull}>
          <ActivityIndicator color={FIELD_COLOR} size="large" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : !attendance ? (
        <View style={styles.loadingFull}>
          <MaterialIcons name="error-outline" size={32} color="#888" />
          <Text style={styles.loadingText}>Attendance not found.</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1, backgroundColor: '#F8F9FA' }}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} colors={[FIELD_COLOR]} tintColor={FIELD_COLOR} />
          }
        >
          {/* Summary card */}
          <View style={styles.summary}>
            <View style={styles.summaryHeader}>
              <View style={[styles.avatar, { backgroundColor: FIELD_COLOR }]}>
                <MaterialIcons name="map" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryName} numberOfLines={1}>
                  {Array.isArray(attendance.employee_id) ? attendance.employee_id[1] : 'Field Attendance'}
                </Text>
                <Text style={styles.summarySub} numberOfLines={1}>
                  {fmtDateTime(attendance.check_in)} → {fmtDateTime(attendance.check_out)}
                </Text>
              </View>
              <View style={styles.fieldBadge}>
                <Text style={styles.fieldBadgeText}>FIELD</Text>
              </View>
            </View>
            {/* Late tracking banner */}
            {attendance.is_late ? (
              <View style={styles.lateBanner}>
                <MaterialIcons name="schedule" size={14} color="#FB8C00" />
                <Text style={styles.lateText}>
                  Late by {attendance.late_minutes_display || `${attendance.late_minutes || 0}m`}
                  {Number(attendance.deduction_amount || 0) > 0 ? ` · Deduction ${Number(attendance.deduction_amount).toFixed(2)}` : ''}
                  {attendance.is_waived ? ' · Waived' : ''}
                </Text>
              </View>
            ) : null}
            {attendance.late_reason ? (
              <View style={styles.lateReasonBox}>
                <Text style={styles.lateReasonLabel}>Late Reason</Text>
                <Text style={styles.lateReasonText}>{attendance.late_reason}</Text>
              </View>
            ) : null}
          </View>

          {/* Workflow guidance */}
          <View style={styles.guidance}>
            <MaterialIcons name="info-outline" size={14} color="#1565C0" />
            <Text style={styles.guidanceText}>
              Field attendance pulls from your trips and customer visits. Edit the primary trip, add additional trips for the day, and totals roll up below.
            </Text>
          </View>

          {/* Section: Primary Trip */}
          <Text style={styles.sectionTitle}>Primary Trip</Text>
          <PrimaryTripCard
            attendance={attendance}
            tripLines={tripLines}
            busy={busy}
            onSetup={openEdit}
            onEdit={openEdit}
            onOpenTrip={() => handleOpenTrip(attendance.source_trip_id)}
            onViewVisits={() => handleViewVisits(attendance.source_visit_ids)}
          />

          {/* Section: Additional Trips */}
          {Array.isArray(attendance?.source_trip_id) && attendance.source_trip_id[0] ? (
            <>
              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>Additional Trips ({tripLines.length})</Text>
              </View>

              {tripLines.length === 0 ? (
                <View style={styles.emptyAdditional}>
                  <MaterialIcons name="add-road" size={22} color="#BDBDBD" />
                  <Text style={styles.emptyAdditionalText}>
                    No additional trips. Add another trip if you took multiple trips today.
                  </Text>
                </View>
              ) : (
                tripLines.map((line, idx) => (
                  <TripLineCard
                    key={line.id}
                    line={line}
                    index={idx}
                    busy={busy}
                    attendanceCheckedOut={!!attendance?.check_out}
                    onOpenTrip={() => handleOpenTrip(line.trip_id)}
                    onViewVisits={() => handleViewVisits(line.visit_ids)}
                    onDelete={() => handleDeleteLine(line)}
                  />
                ))
              )}

              {!attendance?.check_out && (
                <TouchableOpacity
                  style={[styles.addBtn, busy && { opacity: 0.6 }]}
                  disabled={busy}
                  activeOpacity={0.85}
                  onPress={openAddTrip}
                >
                  <MaterialIcons name="add" size={18} color="#fff" />
                  <Text style={styles.addBtnText}>Add Additional Trip</Text>
                </TouchableOpacity>
              )}

              {/* Section: Trip Totals */}
              <TripTotalsSection attendance={attendance} />
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Sheets */}
      <EditPrimaryTripSheet
        visible={effectiveEditOpen}
        attendance={attendance}
        loadAvailableTrips={loadAvailableTripsPrimary}
        loadDraftVisits={loadDraftVisitsPrimary}
        loadVisitsByIds={loadVisitsByIds}
        onSave={handleSavePrimary}
        onClose={() => {
          setEditOpen(false);
          setNewTripIdToHighlight(null);
          if (returnFromCreate && rpFromSheet === 'primary') {
            navigation.setParams({ newTripId: undefined, fromSheet: undefined, refreshKey: undefined });
          }
        }}
        saving={editSaving}
        onCreateNewTrip={() => handleCreateNewTripFrom('primary')}
        autoOpenPicker={effectiveEditAutoOpenPicker}
        onAutoOpenConsumed={() => setEditAutoOpenPicker(false)}
        newTripIdToHighlight={effectiveNewTripId}
      />
      <AddTripLineSheet
        visible={effectiveAddOpen}
        loadAvailableTrips={loadAvailableTripsAdditional}
        loadDraftVisits={loadDraftVisitsAdditional}
        loadVisitsByIds={loadVisitsByIds}
        onSave={handleSaveTripLine}
        onClose={() => {
          setAddOpen(false);
          setNewTripIdToHighlight(null);
          if (returnFromCreate && rpFromSheet === 'additional') {
            navigation.setParams({ newTripId: undefined, fromSheet: undefined, refreshKey: undefined });
          }
        }}
        saving={addSaving}
        onOpenSourceTrip={(tripId) => handleOpenTrip(tripId)}
        onCreateNewTrip={() => handleCreateNewTripFrom('additional')}
        autoOpenPicker={effectiveAddAutoOpenPicker}
        onAutoOpenConsumed={() => setAddAutoOpenPicker(false)}
        newTripIdToHighlight={effectiveNewTripId}
      />
      <TripDetailSheet
        visible={tripSheetOpen}
        trip={tripSheetTrip}
        loading={tripSheetLoading}
        onClose={() => setTripSheetOpen(false)}
        onOpenInVehicleTracking={(trip) => {
          navigation.navigate('VehicleTrackingForm', {
            tripData: flattenTripForForm(trip || tripSheetTrip),
          });
        }}
      />
      <VisitsListSheet
        visible={visitsSheetOpen}
        visits={visitsSheetRows}
        loading={visitsSheetLoading}
        onClose={() => setVisitsSheetOpen(false)}
        onVisitPress={(v) => {
          setVisitsSheetOpen(false);
          navigation.navigate('VisitDetails', {
            visitId: v?.id,
            visitDetails: v,
          });
        }}
        onOpenInVisits={(visitsSheetRows || []).length > 0
          ? () => {
              setVisitsSheetOpen(false);
              navigation.navigate('VisitDetails', {
                visitId: visitsSheetRows[0]?.id,
                visitDetails: visitsSheetRows[0],
              });
            }
          : undefined}
      />

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
  loadingFull: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  summary: {
    backgroundColor: '#fff', borderRadius: 14, padding: 12,
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 3 },
    }),
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryName: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  summarySub: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  fieldBadge: { backgroundColor: '#E3F2FD', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  fieldBadgeText: { fontSize: 10, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR, letterSpacing: 0.5 },
  lateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFF8E1', borderRadius: 8, padding: 8, marginTop: 8,
    borderLeftWidth: 3, borderLeftColor: '#FB8C00',
  },
  lateText: { flex: 1, fontSize: 11.5, color: '#7a4f00', fontFamily: FONT_FAMILY.urbanistBold },
  lateReasonBox: {
    backgroundColor: '#FAFAFA', borderRadius: 8, padding: 8, marginTop: 6,
    borderWidth: 1, borderColor: '#EEE',
  },
  lateReasonLabel: { fontSize: 10, fontFamily: FONT_FAMILY.urbanistBold, color: '#888', letterSpacing: 0.4 },
  lateReasonText: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#333', marginTop: 2 },
  guidance: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E3F2FD', borderRadius: 10, padding: 10, marginTop: 10,
    borderLeftWidth: 3, borderLeftColor: '#1565C0',
  },
  guidanceText: { flex: 1, fontSize: 11, color: '#1565C0', fontFamily: FONT_FAMILY.urbanistMedium },
  sectionTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 16, marginBottom: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emptyAdditional: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FAFAFA', borderRadius: 10, padding: 12, marginTop: 6,
    borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed',
  },
  emptyAdditionalText: { flex: 1, fontSize: 12, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 12,
    paddingVertical: 12, marginTop: 12,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold },
});

export default FieldAttendanceDetailScreen;
