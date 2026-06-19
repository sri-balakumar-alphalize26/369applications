import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Keyboard,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { showToastMessage } from '@components/Toast';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Full-screen destination picker built on free OpenStreetMap tiles (no Google
// Maps API key needed). The driver searches a place name and/or taps the map to
// drop a marker, then taps Confirm. We reverse-geocode the marker to a readable
// name and hand {name, latitude, longitude} back to VehicleTrackingForm via the
// `onPicked` callback passed in route params. Odoo then find-or-creates the
// matching vehicle.location, so distance estimate / GPS verification keep working.

const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
// Nominatim usage policy asks for a descriptive identifier on every request.
const NOMINATIM_HEADERS = {
  'User-Agent': 'AlphalizeApp/1.0 (vehicle-tracking destination picker)',
  'Accept': 'application/json',
};

const DestinationMapPicker = ({ route }) => {
  const navigation = useNavigation();
  const { initialLatitude, initialLongitude, initialName, onPicked } = route?.params || {};

  // Center on the driver's current location when we have it, else a sensible
  // default (roughly central India) so the map isn't stuck in the ocean.
  const startLat = Number.isFinite(Number(initialLatitude)) ? Number(initialLatitude) : 20.5937;
  const startLng = Number.isFinite(Number(initialLongitude)) ? Number(initialLongitude) : 78.9629;
  const hasInitial = Number.isFinite(Number(initialLatitude)) && Number.isFinite(Number(initialLongitude));

  const mapRef = useRef(null);
  const [region, setRegion] = useState({
    latitude: startLat,
    longitude: startLng,
    latitudeDelta: hasInitial ? 0.05 : 6,
    longitudeDelta: hasInitial ? 0.05 : 6,
  });
  const [marker, setMarker] = useState(null);
  const [placeName, setPlaceName] = useState(initialName || '');
  const [resolvingName, setResolvingName] = useState(false);

  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);

  // Reverse-geocode a coordinate to a readable place name (OS-provided, offline-
  // capable via expo-location — no extra API key).
  const resolveName = useCallback(async (lat, lng) => {
    setResolvingName(true);
    try {
      const rg = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (rg && rg.length > 0) {
        const p = rg[0];
        const name = [p.name, p.street, p.city, p.region].filter(Boolean).join(', ');
        if (name) setPlaceName(name);
        else setPlaceName(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      } else {
        setPlaceName(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      }
    } catch (e) {
      setPlaceName(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } finally {
      setResolvingName(false);
    }
  }, []);

  const placeMarker = useCallback((lat, lng) => {
    setMarker({ latitude: lat, longitude: lng });
    resolveName(lat, lng);
  }, [resolveName]);

  const handleMapPress = (e) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    placeMarker(latitude, longitude);
  };

  // Free OpenStreetMap (Nominatim) place search — no Google key.
  const runSearch = useCallback(async () => {
    const q = searchText.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    setResults([]);
    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=' +
        encodeURIComponent(q);
      const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        setResults(data);
      } else {
        showToastMessage('No places found for that search', 'info');
      }
    } catch (e) {
      showToastMessage('Place search failed. Check your connection.', 'error');
    } finally {
      setSearching(false);
    }
  }, [searchText]);

  const handleSelectResult = (item) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const next = { latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    setRegion(next);
    mapRef.current?.animateToRegion(next, 600);
    setMarker({ latitude: lat, longitude: lng });
    setPlaceName(item.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    setResults([]);
    setSearchText('');
    Keyboard.dismiss();
  };

  const handleConfirm = () => {
    if (!marker) {
      showToastMessage('Tap the map to choose a destination first', 'info');
      return;
    }
    if (typeof onPicked === 'function') {
      onPicked({
        name: placeName || `${marker.latitude.toFixed(5)}, ${marker.longitude.toFixed(5)}`,
        latitude: marker.latitude,
        longitude: marker.longitude,
      });
    }
    navigation.goBack();
  };

  return (
    <SafeAreaView>
      <NavigationHeader title="Select Destination" onBackPress={() => navigation.goBack()} />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <MaterialCommunityIcons name="magnify" size={20} color={COLORS.gray} style={{ marginLeft: 10 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search a place (e.g. Madurai)"
          placeholderTextColor={COLORS.gray}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={runSearch}
          returnKeyType="search"
        />
        {searching ? (
          <ActivityIndicator size="small" color={COLORS.primaryThemeColor} style={{ marginRight: 12 }} />
        ) : (
          <TouchableOpacity onPress={runSearch} style={styles.searchBtn}>
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Search results dropdown */}
      {results.length > 0 && (
        <View style={styles.resultsBox}>
          <FlatList
            data={results}
            keyExtractor={(item, idx) => `${item.place_id || idx}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.resultRow} onPress={() => handleSelectResult(item)}>
                <MaterialCommunityIcons name="map-marker-outline" size={18} color={COLORS.primaryThemeColor} />
                <Text style={styles.resultText} numberOfLines={2}>{item.display_name}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          onPress={handleMapPress}
          showsUserLocation={hasInitial}
        >
          {/* Free OSM tiles — no Google Maps API key required. */}
          <UrlTile urlTemplate={OSM_TILE_URL} maximumZ={19} flipY={false} />
          {marker && (
            <Marker coordinate={marker} title="Destination" pinColor={COLORS.primaryThemeColor} />
          )}
        </MapView>

        {/* Hint when nothing picked yet */}
        {!marker && (
          <View style={styles.hint} pointerEvents="none">
            <Text style={styles.hintText}>Tap on the map to drop a destination pin</Text>
          </View>
        )}
      </View>

      {/* Selected place + confirm */}
      <View style={styles.footer}>
        <View style={styles.selectedRow}>
          <MaterialCommunityIcons name="map-marker-check" size={20} color={COLORS.primaryThemeColor} />
          <Text style={styles.selectedText} numberOfLines={2}>
            {resolvingName ? 'Resolving place…' : (placeName || 'No destination selected')}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.confirmBtn, !marker && styles.confirmBtnDisabled]}
          onPress={handleConfirm}
          disabled={!marker}
        >
          <Text style={styles.confirmBtnText}>Confirm Destination</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontFamily: FONT_FAMILY.urbanistRegular,
    fontSize: 14,
    color: '#222',
  },
  searchBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 8,
    marginRight: 6,
  },
  searchBtnText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistSemiBold, fontSize: 13 },
  resultsBox: {
    maxHeight: 220,
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    overflow: 'hidden',
    zIndex: 20,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEE',
  },
  resultText: { flex: 1, marginLeft: 8, fontSize: 13, fontFamily: FONT_FAMILY.urbanistRegular, color: '#333' },
  mapWrap: { flex: 1, margin: 12, borderRadius: 12, overflow: 'hidden' },
  hint: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  hintText: { color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  selectedRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  selectedText: { flex: 1, marginLeft: 8, fontSize: 14, fontFamily: FONT_FAMILY.urbanistMedium, color: '#222' },
  confirmBtn: {
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirmBtnDisabled: { backgroundColor: '#B7C2CE' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontFamily: FONT_FAMILY.urbanistSemiBold },
});

export default DestinationMapPicker;
