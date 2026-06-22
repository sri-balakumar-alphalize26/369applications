import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import { formatTimeOffice } from '@utils/officeTime';

const FIELD_COLOR = '#1976D2';
const NEW_GREEN = '#2E7D32';
const NEW_GREEN_BG = '#E8F5E9';
const LIST_MAX_HEIGHT = Math.floor(Dimensions.get('window').height * 0.75);

// Office timezone (from config), not raw UTC.
const fmtTime = (s) => (s ? (formatTimeOffice(s, { hour12: false }) || '') : '');

const VisitPickerSheet = ({
  visible,
  visits,
  loading,
  selectedId,
  newVisitId,
  onSelect,
  onClose,
  onCreateNew,
  title = 'Add Visit',
  emptySubtitle = 'Log a customer visit first to attach it here.',
}) => {
  const [search, setSearch] = useState('');
  const flatListRef = useRef(null);

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = visits || [];
    const filtered = !q ? all : all.filter((v) => {
      const name = String(v.name || '').toLowerCase();
      const partner = Array.isArray(v.partner_id) ? String(v.partner_id[1] || '').toLowerCase() : '';
      const loc = String(v.location_name || '').toLowerCase();
      return name.includes(q) || partner.includes(q) || loc.includes(q);
    });
    console.log('[VisitPickerSheet]',
      'visits=', all.length,
      'rows=', filtered.length,
      'search=', q ? `"${q}"` : '(none)',
      'LIST_MAX_HEIGHT=', LIST_MAX_HEIGHT,
    );
    return filtered;
  }, [visits, search]);

  // Scroll the freshly-created visit into view once the rows are populated.
  useEffect(() => {
    if (!visible || newVisitId == null || !rows.length) return;
    const idx = rows.findIndex((v) => Number(v.id) === Number(newVisitId));
    if (idx < 0) return;
    const t = setTimeout(() => {
      try {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      } catch (e) { /* best-effort */ }
    }, 250);
    return () => clearTimeout(t);
  }, [visible, newVisitId, rows]);

  const renderItem = ({ item }) => {
    const isSelected = Number(item.id) === Number(selectedId);
    const isNew = newVisitId != null && Number(item.id) === Number(newVisitId);
    const partnerLabel = Array.isArray(item.partner_id) ? item.partner_id[1] : (item.name || `Visit #${item.id}`);
    return (
      <TouchableOpacity
        style={[styles.row, isSelected && styles.rowSelected, isNew && styles.rowNew]}
        activeOpacity={0.75}
        onPress={() => { onSelect && onSelect(item); }}
      >
        <View style={[styles.rowIcon, isNew && styles.rowIconNew]}>
          <MaterialIcons name="person" size={18} color={isNew ? NEW_GREEN : FIELD_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {partnerLabel}
            </Text>
            {isNew ? (
              <View style={styles.newBadge}>
                <MaterialIcons name="fiber-new" size={11} color="#fff" />
                <Text style={styles.newBadgeText}>NEW</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {item.name ? `${item.name} · ` : ''}
            {fmtTime(item.date_time) || '—'}
          </Text>
          {item.location_name ? (
            <Text style={styles.rowMeta} numberOfLines={1}>
              {item.location_name}
            </Text>
          ) : null}
        </View>
        {isNew ? (
          <MaterialIcons name="auto-awesome" size={22} color={NEW_GREEN} />
        ) : isSelected ? (
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
              placeholder="Search by ref, customer, location..."
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
                  <Text style={styles.createTitle}>Create New Visit</Text>
                  <Text style={styles.createSub}>Open Customer Visit form to log a new visit</Text>
                </View>
                <MaterialIcons name="open-in-new" size={18} color={FIELD_COLOR} />
              </TouchableOpacity>
            </View>
          ) : null}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={FIELD_COLOR} />
              <Text style={styles.loadingText}>Loading visits…</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialIcons name="inbox" size={36} color="#BDBDBD" />
              <Text style={styles.emptyTitle}>No draft visits</Text>
              <Text style={styles.emptySub}>
                {search ? 'Try a different search term.' : (onCreateNew ? 'Tap "Create New Visit" above to log one.' : emptySubtitle)}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              style={{ maxHeight: LIST_MAX_HEIGHT }}
              data={rows}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              onScrollToIndexFailed={() => {}}
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
    maxHeight: '95%',
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
  rowNew: { borderColor: NEW_GREEN, borderWidth: 1.5, backgroundColor: NEW_GREEN_BG },
  rowIconNew: { backgroundColor: '#C8E6C9' },
  newBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: NEW_GREEN, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  },
  newBadgeText: { fontSize: 9, fontFamily: FONT_FAMILY.urbanistBold, color: '#fff', letterSpacing: 0.5 },
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
  loadingBox: { paddingVertical: 30, alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  emptyBox: { paddingVertical: 30, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 8 },
  emptySub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 2, textAlign: 'center', paddingHorizontal: 24 },
});

export default VisitPickerSheet;
