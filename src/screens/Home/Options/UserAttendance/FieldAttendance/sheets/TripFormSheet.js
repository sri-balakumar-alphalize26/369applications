import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  ScrollView, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import TripPickerSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/TripPickerSheet';
import VisitPickerSheet from '@screens/Home/Options/UserAttendance/FieldAttendance/sheets/VisitPickerSheet';
import { readVehicleTrackingForTripIdsOdoo, readCustomerVisitsByIdsOdoo } from '@api/services/generalApi';

const FIELD_COLOR = '#1976D2';
// Grep "[FA-FORM]" to trace TripFormSheet: which mode it opened in, what the
// user picked, and which validation block (if any) tripped Save.
const TAG = '[FA-FORM]';

/**
 * One sheet, four modes:
 *   - mode='primary'        Setup Primary Trip (Home → Office) — pick trip + Start KM. NO visit.
 *   - mode='outbound'       Setup Secondary Trip / Add Additional Trip — pick trip + visit + Start KM.
 *   - mode='return'         Primary Trip (Via Office or Direct) — radio + pick trip + Start KM. NO visit.
 *   - mode='office_to_home' Primary Trip (Office to Home) — pick trip + Start KM. Leg type fixed.
 *
 * All modes share the same picker UI + Start KM input. Mode-specific
 * differences (visit field, route radio, default leg type) are toggled by props.
 */
const TripFormSheet = ({
  visible, mode, title,
  availableTripIds, availableVisitIds, previousDestinationId,
  saving, onSave, onClose,
  // Optional callbacks — when provided, the picker renders a green
  // "Create New Trip / Visit" row at the top of its list. The parent
  // (FieldAttendanceSection) handles the navigation.
  onCreateNewTrip,
  onCreateNewVisit,
}) => {
  const [trips, setTrips] = useState([]);
  const [visits, setVisits] = useState([]);
  const [loadingPicker, setLoadingPicker] = useState(false);

  const [selectedTripId, setSelectedTripId] = useState(null);
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  const [startKm, setStartKm] = useState('');
  const [returnLegType, setReturnLegType] = useState('via_office');
  const [errorText, setErrorText] = useState('');

  const [tripPickerOpen, setTripPickerOpen] = useState(false);
  const [visitPickerOpen, setVisitPickerOpen] = useState(false);

  const needsVisit = mode === 'outbound';
  const needsRouteRadio = mode === 'return';

  // Reset on open. NOTE: deps are intentionally narrow — only `visible`
  // toggles trigger a reset. Including mode/title/availableTripIds etc.
  // caused the effect to fire on every parent render (those props are
  // fresh refs each time `state` updates), producing 19+ duplicate log
  // lines per single sheet open.
  useEffect(() => {
    if (visible) {
      console.log(TAG, 'open', { mode, title, availableTrips: (availableTripIds || []).length, availableVisits: (availableVisitIds || []).length, prevDestId: previousDestinationId });
      setSelectedTripId(null);
      setSelectedVisitId(null);
      setStartKm('');
      setReturnLegType('via_office');
      setErrorText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Load full trip / visit objects only for the available_*_ids list — server
  // already filtered by used-trip exclusion and (for trips) source location.
  const loadTrips = useCallback(async () => {
    setLoadingPicker(true);
    try {
      const ids = (availableTripIds || []).map(Number).filter(Boolean);
      if (!ids.length) { setTrips([]); return; }
      const rows = await readVehicleTrackingForTripIdsOdoo(ids);
      setTrips(rows || []);
    } catch (e) {
      setTrips([]);
    } finally {
      setLoadingPicker(false);
    }
  }, [availableTripIds]);

  const loadVisits = useCallback(async () => {
    setLoadingPicker(true);
    try {
      const ids = (availableVisitIds || []).map(Number).filter(Boolean);
      if (!ids.length) { setVisits([]); return; }
      const rows = await readCustomerVisitsByIdsOdoo(ids);
      setVisits(rows || []);
    } catch (e) {
      setVisits([]);
    } finally {
      setLoadingPicker(false);
    }
  }, [availableVisitIds]);

  const selectedTrip = useMemo(
    () => trips.find((t) => Number(t.id) === Number(selectedTripId)) || null,
    [trips, selectedTripId]
  );
  const selectedVisit = useMemo(
    () => visits.find((v) => Number(v.id) === Number(selectedVisitId)) || null,
    [visits, selectedVisitId]
  );

  const handleSave = () => {
    console.log(TAG, 'Save clicked', { mode, selectedTripId, selectedVisitId, startKm, returnLegType });
    if (!selectedTripId) {
      console.warn(TAG, '  validation failed: no trip picked');
      setErrorText('Please pick a trip.'); return;
    }
    const km = Number(startKm);
    if (!Number.isFinite(km) || km <= 0) {
      console.warn(TAG, '  validation failed: start_km <= 0');
      setErrorText('Start KM is required and must be greater than 0.');
      return;
    }
    if (needsVisit && !selectedVisitId) {
      console.warn(TAG, '  validation failed: outbound mode needs a visit');
      setErrorText('Please pick a customer visit.');
      return;
    }
    if (needsRouteRadio && !returnLegType) {
      console.warn(TAG, '  validation failed: return mode needs a leg type');
      setErrorText('Please choose Via Office or Direct.');
      return;
    }
    console.log(TAG, '  validation OK → onSave');
    setErrorText('');
    onSave({
      tripId: selectedTripId,
      visitId: selectedVisitId || null,
      startKm: km,
      returnLegType: needsRouteRadio ? returnLegType : null,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', alignItems: 'center' }}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>{title || 'Trip'}</Text>
              <TouchableOpacity onPress={onClose} disabled={saving}>
                <MaterialIcons name="close" size={22} color="#888" />
              </TouchableOpacity>
            </View>

            {previousDestinationId ? (
              <View style={styles.fromBanner}>
                <MaterialIcons name="place" size={14} color="#1565C0" />
                <Text style={styles.fromBannerText}>
                  Trip picker filtered: source = your previous destination
                </Text>
              </View>
            ) : null}

            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              {/* Route radio (return mode only) */}
              {needsRouteRadio ? (
                <>
                  <Text style={styles.label}>Return Route</Text>
                  <View style={styles.radioGroup}>
                    <RadioRow
                      label="Via Office (Visit → Office)"
                      checked={returnLegType === 'via_office'}
                      onPress={() => setReturnLegType('via_office')}
                    />
                    <RadioRow
                      label="Direct (Visit → Home)"
                      checked={returnLegType === 'direct'}
                      onPress={() => setReturnLegType('direct')}
                    />
                  </View>
                </>
              ) : null}

              {/* Trip picker */}
              <Text style={styles.label}>Source Trip *</Text>
              <TouchableOpacity
                style={styles.fieldBtn}
                onPress={() => { setTripPickerOpen(true); loadTrips(); }}
                disabled={saving}
              >
                <Text style={[styles.fieldVal, !selectedTrip && styles.placeholder]} numberOfLines={1}>
                  {selectedTrip ? `${selectedTrip.ref || `Trip #${selectedTrip.id}`}` : 'Tap to select a trip…'}
                </Text>
                <MaterialIcons name="chevron-right" size={20} color="#888" />
              </TouchableOpacity>
              {selectedTrip ? (
                <Text style={styles.detail}>
                  {(selectedTrip.source_id?.[1] || selectedTrip.source || '')} → {(selectedTrip.destination_id?.[1] || selectedTrip.destination || '')}
                </Text>
              ) : null}

              {/* Start KM */}
              <Text style={styles.label}>Start KM *</Text>
              <View style={styles.kmRow}>
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  placeholder="Enter odometer reading"
                  value={startKm}
                  onChangeText={(t) => { setStartKm(t.replace(/[^0-9]/g, '')); setErrorText(''); }}
                  editable={!saving}
                />
                <Text style={styles.unit}>km</Text>
              </View>

              {/* Visit picker (outbound only) */}
              {needsVisit ? (
                <>
                  <Text style={styles.label}>Customer Visit *</Text>
                  <TouchableOpacity
                    style={styles.fieldBtn}
                    onPress={() => { setVisitPickerOpen(true); loadVisits(); }}
                    disabled={saving}
                  >
                    <Text style={[styles.fieldVal, !selectedVisit && styles.placeholder]} numberOfLines={1}>
                      {selectedVisit
                        ? `${selectedVisit.name || `Visit #${selectedVisit.id}`} — ${(selectedVisit.partner_id?.[1] || selectedVisit.customer || '')}`
                        : 'Tap to select a visit…'}
                    </Text>
                    <MaterialIcons name="chevron-right" size={20} color="#888" />
                  </TouchableOpacity>
                </>
              ) : null}

              {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <><MaterialIcons name="check" size={16} color="#fff" /><Text style={styles.saveText}>Save</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      <TripPickerSheet
        visible={tripPickerOpen}
        trips={trips}
        loading={loadingPicker}
        selectedId={selectedTripId}
        onClose={() => setTripPickerOpen(false)}
        onSelect={(t) => { setSelectedTripId(t?.id); setTripPickerOpen(false); }}
        onCreateNew={onCreateNewTrip ? () => { setTripPickerOpen(false); onCreateNewTrip(); } : undefined}
      />
      <VisitPickerSheet
        visible={visitPickerOpen}
        visits={visits}
        loading={loadingPicker}
        selectedId={selectedVisitId}
        onClose={() => setVisitPickerOpen(false)}
        onSelect={(v) => { setSelectedVisitId(v?.id); setVisitPickerOpen(false); }}
        onCreateNew={onCreateNewVisit ? () => { setVisitPickerOpen(false); onCreateNewVisit(); } : undefined}
      />
    </Modal>
  );
};

const RadioRow = ({ label, checked, onPress }) => (
  <TouchableOpacity style={styles.radioRow} onPress={onPress}>
    <View style={[styles.radioOuter, checked && { borderColor: FIELD_COLOR }]}>
      {checked ? <View style={styles.radioInner} /> : null}
    </View>
    <Text style={styles.radioLabel}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16,
  },
  card: {
    width: '100%', maxWidth: 480,
    backgroundColor: '#fff', borderRadius: 16,
    maxHeight: '92%', padding: 16,
    ...Platform.select({
      android: { elevation: 8 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
    }),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  fromBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E3F2FD', borderLeftWidth: 3, borderLeftColor: '#1565C0',
    padding: 8, borderRadius: 8, marginBottom: 8,
  },
  fromBannerText: { flex: 1, fontSize: 11, color: '#1565C0', fontFamily: FONT_FAMILY.urbanistMedium },
  label: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#666', marginTop: 12, marginBottom: 4 },
  fieldBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12,
  },
  fieldVal: { flex: 1, fontSize: 13, color: '#222', fontFamily: FONT_FAMILY.urbanistMedium },
  placeholder: { color: '#999' },
  detail: { fontSize: 11, color: '#777', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 4 },
  kmRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222',
  },
  unit: { fontSize: 13, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  error: { fontSize: 12, color: '#D32F2F', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  cancelBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, backgroundColor: '#EEE', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 8, backgroundColor: FIELD_COLOR },
  saveText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  radioGroup: { gap: 6 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  radioOuter: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#BBB', alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: FIELD_COLOR },
  radioLabel: { fontSize: 13, color: '#333', fontFamily: FONT_FAMILY.urbanistMedium },
});

export default TripFormSheet;
