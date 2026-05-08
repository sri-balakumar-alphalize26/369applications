import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { FONT_FAMILY } from '@constants/theme';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

const FIELD_COLOR = '#1976D2';

const fmtDate = (d) => {
  if (!d) return '';
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
};

const parseDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
};

const HistoryFiltersSheet = ({ visible, initial, onApply, onClose }) => {
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [lateOnly, setLateOnly] = useState(false);
  const [withDeduction, setWithDeduction] = useState(false);
  const [waived, setWaived] = useState(false);

  // iOS only: inline picker visibility.
  const [showFromIOS, setShowFromIOS] = useState(false);
  const [showToIOS, setShowToIOS] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setFrom(parseDate(initial?.dateFrom));
    setTo(parseDate(initial?.dateTo));
    setLateOnly(!!initial?.lateOnly);
    setWithDeduction(!!initial?.withDeduction);
    setWaived(!!initial?.waived);
  }, [visible, initial]);

  const openDatePicker = (which) => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: (which === 'from' ? from : to) || new Date(),
        mode: 'date',
        onChange: (_, picked) => {
          if (picked) {
            if (which === 'from') setFrom(picked); else setTo(picked);
          }
        },
      });
    } else {
      if (which === 'from') setShowFromIOS(true);
      else setShowToIOS(true);
    }
  };

  const reset = () => {
    setFrom(null); setTo(null);
    setLateOnly(false); setWithDeduction(false); setWaived(false);
  };

  const apply = () => {
    onApply({
      dateFrom: from ? `${fmtDate(from)} 00:00:00` : null,
      dateTo: to ? `${fmtDate(to)} 23:59:59` : null,
      lateOnly,
      withDeduction,
      waived,
    });
  };

  const Toggle = ({ icon, label, value, onValueChange, color = FIELD_COLOR }) => (
    <View style={styles.toggleRow}>
      <View style={[styles.toggleIcon, { backgroundColor: color + '22' }]}>
        <MaterialIcons name={icon} size={16} color={color} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#CFD8DC', true: color + '88' }}
        thumbColor={value ? color : '#fff'}
      />
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Filter History</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <MaterialIcons name="close" size={22} color="#333" />
            </TouchableOpacity>
          </View>

          <View style={{ padding: 16 }}>
            <Text style={styles.sectionTitle}>Date range</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.dateBtn} activeOpacity={0.85} onPress={() => openDatePicker('from')}>
                <MaterialIcons name="event" size={16} color={FIELD_COLOR} />
                <Text style={[styles.dateText, !from && { color: '#999' }]}>
                  {from ? fmtDate(from) : 'From'}
                </Text>
                {from ? (
                  <TouchableOpacity onPress={() => setFrom(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="close" size={14} color="#888" />
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateBtn} activeOpacity={0.85} onPress={() => openDatePicker('to')}>
                <MaterialIcons name="event" size={16} color={FIELD_COLOR} />
                <Text style={[styles.dateText, !to && { color: '#999' }]}>
                  {to ? fmtDate(to) : 'To'}
                </Text>
                {to ? (
                  <TouchableOpacity onPress={() => setTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <MaterialIcons name="close" size={14} color="#888" />
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            </View>

            {Platform.OS === 'ios' && showFromIOS ? (
              <DateTimePicker
                value={from || new Date()}
                mode="date"
                display="spinner"
                onChange={(_, picked) => {
                  setShowFromIOS(false);
                  if (picked) setFrom(picked);
                }}
              />
            ) : null}
            {Platform.OS === 'ios' && showToIOS ? (
              <DateTimePicker
                value={to || new Date()}
                mode="date"
                display="spinner"
                onChange={(_, picked) => {
                  setShowToIOS(false);
                  if (picked) setTo(picked);
                }}
              />
            ) : null}

            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Status</Text>
            <Toggle icon="schedule" label="Late only" value={lateOnly} onValueChange={setLateOnly} color="#FB8C00" />
            <Toggle icon="payments" label="With deduction" value={withDeduction} onValueChange={setWithDeduction} color="#E53935" />
            <Toggle icon="gavel" label="Waived" value={waived} onValueChange={setWaived} color="#9C27B0" />
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.btnSecondary} onPress={reset}>
              <Text style={styles.btnSecondaryText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={apply}>
              <MaterialIcons name="filter-list" size={16} color="#fff" />
              <Text style={styles.btnPrimaryText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    width: '100%', maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: 12,
    overflow: 'hidden',
    ...Platform.select({
      android: { elevation: 8 },
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12 },
    }),
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
  },
  title: { fontSize: 16, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  sectionTitle: { fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold, color: '#444', marginBottom: 6 },
  dateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F9FF', borderRadius: 10, borderWidth: 1, borderColor: '#E3F2FD',
    paddingHorizontal: 12, paddingVertical: 12,
  },
  dateText: { flex: 1, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#222' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8,
  },
  toggleIcon: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
  },
  toggleLabel: { flex: 1, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: '#333' },
  footer: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
    padding: 14, borderTopWidth: 1, borderTopColor: '#EEE',
  },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: FIELD_COLOR, borderRadius: 10,
    paddingVertical: 11, paddingHorizontal: 22,
  },
  btnPrimaryText: { color: '#fff', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
  btnSecondary: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#BDBDBD',
    paddingVertical: 11, paddingHorizontal: 18,
  },
  btnSecondaryText: { color: '#444', fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold },
});

export default HistoryFiltersSheet;
