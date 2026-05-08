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

const STATUS_COLOR = {
  draft: '#9E9E9E',
  in_progress: '#1976D2',
  ended: '#43A047',
  cancelled: '#E53935',
};

const fmtTime = (s) => (s ? String(s).slice(11, 16) : '—');
const fmtDateTime = (s) => {
  if (!s) return '—';
  const d = String(s).slice(0, 16).replace('T', ' ');
  return d;
};

const m2oLabel = (v) => (Array.isArray(v) ? (v[1] || '—') : (v || '—'));

const Row = ({ icon, label, value }) => (
  <View style={styles.row}>
    <MaterialIcons name={icon} size={14} color={FIELD_COLOR} />
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={styles.rowValue} numberOfLines={2}>{value || '—'}</Text>
  </View>
);

const TripDetailSheet = ({ visible, trip, loading, onClose, onOpenInVehicleTracking }) => {
  const status = trip?.trip_status || 'draft';
  const statusColor = STATUS_COLOR[status] || '#666';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Trip Details</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={22} color="#333" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={FIELD_COLOR} />
              <Text style={styles.loadingText}>Loading trip…</Text>
            </View>
          ) : !trip ? (
            <View style={styles.loadingBox}>
              <MaterialIcons name="error-outline" size={28} color="#888" />
              <Text style={styles.loadingText}>Trip not found.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={styles.titleRow}>
                <View style={styles.iconBox}>
                  <MaterialIcons name="directions-car" size={20} color={FIELD_COLOR} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripRef}>{trip.ref || `Trip #${trip.id}`}</Text>
                  <Text style={styles.tripDate}>{trip.date || ''}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
                  <Text style={[styles.statusPillText, { color: statusColor }]}>
                    {String(status).replace('_', ' ').toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.sectionGroup}>
                <Row icon="local-shipping" label="Vehicle" value={m2oLabel(trip.vehicle_id)} />
                <Row icon="person" label="Driver" value={m2oLabel(trip.driver_id)} />
                <Row icon="place" label="Source" value={m2oLabel(trip.source_id)} />
                <Row icon="flag" label="Destination" value={m2oLabel(trip.destination_id)} />
                <Row icon="event" label="Purpose" value={m2oLabel(trip.purpose_of_visit_id)} />
              </View>

              <View style={styles.sectionGroup}>
                <Row icon="schedule" label="Start" value={fmtDateTime(trip.start_time)} />
                <Row icon="schedule" label="End" value={fmtDateTime(trip.end_time)} />
                <Row
                  icon="my-location"
                  label="Start GPS"
                  value={trip.start_latitude || trip.start_longitude
                    ? `${trip.start_latitude || '0'}, ${trip.start_longitude || '0'}`
                    : '—'}
                />
                <Row
                  icon="location-searching"
                  label="End GPS"
                  value={trip.end_latitude || trip.end_longitude
                    ? `${trip.end_latitude || '0'}, ${trip.end_longitude || '0'}`
                    : '—'}
                />
              </View>

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>KM</Text>
                  <Text style={styles.statValue}>{trip.km_travelled ?? 0}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Hours</Text>
                  <Text style={styles.statValue}>{Number(trip.duration || 0).toFixed(2)}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Fuel L</Text>
                  <Text style={styles.statValue}>{Number(trip.total_fuel_litres || 0).toFixed(2)}</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Fuel Amt</Text>
                  <Text style={styles.statValue}>{Number(trip.total_fuel_amount || 0).toFixed(2)}</Text>
                </View>
              </View>

              {onOpenInVehicleTracking ? (
                <TouchableOpacity
                  style={styles.openBtn}
                  activeOpacity={0.85}
                  onPress={() => onOpenInVehicleTracking(trip)}
                >
                  <MaterialIcons name="open-in-new" size={16} color="#fff" />
                  <Text style={styles.openBtnText}>Open in Vehicle Tracking</Text>
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
  tripRef: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  tripDate: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statusPillText: { fontSize: 9.5, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  sectionGroup: {
    backgroundColor: '#FAFAFA', borderRadius: 10, padding: 8, marginTop: 12,
    borderWidth: 1, borderColor: '#EEE',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  rowLabel: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', width: 90 },
  rowValue: { flex: 1, fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  statBox: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: '#fff', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#EEE', alignItems: 'center',
  },
  statLabel: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888' },
  statValue: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222', marginTop: 2 },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 10,
    paddingVertical: 12, marginTop: 14,
  },
  openBtnText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default TripDetailSheet;
