import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

const FIELD_COLOR = '#1976D2';
// Grep "[FA-CLOSE]" to trace the End-KM dialog: open, validation, Save.
const TAG = '[FA-CLOSE]';

// Modal shown before any "next trip" button when the previous trip is still
// open. Mirrors the web Close-Previous-Trip dialog: enter End KM, click
// Save & Exit. Validates End KM > previous Start KM.
const ClosePreviousTripSheet = ({
  visible, previousTripRef, previousStartKm, saving, onSave, onClose,
  // Optional overrides so the same popup can serve "starting next trip"
  // (default) and "checking out" (callers pass checkout-flavoured strings).
  title = 'Close Previous Trip',
  disclaimer,
  saveLabel = 'Save & Exit',
}) => {
  const [endKm, setEndKm] = useState('');
  const [errorText, setErrorText] = useState('');

  // See TripFormSheet — deps tightened to `[visible]` so the effect
  // doesn't re-fire on every parent render (which churned the log).
  useEffect(() => {
    if (visible) {
      console.log(TAG, 'open', {
        previousTripRef,
        previousStartKm,
        title,
        saveLabel,
        hasCustomDisclaimer: !!disclaimer,
      });
      setEndKm('');
      setErrorText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleSave = () => {
    console.log(TAG, 'Save clicked', { endKm, previousStartKm });
    const n = Number(endKm);
    if (!Number.isFinite(n) || n <= 0) {
      console.warn(TAG, '  validation failed: end_km <= 0');
      setErrorText('Please enter End KM (a number greater than 0).');
      return;
    }
    if (n <= (Number(previousStartKm) || 0)) {
      console.warn(TAG, '  validation failed: end_km not > start_km');
      setErrorText(`End KM must be greater than Start KM (${previousStartKm || 0}).`);
      return;
    }
    console.log(TAG, '  validation OK → onSave');
    setErrorText('');
    onSave(n);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
          <View style={styles.card}>
            <View style={styles.header}>
              <MaterialIcons name="warning-amber" size={20} color="#F9A825" />
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={onClose} disabled={saving}>
                <MaterialIcons name="close" size={20} color="#888" />
              </TouchableOpacity>
            </View>
            <View style={styles.disclaimerBox}>
              {disclaimer ? (
                <Text style={styles.disclaimerText}>{disclaimer}</Text>
              ) : (
                <Text style={styles.disclaimerText}>
                  You're starting the next trip. Enter the <Text style={{ fontFamily: FONT_FAMILY.urbanistBold }}>End KM</Text> for{' '}
                  <Text style={{ fontFamily: FONT_FAMILY.urbanistBold }}>{previousTripRef || 'previous trip'}</Text> and click Save & Exit.
                  The trip will be ended automatically and the next trip's popup will open.
                </Text>
              )}
            </View>
            <Text style={styles.label}>End KM</Text>
            <View style={styles.kmRow}>
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                placeholder={`> ${previousStartKm || 0}`}
                value={endKm}
                onChangeText={(t) => { setEndKm(t.replace(/[^0-9]/g, '')); setErrorText(''); }}
                editable={!saving}
              />
              <Text style={styles.unit}>km</Text>
            </View>
            <Text style={styles.helper}>Start KM was {previousStartKm || 0}. End KM must be higher.</Text>
            {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <><MaterialIcons name="check" size={16} color="#fff" /><Text style={styles.saveText}>{saveLabel}</Text></>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, width: '100%', maxWidth: 420,
    ...Platform.select({
      android: { elevation: 8 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
    }),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#333' },
  disclaimerBox: { backgroundColor: '#FFF8E1', borderLeftWidth: 3, borderLeftColor: '#F9A825', padding: 10, borderRadius: 8, marginTop: 10 },
  disclaimerText: { fontSize: 12, color: '#7A4F00', fontFamily: FONT_FAMILY.urbanistMedium, lineHeight: 18 },
  label: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#666', marginTop: 14, marginBottom: 4 },
  kmRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222',
  },
  unit: { fontSize: 13, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  helper: { fontSize: 11, color: '#888', fontFamily: FONT_FAMILY.urbanistMedium, marginTop: 4 },
  error: { fontSize: 12, color: '#D32F2F', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, backgroundColor: '#EEE', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  saveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 12, backgroundColor: FIELD_COLOR,
    ...Platform.select({
      android: { elevation: 2 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4 },
    }),
  },
  saveText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default ClosePreviousTripSheet;
