import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import { formatTimeOffice, formatDateOffice } from '@utils/officeTime';

const FIELD_COLOR = '#1976D2';

// Times/dates shown in the OFFICE timezone (from the Odoo config), not the
// phone's clock or raw UTC.
const fmtTime = (s) => (s ? (formatTimeOffice(s, { hour12: false }) || '--:--') : '--:--');

const fmtDate = (s) => {
  if (!s) return '';
  return formatDateOffice(s) || String(s).slice(0, 10);
};

const tripRefOf = (t) => {
  if (!t) return '';
  if (Array.isArray(t)) return t[1] || `#${t[0]}`;
  return t.ref || `#${t.id || ''}`;
};

const HistoryListItem = ({ row, onPress, title, accentColor = FIELD_COLOR, showChevron = true }) => {
  const isLate = !!row?.is_late;
  const isWaived = !!row?.is_waived;
  const deduction = Number(row?.deduction_amount || 0);
  const rowTitle = title || tripRefOf(row?.source_trip_id) || 'Field Attendance';

  return (
    <TouchableOpacity style={[styles.card, { borderLeftColor: accentColor }]} activeOpacity={0.85} onPress={onPress}>
      <View style={styles.dateBox}>
        <Text style={[styles.dateDay, { color: accentColor }]}>
          {fmtDate(row?.check_in).split(' ')[0] || '--'}
        </Text>
        <Text style={[styles.dateMonth, { color: accentColor }]}>
          {fmtDate(row?.check_in).split(' ')[1] || ''}
        </Text>
      </View>

      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.title} numberOfLines={1}>
            {rowTitle}
          </Text>
          {isLate ? (
            <View style={[styles.pill, { backgroundColor: '#FFF3E0', borderColor: '#FB8C00' }]}>
              <Text style={[styles.pillText, { color: '#FB8C00' }]}>LATE</Text>
            </View>
          ) : null}
          {isWaived ? (
            <View style={[styles.pill, { backgroundColor: '#F3E5F5', borderColor: '#9C27B0' }]}>
              <Text style={[styles.pillText, { color: '#9C27B0' }]}>WAIVED</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.times} numberOfLines={1}>
          {fmtTime(row?.check_in)} → {fmtTime(row?.check_out)}
          {row?.late_minutes_display ? ` · Late ${row.late_minutes_display}` : ''}
        </Text>
        {row?.gps_location_name ? (
          <View style={styles.locRow}>
            <MaterialIcons name="place" size={11} color="#888" />
            <Text style={styles.locText} numberOfLines={1}>{row.gps_location_name}</Text>
          </View>
        ) : null}
        {deduction > 0 ? (
          <Text style={styles.deduction}>Deduction: {deduction.toFixed(2)}</Text>
        ) : null}
      </View>

      {showChevron ? <MaterialIcons name="chevron-right" size={22} color="#BDBDBD" /> : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 10, marginVertical: 4,
    borderLeftWidth: 3, borderLeftColor: FIELD_COLOR,
    ...Platform.select({
      android: { elevation: 1 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
    }),
  },
  dateBox: {
    width: 48, height: 48, borderRadius: 10, backgroundColor: '#E3F2FD',
    alignItems: 'center', justifyContent: 'center',
  },
  dateDay: { fontSize: 18, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR, lineHeight: 20 },
  dateMonth: { fontSize: 9.5, fontFamily: FONT_FAMILY.urbanistBold, color: FIELD_COLOR, letterSpacing: 0.5 },
  title: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222', flexShrink: 1 },
  times: { fontSize: 11, fontFamily: FONT_FAMILY.urbanistMedium, color: '#666', marginTop: 2 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  locText: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#888' },
  deduction: { fontSize: 10.5, fontFamily: FONT_FAMILY.urbanistBold, color: '#E53935', marginTop: 2 },
  pill: {
    paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 5, borderWidth: 1,
  },
  pillText: { fontSize: 9, fontFamily: FONT_FAMILY.urbanistBold, letterSpacing: 0.4 },
});

export default HistoryListItem;
