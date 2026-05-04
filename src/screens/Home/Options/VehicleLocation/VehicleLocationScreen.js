import React, { useState, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, FlatList, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import OfflineBanner from '@components/common/OfflineBanner';
import { OverlayLoader } from '@components/Loader';
import { FABButton } from '@components/common/Button';
import { EmptyState } from '@components/common/empty';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialIcons, AntDesign } from '@expo/vector-icons';
import { fetchVehicleLocationsOdoo } from '@api/services/generalApi';

const VehicleLocationScreen = ({ navigation }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchVehicleLocationsOdoo({});
      setItems(data || []);
    } catch (e) {
      console.log('[VehicleLocation] fetch failed:', e?.message);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => { fetchData(); }, [fetchData])
  );

  const filtered = searchText.trim()
    ? items.filter((i) => (i.name || '').toLowerCase().includes(searchText.trim().toLowerCase()))
    : items;

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => navigation.navigate('VehicleLocationForm', { record: item })}
      activeOpacity={0.7}
    >
      <View style={styles.rowIcon}>
        <MaterialIcons name="place" size={24} color={COLORS.primaryThemeColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.name || '-'}</Text>
        {item.location ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>{item.location}</Text>
        ) : null}
        <Text style={styles.rowMeta} numberOfLines={1}>
          {Number(item.latitude || 0).toFixed(5)}, {Number(item.longitude || 0).toFixed(5)}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color="#bbb" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView>
      <NavigationHeader title="Vehicle Locations" navigation={navigation} />
      <OfflineBanner
        message="OFFLINE — showing cached locations"
        onOnline={fetchData}
      />
      <View style={styles.searchWrapper}>
        <View style={styles.searchRow}>
          <AntDesign name="search1" size={18} color="#aaa" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search locations..."
            placeholderTextColor="#aaa"
            value={searchText}
            onChangeText={setSearchText}
          />
        </View>
      </View>
      <View style={{ flex: 1 }}>
        {filtered.length === 0 && !loading ? (
          <EmptyState
            imageSource={require('@assets/images/EmptyData/empty_data.png')}
            message={'no locations found'}
          />
        ) : (
          <FlatList
            data={filtered}
            renderItem={renderItem}
            keyExtractor={(it) => String(it.id)}
            contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8, paddingBottom: 80 }}
            onRefresh={fetchData}
            refreshing={loading}
          />
        )}
        <FABButton onPress={() => navigation.navigate('VehicleLocationForm')} />
      </View>
      <OverlayLoader visible={loading} />
    </SafeAreaView>
  );
};

export default VehicleLocationScreen;

const styles = StyleSheet.create({
  searchWrapper: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: FONT_FAMILY.urbanistRegular,
    fontSize: 14,
    color: '#333',
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginVertical: 5,
    marginHorizontal: 5,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F4EFFA',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: {
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 15,
    color: '#222',
  },
  rowSubtitle: {
    fontFamily: FONT_FAMILY.urbanistMedium,
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  rowMeta: {
    fontFamily: FONT_FAMILY.urbanistMedium,
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
});
