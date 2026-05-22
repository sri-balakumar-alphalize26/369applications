import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { StyledAlertModal } from '@components/Modal';
import { createFuelLogOdoo } from '@api/services/generalApi';

const FIELD_COLOR = '#1976D2';
const TAG = '[FA-FUEL]';

const m2oId = (v) => (Array.isArray(v) ? v[0] : v);

// Mirrors VehicleTrackingForm's Add Fuel popup feature-for-feature:
// - Amount / Litres / Odometer inputs (Odometer placeholder shows trip's start_km).
// - Odometer Image + Fuel Invoice — Camera/Gallery via StyledAlertModal.
// - In-app camera (expo-camera) so capture is one-tap, no OS OK step that
//   crashes the parent modal on Android.
// - Silent GPS capture from any-age cache.
const AddFuelSheet = ({ visible, trip, onClose, onSaved }) => {
  const [amount, setAmount] = useState('');
  const [litre, setLitre] = useState('');
  const [odometer, setOdometer] = useState('');
  const [odometerImageUri, setOdometerImageUri] = useState('');
  const [odometerImageBase64, setOdometerImageBase64] = useState('');
  const [fuelInvoiceUri, setFuelInvoiceUri] = useState('');
  const [fuelInvoiceBase64, setFuelInvoiceBase64] = useState('');
  const [gpsLat, setGpsLat] = useState(null);
  const [gpsLng, setGpsLng] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Source-picker (Camera/Gallery/Cancel) — mirrors VTF's StyledAlertModal.
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [sourcePickerTarget, setSourcePickerTarget] = useState(null); // 'odometer' | 'fuel'

  // In-app camera (expo-camera) — one-tap shutter, no OS OK step.
  const [showInAppCamera, setShowInAppCamera] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const inAppCameraRef = useRef(null);

  // Reset on open + silent GPS capture (any-age cache so it's instant).
  // Live Balanced refresh is skipped when the cache already produced a fix.
  useEffect(() => {
    if (visible) {
      console.log(TAG, 'open', { tripId: trip?.id, tripRef: trip?.ref });
      setAmount('');
      setLitre('');
      setOdometer('');
      setOdometerImageUri('');
      setOdometerImageBase64('');
      setFuelInvoiceUri('');
      setFuelInvoiceBase64('');
      setGpsLat(null);
      setGpsLng(null);
      setError('');
      (async () => {
        let haveInstant = false;
        try {
          const last = await Location.getLastKnownPositionAsync({});
          if (last?.coords) {
            setGpsLat(last.coords.latitude);
            setGpsLng(last.coords.longitude);
            haveInstant = true;
            console.log(TAG, 'GPS instant fix:', last.coords.latitude, last.coords.longitude);
          }
        } catch (_) {}
        if (haveInstant) return;
        try {
          const live = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout')), 4000)),
          ]);
          if (live?.coords) {
            setGpsLat(live.coords.latitude);
            setGpsLng(live.coords.longitude);
            console.log(TAG, 'GPS live refresh:', live.coords.latitude, live.coords.longitude);
          }
        } catch (e) {
          console.log(TAG, 'GPS live fetch failed (no cache, no live):', e?.message);
        }
      })();
    }
  }, [visible, trip?.id, trip?.ref]);

  const setImage = (target, uri, base64) => {
    if (target === 'odometer') {
      setOdometerImageUri(uri);
      setOdometerImageBase64(base64 || '');
    } else if (target === 'fuel') {
      setFuelInvoiceUri(uri);
      setFuelInvoiceBase64(base64 || '');
    }
  };

  const readBase64 = async (uri) => {
    try { return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }); }
    catch { return ''; }
  };

  // Pressing "Odometer Image" or "Fuel Invoice" opens the source picker.
  const openSourcePicker = (target) => {
    setSourcePickerTarget(target);
    setSourcePickerOpen(true);
  };

  // Source picker's "Camera" / "Gallery" hand off to these.
  const dispatchSource = (source) => {
    setSourcePickerOpen(false);
    const target = sourcePickerTarget;
    setSourcePickerTarget(null);
    if (source === 'camera') openInAppCamera(target);
    else if (source === 'gallery') launchGallery(target);
  };

  const openInAppCamera = async (target) => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required');
        return;
      }
      setSourcePickerTarget(target);  // remember the target until capture lands
      // tiny delay so the source-picker modal fully dismisses before the
      // camera modal mounts — avoids the Android nested-modal flicker.
      setTimeout(() => setShowInAppCamera(true), 80);
    } catch (e) {
      console.error(TAG, 'openInAppCamera error:', e?.message);
    }
  };

  const captureFromInAppCamera = async () => {
    if (isCapturingPhoto || !inAppCameraRef.current) return;
    setIsCapturingPhoto(true);
    try {
      const photo = await inAppCameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
        exif: false,
        base64: true,
      });
      console.log(TAG, 'in-app camera captured:', photo?.uri);
      setShowInAppCamera(false);
      // yield so the camera native view tears down before state mutates
      await new Promise((r) => setTimeout(r, 100));
      if (photo?.uri) setImage(sourcePickerTarget, photo.uri, photo.base64 || '');
      setSourcePickerTarget(null);
    } catch (e) {
      console.error(TAG, 'capture failed:', e?.message);
      setShowInAppCamera(false);
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const launchGallery = async (target) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Photo library permission is required'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      const b64 = asset.base64 || await readBase64(asset.uri);
      setImage(target, asset.uri, b64);
      console.log(TAG, `${target} image (gallery) chosen`);
    } catch (e) {
      console.error(TAG, 'gallery failed:', e?.message);
    }
  };

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
    console.log(TAG, 'save start', { tripId: trip.id, amount: amt, litre: ltr, odometer: odo, hasOdoImg: !!odometerImageBase64, hasInvoiceImg: !!fuelInvoiceBase64, gpsLat, gpsLng });
    try {
      const res = await createFuelLogOdoo({
        tripId: Number(trip.id),
        vehicleId: m2oId(trip.vehicle_id),
        driverId: m2oId(trip.driver_id),
        amount: amt,
        fuelLevel: ltr,
        odometer: odo,
        odometerImageUri: odometerImageUri || undefined,
        odometerImageBase64: odometerImageBase64 || undefined,
        fuelInvoiceUri: fuelInvoiceUri || undefined,
        fuelInvoiceBase64: fuelInvoiceBase64 || undefined,
        gpsLat: gpsLat != null ? String(gpsLat) : undefined,
        gpsLong: gpsLng != null ? String(gpsLng) : undefined,
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
          <View
            style={styles.sheet}
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
          >
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
                {gpsLat != null && gpsLng != null ? ` · GPS captured` : ' · capturing GPS…'}
              </Text>
            ) : null}

            <ScrollView contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              <View style={styles.rowSplit}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Fuel Amount *</Text>
                  <TextInput style={styles.input} value={amount} onChangeText={(t) => { setAmount(t.replace(/[^0-9.]/g, '')); setError(''); }} placeholder="Amount" keyboardType="numeric" editable={!saving} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Fuel Litres *</Text>
                  <TextInput style={styles.input} value={litre} onChangeText={(t) => { setLitre(t.replace(/[^0-9.]/g, '')); setError(''); }} placeholder="Litres" keyboardType="numeric" editable={!saving} />
                </View>
              </View>

              <Text style={styles.label}>Current Odometer *</Text>
              <TextInput
                style={styles.input}
                value={odometer}
                onChangeText={(t) => { setOdometer(t.replace(/[^0-9]/g, '')); setError(''); }}
                placeholder={trip?.start_km ? `Start KM: ${trip.start_km}` : 'Odometer reading'}
                keyboardType="numeric"
                editable={!saving}
              />

              <View style={styles.imageRow}>
                <View style={styles.imageCol}>
                  <Pressable style={styles.imageBtn} onPress={() => openSourcePicker('odometer')} disabled={saving}>
                    <MaterialCommunityIcons name="speedometer" size={14} color="#fff" />
                    <Text style={styles.imageBtnText}>Odometer Image</Text>
                  </Pressable>
                  {odometerImageUri ? (
                    <Image source={{ uri: odometerImageUri }} style={styles.thumb} />
                  ) : (
                    <Text style={styles.noFileText}>No image</Text>
                  )}
                </View>
                <View style={styles.imageCol}>
                  <Pressable style={styles.imageBtn} onPress={() => openSourcePicker('fuel')} disabled={saving}>
                    <MaterialCommunityIcons name="receipt" size={14} color="#fff" />
                    <Text style={styles.imageBtnText}>Fuel Invoice</Text>
                  </Pressable>
                  {fuelInvoiceUri ? (
                    <Image source={{ uri: fuelInvoiceUri }} style={styles.thumb} />
                  ) : (
                    <Text style={styles.noFileText}>No invoice</Text>
                  )}
                </View>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : (<><MaterialCommunityIcons name="check" size={16} color="#fff" /><Text style={styles.saveText}>Add Fuel</Text></>)}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      {/* Camera/Gallery picker — same branded modal VTF uses. */}
      <StyledAlertModal
        isVisible={sourcePickerOpen}
        message={sourcePickerTarget === 'odometer' ? 'Odometer Image' : 'Fuel Invoice'}
        confirmText="Camera"
        middleText="Gallery"
        cancelText="Cancel"
        onConfirm={() => dispatchSource('camera')}
        onMiddle={() => dispatchSource('gallery')}
        onCancel={() => { setSourcePickerOpen(false); setSourcePickerTarget(null); }}
      />

      {/* In-app camera — one-tap shutter, no OS OK step. */}
      <Modal
        visible={showInAppCamera}
        animationType="slide"
        onRequestClose={() => setShowInAppCamera(false)}
      >
        <View style={styles.cameraModalContainer}>
          <Camera
            ref={inAppCameraRef}
            style={styles.cameraView}
            type={Camera.Constants.Type.back}
          >
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraTopBar}>
                <TouchableOpacity
                  style={styles.cameraCloseBtn}
                  onPress={() => setShowInAppCamera(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>
                  {sourcePickerTarget === 'fuel' ? 'Fuel Invoice' : 'Odometer Image'}
                </Text>
                <View style={{ width: 40 }} />
              </View>
              <View style={styles.cameraBottomBar}>
                <TouchableOpacity
                  style={[styles.cameraShutterBtn, isCapturingPhoto && { opacity: 0.4 }]}
                  onPress={captureFromInAppCamera}
                  disabled={isCapturingPhoto}
                  activeOpacity={0.7}
                >
                  <View style={styles.cameraShutterInner} />
                </TouchableOpacity>
              </View>
            </View>
          </Camera>
        </View>
      </Modal>
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
  input: { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222' },
  imageRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  imageCol: { flex: 1, alignItems: 'flex-start', gap: 6 },
  imageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#444', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  imageBtnText: { color: '#fff', fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistBold },
  noFileText: { fontSize: 10.5, color: '#999', fontFamily: FONT_FAMILY.urbanistMedium },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#eee' },
  error: { fontSize: 12, color: '#D32F2F', fontFamily: FONT_FAMILY.urbanistBold, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  cancelBtn: { flex: 1, paddingVertical: 11, borderRadius: 8, backgroundColor: '#EEE', alignItems: 'center' },
  cancelText: { color: '#555', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  saveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 8, backgroundColor: '#198754' },
  saveText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  // In-app camera (mirrors VTF styles).
  cameraModalContainer: { flex: 1, backgroundColor: '#000' },
  cameraView: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraTopBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 50, paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cameraCloseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  cameraTitle: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 16 },
  cameraBottomBar: { alignItems: 'center', paddingBottom: 50, paddingTop: 20, backgroundColor: 'rgba(0,0,0,0.4)' },
  cameraShutterBtn: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  cameraShutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
});

export default AddFuelSheet;
