import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import { createFuelLogOdoo } from '@api/services/generalApi';

const FIELD_COLOR = '#1976D2';
const TAG = '[FA-FUEL]';

const m2oId = (v) => (Array.isArray(v) ? v[0] : v);

// Lightweight Add Fuel popup — opens directly in the Field Attendance
// screen so the user doesn't have to bounce through VehicleTrackingForm.
// Calls createFuelLogOdoo to create a new vehicle.fuel.log against the
// given trip. Images / GPS are out of scope for now — those still live in
// VehicleTrackingForm's full Add Fuel popup.
const AddFuelSheet = ({ visible, trip, onClose, onSaved }) => {
  const [amount, setAmount] = useState('');
  const [litre, setLitre] = useState('');
  const [odometer, setOdometer] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      console.log(TAG, 'open', { tripId: trip?.id, tripRef: trip?.ref });
      setAmount('');
      setLitre('');
      setOdometer('');
      setError('');
    }
  }, [visible, trip?.id, trip?.ref]);

  const handleSave = async () => {
    const amt = Number(amount);
    const ltr = Number(litre);
    const odo = Number(odometer);
    if (!Number.isFinite(amt) || amt <= 0) { setError('Fuel Amount is required.'); return; }
    if (!Number.isFinite(ltr) || ltr <= 0) { setError('Fuel Litres is required.'); return; }
    if (!Number.isFinite(odo) || odo <= 0) { setError('Current Odometer is required.'); return; }
    if (!trip?.id) { setError('Trip not available — close and retry.'); return; }
    setError('');
    setSaving(true);
    console.log(TAG, 'save start', { tripId: trip.id, amount: amt, litre: ltr, odometer: odo });
    try {
      const res = await createFuelLogOdoo({
        tripId: Number(trip.id),
        vehicleId: m2oId(trip.vehicle_id),
        driverId: m2oId(trip.driver_id),
        amount: amt,
        fuelLevel: ltr,
        odometer: odo,
      });
      console.log(TAG, 'save OK', res);
      onSaved?.(res);
      onClose?.();
    } catch (e) {
      console.error(TAG, 'save threw:', e?.message);
      setError(e?.message || 'Failed to save fuel entry');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%', alignItems: 'center' }}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="gas-station" size={20} color="#198754" />
                <Text style={styles.title}>Add Fuel Entry</Text>
              </View>
              <TouchableOpacity onPress={onClose} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialCommunityIcons name="close" size={22} color="#333" />
              </TouchableOpacity>
            </View>

            {trip ? (
              <Text style={styles.tripCaption} numberOfLines={1}>
                For trip: {trip.ref || `#${trip.id}`}
                {Array.isArray(trip.vehicle_id) ? ` · ${trip.vehicle_id[1]}` : ''}
              </Text>
            ) : null}

            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <View style={styles.rowSplit}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Fuel Amount *</Text>
                  <TextInput
                    style={styles.input}
                    value={amount}
                    onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, '')); setError(''); }}
                    placeholder="Amount"
                    keyboardType="numeric"
                    editable={!saving}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Fuel Litres *</Text>
                  <TextInput
                    style={styles.input}
                    value={litre}
                    onChangeText={(t) => { setLitre(t.replace(/[^0-9.]/g, '')); setError(''); }}
                    placeholder="Litres"
                    keyboardType="numeric"
                    editable={!saving}
                  />
                </View>
              </View>

              <Text style={styles.label}>Current Odometer *</Text>
              <TextInput
                style={styles.input}
                value={odometer}
                onChangeText={(t) => { setOdometer(t.replace(/[^0-9]/g, '')); setError(''); }}
                placeholder="Odometer reading"
                keyboardType="numeric"
                editable={!saving}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <MaterialCommunityIcons name="check" size={16} color="#fff" />
                      <Text style={styles.saveText}>Add Fuel</Text>
                    </>
                  )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 },
  sheet: {
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
  tripCaption: { fontSize: 11.5, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium, marginBottom: 8 },
  rowSplit: { flexDirection: 'row', gap: 8 },
  label: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#666', marginTop: 12, marginBottom: 4 },
  input: {
    backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222',
  },
  error: { fontSize: 12, color: '#D32F2F', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  cancelBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, backgroundColor: '#EEE', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 8, backgroundColor: '#198754' },
  saveText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default AddFuelSheet;
