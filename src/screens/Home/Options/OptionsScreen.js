import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, FlatList } from 'react-native';
import { NavigationHeader } from '@components/Header';
import { RoundedContainer, SafeAreaView } from '@components/containers';
import { ListItem } from '@components/Options';
import { formatData } from '@utils/formatters';
import { EmptyItem } from '@components/common/empty';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { useLoader } from '@hooks';
import { fetchProductByBarcodeOdoo } from '@api/services/generalApi';
import { showToastMessage } from '@components/Toast';
import { OverlayLoader } from '@components/Loader';
import { ConfirmationModal } from '@components/Modal';
import { useAuthStore } from '@stores/auth';
import { post } from '@api/services/utils';
import ContactsSheet from '@screens/Home/Options/WhatsApp/ContactsSheet';
import Text from '@components/Text';

const OptionsScreen = ({ navigation }) => {
  const [isConfirmationModalVisible, setIsConfirmationModalVisible] = useState(false);
  const [loading, startLoading, stopLoading] = useLoader(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const currentUser = useAuthStore(state => state.user);

  // Check if user is admin (works for both UAE admin and Odoo login)
  // For Odoo: check is_admin field from login response
  // For UAE: check if user_name/username/login is 'admin'
  const isAdmin = currentUser?.is_admin === true ||
                  currentUser?.user_name === 'admin' ||
                  currentUser?.username === 'admin' ||
                  currentUser?.login === 'admin';

  const handleScan = async (code) => {
    startLoading();
    try {
      const products = await fetchProductByBarcodeOdoo(code);
      if (products && products.length > 0) {
        navigation.navigate('ProductDetail', { detail: products[0] });
      } else {
        showToastMessage('No Products found for this Barcode');
      }
    } catch (error) {
      showToastMessage(`Error fetching product: ${error.message}`);
    } finally {
      stopLoading();
    }
  };

  // ─── Sections ─────────────────────────────────────────────
  const sections = [
    {
      title: 'Products',
      items: [
        { title: 'Search Products', image: require('@assets/images/Home/options/search_product.png'), onPress: () => navigation.navigate('Products') },
        { title: 'Scan Barcode', image: require('@assets/images/Home/options/scan_barcode.png'), onPress: () => navigation.navigate('Scanner') },
        { title: 'Add Product', iconName: 'add-box', iconColor: '#9C27B0', onPress: () => navigation.navigate('ProductCreationForm') },
        { title: 'Product Enquiry', image: require('@assets/images/Home/options/product_enquiry.png'), onPress: () => navigation.navigate('PriceEnquiryScreen') },
      ],
    },
    {
      title: 'Sales & Purchase',
      items: [
        { title: 'Sales Order', image: require('@assets/images/Home/options/buy.png'), onPress: () => navigation.navigate('SalesOrderChoice') },
        { title: 'Purchase', image: require('@assets/images/Home/options/PurchaseOrder.png'), onPress: () => navigation.navigate('PurchaseListScreen') },
        { title: 'Purchases', image: require('@assets/images/Home/options/product_purchase_requisition.png'), onPress: () => navigation.navigate('PurchasesScreen') },
        { title: 'Easy Sales', image: require('@assets/images/Home/options/payment.png'), onPress: () => navigation.navigate('EasySalesListScreen') },
        { title: 'Easy Purchase', image: require('@assets/images/Home/options/bill.png'), onPress: () => navigation.navigate('EasyPurchaseListScreen') },
        { title: 'Estimate Sale', image: require('@assets/images/Home/options/price_enquiry.png'), onPress: () => navigation.navigate('EstimateSaleListScreen') },
        { title: 'Estimate Purchase', image: require('@assets/images/Home/options/DeliveryNote.png'), onPress: () => navigation.navigate('EstimatePurchaseListScreen') },
        { title: 'Purchase Return', image: require('@assets/images/Home/options/supplierPayment.png'), onPress: () => navigation.navigate('QuickPurchaseReturnListScreen') },
        { title: 'Sales Return', image: require('@assets/images/Home/options/market_study.png'), onPress: () => navigation.navigate('QuickSalesReturnListScreen') },
        { title: 'Cost Protection', image: require('@assets/images/Home/options/box_inspection.png'), onPress: () => navigation.navigate('SaleCostApprovalLogsScreen') },
        { title: 'Register Payment', image: require('@assets/images/Home/options/transaction_auditing.png'), onPress: () => navigation.navigate('RegisterPaymentScreen') },
      ],
    },
    {
      title: 'Customers & Contacts',
      items: [
        { title: 'Customers', image: require('@assets/images/Home/options/customer_visit.png'), onPress: () => navigation.navigate('CustomersPage1Screen') },
        { title: 'Contacts', image: require('@assets/icons/bottom_tabs/profile.png'), onPress: () => setShowContacts(true) },
        { title: 'WhatsApp', image: require('@assets/icons/common/watsapp.png'), onPress: () => navigation.navigate('WhatsAppScreen') },
        { title: 'CRM', image: require('@assets/images/Home/options/crm.png'), onPress: () => navigation.navigate('CRM') },
      ],
    },
    {
      title: 'Inventory',
      items: [
        { title: 'Stock Transfer', image: require('@assets/images/Home/options/inventory_management_1.png'), onPress: () => navigation.navigate('StockTransferScreen') },
        { title: 'Inventory Management', image: require('@assets/images/Home/section/spare.png'), onPress: () => navigation.navigate('InventoryScreen') },
        { title: 'Spare Management', image: require('@assets/images/Home/options/inventory_management.png'), onPress: () => navigation.navigate('SpareManagementScreen') },
        { title: 'Box Inspection', image: require('@assets/images/Home/section/spare_parts.png'), onPress: () => setIsConfirmationModalVisible(true) },
      ],
    },
    {
      title: 'Reports & Finance',
      items: [
        { title: 'Gross Profit', image: require('@assets/images/Home/options/crm/pipeline.png'), onPress: () => navigation.navigate('GrossProfitReportScreen') },
        { title: 'Partner Ledger', image: require('@assets/images/Home/options/crm/lead.png'), onPress: () => navigation.navigate('PartnerLedgerScreen') },
        { title: 'Credit Management', image: require('@assets/images/Home/options/crm/enquiry_register.png'), onPress: () => navigation.navigate('CreditManagementScreen') },
        { title: 'Transaction Auditing', image: require('@assets/images/Home/options/transaction_auditing.png'), onPress: () => navigation.navigate('AuditScreen') },
      ],
    },
    {
      title: 'HR & Tracking',
      items: [
        { title: 'User Attendance', image: require('@assets/images/Home/options/attendance.png'), onPress: () => navigation.navigate('UserAttendanceScreen') },
        { title: 'Late Records', image: require('@assets/images/Home/options/attendance/punching.png'), onPress: () => navigation.navigate('LateRecordsScreen') },
        isAdmin
          ? { title: 'Staff Tracking', image: require('@assets/images/Home/options/attendance/dashboard.png'), onPress: () => navigation.navigate('StaffTrackingScreen') }
          : { title: 'My Location', image: require('@assets/images/Home/section/services.png'), onPress: () => navigation.navigate('MyLocation') },
        { title: 'Vehicle Tracking', image: require('@assets/images/Home/section/pickup.png'), onPress: () => navigation.navigate('VehicleTrackingScreen') },
        { title: 'Vehicle Maintenance', image: require('@assets/images/Home/section/service.png'), onPress: () => navigation.navigate('VehicleMaintenanceScreen') },
        { title: 'Vehicle Location', image: require('@assets/images/Home/section/services.png'), onPress: () => navigation.navigate('VehicleLocationScreen') },
        { title: 'Visits Plan', image: require('@assets/images/Home/options/visits_plan.png'), onPress: () => navigation.navigate('VisitsPlanScreen') },
        { title: 'Customer Visits', image: require('@assets/images/Home/options/attendance/attendance_requests.png'), onPress: () => navigation.navigate('VisitScreen') },
        { title: 'User Guide', iconName: 'menu-book', iconColor: '#2E294E', onPress: () => navigation.navigate('UserGuideScreen') },
      ],
    },
    {
      title: 'Other',
      items: [
        { title: 'Services', image: require('@assets/images/Home/section/quick_service.png'), onPress: () => navigation.navigate('ServicesScreen') },
        { title: 'Offline Sync', image: require('@assets/images/Home/section/spare_parts_request.png'), onPress: () => navigation.navigate('OfflineSyncScreen') },
        { title: 'Task Manager', image: require('@assets/images/Home/options/tasK_manager_1.png'), onPress: () => navigation.navigate('TaskManagerScreen') },
        { title: 'Market Study', image: require('@assets/images/Home/options/market_study_1.png'), onPress: () => navigation.navigate('MarketStudyScreen') },
        { title: 'Mobile Repair', image: require('@assets/images/Home/options/task_manager.png'), onPress: () => navigation.navigate('MobileRepairDashboard') },
        ...(isAdmin ? [{ title: 'Banner Management', image: require('@assets/images/Home/section/spare.png'), onPress: () => navigation.navigate('BannerManagementScreen') }] : []),
      ],
    },
  ];

  // Render a 3-column grid per section using a non-scrolling FlatList
  // (same numColumns=3 as the old flat layout, so ListItem's flex:1 works).
  const renderGrid = (items) => (
    <FlatList
      data={formatData(items, 3)}
      numColumns={3}
      scrollEnabled={false}
      keyExtractor={(item, i) => (item.title || 'empty') + i}
      renderItem={({ item }) =>
        item.empty
          ? <EmptyItem />
          : <ListItem title={item.title} image={item.image} iconName={item.iconName} iconColor={item.iconColor} onPress={item.onPress} />
      }
    />
  );

  const handleBoxInspectionStart = async () => {
    setIsLoading(true);
    try {
      const boxInspectionGroupingData = {
        start_date_time: new Date(),
        sales_person_id: currentUser.related_profile?._id || null,
        warehouse_id: currentUser.warehouse?.warehouse_id || null,
      };
      const response = await post('/createBoxInspectionGrouping', boxInspectionGroupingData);
      if (response.success) {
        navigation.navigate('BoxInspectionScreen', { groupId: response?.data?._id })
      }
    } catch (error) {
      console.log('API Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView backgroundColor={COLORS.primaryThemeColor}>
      <NavigationHeader
        title="Options"
        onBackPress={() => navigation.goBack()}
      />
      <RoundedContainer backgroundColor={'#f5f5f5'}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 10, paddingBottom: 100 }}>
          {sections.map((section) => (
            <View key={section.title} style={sectionStyles.section}>
              <Text style={sectionStyles.title}>{section.title}</Text>
              {renderGrid(section.items)}
            </View>
          ))}
        </ScrollView>
        <OverlayLoader visible={loading || isLoading} />
      </RoundedContainer>

      <ContactsSheet visible={showContacts} onClose={() => setShowContacts(false)} />

      <ConfirmationModal
        onCancel={() => setIsConfirmationModalVisible(false)}
        isVisible={isConfirmationModalVisible}
        onConfirm={() => {
          handleBoxInspectionStart();
          setIsConfirmationModalVisible(false);
        }}
        headerMessage='Are you sure that you want to start Box Inspection?'
      />
    </SafeAreaView>
  );
};

const sectionStyles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  title: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#2e2a4f',
    marginBottom: 8,
    marginLeft: 4,
  },
});

export default OptionsScreen;
