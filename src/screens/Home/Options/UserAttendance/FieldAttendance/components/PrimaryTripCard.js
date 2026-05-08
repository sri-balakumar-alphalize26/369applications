import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

const FIELD_COLOR = '#1976D2';

const floatToHM = (h) => {
  const hours = Math.floor(h || 0);
  const mins = Math.round(((h || 0) - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const tripRefOf = (t) => {
  if (!t) return '';
  if (Array.isArray(t)) return t[1] || `Trip #${t[0]}`;
  return t.ref || `Trip #${t.id || ''}`;
};

const PrimaryTripCard = ({
  attendance,
  onSetup,
  onEdit,
  onOpenTrip,
  onViewVisits,
  busy,
}) => {
  const trip = attendance?.source_trip_id;
  const hasTrip = Array.isArray(trip) && trip[0];
  const ended = !!attendance?.source_trip_ended;
  const visitCount = attendance?.source_visit_count || 0;

  if (!hasTrip) {
    return (
      <View style={styles.emptyCard}>
        <MaterialIcons name="directions-car" size={32} color={FIELD_COLOR} />
        <Text style={styles.emptyTitle}>No primary trip yet</Text>
        <Text style={styles.emptySub}>Pick a trip and link visits to start.</Text>
        <TouchableOpacity
          style={[styles.btnPrimary, busy && { opacity: 0.6 }]}
          activeOpacity={0.85}
          disabled={busy}
          onPress={onSetup}
        >
          <MaterialIcons name="add" size={16} color="#fff" />
          <Text style={styles.btnPrimaryText}>Setup Primary Trip</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconBox}>
          <MaterialIcons name="directions-car" size={20} color={FIELD_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{tripRefOf(trip)}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {attendance?.source_trip_source_location || '—'}
            {'  →  '}
            {attendance?.source_trip_destination_location || '—'}
          </Text>
        </View>
        {ended ? (
          <View style={styles.endedPill}>
            <MaterialIcons name="lock" size={11} color="#43A047" />
            <Text style={styles.endedPillText}>Ended</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Total KM</Text>
          <Text style={styles.metaValue}>{attendance?.trip_total_km ?? 0}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Duration</Text>
          <Text style={styles.metaValue}>{floatToHM(attendance?.trip_total_duration || 0)}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Visits</Text>
          <Text style={styles.metaValue}>{visitCount}</Text>
        </View>
      </View>

      <View style={styles.gpsBlock}>
        <MaterialIcons name="place" size={14} color={FIELD_COLOR} />
        <View style={{ flex: 1 }}>
          <Text style={styles.gpsName} numberOfLines={1}>
            {attendance?.gps_location_name || 'No location name'}
          </Text>
          <Text style={styles.gpsCoords} numberOfLines={1}>
            {Number(attendance?.gps_latitude || 0).toFixed(6)}
            {', '}
            {Number(attendance?.gps_longitude || 0).toFixed(6)}
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        {!ended ? (
          <TouchableOpacity
            style={[styles.btnSecondary, busy && { opacity: 0.6 }]}
            disabled={busy}
            activeOpacity={0.85}
            onPress={onEdit}
          >
            <MaterialIcons name="edit" size={14} color={FIELD_COLOR} />
            <Text style={styles.btnSecondaryText}>Edit</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.btnSecondary, busy && { opacity: 0.6 }]}
          disabled={busy}
          activeOpacity={0.85}
          onPress={onOpenTrip}
        >
          <MaterialIcons name="open-in-new" size={14} color={FIELD_COLOR} />
          <Text style={styles.btnSecondaryText}>Open Trip</Text>
        </TouchableOpacity>
        {visitCount > 0 ? (
          <TouchableOpacity
            style={[styles.btnSecondary, busy && { opacity: 0.6 }]}
            disabled={busy}
            activeOpacity={0.85}
            onPress={onViewVisits}
          >
            <MaterialIcons name="people" size={14} color={FIELD_COLOR} />
            <Text style={styles.btnSecondaryText}>View Visits</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 8,
    borderLeftWidth: 4, borderLeftColor: FIELD_COLOR,
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2 },
    }),
  },
  emptyCard: {
    backgroundColor: '#FAFAFA', borderRadius: 12, padding: 18, marginTop: 8,
    alignItems: 'center', borderWidth: 1, borderColor: '#EEE', borderStyle: 'dashed',
  },
  emptyTitle: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#333', marginTop: 8 },
  emptySub: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 4, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  subtitle: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  endedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E8F5E9', borderColor: '#43A047', borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  endedPillText: { fontSize: 9, color: '#43A047', fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  metaRow: {
    flexDirection: 'row', marginTop: 10, gap: 6,
  },
  metaCell: {
    flex: 1, backgroundColor: '#F8F9FA', borderRadius: 8, padding: 8, alignItems: 'center',
  },
  metaLabel: { fontSize: 10, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888' },
  metaValue: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222', marginTop: 2 },
  gpsBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F5F9FF', borderRadius: 8, padding: 10, marginTop: 8,
  },
  gpsName: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  gpsCoords: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 14, marginTop: 12,
  },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', borderColor: FIELD_COLOR, borderWidth: 1, borderRadius: 8,
    paddingVertical: 7, paddingHorizontal: 10,
  },
  btnSecondaryText: { color: FIELD_COLOR, fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistBold },
});

export default PrimaryTripCard;
