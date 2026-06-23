import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { RoundedScrollContainer } from '@components/containers';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { OverlayLoader } from '@components/Loader';
import { showToastMessage } from '@components/Toast';
import { useAuthStore } from '@stores/auth';
import { getCurrentLocationWithAddress } from '@services/LocationTrackingService';
import { formatTimeOffice, formatDateOffice, hydrateOfficeTimezone } from '@utils/officeTime';

const UserAttendanceForm = ({ navigation, route }) => {
  const { date, attendanceData } = route.params || {};
  const currentUser = useAuthStore(state => state.user);
  const [loading, setLoading] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [checkInTime, setCheckInTime] = useState(attendanceData?.check_in || null);
  const [checkOutTime, setCheckOutTime] = useState(attendanceData?.check_out || null);

  const isEditing = !!attendanceData;

  useEffect(() => {
    // Seed the office tz so check-in/out times render in office time (not the
    // device timezone) even if this form is opened before the late config loads.
    hydrateOfficeTimezone();
    fetchCurrentLocation();
  }, []);

  const fetchCurrentLocation = async () => {
    try {
      const location = await getCurrentLocationWithAddress();
      if (location) {
        setCurrentLocation(location);
      }
    } catch (error) {
      console.error('Failed to get location:', error);
    }
  };

  const handleCheckIn = async () => {
    setLoading(true);
    try {
      const now = new Date();
      setCheckInTime(now.toISOString());
      showToastMessage('Check-in recorded successfully!');
      console.log('[UserAttendance] Check-in:', {
        time: now.toISOString(),
        location: currentLocation,
        user: currentUser?.uid,
      });
    } catch (error) {
      console.error('Failed to check in:', error);
      showToastMessage('Failed to record check-in');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckOut = async () => {
    setLoading(true);
    try {
      const now = new Date();
      setCheckOutTime(now.toISOString());
      showToastMessage('Check-out recorded successfully!');
      console.log('[UserAttendance] Check-out:', {
        time: now.toISOString(),
        location: currentLocation,
        user: currentUser?.uid,
      });
    } catch (error) {
      console.error('Failed to check out:', error);
      showToastMessage('Failed to record check-out');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return '--:--';
    // Office timezone (config), not the device timezone.
    return formatTimeOffice(timeString) || '--:--';
  };

  const formatDate = (dateString) => {
    if (!dateString) return formatDateOffice(new Date());
    try {
      return formatDateOffice(dateString, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }) || dateString;
    } catch {
      return dateString;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <NavigationHeader
        title={isEditing ? 'Edit Attendance' : 'Mark Attendance'}
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={() => navigation.goBack()}
      />

      <RoundedScrollContainer style={styles.content}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.dateContainer}>
            <Text style={styles.dateLabel}>Date</Text>
            <Text style={styles.dateValue}>{formatDate(date)}</Text>
          </View>

          <View style={styles.userContainer}>
            <Text style={styles.userLabel}>Employee</Text>
            <Text style={styles.userName}>
              {currentUser?.name || currentUser?.user_name || currentUser?.login || 'User'}
            </Text>
          </View>

          <View style={styles.locationContainer}>
            <Text style={styles.locationLabel}>Current Location</Text>
            {currentLocation ? (
              <Text style={styles.locationValue} numberOfLines={2}>
                {currentLocation.locationName || `${currentLocation.latitude?.toFixed(6)}, ${currentLocation.longitude?.toFixed(6)}`}
              </Text>
            ) : (
              <TouchableOpacity onPress={fetchCurrentLocation}>
                <Text style={styles.fetchLocationText}>Tap to fetch location</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.cardsContainer}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Check In</Text>
              <Text style={styles.cardTime}>{formatTime(checkInTime)}</Text>
              {!checkInTime && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.checkInButton]}
                  onPress={handleCheckIn}
                  disabled={loading}
                >
                  <Text style={styles.actionButtonText}>Check In</Text>
                </TouchableOpacity>
              )}
              {checkInTime && (
                <Text style={styles.recordedText}>Recorded</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Check Out</Text>
              <Text style={styles.cardTime}>{formatTime(checkOutTime)}</Text>
              {checkInTime && !checkOutTime && (
                <TouchableOpacity
                  style={[styles.actionButton, styles.checkOutButton]}
                  onPress={handleCheckOut}
                  disabled={loading}
                >
                  <Text style={styles.actionButtonText}>Check Out</Text>
                </TouchableOpacity>
              )}
              {checkOutTime && (
                <Text style={styles.recordedText}>Recorded</Text>
              )}
              {!checkInTime && !checkOutTime && (
                <Text style={styles.disabledText}>Check in first</Text>
              )}
            </View>
          </View>

          {(checkInTime || checkOutTime) && (
            <View style={styles.summaryContainer}>
              <Text style={styles.summaryTitle}>Today's Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Status:</Text>
                <Text style={[styles.summaryValue, { color: COLORS.green }]}>Present</Text>
              </View>
              {checkInTime && checkOutTime && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Working Hours:</Text>
                  <Text style={styles.summaryValue}>
                    {(() => {
                      const diff = new Date(checkOutTime) - new Date(checkInTime);
                      const hours = Math.floor(diff / (1000 * 60 * 60));
                      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                      return `${hours}h ${minutes}m`;
                    })()}
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </RoundedScrollContainer>

      <OverlayLoader visible={loading} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  content: {
    flex: 1,
    padding: 15,
  },
  dateContainer: {
    backgroundColor: COLORS.lightGray,
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  dateLabel: {
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 4,
  },
  dateValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  userContainer: {
    backgroundColor: COLORS.lightGray,
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
  },
  userLabel: {
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 4,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  locationContainer: {
    backgroundColor: COLORS.lightGray,
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  locationLabel: {
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 4,
  },
  locationValue: {
    fontSize: 14,
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  fetchLocationText: {
    fontSize: 14,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistMedium,
    textDecorationLine: 'underline',
  },
  cardsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  card: {
    flex: 1,
    backgroundColor: COLORS.white,
    padding: 20,
    borderRadius: 12,
    marginHorizontal: 5,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  cardTitle: {
    fontSize: 14,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 10,
  },
  cardTime: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginBottom: 15,
  },
  actionButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  checkInButton: {
    backgroundColor: COLORS.green,
  },
  checkOutButton: {
    backgroundColor: COLORS.red,
  },
  actionButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: 'bold',
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  recordedText: {
    fontSize: 12,
    color: COLORS.green,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  disabledText: {
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  summaryContainer: {
    backgroundColor: COLORS.lightGray,
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  summaryLabel: {
    fontSize: 14,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.black,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
});

export default UserAttendanceForm;
