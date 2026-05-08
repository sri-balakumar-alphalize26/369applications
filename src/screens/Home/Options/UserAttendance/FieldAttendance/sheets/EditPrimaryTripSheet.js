import React, { useEffect, useState } from 'react';
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

// Edit the primary trip (source_trip_id, gps_*, source_visit_ids) on an
// existing field attendance. Mirrors the Odoo "Edit Primary Trip" popup
// (view_attendance_primary_trip_dialog).
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
}) => {
  const [tripId, setTripId] = useState(null);
  const [tripLabel, setTripLabel] = useState('');
  const [gpsLat, setGpsLat] = useState('');
  const [gpsLng, setGpsLng] = useState('');
  const [gpsName, setGpsName] = useState('');
  const [visitIds, setVisitIds] = useState([]);
  const [visitLabels, setVisitLabels] = useState([]); // [{id, label}]

  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);

  const [visits, setVisits] = useState([]);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitPickerOpen, setVisitPickerOpen] = useState(false);

  // Hydrate state from the attendance record each time the sheet opens.
  // Tolerant of a null `attendance` prop: opens with a blank form so the
  // user can still pick a trip / link visits via the picker sheets even
  // before the parent's rich-detail fetch returns.
  useEffect(() => {
    if (!visible) return;
    if (!attendance) {
      setTripId(null);
      setTripLabel('');
      setGpsLat('');
      setGpsLng('');
      setGpsName('');
      setVisitIds([]);
      setVisitLabels([]);
      return;
    }
    setTripId(tripIdOf(attendance.source_trip_id));
    setTripLabel(tripRefOf(attendance.source_trip_id));
    setGpsLat(String(attendance.gps_latitude ?? ''));
    setGpsLng(String(attendance.gps_longitude ?? ''));
    setGpsName(String(attendance.gps_location_name ?? ''));
    const ids = Array.isArray(attendance.source_visit_ids) ? attendance.source_visit_ids.map(Number) : [];
    setVisitIds(ids);
    setVisitLabels([]);
    if (ids.length > 0 && loadVisitsByIds) {
      loadVisitsByIds(ids).then((rows) => {
        setVisitLabels(rows.map((r) => ({
          id: Number(r.id),
          label: Array.isArray(r.partner_id) ? r.partner_id[1] : (r.name || `Visit #${r.id}`),
        })));
      }).catch(() => {});
    }
  }, [visible, attendance, loadVisitsByIds]);

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
    setTripPickerOpen(false);
  };

  const openVisitPicker = async () => {
    setVisitsLoading(true);
    setVisitPickerOpen(true);
    try {
      const draft = await loadDraftVisits();
      // Merge currently-selected visits (which may not be in draft state any more)
      // so the user can de-select them.
      const draftIds = new Set((draft || []).map((v) => Number(v.id)));
      const missing = visitIds.filter((id) => !draftIds.has(id));
      let extra = [];
      if (missing.length > 0 && loadVisitsByIds) {
        extra = await loadVisitsByIds(missing);
      }
      setVisits([...(draft || []), ...extra]);
    } catch (e) {
      setVisits([]);
    } finally {
      setVisitsLoading(false);
    }
  };

  const onVisitsConfirmed = (ids) => {
    setVisitIds(ids);
    const map = new Map();
    visits.forEach((v) => {
      map.set(Number(v.id), {
        id: Number(v.id),
        label: Array.isArray(v.partner_id) ? v.partner_id[1] : (v.name || `Visit #${v.id}`),
      });
    });
    setVisitLabels(ids.map((id) => map.get(Number(id)) || { id, label: `Visit #${id}` }));
    setVisitPickerOpen(false);
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
      source_visit_ids: visitIds,
    });
  };

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
              <Text style={styles.label}>Source Trip *</Text>
              <TouchableOpacity style={styles.input} activeOpacity={0.85} onPress={openTripPicker}>
                <MaterialIcons name="directions-car" size={16} color={FIELD_COLOR} />
                <Text style={[styles.inputText, !tripLabel && { color: '#999' }]} numberOfLines={1}>
                  {tripLabel || 'Tap to pick a trip'}
                </Text>
                <MaterialIcons name="chevron-right" size={18} color="#999" />
              </TouchableOpacity>

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

              <Text style={styles.label}>Location Name</Text>
              <TextInput
                value={gpsName}
                onChangeText={setGpsName}
                placeholder="e.g. Customer warehouse, depot, branch"
                placeholderTextColor="#999"
                style={styles.textInput}
              />

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 6 }}>
                <Text style={[styles.label, { marginBottom: 0 }]}>Visits ({visitIds.length})</Text>
                <TouchableOpacity onPress={openVisitPicker} style={styles.linkBtn}>
                  <MaterialIcons name="edit" size={14} color={FIELD_COLOR} />
                  <Text style={styles.linkText}>Pick / Edit</Text>
                </TouchableOpacity>
              </View>
              {visitLabels.length === 0 ? (
                <View style={styles.emptyVisits}>
                  <MaterialIcons name="people-outline" size={18} color="#BDBDBD" />
                  <Text style={styles.emptyVisitsText}>No visits selected.</Text>
                </View>
              ) : (
                visitLabels.map((v) => (
                  <View key={v.id} style={styles.visitChip}>
                    <MaterialIcons name="person" size={13} color={FIELD_COLOR} />
                    <Text style={styles.visitChipText} numberOfLines={1}>{v.label}</Text>
                  </View>
                ))
              )}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.btnSecondary} onPress={onClose} disabled={saving}>
                <Text style={styles.btnSecondaryText}>Cancel</Text>
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
        onSelect={onTripSelected}
        onClose={() => setTripPickerOpen(false)}
        title="Pick Source Trip"
        onCreateNew={onCreateNewTrip ? () => {
          setTripPickerOpen(false);
          onCreateNewTrip();
        } : undefined}
      />
      <VisitPickerSheet
        visible={visitPickerOpen}
        visits={visits}
        loading={visitsLoading}
        selectedIds={visitIds}
        onConfirm={onVisitsConfirmed}
        onClose={() => setVisitPickerOpen(false)}
        title="Select Visits"
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
  textInput: {
    backgroundColor: '#F5F9FF', borderRadius: 10, borderWidth: 1, borderColor: '#E3F2FD',
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222',
  },
  row2: { flexDirection: 'row', gap: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  linkText: { fontSize: 12, color: FIELD_COLOR, fontFamily: FONT_FAMILY.urbanistBold },
  emptyVisits: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FAFAFA', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed',
  },
  emptyVisitsText: { fontSize: 12, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium },
  visitChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E3F2FD', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, marginTop: 4,
  },
  visitChipText: { fontSize: 12, color: '#222', fontFamily: FONT_FAMILY.urbanistBold, flexShrink: 1 },
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
