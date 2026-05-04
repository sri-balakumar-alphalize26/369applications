import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { RoundedScrollContainer } from '@components/containers';
import OfflineBanner from '@components/common/OfflineBanner';
import { COLORS } from '@constants/theme';
import { OverlayLoader } from '@components/Loader';
import { FABButton } from '@components/common/Button';
import { fetchVehicleTrackingTripsOdoo } from '@api/services/generalApi';
import CalendarScreen from '@components/Calendar/CalendarScreen';
import { vehicleTrackingStyles as styles } from './styles';

// Palette matched to the Odoo list-view badges
//   Trip Started → teal  | Trip Ended → green  | Cancelled → red
const PHASE_META = {
  in_progress: { label: 'TRIP STARTED', color: '#00838F', bg: '#E0F7FA', icon: 'progress-clock' },
  completed:   { label: 'TRIP ENDED',   color: '#2E7D32', bg: '#E8F5E9', icon: 'check-circle' },
  cancelled:   { label: 'CANCELLED',    color: '#C62828', bg: '#FFEBEE', icon: 'close-circle' },
  draft:       { label: 'DRAFT',        color: '#6D6D6D', bg: '#EEEEEE', icon: 'file-document-outline' },
};

const phaseOf = (entry) => {
  if (entry.trip_cancel) return 'cancelled';
  if (entry.end_trip)    return 'completed';
  if (entry.start_trip)  return 'in_progress';
  return 'draft';
};

const todayString = () => {
  const d = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const computeDurationHrs = (start, end) => {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  const hrs = (e - s) / 3600000;
  return hrs > 0 ? hrs.toFixed(2) : null;
};

const TripCard = ({ entry, onPress }) => {
  const phase = phaseOf(entry);
  const meta = PHASE_META[phase];
  const duration = computeDurationHrs(entry.start_time, entry.end_time);
  const km = (entry.end_km || 0) - (entry.start_km || 0);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.tripCard, { borderLeftColor: meta.color }]}
    >
      {/* Header row: vehicle + status pill */}
      <View style={styles.tripCardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.tripCardVehicle} numberOfLines={1}>
            {entry.vehicle_name || entry.number_plate || 'Vehicle'}
          </Text>
          {!!entry.ref && (
            <Text style={styles.tripCardRef}>{entry.ref}</Text>
          )}
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
          <MaterialCommunityIcons name={meta.icon} size={12} color={meta.color} />
          <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {/* Driver row */}
      <View style={styles.tripCardRow}>
        <MaterialCommunityIcons name="account" size={14} color={COLORS.gray} />
        <Text style={styles.tripCardSubtle} numberOfLines={1}>
          {entry.driver_name || '—'}
        </Text>
        {entry.offline && (
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>OFFLINE</Text>
          </View>
        )}
      </View>

      {/* Route */}
      <View style={styles.tripCardRow}>
        <MaterialCommunityIcons name="map-marker-path" size={14} color={COLORS.gray} />
        <Text style={styles.tripCardRoute} numberOfLines={1}>
          {(entry.source_name || '—')}  →  {(entry.destination_name || '—')}
        </Text>
      </View>

      {/* Footer metrics */}
      <View style={styles.tripCardFooter}>
        <View style={styles.tripMetric}>
          <MaterialCommunityIcons name="calendar" size={12} color={COLORS.gray} />
          <Text style={styles.tripMetricText}>{entry.date || '—'}</Text>
        </View>
        {km > 0 && (
          <View style={styles.tripMetric}>
            <MaterialCommunityIcons name="speedometer" size={12} color={COLORS.gray} />
            <Text style={styles.tripMetricText}>{km} km</Text>
          </View>
        )}
        {duration && (
          <View style={styles.tripMetric}>
            <MaterialCommunityIcons name="clock-outline" size={12} color={COLORS.gray} />
            <Text style={styles.tripMetricText}>{duration} hrs</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const SectionHeader = ({ title, count, color }) => (
  <View style={styles.sectionHeader}>
    <View style={[styles.sectionHeaderDot, { backgroundColor: color }]} />
    <Text style={styles.sectionHeaderTitle}>{title}</Text>
    <View style={[styles.sectionHeaderCount, { backgroundColor: color }]}>
      <Text style={styles.sectionHeaderCountText}>{count}</Text>
    </View>
  </View>
);

const VehicleTrackingScreen = ({ navigation }) => {
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [vehicleEntries, setVehicleEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchEntriesForDate = useCallback(async (dateString) => {
    setLoading(true);
    try {
      const entries = await fetchVehicleTrackingTripsOdoo({ date: dateString });
      setVehicleEntries(entries || []);
    } catch (error) {
      console.error('Failed to fetch vehicle tracking entries:', error);
      setVehicleEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchEntriesForDate(selectedDate || todayString());
    }, [selectedDate, fetchEntriesForDate])
  );

  const handleDateSelect = (day) => {
    setSelectedDate(day.dateString);
    fetchEntriesForDate(day.dateString);
  };

  const draft      = vehicleEntries.filter(e => !e.start_trip && !e.end_trip && !e.trip_cancel);
  const inProgress = vehicleEntries.filter(e => e.start_trip && !e.end_trip && !e.trip_cancel);
  const completed  = vehicleEntries.filter(e => e.end_trip);
  const cancelled  = vehicleEntries.filter(e => e.trip_cancel);

  return (
    <SafeAreaView style={styles.container}>
      <NavigationHeader title="Vehicle Tracking" navigation={navigation} />
      <OfflineBanner
        message="OFFLINE — showing cached trips, new entries will sync when online"
        onOnline={() => { if (selectedDate) fetchEntriesForDate(selectedDate); }}
      />

      <RoundedScrollContainer style={styles.content}>
        {/* Calendar */}
        <View style={styles.calendarContainer}>
          <CalendarScreen onDayPress={handleDateSelect} style={styles.calendar} />
        </View>

        {/* Summary strip */}
        {!loading && vehicleEntries.length > 0 && (
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryNumber, { color: PHASE_META.draft.color }]}>{draft.length}</Text>
              <Text style={styles.summaryLabel}>Draft</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryNumber, { color: PHASE_META.in_progress.color }]}>{inProgress.length}</Text>
              <Text style={styles.summaryLabel}>In Progress</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryNumber, { color: PHASE_META.completed.color }]}>{completed.length}</Text>
              <Text style={styles.summaryLabel}>Completed</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryNumber, { color: PHASE_META.cancelled.color }]}>{cancelled.length}</Text>
              <Text style={styles.summaryLabel}>Cancelled</Text>
            </View>
          </View>
        )}

        <View style={styles.contentContainer}>
          {loading ? (
            <OverlayLoader visible={true} />
          ) : vehicleEntries.length === 0 ? (
            <View style={styles.emptyStateContainer}>
              <MaterialCommunityIcons name="car-off" size={56} color={COLORS.gray} />
              <Text style={styles.emptyStateTitle}>No trips on this day</Text>
              <Text style={styles.emptyStateSubtitle}>Tap the + button to start a new trip</Text>
            </View>
          ) : (
            <View>
              {draft.length > 0 && (
                <>
                  <SectionHeader title="Draft" count={draft.length} color={PHASE_META.draft.color} />
                  {draft.map(entry => (
                    <TripCard
                      key={entry.id}
                      entry={entry}
                      onPress={() => navigation.navigate('VehicleTrackingForm', { tripData: entry })}
                    />
                  ))}
                </>
              )}

              {inProgress.length > 0 && (
                <>
                  <SectionHeader title="In Progress" count={inProgress.length} color={PHASE_META.in_progress.color} />
                  {inProgress.map(entry => (
                    <TripCard
                      key={entry.id}
                      entry={entry}
                      onPress={() => navigation.navigate('VehicleTrackingForm', { tripData: entry })}
                    />
                  ))}
                </>
              )}

              {completed.length > 0 && (
                <>
                  <SectionHeader title="Completed" count={completed.length} color={PHASE_META.completed.color} />
                  {completed.map(entry => (
                    <TripCard
                      key={entry.id}
                      entry={entry}
                      onPress={() => navigation.navigate('VehicleTrackingForm', { tripData: entry })}
                    />
                  ))}
                </>
              )}

              {cancelled.length > 0 && (
                <>
                  <SectionHeader title="Cancelled" count={cancelled.length} color={PHASE_META.cancelled.color} />
                  {cancelled.map(entry => (
                    <TripCard
                      key={entry.id}
                      entry={entry}
                      onPress={() => navigation.navigate('VehicleTrackingForm', { tripData: entry })}
                    />
                  ))}
                </>
              )}
            </View>
          )}
        </View>
      </RoundedScrollContainer>

      <FABButton onPress={() => navigation.navigate('VehicleTrackingForm')} />
    </SafeAreaView>
  );
};

export default VehicleTrackingScreen;
