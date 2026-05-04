import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView, RoundedScrollContainer } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import OfflineBanner from '@components/common/OfflineBanner';
import { TextInput as FormInput } from '@components/common/TextInput';
import { LoadingButton } from '@components/common/Button';
import { OverlayLoader } from '@components/Loader';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { showToast } from '@utils/common';
import {
  createVehicleLocationOdoo,
  updateVehicleLocationOdoo,
} from '@api/services/generalApi';

const VehicleLocationForm = ({ navigation, route }) => {
  const editing = route?.params?.record;
  const [name, setName] = useState(editing?.name || '');
  const [locationText, setLocationText] = useState(editing?.location || '');
  const [latitude, setLatitude] = useState(
    editing?.latitude !== undefined && editing?.latitude !== null ? String(editing.latitude) : ''
  );
  const [longitude, setLongitude] = useState(
    editing?.longitude !== undefined && editing?.longitude !== null ? String(editing.longitude) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [fetchingLoc, setFetchingLoc] = useState(false);

  const useMyLocation = async () => {
    setFetchingLoc(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showToast({ type: 'error', title: 'Location permission denied' });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      if (pos?.coords) {
        setLatitude(String(pos.coords.latitude));
        setLongitude(String(pos.coords.longitude));
        showToast({ type: 'success', title: 'Location captured' });
      }
    } catch (e) {
      console.log('[VehicleLocationForm] location fetch failed:', e?.message);
      showToast({ type: 'error', title: 'Could not get GPS fix' });
    } finally {
      setFetchingLoc(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      showToast({ type: 'error', title: 'Name is required' });
      return;
    }
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      showToast({ type: 'error', title: 'Latitude / Longitude required' });
      return;
    }
    setSubmitting(true);
    try {
      if (editing?.id) {
        await updateVehicleLocationOdoo(editing.id, {
          name: name.trim(),
          location: locationText.trim() || name.trim(),
          latitude: lat,
          longitude: lng,
        });
        showToast({ type: 'success', title: 'Location updated' });
      } else {
        await createVehicleLocationOdoo({
          name: name.trim(),
          location: locationText.trim() || name.trim(),
          latitude: lat,
          longitude: lng,
        });
        showToast({ type: 'success', title: 'Location added' });
      }
      navigation.goBack();
    } catch (e) {
      console.log('[VehicleLocationForm] save failed:', e?.message);
      showToast({ type: 'error', title: 'Save failed', message: e?.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView>
      <NavigationHeader
        title={editing ? 'Edit Location' : 'New Location'}
        onBackPress={() => navigation.goBack()}
      />
      <OfflineBanner message="OFFLINE — vehicle locations require an internet connection to save" />
      <RoundedScrollContainer>
        <View style={styles.section}>
          <FormInput
            label="Location Name"
            placeholder="e.g. Head Office"
            value={name}
            onChangeText={setName}
            required
          />
          <FormInput
            label="Address / Description"
            placeholder="e.g. 123 Main St, Building A"
            value={locationText}
            onChangeText={setLocationText}
          />

          <TouchableOpacity
            style={styles.locBtn}
            onPress={useMyLocation}
            activeOpacity={0.8}
            disabled={fetchingLoc}
          >
            <MaterialIcons name="my-location" size={18} color="#fff" />
            <Text style={styles.locBtnText}>
              {fetchingLoc ? 'Getting GPS fix...' : 'Use my current location'}
            </Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <FormInput
                label="Latitude"
                placeholder="0.000000"
                value={latitude}
                onChangeText={setLatitude}
                keyboardType="numeric"
                required
              />
            </View>
            <View style={{ flex: 1 }}>
              <FormInput
                label="Longitude"
                placeholder="0.000000"
                value={longitude}
                onChangeText={setLongitude}
                keyboardType="numeric"
                required
              />
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <LoadingButton
            title={editing ? 'UPDATE' : 'SAVE'}
            onPress={handleSubmit}
            loading={submitting}
          />
        </View>
      </RoundedScrollContainer>
      <OverlayLoader visible={submitting} />
    </SafeAreaView>
  );
};

export default VehicleLocationForm;

const styles = StyleSheet.create({
  section: { paddingHorizontal: 14, paddingTop: 10 },
  locBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryThemeColor,
    paddingVertical: 11,
    borderRadius: 10,
    marginVertical: 12,
  },
  locBtnText: {
    color: '#fff',
    marginLeft: 8,
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },
  actions: { paddingHorizontal: 14, paddingBottom: 30, paddingTop: 16 },
});
