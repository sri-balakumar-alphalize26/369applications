import React, { useState, useEffect, useRef } from 'react';
import {
  View, ScrollView, StyleSheet, Pressable, Modal, FlatList,
  TouchableOpacity, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import SignatureScreen from 'react-native-signature-canvas';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NavigationHeader } from '@components/Header';
import { SafeAreaView } from '@components/containers';
import OfflineBanner from '@components/common/OfflineBanner';
import StyledAlertModal from '@components/Modal/StyledAlertModal';
import { TextInput as FormInput } from '@components/common/TextInput';
import { LoadingButton } from '@components/common/Button';
import Text from '@components/Text';
import DateTimePickerModal from 'react-native-modal-datetime-picker';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { formatDate } from '@utils/common/date';
import { showToastMessage } from '@components/Toast';
import { OverlayLoader } from '@components/Loader';
import {
  fetchVehiclesForMaintenanceOdoo,
  fetchPartnersOdoo,
  createVehicleMaintenanceOdoo,
  fetchMaintenanceTypesOdoo,
  validateVehicleMaintenanceOdoo,
} from '@api/services/generalApi';
import { useAuthStore } from '@stores/auth';

const VehicleMaintenanceForm = ({ navigation, route }) => {
  const existingData = route?.params?.maintenanceData || null;
  const isEditMode = !!existingData?.id;

  const [formData, setFormData] = useState({
    date: existingData?.date ? new Date(existingData.date) : new Date(),
    vehicle_id: existingData?.vehicle_id || null,
    vehicleName: existingData?.vehicle_name || '',
    driver_id: existingData?.driver_id || null,
    driverName: existingData?.driver_name || '',
    numberPlate: existingData?.number_plate || '',
    maintenance_type_id: existingData?.maintenance_type_id || null,
    maintenanceTypeName: existingData?.maintenance_type_name || '',
    handover_to_partner_id: existingData?.handover_to_partner_id || null,
    handoverToPartnerName: existingData?.handover_to_partner_name || '',
    currentKm: existingData?.current_km ? String(existingData.current_km) : '',
    amount: existingData?.amount ? String(existingData.amount) : '',
    handoverFromUri: existingData?.handover_from || '',
    handoverToUri: existingData?.handover_to || '',
    imageUri: existingData?.image_url || '',
    remarks: existingData?.remarks || '',
  });

  const isHandover = (formData.maintenanceTypeName || '').toLowerCase().includes('hand over');

  const [dropdowns, setDropdowns] = useState({
    vehicles: [],
    maintenanceTypes: [],
    partners: [],
  });
  const [modals, setModals] = useState({
    vehicle: false,
    maintenanceType: false,
    handoverToPartner: false,
    datePicker: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signatureModal, setSignatureModal] = useState({ visible: false, field: null });
  const [previewImageUri, setPreviewImageUri] = useState(null);
  const [imagePickerVisible, setImagePickerVisible] = useState(false);
  const [showInAppCamera, setShowInAppCamera] = useState(false);
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const inAppCameraRef = useRef(null);
  const signatureRef = useRef(null);

  // Validate-confirm popup state for the admin Validate button.
  const [validateModalVisible, setValidateModalVisible] = useState(false);
  const [recordState, setRecordState] = useState({
    is_validated: !!existingData?.is_validated,
    validated_by: existingData?.validated_by || '',
    validation_date: existingData?.validation_date || '',
  });
  const currentUser = useAuthStore((state) => state.user);
  const isAdmin = !!(currentUser?.is_admin || currentUser?.related_profile?.is_admin
    || (Array.isArray(currentUser?.roles) && currentUser.roles.includes('admin')));
  const isLocked = !!recordState.is_validated;

  const handleValidate = async () => {
    if (!existingData?.id || typeof existingData.id !== 'number') {
      showToastMessage('Save the record first before validating');
      setValidateModalVisible(false);
      return;
    }
    setValidateModalVisible(false);
    setLoading(true);
    try {
      await validateVehicleMaintenanceOdoo(existingData.id);
      setRecordState({
        is_validated: true,
        validated_by: currentUser?.name || 'You',
        validation_date: new Date().toISOString().slice(0, 10),
      });
      showToastMessage('Record validated');
    } catch (e) {
      console.log('[VehicleMaintenanceForm] validate failed:', e?.message);
      showToastMessage('Validate failed: ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDropdowns();
  }, []);

  const loadDropdowns = async () => {
    setLoading(true);
    try {
      const [vehicles, maintenanceTypes, partners] = await Promise.all([
        fetchVehiclesForMaintenanceOdoo({ limit: 200 }).catch(() => []),
        fetchMaintenanceTypesOdoo().catch(() => []),
        fetchPartnersOdoo({ limit: 200 }).catch(() => []),
      ]);
      setDropdowns({ vehicles, maintenanceTypes, partners });
    } catch (err) {
      console.error('Failed to load dropdowns:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleVehicleSelect = (vehicle) => {
    setFormData(prev => ({
      ...prev,
      vehicle_id: vehicle.id,
      vehicleName: vehicle.name,
      numberPlate: vehicle.license_plate || '',
      driver_id: vehicle.driver?.id || prev.driver_id,
      driverName: vehicle.driver?.name || prev.driverName,
    }));
    setModals(prev => ({ ...prev, vehicle: false }));
  };

  const handleMaintenanceTypeSelect = (type) => {
    setFormData(prev => ({
      ...prev,
      maintenance_type_id: type.id,
      maintenanceTypeName: type.name,
    }));
    setModals(prev => ({ ...prev, maintenanceType: false }));
  };

  const handleHandoverToPartnerSelect = (vehicle) => {
    setFormData(prev => ({
      ...prev,
      handover_to_partner_id: vehicle.driver?.id || null,
      handoverToPartnerName: vehicle.driver?.name || vehicle.name,
    }));
    setModals(prev => ({ ...prev, handoverToPartner: false }));
  };

  const handleImagePicker = () => setImagePickerVisible(true);

  // Close the branded picker first, then launch the OS picker so the modal
  // fully unmounts before the camera/gallery intent fires (prevents Android crash).
  const dispatchImageSource = (source) => {
    setImagePickerVisible(false);
    setTimeout(() => {
      if (source === 'camera') openCamera();
      else if (source === 'gallery') openGallery();
    }, 300);
  };

  // Opens the inline in-app camera modal (no OS preview screen — matches
  // Customer Visit flow). The OS preview was crashing the app on shutter.
  const openCamera = async () => {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToastMessage('Camera permission is required', 'warning');
        return;
      }
      setShowInAppCamera(true);
    } catch (e) {
      console.error('openCamera permission error:', e);
      showToastMessage('Camera error occurred', 'error');
    }
  };

  const captureFromInAppCamera = async () => {
    if (!inAppCameraRef.current || isCapturingPhoto) return;
    try {
      setIsCapturingPhoto(true);
      const photo = await inAppCameraRef.current.takePictureAsync({
        quality: 0.3,
        skipProcessing: true,
        exif: false,
      });
      setShowInAppCamera(false);
      if (photo?.uri) {
        handleInputChange('imageUri', photo.uri);
        showToastMessage('Image captured successfully!', 'success');
      }
    } catch (e) {
      console.error('takePictureAsync exception:', e);
      showToastMessage('Camera error occurred', 'error');
    } finally {
      setIsCapturingPhoto(false);
    }
  };

  const openGallery = () => {
    (async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          showToastMessage('Media library permission is required', 'warning');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
        });
        if (result?.cancelled || result?.canceled) {
          showToastMessage('Gallery selection cancelled', 'info');
          return;
        }
        const asset = result.assets ? result.assets[0] : (result.uri ? { uri: result.uri } : null);
        if (asset && asset.uri) {
          handleInputChange('imageUri', asset.uri);
          showToastMessage('Image selected successfully!', 'success');
        }
      } catch (e) {
        console.error('Gallery exception:', e);
        showToastMessage('Gallery error occurred', 'error');
      }
    })();
  };

  const handleSignatureOK = (signature) => {
    // signature is "data:image/png;base64,XXXX" — strip prefix for raw base64
    const base64 = signature.replace('data:image/png;base64,', '');
    if (signatureModal.field) {
      handleInputChange(signatureModal.field, base64);
    }
    setSignatureModal({ visible: false, field: null });
  };

  const handleSignatureClear = () => {
    if (signatureRef.current) {
      signatureRef.current.clearSignature();
    }
  };

  const formatDateOdoo = (d) => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${mins}:${secs}`;
  };

  const handleSubmit = async () => {
    if (!formData.vehicle_id) {
      showToastMessage('Please select a vehicle');
      return;
    }
    if (!formData.maintenance_type_id) {
      showToastMessage('Please select a maintenance type');
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        date: formatDateOdoo(formData.date),
        vehicle_id: formData.vehicle_id,
        driver_id: formData.driver_id || undefined,
        number_plate: formData.numberPlate || undefined,
        maintenance_type_id: formData.maintenance_type_id,
        handover_to_partner_id: formData.handover_to_partner_id || undefined,
        current_km: formData.currentKm ? parseFloat(formData.currentKm) : 0,
        amount: formData.amount ? parseFloat(formData.amount) : 0,
        remarks: formData.remarks || undefined,
        handover_from: formData.handoverFromUri || undefined,
        handover_to: formData.handoverToUri || undefined,
        image_url: formData.imageUri || undefined,
      };

      if (isEditMode) {
        payload.id = existingData.id;
      }

      const recordId = await createVehicleMaintenanceOdoo({ payload });
      showToastMessage(isEditMode ? 'Maintenance record updated' : 'Maintenance record created');
      navigation.goBack();
    } catch (error) {
      console.error('Submit error:', error);
      showToastMessage(`Error: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderDropdownModal = (visible, data, onSelect, onClose, title, labelKey = 'name') => (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={styles.brandedOverlay} onPress={onClose}>
        <Pressable style={styles.brandedCard} onPress={() => {}}>
          <View style={styles.brandedLogoWrap}>
            <Image
              source={require('@assets/images/logo/logo.png')}
              style={styles.brandedLogo}
            />
          </View>
          <View style={styles.brandedHeader}>
            <Text style={styles.brandedTitle}>{title}</Text>
            <Pressable hitSlop={10} onPress={onClose}>
              <MaterialCommunityIcons name="close" size={22} color={COLORS.gray} />
            </Pressable>
          </View>
          <FlatList
            data={data}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.modalItem}
                onPress={() => onSelect(item)}
              >
                <Text style={styles.modalItemText}>{item[labelKey] || `ID: ${item.id}`}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <Text style={styles.modalEmptyText}>No items found</Text>
            }
          />
        </Pressable>
      </Pressable>
    </Modal>
  );

  return (
    <SafeAreaView backgroundColor={COLORS.white}>
      <NavigationHeader
        title={isEditMode ? 'Edit Maintenance' : 'New Maintenance'}
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={() => navigation.goBack()}
      />
      <OfflineBanner message="OFFLINE — new maintenance records will sync when online" />

      {/* Reference + validation header — only when editing an existing record */}
      {isEditMode && (existingData?.ref || existingData?.offline_label || recordState.is_validated) ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 14, paddingVertical: 10,
          backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
        }}>
          <View style={{ flex: 1 }}>
            {existingData?.ref ? (
              <Text style={{ color: COLORS.primaryThemeColor, fontFamily: FONT_FAMILY.urbanistBold, fontSize: 13 }}>
                {existingData.ref}
              </Text>
            ) : null}
            {existingData?.offline_label && existingData.offline_label !== existingData.ref ? (
              <Text style={{ color: '#888', fontFamily: FONT_FAMILY.urbanistMedium, fontSize: 11 }}>
                Offline ref: {existingData.offline_label}
              </Text>
            ) : null}
            {recordState.is_validated ? (
              <Text style={{ color: '#666', fontFamily: FONT_FAMILY.urbanistMedium, fontSize: 11, marginTop: 2 }}>
                Validated by {recordState.validated_by || '-'}{recordState.validation_date ? ' on ' + recordState.validation_date : ''} — locked for editing
              </Text>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{
              paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
              backgroundColor: recordState.is_validated ? '#4CAF50' : '#FF9800',
              marginRight: 8,
            }}>
              <Text style={{ color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 10, letterSpacing: 0.5 }}>
                {recordState.is_validated ? 'VALIDATED' : 'PENDING'}
              </Text>
            </View>
            {isAdmin && !recordState.is_validated && typeof existingData?.id === 'number' ? (
              <TouchableOpacity
                onPress={() => setValidateModalVisible(true)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 7,
                  backgroundColor: COLORS.primaryThemeColor, borderRadius: 6,
                }}
                activeOpacity={0.8}
              >
                <Text style={{ color: '#fff', fontFamily: FONT_FAMILY.urbanistBold, fontSize: 12 }}>
                  Validate
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Vehicle Information */}
        <Text style={styles.sectionTitle}>Vehicle Information</Text>
        <View style={styles.sectionGroup}>
          {/* Date */}
          <Pressable
            onPress={() => setModals(prev => ({ ...prev, datePicker: true }))}
            disabled={isLocked}
            style={isLocked && { opacity: 0.6 }}
          >
            <FormInput
              label="Date :"
              value={formatDate(formData.date)}
              editable={false}
              pointerEvents="none"
            />
          </Pressable>

          {/* Vehicle */}
          <Text style={styles.fieldLabel}>Vehicle <Text style={{ color: 'red' }}>*</Text></Text>
          <Pressable
            style={[styles.selectBox, isLocked && { opacity: 0.6 }]}
            onPress={() => setModals(prev => ({ ...prev, vehicle: true }))}
            disabled={isLocked}
          >
            <Text style={[styles.selectBoxText, { color: formData.vehicleName ? COLORS.black : COLORS.gray }]}>
              {formData.vehicleName || 'Select vehicle'}
            </Text>
            <Text style={styles.selectBoxChevron}>▼</Text>
          </Pressable>

          {/* Driver */}
          <FormInput
            label="Driver :"
            value={formData.driverName}
            editable={false}
            placeholder="Auto-filled from vehicle"
          />

          {/* Number Plate */}
          <FormInput
            label="Number Plate :"
            value={formData.numberPlate}
            editable={false}
            placeholder="Auto-filled from vehicle"
          />
        </View>

        {/* Maintenance Details */}
        <Text style={styles.sectionTitle}>Maintenance Details</Text>
        <View style={styles.sectionGroup}>
          {/* Maintenance Type */}
          <Text style={styles.fieldLabel}>Maintenance Type <Text style={{ color: 'red' }}>*</Text></Text>
          <Pressable
            style={[styles.selectBox, isLocked && { opacity: 0.6 }]}
            onPress={() => setModals(prev => ({ ...prev, maintenanceType: true }))}
            disabled={isLocked}
          >
            <Text style={[styles.selectBoxText, { color: formData.maintenanceTypeName ? COLORS.black : COLORS.gray }]}>
              {formData.maintenanceTypeName || 'Select maintenance type'}
            </Text>
            <Text style={styles.selectBoxChevron}>▼</Text>
          </Pressable>

          {/* Handover To Partner */}
          <Text style={styles.fieldLabel}>Handover To</Text>
          <Pressable
            style={[styles.selectBox, isLocked && { opacity: 0.6 }]}
            onPress={() => setModals(prev => ({ ...prev, handoverToPartner: true }))}
            disabled={isLocked}
          >
            <Text style={[styles.selectBoxText, { color: formData.handoverToPartnerName ? COLORS.black : COLORS.gray }]}>
              {formData.handoverToPartnerName || 'Select person to hand over to'}
            </Text>
            <Text style={styles.selectBoxChevron}>▼</Text>
          </Pressable>

          {/* Current KM */}
          <FormInput
            label="Current KM :"
            value={formData.currentKm}
            onChangeText={(v) => handleInputChange('currentKm', v)}
            keyboardType="numeric"
            placeholder="0.000"
            editable={!isLocked}
          />

          {/* Amount */}
          <FormInput
            label="Amount :"
            value={formData.amount}
            onChangeText={(v) => handleInputChange('amount', v)}
            keyboardType="numeric"
            placeholder="0.000"
            editable={!isLocked}
          />
        </View>

        {/* Handover Signatures */}
        <Text style={styles.sectionTitle}>Handover Signatures</Text>
        <View style={styles.sectionGroup}>
          {/* Handover From Signature */}
          <View style={styles.signatureSection}>
            <Text style={styles.fieldLabel}>Handover From</Text>
            {formData.handoverFromUri ? (
              <View style={styles.signatureCardFilled}>
                <Image
                  source={{ uri: `data:image/png;base64,${formData.handoverFromUri}` }}
                  style={styles.signaturePreviewImage}
                  resizeMode="contain"
                />
                {!isLocked && (
                  <View style={styles.signatureOverlay}>
                    <Pressable
                      style={[styles.signatureActionBtn, styles.signatureActionBtnReplace]}
                      onPress={() => setSignatureModal({ visible: true, field: 'handoverFromUri' })}
                    >
                      <MaterialCommunityIcons name="draw" size={16} color="#fff" />
                      <Text style={styles.signatureActionText}>Re-sign</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.signatureActionBtn, styles.signatureActionBtnDanger]}
                      onPress={() => handleInputChange('handoverFromUri', '')}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                      <Text style={styles.signatureActionText}>Clear</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : (
              <Pressable
                style={[styles.signatureCardEmpty, isLocked && { opacity: 0.6 }]}
                onPress={() => setSignatureModal({ visible: true, field: 'handoverFromUri' })}
                disabled={isLocked}
              >
                <MaterialCommunityIcons name="signature-freehand" size={36} color={COLORS.primaryThemeColor} />
                <Text style={styles.signatureCardEmptyTitle}>Tap to Sign</Text>
                <Text style={styles.signatureCardEmptySubtitle}>Capture handover signature</Text>
              </Pressable>
            )}
          </View>

          {/* Handover To Signature */}
          <View style={styles.signatureSection}>
            <Text style={styles.fieldLabel}>Handover To</Text>
            {formData.handoverToUri ? (
              <View style={styles.signatureCardFilled}>
                <Image
                  source={{ uri: `data:image/png;base64,${formData.handoverToUri}` }}
                  style={styles.signaturePreviewImage}
                  resizeMode="contain"
                />
                {!isLocked && (
                  <View style={styles.signatureOverlay}>
                    <Pressable
                      style={[styles.signatureActionBtn, styles.signatureActionBtnReplace]}
                      onPress={() => setSignatureModal({ visible: true, field: 'handoverToUri' })}
                    >
                      <MaterialCommunityIcons name="draw" size={16} color="#fff" />
                      <Text style={styles.signatureActionText}>Re-sign</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.signatureActionBtn, styles.signatureActionBtnDanger]}
                      onPress={() => handleInputChange('handoverToUri', '')}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                      <Text style={styles.signatureActionText}>Clear</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : (
              <Pressable
                style={[styles.signatureCardEmpty, isLocked && { opacity: 0.6 }]}
                onPress={() => setSignatureModal({ visible: true, field: 'handoverToUri' })}
                disabled={isLocked}
              >
                <MaterialCommunityIcons name="signature-freehand" size={36} color={COLORS.primaryThemeColor} />
                <Text style={styles.signatureCardEmptyTitle}>Tap to Sign</Text>
                <Text style={styles.signatureCardEmptySubtitle}>Capture handover signature</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Attachment Details */}
        <Text style={styles.sectionTitle}>Attachment Details</Text>
        <View style={styles.sectionGroup}>
          {formData.imageUri ? (
            <View style={styles.imageCardFilled}>
              <Pressable onPress={() => setPreviewImageUri(formData.imageUri)} style={styles.imagePreviewWrap}>
                <Image source={{ uri: formData.imageUri }} style={styles.imagePreview} resizeMode="cover" />
                {!isLocked && (
                  <View style={styles.imageOverlay}>
                    <Pressable
                      style={[styles.imageActionBtn, styles.imageActionBtnReplace]}
                      onPress={handleImagePicker}
                    >
                      <MaterialCommunityIcons name="image-edit" size={16} color="#fff" />
                      <Text style={styles.imageActionText}>Replace</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.imageActionBtn, styles.imageActionBtnDanger]}
                      onPress={() => handleInputChange('imageUri', '')}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={16} color="#fff" />
                      <Text style={styles.imageActionText}>Remove</Text>
                    </Pressable>
                  </View>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handleImagePicker}
              style={[styles.imageCardEmpty, isLocked && { opacity: 0.6 }]}
              disabled={isLocked}
            >
              <MaterialCommunityIcons name="camera-plus-outline" size={36} color={COLORS.primaryThemeColor} />
              <Text style={styles.imageCardEmptyTitle}>Add Maintenance Photo</Text>
              <Text style={styles.imageCardEmptySubtitle}>Tap to use Camera or Gallery</Text>
            </Pressable>
          )}
        </View>

        {/* Remarks */}
        <Text style={styles.sectionTitle}>Remarks</Text>
        <View style={styles.sectionGroup}>
          <FormInput
            label="Remarks :"
            value={formData.remarks}
            onChangeText={(v) => handleInputChange('remarks', v)}
            placeholder="Enter remarks"
            multiline
            numberOfLines={4}
            style={styles.remarksInput}
            editable={!isLocked}
          />
        </View>

        {/* Submit */}
        {!isLocked && (
          <LoadingButton
            title={isEditMode ? 'Update' : 'Submit'}
            onPress={handleSubmit}
            loading={isSubmitting}
            style={styles.submitButton}
          />
        )}
      </ScrollView>

      {/* Date Picker Modal */}
      <DateTimePickerModal
        isVisible={modals.datePicker}
        mode="date"
        date={formData.date || new Date()}
        onConfirm={(date) => {
          handleInputChange('date', date);
          setModals(prev => ({ ...prev, datePicker: false }));
        }}
        onCancel={() => setModals(prev => ({ ...prev, datePicker: false }))}
      />

      {/* Dropdown Modals */}
      {renderDropdownModal(
        modals.vehicle,
        dropdowns.vehicles,
        handleVehicleSelect,
        () => setModals(prev => ({ ...prev, vehicle: false })),
        'Select Vehicle'
      )}
      {renderDropdownModal(
        modals.maintenanceType,
        dropdowns.maintenanceTypes,
        handleMaintenanceTypeSelect,
        () => setModals(prev => ({ ...prev, maintenanceType: false })),
        'Select Maintenance Type'
      )}
      {renderDropdownModal(
        modals.handoverToPartner,
        dropdowns.partners,
        (item) => {
          setFormData(prev => ({ ...prev, handover_to_partner_id: item.id, handoverToPartnerName: item.name }));
          setModals(prev => ({ ...prev, handoverToPartner: false }));
        },
        () => setModals(prev => ({ ...prev, handoverToPartner: false })),
        'Select Handover To'
      )}

      {/* Signature Capture Modal */}
      <Modal visible={signatureModal.visible} animationType="slide">
        <View style={styles.signatureModalContainer}>
          <View style={styles.signatureModalHeader}>
            <Text style={styles.signatureModalTitle}>
              {signatureModal.field === 'handoverFromUri' ? 'Handover From Signature' : 'Handover To Signature'}
            </Text>
            <Pressable
              hitSlop={10}
              onPress={() => setSignatureModal({ visible: false, field: null })}
            >
              <MaterialCommunityIcons name="close" size={24} color={COLORS.primaryThemeColor} />
            </Pressable>
          </View>
          <SignatureScreen
            ref={signatureRef}
            onOK={handleSignatureOK}
            onEmpty={() => showToastMessage('Please provide a signature')}
            descriptionText=""
            clearText="Clear"
            confirmText="Save"
            webStyle={`
              .m-signature-pad { box-shadow: none; border: 1px solid #e0e0e0; border-radius: 8px; margin: 10px; }
              .m-signature-pad--body { border: none; }
              .m-signature-pad--footer { display: flex; justify-content: space-between; padding: 10px 20px; }
              .m-signature-pad--footer .button { background-color: #4CAF50; color: #fff; border: none; padding: 10px 30px; border-radius: 8px; font-size: 16px; }
              .m-signature-pad--footer .button.clear { background-color: #f44336; }
            `}
            backgroundColor="white"
            penColor="black"
            style={styles.signatureCanvas}
          />
        </View>
      </Modal>

      {/* Full-screen image preview (lightbox). Tap anywhere to dismiss. */}
      <Modal
        visible={!!previewImageUri}
        animationType="fade"
        transparent
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <Pressable style={styles.previewOverlay} onPress={() => setPreviewImageUri(null)}>
          <Pressable
            style={styles.previewClose}
            onPress={() => setPreviewImageUri(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialCommunityIcons name="close" size={28} color="#fff" />
          </Pressable>
          {previewImageUri ? (
            <Image source={{ uri: previewImageUri }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>

      {/* Inline in-app camera (no OS preview screen — matches Customer Visit flow). */}
      <Modal
        visible={showInAppCamera}
        animationType="slide"
        onRequestClose={() => setShowInAppCamera(false)}
      >
        <View style={styles.cameraModalContainer}>
          <Camera
            ref={inAppCameraRef}
            style={styles.cameraView}
            type={Camera.Constants.Type.back}
          >
            <View style={styles.cameraOverlay}>
              <View style={styles.cameraTopBar}>
                <TouchableOpacity
                  style={styles.cameraCloseBtn}
                  onPress={() => setShowInAppCamera(false)}
                >
                  <MaterialCommunityIcons name="close" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.cameraTitle}>Take Photo</Text>
                <View style={{ width: 40 }} />
              </View>
              <View style={styles.cameraBottomBar}>
                <TouchableOpacity
                  style={[styles.cameraShutterBtn, isCapturingPhoto && { opacity: 0.4 }]}
                  onPress={captureFromInAppCamera}
                  disabled={isCapturingPhoto}
                >
                  <View style={styles.cameraShutterInner} />
                </TouchableOpacity>
              </View>
            </View>
          </Camera>
        </View>
      </Modal>

      {/* Branded Camera / Gallery / Cancel picker (matches logout-style popup). */}
      <StyledAlertModal
        isVisible={imagePickerVisible}
        message="Select Image"
        confirmText="Camera"
        middleText="Gallery"
        cancelText="Cancel"
        onConfirm={() => dispatchImageSource('camera')}
        onMiddle={() => dispatchImageSource('gallery')}
        onCancel={() => setImagePickerVisible(false)}
      />

      <OverlayLoader visible={loading} />

      {/* Admin validate confirmation popup */}
      <StyledAlertModal
        isVisible={validateModalVisible}
        message={'Validate this maintenance record? Once validated, it will be locked.'}
        confirmText="VALIDATE"
        cancelText="CANCEL"
        onConfirm={handleValidate}
        onCancel={() => setValidateModalVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 4,
  },
  sectionGroup: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 14,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  remarksInput: {
    height: 100,
    textAlignVertical: 'top',
  },
  fieldLabel: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistMedium,
    marginBottom: 6,
    marginTop: 10,
    color: COLORS.black,
  },
  selectBox: {
    backgroundColor: '#f7f7f7',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectBoxText: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  selectBoxChevron: {
    fontSize: 18,
    color: COLORS.gray,
    marginLeft: 8,
  },
  submitButton: {
    marginTop: 30,
    marginBottom: 20,
  },
  // Image attachment card (empty + filled states)
  imageCardEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryThemeColor,
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFBFF',
    marginTop: 6,
  },
  imageCardEmptyTitle: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
  },
  imageCardEmptySubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  imageCardFilled: {
    marginTop: 6,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  imagePreviewWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  imageActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 4,
  },
  imageActionBtnDanger: {
    backgroundColor: 'rgba(229,57,53,0.85)',
  },
  imageActionBtnReplace: {
    backgroundColor: 'rgba(113,75,103,0.92)',
  },
  imageActionText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  // Lightbox preview
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  previewImage: {
    width: '100%',
    height: '90%',
  },
  // Inline in-app camera
  cameraModalContainer: { flex: 1, backgroundColor: '#000' },
  cameraView: { flex: 1 },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cameraCloseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraTitle: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 16,
  },
  cameraBottomBar: {
    alignItems: 'center',
    paddingBottom: 40,
    paddingTop: 24,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  cameraShutterBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  cameraShutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  // Signature — inline two-state card (mirrors imageCard* pattern)
  signatureSection: { marginVertical: 8 },
  signatureCardEmpty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.primaryThemeColor,
    borderRadius: 12,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFBFF',
    marginTop: 6,
  },
  signatureCardEmptyTitle: {
    marginTop: 8,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.black,
  },
  signatureCardEmptySubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  signatureCardFilled: {
    marginTop: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
    paddingVertical: 8,
    alignItems: 'center',
  },
  signaturePreviewImage: {
    width: '100%',
    height: 140,
  },
  signatureOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 6,
  },
  signatureActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.55)',
    gap: 4,
  },
  signatureActionBtnDanger: {
    backgroundColor: 'rgba(229,57,53,0.85)',
  },
  signatureActionBtnReplace: {
    backgroundColor: 'rgba(113,75,103,0.92)',
  },
  signatureActionText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  // Signature drawing modal (full-screen canvas)
  signatureModalContainer: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  signatureModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    paddingTop: 50,
  },
  signatureModalTitle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
  },
  signatureCanvas: {
    flex: 1,
  },
  modalItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalItemText: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.black,
  },
  modalEmptyText: {
    textAlign: 'center',
    padding: 20,
    color: COLORS.gray,
    fontFamily: FONT_FAMILY.urbanistMedium,
  },
  // Branded centered popup (matches Vehicle Tracking selectors)
  brandedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  brandedCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '70%',
    backgroundColor: COLORS.white,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.primaryThemeColor,
    paddingHorizontal: 6,
    paddingTop: 50,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 10,
  },
  brandedLogoWrap: {
    position: 'absolute',
    top: -40,
    alignSelf: 'center',
    borderRadius: 80,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.orange || '#FF9800',
  },
  brandedLogo: {
    height: 80,
    width: 80,
    borderRadius: 80,
    resizeMode: 'contain',
  },
  brandedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
    marginBottom: 4,
  },
  brandedTitle: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
  },
});

export default VehicleMaintenanceForm;
