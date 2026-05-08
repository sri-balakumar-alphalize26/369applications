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

const VisitPickerSheet = ({
  visible,
  visits,
  loading,
  selectedIds = [],
  onConfirm,
  onClose,
  title = 'Pick Visits',
  emptySubtitle = 'Log a customer visit first to attach it here.',
}) => {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(new Set());

  useEffect(() => {
    if (visible) {
      setPicked(new Set((selectedIds || []).map(Number)));
      setSearch('');
    }
  }, [visible, selectedIds]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = visits || [];
    if (!q) return all;
    return all.filter((v) => {
      const name = String(v.name || '').toLowerCase();
      const partner = Array.isArray(v.partner_id) ? String(v.partner_id[1] || '').toLowerCase() : '';
      const loc = String(v.location_name || '').toLowerCase();
      return name.includes(q) || partner.includes(q) || loc.includes(q);
    });
  }, [visits, search]);

  const toggle = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirm = () => {
    onConfirm(Array.from(picked));
  };

  const renderItem = ({ item }) => {
    const id = Number(item.id);
    const isPicked = picked.has(id);
    return (
      <TouchableOpacity
        style={[styles.row, isPicked && styles.rowPicked]}
        activeOpacity={0.75}
        onPress={() => toggle(id)}
      >
        <View style={[styles.checkbox, isPicked && styles.checkboxOn]}>
          {isPicked ? <MaterialIcons name="check" size={14} color="#fff" /> : null}
        </View>
        <View style={styles.rowIcon}>
          <MaterialIcons name="person" size={16} color={FIELD_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {Array.isArray(item.partner_id) ? item.partner_id[1] : (item.name || `Visit #${item.id}`)}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {fmtTime(item.date_time) || '—'} · {item.location_name || '—'}
          </Text>
        </View>
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
              placeholder="Search by customer or location..."
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
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={FIELD_COLOR} />
              <Text style={styles.loadingText}>Loading visits…</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialIcons name="inbox" size={36} color="#BDBDBD" />
              <Text style={styles.emptyTitle}>No draft visits</Text>
              <Text style={styles.emptySub}>{emptySubtitle}</Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
            />
          )}
          <View style={styles.footer}>
            <Text style={styles.footerCount}>
              {picked.size} selected
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.btnSecondary} onPress={onClose}>
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnPrimary} onPress={confirm}>
                <Text style={styles.btnPrimaryText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  rowPicked: { borderColor: FIELD_COLOR, backgroundColor: '#E3F2FD' },
  rowIcon: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  rowSub: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#BDBDBD',
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: FIELD_COLOR, borderColor: FIELD_COLOR },
  loadingBox: { paddingVertical: 30, alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  emptyBox: { paddingVertical: 30, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 8 },
  emptySub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 2, textAlign: 'center', paddingHorizontal: 24 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#EEE',
  },
  footerCount: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#444' },
  btnPrimary: {
    backgroundColor: FIELD_COLOR, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 20,
  },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  btnSecondary: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#BDBDBD',
    paddingVertical: 10, paddingHorizontal: 16,
  },
  btnSecondaryText: { color: '#444', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default VisitPickerSheet;
