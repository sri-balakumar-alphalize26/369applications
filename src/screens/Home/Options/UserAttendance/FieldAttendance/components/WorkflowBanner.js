import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';

// Yellow workflow guidance — compact single-line header inside a box with
// an arrow on the right. Tapping the arrow (or anywhere on the row) opens
// a centred popup containing all 7 steps.
const WorkflowBanner = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        style={styles.box}
        activeOpacity={0.85}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.titleSingleLine} numberOfLines={1}>
          👋 How to fill your Field Attendance for today
        </Text>
        <MaterialIcons name="keyboard-arrow-right" size={22} color="#7A4F00" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.card}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>👋 How to fill your Field Attendance for today</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MaterialIcons name="close" size={22} color="#5A3A00" />
              </TouchableOpacity>
            </View>
            <Text style={styles.intro}>Just follow these steps in order:</Text>
            <ScrollView style={{ flexGrow: 0, maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 4 }}>
              <Step n={1} title="Were you late today?"
                body="If yes, scroll to Late Tracking and click Enter Late Reason. Type why and save. Skip if on time." />
              <Step n={2} title="Going from Home to Office?"
                body="Click Setup Primary Trip and fill the trip you used. You stay in office mode — no return needed." />
              <Step n={3} title="Going Home directly to a customer visit?"
                body="Click Setup Secondary Trip and fill the trip + the customer you visited." />
              <Step n={4} title="More visits after the first?"
                body="Click Add Additional Trip each time. The system asks to close your previous trip first — type End KM and save." />
              <Step n={5} title="Time to head back from your last visit?"
                body="Click Primary Trip (Via Office or Direct). Via Office logs Visit → Office; then click Primary Trip (Office to Home). Direct goes straight from visit to home." />
              <Step n={6} title="Need another visit before going home?"
                body="After any return leg, click Add Additional Trip to start a new visit. Via Office / Direct comes back. Loops as needed." />
              <Step n={7} title="Done for the day?"
                body="Click Check Out at the top. Your last open trip closes automatically, visits are marked Done, and the whole page locks." />
            </ScrollView>
            <TouchableOpacity style={styles.gotIt} activeOpacity={0.85} onPress={() => setOpen(false)}>
              <Text style={styles.gotItText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
};

const Step = ({ n, title, body }) => (
  <View style={styles.step}>
    <View style={styles.numCircle}><Text style={styles.numText}>{n}</Text></View>
    <View style={{ flex: 1 }}>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  // Compact single-line box on the field-attendance screen.
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF8E1',
    borderLeftWidth: 3, borderLeftColor: '#F9A825',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    marginTop: 10,
  },
  titleSingleLine: {
    flex: 1, fontSize: 12.5,
    fontFamily: FONT_FAMILY.urbanistBold, color: '#7A4F00',
  },
  // Centred popup card showing every step.
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16,
  },
  card: {
    width: '100%', maxWidth: 460,
    backgroundColor: '#FFF8E1',
    borderRadius: 16, padding: 16,
    borderLeftWidth: 4, borderLeftColor: '#F9A825',
    ...Platform.select({
      android: { elevation: 8 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 12 },
    }),
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: { flex: 1, fontSize: 14, fontFamily: FONT_FAMILY.urbanistBold, color: '#5A3A00' },
  intro: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistMedium, color: '#7A4F00', marginBottom: 8 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 8 },
  numCircle: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#F9A825',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  numText: { color: '#fff', fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistBold },
  stepTitle: { fontSize: 12.5, fontFamily: FONT_FAMILY.urbanistBold, color: '#5A3A00' },
  stepBody: { fontSize: 11.5, fontFamily: FONT_FAMILY.urbanistMedium, color: '#7A4F00', marginTop: 2 },
  gotIt: {
    marginTop: 12, paddingVertical: 11,
    backgroundColor: '#F9A825', borderRadius: 10,
    alignItems: 'center',
  },
  gotItText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default WorkflowBanner;
