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

const TripLineCard = ({
  line,
  index,
  onOpenTrip,
  onViewVisits,
  onDelete,
  busy,
  attendanceCheckedOut,
}) => {
  const ended = !!line?.trip_ended;
  const canDelete = !ended && !attendanceCheckedOut;
  const visitCount = Array.isArray(line?.visit_ids) ? line.visit_ids.length : 0;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.indexBox}>
          <Text style={styles.indexText}>#{index + 2}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{tripRefOf(line?.trip_id)}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {line?.source_location || '—'}
            {'  →  '}
            {line?.destination_location || '—'}
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
          <Text style={styles.metaLabel}>KM</Text>
          <Text style={styles.metaValue}>{line?.km_travelled ?? 0}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Duration</Text>
          <Text style={styles.metaValue}>{floatToHM(line?.duration || 0)}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Fuel L</Text>
          <Text style={styles.metaValue}>{Number(line?.total_fuel_litres || 0).toFixed(2)}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Fuel Amt</Text>
          <Text style={styles.metaValue}>{Number(line?.total_fuel_amount || 0).toFixed(2)}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Visits</Text>
          <Text style={styles.metaValue}>{visitCount}</Text>
        </View>
      </View>

      {!!(line?.gps_latitude || line?.gps_longitude) && (
        <View style={styles.gpsBlock}>
          <MaterialIcons name="place" size={13} color={FIELD_COLOR} />
          <Text style={styles.gpsCoords} numberOfLines={1}>
            {line.gps_latitude || '0'}{', '}{line.gps_longitude || '0'}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btnSecondary, busy && { opacity: 0.6 }]}
          disabled={busy}
          activeOpacity={0.85}
          onPress={onOpenTrip}
        >
          <MaterialIcons name="open-in-new" size={13} color={FIELD_COLOR} />
          <Text style={styles.btnSecondaryText}>Open Trip</Text>
        </TouchableOpacity>
        {visitCount > 0 ? (
          <TouchableOpacity
            style={[styles.btnSecondary, busy && { opacity: 0.6 }]}
            disabled={busy}
            activeOpacity={0.85}
            onPress={onViewVisits}
          >
            <MaterialIcons name="people" size={13} color={FIELD_COLOR} />
            <Text style={styles.btnSecondaryText}>Visits ({visitCount})</Text>
          </TouchableOpacity>
        ) : null}
        {canDelete && (
          <TouchableOpacity
            style={[styles.btnDanger, busy && { opacity: 0.6 }]}
            disabled={busy}
            activeOpacity={0.85}
            onPress={onDelete}
          >
            <MaterialIcons name="delete-outline" size={13} color="#E53935" />
            <Text style={styles.btnDangerText}>Delete</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 8,
    borderLeftWidth: 3, borderLeftColor: '#90CAF9',
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
    }),
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  indexBox: {
    minWidth: 32, height: 32, borderRadius: 8, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  indexText: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR },
  title: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  subtitle: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  endedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E8F5E9', borderColor: '#43A047', borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  endedPillText: { fontSize: 9, color: '#43A047', fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 4 },
  metaCell: {
    flexBasis: '30%', flexGrow: 1,
    backgroundColor: '#F8F9FA', borderRadius: 6, padding: 6, alignItems: 'center',
  },
  metaLabel: { fontSize: 9.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888' },
  metaValue: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#222', marginTop: 1 },
  gpsBlock: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F5F9FF', borderRadius: 6, padding: 7, marginTop: 6,
  },
  gpsCoords: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', borderColor: FIELD_COLOR, borderWidth: 1, borderRadius: 8,
    paddingVertical: 6, paddingHorizontal: 9,
  },
  btnSecondaryText: { color: FIELD_COLOR, fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold },
  btnDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff', borderColor: '#E53935', borderWidth: 1, borderRadius: 8,
    paddingVertical: 6, paddingHorizontal: 9,
  },
  btnDangerText: { color: '#E53935', fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold },
});

export default TripLineCard;
