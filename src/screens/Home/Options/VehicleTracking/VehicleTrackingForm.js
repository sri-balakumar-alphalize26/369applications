import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera } from 'expo-camera';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSourcesOdoo, fetchVehicleTrackingTripsOdoo } from '@api/services/generalApi';
import { fetchVehicleDetailsOdoo } from '@api/services/vehicleDetailsApi';
import { fetchPurposeOfVisitDropdown } from '@api/services/purposeOfVisitApi';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { View, ScrollView, StyleSheet, Pressable, Alert, Modal, FlatList, TouchableOpacity, Image, ActivityIndicator, TextInput as RNTextInput } from 'react-native';
import { NavigationHeader } from '@components/Header';
import { SafeAreaView, RoundedScrollContainer } from '@components/containers';
import OfflineBanner from '@components/common/OfflineBanner';
import { TextInput as FormInput } from '@components/common/TextInput';
import { CheckBox } from '@components/common/CheckBox';
import { LoadingButton } from '@components/common/Button';
// Replaced external DropdownSheet with an in-file Modal dropdown
import Text from '@components/Text';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { formatDate, formatDateTime } from '@utils/common/date';
import { showToastMessage } from '@components/Toast';
import { fetchVehiclesOdoo, fetchVehiclesVehicleTracking } from '@api/services/generalApi';
import { fetchVehicleDetails, fetchLocations } from '@api/details/detailApi';
import { post } from '@api/services/utils';
import { createVehicleTrackingTripOdoo } from '@api/services/generalApi';
import { VEHICLE_TRACKING_URL } from '@api/endpoints/endpoints';
import { OverlayLoader } from '@components/Loader';
import { cancelVehicleTrackingTripOdoo, fetchInvoiceByIdOdoo, fetchInvoiceByQrOdoo, createFuelLogOdoo } from '@api/services/generalApi';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyledAlertModal } from '@components/Modal';
// validation will be handled inline in this file to avoid stale state issues
// These Odoo `vehicle.tracking` fields are mapped in this form: amount, battery_checking, company_id, completion_status, coolant_water, create_date, create_uid, daily_checks, date, destination, display_name, driver_id, duration, end_fuel_checking, end_fuel_document, end_fuel_document_filename, end_fuel_status, end_km, end_latitude, end_longitude, end_time, end_trip, estimated_time, fuel_checking, fuel_status, id, image_url, invoice_line_ids, invoice_match, invoice_message, invoice_number, km_travelled, number_plate, oil_checking, purpose_of_visit, ref, remarks, source, start_km, start_latitude


const VehicleTrackingForm = ({ navigation, route }) => {
  console.log('VehicleTrackingForm loaded');

  // Date formatting for Odoo
  const pad = (n) => n < 10 ? '0' + n : n;
  const formatDateOdoo = (dateObj) => {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // Toggle Add Fuel card and capture GPS when opening
  const handleToggleAddFuel = async () => {
    const opening = !showAddFuel;
    if (opening) {
      try {
        showToastMessage('Capturing fuel GPS...', 'info');
        const loc = await getCurrentLocation('Add Fuel');
        console.log('[VehicleTrackingForm] Add Fuel GPS captured:', loc);
        setFormData(prev => ({
          ...prev,
          start_latitude: String(loc.latitude),
          start_longitude: String(loc.longitude),
          startLatitude: loc.latitude,
          startLongitude: loc.longitude,
        }));
        showToastMessage('Fuel location captured', 'success');
      } catch (e) {
        console.error('Failed to capture Add Fuel GPS:', e);
        showToastMessage('Failed to capture GPS', 'error');
      }
    }
    setShowAddFuel(opening);
  };
  const formatDateTimeOdoo = (dateObj) => {
    if (!dateObj) return '';
    const d = new Date(dateObj);
    // Convert to UTC and format as YYYY-MM-DD HH:mm:ss
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };
  const [currentCoords, setCurrentCoords] = useState(null);
  const [currentLocationName, setCurrentLocationName] = useState('');
  const [showAddFuel, setShowAddFuel] = useState(false);
  useEffect(() => {
    const fetchCurrentLocation = async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('Permission to access location was denied');
          return;
        }

        // Fast path: cached fix first (returns in ~10ms), then refine in background.
        let coords = null;
        try {
          const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
          if (last?.coords) {
            coords = last.coords;
            console.log('[VehicleTrackingForm] CACHED start GPS:', coords.latitude, coords.longitude);
          }
        } catch (_) { /* fall through */ }

        // If no cache, do a quick Balanced fetch with a 3s timeout.
        if (!coords) {
          try {
            const live = await Promise.race([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout')), 3000)),
            ]);
            if (live?.coords) {
              coords = live.coords;
              console.log('[VehicleTrackingForm] LIVE-BALANCED start GPS:', coords.latitude, coords.longitude);
            }
          } catch (err) {
            console.log('[VehicleTrackingForm] live BALANCED fetch failed:', err?.message);
          }
        }

        // Last resort: any-age cache.
        if (!coords) {
          try {
            const anyLast = await Location.getLastKnownPositionAsync({});
            if (anyLast?.coords) {
              coords = anyLast.coords;
              console.log('[VehicleTrackingForm] STALE start GPS:', coords.latitude, coords.longitude);
            }
          } catch (_) { /* ignore */ }
        }

        if (!coords) {
          console.warn('[VehicleTrackingForm] Could not obtain start GPS');
          return;
        }

        setCurrentCoords({ latitude: coords.latitude, longitude: coords.longitude });

        // Reverse geocode (non-blocking — fire and update when ready).
        Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude })
          .then(reverseGeocode => {
            if (reverseGeocode && reverseGeocode.length > 0) {
              const addr = reverseGeocode[0];
              const locationName = [addr.name, addr.street, addr.city, addr.region].filter(Boolean).join(', ');
              setCurrentLocationName(locationName);
              console.log('Current location name:', locationName);
            }
          })
          .catch(geocodeError => console.error('Reverse geocode error:', geocodeError));

        // Background refresh so the next call has a fresher cache.
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          .then(fresh => {
            if (fresh?.coords) {
              setCurrentCoords({ latitude: fresh.coords.latitude, longitude: fresh.coords.longitude });
            }
          })
          .catch(() => { /* ignore */ });
      } catch (error) {
        console.error('Expo Location error (on load):', error);
      }
    };
    fetchCurrentLocation();
  }, []);
  
  // Get existing trip data from route params (when editing/continuing a trip)
  const existingTripData = route?.params?.tripData;
  const isEditMode = !!existingTripData;

  // Prewarm GPS cache as soon as the form opens. Fire LOW (cell/WiFi, fast)
  // and BALANCED (slower, more accurate) in parallel — whichever returns
  // first lands in the device's last-known cache. Subsequent
  // getCurrentLocation calls then resolve from cache in ~10ms.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') return;
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }).catch(() => {});
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => {});
      } catch (_) { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);
  
  // Determine initial trip state based on existing data.
  // Note: the Odoo field is `trip_cancel` (no trailing -led).
  const getInitialTripState = () => {
    if (!existingTripData) return 'not_started';
    if (existingTripData.trip_cancel) return 'cancelled';
    if (existingTripData.end_trip) return 'completed';
    if (existingTripData.start_trip) return 'in_progress';
    return 'not_started';
  };

  const initialTripState = getInitialTripState();
  
  const [formData, setFormData] = useState({
    date: existingTripData?.date ? new Date(existingTripData.date) : new Date(),
    vehicle: (initialTripState === 'in_progress' && existingTripData?.vehicle_name) ? existingTripData.vehicle_name : (existingTripData?.vehicle || ''),
    driver: (initialTripState === 'in_progress' && existingTripData?.driver_name) ? existingTripData.driver_name : (existingTripData?.driver || ''),
    plateNumber: (initialTripState === 'in_progress' && existingTripData?.number_plate) ? existingTripData.number_plate : (existingTripData?.plateNumber || ''),
    // Autofill Pretrip Ltr (from pre_trip_litres) for in-progress trip
    tankCapacity:
      (initialTripState === 'in_progress' && typeof existingTripData?.pre_trip_litres !== 'undefined')
        ? String(existingTripData.pre_trip_litres ?? '')
        : '',
    // Autofill start_latitude and start_longitude for in-progress trip
    start_latitude:
      (initialTripState === 'in_progress' && typeof existingTripData?.start_latitude !== 'undefined')
        ? String(existingTripData.start_latitude ?? '')
        : '',
    start_longitude:
      (initialTripState === 'in_progress' && typeof existingTripData?.start_longitude !== 'undefined')
        ? String(existingTripData.start_longitude ?? '')
        : '',
    source: (initialTripState === 'in_progress' && existingTripData?.source_name) ? existingTripData.source_name : (existingTripData?.source || ''),
    destination: (initialTripState === 'in_progress' && existingTripData?.destination_name) ? existingTripData.destination_name : (existingTripData?.destination || ''),
    source_id: existingTripData?.source_id || '',
    destination_id: existingTripData?.destination_id || '',
    estimatedTime: (initialTripState === 'in_progress' && typeof existingTripData?.estimated_time !== 'undefined') ? String(existingTripData.estimated_time) : (existingTripData?.estimatedTime || ''),
    startTrip: existingTripData?.start_trip || false,
    // Autofill Start KM for in-progress trip
    startKM:
      (initialTripState === 'in_progress' && (typeof existingTripData?.start_km !== 'undefined' || typeof existingTripData?.startKM !== 'undefined'))
        ? String(existingTripData.start_km ?? existingTripData.startKM ?? '')
        : (existingTripData?.startKM || ''),
    endTrip: existingTripData?.end_trip || false,
    // BUGFIX: Odoo returns snake_case (end_km). Read snake first, fall back to camel.
    // For NEW trips (no existing data), leave it empty so the placeholder
    // "End KM" shows instead of a literal 0.
    endKM: existingTripData?.end_km != null
      ? String(existingTripData.end_km)
      : (existingTripData?.endKM != null ? String(existingTripData.endKM) : ''),
    startTime: (existingTripData?.start_time || existingTripData?.startTime) ? new Date(existingTripData.start_time || existingTripData.startTime) : new Date(),
    endTime: (existingTripData?.end_time || existingTripData?.endTime) ? new Date(existingTripData.end_time || existingTripData.endTime) : null,
    travelledKM: existingTripData?.travelledKM || '0',
    invoiceNumbers: existingTripData?.invoiceNumbers || '',
    amount: existingTripData?.amount || '0',
    // Read from the nested camelCase object (built by fetchVehicleTrackingTripsOdoo
    // or our flattenTripForForm); fall back to the flat snake_case server fields
    // so any caller that doesn't pre-build vehicleChecklist still works.
    vehicleChecklist: {
      coolentWater:    !!(existingTripData?.vehicleChecklist?.coolentWater    ?? existingTripData?.coolant_water),
      oilChecking:     !!(existingTripData?.vehicleChecklist?.oilChecking     ?? existingTripData?.oil_checking),
      tyreChecking:    !!(existingTripData?.vehicleChecklist?.tyreChecking    ?? existingTripData?.tyre_checking),
      batteryChecking: !!(existingTripData?.vehicleChecklist?.batteryChecking ?? existingTripData?.battery_checking),
      fuelChecking:    !!(existingTripData?.vehicleChecklist?.fuelChecking    ?? existingTripData?.fuel_checking),
      dailyChecks:     !!(existingTripData?.vehicleChecklist?.dailyChecks     ?? existingTripData?.daily_checks),
    },
    cancelTrip: existingTripData?.trip_cancelled || false,
    remarks: existingTripData?.remarks || '',
    // Prefer the data-URI we computed from Odoo's Binary image_url; fall back
    // to any local imageUri stored on the (offline) record.
    imageUri: existingTripData?.image_url || existingTripData?.imageUri || '',
    // Fuel invoice image URI (to upload/send to Odoo)
    fuelInvoiceUri: existingTripData?.fuelInvoiceUri || '',
    // Add Fuel fields
    fuelAmount: existingTripData?.fuelAmount || '',
    fuelLitre: existingTripData?.fuelLitre || '',
    currentOdometer: existingTripData?.currentOdometer || '',
    odometerImageUri: existingTripData?.odometerImageUri || '',
    // GPS coordinates
    startLatitude: existingTripData?.startLatitude || null,
    startLongitude: existingTripData?.startLongitude || null,
    endLatitude: existingTripData?.endLatitude || null,
    endLongitude: existingTripData?.endLongitude || null,
    // Trip status
    isTripStarted: initialTripState === 'in_progress' || initialTripState === 'completed',
    endTrip: existingTripData?.end_trip || false,
    tripStatus: initialTripState,
    // History of fuel logs already saved to Odoo for this trip — populates
    // the read-only Fuel List card. Each Update Trip with fuel data appends
    // a new entry here.
    fuelLogs: Array.isArray(existingTripData?.fuel_logs) ? existingTripData.fuel_logs : [],
  });

  // Log autofilled fields when opening an in-progress trip
  if (initialTripState === 'in_progress' && existingTripData) {
    // Log all fields, but explicitly show pre_trip_litres, start_latitude, and start_longitude for clarity
    console.log('[VehicleTrackingForm] All fields from in-progress trip:', {
      ...existingTripData,
      pre_trip_litres: existingTripData.pre_trip_litres,
      start_latitude: existingTripData.start_latitude,
      start_longitude: existingTripData.start_longitude,
    });
  }

  const [dropdowns, setDropdowns] = useState({
    vehicles: [],
    drivers: [],
    sourceLocations: [],
    destinations: [],
    purposesOfVisit: [],
  });
  // Per-type loading flags so a popup can show a spinner while its fetch is
  // in flight, instead of rendering an empty list.
  const [dropdownsLoading, setDropdownsLoading] = useState({
    vehicles: false,
    sourceLocations: false,
    destinations: false,
    purposesOfVisit: false,
  });

  // Purpose of Visit state
  const [purposeOfVisit, setPurposeOfVisit] = useState(existingTripData?.purpose_of_visit || '');

  const [selectedType, setSelectedType] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);
  const [isStartTimePickerVisible, setIsStartTimePickerVisible] = useState(false);
  const [isEndTimePickerVisible, setIsEndTimePickerVisible] = useState(false);
  const [isEstimatedTimePickerVisible, setIsEstimatedTimePickerVisible] = useState(false);
  // In-app camera (replaces ImagePicker.launchCameraAsync — same crash-fix
  // pattern that VisitForm uses). The OS camera builds a full-resolution
  // bitmap on OK that OOMs the bridge; expo-camera lets us control the
  // quality directly via takePictureAsync and skip the OK/Cancel screen.
  const [showInAppCamera, setShowInAppCamera] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const [cameraTarget, setCameraTarget] = useState(null); // 'trip' | 'fuel' | 'odometer'
  const inAppCameraRef = useRef(null);
  // Lightbox state — full-screen preview of any image (trip, odometer, fuel invoice)
  const [previewImageUri, setPreviewImageUri] = useState(null);
  // Fuel-log View popup — shows full details + thumbnails for one log row.
  const [viewFuelLog, setViewFuelLog] = useState(null);
  // Resolved data-URI versions of the View popup's images. Odoo's /web/image
  // route needs a session cookie which RN's <Image> doesn't always forward
  // (Android in particular). We fetch via axios (which DOES use the session)
  // and convert the bytes to a base64 data URI that <Image> renders directly.
  const [viewOdometerSrc, setViewOdometerSrc] = useState(null);
  const [viewReceiptSrc, setViewReceiptSrc] = useState(null);

  // When the popup opens, build an `Image source` with the auth cookie so
  // RN can fetch /web/image/... directly (cookie is the same one all the
  // other API calls use). No JS bundling/decoding involved — fast and safe.
  useEffect(() => {
    if (!viewFuelLog) {
      setViewOdometerSrc(null);
      setViewReceiptSrc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cookie = await AsyncStorage.getItem('odoo_cookie');
        if (cancelled) return;
        const headers = cookie ? { Cookie: cookie } : undefined;
        console.log('[View popup] log id=', viewFuelLog.id, 'cookie present:', !!cookie);
        setViewOdometerSrc(viewFuelLog.odometer_image
          ? { uri: viewFuelLog.odometer_image, headers } : null);
        setViewReceiptSrc(viewFuelLog.receipt_image
          ? { uri: viewFuelLog.receipt_image, headers } : null);
      } catch (e) {
        console.error('[View popup] cookie read failed', e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [viewFuelLog]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Tracks which action button (start | end | update | cancel) was tapped, so
  // only that single button shows the loading spinner — not all three.
  const [activeAction, setActiveAction] = useState(null);
  // Latch — set when a button wants handleSubmit to fire, cleared by the effect
  // below. Using state+effect (rather than setTimeout) guarantees handleSubmit
  // runs *after* formData state changes have been committed, which avoids the
  // stale-closure bug where End Trip ran with `formData.endTrip === false`.
  const [pendingSubmit, setPendingSubmit] = useState(null);
  // Mirror of the Odoo `is_dirty` flag: tracks whether the user has edited any
  // field since opening / last save. The Update Trip button only renders when
  // this is true (matches the Odoo form behaviour exactly).
  const [isDirty, setIsDirty] = useState(false);
  useEffect(() => {
    if (!isSubmitting) setActiveAction(null);
  }, [isSubmitting]);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [sourceCoords, setSourceCoords] = useState(null);
  const [sourceMatched, setSourceMatched] = useState(null); // null = unknown, true/false
  const [sourceDistance, setSourceDistance] = useState(null);
  const SOURCE_MATCH_THRESHOLD = 100; // meters

  // ---- Per-type dropdown loaders ----
  // Each loader is independent so the four fetches run in parallel and any
  // single failure doesn't block the others. The popup reads the live state
  // from `dropdowns` directly, so when a fetch lands the open popup updates
  // in place without the user having to dismiss + re-tap.

  const loadVehicles = useCallback(async () => {
    setDropdownsLoading(p => ({ ...p, vehicles: true }));
    try {
      const odooVehicles = await fetchVehiclesVehicleTracking({ offset: 0, limit: 200, searchText: '' });
      const vehicles = (odooVehicles || []).map(v => ({
        _id: String(v.id),
        name: v.name || '',
        driver: v.driver ? { id: v.driver.id, name: v.driver.name } : null,
        plate_number: v.license_plate || '',
        tankCapacity: v.tank_capacity || '',
        image_url: v.image_url || null,
      }));
      console.log('Loaded vehicles from Odoo:', vehicles.length);
      setDropdowns(prev => ({ ...prev, vehicles }));
    } catch (err) {
      console.error('Failed to load vehicles from Odoo:', err?.message || err);
      showToastMessage('Could not load vehicles from Odoo', 'error');
    } finally {
      setDropdownsLoading(p => ({ ...p, vehicles: false }));
    }
  }, []);

  const loadSources = useCallback(async () => {
    setDropdownsLoading(p => ({ ...p, sourceLocations: true }));
    try {
      const odooSources = await fetchSourcesOdoo({ offset: 0, limit: 100 });
      console.log('Loaded sources from Odoo:', (odooSources || []).length);
      setDropdowns(prev => ({ ...prev, sourceLocations: odooSources || [] }));
    } catch (err) {
      console.warn('Failed to load sources from Odoo, using defaults', err);
      setDropdowns(prev => ({
        ...prev,
        sourceLocations: [
          { _id: 'src1', name: 'Warehouse', latitude: 8.8861225, longitude: 76.5900631 },
          { _id: 'src2', name: 'Depot', latitude: 8.8850000, longitude: 76.5910000 },
          { _id: 'src3', name: 'Office', latitude: 8.8870000, longitude: 76.5890000 },
        ],
      }));
    } finally {
      setDropdownsLoading(p => ({ ...p, sourceLocations: false }));
    }
  }, []);

  const loadDestinations = useCallback(async () => {
    setDropdownsLoading(p => ({ ...p, destinations: true }));
    try {
      const odooDestinations = await fetchSourcesOdoo({ offset: 0, limit: 100 });
      console.log('Loaded destinations from Odoo:', (odooDestinations || []).length);
      setDropdowns(prev => ({ ...prev, destinations: odooDestinations || [] }));
    } catch (err) {
      console.warn('Failed to load destinations from Odoo, using defaults', err);
      setDropdowns(prev => ({
        ...prev,
        destinations: [
          { _id: 'dest1', name: 'Client Site' },
          { _id: 'dest2', name: 'Service Center' },
          { _id: 'dest3', name: 'Main Office' },
        ],
      }));
    } finally {
      setDropdownsLoading(p => ({ ...p, destinations: false }));
    }
  }, []);

  const loadPurposes = useCallback(async () => {
    setDropdownsLoading(p => ({ ...p, purposesOfVisit: true }));
    try {
      const purposesOfVisit = await fetchPurposeOfVisitDropdown();
      setDropdowns(prev => ({ ...prev, purposesOfVisit: purposesOfVisit || [] }));
    } catch (err) {
      console.warn('Failed to load Purpose of Visit dropdown', err);
    } finally {
      setDropdownsLoading(p => ({ ...p, purposesOfVisit: false }));
    }
  }, []);

  // Mount: kick off all four dropdown fetches in parallel.
  useEffect(() => {
    loadVehicles();
    loadSources();
    loadDestinations();
    loadPurposes();
  }, [loadVehicles, loadSources, loadDestinations, loadPurposes]);

  // Edit-mode: once vehicles are loaded, try to auto-match the current trip's
  // vehicle_id and populate the form fields. Re-runs whenever `dropdowns.vehicles`
  // changes (so it kicks in after the async fetch lands, not just on mount).
  useEffect(() => {
    if (!isEditMode || !existingTripData?.vehicle_id) return;
    if (!dropdowns.vehicles || dropdowns.vehicles.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const match = (dropdowns.vehicles || []).find(v =>
          String(v._id) === String(existingTripData.vehicle_id) ||
          String(v._id) === String(existingTripData.vehicle_id?.toString())
        );
        if (cancelled) return;
        if (match) {
          setFormData(prev => ({
            ...prev,
            vehicle: match.name || prev.vehicle,
            driver: match.driver?.name || prev.driver,
            plateNumber: match.plate_number || prev.plateNumber,
          }));
          console.log('[VehicleTrackingForm] Auto-matched vehicle from dropdowns for edit:', match.name, match._id);
        } else {
          console.log('[VehicleTrackingForm] No vehicle match found in dropdowns for vehicle_id:', existingTripData.vehicle_id);
          // Fallback: fetch vehicle details by id and populate form fields
          try {
            const details = await fetchVehicleDetailsOdoo({ vehicle_id: existingTripData.vehicle_id });
            if (cancelled || !details) return;
            setFormData(prev => ({
              ...prev,
              vehicle: details.name || prev.vehicle || existingTripData.vehicle_name || '',
              driver: details.driver?.name || prev.driver || existingTripData.driver_name || '',
              plateNumber: details.license_plate || prev.plateNumber || existingTripData.number_plate || '',
              tankCapacity: prev.tankCapacity || details.tank_capacity || prev.tankCapacity || '',
            }));
            console.log('[VehicleTrackingForm] Populated vehicle from fetchVehicleDetailsOdoo fallback:', details.name, existingTripData.vehicle_id);
          } catch (fetchErr) {
            console.warn('Failed to fetch vehicle details fallback for vehicle_id:', existingTripData.vehicle_id, fetchErr);
          }
        }
      } catch (e) {
        console.warn('Error auto-matching vehicle for edit:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [dropdowns.vehicles, isEditMode, existingTripData?.vehicle_id]);

  // Helper functions to determine field states
  const isFieldDisabled = (fieldName) => {
    const { tripStatus, isTripStarted } = formData;

    const tripBasicFields = ['source', 'destination', 'vehicle', 'driver', 'plateNumber', 'purposeOfVisit'];
    const tripControlFields = ['startTrip'];

    // Once a trip is finalised (completed or cancelled), EVERY field — including
    // remarks — becomes read-only, matching the Odoo write-lock on the model.
    if (tripStatus === 'completed' || tripStatus === 'cancelled') {
      return true;
    }

    if (isTripStarted && tripBasicFields.includes(fieldName)) {
      return true;
    }

    if (isTripStarted && tripControlFields.includes(fieldName)) {
      return true;
    }

    return false;
  };

  // Convenience: a single boolean for "everything is locked" — used to gate
  // text inputs that don't go through isFieldDisabled.
  const isTripLocked = formData.tripStatus === 'completed' || formData.tripStatus === 'cancelled';
  // End KM / End Time stay readonly until Start Trip is pressed (mirrors the
  // module's view modifier `readonly="not start_trip or end_trip or trip_cancel"`).
  const tripStartedFlag = !!(formData.startTrip || formData.isTripStarted);
  const endFieldsLocked = isTripLocked || !tripStartedFlag;

  const isFieldEditable = (fieldName) => {
    const { tripStatus, isTripStarted } = formData;
    
    // Always editable fields during trip
    const alwaysEditableFields = ['endKM', 'remarks', 'invoiceNumbers', 'imageUri'];
    // Only allow editing endTime if trip is started
    if (fieldName === 'endTime') {
      return formData.isTripStarted;
    }
    
    // Editable only when trip is in progress
    const tripProgressFields = ['endTrip'];
    
    if (tripStatus === 'completed' || tripStatus === 'cancelled') {
      return ['remarks'].includes(fieldName); // Only remarks editable after completion
    }
    
    if (isTripStarted) {
      return alwaysEditableFields.includes(fieldName) || tripProgressFields.includes(fieldName);
    }
    
    return true; // All fields editable before trip starts
  };

  const getFieldStyle = (fieldName) => {
    return isFieldDisabled(fieldName) ? styles.disabledInput : {};
  };

  // Internal-use field names that don't represent user intent and should
  // NOT flip the dirty flag (e.g. status flags, GPS coords auto-captured by
  // Start/End buttons, computed values).
  const NON_DIRTY_FIELDS = new Set([
    'startTrip', 'endTrip', 'isTripStarted', 'tripStatus', 'cancelTrip',
    'startLatitude', 'startLongitude', 'endLatitude', 'endLongitude',
    'start_latitude', 'start_longitude', 'travelledKM',
  ]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    if (!NON_DIRTY_FIELDS.has(field)) {
      setIsDirty(true);
    }
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: null
      }));
    }
  };

  const handleChecklistChange = (field, value) => {
    setFormData(prev => {
      const prevChecklist = (prev && typeof prev.vehicleChecklist === 'object' && prev.vehicleChecklist !== null)
        ? prev.vehicleChecklist
        : {
            coolentWater: false,
            oilChecking: false,
            tyreChecking: false,
            batteryChecking: false,
            fuelChecking: false,
            dailyChecks: false,
          };
      return {
        ...prev,
        vehicleChecklist: {
          ...prevChecklist,
          [field]: value,
        },
      };
    });
    setIsDirty(true);
  };

  // Small delay to let Alert dismiss before launching picker (prevents Android crash)
  const delayedAction = (fn) => () => setTimeout(fn, 300);

  // Branded image-source picker (logout-style modal). One shared modal,
  // dispatches Camera / Gallery handlers based on the active target.
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState(null); // 'trip' | 'fuel' | 'odometer'
  const [imagePickerTitle, setImagePickerTitle] = useState('Select Image');

  const openImagePickerFor = (target) => {
    setImagePickerTarget(target);
    setImagePickerTitle(
      target === 'fuel'     ? 'Upload Fuel Invoice'
    : target === 'odometer' ? 'Upload Odometer Image'
    :                         'Select Trip Image'
    );
    setImagePickerVisible(true);
  };

  const handleImagePicker        = () => openImagePickerFor('trip');
  const handleFuelInvoicePicker  = () => openImagePickerFor('fuel');
  const handleOdometerPicker     = () => openImagePickerFor('odometer');

  const dispatchImageSource = (source) => {
    setImagePickerVisible(false);
    const map = {
      trip:     { camera: openCamera,        gallery: openGallery },
      fuel:     { camera: openFuelCamera,    gallery: openFuelGallery },
      odometer: { camera: openOdometerCamera, gallery: openOdometerGallery },
    };
    const fn = map[imagePickerTarget]?.[source];
    if (fn) delayedAction(fn)();
  };

  // Unified in-app camera opener (replaces ImagePicker.launchCameraAsync,
  // which builds a full-resolution bitmap on OK and OOMs the bridge). The
  // target ('trip' | 'fuel' | 'odometer') decides which form field receives
  // the captured URI in captureFromInAppCamera below.
  const openInAppCamera = async (target) => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToastMessage('Camera permission is required', 'warning');
        return;
      }
      setCameraTarget(target);
      setShowInAppCamera(true);
    } catch (e) {
      console.error('[VehicleTrackingForm] openInAppCamera error:', e?.message);
      showToastMessage('Camera failed to open', 'error');
    }
  };

  // Capture handler — runs when the in-app camera shutter is tapped. Saves
  // immediately, no OK/Cancel screen.
  const captureFromInAppCamera = async () => {
    if (isCapturingPhoto || !inAppCameraRef.current) return;
    setIsCapturingPhoto(true);
    try {
      const photo = await inAppCameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
        exif: false,
      });
      console.log('[VehicleTrackingForm] in-app camera captured:', photo?.uri);
      setShowInAppCamera(false);
      // Yield so the camera native view tears down before we mutate state.
      await new Promise((r) => setTimeout(r, 100));
      const fieldByTarget = {
        trip: 'imageUri',
        fuel: 'fuelInvoiceUri',
        odometer: 'odometerImageUri',
      };
      const field = fieldByTarget[cameraTarget];
      if (field && photo?.uri) {
        handleInputChange(field, photo.uri);
        showToastMessage('Photo captured', 'success');
      }
    } catch (e) {
      console.error('[VehicleTrackingForm] in-app camera capture error:', e?.message);
      showToastMessage('Capture failed', 'error');
      setShowInAppCamera(false);
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const openOdometerCamera = () => openInAppCamera('odometer');

  const openOdometerGallery = () => {
    (async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToastMessage('Media library permission is required', 'warning');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        });
        console.log('[VehicleTrackingForm] openOdometerGallery result:', result);
        if (result.cancelled || result.canceled) {
          showToastMessage('Gallery selection cancelled', 'info');
          return;
        }
        const asset = result.assets && result.assets[0];
        if (asset && asset.uri) {
          handleInputChange('odometerImageUri', asset.uri);
          showToastMessage('Odometer image selected', 'success');
        }
      } catch (e) {
        console.error('openOdometerGallery exception:', e);
        showToastMessage('Gallery error occurred', 'error');
      }
    })();
  };

  const openFuelCamera = () => openInAppCamera('fuel');

  const openFuelGallery = () => {
    (async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToastMessage('Media library permission is required', 'warning');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        });
        console.log('[VehicleTrackingForm] expo-image-picker result:', result);
        if (result.cancelled || result.canceled) {
          showToastMessage('Gallery selection cancelled', 'info');
          return;
        }
        const asset = result.assets && result.assets[0];
        if (asset && asset.uri) {
          console.log('[VehicleTrackingForm] Fuel invoice image selected:', asset.uri);
          handleInputChange('fuelInvoiceUri', asset.uri);
          showToastMessage('Fuel invoice selected', 'success');
        }
      } catch (e) {
        console.error('expo-image-picker exception:', e);
        showToastMessage('Gallery error occurred', 'error');
      }
    })();
  };

  const openCamera = () => openInAppCamera('trip');

  const openGallery = () => {
    const options = {
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 1000,
      maxHeight: 1000,
    };
    (async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToastMessage('Media library permission is required', 'warning');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        });
        console.log('[VehicleTrackingForm] openGallery result:', result);
        if (result?.cancelled || result?.canceled) {
          showToastMessage('Gallery selection cancelled', 'info');
          return;
        }
        const asset = result.assets ? result.assets[0] : (result.uri ? { uri: result.uri } : null);
        if (asset && asset.uri) {
          handleInputChange('imageUri', asset.uri);
          showToastMessage('Image selected successfully!', 'success');
        }
      } catch (e) {
        console.error('launchImageLibrary exception:', e);
        showToastMessage('Gallery error occurred', 'error');
      }
    })();
  };

  const handleDropdownSelect = async (field, item) => {
    if (field === 'purposeOfVisit') {
      setPurposeOfVisit(item.name);
      setIsVisible(false);
      return;
    }
    handleInputChange(field, item.name);
    if (field === 'vehicle') {
      handleInputChange('driver', item.driver?.name || '');
      handleInputChange('plateNumber', item.plate_number || '');
      // Autofill tank capacity from the dropdown item (fetchVehiclesVehicleTracking already includes tank_capacity)
      const immediateTank = item.tankCapacity ?? item.tank_capacity ?? '';
      handleInputChange('tankCapacity', immediateTank !== null && immediateTank !== undefined ? String(immediateTank) : '');
      // Autofill startKM with last completed trip's end_km for selected vehicle
      try {
        // Debug: Log vehicle_id being sent and payload
        const tripsPayload = { vehicle_id: item._id, limit: 5, order: 'desc' };
        console.log('[VehicleTrackingForm] Fetching trips payload:', tripsPayload, 'vehicle name:', item.name);
        // Fetch trips for this vehicle (could be more than one, so we filter)
        const trips = await fetchVehicleTrackingTripsOdoo(tripsPayload);
        // Debug: Log all trips returned
        console.log('[VehicleTrackingForm] Trips returned from backend:', trips);
        // Filter for completed trips (end_trip: true)
        const completedTrips = (trips || []).filter(t => t.end_trip && typeof t.end_km !== 'undefined');
        // Filter for in-progress trips (end_trip: false)
        const inProgressTrips = (trips || []).filter(t => !t.end_trip);
        // If a trip is completed, exclude it from in-progress selection
        if (completedTrips.length > 0) {
          // Sort by date or id descending (assuming id is incrementing)
          completedTrips.sort((a, b) => (b.id || 0) - (a.id || 0));
          const lastCompleted = completedTrips[0];
          console.log('[VehicleTrackingForm] Last completed trip object for selected vehicle:', {
            ...lastCompleted,
            debug_trip_id: lastCompleted.id,
            debug_vehicle_id: lastCompleted.vehicle_id
          });
          // Warn if vehicle_id does not match selected vehicle
          if (String(lastCompleted.vehicle_id) !== String(item._id)) {
            console.warn('[VehicleTrackingForm] WARNING: Returned trip vehicle_id does not match selected vehicle!', {
              selectedVehicleId: item._id,
              selectedVehicleName: item.name,
              returnedVehicleId: lastCompleted.vehicle_id,
              returnedVehicleName: lastCompleted.vehicle_name,
              returnedTripId: lastCompleted.id,
            });
          }
          handleInputChange('startKM', String(lastCompleted.end_km));
          console.log('[VehicleTrackingForm] startKM autofilled from last completed trip:', lastCompleted.end_km);
        } else {
          handleInputChange('startKM', '');
          console.log('[VehicleTrackingForm] No previous completed trip found, startKM left blank.');
        }
        // Optionally, you can disable selection of in-progress trips that are now completed
        // Example: if (inProgressTrips.length === 0) { /* disable in-progress selection UI */ }
      } catch (err) {
        console.warn('Failed to fetch last completed end_km for vehicle', err);
        handleInputChange('startKM', '');
        console.log('[VehicleTrackingForm] Error fetching last completed trip, startKM left blank.');
      }
    }
    if (field === 'source') {
      const lat = item.latitude ?? item.lat ?? item.geo_lat ?? item.lat_lng?.lat ?? null;
      const lon = item.longitude ?? item.lon ?? item.lng ?? item.geo_lng ?? item.lat_lng?.lng ?? null;
      if (lat != null && lon != null) {
        setSourceCoords({ latitude: parseFloat(lat), longitude: parseFloat(lon) });
        // Immediately compare with currentCoords
        if (currentCoords) {
          const dist = getDistanceMeters(currentCoords.latitude, currentCoords.longitude, parseFloat(lat), parseFloat(lon));
          setSourceDistance(dist);
          const matched = dist <= SOURCE_MATCH_THRESHOLD;
          setSourceMatched(matched);
        } else {
          setSourceMatched(null);
          setSourceDistance(null);
        }
      } else {
        setSourceCoords(null);
        setSourceMatched(null);
        setSourceDistance(null);
      }
    }
    setIsVisible(false);
  };

  // Haversine formula to calculate distance in meters
  const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371000; // earth radius meters
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const verifySource = async () => {
    if (!sourceCoords) {
      showToastMessage('Source has no coordinates to verify', 'warning');
      setSourceMatched(false);
      setSourceDistance(null);
      return { matched: false, distance: null };
    }

    try {
      const current = await getCurrentLocation('Verify Source');
      const dist = getDistanceMeters(current.latitude, current.longitude, sourceCoords.latitude, sourceCoords.longitude);
      setSourceDistance(dist);
      const matched = dist <= SOURCE_MATCH_THRESHOLD;
      setSourceMatched(matched);
      if (matched) {
        showToastMessage(`Source verified (${Math.round(dist)} m)`, 'success');
      } else {
        showToastMessage(`Source mismatch (${Math.round(dist)} m)`, 'warning');
      }
      return { matched, distance: dist };
    } catch (error) {
      console.error('Error verifying source:', error);
      showToastMessage('Failed to verify source location', 'error');
      setSourceMatched(false);
      return { matched: false, distance: null };
    }
  };

  // Destination verification logic (similar to source)
  const verifyDestination = async () => {
    // Find destination coordinates from dropdowns
    const selectedDestination = (dropdowns.destinations || []).find(d => d.name === formData.destination);
    const lat = selectedDestination?.latitude ?? selectedDestination?.lat ?? selectedDestination?.geo_lat ?? selectedDestination?.lat_lng?.lat ?? null;
    const lon = selectedDestination?.longitude ?? selectedDestination?.lon ?? selectedDestination?.lng ?? selectedDestination?.geo_lng ?? selectedDestination?.lat_lng?.lng ?? null;
    if (lat == null || lon == null) {
      showToastMessage('Destination has no coordinates to verify', 'warning');
      return { matched: false, distance: null };
    }
    try {
      const current = await getCurrentLocation('Verify Destination');
      const dist = getDistanceMeters(current.latitude, current.longitude, parseFloat(lat), parseFloat(lon));
      const matched = dist <= SOURCE_MATCH_THRESHOLD;
      if (matched) {
        showToastMessage(`Destination verified (${Math.round(dist)} m)`, 'success');
      } else {
        showToastMessage(`Destination mismatch (${Math.round(dist)} m)`, 'warning');
      }
      return { matched, distance: dist };
    } catch (error) {
      console.error('Error verifying destination:', error);
      showToastMessage('Failed to verify destination location', 'error');
      return { matched: false, distance: null };
    }
  };

  const handleStartTripToggle = async (value) => {
    // If trying to start the trip, verify source first
    if (value) {
      // Log all filled form data before verifying source
      console.log('Start Trip clicked. Current filled form data:', formData);
      const { matched, distance } = await verifySource();
      if (matched) {
        // Capture current GPS location and set startLatitude/startLongitude immediately
        try {
          const location = await getCurrentLocation('Start Trip Immediate');
          setFormData(prev => {
            const updated = {
              ...prev,
              startTrip: true,
              startLatitude: location.latitude,
              startLongitude: location.longitude,
            };
            // Also store as string for Odoo compatibility
            updated.start_latitude = String(location.latitude);
            updated.start_longitude = String(location.longitude);
            console.log('Start Trip updated formData:', updated);
            return updated;
          });
          showToastMessage(`Start location captured: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`, 'success');
        } catch (error) {
          console.error('Failed to capture GPS:', error);
          showToastMessage('GPS capture failed, using default location', 'warning');
          setFormData(prev => {
            const updated = {
              ...prev,
              startTrip: true,
              startLatitude: 25.2048,
              startLongitude: 55.2708,
            };
            console.log('Start Trip updated formData (fallback):', updated);
            return updated;
          });
        }
      } else {
        // Source not matched - do not allow starting the trip
        showToastMessage(`Cannot start trip: You must be at the source location. Current distance: ${distance ? Math.round(distance) + ' m' : 'unknown'}`, 'error');
      }
    } else {
      handleInputChange('startTrip', false);
    }
  };

  // Live source-of-truth data lookup. The popup reads from this so it
  // re-renders automatically as `dropdowns` updates in the background.
  const dropdownDataFor = (type) => {
    switch (type) {
      case 'vehicle':         return dropdowns.vehicles || [];
      case 'source':          return dropdowns.sourceLocations || [];
      case 'destination':     return dropdowns.destinations || [];
      case 'purposeOfVisit':  return dropdowns.purposesOfVisit || [];
      default:                return [];
    }
  };

  // If a dropdown is opened while empty (initial fetch failed silently or
  // hasn't started), kick off a load so the popup eventually populates.
  const ensureDropdownLoaded = (type) => {
    const map = {
      vehicle:         { current: dropdowns.vehicles,         loading: dropdownsLoading.vehicles,         load: loadVehicles },
      source:          { current: dropdowns.sourceLocations,  loading: dropdownsLoading.sourceLocations,  load: loadSources },
      destination:     { current: dropdowns.destinations,     loading: dropdownsLoading.destinations,     load: loadDestinations },
      purposeOfVisit:  { current: dropdowns.purposesOfVisit,  loading: dropdownsLoading.purposesOfVisit,  load: loadPurposes },
    };
    const m = map[type];
    if (m && (m.current?.length || 0) === 0 && !m.loading) {
      m.load();
    }
  };

  const openDropdown = (type) => {
    setSelectedType({ type });
    setIsVisible(true);
    ensureDropdownLoaded(type);
  };

  const calculateTravelledKM = () => {
    const start = parseFloat(formData.startKM) || 0;
    const end = parseFloat(formData.endKM) || 0;
    const travelled = Math.max(0, end - start);
    handleInputChange('travelledKM', travelled.toString());
  };

  useEffect(() => {
    calculateTravelledKM();
  }, [formData.startKM, formData.endKM]);

  const validateForm = () => {
    const { tripStatus, isTripStarted, endTrip } = formData;

    const requiredFields = ['date', 'vehicle', 'driver', 'plateNumber'];

    const fieldLabels = {
      date: 'Date',
      vehicle: 'Vehicle',
      driver: 'Driver',
      plateNumber: 'Plate Number',
      source: 'Source',
      destination: 'Destination',
      endKM: 'End KM',
      startKM: 'Start KM',
    };

    // Manual validation to avoid dependency on external helper and stale state
    let newErrors = {};

    requiredFields.forEach((field) => {
      const value = formData[field];
      if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
        newErrors[field] = `${fieldLabels[field] || field} is required`;
      }
    });

    // Additional validation when Start Trip is checked (for new trips)
    if (formData.startTrip && !isTripStarted) {
      if (!formData.source) {
        newErrors.source = 'Source location is required when starting a trip';
      }
      if (!formData.destination) {
        newErrors.destination = 'Destination is required when starting a trip';
      }
    }

    // Additional validation when End Trip is checked
    if (endTrip && isTripStarted) {
      if (!formData.endKM || formData.endKM === '0') {
        newErrors.endKM = 'End KM reading is required to end the trip';
      }

      const startKM = parseFloat(formData.startKM) || 0;
      const endKM = parseFloat(formData.endKM) || 0;

      if (endKM <= startKM) {
        newErrors.endKM = 'End KM must be greater than Start KM';
      }
    }

    // Validation for trip in edit mode
    if (isEditMode && isTripStarted && !endTrip) {
      // For ongoing trips, only validate editable fields
      if (!formData.endKM || formData.endKM === '0') {
        // End KM not required until ending trip, but show warning
        console.log('End KM should be updated during the trip');
      }
    }

    setErrors(newErrors);
    console.log('validateForm newErrors:', newErrors);
    return newErrors;
  };

  // Function to get current GPS location using expo-location.
  // 4-step ladder: cached (≤5min) → LOW live (cell/wifi, ~1s) → BALANCED live
  // (8s timeout) → any-age stale cache. Designed to always return real coords
  // (or last-known) instead of falling through to the fallback.
  const getCurrentLocation = async (logAddressLabel = '') => {
    const FALLBACK = { latitude: 25.2048, longitude: 55.2708 };
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Permission to access location was denied');
        return FALLBACK;
      }

      let coords = null;

      // 1) Cached fix — widened to 5min so we don't churn on near-stale data.
      try {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 300_000 });
        if (last?.coords) {
          coords = last.coords;
          console.log('[VehicleTrackingForm] CACHED GPS:', coords.latitude, coords.longitude);
        }
      } catch (_) { /* fall through */ }

      // 2) LOW-accuracy live fetch — cell + WiFi only, ~1s on most networks.
      if (!coords) {
        try {
          const live = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout-low')), 4000)),
          ]);
          if (live?.coords) {
            coords = live.coords;
            console.log('[VehicleTrackingForm] LIVE-LOW GPS:', coords.latitude, coords.longitude);
          }
        } catch (err) {
          console.log('[VehicleTrackingForm] live LOW fetch failed:', err?.message);
        }
      }

      // 3) BALANCED live fetch with 8s timeout — only if LOW also failed.
      if (!coords) {
        try {
          const live = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('gps-timeout-balanced')), 8000)),
          ]);
          if (live?.coords) {
            coords = live.coords;
            console.log('[VehicleTrackingForm] LIVE-BALANCED GPS:', coords.latitude, coords.longitude);
          }
        } catch (err) {
          console.log('[VehicleTrackingForm] live BALANCED fetch failed:', err?.message);
        }
      }

      // 4) Any-age cache, last resort
      if (!coords) {
        try {
          const anyLast = await Location.getLastKnownPositionAsync({});
          if (anyLast?.coords) {
            coords = anyLast.coords;
            console.log('[VehicleTrackingForm] STALE GPS:', coords.latitude, coords.longitude);
          }
        } catch (_) { /* ignore */ }
      }

      if (!coords) {
        console.warn('[VehicleTrackingForm] Could not obtain GPS, using fallback');
        return FALLBACK;
      }

      // Reverse geocode is non-blocking — fire and forget for log only.
      if (logAddressLabel) {
        Location.reverseGeocodeAsync({ latitude: coords.latitude, longitude: coords.longitude })
          .then(addressArr => {
            if (addressArr && addressArr.length > 0) {
              const address = addressArr[0];
              const addressString = `${address.name || ''} ${address.street || ''}, ${address.city || ''}, ${address.region || ''}, ${address.country || ''}`;
              console.log(`${logAddressLabel} address:`, addressString);
            }
          })
          .catch(geoError => console.log('Reverse geocoding failed:', geoError));
      }

      return { latitude: coords.latitude, longitude: coords.longitude };
    } catch (error) {
      console.error('Expo Location error:', error);
      return FALLBACK;
    }
  };

  // Dispatcher: when a button sets `pendingSubmit`, run handleSubmit AFTER React
  // commits the latest formData. This breaks the stale-closure race that was
  // preventing End Trip from working (handleSubmit captured at tap-time saw
  // `formData.endTrip === false`).
  useEffect(() => {
    if (!pendingSubmit) return;
    if (pendingSubmit === 'end' && !formData.endTrip) return;        // wait for setFormData commit
    if (pendingSubmit === 'start' && !formData.startTrip) return;
    console.log('[VehicleTrackingForm] Dispatching handleSubmit for intent:', pendingSubmit, '— formData.endTrip=', formData.endTrip);
    setPendingSubmit(null);
    handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, formData.endTrip, formData.startTrip]);

  const handleSubmit = async () => {
    const newErrors = validateForm();
    if (newErrors && Object.keys(newErrors).length > 0) {
      console.log('[VehicleTrackingForm] Validation errors:', newErrors);
      console.log('[VehicleTrackingForm] Form data at submit:', formData);
      // Show the first specific error so users know which field is missing
      const firstErr = Object.values(newErrors)[0];
      showToastMessage(firstErr || 'Please fill all required fields', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      // Ensure vehicleChecklist is always an object
      const checklist = (formData && typeof formData.vehicleChecklist === 'object' && formData.vehicleChecklist !== null)
        ? formData.vehicleChecklist
        : {
            coolentWater: false,
            oilChecking: false,
            tyreChecking: false,
            batteryChecking: false,
            fuelChecking: false,
            dailyChecks: false,
          };
      const checklistSnake = {
        coolant_water: checklist.coolentWater,
        oil_checking: checklist.oilChecking,
        tyre_checking: checklist.tyreChecking,
        battery_checking: checklist.batteryChecking,
        fuel_checking: checklist.fuelChecking,
        daily_checks: checklist.dailyChecks,
      };

      // Helper: extract a primitive id from either an Odoo m2o pair [id, name]
      // or an already-primitive id. Handles both raw read() output and our
      // flattenTripForForm output uniformly.
      const m2oId = (val) => Array.isArray(val) ? val[0] : (val || null);

      // Find selected vehicle object from dropdowns. When editing, preserve existing vehicle_id
      const selectedVehicle = (dropdowns.vehicles || []).find(v => v.name === formData.vehicle);
      // Extract vehicle_id: if it's an array (from API response), take first element
      let vehicle_id = selectedVehicle ? selectedVehicle._id : null;
      if (!vehicle_id && isEditMode && existingTripData?.vehicle_id) {
        vehicle_id = m2oId(existingTripData.vehicle_id);
        console.log('[VehicleTrackingForm] Using vehicle_id from existingTripData:', vehicle_id, 'original:', existingTripData.vehicle_id);
      }
      // Driver: prefer dropdown's selected vehicle's driver, fallback to existing.
      const driver_id = selectedVehicle?.driver?.id
        || (isEditMode ? m2oId(existingTripData?.driver_id) : null)
        || null;

      // Map form fields to Odoo model fields
      let submitData = {
        amount: parseFloat(formData.amount) || 0,
        // post_trip_amount removed: not a valid Odoo field
        // post_trip_litres removed: not a valid Odoo field
        battery_checking: checklistSnake.battery_checking,
        coolant_water: checklistSnake.coolant_water,
        tyre_checking: checklistSnake.tyre_checking,
        daily_checks: checklistSnake.daily_checks,
        date: formatDateOdoo(formData.date),
        destination_id: (() => {
          const selectedDestination = (dropdowns.destinations || []).find(d => d.name === formData.destination);
          if (selectedDestination?._id) return selectedDestination._id;
          // Fallback: when editing, preserve the previously-saved id rather
          // than nulling the field if the dropdown lookup didn't match.
          if (isEditMode && existingTripData?.destination_id) return m2oId(existingTripData.destination_id);
          return null;
        })(),
        source_id: (() => {
          const selectedSource = (dropdowns.sourceLocations || []).find(s => s.name === formData.source);
          if (selectedSource?._id) return selectedSource._id;
          if (isEditMode && existingTripData?.source_id) return m2oId(existingTripData.source_id);
          return null;
        })(),
        driver_id: driver_id,
        end_km: parseInt(formData.endKM) || 0,
        end_latitude: formData.endLatitude ? String(formData.endLatitude) : '',
        end_longitude: formData.endLongitude ? String(formData.endLongitude) : '',
        end_time: formatDateTimeOdoo(formData.endTime),
        end_trip: formData.endTrip,
        estimated_time: parseFloat(formData.estimatedTime) || 0,
        fuel_checking: checklistSnake.fuel_checking,
        image_url: formData.imageUri || '',
        // Fuel invoice: send URI and filename (backend should accept URI or handle upload)
        // end_fuel_document fields removed: not a valid Odoo field
        invoice_number: formData.invoiceNumbers,
        km_travelled: parseInt(formData.travelledKM) || 0,
        number_plate: formData.plateNumber,
        oil_checking: checklistSnake.oil_checking,
        remarks: formData.remarks,
        start_km: parseInt(formData.startKM) || 0,
        // Always send start_latitude and start_longitude if available
        start_latitude: formData.start_latitude || formData.startLatitude ? String(formData.start_latitude || formData.startLatitude) : '',
        start_longitude: formData.start_longitude || formData.startLongitude ? String(formData.start_longitude || formData.startLongitude) : '',
        start_time: formatDateTimeOdoo(formData.startTime),
        start_trip: formData.startTrip,
        vehicle_id: vehicle_id,
        // Add purpose_of_visit_id as id (many2one)
        purpose_of_visit_id: (() => {
          const selectedPurpose = (dropdowns.purposesOfVisit || []).find(p => p.name === purposeOfVisit);
          if (selectedPurpose?._id) return selectedPurpose._id;
          if (isEditMode && existingTripData?.purpose_of_visit_id) return m2oId(existingTripData.purpose_of_visit_id);
          return null;
        })(),
        // pre_trip_litres removed: not a valid Odoo field
        // Add Fuel fields (if provided)
        fuel_amount: formData.fuelAmount ? String(formData.fuelAmount) : '',
        fuel_liters: formData.fuelLitre ? String(formData.fuelLitre) : '',
        current_odometer: formData.currentOdometer ? String(formData.currentOdometer) : '',
        odometer_image: formData.odometerImageUri ? String(formData.odometerImageUri) : '',
      };


      // Add trip ID if editing existing trip (only id, no is_update/isUpdate/tripId)
      if (isEditMode && existingTripData?.id) {
        submitData.id = existingTripData.id;
        // Ensure vehicle_id is present when updating - it's critical for the trip record
        if (!submitData.vehicle_id) {
          console.error('[VehicleTrackingForm] CRITICAL: vehicle_id is missing in update payload!', {
            submitData_vehicle_id: submitData.vehicle_id,
            existingTripData_vehicle_id: existingTripData.vehicle_id,
            variable_vehicle_id: vehicle_id,
          });
          showToastMessage('Vehicle ID missing - please select a vehicle before updating', 'error');
          setIsSubmitting(false);
          return;
        } else {
          console.log('[VehicleTrackingForm] Update payload includes vehicle_id:', submitData.vehicle_id);
        }
      }

      // If Start Trip is checked (for new trips only)
      // Save (draft) flow — force fuel_checking=true so Odoo's create()
      // constraint passes; trip stays in draft (startTrip=false, endTrip=false).
      if (activeAction === 'save' && !formData.isTripStarted) {
        submitData.fuel_checking = true;
        submitData.start_trip = false;
        submitData.end_trip = false;
        console.log('[VehicleTrackingForm] Save (draft): forcing fuel_checking=true for Odoo create');
      }

      if (formData.startTrip && !formData.isTripStarted) {
        // Odoo's vehicle.tracking.create() rejects with UserError("Fuel checking is not updated")
        // unless fuel_checking is true. Tapping Start Trip implies the driver has confirmed the
        // fuel check, so force the flag here and reflect it in the local checklist state.
        submitData.fuel_checking = true;
        setFormData(prev => ({
          ...prev,
          vehicleChecklist: {
            ...(prev.vehicleChecklist || {}),
            fuelChecking: true,
          },
        }));
        console.log('[VehicleTrackingForm] Start Trip: auto-setting fuel_checking=true for Odoo create');

        try {
          showToastMessage('Capturing GPS location...', 'info');
          const location = await getCurrentLocation('Start Trip');
          submitData = {
            ...submitData,
            start_trip: true,
            start_latitude: location.latitude,
            start_longitude: location.longitude,
          };
          showToastMessage(`GPS captured: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`, 'success');
        } catch (error) {
          console.error('Failed to capture GPS:', error);
          showToastMessage('GPS capture failed, using default location', 'warning');
        }
      }

      // If End Trip is checked, capture end GPS, auto-stamp end time, and
      // compute travelled KM. Destination match is a SOFT check — drivers can
      // still end the trip if they're slightly off; we just toast a warning.
      if (formData.endTrip && formData.isTripStarted) {
        console.log('[VehicleTrackingForm] End Trip flow starting');
        try {
          const { matched, distance } = await verifyDestination();
          console.log('[VehicleTrackingForm] Destination match:', matched, 'distance(m):', distance);
          if (!matched) {
            showToastMessage(
              `You're ${distance ? Math.round(distance) + 'm' : ''} away from the destination — ending anyway`,
              'warning'
            );
          }
        } catch (verifyErr) {
          console.warn('[VehicleTrackingForm] verifyDestination failed:', verifyErr?.message);
        }

        try {
          showToastMessage('Capturing end location...', 'info');
          const location = await getCurrentLocation('End Trip');
          // Auto-stamp end time + computed travelled KM if user didn't fill them.
          const now = new Date();
          const startKmNum = parseInt(formData.startKM, 10) || 0;
          const endKmNum = parseInt(formData.endKM, 10) || 0;
          const computedTravelled = Math.max(endKmNum - startKmNum, 0);
          submitData = {
            ...submitData,
            end_trip: true,
            end_latitude: location.latitude,
            end_longitude: location.longitude,
            end_time: submitData.end_time && submitData.end_time !== '' ? submitData.end_time : formatDateTimeOdoo(now),
            km_travelled: computedTravelled,
          };
          // Mirror the changes into local state so the form / banner update.
          setFormData(prev => ({
            ...prev,
            endTime: prev.endTime || now,
            travelledKM: String(computedTravelled),
            endLatitude: location.latitude,
            endLongitude: location.longitude,
          }));
          console.log('[VehicleTrackingForm] End Trip — stamped end_time + km_travelled:', {
            end_time: submitData.end_time,
            km_travelled: computedTravelled,
          });
          showToastMessage(`End location captured: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`, 'success');
        } catch (error) {
          console.error('[VehicleTrackingForm] Failed to capture End Trip GPS:', error);
          showToastMessage('GPS capture failed — submitting end without coords', 'warning');
          // Even without GPS, still mark end_trip + stamp end_time so Odoo accepts it.
          const now = new Date();
          const startKmNum = parseInt(formData.startKM, 10) || 0;
          const endKmNum = parseInt(formData.endKM, 10) || 0;
          submitData = {
            ...submitData,
            end_trip: true,
            end_time: submitData.end_time && submitData.end_time !== '' ? submitData.end_time : formatDateTimeOdoo(now),
            km_travelled: Math.max(endKmNum - startKmNum, 0),
          };
        }
      }

      // Pass fuel invoice URI as-is; generalApi will convert to base64 (same as odometer_image)
      if (formData.fuelInvoiceUri) {
        submitData.upload_path = formData.fuelInvoiceUri;
      }

      // Pass main image URI as-is; generalApi will convert to base64 (same as odometer_image)
      if (formData.imageUri) {
        submitData.image_url = formData.imageUri;
      }

      // Log the payload we'll send to the API for debugging (without image_128)
      try {
        const { image_128, ...rest } = submitData;
        console.log('[VehicleTrackingForm] Payload sent to Odoo on end trip:', rest);
        console.log('[VehicleTrackingForm] vehicle_id in update payload:', submitData.vehicle_id);
      } catch (logErr) {
        console.log('Failed to stringify submit payload', logErr);
      }

      // Send to Odoo using JSON-RPC
      let response;
      try {
        response = await createVehicleTrackingTripOdoo({ payload: submitData });
        console.log('Odoo createVehicleTrackingTripOdoo response:', response);
      } catch (odooErr) {
        console.error('Odoo trip creation failed:', odooErr);
        // Inspect error and if it mentions vehicle.tracking or unknown comodels, fallback to REST backend
        const errPayload = odooErr && (odooErr.data || odooErr.response || odooErr);
        const errString = JSON.stringify(errPayload || odooErr || '');
        const shouldFallback = errString.includes('vehicle.tracking') || errString.includes('unknown comodel_name') || errString.includes('Invalid field');
        if (shouldFallback) {
          showToastMessage('Odoo model unavailable — falling back to REST API', 'warning');
          try {
            const restResp = await post(VEHICLE_TRACKING_URL, submitData);
            console.log('Fallback REST response:', restResp);
            response = restResp;
          } catch (restErr) {
            console.error('Fallback REST failed:', restErr);
            showToastMessage('Failed to create trip via REST fallback', 'error');
            setIsSubmitting(false);
            return;
          }
        } else {
          const odooMsg = odooErr?.message && odooErr.message !== 'Odoo JSON-RPC error'
            ? odooErr.message
            : 'Failed to create trip in Odoo';
          console.error('[VehicleTrackingForm] Odoo trip creation rejected. Final user message:', odooMsg);
          console.error('[VehicleTrackingForm] Raw Odoo error:', odooErr);
          console.error('[VehicleTrackingForm] Odoo error name/code:', odooErr?.name, odooErr?.code);
          console.error('[VehicleTrackingForm] Odoo error.data:', odooErr?.data);
          console.error('[VehicleTrackingForm] Odoo error.response:', odooErr?.response);
          console.error('[VehicleTrackingForm] Odoo error stack:', odooErr?.stack);
          try {
            console.error('[VehicleTrackingForm] Submit payload that was rejected:', JSON.stringify(submitData));
          } catch (e) {
            console.error('[VehicleTrackingForm] Submit payload (could not stringify):', submitData);
          }
          showToastMessage(odooMsg, 'error');
          setIsSubmitting(false);
          return;
        }
      }

      // Update form state if trip was started
      // Successful save — clear the dirty flag so the Update Trip button hides
      // again until the user makes the next edit.
      setIsDirty(false);

      // If a fuel log was just created, append it to the local Fuel List and
      // clear the draft fuel fields so the next Add Fuel tap starts fresh.
      const newFuelLog = response && typeof response === 'object' ? response.fuelLog : null;
      if (newFuelLog) {
        setFormData(prev => ({
          ...prev,
          fuelLogs: [...(prev.fuelLogs || []), newFuelLog],
          fuelAmount: '',
          fuelLitre: '',
          currentOdometer: '',
          odometerImageUri: '',
          fuelInvoiceUri: '',
        }));
        setShowAddFuel(false);
        showToastMessage('Fuel entry added', 'success');
      }

      if (formData.startTrip && !formData.isTripStarted) {
        setFormData(prev => ({
          ...prev,
          isTripStarted: true,
          startLatitude: submitData.start_latitude,
          startLongitude: submitData.start_longitude,
          tripStatus: 'in_progress',
        }));
        showToastMessage('Trip started successfully!', 'success');
        setTimeout(() => navigation.goBack(), 1500);
      } else if (formData.endTrip && formData.isTripStarted) {
        // BUGFIX: previous version was missing ...prev, wiping the whole form.
        setFormData(prev => ({
          ...prev,
          endLatitude: submitData.end_latitude,
          endLongitude: submitData.end_longitude,
          endTime: prev.endTime || (submitData.end_time ? new Date() : prev.endTime),
          tripStatus: 'completed',
          endTrip: true,
        }));
        console.log('[VehicleTrackingForm] End Trip success — tripStatus → completed');
        showToastMessage('Trip completed successfully!', 'success');
        setTimeout(() => navigation.goBack(), 2000);
      } else {
        showToastMessage(
          activeAction === 'save' ? 'Saved as draft' : 'Vehicle tracking entry added successfully',
          'success'
        );
        navigation.goBack();
      }
    } catch (error) {
      console.error('Error submitting form:', error);
      showToastMessage('Failed to add vehicle tracking entry', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Add Fuel popup ----
  const [isSavingFuel, setIsSavingFuel] = useState(false);

  const closeAddFuelPopup = () => {
    setShowAddFuel(false);
    setFormData(prev => ({
      ...prev,
      fuelAmount: '',
      fuelLitre: '',
      currentOdometer: '',
      odometerImageUri: '',
      fuelInvoiceUri: '',
    }));
  };

  const submitAddFuel = async () => {
    // Trip must already exist on Odoo before we can attach a fuel log to it.
    if (!existingTripData?.id) {
      showToastMessage('Save the trip first, then add fuel.', 'warning');
      return;
    }
    if (!formData.fuelAmount || !formData.fuelLitre || !formData.currentOdometer) {
      showToastMessage('Please fill Amount, Litre and Odometer.', 'error');
      return;
    }
    setIsSavingFuel(true);
    try {
      console.log('[submitAddFuel] sending — odometerImageUri set:', !!formData.odometerImageUri,
        'fuelInvoiceUri set:', !!formData.fuelInvoiceUri);
      const log = await createFuelLogOdoo({
        tripId: existingTripData.id,
        vehicleId: existingTripData.vehicle_id,
        driverId: existingTripData.driver_id,
        amount: formData.fuelAmount,
        fuelLevel: formData.fuelLitre,
        odometer: formData.currentOdometer,
        odometerImageUri: formData.odometerImageUri || null,
        fuelInvoiceUri: formData.fuelInvoiceUri || null,
        gpsLat: formData.start_latitude || formData.startLatitude || (currentCoords ? String(currentCoords.latitude) : ''),
        gpsLong: formData.start_longitude || formData.startLongitude || (currentCoords ? String(currentCoords.longitude) : ''),
      });
      log.driver_name = existingTripData?.driver_name || formData.driver || '';
      console.log('[submitAddFuel] log returned — odometer_image len=',
        log.odometer_image ? String(log.odometer_image).length : 0,
        'receipt_image len=', log.receipt_image ? String(log.receipt_image).length : 0);
      setFormData(prev => ({
        ...prev,
        fuelLogs: [...(prev.fuelLogs || []), log],
        fuelAmount: '',
        fuelLitre: '',
        currentOdometer: '',
        odometerImageUri: '',
        fuelInvoiceUri: '',
      }));
      setShowAddFuel(false);
      showToastMessage('Fuel entry added', 'success');
    } catch (err) {
      showToastMessage(err?.message || 'Failed to add fuel entry', 'error');
    } finally {
      setIsSavingFuel(false);
    }
  };

  // Cancel-trip confirm now uses the branded StyledAlertModal (logout-style)
  // instead of the OS-native Alert.alert. handleCancelTrip just opens it;
  // performCancelTrip runs after the user taps "Yes, Cancel".
  const [cancelConfirmVisible, setCancelConfirmVisible] = useState(false);

  const handleCancelTrip = () => {
    setCancelConfirmVisible(true);
  };

  const performCancelTrip = async () => {
    setCancelConfirmVisible(false);
    try {
      setIsSubmitting(true);

      const pad = (n) => n < 10 ? '0' + n : n;
      const formatDateOdoo = (dateObj) => {
        if (!dateObj) return '';
        const d = new Date(dateObj);
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      };
      const formatDateTimeOdoo = (dateObj) => {
        if (!dateObj) return '';
        const d = new Date(dateObj);
        return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      };

      let cancelData = {
        trip_cancel: true,
        tripStatus: 'cancelled',
        date: formatDateOdoo(formData.date),
        start_trip: formData.startTrip || false,
        end_trip: false,
        start_latitude: formData.start_latitude || null,
        start_longitude: formData.start_longitude || null,
        start_km: formData.startKM || '',
        end_km: formData.endKM || '',
        start_time: formatDateTimeOdoo(formData.startTime),
        end_time: formData.endTime ? formatDateTimeOdoo(formData.endTime) : '',
        vehicle_id: existingTripData?.vehicle_id || '',
        driver_id: existingTripData?.driver_id || '',
        number_plate: formData.plateNumber || '',
        remarks: formData.remarks || '',
        pre_trip_litres: formData.tankCapacity || '',
      };

      try {
        const location = await getCurrentLocation();
        cancelData.cancel_latitude = location.latitude;
        cancelData.cancel_longitude = location.longitude;
      } catch (error) {
        console.error('Failed to capture cancel location:', error);
      }

      try {
        await cancelVehicleTrackingTripOdoo({ tripId: existingTripData.id });
        setFormData(prev => ({ ...prev, tripStatus: 'cancelled' }));
        showToastMessage('Trip cancelled successfully', 'success');
        setTimeout(() => navigation.goBack(), 2000);
      } catch (error) {
        console.error('Error cancelling trip:', error);
        showToastMessage('Failed to cancel trip', 'error');
      }
    } catch (error) {
      console.error('Error cancelling trip:', error);
      showToastMessage('Failed to cancel trip', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <NavigationHeader
        title={
          isEditMode
            ? formData.tripStatus === 'in_progress'
              ? "Continue Trip"
              : formData.tripStatus === 'completed'
              ? "View Completed Trip"
              : formData.tripStatus === 'cancelled'
              ? "View Cancelled Trip"
              : "Edit Vehicle Tracking"
            : "New Vehicle Tracking"
        }
        navigation={navigation}
        onBackPress={() => navigation.goBack()}
      />
      <OfflineBanner message="OFFLINE — new trips will sync when online" />

      {/* Reference + state row, shown only when editing an existing trip. */}
      {isEditMode && (existingTripData?.ref || existingTripData?.state) ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingVertical: 8,
          backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
        }}>
          <View>
            {existingTripData?.ref ? (
              <Text style={{ color: COLORS.primaryThemeColor, fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13 }}>
                {existingTripData.ref}
              </Text>
            ) : null}
            {existingTripData?.offline_label ? (
              <Text style={{ color: '#888', fontFamily: FONT_FAMILY.urbanistMedium, fontSize: 11 }}>
                Offline ref: {existingTripData.offline_label}
              </Text>
            ) : null}
          </View>
          {(() => {
            const meta = formData.tripStatus === 'in_progress' ? { label: 'TRIP STARTED', bg: '#0DCAF0' }
                       : formData.tripStatus === 'completed'   ? { label: 'TRIP ENDED',   bg: '#198754' }
                       : formData.tripStatus === 'cancelled'   ? { label: 'CANCELLED',    bg: '#DC3545' }
                       :                                          { label: 'DRAFT',        bg: '#6C757D' };
            return (
              <View style={{
                paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
                backgroundColor: meta.bg,
              }}>
                <Text style={{ color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 10, letterSpacing: 0.5 }}>
                  {meta.label}
                </Text>
              </View>
            );
          })()}
        </View>
      ) : null}

      <RoundedScrollContainer>
        {/* Trip Status Banner — only meaningful for existing trips */}
        {isEditMode && (() => {
          const phase = formData.tripStatus;
          // Palette matched to Odoo's list-view badges
          const meta = phase === 'in_progress' ? { label: 'TRIP STARTED', color: '#00838F', bg: '#E0F7FA', icon: 'progress-clock' }
                     : phase === 'completed'   ? { label: 'TRIP ENDED',   color: '#2E7D32', bg: '#E8F5E9', icon: 'check-circle' }
                     : phase === 'cancelled'   ? { label: 'CANCELLED',    color: '#C62828', bg: '#FFEBEE', icon: 'close-circle' }
                     :                           { label: 'DRAFT',        color: '#6D6D6D', bg: '#EEEEEE', icon: 'file-document-outline' };
          return (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: meta.bg,
              borderRadius: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              marginBottom: 14,
              borderLeftWidth: 4,
              borderLeftColor: meta.color,
            }}>
              <MaterialCommunityIcons name={meta.icon} size={20} color={meta.color} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ fontSize: 11, color: meta.color, letterSpacing: 0.5, fontWeight: '700' }}>
                  TRIP STATUS
                </Text>
                <Text style={{ fontSize: 14, color: meta.color, fontWeight: '700', marginTop: 1 }}>
                  {meta.label}
                </Text>
              </View>
              {formData.isTripStarted && formData.startLatitude ? (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 10, color: meta.color, opacity: 0.7 }}>Started at</Text>
                  <Text style={{ fontSize: 11, color: meta.color, fontWeight: '600' }}>
                    {Number(formData.startLatitude).toFixed(4)}, {Number(formData.startLongitude).toFixed(4)}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })()}

        {/* Vehicle Information */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderAccent} />
          <MaterialCommunityIcons name="car" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.sectionTitle}>Vehicle Information</Text>
        </View>
        <View style={styles.sectionGroup}>
          {/* Date */}
          <FormInput
            label="Date :"
            value={formatDate(formData.date)}
            onPress={() => setIsDatePickerVisible(true)}
            error={errors.date}
            required
            editable={false}
            dropIcon="calendar"
          />

        {/* Vehicle */}
        <View style={[styles.sectionCard, styles.vehicleSection]}>
          <Text style={styles.fieldLabel}>Vehicle <Text style={{ color: 'red' }}>*</Text></Text>
          <Pressable
            style={[styles.selectBox, errors.vehicle ? styles.selectBoxError : null]}
            onPress={() => openDropdown('vehicle')}
          >
            <Text style={[styles.selectBoxText, { color: formData.vehicle ? COLORS.black : COLORS.gray }]}>
              {formData.vehicle || 'Select vehicle'}
            </Text>
            <Text style={styles.selectBoxChevron}>▼</Text>
          </Pressable>
          {errors.vehicle && (
            <Text style={styles.errorText}>{errors.vehicle}</Text>
          )}
        </View>

          {/* Driver - Auto-filled when vehicle is selected */}
          <FormInput
            label="Driver :"
            value={formData.driver}
            onChangeText={(value) => handleInputChange('driver', value)}
            error={errors.driver}
            placeholder="Select vehicle to auto-fill"
            editable={false}
            style={{ backgroundColor: '#f5f5f5' }}
            required
          />

          {/* Plate Number - Auto-filled when vehicle is selected */}
          <FormInput
            label="Plate Number:"
            value={formData.plateNumber}
            onChangeText={(value) => handleInputChange('plateNumber', value)}
            error={errors.plateNumber}
            placeholder="Select vehicle to auto-fill"
            editable={false}
            style={{ backgroundColor: '#f5f5f5' }}
            required
          />
        </View>
        {/* Fuel List — read-only history of every saved fuel.log on this trip.
            Mirrors Odoo's `fuel_log_ids` sub-table; one row per saved entry. */}
        {(formData.fuelLogs && formData.fuelLogs.length > 0) ? (
          <View style={styles.fuelListCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.fuelListTitle}>Fuel List</Text>
              <Text style={[styles.fuelListColHeader, { fontSize: 11 }]}>{formData.fuelLogs.length} entr{formData.fuelLogs.length === 1 ? 'y' : 'ies'}</Text>
            </View>
            <View style={styles.fuelListRowHeader}>
              <Text style={[styles.fuelListCol, styles.fuelListColHeader]}>Amount</Text>
              <Text style={[styles.fuelListCol, styles.fuelListColHeader]}>Litres</Text>
              <Text style={[styles.fuelListCol, styles.fuelListColHeader]}>Odometer</Text>
              <Text style={[styles.fuelListCol, styles.fuelListColHeader, { flex: 0.6 }]}> </Text>
            </View>
            {/* Sort newest → oldest, matching Odoo's `_order = 'create_date desc'`
                so the app and Odoo's Fuel List render in the same order. */}
            {[...formData.fuelLogs].sort((a, b) => {
              const da = a.create_date ? new Date(a.create_date).getTime() : 0;
              const db = b.create_date ? new Date(b.create_date).getTime() : 0;
              if (da !== db) return db - da;
              return (b.id || 0) - (a.id || 0);
            }).map((log) => (
              <View key={log.id || log.create_date} style={styles.fuelListRow}>
                <Text style={styles.fuelListCol}>{log.amount ?? '-'}</Text>
                <Text style={styles.fuelListCol}>{log.fuel_level ?? '-'}</Text>
                <Text style={styles.fuelListCol}>{log.odometer ?? '-'}</Text>
                <Pressable
                  style={styles.fuelListViewBtn}
                  onPress={() => setViewFuelLog(log)}
                  hitSlop={6}
                >
                  <MaterialCommunityIcons name="eye-outline" size={14} color="#fff" />
                  <Text style={styles.fuelListViewBtnText}>View</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Add Fuel button — opens a modal popup with the fuel-entry form. */}
        <View style={{ marginVertical: 8 }}>
          <Pressable
            onPress={handleToggleAddFuel}
            style={[styles.fuelToggle, styles.fuelToggleInactive]}
          >
            <MaterialCommunityIcons name="gas-station" size={18} color="#198754" />
            <Text style={[styles.fuelToggleText, styles.fuelToggleTextInactive]}>  Add Fuel</Text>
          </Pressable>
        </View>



        {/* Route Details */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderAccent} />
          <MaterialCommunityIcons name="map-marker-path" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.sectionTitle}>Route Details</Text>
        </View>
        <View style={styles.sectionGroup}>
          {/* Started Location */}
          <FormInput
            label="Started Location:"
            value={currentLocationName || 'Fetching location...'}
            editable={false}
            style={{ backgroundColor: '#f5f5f5' }}
          />

          {/* Source */}
          <FormInput
            label="Source:"
            value={formData.source}
            onPress={isFieldDisabled('source') ? null : () => openDropdown('source')}
            error={errors.source}
            dropIcon="chevron-down"
            required
            editable={false}
            style={getFieldStyle('source')}
          />
          {/* Source Match Indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium, marginRight: 8 }}>Source Match:</Text>
            {sourceMatched === null ? (
              <Text style={{ color: COLORS.gray }}>Not verified</Text>
            ) : sourceMatched === true ? (
              <Text style={{ color: COLORS.green }}>✓ Verified ({sourceDistance ? Math.round(sourceDistance) + ' m' : ''})</Text>
            ) : (
              <Text style={{ color: '#B00020' }}>✗ Not verified ({sourceDistance ? Math.round(sourceDistance) + ' m' : ''})</Text>
            )}
            <Pressable onPress={verifySource} style={{ marginLeft: 12 }}>
              <Text style={{ color: COLORS.primaryThemeColor }}>Verify</Text>
            </Pressable>
          </View>

          {/* Destination */}
          <FormInput
            label="Destination:"
            value={formData.destination}
            onPress={isFieldDisabled('destination') ? null : () => openDropdown('destination')}
            error={errors.destination}
            dropIcon="chevron-down"
            required
            editable={false}
            style={getFieldStyle('destination')}
          />

          {/* Estimated Time — opens an HH:MM time picker. Stored as decimal
              hours (Odoo `estimated_time` is Float, e.g. 2:30 → 2.5). */}
          <FormInput
            label="Estimated Time:"
            value={(() => {
              const n = parseFloat(formData.estimatedTime);
              if (!Number.isFinite(n) || n <= 0) return '';
              const h = Math.floor(n);
              const m = Math.round((n - h) * 60);
              return `${h}:${String(m).padStart(2, '0')} hrs`;
            })()}
            onPress={() => setIsEstimatedTimePickerVisible(true)}
            placeholder="Tap to pick HH:MM"
            dropIcon="clock-outline"
            editable={false}
          />
        </View>

        {/* Odometer & Timing */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderAccent} />
          <MaterialCommunityIcons name="speedometer" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.sectionTitle}>Odometer & Timing</Text>
        </View>
        <View style={styles.sectionGroup}>
          {/* Start KM */}
          <FormInput
            label="Start KM :"
            value={formData.startKM}
            onChangeText={(value) => handleInputChange('startKM', value)}
            placeholder="Start KM"
            keyboardType="numeric"
            editable={formData.tripStatus !== 'in_progress'}
            selectTextOnFocus
          />

          {/* Start Time */}
          <FormInput
            label="Start Time :"
            value={formatDateTime(formData.startTime)}
            onPress={() => setIsStartTimePickerVisible(true)}
            editable={false}
          />

          {/* End KM */}
          <FormInput
            label="End KM :"
            value={formData.endKM}
            onChangeText={(value) => handleInputChange('endKM', value)}
            placeholder="End KM"
            keyboardType="numeric"
            selectTextOnFocus
            error={errors.endKM}
            editable={!endFieldsLocked}
          />
          {!tripStartedFlag && !isTripLocked ? (
            <Text style={styles.helperDanger}>After Start Trip you can use this field.</Text>
          ) : null}

          {/* End Time */}
          <FormInput
            label="End Time :"
            value={formatDateTime(formData.endTime)}
            onPress={() => { if (endFieldsLocked) return; setIsEndTimePickerVisible(true); }}
            editable={false}
          />
          {!tripStartedFlag && !isTripLocked ? (
            <Text style={styles.helperDanger}>After Start Trip you can use this field.</Text>
          ) : null}

          {/* Travelled KM */}
          <FormInput
            label="Travelled KM :"
            value={formData.travelledKM}
            editable={false}
            style={styles.readOnlyInput}
          />

          {/* Duration (Hrs) — mirrors Odoo's computed duration field */}
          <FormInput
            label="Duration (Hrs) :"
            value={(() => {
              const s = formData.startTime ? new Date(formData.startTime) : null;
              const e = formData.endTime ? new Date(formData.endTime) : null;
              if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return '';
              const hours = (e - s) / 3600000;
              return hours > 0 ? hours.toFixed(2) : '';
            })()}
            editable={false}
            style={styles.readOnlyInput}
          />
        </View>

        {/* Trip Details */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderAccent} />
          <MaterialCommunityIcons name="information-outline" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.sectionTitle}>Trip Details</Text>
        </View>
        <View style={styles.sectionGroup}>
          {/* Purpose of Visit — editable={false} blocks the keyboard so only
              the centered dropdown popup opens on tap. */}
          <FormInput
            label="Purpose of Visit:"
            value={purposeOfVisit}
            onPress={() => openDropdown('purposeOfVisit')}
            dropIcon="chevron-down"
            placeholder="Select purpose of visit"
            required
            editable={false}
          />

          {/* Invoice Numbers */}
          <View style={styles.inputWithIconContainer}>
            <View style={styles.inputWrapper}>
              <FormInput
                label="Invoice Numbers :"
                value={formData.invoiceNumbers}
                onChangeText={(value) => handleInputChange('invoiceNumbers', value)}
                placeholder="Invoice numbers"
              />
            </View>
            <Pressable
              style={styles.qrIconButton}
              onPress={() => {
                navigation.navigate('InvoiceScannerScreen', {
                  onScan: async (scannedData) => {
                    try {
                      console.log('[VehicleTrackingForm] QR/barcode scanned:', scannedData);
                      // Resilient lookup: tries id-from-URL → integer id → name/ref search.
                      const invoice = await fetchInvoiceByQrOdoo(scannedData);
                      if (invoice) {
                        handleInputChange('invoiceNumbers', invoice.name || String(invoice.id));
                        if (invoice.amount_total) {
                          handleInputChange('amount', String(invoice.amount_total));
                        }
                        showToastMessage('Invoice details filled successfully');
                      } else {
                        // Fall back: still capture the raw scanned text in the field
                        // so the user has something to work with — they can edit it.
                        handleInputChange('invoiceNumbers', String(scannedData || '').trim());
                        showToastMessage(
                          'No matching invoice in Odoo — saved scanned text. Please verify the number.',
                          'warning'
                        );
                      }
                    } catch (error) {
                      showToastMessage(`Error fetching invoice: ${error.message}`);
                    }
                  },
                });
              }}
            >
              <MaterialCommunityIcons name="barcode-scan" size={22} color="#fff" />
            </Pressable>
          </View>

          {/* Amount */}
          <FormInput
            label="Amount :"
            value={formData.amount}
            onChangeText={(value) => handleInputChange('amount', value)}
            keyboardType="numeric"
            selectTextOnFocus
          />
        </View>

        {/* Pre-Trip Checklist */}
        {(() => {
          const items = [
            { key: 'coolentWater',    label: 'Coolant Water',    icon: 'water' },
            { key: 'oilChecking',     label: 'Oil Checking',     icon: 'oil' },
            { key: 'tyreChecking',    label: 'Tyre Checking',    icon: 'tire' },
            { key: 'batteryChecking', label: 'Battery Checking', icon: 'car-battery' },
            { key: 'fuelChecking',    label: 'Fuel Checking',    icon: 'fuel' },
            { key: 'dailyChecks',     label: 'Daily Checks',     icon: 'clipboard-check' },
          ];
          const checklist = formData.vehicleChecklist || {};
          const doneCount = items.reduce((n, it) => n + (checklist[it.key] ? 1 : 0), 0);
          // Editable while drafting OR while the trip is in progress, so drivers
          // can correct an item and tap Update Trip. Locked only once the trip
          // is finished (completed) or cancelled.
          const disabled = formData.tripStatus === 'completed' || formData.tripStatus === 'cancelled';
          return (
            <>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderAccent} />
                <MaterialCommunityIcons name="clipboard-check-outline" size={18} color={COLORS.primaryThemeColor} />
                <Text style={styles.sectionTitle}>Pre-Trip Checklist</Text>
                <View style={styles.checklistCounter}>
                  <Text style={styles.checklistCounterText}>{doneCount} / {items.length} done</Text>
                </View>
              </View>
              <View style={styles.sectionGroup}>
                <View style={styles.checklistGrid}>
                  {items.map((it) => {
                    const checked = !!checklist[it.key];
                    return (
                      <Pressable
                        key={it.key}
                        onPress={() => !disabled && handleChecklistChange(it.key, !checked)}
                        style={[
                          styles.checklistChip,
                          checked && styles.checklistChipChecked,
                          disabled && styles.checklistChipDisabled,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={checked ? 'check-circle' : it.icon}
                          size={18}
                          color={checked ? COLORS.primaryThemeColor : COLORS.gray}
                        />
                        <Text style={[
                          styles.checklistChipText,
                          checked && styles.checklistChipTextChecked,
                        ]}>
                          {it.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          );
        })()}

        {/* Notes & Attachments */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeaderAccent} />
          <MaterialCommunityIcons name="paperclip" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.sectionTitle}>Notes & Attachments</Text>
        </View>
        <View style={styles.sectionGroup}>
          {/* Remarks */}
          {/* Remarks — polished card with header icon, focus-aware border,
              and live character counter. Raw RNTextInput because FormInput's
              TouchableWithoutFeedback wrapper swallows multiline taps. */}
          <View style={styles.remarksCard}>
            <View style={styles.remarksHeader}>
              <MaterialCommunityIcons name="note-text-outline" size={18} color={COLORS.primaryThemeColor} />
              <Text style={styles.remarksLabel}>Remarks</Text>
              <Text style={styles.remarksOptional}>Optional</Text>
            </View>
            <RNTextInput
              style={styles.remarksField}
              value={formData.remarks}
              onChangeText={(value) => handleInputChange('remarks', value)}
              placeholder="Add notes about this trip — e.g. road conditions, customer feedback, fuel observations…"
              placeholderTextColor="#9AA0A6"
              multiline
              numberOfLines={5}
              maxLength={500}
              textAlignVertical="top"
              editable={!isTripLocked}
            />
            <View style={styles.remarksFooter}>
              <Text style={styles.remarksHint}>
                {isTripLocked ? '🔒 Locked — trip is finalised' : 'Tap to add details about your trip'}
              </Text>
              <Text style={styles.remarksCounter}>
                {(formData.remarks?.length || 0)} / 500
              </Text>
            </View>
          </View>

          {/* Trip Image — tap on the image opens a full-screen preview.
              Replace = picker (camera/gallery), Remove = clear. */}
          {formData.imageUri ? (
            <View style={styles.imageCardFilled}>
              <Pressable onPress={() => setPreviewImageUri(formData.imageUri)} style={styles.imagePreviewWrap}>
                <Image source={{ uri: formData.imageUri }} style={styles.imagePreview} resizeMode="cover" />
                <View style={styles.imageOverlay}>
                  <Pressable
                    style={[styles.imageActionBtn, styles.imageActionBtnReplace]}
                    onPress={handleImagePicker}
                  >
                    <MaterialCommunityIcons name="image-edit" size={16} color="#fff" />
                    <Text style={styles.imageActionText}>Replace</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.imageActionBtn, styles.imageActionBtnDanger]}
                    onPress={() => handleInputChange('imageUri', '')}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                    <Text style={styles.imageActionText}>Remove</Text>
                  </Pressable>
                </View>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={handleImagePicker} style={styles.imageCardEmpty}>
              <MaterialCommunityIcons name="camera-plus-outline" size={36} color={COLORS.primaryThemeColor} />
              <Text style={styles.imageCardEmptyTitle}>Add a Trip Photo</Text>
              <Text style={styles.imageCardEmptySubtitle}>Tap to use Camera or Gallery</Text>
            </Pressable>
          )}
        </View>

        {/* Phase-aware action card */}
        {formData.tripStatus === 'completed' ? (
          <View style={[styles.actionCard, { borderLeftColor: '#2E7D32', backgroundColor: '#E8F5E9' }]}>
            <MaterialCommunityIcons name="check-circle" size={20} color="#2E7D32" />
            <Text style={[styles.actionCardText, { color: '#2E7D32' }]}>This trip is completed.</Text>
          </View>
        ) : formData.tripStatus === 'cancelled' ? (
          <View style={[styles.actionCard, { borderLeftColor: '#C62828', backgroundColor: '#FFEBEE' }]}>
            <MaterialCommunityIcons name="close-circle" size={20} color="#C62828" />
            <Text style={[styles.actionCardText, { color: '#C62828' }]}>This trip is cancelled.</Text>
          </View>
        ) : !formData.isTripStarted ? (
          (() => {
            console.log('[VehicleTrackingForm] Rendering Save + Start Trip row');
            return (
              <View style={[styles.actionGroup, styles.actionRow]}>
                <View style={styles.actionRowItem}>
                  <LoadingButton
                    title="💾  Save"
                    onPress={() => {
                      console.log('[VehicleTrackingForm] Save (draft) tapped');
                      setActiveAction('save');
                      // Save creates the trip in Odoo as DRAFT — startTrip stays false.
                      // Force fuel_checking=true so Odoo's create() constraint passes
                      // (matches what Start Trip does, and Odoo web's Save behaviour).
                      setFormData(prev => ({
                        ...prev,
                        startTrip: false,
                        endTrip: false,
                        vehicleChecklist: { ...(prev.vehicleChecklist || {}), fuelChecking: true },
                      }));
                      setPendingSubmit('save');
                    }}
                    loading={isSubmitting && activeAction === 'save'}
                    disabled={isSubmitting && activeAction !== 'save'}
                    backgroundColor="#6C757D"
                  />
                </View>
                <View style={styles.actionRowItem}>
                  <LoadingButton
                    title="▶  Start Trip"
                    onPress={() => {
                      console.log('[VehicleTrackingForm] Start button tapped');
                      setActiveAction('start');
                      setFormData(prev => ({ ...prev, startTrip: true, endTrip: false }));
                      setPendingSubmit('start');
                    }}
                    loading={isSubmitting && activeAction === 'start'}
                    disabled={isSubmitting && activeAction !== 'start'}
                    backgroundColor="#714B67"
                  />
                </View>
              </View>
            );
          })()
        ) : (
          (() => {
            console.log('[VehicleTrackingForm] Rendering action row — Update=#714B67, End=#198754, Cancel=#DC3545');
            return (
              <View style={[styles.actionGroup, styles.actionRow]}>
                {/* Update Trip — visible only when the user has unsaved edits.
                    Mirrors the Odoo form's `invisible="not is_dirty"` gating. */}
                {isDirty ? (
                <View style={styles.actionRowItem}>
                  <LoadingButton
                    title="↻  Update"
                    onPress={() => {
                      console.log('[VehicleTrackingForm] Update button tapped');
                      setActiveAction('update');
                      const startKmNum = parseInt(formData.startKM, 10) || 0;
                      const endKmNum = parseInt(formData.endKM, 10) || 0;
                      const computedTravelled = String(Math.max(endKmNum - startKmNum, 0));
                      setFormData(prev => ({
                        ...prev,
                        endTrip: false,
                        travelledKM: computedTravelled,
                      }));
                      setPendingSubmit('update');
                    }}
                    loading={isSubmitting && activeAction === 'update'}
                    disabled={isSubmitting && activeAction !== 'update'}
                    backgroundColor="#714B67"
                  />
                </View>
                ) : null}
                <View style={styles.actionRowItem}>
                  <Pressable
                    onPressIn={() => console.log('[VehicleTrackingForm] End onPressIn — touch detected')}
                    onPress={() => {
                      console.log('[VehicleTrackingForm] End onPress fired — endKM:', formData.endKM, 'startKM:', formData.startKM, 'isSubmitting:', isSubmitting);

                      if (isSubmitting) {
                        console.log('[VehicleTrackingForm] End ignored — already submitting');
                        return;
                      }

                      // Pre-flight: End KM must be present and greater than Start KM
                      const startKmNum = parseInt(formData.startKM, 10) || 0;
                      const endKmNum = parseInt(formData.endKM, 10) || 0;
                      if (!formData.endKM || String(formData.endKM).trim() === '' || endKmNum === 0) {
                        console.warn('[VehicleTrackingForm] End blocked — End KM empty/zero');
                        showToastMessage('Please enter the End KM (odometer reading) before ending the trip.', 'error');
                        setErrors(prev => ({ ...prev, endKM: 'End KM is required to end the trip' }));
                        return;
                      }
                      if (endKmNum <= startKmNum) {
                        console.warn('[VehicleTrackingForm] End blocked — End KM not greater than Start KM:', { startKmNum, endKmNum });
                        showToastMessage(`End KM (${endKmNum}) must be greater than Start KM (${startKmNum}).`, 'error');
                        setErrors(prev => ({ ...prev, endKM: 'End KM must be greater than Start KM' }));
                        return;
                      }

                      console.log('[VehicleTrackingForm] End pre-flight OK — stamping fields & queueing submit');
                      setActiveAction('end');
                      const now = new Date();
                      const computedTravelled = String(Math.max(endKmNum - startKmNum, 0));
                      setFormData(prev => ({
                        ...prev,
                        endTrip: true,
                        endTime: prev.endTime || now,
                        travelledKM: computedTravelled,
                      }));
                      setPendingSubmit('end');
                    }}
                    style={({ pressed }) => ({
                      height: 45,
                      width: '100%',
                      backgroundColor: '#198754',
                      borderRadius: 10,
                      marginVertical: 10,
                      paddingHorizontal: 8,
                      justifyContent: 'center',
                      alignItems: 'center',
                      opacity: pressed ? 0.75 : (isSubmitting && activeAction === 'end' ? 0.7 : 1),
                    })}
                  >
                    {isSubmitting && activeAction === 'end' ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={{ color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold }}>
                        ■  End
                      </Text>
                    )}
                  </Pressable>
                </View>
                <View style={styles.actionRowItem}>
                  <LoadingButton
                    title="✕  Cancel"
                    onPress={() => { setActiveAction('cancel'); handleCancelTrip(); }}
                    loading={isSubmitting && activeAction === 'cancel'}
                    disabled={isSubmitting && activeAction !== 'cancel'}
                    backgroundColor="#DC3545"
                  />
                </View>
              </View>
            );
          })()
        )}
      </RoundedScrollContainer>

      {/* Branded image-source picker (matches logout popup style) */}
      <StyledAlertModal
        isVisible={imagePickerVisible}
        message={imagePickerTitle}
        confirmText="Camera"
        middleText="Gallery"
        cancelText="Cancel"
        onConfirm={() => dispatchImageSource('camera')}
        onMiddle={() => dispatchImageSource('gallery')}
        onCancel={() => setImagePickerVisible(false)}
      />

      {/* Date Picker */}
      <DateTimePickerModal
        isVisible={isDatePickerVisible}
        mode="date"
        onConfirm={(date) => {
          handleInputChange('date', date);
          setIsDatePickerVisible(false);
        }}
        onCancel={() => setIsDatePickerVisible(false)}
      />

      {/* Start Time Picker */}
      <DateTimePickerModal
        isVisible={isStartTimePickerVisible}
        mode="datetime"
        onConfirm={(time) => {
          handleInputChange('startTime', time);
          setIsStartTimePickerVisible(false);
        }}
        onCancel={() => setIsStartTimePickerVisible(false)}
      />

      {/* End Time Picker */}
      <DateTimePickerModal
        isVisible={isEndTimePickerVisible}
        mode="datetime"
        onConfirm={(time) => {
          handleInputChange('endTime', time);
          setIsEndTimePickerVisible(false);
        }}
        onCancel={() => setIsEndTimePickerVisible(false)}
      />

      {/* Estimated Time Picker — HH:MM, stored as decimal hours. */}
      <DateTimePickerModal
        isVisible={isEstimatedTimePickerVisible}
        mode="time"
        is24Hour
        onConfirm={(d) => {
          const hrs = (d.getHours() + d.getMinutes() / 60).toFixed(2);
          handleInputChange('estimatedTime', hrs);
          setIsEstimatedTimePickerVisible(false);
        }}
        onCancel={() => setIsEstimatedTimePickerVisible(false)}
      />

      {/* Centered dropdown popup — branded to match the logout-style modal:
          theme border, logo orb pinned at the top of the card. */}
      <Modal
        visible={isVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setIsVisible(false)}
      >
        <Pressable style={styles.brandedOverlay} onPress={() => setIsVisible(false)}>
          <Pressable style={styles.brandedCard} onPress={() => {}}>
            <View style={styles.brandedLogoWrap}>
              <Image
                source={require('@assets/images/logo/logo.png')}
                style={styles.brandedLogo}
              />
            </View>
            <View style={styles.brandedHeader}>
              <Text style={styles.brandedTitle}>
                {selectedType?.type === 'vehicle'         ? 'Select Vehicle'
                : selectedType?.type === 'source'         ? 'Select Source'
                : selectedType?.type === 'destination'    ? 'Select Destination'
                : selectedType?.type === 'purposeOfVisit' ? 'Purpose of Visit'
                : 'Select'}
              </Text>
              <Pressable hitSlop={10} onPress={() => setIsVisible(false)}>
                <MaterialCommunityIcons name="close" size={22} color={COLORS.gray} />
              </Pressable>
            </View>
            <FlatList
              data={dropdownDataFor(selectedType?.type)}
              keyExtractor={(item) => item._id?.toString() || item.name}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => handleDropdownSelect(selectedType?.type, item)}
                >
                  <Text style={styles.modalItemText}>{item.name}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={(() => {
                const type = selectedType?.type;
                const loadingMap = {
                  vehicle: dropdownsLoading.vehicles,
                  source: dropdownsLoading.sourceLocations,
                  destination: dropdownsLoading.destinations,
                  purposeOfVisit: dropdownsLoading.purposesOfVisit,
                };
                const isLoading = !!loadingMap[type];
                return isLoading ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                    <ActivityIndicator color={COLORS.primaryThemeColor} />
                    <Text style={[styles.modalEmpty, { marginTop: 8 }]}>Loading…</Text>
                  </View>
                ) : (
                  <Text style={styles.modalEmpty}>No items</Text>
                );
              })()}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Fuel-log View popup — full details + thumbnails for one log. */}
      <Modal
        visible={!!viewFuelLog}
        animationType="fade"
        transparent
        onRequestClose={() => setViewFuelLog(null)}
      >
        <Pressable style={styles.brandedOverlay} onPress={() => setViewFuelLog(null)}>
          <Pressable style={[styles.brandedCard, { paddingBottom: 14 }]} onPress={() => {}}>
            <View style={styles.brandedLogoWrap}>
              <Image source={require('@assets/images/logo/logo.png')} style={styles.brandedLogo} />
            </View>
            <View style={styles.brandedHeader}>
              <Text style={styles.brandedTitle}>Fuel Entry Details</Text>
              <Pressable hitSlop={10} onPress={() => setViewFuelLog(null)}>
                <MaterialCommunityIcons name="close" size={22} color={COLORS.gray} />
              </Pressable>
            </View>
            {viewFuelLog ? (
              <ScrollView style={{ maxHeight: 460, paddingHorizontal: 14 }} keyboardShouldPersistTaps="handled">
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>Ref</Text>
                  <Text style={styles.fuelDetailValue}>{viewFuelLog.name || '-'}</Text>
                </View>
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>Driver</Text>
                  <Text style={styles.fuelDetailValue}>{viewFuelLog.driver_name || '-'}</Text>
                </View>
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>Amount (OMR)</Text>
                  <Text style={styles.fuelDetailValue}>{viewFuelLog.amount ?? '-'}</Text>
                </View>
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>Fuel Level (Litres)</Text>
                  <Text style={styles.fuelDetailValue}>{viewFuelLog.fuel_level ?? '-'}</Text>
                </View>
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>Odometer</Text>
                  <Text style={styles.fuelDetailValue}>{viewFuelLog.odometer ?? '-'}</Text>
                </View>
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>GPS</Text>
                  <Text style={styles.fuelDetailValue}>
                    {viewFuelLog.gps_lat || viewFuelLog.gps_long
                      ? `${viewFuelLog.gps_lat || '-'}, ${viewFuelLog.gps_long || '-'}`
                      : '-'}
                  </Text>
                </View>
                <View style={styles.fuelDetailRow}>
                  <Text style={styles.fuelDetailLabel}>Created</Text>
                  <Text style={styles.fuelDetailValue}>{viewFuelLog.create_date || '-'}</Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 12, marginTop: 12, justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.fuelDetailLabel}>Odometer Image</Text>
                    {viewOdometerSrc ? (
                      <Pressable onPress={() => setPreviewImageUri(viewOdometerSrc.uri)}>
                        <Image source={viewOdometerSrc} style={styles.fuelDetailThumb} />
                      </Pressable>
                    ) : (
                      <View style={[styles.fuelDetailThumb, styles.fuelDetailThumbEmpty]}>
                        <Text style={styles.fuelDetailThumbEmptyText}>No image</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.fuelDetailLabel}>Receipt</Text>
                    {viewReceiptSrc ? (
                      <Pressable onPress={() => setPreviewImageUri(viewReceiptSrc.uri)}>
                        <Image source={viewReceiptSrc} style={styles.fuelDetailThumb} />
                      </Pressable>
                    ) : (
                      <View style={[styles.fuelDetailThumb, styles.fuelDetailThumbEmpty]}>
                        <Text style={styles.fuelDetailThumbEmptyText}>No image</Text>
                      </View>
                    )}
                  </View>
                </View>
              </ScrollView>
            ) : null}
            <View style={{ paddingHorizontal: 8, paddingTop: 12 }}>
              <Pressable
                onPress={() => setViewFuelLog(null)}
                style={{ paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: COLORS.primaryThemeColor }}
              >
                <Text style={{ color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 }}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add Fuel popup — modal with the fuel-entry form + Cancel / Add Fuel
          buttons. Each Add Fuel tap creates a NEW vehicle.fuel.log against
          the trip, mirroring the Odoo module's repeat-add behaviour. */}
      <Modal
        visible={showAddFuel}
        animationType="fade"
        transparent
        onRequestClose={closeAddFuelPopup}
      >
        <View style={styles.brandedOverlay}>
          {/* Tappable backdrop — only the dimmed area outside the card closes
              the popup. Inner card uses `onStartShouldSetResponder` to claim
              every touch so taps don't bubble to this backdrop (which was
              causing the popup to auto-close after image picks). */}
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAddFuelPopup} />
          <View
            style={[styles.brandedCard, { paddingBottom: 14 }]}
            onStartShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
          >
            <View style={styles.brandedLogoWrap}>
              <Image source={require('@assets/images/logo/logo.png')} style={styles.brandedLogo} />
            </View>
            <View style={styles.brandedHeader}>
              <Text style={styles.brandedTitle}>Add Fuel Entry</Text>
              <Pressable hitSlop={10} onPress={closeAddFuelPopup}>
                <MaterialCommunityIcons name="close" size={22} color={COLORS.gray} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              <View style={styles.inputRow}>
                <View style={styles.halfInput}>
                  <FormInput
                    label="Fuel Amount"
                    value={formData.fuelAmount}
                    onChangeText={(value) => handleInputChange('fuelAmount', value)}
                    placeholder="Amount"
                    keyboardType="numeric"
                    selectTextOnFocus
                  />
                </View>
                <View style={styles.halfInput}>
                  <FormInput
                    label="Fuel Litre"
                    value={formData.fuelLitre}
                    onChangeText={(value) => handleInputChange('fuelLitre', value)}
                    placeholder="Litres"
                    keyboardType="numeric"
                    selectTextOnFocus
                  />
                </View>
              </View>

              <FormInput
                label="Current Odometer"
                value={formData.currentOdometer}
                onChangeText={(value) => handleInputChange('currentOdometer', value)}
                placeholder="Odometer reading"
                keyboardType="numeric"
                selectTextOnFocus
              />

              <View style={styles.rowSpace}>
                <View style={styles.imageColumn}>
                  <Pressable style={styles.smallButton} onPress={handleOdometerPicker}>
                    <Text style={styles.smallButtonText}>Odometer Image</Text>
                  </Pressable>
                  {formData.odometerImageUri ? (
                    <Pressable onPress={() => setPreviewImageUri(formData.odometerImageUri)}>
                      <Image source={{ uri: formData.odometerImageUri }} style={styles.thumbImage} />
                    </Pressable>
                  ) : (
                    <Text style={styles.fileNameText}>No image</Text>
                  )}
                </View>
                <View style={styles.imageColumn}>
                  <Pressable style={styles.smallButton} onPress={handleFuelInvoicePicker}>
                    <Text style={styles.smallButtonText}>Fuel Invoice</Text>
                  </Pressable>
                  {formData.fuelInvoiceUri ? (
                    <Pressable onPress={() => setPreviewImageUri(formData.fuelInvoiceUri)}>
                      <Image source={{ uri: formData.fuelInvoiceUri }} style={styles.thumbImage} />
                    </Pressable>
                  ) : (
                    <Text style={styles.fileNameText}>No invoice</Text>
                  )}
                </View>
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 8, paddingTop: 12 }}>
              <Pressable
                onPress={closeAddFuelPopup}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
                  backgroundColor: '#9E9E9E',
                }}
              >
                <Text style={{ color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitAddFuel}
                disabled={isSavingFuel}
                style={{
                  flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
                  backgroundColor: '#198754', opacity: isSavingFuel ? 0.7 : 1,
                }}
              >
                {isSavingFuel
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={{ color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 14 }}>Add Fuel</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* In-app camera — replaces ImagePicker.launchCameraAsync to avoid the
          OOM crash when OK is tapped on a full-resolution OS preview. Capture
          is one-tap (shutter only), no Cancel/OK overlay. */}
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
                  {cameraTarget === 'fuel'     ? 'Fuel Invoice'
                  : cameraTarget === 'odometer' ? 'Odometer Image'
                  :                               'Trip Photo'}
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

      {/* Full-screen image preview (lightbox). Tap anywhere to dismiss. */}
      <Modal
        visible={!!previewImageUri}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <Pressable style={styles.previewOverlay} onPress={() => setPreviewImageUri(null)}>
          <Pressable
            style={styles.previewClose}
            onPress={() => setPreviewImageUri(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </Pressable>
          {previewImageUri ? (
            <Image source={{ uri: previewImageUri }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>

      {/* Branded confirm popup for Cancel Trip (replaces Alert.alert). */}
      <StyledAlertModal
        isVisible={cancelConfirmVisible}
        message="Are you sure you want to cancel this trip? This action cannot be undone."
        confirmText="Yes, Cancel"
        cancelText="No"
        destructive
        onConfirm={performCancelTrip}
        onCancel={() => setCancelConfirmVisible(false)}
      />

      <OverlayLoader visible={isLoading} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 8,
    gap: 8,
  },
  sectionHeaderAccent: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: COLORS.primaryThemeColor,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
    letterSpacing: 0.2,
  },

  sectionGroup: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border || '#ECECEC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },

  // Pre-Trip Checklist — chip grid
  checklistCounter: {
    backgroundColor: '#EEF3FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  checklistCounterText: {
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    letterSpacing: 0.3,
  },
  checklistGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checklistChip: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#F4F6FA',
    borderWidth: 1,
    borderColor: '#E6E9F0',
    gap: 6,
  },
  checklistChipChecked: {
    backgroundColor: '#EEF3FF',
    borderColor: COLORS.primaryThemeColor,
  },
  checklistChipDisabled: {
    opacity: 0.55,
  },
  checklistChipText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.darkGray || '#444',
  },
  checklistChipTextChecked: {
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  // Trip image card
  imageCardEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryThemeColor,
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFBFF',
    marginTop: 6,
  },
  imageCardEmptyTitle: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
  },
  imageCardEmptySubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  imageCardFilled: {
    marginTop: 6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  imagePreviewWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  imageActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 4,
  },
  imageActionBtnDanger: {
    backgroundColor: 'rgba(229,57,53,0.85)',
  },
  imageActionBtnReplace: {
    backgroundColor: 'rgba(113,75,103,0.92)', // Odoo brand purple
  },

  // Lightbox preview
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  previewImage: {
    width: '100%',
    height: '90%',
  },

  // Fuel List card (mirrors Odoo's fuel_log_ids table)
  fuelListCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  fuelListTitle: {
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  fuelListRowHeader: {
    flexDirection: 'row',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  fuelListRow: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingBottom: 4,
  },
  fuelListCol: {
    flex: 1,
    fontSize: 12,
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  fuelListColHeader: {
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  fuelListThumbRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  fuelListThumb: {
    width: 56,
    height: 56,
    borderRadius: 6,
    backgroundColor: '#EEE',
  },
  fuelListThumbLabel: {
    fontSize: 10,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    textAlign: 'center',
    marginTop: 2,
  },

  // Fuel List "View" button
  fuelListViewBtn: {
    flex: 0.6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryThemeColor,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
  },
  fuelListViewBtnText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },

  // Fuel-log detail popup
  fuelDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F4F4F6',
  },
  fuelDetailLabel: {
    flex: 1,
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  fuelDetailValue: {
    flex: 1.4,
    textAlign: 'right',
    fontSize: 13,
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  fuelDetailThumb: {
    width: 110,
    height: 110,
    borderRadius: 8,
    marginTop: 6,
    backgroundColor: '#EEE',
  },
  fuelDetailThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderStyle: 'dashed',
    backgroundColor: '#FAFAFA',
  },
  fuelDetailThumbEmptyText: {
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  imageActionText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },

  actionGroup: {
    marginTop: 24,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionRowItem: {
    flex: 1,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderLeftWidth: 4,
    marginTop: 24,
    gap: 10,
  },
  actionCardText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
  vehicleSection: {
    marginTop: 10,
  },
  checkboxContainer: {
    marginVertical: 5,
  },
  checklistContainer: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border || '#E0E0E0',
  },
  readOnlyInput: {
    backgroundColor: COLORS.lightGray,
  },
  helperDanger: {
    fontFamily: FONT_FAMILY.urbanistMedium,
    fontSize: 11,
    color: '#E53935',
    marginTop: -8,
    marginBottom: 8,
    marginLeft: 4,
  },
  remarksInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  remarksCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#ECECEC',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  remarksHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F2',
    marginBottom: 8,
  },
  remarksLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    letterSpacing: 0.2,
  },
  remarksOptional: {
    fontSize: 10,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    backgroundColor: '#F4F6FA',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
    letterSpacing: 0.4,
  },
  remarksField: {
    minHeight: 110,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistMedium,
    fontSize: 14,
    backgroundColor: '#FAFBFD',
    borderWidth: 1,
    borderColor: '#E6E9F0',
    lineHeight: 20,
  },
  remarksFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  remarksHint: {
    flex: 1,
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  remarksCounter: {
    fontSize: 11,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistBold,
    letterSpacing: 0.3,
  },
  submitButton: {
    marginTop: 24,
    borderRadius: 12,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },
  imageUploadContainer: {
    marginVertical: 15,
    alignItems: 'flex-start',
  },
  imagePickerButton: {
    width: 80,
    height: 80,
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  imagePickerButtonSelected: {
    backgroundColor: '#2E7D32',
  },
  imageSelectedText: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  imagePickerIcon: {
    fontSize: 24,
    color: 'white',
    position: 'absolute',
    top: 8,
    right: 8,
  },
  imagePickerText: {
    fontSize: 32,
    color: 'white',
    fontWeight: 'bold',
  },
  inputWithIconContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 15,
  },
  inputWrapper: {
    flex: 1,
    marginRight: 10,
  },
  qrIconButton: {
    width: 50,
    height: 50,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5,
  },
  tripStatusText: {
    fontSize: 12,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginTop: 5,
    fontStyle: 'italic',
  },
  disabledInput: {
    backgroundColor: COLORS.lightGray,
    opacity: 0.6,
  },
  tripActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 15,
    paddingHorizontal: 20,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: COLORS.red || '#FF6B6B',
    borderWidth: 1,
    borderColor: COLORS.red || '#FF6B6B',
  },
  cancelButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
  tripStatusIndicator: {
    backgroundColor: COLORS.lightGray || '#F5F5F5',
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryThemeColor,
  },
  tripStatusTitle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    color: COLORS.black,
    marginBottom: 5,
  },
  tripStatusValue: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  tripStatusInProgress: {
    color: COLORS.primaryThemeColor || '#007AFF',
  },
  tripStatusCompleted: {
    color: COLORS.green || '#28A745',
  },
  tripStatusCancelled: {
    color: COLORS.red || '#DC3545',
  },
  tripStatusDetails: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.gray || '#666666',
    marginTop: 2,
  },
  fuelToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  fuelToggleActive: {
    backgroundColor: '#198754', // green when expanded ("hide")
    borderColor: '#198754',
  },
  fuelToggleInactive: {
    backgroundColor: '#E8F5E9', // soft green tint when collapsed ("add")
    borderColor: '#198754',
  },
  fuelToggleTextActive: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 14,
  },
  fuelToggleTextInactive: {
    color: '#198754',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 14,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border || '#E6E6E6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 6,
    color: COLORS.black,
  },
  selectBox: {
    backgroundColor: '#f7f7f7',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectBoxError: {
    borderWidth: 1,
    borderColor: 'red',
  },
  selectBoxText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  selectBoxChevron: {
    fontSize: 18,
    color: COLORS.gray,
    marginLeft: 8,
  },
  errorText: {
    color: 'red',
    fontSize: 12,
    marginTop: 6,
  },
  primaryButton: {
    backgroundColor: COLORS.primaryThemeColor,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
  fuelToggleText: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
  fuelCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border || '#E6E6E6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  fuelHeader: {
    marginBottom: 8,
  },
  fuelHeaderTitle: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    color: COLORS.black,
  },
  fuelHeaderSubtitle: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.gray,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  halfInput: {
    flex: 1,
  },
  rowSpace: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  imageColumn: {
    flex: 1,
    alignItems: 'flex-start',
    marginRight: 8,
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 6,
  },
  smallButtonText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    fontSize: 13,
  },
  thumbImage: {
    width: 80,
    height: 80,
    marginTop: 8,
    borderRadius: 6,
    resizeMode: 'cover',
  },
  fileNameText: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.gray,
  },
  // In-app camera (matches VisitForm.js fix)
  cameraModalContainer: { flex: 1, backgroundColor: '#000' },
  cameraView: { flex: 1 },
  cameraOverlay: { flex: 1, justifyContent: 'space-between' },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cameraCloseBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  cameraTitle: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 16 },
  cameraBottomBar: {
    alignItems: 'center',
    paddingBottom: 50,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cameraShutterBtn: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  cameraShutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  // Branded popup (matches StyledAlertModal / logout look)
  brandedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  brandedCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '70%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primaryThemeColor,
    paddingHorizontal: 6,
    paddingTop: 50,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  brandedLogoWrap: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    borderRadius: 80,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.orange || '#FF9800',
  },
  brandedLogo: {
    height: 80,
    width: 80,
    borderRadius: 80,
    resizeMode: 'contain',
  },
  brandedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
    marginBottom: 4,
  },
  brandedTitle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
  },
  modalContent: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '70%',
    backgroundColor: COLORS.white,
    borderRadius: 14,
    paddingHorizontal: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
    marginBottom: 4,
  },
  modalHeaderTitle: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
  },
  modalItem: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border || '#E0E0E0',
  },
  modalItemText: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.black,
  },
  modalEmpty: {
    padding: 20,
    textAlign: 'center',
    color: COLORS.gray,
  },
  modalCancel: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 16,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
});

export default VehicleTrackingForm;