import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

const FIELD_COLOR = '#1976D2';

const floatToHM = (h) => {
  const hours = Math.floor(h || 0);
  const mins = Math.round(((h || 0) - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const Cell = ({ icon, label, value, color = FIELD_COLOR }) => (
  <View style={styles.cell}>
    <View style={[styles.iconBox, { backgroundColor: color + '22' }]}>
      <MaterialIcons name={icon} size={16} color={color} />
    </View>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
);

const TripTotalsSection = ({ attendance }) => {
  const km = attendance?.trip_total_km ?? 0;
  const dur = attendance?.trip_total_duration ?? 0;
  const litres = attendance?.trip_total_fuel_litres ?? 0;
  const amount = attendance?.trip_total_fuel_amount ?? 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <MaterialIcons name="summarize" size={16} color={FIELD_COLOR} />
        <Text style={styles.titleText}>Trip Totals</Text>
        <Text style={styles.titleHint}>Sums primary trip + all additional trips</Text>
      </View>
      <View style={styles.grid}>
        <Cell icon="speed" label="Total KM" value={`${km}`} />
        <Cell icon="schedule" label="Total Duration" value={floatToHM(dur)} />
        <Cell icon="local-gas-station" label="Fuel (L)" value={Number(litres).toFixed(2)} color="#FB8C00" />
        <Cell icon="payments" label="Fuel Amount" value={Number(amount).toFixed(2)} color="#43A047" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  titleText: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  titleHint: { fontSize: 10, fontFamily: FONT_FAMILY.urbanistMedium, color: '#999', marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: '#fff', borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: '#EEE',
  },
  iconBox: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888', marginTop: 6 },
  value: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222', marginTop: 2 },
});

export default TripTotalsSection;
