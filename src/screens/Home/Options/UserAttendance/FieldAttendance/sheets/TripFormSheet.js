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
  // Pre-select a trip/visit id when the sheet re-opens after the user has
  // just created the record via the Create-New flow. The parent threads
  // the freshly-created id back via the pending-channel handshake.
  initialSelectedTripId,
  initialSelectedVisitId,
  // Tap the pencil icon next to any draft row in the trip picker → parent
  // closes everything and navigates to VehicleTrackingForm in edit mode.
  onEditTrip,
  // When the parent re-opens this sheet after a back-nav from
  // VehicleTrackingForm (edit-pencil path), also re-open the trip picker so
  // the user lands on the layer they were viewing. Reset via
  // onAutoOpenPickerHandled once consumed.
  autoOpenPicker,
  onAutoOpenPickerHandled,
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
      console.log(TAG, 'open', { mode, title, availableTrips: (availableTripIds || []).length, availableVisits: (availableVisitIds || []).length, prevDestId: previousDestinationId, initialSelectedTripId, initialSelectedVisitId, autoOpenPicker: !!autoOpenPicker });
      setSelectedTripId(initialSelectedTripId || null);
      setSelectedVisitId(initialSelectedVisitId || null);
      setStartKm('');
      setReturnLegType('via_office');
      setErrorText('');
      // Pre-load picker rows so the selected-trip detail line ("source → dest")
      // can render immediately when we auto-select after Create-New.
      if (initialSelectedTripId) loadTrips();
      if (initialSelectedVisitId) loadVisits();
      // Back-nav restore: parent asked us to also open the trip picker, so
      // the user lands on the same layer they came from. Skip when an
      // initialSelectedTripId is also being applied — that means we just
      // came back from Create-New and the trip is already auto-selected
      // (locked field), so popping the picker on top would be redundant.
      if (autoOpenPicker && !initialSelectedTripId) {
        console.log(TAG, 'auto-opening trip picker on visible (back-nav restore)');
        setTripPickerOpen(true);
        loadTrips();
        onAutoOpenPickerHandled?.();
      } else if (autoOpenPicker && initialSelectedTripId) {
        // Still consume the flag so the parent state goes back to false.
        console.log(TAG, 'skipping picker auto-open: trip already pre-selected');
        onAutoOpenPickerHandled?.();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Late-sync for initialSelectedTripId. Without this, the parent's state
  // updates from useFocusEffect (setPendingTripId + setPrimaryOpen) can land
  // in two separate React commits — the first commit toggles `visible` to
  // true with initialSelectedTripId still undefined, the open-effect above
  // runs and sets selectedTripId to null, then the second commit arrives
  // with initialSelectedTripId set but the open-effect doesn't re-run. This
  // standalone effect catches that second commit and syncs the selection.
  useEffect(() => {
    if (visible && initialSelectedTripId) {
      console.log(TAG, 'late-sync initialSelectedTripId →', initialSelectedTripId);
      setSelectedTripId(initialSelectedTripId);
      loadTrips();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialSelectedTripId]);

  useEffect(() => {
    if (visible && initialSelectedVisitId) {
      console.log(TAG, 'late-sync initialSelectedVisitId →', initialSelectedVisitId);
      setSelectedVisitId(initialSelectedVisitId);
      loadVisits();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialSelectedVisitId]);

  // Load full trip / visit objects only for the available_*_ids list — server
  // already filtered by used-trip exclusion and (for trips) source location.
  const loadTrips = useCallback(async () => {
    setLoadingPicker(true);
    try {
      // Always include the just-created `initialSelectedTripId` even when the
      // server's `available_trip_ids` doesn't list it yet (e.g. the user tapped
      // Start Trip in VehicleTrackingForm, so it dropped out of the draft pool).
      const idSet = new Set((availableTripIds || []).map(Number).filter(Boolean));
      if (initialSelectedTripId) idSet.add(Number(initialSelectedTripId));
      const ids = [...idSet];
      if (!ids.length) { setTrips([]); return; }
      const rows = await readVehicleTrackingForTripIdsOdoo(ids);
      // Source-location filter mirrors the web view's domain: when we know the
      // previous trip's destination, only show trips that start there. Always
      // exempt the just-created id from the filter — otherwise the user lands
      // on the CTA instead of seeing their newly-created trip.
      let filtered = rows || [];
      if (previousDestinationId) {
        const prevId = Number(previousDestinationId);
        const keepId = initialSelectedTripId ? Number(initialSelectedTripId) : null;
        filtered = filtered.filter((t) => {
          const src = Array.isArray(t.source_id) ? t.source_id[0] : t.source_id;
          return Number(src) === prevId || (keepId !== null && Number(t.id) === keepId);
        });
      }
      console.log(TAG, 'loadTrips', {
        raw: rows?.length || 0,
        afterSourceFilter: filtered.length,
        previousDestinationId,
        initialSelectedTripId,
      });
      setTrips(filtered);
    } catch (e) {
      setTrips([]);
    } finally {
      setLoadingPicker(false);
    }
  }, [availableTripIds, previousDestinationId, initialSelectedTripId]);

  const loadVisits = useCallback(async () => {
    setLoadingPicker(true);
    try {
      // Mirror loadTrips: always include the freshly-created visit id, so the
      // sheet can auto-select it even if the server hasn't refreshed
      // `available_visit_ids` yet.
      const idSet = new Set((availableVisitIds || []).map(Number).filter(Boolean));
      if (initialSelectedVisitId) idSet.add(Number(initialSelectedVisitId));
      const ids = [...idSet];
      if (!ids.length) { setVisits([]); return; }
      const rows = await readCustomerVisitsByIdsOdoo(ids);
      console.log(TAG, 'loadVisits', { raw: rows?.length || 0, initialSelectedVisitId });
      setVisits(rows || []);
    } catch (e) {
      setVisits([]);
    } finally {
      setLoadingPicker(false);
    }
  }, [availableVisitIds, initialSelectedVisitId]);

  const selectedTrip = useMemo(
    () => trips.find((t) => Number(t.id) === Number(selectedTripId)) || null,
    [trips, selectedTripId]
  );
  const selectedVisit = useMemo(
    () => visits.find((v) => Number(v.id) === Number(selectedVisitId)) || null,
    [visits, selectedVisitId]
  );

  // When the selected trip already carries a non-zero `start_km` from
  // VehicleTrackingForm, surface it as a caption + skip the manual input.
  // Null means "fall back to the editable Start KM field".
  const tripStartKm = useMemo(() => {
    const v = selectedTrip?.start_km;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [selectedTrip]);

  const handleSave = () => {
    console.log(TAG, 'Save clicked', { mode, selectedTripId, selectedVisitId, startKm, returnLegType, tripStartKm });
    if (!selectedTripId) {
      console.warn(TAG, '  validation failed: no trip picked');
      setErrorText('Please pick a trip.'); return;
    }
    const km = tripStartKm != null ? tripStartKm : Number(startKm);
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

              {/* Trip picker — when outbound mode + we have a previous destination
                  AND nothing is selected yet, hide the picker and surface a
                  direct "Create New Trip" CTA. The picker re-appears as soon as
                  a trip is selected (either by Create-New return-handshake or
                  by the existing picker path elsewhere). */}
              <Text style={styles.label}>Source Trip *</Text>
              {selectedTrip ? (
                <>
                  {/* Locked display once a trip is assigned. The X clears the
                      selection so the Create CTA returns — same UX the Odoo
                      module gives via its "remove" badge on a Many2one. */}
                  <View style={styles.lockedField}>
                    <Text style={styles.fieldVal} numberOfLines={1}>
                      {selectedTrip.ref || `Trip #${selectedTrip.id}`}
                    </Text>
                    <TouchableOpacity
                      onPress={() => { setSelectedTripId(null); setErrorText(''); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={saving}
                    >
                      <MaterialIcons name="close" size={18} color="#888" />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.detail}>
                    {(selectedTrip.source_id?.[1] || selectedTrip.source || '')} → {(selectedTrip.destination_id?.[1] || selectedTrip.destination || '')}
                  </Text>
                </>
              ) : (mode === 'outbound' && previousDestinationId && onCreateNewTrip) ? (
                <TouchableOpacity
                  style={styles.createCta}
                  onPress={onCreateNewTrip}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  <View style={styles.createCtaIcon}>
                    <MaterialIcons name="add" size={18} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.createCtaTitle}>Create New Trip</Text>
                    <Text style={styles.createCtaSub}>Open Vehicle Tracking — source pre-filled to your last destination</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={FIELD_COLOR} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.fieldBtn}
                  onPress={() => { setTripPickerOpen(true); loadTrips(); }}
                  disabled={saving}
                >
                  <Text style={[styles.fieldVal, styles.placeholder]} numberOfLines={1}>
                    Tap to select a trip…
                  </Text>
                  <MaterialIcons name="chevron-right" size={20} color="#888" />
                </TouchableOpacity>
              )}

              {/* Start KM — fetched from the selected trip's start_km when
                  available, shown as its own labelled row directly under
                  Source Trip. Read-only locked display matches the Source
                  Trip selected-trip field above. Falls back to an editable
                  input when the trip lacks a non-zero start_km (legacy data
                  or rare edge case). */}
              {tripStartKm != null ? (
                <>
                  <Text style={styles.label}>Start KM</Text>
                  <View style={styles.lockedField}>
                    <Text style={styles.fieldVal} numberOfLines={1}>{tripStartKm} km</Text>
                  </View>
                </>
              ) : (
                <>
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
                </>
              )}

              {/* Visit picker (outbound only) — gated on selectedTrip so the
                  field only appears AFTER a source trip is attached. Mirrors
                  the Odoo module's "Add Additional Trip" form, where the
                  Visit row reveals itself only once Source Trip has a value.
                  Same Create-CTA shortcut as the trip block above. */}
              {needsVisit && selectedTrip ? (
                <>
                  <Text style={styles.label}>Customer Visit *</Text>
                  {selectedVisit ? (
                    /* Locked display with X to clear — same pattern as the
                        trip field above. */
                    <View style={styles.lockedField}>
                      <Text style={styles.fieldVal} numberOfLines={1}>
                        {`${selectedVisit.name || `Visit #${selectedVisit.id}`} — ${(selectedVisit.partner_id?.[1] || selectedVisit.customer || '')}`}
                      </Text>
                      <TouchableOpacity
                        onPress={() => { setSelectedVisitId(null); setErrorText(''); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        disabled={saving}
                      >
                        <MaterialIcons name="close" size={18} color="#888" />
                      </TouchableOpacity>
                    </View>
                  ) : onCreateNewVisit ? (
                    <TouchableOpacity
                      style={styles.createCta}
                      onPress={() => {
                        // Pass the selected trip's purpose_of_visit_id so the
                        // VisitForm can prefill its Purpose dropdown — only
                        // this entry path (visit-from-trip) carries that
                        // information; other VisitForm openers don't.
                        const pid = Array.isArray(selectedTrip?.purpose_of_visit_id)
                          ? selectedTrip.purpose_of_visit_id[0]
                          : selectedTrip?.purpose_of_visit_id;
                        console.log(TAG, 'Create New Visit tapped — forwarding purposeOfVisitId:', pid);
                        onCreateNewVisit({ purposeOfVisitId: pid || null });
                      }}
                      disabled={saving}
                      activeOpacity={0.85}
                    >
                      <View style={styles.createCtaIcon}>
                        <MaterialIcons name="add" size={18} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.createCtaTitle}>Create New Visit</Text>
                        <Text style={styles.createCtaSub}>Open Customer Visit form to log a new visit</Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={22} color={FIELD_COLOR} />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.fieldBtn}
                      onPress={() => { setVisitPickerOpen(true); loadVisits(); }}
                      disabled={saving}
                    >
                      <Text style={[styles.fieldVal, styles.placeholder]} numberOfLines={1}>
                        Tap to select a visit…
                      </Text>
                      <MaterialIcons name="chevron-right" size={20} color="#888" />
                    </TouchableOpacity>
                  )}
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
        previousDestinationId={previousDestinationId}
        newTripId={initialSelectedTripId}
        onClose={() => setTripPickerOpen(false)}
        onSelect={(t) => { setSelectedTripId(t?.id); setTripPickerOpen(false); }}
        onCreateNew={onCreateNewTrip ? () => { setTripPickerOpen(false); onCreateNewTrip(); } : undefined}
        onEditTrip={onEditTrip ? (t) => { setTripPickerOpen(false); onEditTrip(t); } : undefined}
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
  // Read-only display once the trip/visit is assigned. Hosts the value text
  // and a trailing X button that clears the selection.
  lockedField: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F0F4F8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12,
    borderLeftWidth: 3, borderLeftColor: FIELD_COLOR,
  },
  fieldVal: { flex: 1, fontSize: 13, color: '#222', fontFamily: FONT_FAMILY.urbanistMedium },
  placeholder: { color: '#999' },
  detail: { fontSize: 11, color: '#777', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 4 },
  createCta: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5F9FF', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: FIELD_COLOR, borderStyle: 'dashed',
  },
  createCtaIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: FIELD_COLOR,
    alignItems: 'center', justifyContent: 'center',
  },
  createCtaTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR },
  createCtaSub: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
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
