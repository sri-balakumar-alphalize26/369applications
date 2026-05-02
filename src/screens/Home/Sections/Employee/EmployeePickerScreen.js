// Full-screen employee picker — mirrors CustomerScreen's selectMode UX so
// forms can navigate(here, { selectMode, onSelect }) instead of opening a
// bottom-sheet dropdown. Used by Visits → Customer.js for "Visited By".

import React, { useState, useEffect, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { TouchableOpacity, ActivityIndicator, View, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import Text from '@components/Text';
import { RoundedContainer, SafeAreaView, SearchContainer } from '@components/containers';
import { EmptyState } from '@components/common/empty';
import { NavigationHeader } from '@components/Header';
import { fetchEmployeesOdoo } from '@api/services/generalApi';
import { useDebouncedSearch } from '@hooks';
import { COLORS, FONT_FAMILY } from '@constants/theme';

const EmployeePickerScreen = ({ navigation, route }) => {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (text = '') => {
    console.log('[EmployeePicker] fetching employees, searchText="' + (text || '') + '"');
    setLoading(true);
    try {
      const list = await fetchEmployeesOdoo(text || '');
      console.log('[EmployeePicker] fetched', Array.isArray(list) ? list.length : 0, 'employees');
      setEmployees(Array.isArray(list) ? list : []);
    } catch (e) {
      console.log('[EmployeePicker] fetch error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const { searchText, handleSearchTextChange } = useDebouncedSearch(
    (text) => load(text), 400
  );

  useFocusEffect(
    useCallback(() => { load(searchText); }, [searchText, load])
  );

  useEffect(() => { load(''); }, [load]);

  const onSelectEmployee = (item) => {
    console.log('[EmployeePicker] selected employee id=' + item?.id + ' name="' + item?.name + '"');
    if (route?.params?.selectMode && typeof route.params.onSelect === 'function') {
      route.params.onSelect(item);
      navigation.goBack();
    } else {
      console.log('[EmployeePicker] WARN: opened without selectMode/onSelect — closing without action');
      navigation.goBack();
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={() => onSelectEmployee(item)}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {(item?.name || '?').trim().charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{item?.name || '-'}</Text>
        {item?.department ? (
          <View style={styles.metaRow}>
            <MaterialIcons name="business" size={14} color="#999" style={{ marginRight: 4 }} />
            <Text style={styles.meta}>{item.department}</Text>
          </View>
        ) : null}
      </View>
      <MaterialIcons name="chevron-right" size={22} color="#ccc" />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView>
      <NavigationHeader title="Select Employee" onBackPress={() => navigation.goBack()} />
      <SearchContainer placeholder="Search Employees" onChangeText={handleSearchTextChange} />
      <RoundedContainer>
        <View style={{ flex: 1 }}>
          {employees.length === 0 && !loading ? (
            <EmptyState imageSource={require('@assets/images/EmptyData/empty_data.png')} message={''} />
          ) : (
            <FlashList
              data={employees}
              renderItem={renderItem}
              keyExtractor={(item, index) => String(item?.id ?? index)}
              contentContainerStyle={{ padding: 10, paddingBottom: 50 }}
              showsVerticalScrollIndicator={false}
              estimatedItemSize={72}
              ListFooterComponent={loading && <ActivityIndicator size="large" color={COLORS.orange} />}
            />
          )}
        </View>
      </RoundedContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 4,
    marginVertical: 5,
    ...Platform.select({
      android: { elevation: 3 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.12, shadowRadius: 4 },
    }),
  },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: COLORS.primaryThemeColor || '#5C2D91',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 18 },
  info: { flex: 1, marginLeft: 14 },
  name: { fontFamily: FONT_FAMILY.urbanistBold, fontSize: 15, color: COLORS.primaryThemeColor },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  meta: { fontFamily: FONT_FAMILY.urbanistMedium, fontSize: 13, color: '#888' },
});

export default EmployeePickerScreen;
