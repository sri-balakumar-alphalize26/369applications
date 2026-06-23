import React from 'react';
import { ScrollView, View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView, RoundedContainer } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { AntDesign } from '@expo/vector-icons';
import { EMPLOYEE_MANUALS } from '../../../../data/employeeManuals';

// Help & User Guide — lists the bundled employee manuals. Tapping a card opens
// ManualViewerScreen, which renders the guide HTML and can open the full PDF.
const UserGuideScreen = ({ navigation }) => {
  return (
    <SafeAreaView backgroundColor={COLORS.primaryThemeColor}>
      <NavigationHeader title="User Guide" onBackPress={() => navigation.goBack()} logo={false} />
      <RoundedContainer backgroundColor={'#f5f5f5'}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Step-by-step guides for using the app. Tap a guide to read it, or open the full PDF inside.
          </Text>
          {EMPLOYEE_MANUALS.map((m) => (
            <TouchableOpacity
              key={m.id}
              activeOpacity={0.85}
              style={styles.card}
              onPress={() => navigation.navigate('ManualViewerScreen', { id: m.id })}
            >
              <Text style={styles.icon}>{m.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{m.title}</Text>
                <Text style={styles.desc}>{m.description}</Text>
              </View>
              <AntDesign name="right" size={18} color={COLORS.primaryThemeColor} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </RoundedContainer>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 40 },
  intro: { fontSize: 13, fontFamily: FONT_FAMILY.urbanistMedium, color: '#667085', marginBottom: 14, marginHorizontal: 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      android: { elevation: 3 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 5 },
    }),
  },
  icon: { fontSize: 26, marginRight: 14 },
  title: { fontSize: 15, fontFamily: FONT_FAMILY.urbanistBold, color: '#1f2933', marginBottom: 3 },
  desc: { fontSize: 12.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#667085', lineHeight: 18 },
});

export default UserGuideScreen;
