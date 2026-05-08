import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

const FIELD_COLOR = '#1976D2';

const fmtTime = (s) => (s ? String(s).slice(11, 16) : '—');

const STATE_COLOR = {
  draft: '#FB8C00',
  done: '#43A047',
  cancelled: '#E53935',
};

const VisitsListSheet = ({
  visible,
  visits,
  loading,
  title = 'Linked Visits',
  onClose,
  onOpenInVisits,
}) => {
  const renderItem = ({ item }) => {
    const stateColor = STATE_COLOR[item.state] || '#666';
    return (
      <View style={styles.row}>
        <View style={styles.iconBox}>
          <MaterialIcons name="person" size={16} color={FIELD_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {Array.isArray(item.partner_id) ? item.partner_id[1] : (item.name || `Visit #${item.id}`)}
            </Text>
            <View style={[styles.statePill, { backgroundColor: stateColor + '22', borderColor: stateColor }]}>
              <Text style={[styles.statePillText, { color: stateColor }]}>
                {String(item.state || '').toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {fmtTime(item.date_time)} · {item.location_name || '—'}
          </Text>
          {Array.isArray(item.purpose_id) && item.purpose_id[1] ? (
            <Text style={styles.rowMeta} numberOfLines={1}>Purpose: {item.purpose_id[1]}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title} ({visits?.length || 0})</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={22} color="#333" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={FIELD_COLOR} />
              <Text style={styles.loadingText}>Loading visits…</Text>
            </View>
          ) : !visits || visits.length === 0 ? (
            <View style={styles.emptyBox}>
              <MaterialIcons name="people-outline" size={36} color="#BDBDBD" />
              <Text style={styles.emptyTitle}>No visits</Text>
              <Text style={styles.emptySub}>Nothing is linked to this trip yet.</Text>
            </View>
          ) : (
            <FlatList
              data={visits}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderItem}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
            />
          )}

          {onOpenInVisits ? (
            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.openBtn}
                activeOpacity={0.85}
                onPress={onOpenInVisits}
              >
                <MaterialIcons name="open-in-new" size={16} color="#fff" />
                <Text style={styles.openBtnText}>Open Customer Visits</Text>
              </TouchableOpacity>
            </View>
          ) : null}
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
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  title: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  loadingBox: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12, color: '#666', fontFamily: FONT_FAMILY.urbanistMedium },
  emptyBox: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginTop: 8 },
  emptySub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 2, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 10, padding: 10, marginVertical: 4,
    borderWidth: 1, borderColor: '#E0E0E0',
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
    }),
  },
  iconBox: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222', flexShrink: 1 },
  rowSub: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  rowMeta: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 1 },
  statePill: { paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 5, borderWidth: 1 },
  statePillText: { fontSize: 9, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  footer: {
    padding: 12, borderTopWidth: 1, borderTopColor: '#EEE',
  },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 10, paddingVertical: 12,
  },
  openBtnText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default VisitsListSheet;
