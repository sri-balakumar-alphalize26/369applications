import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import TripPickerSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripPickerSheet';
import VisitPickerSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitPickerSheet';

const FIELD_COLOR = '#1976D2';

const tripRefOf = (t) => {
  if (!t) return '';
  if (Array.isArray(t)) return t[1] || `Trip #${t[0]}`;
  return t.ref || `Trip #${t.id || ''}`;
};

const tripIdOf = (t) => {
  if (!t) return null;
  if (Array.isArray(t)) return Number(t[0]);
  return Number(t.id);
};

const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return String(s).slice(0, 16);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// Edit / Setup the primary trip on a field attendance.
// Layout mirrors Odoo's view_attendance_primary_trip_dialog: source trip
// picker, source/destination location read-only rows, GPS, location name,
// Open Source Trip + View Visits buttons, then a VISITS table with X-row
// removal + "+ Add a line" link at the bottom.
const EditPrimaryTripSheet = ({
  visible,
  attendance,
  loadAvailableTrips,
  loadDraftVisits,
  loadVisitsByIds,
  onSave,
  onClose,
  saving,
  onCreateNewTrip,
  autoOpenPicker,
  onAutoOpenConsumed,
  newTripIdToHighlight,
  onOpenSourceTrip,
  onViewVisits,
  onCreateNewVisit,
  autoOpenVisitPicker,
  onAutoOpenVisitPickerConsumed,
  onOpenVisitDetail,
}) => {
  const [tripId, setTripId] = useState(null);
  const [tripLabel, setTripLabel] = useState('');
  const [sourceLocLabel, setSourceLocLabel] = useState('');
  const [destLocLabel, setDestLocLabel] = useState('');
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLng, setGpsLng] = useState('');
  const [gpsName, setGpsName] = useState('');
  // Full visit row objects so we can render the table (ref / customer / time / location / state)
  const [visitRows, setVisitRows] = useState([]);

  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);

  const [visits, setVisits] = useState([]);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitPickerOpen, setVisitPickerOpen] = useState(false);

  // Hydrate state from the attendance record each time the sheet opens.
  // Tolerant of a null `attendance` prop: opens with a blank form so the user
  // can still pick a trip / link visits via the picker sheets even before the
  // parent's rich-detail fetch returns.
  useEffect(() => {
    if (!visible) return;
    if (!attendance) {
      setTripId(null);
      setTripLabel('');
      setSourceLocLabel('');
      setDestLocLabel('');
      setGpsLat('');
      setGpsLng('');
      setGpsName('');
      setVisitRows([]);
      return;
    }
    setTripId(tripIdOf(attendance.source_trip_id));
    setTripLabel(tripRefOf(attendance.source_trip_id));
    setSourceLocLabel(String(attendance.source_trip_source_location ?? ''));
    setDestLocLabel(String(attendance.source_trip_destination_location ?? ''));
    setGpsLat(String(attendance.gps_latitude ?? ''));
    setGpsLng(String(attendance.gps_longitude ?? ''));
    setGpsName(String(attendance.gps_location_name ?? ''));
    const ids = Array.isArray(attendance.source_visit_ids) ? attendance.source_visit_ids.map(Number) : [];
    if (ids.length > 0 && loadVisitsByIds) {
      loadVisitsByIds(ids).then((rows) => {
        // Hide visits already marked done — they aren't relevant to the
        // active attendance any more.
        const filtered = (rows || []).filter(r => String(r.state || 'draft') !== 'done');
        setVisitRows(filtered);
      }).catch(() => setVisitRows([]));
    } else {
      setVisitRows([]);
    }
  }, [visible, attendance, loadVisitsByIds]);

  // One-shot auto-open of the trip picker — parent sets autoOpenPicker=true
  // when the user is returning from creating a brand-new trip. A fresh
  // newTripIdToHighlight re-arms the one-shot so a second sequential create
  // also pops the picker.
  const autoFiredRef = useRef(false);
  const lastNewIdRef = useRef(null);
  useEffect(() => {
    if (!visible) {
      autoFiredRef.current = false;
      return;
    }
    if (newTripIdToHighlight != null && lastNewIdRef.current !== newTripIdToHighlight) {
      autoFiredRef.current = false;
      lastNewIdRef.current = newTripIdToHighlight;
    }
    if (autoOpenPicker && !autoFiredRef.current) {
      autoFiredRef.current = true;
      openTripPicker();
      if (onAutoOpenConsumed) onAutoOpenConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoOpenPicker, newTripIdToHighlight]);

  // One-shot auto-open of the visit picker — parent sets
  // autoOpenVisitPicker=true on return from "Create New Visit".
  const autoVisitFiredRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      autoVisitFiredRef.current = false;
      return;
    }
    if (autoOpenVisitPicker && !autoVisitFiredRef.current) {
      autoVisitFiredRef.current = true;
      openVisitPicker();
      if (onAutoOpenVisitPickerConsumed) onAutoOpenVisitPickerConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoOpenVisitPicker]);

  const openTripPicker = async () => {
    setTripsLoading(true);
    setTripPickerOpen(true);
    try {
      const rows = await loadAvailableTrips();
      setTrips(rows || []);
    } catch (e) {
      setTrips([]);
    } finally {
      setTripsLoading(false);
    }
  };

  const onTripSelected = (trip) => {
    setTripId(Number(trip.id));
    setTripLabel(trip.ref || `Trip #${trip.id}`);
    setSourceLocLabel(Array.isArray(trip.source_id) ? (trip.source_id[1] || '') : '');
    setDestLocLabel(Array.isArray(trip.destination_id) ? (trip.destination_id[1] || '') : '');
    // Auto-fill GPS from trip when current GPS is empty (mirrors Odoo onchange).
    const numLat = parseFloat(gpsLat);
    const numLng = parseFloat(gpsLng);
    if (!gpsLat || !gpsLng || (!numLat && !numLng)) {
      if (trip.start_latitude) setGpsLat(String(trip.start_latitude));
      if (trip.start_longitude) setGpsLng(String(trip.start_longitude));
    }
    if (!gpsName && Array.isArray(trip.source_id)) {
      setGpsName(trip.source_id[1] || '');
    }
    // Picking a trip does NOT auto-populate visits — user must add via the
    // "+ Add a line" button below. Mirrors the trip-line module convention.
    setTripPickerOpen(false);
  };

  const openVisitPicker = async () => {
    setVisitsLoading(true);
    setVisitPickerOpen(true);
    try {
      const draft = await loadDraftVisits();
      setVisits(draft || []);
    } catch (e) {
      setVisits([]);
    } finally {
      setVisitsLoading(false);
    }
  };

  const onVisitSelected = (visit) => {
    if (visit && visit.id) setVisitRows([visit]);
    setVisitPickerOpen(false);
  };

  const removeVisit = (id) => {
    setVisitRows((prev) => prev.filter((v) => Number(v.id) !== Number(id)));
  };

  const handleSave = () => {
    if (!tripId) {
      onSave({ error: 'Pick a trip first.' });
      return;
    }
    onSave({
      source_trip_id: tripId,
      gps_latitude: parseFloat(gpsLat) || 0,
      gps_longitude: parseFloat(gpsLng) || 0,
      gps_location_name: gpsName || '',
      source_visit_ids: visitRows.map((v) => Number(v.id)),
    });
  };

  const visitIds = visitRows.map((v) => Number(v.id));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex1}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {attendance?.source_trip_id ? 'Edit Primary Trip' : 'Setup Primary Trip'}
              </Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {/* Source Trip picker */}
              <Text style={styles.label}>Source Trip *</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity style={[styles.input, { flex: 1 }]} activeOpacity={0.85} onPress={openTripPicker}>
                  <MaterialIcons name="directions-car" size={16} color={FIELD_COLOR} />
                  <Text style={[styles.inputText, !tripLabel && { color: '#999' }]} numberOfLines={1}>
                    {tripLabel || 'Tap to pick a trip'}
                  </Text>
                  <MaterialIcons name="chevron-right" size={18} color="#999" />
                </TouchableOpacity>
                {tripId && onOpenSourceTrip ? (
                  <TouchableOpacity
                    style={styles.openIconBtn}
                    onPress={() => onOpenSourceTrip(tripId)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MaterialIcons name="open-in-new" size={18} color={FIELD_COLOR} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Source Location (read-only) */}
              <View style={styles.kvRow}>
                <Text style={styles.kvKey}>Source Location</Text>
                <Text style={styles.kvVal} numberOfLines={2}>{sourceLocLabel || '—'}</Text>
              </View>

              {/* Destination Location (read-only) */}
              <View style={styles.kvRow}>
                <Text style={styles.kvKey}>Destination</Text>
                <Text style={styles.kvVal} numberOfLines={2}>{destLocLabel || '—'}</Text>
              </View>

              {/* Location name (editable) */}
              <Text style={styles.label}>Location</Text>
              <TextInput
                value={gpsName}
                onChangeText={setGpsName}
                placeholder="e.g. Customer warehouse, depot, branch"
                placeholderTextColor="#999"
                style={styles.textInput}
              />

              {/* GPS lat/lng */}
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>GPS Latitude</Text>
                  <TextInput
                    value={gpsLat}
                    onChangeText={setGpsLat}
                    keyboardType="decimal-pad"
                    placeholder="0.0000000"
                    placeholderTextColor="#999"
                    style={styles.textInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>GPS Longitude</Text>
                  <TextInput
                    value={gpsLng}
                    onChangeText={setGpsLng}
                    keyboardType="decimal-pad"
                    placeholder="0.0000000"
                    placeholderTextColor="#999"
                    style={styles.textInput}
                  />
                </View>
              </View>

              {/* Open Source Trip + View Visits buttons */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, !tripId && styles.actionBtnDisabled]}
                  disabled={!tripId}
                  activeOpacity={0.85}
                  onPress={() => onOpenSourceTrip && onOpenSourceTrip(tripId)}
                >
                  <MaterialIcons name="local-shipping" size={14} color={tripId ? FIELD_COLOR : '#BDBDBD'} />
                  <Text style={[styles.actionBtnText, !tripId && { color: '#BDBDBD' }]}>Open Source Trip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, visitRows.length === 0 && styles.actionBtnDisabled]}
                  disabled={visitRows.length === 0}
                  activeOpacity={0.85}
                  onPress={() => onViewVisits && onViewVisits(visitIds)}
                >
                  <MaterialIcons name="place" size={14} color={visitRows.length > 0 ? FIELD_COLOR : '#BDBDBD'} />
                  <Text style={[styles.actionBtnText, visitRows.length === 0 && { color: '#BDBDBD' }]}>View Visits</Text>
                </TouchableOpacity>
              </View>

              {/* VISITS table */}
              <Text style={styles.sectionHeader}>VISITS</Text>
              {visitRows.length === 0 ? (
                <View style={styles.emptyVisits}>
                  <MaterialIcons name="people-outline" size={18} color="#BDBDBD" />
                  <Text style={styles.emptyVisitsText}>No visits yet. Tap "+ Add a line" to add.</Text>
                </View>
              ) : (
                visitRows.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    style={styles.visitRow}
                    activeOpacity={onOpenVisitDetail ? 0.75 : 1}
                    onPress={() => onOpenVisitDetail && onOpenVisitDetail(v)}
                    disabled={!onOpenVisitDetail}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.visitRef} numberOfLines={1}>
                        {v.name || `Visit #${v.id}`}
                      </Text>
                      <Text style={styles.visitMeta} numberOfLines={1}>
                        {Array.isArray(v.partner_id) ? v.partner_id[1] : '—'}
                        {' · '}{fmtDateTime(v.date_time)}
                        {' · '}{v.location_name || '—'}
                      </Text>
                    </View>
                    <View style={styles.statePill}>
                      <Text style={styles.statePillText}>{(v.state || 'draft').toUpperCase()}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={(e) => {
                        if (e && e.stopPropagation) e.stopPropagation();
                        removeVisit(v.id);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <MaterialIcons name="close" size={18} color="#888" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))
              )}

              {/* + Add a line — only when no visit yet (single-line cap) */}
              {visitRows.length === 0 && tripId ? (
                <TouchableOpacity
                  style={styles.addLineBtn}
                  activeOpacity={0.85}
                  onPress={openVisitPicker}
                >
                  <MaterialIcons name="add" size={16} color={FIELD_COLOR} />
                  <Text style={styles.addLineText}>Add a line</Text>
                </TouchableOpacity>
              ) : null}
              {!tripId ? (
                <Text style={styles.addLineHint}>Pick a Source Trip first to add visits.</Text>
              ) : null}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.btnSecondary} onPress={onClose} disabled={saving}>
                <Text style={styles.btnSecondaryText}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimary, (saving || !tripId) && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving || !tripId}
              >
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="save" size={16} color="#fff" />}
                <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <TripPickerSheet
        visible={tripPickerOpen}
        trips={trips}
        loading={tripsLoading}
        selectedId={tripId}
        newTripId={newTripIdToHighlight}
        onSelect={onTripSelected}
        onClose={() => setTripPickerOpen(false)}
        title="Pick Source Trip"
        onCreateNew={onCreateNewTrip ? () => {
          // Close the inner picker; the parent saves context + closes the
          // outer sheet, then the focus-return effect re-opens both.
          setTripPickerOpen(false);
          onCreateNewTrip();
        } : undefined}
      />
      <VisitPickerSheet
        visible={visitPickerOpen}
        visits={visits}
        loading={visitsLoading}
        selectedId={visitRows[0]?.id || null}
        onSelect={onVisitSelected}
        onClose={() => setVisitPickerOpen(false)}
        title="Add Visit"
        onCreateNew={onCreateNewVisit ? () => {
          setVisitPickerOpen(false);
          onCreateNewVisit();
        } : undefined}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    width: '100%', maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: '92%',
    paddingTop: 12,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 8 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
    }),
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  title: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  body: { padding: 16, gap: 4 },
  label: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 12, marginBottom: 4 },
  input: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F9FF', borderRadius: 10, borderWidth: 1, borderColor: '#E3F2FD',
    paddingHorizontal: 12, paddingVertical: 12,
  },
  inputText: { flex: 1, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  openIconBtn: {
    width: 40, height: 44, borderRadius: 10, borderWidth: 1, borderColor: FIELD_COLOR,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  kvRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingVertical: 6, gap: 12,
  },
  kvKey: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', flexShrink: 0, paddingTop: 2 },
  kvVal: { flex: 1, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#333', textAlign: 'right' },
  textInput: {
    backgroundColor: '#F5F9FF', borderRadius: 10, borderWidth: 1, borderColor: '#E3F2FD',
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222',
  },
  row2: { flexDirection: 'row', gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#fff', borderColor: FIELD_COLOR, borderWidth: 1, borderRadius: 10,
    paddingVertical: 9,
  },
  actionBtnDisabled: { borderColor: '#E0E0E0', backgroundColor: '#FAFAFA' },
  actionBtnText: { fontSize: 12, color: FIELD_COLOR, fontFamily: FONT_FAMILY.urbanistBold },
  sectionHeader: {
    fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold, color: '#888',
    letterSpacing: 1, marginTop: 18, marginBottom: 6,
  },
  emptyVisits: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FAFAFA', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed',
  },
  emptyVisitsText: { flex: 1, fontSize: 12, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium },
  visitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#E0E0E0', marginVertical: 3,
  },
  visitRef: { fontSize: 12.5, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  visitMeta: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  statePill: {
    backgroundColor: '#E8F5E9', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: '#43A047',
  },
  statePillText: { fontSize: 9, color: '#43A047', fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  addLineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 4, marginTop: 4,
  },
  addLineBtnDisabled: { opacity: 0.6 },
  addLineText: { fontSize: 13, color: FIELD_COLOR, fontFamily: FONT_FAMILY.urbanistBold },
  addLineHint: { fontSize: 11, color: '#999', fontFamily: FONT_FAMILY.urbanistMedium, marginLeft: 4 },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    padding: 14, borderTopWidth: 1, borderTopColor: '#EEE',
  },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 10,
    paddingVertical: 11, paddingHorizontal: 22,
  },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  btnSecondary: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#BDBDBD',
    paddingVertical: 11, paddingHorizontal: 18,
  },
  btnSecondaryText: { color: '#444', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default EditPrimaryTripSheet;
