import React, { useEffect, useState, useCallback } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import { getCurrentFix, distanceMeters, DEST_VERIFY_RADIUS_M } from '@utils/geoVerify';

const FIELD_COLOR = '#1976D2';
// Grep "[FA-CLOSE]" to trace the End-KM dialog: open, validation, Save.
const TAG = '[FA-CLOSE]';

// Modal shown before any "next trip" button when the previous trip is still
// open. Mirrors the web Close-Previous-Trip dialog: enter End KM, click
// Save & Exit. Validates End KM > previous Start KM. Also MANDATORY destination
// GPS check: the driver must be within `verifyRadiusM` of the trip's destination
// to close (when the destination has coordinates and GPS is available).
const ClosePreviousTripSheet = ({
  visible, previousTripRef, previousStartKm, saving, onSave, onClose,
  // Optional overrides so the same popup can serve "starting next trip"
  // (default) and "checking out" (callers pass checkout-flavoured strings).
  title = 'Close Previous Trip',
  disclaimer,
  saveLabel = 'Save & Exit',
  // Destination verification
  destinationCoords = null,   // { latitude, longitude } | null
  destinationName = '',
  verifyRadiusM = DEST_VERIFY_RADIUS_M,
}) => {
  const [endKm, setEndKm] = useState('');
  const [errorText, setErrorText] = useState('');
  // status: idle | checking | verified | too_far | unavailable | no_coords
  const [verify, setVerify] = useState({ status: 'idle', distance: null });
  // Destination verify is "retry once, then skip" (matches the source check):
  // the 1st too-far Save tap blocks with a retry hint; the 2nd saves anyway.
  const [saveAttempts, setSaveAttempts] = useState(0);

  // Run the destination GPS check. 'too_far' is the only state that BLOCKS Save;
  // 'unavailable'/'no_coords' allow close (so drivers aren't trapped).
  const runVerify = useCallback(async () => {
    if (!destinationCoords || destinationCoords.latitude == null || destinationCoords.longitude == null) {
      setVerify({ status: 'no_coords', distance: null });
      return;
    }
    setVerify({ status: 'checking', distance: null });
    const fix = await getCurrentFix();
    if (fix.source === 'denied' || fix.source === 'stale' || fix.source === 'unavailable') {
      console.log(TAG, 'verify: GPS unavailable —', fix.source);
      setVerify({ status: 'unavailable', distance: null });
      return;
    }
    const raw = distanceMeters(fix.latitude, fix.longitude, destinationCoords.latitude, destinationCoords.longitude);
    const eff = Math.max(0, raw - (fix.accuracy || 0));
    const ok = eff <= verifyRadiusM;
    console.log(TAG, 'verify:', { raw: Math.round(raw), accuracy: Math.round(fix.accuracy || 0), effective: Math.round(eff), radius: verifyRadiusM, source: fix.source, ok });
    setVerify({ status: ok ? 'verified' : 'too_far', distance: eff, accuracy: fix.accuracy || 0 });
  }, [destinationCoords, verifyRadiusM]);

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
        hasDestCoords: !!destinationCoords,
      });
      setEndKm('');
      setErrorText('');
      setVerify({ status: 'idle', distance: null });
      setSaveAttempts(0);
      // Auto-verify on open so the driver immediately sees their status.
      runVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Save is disabled only while the check is actively running. When too_far the
  // button stays ENABLED so tapping it surfaces a red error (chosen UX).
  const verifyChecking = verify.status === 'checking';

  const handleSave = () => {
    console.log(TAG, 'Save clicked', { endKm, previousStartKm, verifyStatus: verify.status });
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
    // Verify gate — only the 'verified'/'unavailable'/'no_coords' states may save.
    if (destinationCoords) {
      if (verify.status === 'checking' || verify.status === 'idle') {
        console.warn(TAG, '  blocked: still verifying location');
        setErrorText('Verifying your location — please wait…');
        return;
      }
      if (verify.status === 'too_far') {
        // Retry once, then skip: 1st tap blocks with a hint, 2nd tap saves anyway.
        if (saveAttempts >= 1) {
          console.warn(TAG, '  too_far but 2nd attempt — skipping verify, saving anyway');
        } else {
          console.warn(TAG, '  blocked: too far from destination (retry available)');
          setSaveAttempts((a) => a + 1);
          setErrorText(`You're ${Math.round(verify.distance)} m from the destination — move within ${verifyRadiusM} m, or tap ${saveLabel} again to save anyway.`);
          return;
        }
      }
      if (verify.status === 'unavailable') {
        // Couldn't get a GPS fix. Retry once: 1st tap re-checks and blocks with
        // a hint, 2nd tap enables the save so the driver isn't trapped.
        if (saveAttempts >= 1) {
          console.warn(TAG, '  unavailable but 2nd attempt — saving anyway');
        } else {
          console.warn(TAG, '  blocked: GPS unavailable — re-checking (retry available)');
          setSaveAttempts((a) => a + 1);
          runVerify();
          setErrorText(`Couldn't get your location — re-checking. Tap ${saveLabel} again to continue.`);
          return;
        }
      }
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

            {/* Mandatory destination verification — shown only when the trip has
                destination coordinates. Must be within radius to enable Save. */}
            {destinationCoords ? (
              <View style={[
                styles.verifyBox,
                verify.status === 'verified' && styles.verifyOk,
                verify.status === 'too_far' && styles.verifyBad,
              ]}>
                <View style={styles.verifyRow}>
                  <MaterialIcons name="place" size={16} color={FIELD_COLOR} />
                  <Text style={styles.verifyTitle} numberOfLines={1}>
                    Destination{destinationName ? `: ${destinationName}` : ''}
                  </Text>
                  <TouchableOpacity onPress={runVerify} disabled={saving || verify.status === 'checking'}>
                    {verify.status === 'checking'
                      ? <ActivityIndicator size="small" color={FIELD_COLOR} />
                      : <Text style={styles.recheckText}>Re-check</Text>}
                  </TouchableOpacity>
                </View>
                <Text style={[
                  styles.verifyStatus,
                  verify.status === 'verified' && { color: '#2E7D32' },
                  verify.status === 'too_far' && { color: '#C62828' },
                  verify.status === 'unavailable' && { color: '#B26A00' },
                ]}>
                  {verify.status === 'checking' ? 'Getting an accurate fix…'
                    : verify.status === 'verified' ? `✓ Verified — ${Math.round(verify.distance)} m away (±${Math.round(verify.accuracy || 0)} m accuracy)`
                    : verify.status === 'too_far' ? `✗ ${Math.round(verify.distance)} m away — move within ${verifyRadiusM} m (±${Math.round(verify.accuracy || 0)} m)`
                    : verify.status === 'unavailable' ? "GPS unavailable — can't verify (you may still close)"
                    : 'Tap Re-check to verify your location'}
                </Text>
              </View>
            ) : null}

            {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, (saving || verifyChecking) && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving || verifyChecking}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : verifyChecking
                    ? <><ActivityIndicator color="#fff" size="small" /><Text style={styles.saveText}>Verifying…</Text></>
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
  verifyBox: { marginTop: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E0E0E0', backgroundColor: '#FAFAFA' },
  verifyOk: { borderColor: '#A5D6A7', backgroundColor: '#F1F8F2' },
  verifyBad: { borderColor: '#EF9A9A', backgroundColor: '#FDECEA' },
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  verifyTitle: { flex: 1, fontSize: 12.5, fontFamily: FONT_FAMILY.urbanistBold, color: '#333' },
  recheckText: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR },
  verifyStatus: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 6 },
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
