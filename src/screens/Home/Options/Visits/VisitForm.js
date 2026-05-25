import { Keyboard, View, Text, StyleSheet, TouchableOpacity, Image, Modal, PanResponder, Alert, Linking, Platform } from 'react-native'
import { Camera } from 'expo-camera'
import React, { useState, useEffect, useRef } from 'react'
import { NavigationHeader } from '@components/Header'
import { RoundedScrollContainer, SafeAreaView } from '@components/containers'
import { TextInput as FormInput } from '@components/common/TextInput'
import { formatDate } from '@utils/common/date'
import { setPendingNewVisit } from '@utils/newVisitChannel'
import { LoadingButton } from '@components/common/Button'
import CustomListModal from '@components/Modal/CustomListModal'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import * as DocumentPicker from 'expo-document-picker'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system'
import { Audio } from 'expo-av'
import MapView, { Marker } from 'react-native-maps'
import { showToast } from '@utils/common'
import { OverlayLoader } from '@components/Loader'
import { validateFields } from '@utils/validation'
import { COLORS, FONT_FAMILY } from '@constants/theme'
import { MaterialIcons } from '@expo/vector-icons'
import {
  fetchCustomersOdoo,
  fetchEmployeesOdoo,
  fetchVisitPurposesOdoo,
  fetchVisitPlanDetailsOdoo,
  createCustomerVisitOdoo,
} from '@api/services/generalApi'
import { useAuthStore } from '@stores/auth'

const PROXIMITY_LIMIT = 100;

const DURATION_OPTIONS = [
  { id: '0_15', label: '0 to 15 minutes' },
  { id: '15_30', label: '15 minutes to 30' },
  { id: '30_60', label: '30 minutes to 60' },
  { id: '60_plus', label: 'More than 60 minutes' },
];

const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const VisitForm = ({ navigation, route }) => {

  const { visitPlanId = "", pipelineId = "" } = route?.params || {};
  const currentUser = useAuthStore((state) => state.user);
  const [errors, setErrors] = useState({});
  const [isPurposeModalVisible, setIsPurposeModalVisible] = useState(false);
  const [isDurationModalVisible, setIsDurationModalVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [customersList, setCustomersList] = useState([]);
  const [distance, setDistance] = useState(null);
  const [imageUris, setImageUris] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceUri, setVoiceUri] = useState(null);
  // In-app camera modal — replaces the crashy OS launchCameraAsync.
  const [showInAppCamera, setShowInAppCamera] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const visitCameraRef = useRef(null);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef(null);
  const timerRef = useRef(null);

  const [formData, setFormData] = useState({
    customer: '',
    visitedBy: '',
    dateAndTime: new Date(),
    visitPurpose: '',
    visitDuration: '',
    remarks: '',
    longitude: null,
    latitude: null
  })

  const [dropdowns, setDropdowns] = useState({ customers: [], employees: [], visitPurpose: [] })
  // Set when device location services are off (or GPS read fails). Drives the
  // inline red banner with "Turn On Location" retry button.
  const [locationError, setLocationError] = useState('')

  const customerHasLocation = () => {
    if (!formData.customer?.id || !customersList.length) return false;
    const cust = customersList.find(c => c.id === formData.customer.id);
    return cust && cust.latitude && cust.longitude;
  };

  useEffect(() => {
    if (!formData.customer?.id || !formData.latitude || !formData.longitude || !customersList.length) {
      setDistance(null);
      return;
    }
    const cust = customersList.find(c => c.id === formData.customer.id);
    if (cust && cust.latitude && cust.longitude) {
      const dist = getDistanceInMeters(
        formData.latitude, formData.longitude,
        cust.latitude, cust.longitude
      );
      setDistance(Math.round(dist));
    } else {
      setDistance(null);
    }
  }, [formData.customer, formData.latitude, formData.longitude, customersList]);

  const isWithinProximity = distance !== null && distance <= PROXIMITY_LIMIT;
  const isProximityCheckRequired = customerHasLocation();

  const loadVisitPlan = async () => {
    if (!visitPlanId) return;
    setIsLoading(true);
    try {
      const detail = await fetchVisitPlanDetailsOdoo(visitPlanId);
      if (detail) {
        setFormData(prev => ({
          ...prev,
          customer: detail.customer ? { id: detail.customer.id, label: detail.customer.name } : '',
          visitedBy: detail.employee ? { id: detail.employee.id, label: detail.employee.name } : '',
          dateAndTime: detail.visit_date ? new Date(detail.visit_date) : new Date(),
          visitPurpose: detail.purpose ? { id: detail.purpose.id, label: detail.purpose.name } : '',
          remarks: detail.remarks || '',
        }));
      }
    } catch (error) {
      console.error('Error fetching visit plan details:', error);
      showToast({ type: 'error', title: 'Error', message: 'Failed to fetch visit plan details.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (visitPlanId) loadVisitPlan();
  }, [visitPlanId])

  // Verifies device location services are ON. On Android this surfaces the
  // exact "To continue, turn on device location" system dialog Google Maps
  // uses (via `enableNetworkProviderAsync`). iOS has no in-app equivalent —
  // we fall back to an Alert with an Open Settings shortcut.
  const ensureLocationServices = async () => {
    const enabled = await Location.hasServicesEnabledAsync();
    if (enabled) return true;

    if (Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
        const recheck = await Location.hasServicesEnabledAsync();
        if (recheck) return true;
      } catch (e) {
        console.log('[VisitForm] enableNetworkProviderAsync declined:', e?.message);
      }
    }

    return new Promise((resolve) => {
      Alert.alert(
        'Location is turned off',
        'Turn on Location to capture this customer visit accurately.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Open Settings', onPress: async () => { try { await Linking.openSettings(); } catch (_) {} resolve(false); } },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
  };

  const fetchLocation = async () => {
    try {
      const servicesOk = await ensureLocationServices();
      if (!servicesOk) {
        setLocationError('Location is off — turn it on and tap Turn On Location to capture this visit.');
        return;
      }
      setLocationError('');
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast({ type: 'error', title: 'Permission Denied', message: 'Location permission is required' });
        return;
      }
      // Fallback ladder mirroring VehicleTrackingForm's getCurrentLocation:
      //   1. Recent cached fix (≤ 5 min) — instant, no GPS work.
      //   2. Live LOW-accuracy fetch (network/wifi, 4 s timeout).
      //   3. Live BALANCED fetch (GPS + network, 8 s timeout).
      //   4. Any-age stale cache.
      // We deliberately do NOT request High accuracy — High forces GPS-only
      // and fails with "Current location is unavailable" when no satellite
      // lock is available (indoors, cold start, emulator). The `mayShowUserSettingsDialog`
      // flag still surfaces the Google-Maps system dialog if the user's
      // Location Mode is too low for Balanced.
      try {
        const prov = await Location.getProviderStatusAsync();
        console.log('[VisitForm] provider status:', JSON.stringify(prov));
      } catch (_) { /* status-probe is best-effort */ }

      const positionWithTimeout = (opts, timeoutMs) => Promise.race([
        Location.getCurrentPositionAsync(opts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout')), timeoutMs)),
      ]);

      let location = null;
      let usedCachedFix = false;

      // (1) any-age cache — instant display so the form isn't blank.
      try {
        location = await Location.getLastKnownPositionAsync({});
        if (location) {
          usedCachedFix = true;
          console.log('[VisitForm] INSTANT any-age cached fix (will refine in background)');
        }
      } catch (e) { console.log('[VisitForm] last-known cache failed:', e?.message); }

      // (2) live BALANCED — the accuracy the user actually needs. Longer
      // timeout (12 s) since this is the target, not a quick probe. LOW
      // accuracy step removed entirely — user explicitly asked for Balanced
      // every time, and LOW had been timing out for them anyway.
      if (!location) {
        try {
          location = await positionWithTimeout({
            accuracy: Location.Accuracy.Balanced,
            mayShowUserSettingsDialog: true,
          }, 12000);
          if (location) console.log('[VisitForm] got Balanced-accuracy fix');
        } catch (e) { console.log('[VisitForm] Balanced fetch failed:', e?.message); }
      }

      // (3) POST-LIVE cache re-check. Even when getCurrentPositionAsync times
      // out, Android's FusedLocationProvider often populates the cache as a
      // side-effect — so a follow-up getLastKnownPositionAsync succeeds where
      // the live call failed.
      if (!location) {
        try {
          location = await Location.getLastKnownPositionAsync({});
          if (location) console.log('[VisitForm] POST-LIVE cache populated');
        } catch (e) { console.log('[VisitForm] post-live cache failed:', e?.message); }
      }

      // If services flipped off during the ladder (rare race), re-prompt.
      if (!location) {
        const stillOn = await Location.hasServicesEnabledAsync();
        if (!stillOn) {
          const reTry = await ensureLocationServices();
          if (reTry) {
            try {
              location = await positionWithTimeout({
                accuracy: Location.Accuracy.Balanced,
                mayShowUserSettingsDialog: true,
              }, 8000);
            } catch (e) { console.log('[VisitForm] post-prompt Balanced failed:', e?.message); }
          } else {
            setLocationError('Location is off — turn it on and tap Turn On Location to capture this visit.');
            return;
          }
        }
      }

      if (!location) {
        setLocationError('Could not get a GPS fix yet. Move to an open area or near a window and tap Turn On Location.');
        return;
      }
      const lat = location.coords.latitude;
      const lng = location.coords.longitude;

      // Reverse geocode to get location name
      let locationName = '';
      try {
        const reverseGeocode = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (reverseGeocode && reverseGeocode.length > 0) {
          const place = reverseGeocode[0];
          const parts = [place.name, place.street, place.city, place.region, place.country].filter(Boolean);
          locationName = parts.join(', ');
        }
      } catch (geoError) {
        console.error('[VisitForm] reverse geocode error:', geoError);
      }

      setFormData(prev => ({
        ...prev,
        longitude: lng,
        latitude: lat,
        locationName,
      }));

      // Background refresh: if the initial display used a stale cached fix,
      // keep trying Balanced until it lands and silently upgrade the coords.
      // This gives "Balanced accuracy every time" without making the user
      // wait — the form shows last-known immediately and the precise coords
      // arrive a few seconds later.
      if (usedCachedFix) {
        console.log('[VisitForm] starting background Balanced refresh…');
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(async fresh => {
            if (!fresh?.coords) return;
            const fLat = fresh.coords.latitude;
            const fLng = fresh.coords.longitude;
            console.log('[VisitForm] background Balanced upgrade:', fLat, fLng);
            let fName = '';
            try {
              const rg = await Location.reverseGeocodeAsync({ latitude: fLat, longitude: fLng });
              if (rg && rg.length > 0) {
                const p = rg[0];
                fName = [p.name, p.street, p.city, p.region, p.country].filter(Boolean).join(', ');
              }
            } catch (_) { /* leave name as-is */ }
            setFormData(prev => ({
              ...prev,
              latitude: fLat,
              longitude: fLng,
              locationName: fName || prev.locationName,
            }));
          })
          .catch(err => console.log('[VisitForm] background Balanced refresh failed:', err?.message));
      }
    } catch (error) {
      console.error('[VisitForm] Error fetching location:', error);
      setLocationError('Could not read your location. Tap Turn On Location to retry.');
    }
  };

  useEffect(() => { fetchLocation(); }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [customers, employees, purposes] = await Promise.all([
          fetchCustomersOdoo(),
          fetchEmployeesOdoo(),
          fetchVisitPurposesOdoo(),
        ]);
        setCustomersList(customers);
        setDropdowns({
          customers: customers.map(c => ({ id: c.id, label: c.name })),
          employees: employees.map(e => ({ id: e.id, label: e.name })),
          visitPurpose: purposes.map(p => ({ id: p.id, label: p.name })),
        });
        // Prefill of Visit Purpose lives in its own effect below — must
        // re-run on every navigation, not just first mount.
        if (!formData.visitedBy) {
          const userName = currentUser?.related_profile?.name || currentUser?.name || '';
          const match = employees.find(e => e.name?.toLowerCase() === userName?.toLowerCase());
          if (match) {
            setFormData(prev => ({ ...prev, visitedBy: { id: match.id, label: match.name } }));
          }
        }
      } catch (error) {
        console.error("Error fetching dropdown data:", error);
      }
    };
    fetchData();

    // Background re-fetch when network flips back to online — silently
    // refreshes customers/employees/visit-purposes within ~1s of reconnect
    // so the dropdowns are always fresh after returning from offline.
    let networkUnsub = null;
    try {
      const networkStatus = require('@utils/networkStatus').default;
      networkUnsub = networkStatus.subscribe((online) => {
        if (online) {
          console.log('[VisitForm] back online — silently refreshing dropdowns');
          fetchData();
        }
      });
    } catch (e) { console.log('[VisitForm] networkStatus.subscribe failed:', e?.message); }
    return () => { if (typeof networkUnsub === 'function') networkUnsub(); };
  }, []);

  // Prefill Visit Purpose from FieldAttendance's "Create New Visit" CTA.
  // Lives in its own effect (not the mount one) because React Navigation
  // reuses the VisitForm screen instance when navigate() targets a screen
  // already in the stack — the mount effect doesn't re-fire on re-entry,
  // so the previous trip's prefilled purpose would persist. Watching the
  // route params + dropdown list makes this self-correcting.
  useEffect(() => {
    const prefillPurposeId = route?.params?.prefillPurposeId;
    const prefillPurposeName = route?.params?.prefillPurposeName;
    if (!prefillPurposeId && !prefillPurposeName) return;
    if (!dropdowns.visitPurpose?.length) return;
    console.log('[VisitForm] (re-entry) prefill attempt:', { prefillPurposeId, prefillPurposeName, visitPurposesLoaded: dropdowns.visitPurpose.length });
    let matchPurpose = null;
    if (prefillPurposeName) {
      const want = String(prefillPurposeName).trim().toLowerCase();
      matchPurpose = dropdowns.visitPurpose.find(p => String(p.label).trim().toLowerCase() === want);
      if (matchPurpose) console.log('[VisitForm] (re-entry) matched by NAME:', matchPurpose.label, '(id', matchPurpose.id, ')');
    }
    if (!matchPurpose && prefillPurposeId && !prefillPurposeName) {
      matchPurpose = dropdowns.visitPurpose.find(p => Number(p.id) === Number(prefillPurposeId));
      if (matchPurpose) console.log('[VisitForm] (re-entry) matched by ID fallback:', matchPurpose.label, '(id', matchPurpose.id, ')');
    }
    if (matchPurpose) {
      console.log('[VisitForm] (re-entry) applying →', { id: matchPurpose.id, label: matchPurpose.label });
      setFormData(prev => ({ ...prev, visitPurpose: { id: matchPurpose.id, label: matchPurpose.label } }));
    } else {
      console.warn('[VisitForm] (re-entry) prefill FAILED — add a visit.purpose record named exactly:', prefillPurposeName, '— params:', { prefillPurposeId, prefillPurposeName });
    }
  }, [route?.params?.prefillPurposeId, route?.params?.prefillPurposeName, dropdowns.visitPurpose]);

  // Voice recording functions
  const startRecording = async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        showToast({ type: 'error', title: 'Permission Denied', message: 'Microphone permission is required' });
        return;
      }
      // Clean up any existing recording
      if (recordingRef.current) {
        try { await recordingRef.current.stopAndUnloadAsync(); } catch (e) {}
        recordingRef.current = null;
      }
      // Force clear any stale native recorder (expo-av bug: cleanup not awaited)
      try {
        const tempRec = new Audio.Recording();
        tempRec._canRecord = true;
        tempRec._isDoneRecording = false;
        await tempRec.stopAndUnloadAsync();
      } catch (e) {}
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(prev => prev + 1), 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      showToast({ type: 'error', title: 'Error', message: error?.message || 'Failed to start recording' });
    }
  };

  const stopRecording = async () => {
    try {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setIsRecording(false);
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        const uri = recordingRef.current.getURI();
        // Auto-commit: the player UI shows immediately. User can discard via
        // the delete icon if they want to redo it (same UX as removing a
        // photo thumbnail from the Photos section).
        setVoiceUri(uri);
        recordingRef.current = null;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (error) {
      console.error('Error stopping recording:', error);
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Inline image-picker handlers — replaces the old generic ActionModal
  // tile so the Visits form can show a dedicated, styled "Add Photo" UX.
  //
  // CRITICAL: every picked URI passes through `downsizeImage` BEFORE landing in
  // state. Phone cameras output 12–50MP JPEGs (2–6 MB each); keeping them in
  // RN's JS heap + base64 at submit time causes Android OOM → app reloads.
  // Resizing to max 1024px + quality 0.5 brings each image down to ~150–300 KB.
  // FORCE LOW MEMORY: aggressive resize chain. Picker writes a small JPEG to
  // disk; we wait one tick for the picker UI to fully tear down, then resize
  // to 800px / quality 0.4. Two-pass fallback to 480px if the first fails.
  const downsizeImage = async (uri) => {
    console.log('[resize] entering downsizeImage with uri:', uri);
    try {
      console.log('[resize] pass-1: calling manipulateAsync(800px @ 0.4)');
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 800 } }],
        { compress: 0.4, format: ImageManipulator.SaveFormat.JPEG }
      );
      console.log('[resize] pass-1 OK →', result.uri);
      return result.uri;
    } catch (e) {
      console.log('[resize] pass-1 FAILED:', e?.message);
      try {
        console.log('[resize] pass-2: calling manipulateAsync(480px @ 0.3)');
        const tiny = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 480 } }],
          { compress: 0.3, format: ImageManipulator.SaveFormat.JPEG }
        );
        console.log('[resize] pass-2 OK →', tiny.uri);
        return tiny.uri;
      } catch (e2) {
        console.log('[resize] pass-2 also failed, returning original:', e2?.message);
        return uri;
      }
    }
  };

  // Open in-app camera (replaces crashy OS launchCameraAsync). The OS picker
  // builds a full-resolution bitmap on OK that OOMs the bridge — we control
  // the capture quality directly via expo-camera's takePictureAsync.
  const pickImageFromCamera = async () => {
    console.log('[cam] step 1 — pickImageFromCamera called');
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      console.log('[cam] step 2 — permission status:', status);
      if (status !== 'granted') {
        showToast({ type: 'error', title: 'Camera permission denied' });
        return;
      }
      console.log('[cam] step 3 — opening in-app camera modal');
      setShowInAppCamera(true);
    } catch (e) {
      console.log('[cam] FATAL camera error:', e?.message, e?.stack);
      showToast({ type: 'error', title: 'Camera failed', message: e?.message });
    }
  };

  // Called by the in-app camera's capture button. Takes a low-quality picture
  // straight to disk via expo-camera, closes the modal, resizes, commits.
  const captureFromInAppCamera = async () => {
    if (isCapturingPhoto || !visitCameraRef.current) return;
    setIsCapturingPhoto(true);
    try {
      console.log('[cam] step A — takePictureAsync starting');
      const photo = await visitCameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
        exif: false,
      });
      console.log('[cam] step B — captured uri:', photo?.uri, 'size:', photo?.width + 'x' + photo?.height);
      setShowInAppCamera(false);
      // Yield so the camera native view tears down before we start resize.
      await new Promise((r) => setTimeout(r, 100));
      console.log('[cam] step C — calling downsizeImage');
      const small = await downsizeImage(photo.uri);
      console.log('[cam] step D — downsize returned:', small);
      try {
        const info = await FileSystem.getInfoAsync(small);
        console.log('[cam] step E — resized size:', info.size, 'bytes (~' +
                    Math.round((info.size || 0) / 1024) + ' KB)');
      } catch (_) {}
      setImageUris((prev) => [...prev, small]);
      console.log('[cam] step F — DONE');
    } catch (e) {
      console.log('[cam] FATAL capture error:', e?.message, e?.stack);
      showToast({ type: 'error', title: 'Capture failed', message: e?.message });
      setShowInAppCamera(false);
    } finally {
      setIsCapturingPhoto(false);
    }
  };
  const pickImageFromGallery = async () => {
    console.log('[gallery] step 1 — pickImageFromGallery called');
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      console.log('[gallery] step 2 — permission status:', status);
      if (status !== 'granted') {
        showToast({ type: 'error', title: 'Gallery permission denied' });
        return;
      }
      console.log('[gallery] step 3 — launching gallery');
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 0.2,
        exif: false,
        allowsEditing: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
      });
      console.log('[gallery] step 4 — picker returned, canceled=' + result.canceled +
                  ' assets=' + (result.assets?.length || 0));
      if (!result.canceled && result.assets?.length) {
        const original = result.assets[0].uri;
        const w = result.assets[0].width;
        const h = result.assets[0].height;
        console.log('[gallery] step 5 — original uri:', original, 'size:', w + 'x' + h);
        try {
          const info = await FileSystem.getInfoAsync(original);
          console.log('[gallery] step 6 — file on disk size:', info.size, 'bytes (~' +
                      Math.round((info.size || 0) / 1024) + ' KB)');
        } catch (probeErr) {
          console.log('[gallery] step 6 — file probe FAILED:', probeErr?.message);
        }
        console.log('[gallery] step 7 — yielding 80ms');
        await new Promise((r) => setTimeout(r, 80));
        console.log('[gallery] step 8 — calling downsizeImage');
        const small = await downsizeImage(original);
        console.log('[gallery] step 9 — downsize returned:', small);
        try {
          const info2 = await FileSystem.getInfoAsync(small);
          console.log('[gallery] step 10 — resized file size:', info2.size, 'bytes (~' +
                      Math.round((info2.size || 0) / 1024) + ' KB)');
        } catch (_) {}
        console.log('[gallery] step 11 — committing to state');
        setImageUris((prev) => [...prev, small]);
        console.log('[gallery] step 12 — DONE');
      }
    } catch (e) {
      console.log('[gallery] FATAL error:', e?.message, e?.stack);
      showToast({ type: 'error', title: 'Gallery failed', message: e?.message });
    }
  };

  // Pick an existing audio file from device storage as the voice note
  // (alternative to live-recording).
  const pickVoiceNoteFromFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.length) {
        const asset = result.assets[0];
        if (asset.uri) {
          setVoiceUri(asset.uri);
          setRecordingDuration(0);  // unknown for picked file; user can play to verify
          console.log('[VisitForm] voice note picked from file:', asset.name);
        }
      }
    } catch (e) {
      console.log('[VisitForm] file picker error:', e?.message);
    }
  };

  // Voice playback — full scrubber, ported from VisitDetails so the user
  // can play / pause / drag-to-scrub the just-recorded clip during creation.
  const soundRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioPositionMs, setAudioPositionMs] = useState(0);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [waveBarWidth, setWaveBarWidth] = useState(0);
  const isDraggingRef = useRef(false);
  const wasPlayingBeforeDragRef = useRef(false);
  const durationMsRef = useRef(0);
  const barWidthRef = useRef(0);
  const isPlayingRef = useRef(false);
  useEffect(() => { durationMsRef.current = audioDurationMs; }, [audioDurationMs]);
  useEffect(() => { barWidthRef.current = waveBarWidth; }, [waveBarWidth]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const playVoiceNote = async (overrideUri = null) => {
    const uri = overrideUri || voiceUri;
    if (!uri) return;
    try {
      // Already loaded — just resume from current position. setOnPlaybackStatusUpdate
      // is still attached so position tracking continues seamlessly.
      if (soundRef.current) {
        await soundRef.current.playAsync();
        setIsPlaying(true);
        return;
      }
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      soundRef.current = sound;
      setIsPlaying(true);
      sound.setOnPlaybackStatusUpdate(async (s) => {
        if (!s?.isLoaded) return;
        if (!isDraggingRef.current) {
          setAudioPositionMs(s.positionMillis || 0);
        }
        if (s.durationMillis) setAudioDurationMs(s.durationMillis);
        if (s.didJustFinish) {
          // Hard stop: pause AND rewind to 0. Without explicit pauseAsync the
          // sound's internal "playing" flag stays true, so the next frame can
          // re-emit isPlaying=true and the user perceives it as auto-replaying.
          try { await sound.pauseAsync(); } catch (_) {}
          try { await sound.setPositionAsync(0); } catch (_) {}
          setIsPlaying(false);
          setAudioPositionMs(0);
        } else {
          setIsPlaying(s.isPlaying);
        }
      });
    } catch (e) {
      console.log('[VisitForm] playback error:', e?.message);
      setIsPlaying(false);
    }
  };
  const stopVoicePlayback = async () => {
    if (soundRef.current) {
      try { await soundRef.current.pauseAsync(); } catch (_) {}
    }
    setIsPlaying(false);
  };
  // Tear down the loaded sound so a new recording starts clean.
  const resetAudioState = async () => {
    await stopVoicePlayback();
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch (_) {}
      soundRef.current = null;
    }
    setAudioPositionMs(0);
    setAudioDurationMs(0);
  };

  const audioPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: async (evt) => {
        const dur = durationMsRef.current;
        const bw = barWidthRef.current;
        if (!soundRef.current || !dur || !bw) return;
        isDraggingRef.current = true;
        wasPlayingBeforeDragRef.current = isPlayingRef.current;
        if (isPlayingRef.current) {
          try { await soundRef.current.pauseAsync(); } catch (_) {}
          setIsPlaying(false);
        }
        const x = evt?.nativeEvent?.locationX ?? 0;
        const ratio = Math.max(0, Math.min(1, x / bw));
        setAudioPositionMs(Math.floor(ratio * dur));
      },
      onPanResponderMove: (evt) => {
        const dur = durationMsRef.current;
        const bw = barWidthRef.current;
        if (!dur || !bw) return;
        const x = evt?.nativeEvent?.locationX ?? 0;
        const ratio = Math.max(0, Math.min(1, x / bw));
        setAudioPositionMs(Math.floor(ratio * dur));
      },
      onPanResponderRelease: async (evt) => {
        const dur = durationMsRef.current;
        const bw = barWidthRef.current;
        if (!soundRef.current || !dur || !bw) {
          isDraggingRef.current = false;
          return;
        }
        const x = evt?.nativeEvent?.locationX ?? 0;
        const ratio = Math.max(0, Math.min(1, x / bw));
        const targetMs = Math.floor(ratio * dur);
        try {
          await soundRef.current.setPositionAsync(targetMs);
          setAudioPositionMs(targetMs);
          if (wasPlayingBeforeDragRef.current) {
            await soundRef.current.playAsync();
            setIsPlaying(true);
          }
        } catch (e) {
          console.log('[VisitForm] scrub release failed:', e?.message);
        }
        isDraggingRef.current = false;
      },
      onPanResponderTerminate: () => { isDraggingRef.current = false; },
    })
  ).current;

  const formatMs = (ms) => {
    const total = Math.floor((ms || 0) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => () => {
    // cleanup on unmount
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
    }
  }, []);

  const fileToBase64 = async (uri) => {
    try {
      return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    } catch (error) {
      console.error('Error converting file to base64:', error);
      return null;
    }
  };

  const handleFieldChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prevErrors) => ({ ...prevErrors, [field]: null }));
  };


  const validateForm = (fieldsToValidate) => {
    Keyboard.dismiss();
    const { isValid, errors } = validateFields(formData, fieldsToValidate);
    setErrors(errors);
    return isValid;
  };

  const submit = async () => {
    if (isProximityCheckRequired && !isWithinProximity) {
      showToast({
        type: 'error', title: 'Too Far',
        message: `You are ${distance}m away. You must be within ${PROXIMITY_LIMIT}m of the customer location.`,
      });
      return;
    }
    const fieldsToValidate = ['customer', 'dateAndTime', 'remarks', 'visitPurpose'];
    if (validateForm(fieldsToValidate)) {
      setIsSubmitting(true);
      try {
        const payload = {
          customerId: formData.customer?.id,
          customerName: formData.customer?.label || formData.customer?.name || '',
          employeeId: formData.visitedBy?.id || false,
          employeeName: formData.visitedBy?.label || formData.visitedBy?.name || '',
          // Send UTC: Odoo stores datetimes as UTC and converts on display.
          // formatDate(local, 'yyyy-MM-dd HH:mm:ss') would send local time
          // which Odoo would then re-interpret as UTC, shifting the time.
          dateTime: formData.dateAndTime
            ? formData.dateAndTime.toISOString().slice(0, 19).replace('T', ' ')
            : null,
          purposeId: formData.visitPurpose?.id || false,
          visitDuration: formData.visitDuration?.id || false,
          remarks: formData.remarks || '',
          longitude: formData.longitude || 0,
          latitude: formData.latitude || 0,
          locationName: formData.locationName || '',
          visitPlanId: visitPlanId ? parseInt(visitPlanId) : false,
        };
        if (imageUris.length > 0) {
          const images = [];
          for (let i = 0; i < imageUris.length; i++) {
            const base64 = await fileToBase64(imageUris[i]);
            if (base64) images.push({ base64, filename: `visit_image_${i + 1}.jpg` });
          }
          if (images.length > 0) payload.images = images;
        }
        // If the user tapped Save while still recording, finalize the recording
        // first so the audio is saved (otherwise the recording session is
        // discarded and no voice note reaches the server).
        let finalVoiceUri = voiceUri;
        if (isRecording && recordingRef.current) {
          console.log('[VisitForm-submit] still recording — auto-stopping before save');
          try {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            await recordingRef.current.stopAndUnloadAsync();
            finalVoiceUri = recordingRef.current.getURI();
            recordingRef.current = null;
            setIsRecording(false);
            setVoiceUri(finalVoiceUri);
            console.log('[VisitForm-submit] auto-stopped, finalVoiceUri:', finalVoiceUri);
          } catch (e) {
            console.log('[VisitForm-submit] auto-stop failed:', e?.message);
          }
        }
        if (finalVoiceUri) {
          console.log('[VisitForm-submit] voiceUri present:', finalVoiceUri);
          const voiceBase64 = await fileToBase64(finalVoiceUri);
          console.log('[VisitForm-submit] voiceBase64 result: ' +
                      (voiceBase64 ? 'length=' + voiceBase64.length : 'NULL'));
          if (voiceBase64) {
            payload.voiceBase64 = voiceBase64;
            payload.voiceFilename = 'voice_note.m4a';
            console.log('[VisitForm-submit] attached voice to payload');
          } else {
            console.log('[VisitForm-submit] voice fileToBase64 returned null — voice NOT uploaded');
          }
        } else {
          console.log('[VisitForm-submit] no voiceUri to upload');
        }
        console.log('[VisitForm-submit] payload keys:', Object.keys(payload).join(','));
        console.log('[VisitForm-submit] payload sizes — images:' +
                    (payload.images?.length || 0) + ' voiceBase64:' +
                    (payload.voiceBase64?.length || 0));
        console.log('[VisitForm-submit] === awaiting createCustomerVisitOdoo ===');
        const t0 = Date.now();
        // Race against a 30s timeout so we never hang indefinitely.
        const created = await Promise.race([
          createCustomerVisitOdoo(payload),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('createCustomerVisit timeout after 30s')), 30000)
          ),
        ]);
        console.log('[VisitForm-submit] === create returned in ' + (Date.now() - t0) + 'ms ===');
        // createCustomerVisitOdoo now returns { id, reference } — fall back to
        // raw scalar if any older code path returned just an id.
        const newId = (created && typeof created === 'object') ? created.id : created;
        const newReference = (created && typeof created === 'object') ? created.reference : null;
        console.log('[VisitForm-submit] created visit id:', newId, 'reference:', newReference);
        showToast({
          type: "success",
          title: "Success",
          message: newReference
            ? `Customer Visit created — ${newReference}`
            : "Customer Visit created successfully",
        });
        // When opened from Field Attendance "+ Create New Visit", just go
        // back so the focus-return effect can re-open the visit picker
        // with the new draft visit available.
        if (route?.params?.returnTo === 'fieldAttendance') {
          // Cross-screen channel: the consuming screen (UserAttendanceScreen
          // or FieldAttendanceDetailScreen) reads this on focus to highlight
          // the just-created visit with a green NEW badge.
          setPendingNewVisit(newId);
          navigation.goBack();
        } else {
          // Pass a refresh signal so the list screen forces a fresh fetch with
          // NO filters — guarantees the just-created visit appears at the top.
          navigation.navigate({
            name: 'VisitScreen',
            params: { refreshAt: Date.now(), newVisitId: newId, newVisitReference: newReference },
            merge: true,
          });
        }
      } catch (error) {
        console.error("[VisitForm-submit] create failed:", error?.message, error?.stack);
        showToast({ type: "error", title: "ERROR", message: error?.data?.message || error?.message || "Customer Visit creation failed" });
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const getProximityStatus = () => {
    if (!formData.customer?.id) return { text: 'Select a customer to check proximity', color: '#666' };
    if (!isProximityCheckRequired) return { text: 'Customer location not set in web server', color: '#FF9800' };
    if (!formData.latitude || !formData.longitude) return { text: 'Fetching your location...', color: '#666' };
    if (isWithinProximity) return { text: `You are ${distance}m away - Within range`, color: '#1B8A2A' };
    return { text: `You are ${distance}m away - Too far (max ${PROXIMITY_LIMIT}m)`, color: '#D32F2F' };
  };

  const proximityStatus = getProximityStatus();

  const selectedCustomer = isProximityCheckRequired && formData.customer?.id
    ? customersList.find(c => c.id === formData.customer.id)
    : null;

  return (
    <SafeAreaView>
      <NavigationHeader title="New Customer Visit" onBackPress={() => navigation.goBack()} />
      <RoundedScrollContainer>
        {/* Map */}
        <View style={styles.mapContainer}>
          {formData.latitude && formData.longitude ? (
            <MapView
              style={styles.map}
              region={{ latitude: formData.latitude, longitude: formData.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
            >
              <Marker coordinate={{ latitude: formData.latitude, longitude: formData.longitude }} title="Your Location" pinColor="blue" />
              {selectedCustomer && selectedCustomer.latitude && selectedCustomer.longitude && (
                <Marker coordinate={{ latitude: selectedCustomer.latitude, longitude: selectedCustomer.longitude }} title={formData.customer.label} pinColor="red" />
              )}
            </MapView>
          ) : (
            <View style={styles.mapPlaceholder}><Text style={styles.mapPlaceholderText}>Loading map...</Text></View>
          )}
        </View>

        {/* Proximity */}
        <View style={styles.proximityRow}>
          <Text style={[styles.proximityText, { color: proximityStatus.color }]}>{proximityStatus.text}</Text>
          <TouchableOpacity style={styles.refreshButton} onPress={fetchLocation}>
            <Text style={styles.refreshButtonText}>REFRESH</Text>
          </TouchableOpacity>
        </View>

        {/* Services-off banner — rendered when ensureLocationServices() returned
            false (user declined the Google-Maps-style enable prompt) or when a
            GPS read threw. Tapping the CTA re-runs fetchLocation, which re-
            prompts on Android or re-opens iOS Settings as needed. */}
        {locationError ? (
          <View style={styles.locOffBox}>
            <MaterialIcons name="location-off" size={18} color="#D32F2F" />
            <Text style={styles.locOffText}>{locationError}</Text>
            <TouchableOpacity style={styles.locOffBtn} onPress={fetchLocation}>
              <Text style={styles.locOffBtnText}>Turn On Location</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Auto-captured GPS coordinates + reverse-geocoded address (read-only) */}
        <FormInput
          label="Location"
          placeholder="Auto-fetched on load"
          editable={false}
          multiline
          value={formData.locationName || ''}
        />
        <FormInput
          label="Latitude"
          placeholder="Auto-fetched on load"
          editable={false}
          value={formData.latitude != null ? String(formData.latitude.toFixed(6)) : ''}
        />
        <FormInput
          label="Longitude"
          placeholder="Auto-fetched on load"
          editable={false}
          value={formData.longitude != null ? String(formData.longitude.toFixed(6)) : ''}
        />

        <FormInput
          label="Customer Name"
          placeholder="Select customer"
          dropIcon="menu-down"
          editable={false}
          multiline
          required
          value={formData.customer?.label}
          validate={errors.customer}
          onPress={() => {
            console.log('[VisitForm] opening CustomerScreen');
            navigation.navigate('CustomerScreen', {
              selectMode: true,
              onSelect: (selected) => {
                console.log('[VisitForm] customer picked id=' + selected?.id + ' name="' + selected?.name + '"');
                handleFieldChange('customer', {
                  value: selected.id,
                  label: selected.name,
                  ...selected,
                });
              },
            });
          }}
        />
        <FormInput
          label="Visited By"
          placeholder="Select employee"
          dropIcon="menu-down"
          editable={false}
          value={formData.visitedBy?.label}
          onPress={() => {
            console.log('[VisitForm] opening EmployeePickerScreen');
            navigation.navigate('EmployeePickerScreen', {
              selectMode: true,
              onSelect: (selected) => {
                console.log('[VisitForm] employee picked id=' + selected?.id + ' name="' + selected?.name + '"');
                handleFieldChange('visitedBy', {
                  value: selected.id,
                  label: selected.name,
                  ...selected,
                });
              },
            });
          }}
        />
        <FormInput required label="Date and time" dropIcon="calendar" editable={false} value={formatDate(formData.dateAndTime, 'dd-MM-yyyy HH:mm:ss')} />
        <FormInput label="Visit Purpose" placeholder="Select purpose of visit" dropIcon="menu-down" editable={false} required value={formData.visitPurpose?.label} validate={errors.visitPurpose} onPress={() => setIsPurposeModalVisible(true)} />
        <FormInput label="Visit Duration (mins)" placeholder="Select duration" dropIcon="menu-down" editable={false} value={formData.visitDuration?.label} onPress={() => setIsDurationModalVisible(true)} />
        <FormInput label="Remarks" placeholder="Enter Remarks" multiline textAlignVertical="top" numberOfLines={5} required value={formData.remarks} validate={errors.remarks} onChangeText={(value) => handleFieldChange('remarks', value)} />
        <Text style={styles.minCharsText}>Min 25 characters required</Text>

        {/* Images — card with header, count badge, source-picker buttons, thumbnail grid */}
        <View style={styles.attachCard}>
          <View style={styles.attachHeader}>
            <View style={styles.attachHeaderLeft}>
              <MaterialIcons name="photo-library" size={20} color={COLORS.primaryThemeColor} />
              <Text style={styles.attachHeaderTitle}>Photos</Text>
            </View>
            {imageUris.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{imageUris.length}</Text>
              </View>
            )}
          </View>

          <View style={styles.attachActionsRow}>
            <TouchableOpacity style={styles.attachActionBtn} onPress={pickImageFromCamera} activeOpacity={0.7}>
              <MaterialIcons name="photo-camera" size={20} color={COLORS.primaryThemeColor} />
              <Text style={styles.attachActionText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachActionBtn} onPress={pickImageFromGallery} activeOpacity={0.7}>
              <MaterialIcons name="image" size={20} color={COLORS.primaryThemeColor} />
              <Text style={styles.attachActionText}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {imageUris.length > 0 ? (
            <View style={styles.imagesGrid}>
              {imageUris.map((uri, index) => (
                <View key={index} style={styles.imageTile}>
                  <Image source={{ uri }} style={styles.imageTileImg} />
                  <TouchableOpacity
                    style={styles.imageTileRemove}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => setImageUris((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <MaterialIcons name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.attachEmpty}>
              <MaterialIcons name="add-a-photo" size={28} color="#bbb" />
              <Text style={styles.attachEmptyText}>No photos yet — tap Camera or Gallery to add</Text>
            </View>
          )}
        </View>

        {/* Voice Note — card with idle / recording / recorded states + playback */}
        <View style={styles.attachCard}>
          <View style={styles.attachHeader}>
            <View style={styles.attachHeaderLeft}>
              <MaterialIcons name="graphic-eq" size={20} color={COLORS.primaryThemeColor} />
              <Text style={styles.attachHeaderTitle}>Voice Note</Text>
            </View>
            {voiceUri && !isRecording && (
              <View style={[styles.countBadge, { backgroundColor: '#1B8A2A' }]}>
                <Text style={styles.countBadgeText}>{formatDuration(recordingDuration)}</Text>
              </View>
            )}
          </View>

          {!isRecording && !voiceUri && (
            <View style={styles.voiceIdleRow}>
              <TouchableOpacity style={styles.voiceCircleBtn} onPress={startRecording} activeOpacity={0.85}>
                <View style={styles.voiceCircleInner}>
                  <MaterialIcons name="mic" size={32} color="#fff" />
                </View>
                <Text style={styles.voiceCircleHint}>Tap to record</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.voiceCircleBtn} onPress={pickVoiceNoteFromFile} activeOpacity={0.85}>
                <View style={[styles.voiceCircleInner, { backgroundColor: COLORS.primaryThemeColor }]}>
                  <MaterialIcons name="attach-file" size={32} color="#fff" />
                </View>
                <Text style={styles.voiceCircleHint}>Pick from file</Text>
              </TouchableOpacity>
            </View>
          )}

          {isRecording && (
            <TouchableOpacity style={styles.voiceRecordingBtn} onPress={stopRecording} activeOpacity={0.85}>
              <View style={styles.voicePulseDot} />
              <Text style={styles.voiceRecordingText}>Recording  {formatDuration(recordingDuration)}</Text>
              <View style={styles.voiceStopBox}>
                <MaterialIcons name="stop" size={18} color="#fff" />
              </View>
            </TouchableOpacity>
          )}

          {!isRecording && voiceUri && (
            <View>
              <View style={styles.voicePlayerRow}>
                <TouchableOpacity
                  style={styles.voicePlayBtn}
                  onPress={isPlaying ? stopVoicePlayback : () => playVoiceNote()}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={26} color="#fff" />
                </TouchableOpacity>
                <View
                  style={styles.voiceWaveBar}
                  onLayout={(e) => setWaveBarWidth(e.nativeEvent.layout.width)}
                  {...audioPanResponder.panHandlers}
                >
                  <View style={styles.voiceWaveTrack} />
                  <View
                    style={[
                      styles.voiceWaveFill,
                      {
                        width: audioDurationMs
                          ? `${Math.min(100, (audioPositionMs / audioDurationMs) * 100)}%`
                          : '0%',
                      },
                    ]}
                  />
                  {audioDurationMs > 0 && (
                    <View
                      style={[
                        styles.voiceWaveThumb,
                        { left: `${Math.min(100, (audioPositionMs / audioDurationMs) * 100)}%` },
                      ]}
                    />
                  )}
                </View>
                <Text style={styles.voiceTime}>
                  {formatMs(audioPositionMs)} / {formatMs(audioDurationMs)}
                </Text>
                <TouchableOpacity
                  style={styles.voiceIconBtn}
                  onPress={async () => { await resetAudioState(); startRecording(); }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="replay" size={20} color={COLORS.orange} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.voiceIconBtn}
                  onPress={async () => { await resetAudioState(); setVoiceUri(null); setRecordingDuration(0); }}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="delete" size={20} color="#D32F2F" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Visit Purpose — centered popup like the Warehouse picker in Easy Sales */}
        <CustomListModal
          isVisible={isPurposeModalVisible}
          items={dropdowns.visitPurpose}
          title="Visit Purpose"
          onClose={() => setIsPurposeModalVisible(false)}
          onValueChange={(value) => {
            console.log('[VisitForm] visit purpose picked:', value?.label || value);
            handleFieldChange('visitPurpose', value);
            setIsPurposeModalVisible(false);
          }}
          onAddIcon={false}
        />

        {/* Visit Duration — centered popup, same pattern */}
        <CustomListModal
          isVisible={isDurationModalVisible}
          items={DURATION_OPTIONS}
          title="Visit Duration (mins)"
          onClose={() => setIsDurationModalVisible(false)}
          onValueChange={(value) => {
            console.log('[VisitForm] visit duration picked:', value?.label || value);
            handleFieldChange('visitDuration', value);
            setIsDurationModalVisible(false);
          }}
          onAddIcon={false}
        />

        <LoadingButton title='SAVE' onPress={submit} loading={isSubmitting} />
      </RoundedScrollContainer>

      {/* In-app camera — replaces OS launchCameraAsync to avoid OOM crash */}
      <Modal visible={showInAppCamera} animationType="slide" onRequestClose={() => setShowInAppCamera(false)}>
        <View style={styles.cameraModalContainer}>
          <Camera
            ref={visitCameraRef}
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
                  <MaterialIcons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>Take Photo</Text>
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

      <OverlayLoader visible={isLoading} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  // In-app camera modal
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

  mapContainer: { height: 200, borderRadius: 8, overflow: 'hidden', marginBottom: 10 },
  map: { flex: 1 },
  mapPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#e0e0e0' },
  mapPlaceholderText: { color: '#666', fontSize: 14 },
  proximityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15, paddingHorizontal: 5 },
  proximityText: { flex: 1, fontSize: 14, fontWeight: 'bold', marginRight: 10 },
  refreshButton: { backgroundColor: '#1B8A2A', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6 },
  refreshButtonText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  // Inline "Location services are off" banner — Google-Maps-decline fallback.
  locOffBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFEBEE', borderLeftWidth: 3, borderLeftColor: '#D32F2F',
    padding: 10, borderRadius: 8, marginTop: 4, marginBottom: 12,
  },
  locOffText: { flex: 1, fontSize: 12, color: '#B71C1C', fontFamily: FONT_FAMILY.urbanistMedium },
  locOffBtn: { backgroundColor: '#D32F2F', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  locOffBtnText: { color: '#fff', fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistBold },
  minCharsText: { fontSize: 12, color: '#999', marginTop: -5, marginBottom: 10, textAlign: 'right' },
  fieldLabel: { marginVertical: 5, fontSize: 16, color: '#2e2a4f', fontFamily: FONT_FAMILY.urbanistSemiBold },
  // Generic attachment-card styling — used by both Photos and Voice Note sections
  attachCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  attachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  attachHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  attachHeaderTitle: {
    marginLeft: 8,
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#2e2a4f',
  },
  countBadge: {
    backgroundColor: COLORS.primaryThemeColor,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    minWidth: 22,
    alignItems: 'center',
  },
  countBadgeText: { color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold },

  // Photo source-picker buttons
  attachActionsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  attachActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F4EFFA',
  },
  attachActionText: {
    marginLeft: 8,
    color: COLORS.primaryThemeColor,
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  // Photos grid + tiles
  imagesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  imageTile: {
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#F0F0F0',
  },
  imageTileImg: { width: '100%', height: '100%' },
  imageTileRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(211, 47, 47, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  attachEmptyText: { marginLeft: 10, fontSize: 12, color: '#999', fontFamily: FONT_FAMILY.urbanistMedium },

  // Voice note states
  voiceIdleRow: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center' },
  voiceCircleBtn: { alignItems: 'center', paddingVertical: 8, flex: 1 },
  voiceCircleInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.orange,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: COLORS.orange,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  voiceCircleHint: { marginTop: 8, fontSize: 12, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  voiceRecordingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFEBEE',
    borderRadius: 30,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  voicePulseDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#D32F2F',
    marginRight: 12,
  },
  voiceRecordingText: { flex: 1, color: '#D32F2F', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 },
  voiceStopBox: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#D32F2F',
    alignItems: 'center', justifyContent: 'center',
  },
  voicePlayerRow: { flexDirection: 'row', alignItems: 'center' },
  voicePreviewHint: { flex: 1, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium, fontSize: 12 },
  voicePreviewActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 12 },
  voicePreviewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  voicePreviewBtnDiscard: { backgroundColor: '#FDEDED', borderWidth: 1, borderColor: '#D32F2F' },
  voicePreviewBtnKeep: { backgroundColor: COLORS.primaryThemeColor },
  voicePreviewBtnText: { marginLeft: 6, fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13 },
  voicePlayBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryThemeColor,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  voiceWaveBar: {
    flex: 1, height: 22,           // wider hit area — easier to grab while scrubbing
    justifyContent: 'center',
    marginRight: 10,
    position: 'relative',
  },
  voiceWaveTrack: {
    position: 'absolute',
    left: 0, right: 0,
    top: 8,
    height: 6,
    backgroundColor: '#E5E0EE',
    borderRadius: 3,
  },
  voiceWaveFill: {
    position: 'absolute',
    left: 0,
    top: 8,
    height: 6,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 3,
  },
  voiceWaveThumb: {
    position: 'absolute',
    top: 3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.primaryThemeColor,
    borderWidth: 2, borderColor: '#fff',
    marginLeft: -8,             // center the thumb on the position
    elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2,
  },
  voiceTime: {
    fontSize: 11, color: '#666', minWidth: 78, textAlign: 'right',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginRight: 6,
  },
  voiceIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F5F5F5',
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 6,
  },
});

export default VisitForm
