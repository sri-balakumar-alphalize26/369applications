import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

const FIELD_COLOR = '#1976D2';

const STATE_COLOR = {
  draft: '#FB8C00',
  done: '#43A047',
  cancelled: '#E53935',
};

const fmtDateTime = (s) => {
  if (!s) return '—';
  return String(s).slice(0, 16).replace('T', ' ');
};

const m2oLabel = (v) => (Array.isArray(v) ? (v[1] || '—') : (v || '—'));

const Row = ({ icon, label, value }) => (
  <View style={styles.row}>
    <MaterialIcons name={icon} size={14} color={FIELD_COLOR} />
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={2}>{value || '—'}</Text>
  </View>
);

// Mirrors TripDetailSheet: a centered popup that shows the visit overview
// with an "Open in Customer Visit" button that bubbles up to the parent
// for the full-screen navigation.
const VisitDetailSheet = ({ visible, visit, loading, onClose, onOpenInVisits }) => {
  const state = visit?.state || 'draft';
  const stateColor = STATE_COLOR[state] || '#666';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Visit Details</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={22} color="#333" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={FIELD_COLOR} />
              <Text style={styles.loadingText}>Loading visit…</Text>
            </View>
          ) : !visit ? (
            <View style={styles.loadingBox}>
              <MaterialIcons name="error-outline" size={28} color="#888" />
              <Text style={styles.loadingText}>Visit not found.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={styles.titleRow}>
                <View style={styles.iconBox}>
                  <MaterialIcons name="person" size={20} color={FIELD_COLOR} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.partnerName} numberOfLines={1}>{m2oLabel(visit.partner_id)}</Text>
                  <Text style={styles.visitName} numberOfLines={1}>{visit.name || `Visit #${visit.id}`}</Text>
                </View>
                <View style={[styles.statePill, { backgroundColor: stateColor + '22', borderColor: stateColor }]}>
                  <Text style={[styles.statePillText, { color: stateColor }]}>
                    {String(state).toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.sectionGroup}>
                <Row icon="event" label="Purpose" value={m2oLabel(visit.purpose_id)} />
                <Row icon="schedule" label="Date / Time" value={fmtDateTime(visit.date_time)} />
                <Row icon="place" label="Location" value={visit.location_name} />
                <Row icon="timer" label="Duration" value={visit.visit_duration || ''} />
                <Row icon="my-location" label="GPS" value={(visit.latitude || visit.longitude) ? `${visit.latitude || '0'}, ${visit.longitude || '0'}` : ''} />
                {visit.remarks ? <Row icon="comment" label="Remarks" value={visit.remarks} /> : null}
              </View>

              {onOpenInVisits ? (
                <TouchableOpacity
                  style={styles.openBtn}
                  activeOpacity={0.85}
                  onPress={() => onOpenInVisits(visit)}
                >
                  <MaterialIcons name="open-in-new" size={16} color="#fff" />
                  <Text style={styles.openBtnText}>Open in Customer Visit</Text>
                </TouchableOpacity>
              ) : null}
            </ScrollView>
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
    maxHeight: '90%',
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  partnerName: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  visitName: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 2 },
  statePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statePillText: { fontSize: 9.5, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  sectionGroup: {
    backgroundColor: '#FAFAFA', borderRadius: 10, padding: 8, marginTop: 12,
    borderWidth: 1, borderColor: '#EEE',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  rowLabel: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', width: 90 },
  rowValue: { flex: 1, fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 10,
    paddingVertical: 12, marginTop: 14,
  },
  openBtnText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default VisitDetailSheet;
