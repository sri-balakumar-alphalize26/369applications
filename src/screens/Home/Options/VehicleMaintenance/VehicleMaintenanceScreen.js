import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { RoundedScrollContainer } from '@components/containers';
import OfflineBanner from '@components/common/OfflineBanner';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { OverlayLoader } from '@components/Loader';
import { FABButton } from '@components/common/Button';
import { fetchVehicleMaintenanceOdoo } from '@api/services/generalApi';
import CalendarScreen from '@components/Calendar/CalendarScreen';

// Status filter tabs — All / Pending (is_validated=false) / Validated (true).
const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'validated', label: 'Validated' },
];
const STATUS_COLORS = { all: '#6C7A89', pending: '#FF9800', validated: '#4CAF50' };

const VehicleMaintenanceScreen = ({ navigation }) => {
  const [selectedDate, setSelectedDate] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeStatus, setActiveStatus] = useState('all');

  const fetchEntries = async (dateString) => {
    setLoading(true);
    try {
      const data = await fetchVehicleMaintenanceOdoo({ date: dateString });
      setEntries(data || []);
    } catch (error) {
      console.error('Failed to fetch maintenance entries:', error);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDateSelect = (day) => {
    setSelectedDate(day.dateString);
    fetchEntries(day.dateString);
  };

  const handleAddEntry = () => {
    navigation.navigate('VehicleMaintenanceForm');
  };

  const handleEntryPress = (entry) => {
    navigation.navigate('VehicleMaintenanceForm', { maintenanceData: entry });
  };

  return (
    <SafeAreaView style={styles.container}>
      <NavigationHeader
        title="Vehicle Maintenance"
        navigation={navigation}
      />
      <OfflineBanner
        message="OFFLINE — showing cached records, new entries will sync when online"
        onOnline={() => { if (selectedDate) fetchEntries(selectedDate); }}
      />
      {/* Status filter tabs */}
      <View style={styles.statusTabsBar}>
        {STATUS_TABS.map((t) => {
          const color = STATUS_COLORS[t.key];
          const isActive = activeStatus === t.key;
          const count = (entries || []).filter((e) =>
            t.key === 'all' ? true
            : t.key === 'validated' ? !!e.is_validated
            : !e.is_validated
          ).length;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.statusTab, isActive && { borderBottomColor: color }]}
              onPress={() => setActiveStatus(t.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.statusTabText,
                  { color: isActive ? color : `${color}B3` },
                  isActive && { fontFamily: FONT_FAMILY.urbanistBold },
                ]}
              >
                {t.label} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <RoundedScrollContainer style={styles.content}>
        {/* Calendar */}
        <View style={styles.calendarContainer}>
          <CalendarScreen
            onDayPress={handleDateSelect}
            style={styles.calendar}
          />
        </View>

        {/* Entries */}
        <View style={styles.contentContainer}>
          {loading ? (
            <OverlayLoader visible={true} />
          ) : entries.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <Text style={styles.emptyStateText}>
                {selectedDate ? 'No Maintenance Records Found' : 'Select a date to view records'}
              </Text>
            </View>
          ) : (
            <View>
              {(() => {
                const filteredEntries = (entries || []).filter((e) =>
                  activeStatus === 'all' ? true
                  : activeStatus === 'validated' ? !!e.is_validated
                  : !e.is_validated
                );
                return (
                  <>
                    <Text style={styles.listHeader}>
                      Maintenance Records ({filteredEntries.length})
                    </Text>
                    {filteredEntries.map((entry) => (
                <TouchableOpacity
                  key={entry.id}
                  style={styles.card}
                  onPress={() => handleEntryPress(entry)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text style={styles.cardRef}>{entry.ref || entry.offline_label || `#${entry.id}`}</Text>
                        {entry.offline ? (
                          <View style={[styles.statePill, { backgroundColor: '#9E9E9E' }]}>
                            <Text style={styles.statePillText}>OFFLINE</Text>
                          </View>
                        ) : null}
                        <View style={[styles.statePill, { backgroundColor: entry.is_validated ? '#4CAF50' : '#FF9800' }]}>
                          <Text style={styles.statePillText}>{entry.is_validated ? 'VALIDATED' : 'PENDING'}</Text>
                        </View>
                      </View>
                      <Text style={styles.cardDriver}>{entry.driver_name || '-'}</Text>
                      <Text style={styles.cardDetail}>{entry.vehicle_name || '-'}</Text>
                      {entry.number_plate ? (
                        <Text style={styles.cardDetail}>Plate: {entry.number_plate}</Text>
                      ) : null}
                    </View>
                    <View style={styles.cardRight}>
                      <Text style={styles.cardType}>{entry.maintenance_type_name || '-'}</Text>
                      {entry.amount ? (
                        <Text style={styles.cardAmount}>{Number(entry.amount).toFixed(3)}</Text>
                      ) : null}
                      {entry.current_km ? (
                        <Text style={styles.cardKm}>{Number(entry.current_km).toLocaleString()} km</Text>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
                    ))}
                  </>
                );
              })()}
            </View>
          )}
        </View>
      </RoundedScrollContainer>

      <FABButton onPress={handleAddEntry} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  statusTabsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  statusTab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  statusTabText: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
  statePill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 6,
  },
  statePillText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  calendarContainer: { marginBottom: 20 },
  calendar: { borderRadius: 10 },
  contentContainer: { flex: 1, minHeight: 300 },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 100,
  },
  emptyStateText: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.gray,
    textAlign: 'center',
  },
  listHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  card: {
    backgroundColor: COLORS.lightGray || '#F5F5F5',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardRef: {
    fontSize: 13,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginBottom: 2,
  },
  cardDriver: {
    fontSize: 15,
    fontWeight: 'bold',
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginBottom: 2,
  },
  cardDetail: {
    fontSize: 13,
    color: COLORS.gray || '#666',
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  cardRight: {
    alignItems: 'flex-end',
    minWidth: 100,
  },
  cardType: {
    fontSize: 13,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    marginBottom: 4,
  },
  cardAmount: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  cardKm: {
    fontSize: 12,
    color: COLORS.gray || '#666',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginTop: 2,
  },
});

export default VehicleMaintenanceScreen;
