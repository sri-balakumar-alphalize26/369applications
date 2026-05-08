import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

const FIELD_COLOR = '#1976D2';

const fmtTime = (s) => {
  if (!s) return '';
  return String(s).slice(11, 16);
};

const STATUS_COLOR = {
  draft: '#9E9E9E',
  in_progress: '#1976D2',
  ended: '#43A047',
  cancelled: '#E53935',
};

const TripPickerSheet = ({
  visible,
  trips,
  loading,
  selectedId,
  onSelect,
  onClose,
  onCreateNew,
  title = 'Pick a Trip',
}) => {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trips || [];
    return (trips || []).filter((t) => {
      const ref = String(t.ref || '').toLowerCase();
      const src = Array.isArray(t.source_id) ? String(t.source_id[1] || '').toLowerCase() : '';
      const dst = Array.isArray(t.destination_id) ? String(t.destination_id[1] || '').toLowerCase() : '';
      const veh = Array.isArray(t.vehicle_id) ? String(t.vehicle_id[1] || '').toLowerCase() : '';
      return ref.includes(q) || src.includes(q) || dst.includes(q) || veh.includes(q);
    });
  }, [trips, search]);

  const renderItem = ({ item }) => {
    const isSelected = item.id === selectedId;
    const statusColor = STATUS_COLOR[item.trip_status] || '#666';
    return (
      <TouchableOpacity
        style={[styles.row, isSelected && styles.rowSelected]}
        activeOpacity={0.75}
        onPress={() => { onSelect(item); }}
      >
        <View style={styles.rowIcon}>
          <MaterialIcons name="directions-car" size={18} color={FIELD_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>{item.ref || `Trip #${item.id}`}</Text>
            <View style={[styles.statusPill, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
              <Text style={[styles.statusPillText, { color: statusColor }]}>
                {String(item.trip_status || 'draft').replace('_', ' ').toUpperCase()}
              </Text>
            </View>
          </View>
          {(item.source_id || item.destination_id) ? (
            <Text style={styles.rowSub} numberOfLines={1}>
              {Array.isArray(item.source_id) ? item.source_id[1] : '—'}
              {'  →  '}
              {Array.isArray(item.destination_id) ? item.destination_id[1] : '—'}
            </Text>
          ) : null}
          <Text style={styles.rowMeta} numberOfLines={1}>
            {item.date || ''} · {fmtTime(item.start_time)}{item.end_time ? ` → ${fmtTime(item.end_time)}` : ''}
            {item.km_travelled != null ? ` · ${item.km_travelled} km` : ''}
          </Text>
        </View>
        {isSelected ? (
          <MaterialIcons name="check-circle" size={22} color={FIELD_COLOR} />
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={22} color="#333" />
            </TouchableOpacity>
          </View>
          <View style={styles.searchBox}>
            <MaterialIcons name="search" size={18} color="#999" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by ref, source, destination, vehicle..."
              placeholderTextColor="#999"
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {!!search && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <MaterialIcons name="close" size={16} color="#999" />
              </TouchableOpacity>
            )}
          </View>
          {onCreateNew ? (
            <View style={{ paddingHorizontal: 12 }}>
              <TouchableOpacity
                style={styles.createRow}
                activeOpacity={0.85}
                onPress={() => onCreateNew()}
              >
                <View style={styles.createIcon}>
                  <MaterialIcons name="add" size={18} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createTitle}>Create New Trip</Text>
                  <Text style={styles.createSub}>Open Vehicle Tracking form to log a new trip</Text>
                </View>
                <MaterialIcons name="open-in-new" size={18} color={FIELD_COLOR} />
              </TouchableOpacity>
            </View>
          ) : null}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={FIELD_COLOR} />
              <Text style={styles.loadingText}>Loading available trips…</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialIcons name="inbox" size={36} color="#BDBDBD" />
              <Text style={styles.emptyTitle}>No trips available</Text>
              <Text style={styles.emptySub}>
                {search ? 'Try a different search term.' : (onCreateNew ? 'Tap "Create New Trip" above to log one.' : 'Create a trip in Vehicle Tracking first.')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    width: '100%', maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 16,
    maxHeight: '88%',
    paddingTop: 12,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 8 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
    }),
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 8,
  },
  title: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F5F5', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    marginHorizontal: 16, marginBottom: 8,
  },
  searchInput: {
    flex: 1, fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium,
    color: '#222', padding: 0,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#E0E0E0', marginVertical: 4,
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
    }),
  },
  rowSelected: { borderColor: FIELD_COLOR, backgroundColor: '#E3F2FD' },
  createRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F5F9FF', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: FIELD_COLOR, borderStyle: 'dashed',
    marginVertical: 4, marginBottom: 8,
  },
  createIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: FIELD_COLOR,
    alignItems: 'center', justifyContent: 'center',
  },
  createTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR },
  createSub: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  rowIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  rowSub: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  rowMeta: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#999', marginTop: 2 },
  statusPill: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1,
  },
  statusPillText: { fontSize: 9, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  loadingBox: { paddingVertical: 30, alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  emptyBox: { paddingVertical: 30, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 8 },
  emptySub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 2, textAlign: 'center', paddingHorizontal: 24 },
});

export default TripPickerSheet;
