// src/navigation/StackNavigator.js

import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AppNavigator from "./AppNavigator";
import { ProductsScreen, SplashScreen } from "@screens";
import { OptionsScreen } from "@screens/Home/Options";
import { CustomersPage1Screen, CustomersPage2Screen, CustomerCategoryScreen, LeadsListScreen, CreateCustomerScreen } from "@screens/Home/Options/Customers";
import { VehicleTrackingScreen, VehicleTrackingForm } from "@screens/Home/Options/VehicleTracking";
import { VehicleMaintenanceScreen, VehicleMaintenanceForm } from "@screens/Home/Options/VehicleMaintenance";
import { StaffTrackingScreen, StaffTrackingForm, StaffTrackingDetails, UserLiveLocation, MyLocation } from "@screens/Home/Options/StaffTracking";

import { TaskManagerScreen } from "@screens/Home/Options/TaskManager";
import { AuditDetails, AuditForm, AuditScreen } from "@screens/Home/Options/Audit";
import { PrivacyPolicy } from "@screens/Auth";
import LoginScreenOdoo from "@screens/Auth/LoginScreenOdoo";
import CategoriesScreen from "@screens";
import Scanner from "@components/Scanner";
// import Barcode from "@components/Scanner"; // Uncomment and fix if Barcode is a named export or separate file
import SalesOrderChoice from "@screens/Home/Sections/Customer/SalesOrderChoice";
import POSRegister from "@screens/Home/Sections/Customer/POSRegister";
import POSOpenAmount from "@screens/Home/Sections/Customer/POSOpenAmount";
import POSProducts from "@screens/Home/Sections/Customer/POSProducts";
import POSCartSummary from "@screens/Home/Sections/Customer/POSCartSummary";
import POSPayment from "@screens/Home/Sections/Customer/POSPayment";
import { InventoryDetails, InventoryForm, InventoryScreen } from "@screens/Home/Options/Inventory";
import { ProductDetail } from "@components/common/Detail";
import { CustomerDetails, CustomerScreen } from "@screens/Home/Sections/Customer";
import EmployeePickerScreen from "@screens/Home/Sections/Employee/EmployeePickerScreen";
import { MarketStudyScreen } from "@screens/Home/Options/MarketStudy";
import { EditVisitPlan, VisitPlanForm, VisitsPlanScreen, VisitPlanDetails } from "@screens/Home/Options/VisitsPlan";
import { EditVisit, VisitDetails, VisitScreen } from "@screens/Home/Options/Visits"; //customer visit
import { MapViewScreen } from "@components/MapViewScreen";
import { CRMScreen } from "@screens/Home/Options/CRM";
import { EnquiryRegisterForm, EnquiryRegisterScreen } from "@screens/Home/Options/CRM/EnquiryRegister";
import { CustomerFormTabs } from "@screens/Home/Sections/Customer/CustomerFormTabs";
import { EditLead, LeadForm, LeadScreen } from "@screens/Home/Options/CRM/Leads";
import { EnquiryDetailTabs } from "@screens/Home/Options/CRM/EnquiryRegister/EnquiryDetailTabs";
import { LeadDetailTabs } from "@screens/Home/Options/CRM/Leads/LeadDetailTabs";
import { EditPipeline, PipelineForm, PipelineScreen } from "@screens/Home/Options/CRM/Pipeline";
import { PipelineDetailTabs } from "@screens/Home/Options/CRM/Pipeline/PipelineDetailTabs";
import { BoxInspectionForm, BoxInspectionScreen } from "@screens/Home/Options/BoxInspection";
import { AttendanceScreen } from "@screens/Home/Options/Attendance";
import { MarkAttendance, PunchingScreen } from "@screens/Home/Options/Attendance/Punching";
import { CashCollectionScreen, CashCollectionForm } from "@screens/Home/Options/CashCollection";
import { UserAttendanceScreen, UserAttendanceForm } from "@screens/Home/Options/UserAttendance";
import { LateRecordsScreen } from "@screens/Home/Options/LateRecords";
import { OfflineSyncScreen } from "@screens/Home/Options/OfflineSync";
import { InvoiceScannerScreen, InvoiceDetailsScreen } from "@screens/Home/Options/InvoiceScanner";
import { AddParticipants, KPIActionDetails, KPIDashboardScreen, KPIListingScreen } from "@screens/KPIDashboard";
import { ServicesScreen } from "@screens/Home/Sections/Services";
import { ServiceScreens } from "@screens/Home/Sections/Services/Service";
import { SparePartsIssueCreation, SparePartsRequestDetails, SparePartsRequestScreen } from "@screens/Home/Sections/Services/SpareManagements/SparePartsRequest";
import { AddSpareParts, QuickServiceDetails, QuickServiceScreen, QuickServiceUpdateDetails } from "@screens/Home/Sections/Services/Service/QuickService";
import { SpareManagementsScreen } from "@screens/Home/Sections/Services/SpareManagements";
import { QuickServiceFormTabs } from "@screens/Home/Sections/Services/Service/QuickService/QuickServiceFormTabs";
import { EditPickupDetails, PickupDetails, PickupScreen } from "@screens/Home/Sections/Services/Service/Pickup";
import VisitForm from "@screens/Home/Options/Visits/VisitForm";
import { PurchasesScreen } from "@screens/Home/Options/Purchases";
import { AddPriceLines, EditPriceEnquiryDetails, PriceEnquiryDetails, PriceEnquiryForm, PriceEnquiryScreen } from "@screens/Home/Options/Purchases/PriceEnquiry";
import { AddProductLines, EditPurchaseRequisitionDetails, PurchaseRequisitionDetails, PurchaseRequisitionForm, PurchaseRequisitionScreen } from "@screens/Home/Options/Purchases/PurchaseRequisition";
import { AddEditPurchaseLines, AddPurchaseLines, EditPurchaseLines, EditPurchaseOrderDetails, PurchaseOrderDetails, PurchaseOrderForm, PurchaseOrderScreen } from "@screens/Home/Options/Purchases/PurchaseOrder";
import { DeliveryNoteCreation, DeliveryNoteDetails, DeliveryNoteScreen } from "@screens/Home/Options/Purchases/DeliveryNote";
import { VendorBillDetails, VendorBillScreen } from "@screens/Home/Options/Purchases/VendorBill";
import { AddVendorProducts, VendorBillFormTabs } from "@screens/Home/Options/Purchases/VendorBill/VendorBillFormTabs";
import { SupplierPaymentCreation, SupplierPaymentScreen } from "@screens/Home/Options/Purchases/SupplierPayment";
import PurchaseListScreen from "@screens/Home/Options/Purchase/PurchaseListScreen";
import EasyPurchaseListScreen from "@screens/Home/Options/EasyPurchase/EasyPurchaseListScreen";
import EasyPurchaseDetailScreen from "@screens/Home/Options/EasyPurchase/EasyPurchaseDetailScreen";
import EasyPurchaseForm from "@screens/Home/Options/EasyPurchase/EasyPurchaseForm";
import PurchaseDetailScreen from "@screens/Home/Options/Purchase/PurchaseDetailScreen";
import PurchaseFormScreen from "@screens/Home/Options/Purchase/PurchaseFormScreen";
import POSReceiptScreen from '@screens/Home/Sections/Customer/POSReceiptScreen';
import DirectInvoiceScreen from '@screens/Home/Sections/Customer/DirectInvoiceScreen';
import { PaymentForm, RegisterPaymentScreen, PaymentDetailScreen } from '@screens/Home/Options/Payment';
import { SpareManagementScreen, SpareRequestListScreen, SpareRequestForm, SpareRequestDetails, SpareIssueListScreen, SpareIssueForm, SpareReturnListScreen, SpareReturnForm } from '@screens/Home/Options/SpareManagement';
import { EasySalesForm, EasySalesListScreen, EasySalesDetailScreen } from '@screens/Home/Options/EasySales';
import { StockTransferScreen, StockTransferForm, StockTransferDetails } from '@screens/Home/Options/StockTransfer';
import { EstimatePurchaseListScreen, EstimatePurchaseDetailScreen, EstimatePurchaseForm } from '@screens/Home/Options/EstimatePurchase';
import { QuickPurchaseReturnListScreen, QuickPurchaseReturnDetailScreen, QuickPurchaseReturnForm } from '@screens/Home/Options/QuickPurchaseReturn';
import { QuickSalesReturnListScreen, QuickSalesReturnDetailScreen, QuickSalesReturnForm } from '@screens/Home/Options/QuickSalesReturn';
import { EstimateSaleListScreen, EstimateSaleDetailScreen, EstimateSaleForm } from '@screens/Home/Options/EstimateSale';
import { SaleOrderListScreen, SaleOrderDetailScreen } from '@screens/Home/Options/SalesOrder';
import SalesInvoiceReceiptScreen from '@screens/Home/Options/SalesOrder/SalesInvoiceReceiptScreen';
import { MobileRepairDashboard, MobileRepairScreen, MobileRepairForm, MobileRepairDetails, DiagnosisListScreen, RepairStepsListScreen, RepairStepDetailScreen, ProductListScreen } from '@screens/Home/Options/MobileRepair';
import { BannerManagementScreen } from '@screens/Home/Options/BannerManagement';
import { GrossProfitReportScreen } from '@screens/Home/Options/GrossProfitReport';
import { PartnerLedgerScreen } from '@screens/Home/Options/PartnerLedger';
import { CreditManagementScreen, CreditApplicationsScreen, CreditExceededScreen, CreditRiskHistoryScreen, CreditFacilityForm, CreditFacilityDetailScreen } from '@screens/Home/Options/CreditManagement';
import { WhatsAppScreen } from '@screens/Home/Options/WhatsApp';
import { ProductCreationForm, ProductEditForm } from '@screens/Home/Options/ProductCreation';
import SaleCostApprovalLogsScreen from '@screens/Home/Options/SaleCostProtection/SaleCostApprovalLogsScreen';

const Stack = createNativeStackNavigator();

const StackNavigator = () => {
  return (
    <Stack.Navigator initialRouteName="Splash">
      <Stack.Screen
        name="SalesOrderChoice"
        component={SalesOrderChoice}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSRegister"
        component={POSRegister}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSOpenAmount"
        component={POSOpenAmount}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSProducts"
        component={POSProducts}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSCartSummary"
        component={POSCartSummary}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSPayment"
        component={POSPayment}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="POSReceiptScreen"
        component={POSReceiptScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DirectInvoiceScreen"
        component={DirectInvoiceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SaleOrderListScreen"
        component={SaleOrderListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SaleOrderDetailScreen"
        component={SaleOrderDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SalesInvoiceReceiptScreen"
        component={SalesInvoiceReceiptScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EasySalesListScreen"
        component={EasySalesListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EasySalesDetailScreen"
        component={EasySalesDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EasySalesForm"
        component={EasySalesForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RegisterPaymentScreen"
        component={RegisterPaymentScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PaymentForm"
        component={PaymentForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PaymentDetailScreen"
        component={PaymentDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareManagementScreen"
        component={SpareManagementScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareRequestForm"
        component={SpareRequestForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareRequestListScreen"
        component={SpareRequestListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareRequestDetails"
        component={SpareRequestDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareIssueListScreen"
        component={SpareIssueListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareIssueForm"
        component={SpareIssueForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareReturnListScreen"
        component={SpareReturnListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareReturnForm"
        component={SpareReturnForm}
        options={{ headerShown: false }}
      />
      {/* Splash Screen */}
      <Stack.Screen
        name="Splash"
        component={SplashScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Scanner"
        component={Scanner}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceScannerScreen"
        component={InvoiceScannerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="InvoiceDetailsScreen"
        component={InvoiceDetailsScreen}
        options={{ headerShown: false }}
      />


    

      <Stack.Screen
        name="MapViewScreen"
        component={MapViewScreen}
        options={{ headerShown: false }}
      />
      {/* Login Screen */}
      <Stack.Screen
        name="LoginScreenOdoo"
        component={LoginScreenOdoo}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="PrivacyPolicy"
        component={PrivacyPolicy}
        options={{ headerShown: false, animation: 'fade' }}
      />
      {/* App Navigator - Bottom Tabs */}
      <Stack.Screen
        name="AppNavigator"
        component={AppNavigator}
        options={{ headerShown: false }}
      />
      {/* Options Screen */}
      <Stack.Screen
        name="OptionsScreen"
        component={OptionsScreen}
        options={{ headerShown: false }}
      />
      {/* Vehicle Tracking Screen */}
      <Stack.Screen
        name="VehicleTrackingScreen"
        component={VehicleTrackingScreen}
        options={{ headerShown: false }}
      />
      {/* Vehicle Tracking Form */}
      <Stack.Screen
        name="VehicleTrackingForm"
        component={VehicleTrackingForm}
        options={{ headerShown: false }}
      />

      {/* Vehicle Maintenance */}
      <Stack.Screen
        name="VehicleMaintenanceScreen"
        component={VehicleMaintenanceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VehicleMaintenanceForm"
        component={VehicleMaintenanceForm}
        options={{ headerShown: false }}
      />

      {/* Staff Tracking */}
      <Stack.Screen
        name="StaffTrackingScreen"
        component={StaffTrackingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StaffTrackingForm"
        component={StaffTrackingForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StaffTrackingDetails"
        component={StaffTrackingDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="UserLiveLocation"
        component={UserLiveLocation}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MyLocation"
        component={MyLocation}
        options={{ headerShown: false }}
      />

      {/* Late Records */}
      <Stack.Screen
        name="LateRecordsScreen"
        component={LateRecordsScreen}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="OfflineSyncScreen"
        component={OfflineSyncScreen}
        options={{ headerShown: false }}
      />

      {/* Audit Screen */}
      <Stack.Screen
        name="AuditScreen"
        component={AuditScreen}
        options={{ headerShown: false }}
      />
      {/* Audit Form */}
      <Stack.Screen
        name="AuditForm"
        component={AuditForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AuditDetails"
        component={AuditDetails}
        options={{ headerShown: false }}
      />

      {/* Stock Transfer */}
      <Stack.Screen
        name="StockTransferScreen"
        component={StockTransferScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StockTransferForm"
        component={StockTransferForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="StockTransferDetails"
        component={StockTransferDetails}
        options={{ headerShown: false }}
      />

      {/* Estimate Purchase */}
      <Stack.Screen
        name="EstimatePurchaseListScreen"
        component={EstimatePurchaseListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EstimatePurchaseDetailScreen"
        component={EstimatePurchaseDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EstimatePurchaseForm"
        component={EstimatePurchaseForm}
        options={{ headerShown: false }}
      />

      {/* Quick Purchase Return */}
      <Stack.Screen
        name="QuickPurchaseReturnListScreen"
        component={QuickPurchaseReturnListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickPurchaseReturnDetailScreen"
        component={QuickPurchaseReturnDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickPurchaseReturnForm"
        component={QuickPurchaseReturnForm}
        options={{ headerShown: false }}
      />

      {/* Quick Sales Return */}
      <Stack.Screen
        name="QuickSalesReturnListScreen"
        component={QuickSalesReturnListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickSalesReturnDetailScreen"
        component={QuickSalesReturnDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickSalesReturnForm"
        component={QuickSalesReturnForm}
        options={{ headerShown: false }}
      />

      {/* Estimate Sale */}
      <Stack.Screen name="EstimateSaleListScreen" component={EstimateSaleListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EstimateSaleDetailScreen" component={EstimateSaleDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EstimateSaleForm" component={EstimateSaleForm} options={{ headerShown: false }} />

      {/* Gross Profit Report */}
      <Stack.Screen name="GrossProfitReportScreen" component={GrossProfitReportScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PartnerLedgerScreen" component={PartnerLedgerScreen} options={{ headerShown: false }} />

      {/* Credit Management */}
      <Stack.Screen name="CreditManagementScreen" component={CreditManagementScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CreditApplicationsScreen" component={CreditApplicationsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CreditExceededScreen" component={CreditExceededScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CreditRiskHistoryScreen" component={CreditRiskHistoryScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CreditFacilityForm" component={CreditFacilityForm} options={{ headerShown: false }} />
      <Stack.Screen name="CreditFacilityDetailScreen" component={CreditFacilityDetailScreen} options={{ headerShown: false }} />

      <Stack.Screen name="WhatsAppScreen" component={WhatsAppScreen} options={{ headerShown: false }} />

      {/* Inventory Screen */}
      <Stack.Screen
        name="InventoryScreen"
        component={InventoryScreen}
        options={{ headerShown: false }}
      />
      {/* Inventory Details */}
      <Stack.Screen
        name="InventoryDetails"
        component={InventoryDetails}
        options={{ headerShown: false }}
      />
      {/* Inventory Form */}
      <Stack.Screen
        name="InventoryForm"
        component={InventoryForm}
        options={{ headerShown: false }}
      />

      <Stack.Screen
        name="TaskManagerScreen"
        component={TaskManagerScreen}
        options={{ headerShown: false }}
      />
      {/* Products */}
      <Stack.Screen
        name="Products"
        component={ProductsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProductDetail"
        component={ProductDetail}
        options={{ headerShown: false }}
      />
      {/* Customers */}
      <Stack.Screen
        name="CustomerScreen"
        component={CustomerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EmployeePickerScreen"
        component={EmployeePickerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomersPage1Screen"
        component={CustomersPage1Screen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomersPage2Screen"
        component={CustomersPage2Screen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerCategoryScreen"
        component={CustomerCategoryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LeadsListScreen"
        component={LeadsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CreateCustomerScreen"
        component={CreateCustomerScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerDetails"
        component={CustomerDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CustomerFormTabs"
        component={CustomerFormTabs}
        options={{ headerShown: false }}
      />

      {/* Service */}
      <Stack.Screen
        name="ServiceScreens"
        component={ServiceScreens}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceUpdateDetails"
        component={QuickServiceUpdateDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddSpareParts"
        component={AddSpareParts}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceDetails"
        component={QuickServiceDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ServicesScreen"
        component={ServicesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceScreen"
        component={QuickServiceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="QuickServiceFormTabs"
        component={QuickServiceFormTabs}
        options={{ headerShown: false }}
      />

      {/* Spare Managements */}
      <Stack.Screen
        name="SparePartsRequestScreen"
        component={SparePartsRequestScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SpareManagementsScreen"
        component={SpareManagementsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SparePartsIssueCreation"
        component={SparePartsIssueCreation}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SparePartsRequestDetails"
        component={SparePartsRequestDetails}
        options={{ headerShown: false }}
      />

      {/* Market Study */}
      <Stack.Screen
        name="MarketStudyScreen"
        component={MarketStudyScreen}
        options={{ headerShown: false }}
      />

      {/* Visits Plan */}
      <Stack.Screen
        name="VisitsPlanScreen"
        component={VisitsPlanScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitPlanForm"
        component={VisitPlanForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitPlanDetails"
        component={VisitPlanDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditVisitPlan"
        component={EditVisitPlan}
        options={{ headerShown: false }}
      />

      {/* Customer Visits */}
      <Stack.Screen
        name="VisitScreen"
        component={VisitScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitForm"
        component={VisitForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VisitDetails"
        component={VisitDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditVisit"
        component={EditVisit}
        options={{ headerShown: false }}
      />

      {/* CRM */}
      <Stack.Screen
        name="CRM"
        component={CRMScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EnquiryRegisterScreen"
        component={EnquiryRegisterScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EnquiryRegisterForm"
        component={EnquiryRegisterForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EnquiryDetailTabs"
        component={EnquiryDetailTabs}
        options={{ headerShown: false }}
      />

      {/* Leads */}
      <Stack.Screen
        name="LeadScreen"
        component={LeadScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LeadForm"
        component={LeadForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="LeadDetailTabs"
        component={LeadDetailTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditLead"
        component={EditLead}
        options={{ headerShown: false }}
      />

      {/* Pipeline */}
      <Stack.Screen
        name="PipelineScreen"
        component={PipelineScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PipelineForm"
        component={PipelineForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PipelineDetailTabs"
        component={PipelineDetailTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPipeline"
        component={EditPipeline}
        options={{ headerShown: false }}
      />

      {/* Pickup */}
      <Stack.Screen
        name="PickupScreen"
        component={PickupScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PickupDetails"
        component={PickupDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPickupDetails"
        component={EditPickupDetails}
        options={{ headerShown: false }}
      />

      {/* BoxInspection */}
      <Stack.Screen
        name="BoxInspectionScreen"
        component={BoxInspectionScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BoxInspectionForm"
        component={BoxInspectionForm}
        options={{ headerShown: false }}
      />

      {/* Attendance */}
      <Stack.Screen
        name="AttendanceScreen"
        component={AttendanceScreen}
        options={{ headerShown: false }}
      />
      {/* Punching */}
      <Stack.Screen
        name="PunchingScreen"
        component={PunchingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MarkAttendance"
        component={MarkAttendance}
        options={{ headerShown: false }}
      />

      {/* Cash Collection */}
      <Stack.Screen
        name="CashCollectionScreen"
        component={CashCollectionScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="CashCollectionForm"
        component={CashCollectionForm}
        options={{ headerShown: false }}
      />

      {/* User Attendance */}
      <Stack.Screen
        name="UserAttendanceScreen"
        component={UserAttendanceScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="UserAttendanceForm"
        component={UserAttendanceForm}
        options={{ headerShown: false }}
      />

      {/* KPI */}
      <Stack.Screen
        name="KPIListingScreen"
        component={KPIListingScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="KPIDashboardScreen"
        component={KPIDashboardScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="KPIActionDetails"
        component={KPIActionDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddParticipants"
        component={AddParticipants}
        options={{ headerShown: false }}
      />

      {/* Purchase (Odoo-parity RFQ / Purchase Order) */}
      <Stack.Screen
        name="PurchaseListScreen"
        component={PurchaseListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseDetailScreen"
        component={PurchaseDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseFormScreen"
        component={PurchaseFormScreen}
        options={{ headerShown: false }}
      />

      {/* Easy Purchase */}
      <Stack.Screen name="EasyPurchaseListScreen" component={EasyPurchaseListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EasyPurchaseDetailScreen" component={EasyPurchaseDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="EasyPurchaseForm" component={EasyPurchaseForm} options={{ headerShown: false }} />

      {/* Purchases */}
      <Stack.Screen
        name="PurchasesScreen"
        component={PurchasesScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseRequisitionForm"
        component={PurchaseRequisitionForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseRequisitionScreen"
        component={PurchaseRequisitionScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseRequisitionDetails"
        component={PurchaseRequisitionDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPurchaseRequisitionDetails"
        component={EditPurchaseRequisitionDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddProductLines"
        component={AddProductLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PriceEnquiryForm"
        component={PriceEnquiryForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PriceEnquiryScreen"
        component={PriceEnquiryScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PriceEnquiryDetails"
        component={PriceEnquiryDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPriceEnquiryDetails"
        component={EditPriceEnquiryDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddPriceLines"
        component={AddPriceLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseOrderDetails"
        component={PurchaseOrderDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPurchaseOrderDetails"
        component={EditPurchaseOrderDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseOrderForm"
        component={PurchaseOrderForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="PurchaseOrderScreen"
        component={PurchaseOrderScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddPurchaseLines"
        component={AddPurchaseLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddEditPurchaseLines"
        component={AddEditPurchaseLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="EditPurchaseLines"
        component={EditPurchaseLines}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNoteScreen"
        component={DeliveryNoteScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNoteCreation"
        component={DeliveryNoteCreation}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DeliveryNoteDetails"
        component={DeliveryNoteDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendorBillScreen"
        component={VendorBillScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendorBillDetails"
        component={VendorBillDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="VendorBillFormTabs"
        component={VendorBillFormTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="AddVendorProducts"
        component={AddVendorProducts}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SupplierPaymentScreen"
        component={SupplierPaymentScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SupplierPaymentCreation"
        component={SupplierPaymentCreation}
        options={{ headerShown: false }}
      />

      {/* Mobile Repair */}
      <Stack.Screen
        name="MobileRepairDashboard"
        component={MobileRepairDashboard}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MobileRepairScreen"
        component={MobileRepairScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MobileRepairForm"
        component={MobileRepairForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="MobileRepairDetails"
        component={MobileRepairDetails}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="DiagnosisListScreen"
        component={DiagnosisListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RepairStepsListScreen"
        component={RepairStepsListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RepairStepDetailScreen"
        component={RepairStepDetailScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProductListScreen"
        component={ProductListScreen}
        options={{ headerShown: false }}
      />

      {/* Banner Management */}
      <Stack.Screen
        name="BannerManagementScreen"
        component={BannerManagementScreen}
        options={{ headerShown: false }}
      />

      {/* Product Creation */}
      <Stack.Screen
        name="ProductCreationForm"
        component={ProductCreationForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="ProductEditForm"
        component={ProductEditForm}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="SaleCostApprovalLogsScreen"
        component={SaleCostApprovalLogsScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
};

export default StackNavigator;
