import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { COLORS } from '@constants/theme';
import FieldAttendanceSection from '@screens/Home/Options/UserAttendance/FieldAttendance/components/FieldAttendanceSection';

// Thin wrapper. All logic lives in <FieldAttendanceSection/>, which is also
// embedded in UserAttendanceScreen. This screen exists for direct navigation
// (e.g. from the history list → tap a row) and just adds the SafeAreaView +
// header + the in-section Check Out button.
const FieldAttendanceDetailScreen = ({ navigation, route }) => {
  const attendanceId = Number(route?.params?.attendanceId);
  return (
    <SafeAreaView backgroundColor={COLORS.white}>
      <NavigationHeader
        title="Field Attendance"
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={() => navigation.goBack()}
      />
      <View style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
        <FieldAttendanceSection attendanceId={attendanceId} showCheckOutButton />
      </View>
    </SafeAreaView>
  );
};

export default FieldAttendanceDetailScreen;
