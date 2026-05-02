import React, { useState, useEffect, useCallback } from 'react';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { formatData } from '@utils/formatters';
import { RoundedContainer, SafeAreaView } from '@components/containers';
import { EmptyItem, EmptyState } from '@components/common/empty';
import { NavigationHeader } from '@components/Header';
import { FABButton } from '@components/common/Button';
import { fetchCustomerVisitsOdoo, fetchCustomersOdoo, fetchEmployeesOdoo } from '@api/services/generalApi';
import { useDataFetching } from '@hooks';
import { OverlayLoader } from '@components/Loader';
import Text from '@components/Text';
import { TouchableOpacity, View, StyleSheet, ScrollView } from 'react-native';
import RNModal from 'react-native-modal';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { DropdownSheet, MultiSelectDropdownSheet } from '@components/common/BottomSheets';
import CustomListModal from '@components/Modal/CustomListModal';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import moment from 'moment';
import { filterCalendar } from '@constants/dropdownConst';
import { useAuthStore } from '@stores/auth';
import { VisitList } from '@components/CRM';

// Same color palette Easy Sales / Sales Order list use for status pills.
const STATE_FILTER_COLORS = {
  all:   '#6C7A89',
  draft: '#FF9800',
  done:  '#4CAF50',
};
const STATE_FILTERS = [
  { key: 'all',   label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'done',  label: 'Done' },
];

const VisitScreen = ({ navigation, route }) => {
  const isFocused = useIsFocused();
  const refreshAt = route?.params?.refreshAt;
  const newVisitId = route?.params?.newVisitId;
  const currentUser = useAuthStore((state) => state.user);
  const currentUserId = currentUser?.related_profile?._id || '';
  const [selectedType, setSelectedType] = useState(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isDatePickerVisible, setDatePickerVisibility] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState('from');
  const [isCustomerModalVisible, setIsCustomerModalVisible] = useState(false);
  const [isEmployeeModalVisible, setIsEmployeeModalVisible] = useState(false);
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [activeStateFilter, setActiveStateFilter] = useState('all');

  const [formData, setFormData] = useState({
    fromDate: '',
    toDate: '',
    customer: '',
    employees: [],
    departments: [],
    brands: []
  });

  const [dropdown, setDropdown] = useState({
    employees: [],
    departments: [],
    brands: [],
    customers: '',
  });

  const { data, loading, fetchData, fetchMoreData } = useDataFetching(fetchCustomerVisitsOdoo);

  useFocusEffect(
    useCallback(() => {
      console.log('[VisitScreen] focus — fetching with empty filters');
      fetchData({});
    }, [])
  );

  useEffect(() => {
    if (isFocused) {
      console.log('[VisitScreen] isFocused changed — re-fetching');
      fetchData({});
    }
  }, [isFocused]);

  // Force a fresh, unfiltered re-fetch whenever the form sends back a
  // refreshAt timestamp (after a successful save). Also clears any active
  // filters so the just-created visit is guaranteed to appear at the top.
  useEffect(() => {
    if (!refreshAt) return;
    console.log('[VisitScreen] refreshAt=' + refreshAt + ' newVisitId=' + newVisitId +
                ' — clearing filters and re-fetching');
    setFormData({
      fromDate: '', toDate: '', customer: '', employees: [], departments: [], brands: [],
    });
    fetchData({});
  }, [refreshAt]);

  // Log every time the data array changes so we can see record count.
  useEffect(() => {
    console.log('[VisitScreen] data updated, count=' + (data?.length || 0));
    if (newVisitId && Array.isArray(data) && data.length > 0) {
      const found = data.some((v) => v.id === newVisitId);
      console.log('[VisitScreen] newVisitId=' + newVisitId + ' present in list? ' + found);
    }
  }, [data, newVisitId]);

  useEffect(() => {
    const loadDropdowns = async () => {
      try {
        const [employees, customers] = await Promise.all([
          fetchEmployeesOdoo(),
          fetchCustomersOdoo(),
        ]);
        setDropdown({
          employees: employees.map(e => ({ id: e.id, label: e.name })),
          departments: [],
          brands: [],
          customers: customers.map(c => ({ id: c.id, label: c.name })),
        });
      } catch (error) {
        console.error("Error fetching dropdown data:", error);
      }
    };

    loadDropdowns();
  }, []);

  const handleLoadMore = () => {
    fetchMoreData({});
  };

  const renderItem = ({ item }) => {
    if (item.empty) {
      return <EmptyItem />;
    }
    return <VisitList item={item} onPress={() => navigation.navigate('VisitDetails', { visitId: item.id, visitDetails: item })} />;
  };

  const renderEmptyState = () => (
    <EmptyState imageSource={require('@assets/images/EmptyData/empty_data.png')} message={'no visits found'} />
  );

  const renderContent = () => (
    <FlashList
      data={formatData((data || []).filter((v) =>
        activeStateFilter === 'all' ? true : (v?.state || 'draft') === activeStateFilter
      ), 1)}
      numColumns={1}
      renderItem={renderItem}
      keyExtractor={(item, index) => index.toString()}
      contentContainerStyle={{ padding: 10, paddingBottom: 50 }}
      onEndReached={handleLoadMore}
      showsVerticalScrollIndicator={false}
      onEndReachedThreshold={0.2}
      ListFooterComponent={null}
      estimatedItemSize={100}
    />
  );

  const renderListing = () => {
    if (data.length === 0 && !loading) {
      return renderEmptyState();
    }
    return renderContent();
  };

  const toggleBottomSheet = (type) => {
    setSelectedType(type);
    setIsVisible(!isVisible);
  };

  const handleFieldChange = (fieldName, value) => {
    setFormData((prevState) => ({
      ...prevState,
      [fieldName]: value,
    }));
  };

  const handleDateConfirm = (date) => {
    const formattedDate = moment(date).format('DD-MM-YYYY');
    if (datePickerMode === 'from') {
      handleFieldChange('fromDate', formattedDate);
    } else {
      handleFieldChange('toDate', formattedDate);
    }
    setDatePickerVisibility(false);
  };


  const handleDateRangeSelection = (rangeType) => {
    let fromDate = moment();
    let toDate = moment();

    switch (rangeType.value) {
      case 'Yesterday':
        fromDate = fromDate.subtract(1, 'days');
        toDate = toDate.subtract(1, 'days');
        break;
      case 'Today':
        break;
      case 'Tomorrow':
        fromDate = fromDate.add(1, 'days');
        toDate = toDate.add(1, 'days');
        break;
      case 'This Month':
        fromDate = fromDate.startOf('month');
        toDate = toDate.endOf('month');
        break;
      case 'Last Month':
        fromDate = fromDate.subtract(1, 'months').startOf('month');
        toDate = toDate.subtract(1, 'months').endOf('month');
        break;
      case 'This Year':
        fromDate = fromDate.startOf('year');
        toDate = toDate.endOf('year');
        break;
      default:
        return;
    }

    handleFieldChange('fromDate', fromDate.format('DD-MM-YYYY'));
    handleFieldChange('toDate', toDate.format('DD-MM-YYYY'));
    setIsVisible(false);
  };

  const renderBottomSheet = () => {
    let items = [];
    let isMultiSelect = true;
    let previousSelections = [];

    switch (selectedType) {
      case 'Employees':
        items = dropdown.employees;
        previousSelections = formData.employees;
        break;
      case 'Departments':
        items = dropdown.departments;
        previousSelections = formData.departments;
        break;
      case 'Brands':
        items = dropdown.brands;
        previousSelections = formData.brands;
        break;
      case 'Customer':
        items = dropdown.customers;
        // previousSelections = formData.customer ? [formData.customer] : [];
        isMultiSelect = false;
        break;
      case 'Select Durations':
        items = filterCalendar;
        isMultiSelect = false;
        break;
      default:
        return null;
    }

    return isMultiSelect ? (
      <MultiSelectDropdownSheet
        isVisible={isVisible}
        items={items}
        title={selectedType}
        onClose={() => setIsVisible(false)}
        onValueChange={(value) => handleFieldChange(selectedType.toLowerCase(), value)}
        previousSelections={previousSelections}  // Pass previous selections
      />
    ) : (
      <DropdownSheet
        isVisible={isVisible}
        items={items}
        title={selectedType}
        onClose={() => setIsVisible(false)}
        onValueChange={(value) => {
          if (selectedType === 'Select Durations') {
            handleDateRangeSelection(value);
          } else {
            handleFieldChange('customer', value);
          }
        }}
      />
    );
  };


  const applyFilters = () => {
    const filters = {};
    if (formData.fromDate) filters.fromDate = moment(formData.fromDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    if (formData.toDate) filters.toDate = moment(formData.toDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    if (formData.customer?.id) filters.customerId = formData.customer.id;
    fetchData(filters);
  }

  const clearFilters = () => {
    setFormData({
      fromDate: '',
      toDate: '',
      customer: '',
      employees: [],
      departments: [],
      brands: [],
    });
    fetchData({});
  };

  // Single-chip removal — clears that one filter and re-fetches the list.
  const clearOne = (key) => {
    let next = { ...formData };
    if (key === 'fromDate') next.fromDate = '';
    if (key === 'toDate') next.toDate = '';
    if (key === 'customer') next.customer = '';
    if (key === 'employees') next.employees = [];
    setFormData(next);
    const filters = {};
    if (next.fromDate) filters.fromDate = moment(next.fromDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    if (next.toDate) filters.toDate = moment(next.toDate, 'DD-MM-YYYY').format('YYYY-MM-DD');
    if (next.customer?.id) filters.customerId = next.customer.id;
    fetchData(filters);
  };

  // Derive the active-filter chips from formData.
  const chips = [];
  if (formData.fromDate) chips.push({ key: 'fromDate', label: 'From', value: formData.fromDate });
  if (formData.toDate) chips.push({ key: 'toDate', label: 'To', value: formData.toDate });
  if (formData.customer?.label) chips.push({ key: 'customer', label: 'Customer', value: formData.customer.label });
  if (formData.employees[0]?.label) chips.push({ key: 'employees', label: 'Employee', value: formData.employees[0].label });
  const activeFilterCount = chips.length;

  return (
    <SafeAreaView>
      <NavigationHeader
        title="Customer Visits"
        logo={true}
        onBackPress={() => navigation.goBack()}
      />

      {/* Active-filter chips (only when filters applied) */}
      {/* Status filter tabs + Filter button on the right (one row) */}
      <View style={styles.stateTabsBar}>
        <View style={styles.stateTabsLeft}>
          {STATE_FILTERS.map((f) => {
            const color = STATE_FILTER_COLORS[f.key] || COLORS.primaryThemeColor;
            const isActive = activeStateFilter === f.key;
            const count = (data || []).filter((v) =>
              f.key === 'all' ? true : (v?.state || 'draft') === f.key
            ).length;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.stateTab, isActive && { borderBottomColor: color }]}
                onPress={() => setActiveStateFilter(f.key)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.stateTabText,
                    { color: isActive ? color : `${color}B3` },
                    isActive && { fontFamily: FONT_FAMILY.urbanistBold },
                  ]}
                >
                  {f.label} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity
          style={styles.tabRowFilterBtn}
          onPress={() => setIsFilterModalVisible(true)}
          activeOpacity={0.7}
        >
          <MaterialIcons name="filter-list" size={18} color={COLORS.primaryThemeColor} />
          <Text style={styles.tabRowFilterText}>Filter</Text>
          {activeFilterCount > 0 && (
            <View style={styles.tabRowFilterBadge}>
              <Text style={styles.tabRowFilterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {chips.length > 0 && (
        <View style={styles.chipBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 12 }}
          >
            {chips.map((chip) => (
              <View key={chip.key} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {chip.label}: {chip.value}
                </Text>
                <TouchableOpacity
                  onPress={() => clearOne(chip.key)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MaterialIcons name="close" size={14} color="#666" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={clearFilters} style={styles.chipClearAll}>
              <Text style={styles.chipClearAllText}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}

      {/* Filter Modal — centered popup containing the four filter rows */}
      <RNModal
        isVisible={isFilterModalVisible}
        animationIn="zoomIn"
        animationOut="zoomOut"
        backdropOpacity={0.4}
        onBackdropPress={() => setIsFilterModalVisible(false)}
        useNativeDriver
      >
        <View style={styles.filterModalCard}>
          <View style={styles.filterModalHeader}>
            <Text style={styles.filterModalTitle}>Filters</Text>
            <TouchableOpacity
              onPress={() => setIsFilterModalVisible(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialIcons name="close" size={22} color="#666" />
            </TouchableOpacity>
          </View>

          {/* From date */}
          <TouchableOpacity
            style={styles.filterRow}
            activeOpacity={0.7}
            onPress={() => { setDatePickerMode('from'); setDatePickerVisibility(true); }}
          >
            <MaterialIcons name="event" size={20} color={COLORS.primaryThemeColor} />
            <View style={styles.filterRowContent}>
              <Text style={styles.filterLabel}>From date</Text>
              <Text style={[styles.filterValue, !formData.fromDate && styles.filterValuePlaceholder]}>
                {formData.fromDate || 'Pick a date'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#bbb" />
          </TouchableOpacity>

          {/* To date */}
          <TouchableOpacity
            style={styles.filterRow}
            activeOpacity={0.7}
            onPress={() => { setDatePickerMode('to'); setDatePickerVisibility(true); }}
          >
            <MaterialIcons name="event-available" size={20} color={COLORS.primaryThemeColor} />
            <View style={styles.filterRowContent}>
              <Text style={styles.filterLabel}>To date</Text>
              <Text style={[styles.filterValue, !formData.toDate && styles.filterValuePlaceholder]}>
                {formData.toDate || 'Pick a date'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#bbb" />
          </TouchableOpacity>

          {/* Customer */}
          <TouchableOpacity
            style={styles.filterRow}
            activeOpacity={0.7}
            onPress={() => setIsCustomerModalVisible(true)}
          >
            <MaterialIcons name="person" size={20} color={COLORS.primaryThemeColor} />
            <View style={styles.filterRowContent}>
              <Text style={styles.filterLabel}>Customer</Text>
              <Text style={[styles.filterValue, !formData.customer?.label && styles.filterValuePlaceholder]}>
                {formData.customer?.label || 'Any customer'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#bbb" />
          </TouchableOpacity>

          {/* Employee */}
          <TouchableOpacity
            style={[styles.filterRow, { borderBottomWidth: 0 }]}
            activeOpacity={0.7}
            onPress={() => setIsEmployeeModalVisible(true)}
          >
            <MaterialIcons name="badge" size={20} color={COLORS.primaryThemeColor} />
            <View style={styles.filterRowContent}>
              <Text style={styles.filterLabel}>Employee</Text>
              <Text style={[styles.filterValue, !formData.employees[0]?.label && styles.filterValuePlaceholder]}>
                {formData.employees[0]?.label || 'Any employee'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#bbb" />
          </TouchableOpacity>

          {/* Action buttons */}
          <View style={styles.filterActions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.clearBtn]}
              onPress={clearFilters}
              activeOpacity={0.7}
            >
              <MaterialIcons name="clear" size={16} color="#666" />
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.applyBtn]}
              onPress={() => { applyFilters(); setIsFilterModalVisible(false); }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="search" size={16} color="#fff" />
              <Text style={styles.applyBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </RNModal>
      <RoundedContainer>
        {renderListing()}
        <FABButton onPress={() => navigation.navigate('VisitForm')} />
      </RoundedContainer>

      {/* Easy-Sales-style dark blue loader */}
      <OverlayLoader visible={loading} />

      {/* Calendar popup for from/to date */}
      <DateTimePickerModal
        isVisible={isDatePickerVisible}
        mode="date"
        onConfirm={handleDateConfirm}
        onCancel={() => setDatePickerVisibility(false)}
      />

      {/* Customer center popup — no edit option (filter-only) */}
      <CustomListModal
        isVisible={isCustomerModalVisible}
        items={dropdown.customers || []}
        title="Select Customer"
        onClose={() => setIsCustomerModalVisible(false)}
        onValueChange={(value) => {
          handleFieldChange('customer', value);
          setIsCustomerModalVisible(false);
        }}
        onAddIcon={false}
      />

      {/* Employee center popup */}
      <CustomListModal
        isVisible={isEmployeeModalVisible}
        items={dropdown.employees || []}
        title="Select Employee"
        onClose={() => setIsEmployeeModalVisible(false)}
        onValueChange={(value) => {
          handleFieldChange('employees', [value]);
          setIsEmployeeModalVisible(false);
        }}
        onAddIcon={false}
      />
    </SafeAreaView>
  );
};

export default VisitScreen;

const styles = StyleSheet.create({
  label: {
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    color: COLORS.white,
    marginRight: 10,
  },
  filterCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 4,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  // Filter button rendered inside the NavigationHeader's right slot
  headerFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  headerFilterBtnText: {
    marginLeft: 6,
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },
  headerFilterDot: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerFilterDotText: {
    color: COLORS.primaryThemeColor,
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  // Status tab row (All / Draft / Done) — colored underline pattern from Sales Order.
  // Tabs on the left, Filter button right-aligned on the same row.
  stateTabsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  stateTabsLeft: { flexDirection: 'row', alignItems: 'center' },
  stateTab: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginRight: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  stateTabText: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
  tabRowFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#F4EFFA',
    marginRight: 6,
  },
  tabRowFilterText: {
    marginLeft: 6,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },
  tabRowFilterBadge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: COLORS.primaryThemeColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRowFilterBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  // Chip row shown below the header only when filters are active
  chipBar: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  // OLD top filter bar (kept for legacy reference, not used now)
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F4EFFA',
    marginRight: 8,
  },
  filterBtnText: {
    marginLeft: 6,
    color: COLORS.primaryThemeColor,
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },
  filterCountBadge: {
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: COLORS.primaryThemeColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCountText: { color: '#fff', fontSize: 11, fontFamily: FONT_FAMILY.urbanistBold },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F4F4F4',
    borderRadius: 14,
    marginRight: 6,
    maxWidth: 180,
  },
  chipText: {
    fontSize: 11,
    color: '#444',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginRight: 4,
  },
  chipClearAll: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginRight: 6,
  },
  chipClearAllText: {
    color: '#D32F2F',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  // Filter modal (centered popup containing the four filter rows)
  filterModalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  filterModalTitle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#222',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  filterRowContent: { flex: 1, marginLeft: 12 },
  filterLabel: {
    fontSize: 11,
    color: '#888',
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 2,
  },
  filterValue: {
    fontSize: 14,
    color: '#222',
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  filterValuePlaceholder: { color: '#aaa', fontFamily: FONT_FAMILY.urbanistMedium },
  filterActions: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  clearBtn: { backgroundColor: '#F4F4F4' },
  clearBtnText: { marginLeft: 6, color: '#666', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13 },
  applyBtn: { backgroundColor: COLORS.primaryThemeColor },
  applyBtnText: { marginLeft: 6, color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13 },
});
