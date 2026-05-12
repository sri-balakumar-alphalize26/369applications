import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import TripPickerSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripPickerSheet';
import VisitPickerSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitPickerSheet';

const FIELD_COLOR = '#1976D2';

// Add an additional trip line. Server-side @api.model_create_multi auto-ends
// the previous trip and flips its draft visits to done.
const AddTripLineSheet = ({
  visible,
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
  onCreateNewVisit,
  autoOpenVisitPicker,
  onAutoOpenVisitPickerConsumed,
  onOpenSourceTrip,
}) => {
  const [tripId, setTripId] = useState(null);
  const [tripLabel, setTripLabel] = useState('');
  const [tripMeta, setTripMeta] = useState(null); // {source, dest}
  const [visitIds, setVisitIds] = useState([]);
  const [visitLabels, setVisitLabels] = useState([]);

  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [tripPickerOpen, setTripPickerOpen] = useState(false);

  const [visits, setVisits] = useState([]);
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [visitPickerOpen, setVisitPickerOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setTripId(null);
      setTripLabel('');
      setTripMeta(null);
      setVisitIds([]);
      setVisitLabels([]);
    }
  }, [visible]);

  // One-shot auto-open of the inner trip picker — fires when the parent
  // requests it (e.g., user just came back from creating a new trip). A
  // fresh newTripIdToHighlight re-arms the one-shot so a second sequential
  // create also pops the picker.
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

  // One-shot auto-open of the visit picker — fires on return from
  // creating a brand-new customer visit.
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
    setTripMeta({
      source: Array.isArray(trip.source_id) ? trip.source_id[1] : '',
      dest: Array.isArray(trip.destination_id) ? trip.destination_id[1] : '',
      km: trip.km_travelled || 0,
      duration: trip.duration || 0,
    });
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
    if (visit && visit.id) {
      const id = Number(visit.id);
      setVisitIds([id]);
      const label = Array.isArray(visit.partner_id) ? visit.partner_id[1] : (visit.name || `Visit #${id}`);
      setVisitLabels([{ id, label }]);
    }
    setVisitPickerOpen(false);
  };

  const handleSave = () => {
    if (!tripId) return;
    onSave({ trip_id: tripId, visit_ids: visitIds });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>Add Additional Trip</Text>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.tip}>
                <MaterialIcons name="info-outline" size={14} color="#1565C0" />
                <Text style={styles.tipText}>
                  Saving this line will auto-end the previous trip if still open and mark its visits as done.
                </Text>
              </View>

              <Text style={styles.label}>Trip *</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TouchableOpacity style={[styles.input, { flex: 1 }]} activeOpacity={0.85} onPress={openTripPicker}>
                  <MaterialIcons name="directions-car" size={16} color={FIELD_COLOR} />
                  <Text style={[styles.inputText, !tripLabel && { color: '#999' }]} numberOfLines={1}>
                    {tripLabel || 'Tap to pick an available trip'}
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

              {tripMeta ? (
                <View style={styles.tripMeta}>
                  <Text style={styles.tripMetaText}>
                    {(tripMeta.source || '—')} → {(tripMeta.dest || '—')}
                  </Text>
                  <Text style={styles.tripMetaText}>
                    {tripMeta.km} km · {Math.floor(tripMeta.duration)}h {Math.round((tripMeta.duration - Math.floor(tripMeta.duration)) * 60)}m
                  </Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 }}>
                <Text style={[styles.label, { marginTop: 0, marginBottom: 0 }]}>Visits ({visitIds.length})</Text>
                {visitIds.length === 0 && tripId ? (
                  <TouchableOpacity onPress={openVisitPicker} style={styles.linkBtn}>
                    <MaterialIcons name="add" size={14} color={FIELD_COLOR} />
                    <Text style={styles.linkText}>Add a line</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {visitLabels.length === 0 ? (
                <View style={styles.emptyVisits}>
                  <MaterialIcons name="people-outline" size={18} color="#BDBDBD" />
                  <Text style={styles.emptyVisitsText}>
                    No visits selected. Optional — visits attach to this trip line independently.
                  </Text>
                </View>
              ) : (
                visitLabels.map((v) => (
                  <View key={v.id} style={styles.visitChip}>
                    <MaterialIcons name="person" size={13} color={FIELD_COLOR} />
                    <Text style={styles.visitChipText} numberOfLines={1}>{v.label}</Text>
                    <TouchableOpacity
                      onPress={() => { setVisitIds([]); setVisitLabels([]); }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <MaterialIcons name="close" size={14} color="#888" />
                    </TouchableOpacity>
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
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <MaterialIcons name="add" size={16} color="#fff" />}
                <Text style={styles.btnPrimaryText}>{saving ? 'Adding…' : 'Add Trip'}</Text>
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
        title="Pick a Trip"
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
        selectedId={visitIds[0] || null}
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
  tip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E3F2FD', borderRadius: 8, padding: 10,
    borderLeftWidth: 3, borderLeftColor: '#1565C0',
  },
  tipText: { flex: 1, fontSize: 11, color: '#1565C0', fontFamily: FONT_FAMILY.urbanistMedium },
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
  tripMeta: {
    backgroundColor: '#FAFAFA', borderRadius: 8, padding: 8, marginTop: 6,
    borderWidth: 1, borderColor: '#EEE',
  },
  tripMetaText: { fontSize: 11, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  linkText: { fontSize: 12, color: FIELD_COLOR, fontFamily: FONT_FAMILY.urbanistBold },
  emptyVisits: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FAFAFA', borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed',
  },
  emptyVisitsText: { flex: 1, fontSize: 12, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium },
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

export default AddTripLineSheet;
