import React from 'react';
import { View, StyleSheet, Platform, TouchableOpacity } from 'react-native';
import Text from '@components/Text';
import { FONT_FAMILY } from '@constants/theme';
import { formatDate, formatDateTime } from '@utils/common/date';

// Odoo returns date_time as "YYYY-MM-DD HH:MM:SS" UTC with no Z marker.
// new Date("2026-05-02 16:41:34") interprets as LOCAL on most engines, which
// makes the display drift by the user's tz offset. Append T and Z so JS parses
// as UTC, then formatDate renders in local time — matches Odoo's display.
const parseOdooUtc = (s) => {
  if (!s || typeof s !== 'string') return null;
  const dt = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(dt.getTime()) ? null : dt;
};

// Per-row status colors — match the Easy Sales / VisitDetails palette.
const STATE_COLORS = { draft: '#FF9800', done: '#4CAF50' };

const VisitList = ({ item, onPress }) => {
  const dt = parseOdooUtc(item?.date_time);
  const stateKey = (item?.state || 'draft').toLowerCase();
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={styles.itemContainer}>
      <View style={styles.leftColumn}>
        <View style={styles.headerRow}>
          <Text style={styles.head} numberOfLines={1}>
            {item?.customer?.name?.trim() || '-'}
          </Text>
          <View style={[
            styles.stateBadge,
            { backgroundColor: STATE_COLORS[stateKey] || '#999' },
          ]}>
            <Text style={styles.stateBadgeText}>{stateKey.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.rightColumn}>
          <Text style={styles.content}>{item?.employee?.name || '-'}</Text>
          <Text style={[styles.contentRight]}>
            {dt ? formatDate(dt, 'dd MMM yyyy HH:mm:ss') : '-'}
          </Text>
        </View>
      </View>
      <View style={styles.rightColumn}>
        <Text style={styles.content}>{item?.location_name || item?.purpose?.name || '-'}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  itemContainer: {
    marginHorizontal: 5,
    marginVertical: 5,
    backgroundColor: 'white',
    borderRadius: 15,
    ...Platform.select({
      android: {
        elevation: 4,
      },
      ios: {
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
      },
    }),
    padding: 20,
  },
  leftColumn: {
    flex: 1,
  },
  rightColumn: {
    justifyContent: 'space-between', 
    flexDirection: 'row', 
    flex: 1 
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  head: {
    flex: 1,
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 17,
    marginRight: 8,
  },
  stateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  stateBadgeText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  content: {
    color: '#666666',
    marginBottom: 5,
    fontSize:14,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    textTransform:'capitalize'
  },
 
  contentRight: {
    color: '#666666',
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    fontSize:14,
  },
});

export default VisitList;
