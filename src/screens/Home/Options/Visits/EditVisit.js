import React, { useState, useEffect } from 'react';
import { Keyboard } from 'react-native';
import * as Location from 'expo-location';
import { NavigationHeader } from '@components/Header';
import { RoundedScrollContainer, SafeAreaView } from '@components/containers';
import { TextInput as FormInput } from '@components/common/TextInput';
import { LoadingButton } from '@components/common/Button';
import { DropdownSheet } from '@components/common/BottomSheets';
import { showToastMessage } from '@components/Toast';
import { formatDate } from '@utils/common/date';
import { showToast } from '@utils/common';
import { fetchCustomersOdoo, fetchVisitPurposesOdoo, updateCustomerVisitOdoo } from '@api/services/generalApi';

const EditVisit = ({ navigation, route }) => {
  const { details } = route?.params || {};

  const [formData, setFormData] = useState({
    customer: details?.customer ? { label: details.customer.name, id: details.customer.id } : null,
    dateAndTime: details?.date_time,
    contactPerson: details?.contact_person || '',
    contactNumber: details?.contact_number || '',
    visitPurpose: details?.purpose ? { label: details.purpose.name, id: details.purpose.id } : null,
    remarks: details?.remarks,
    longitude: details?.longitude || null,
    latitude: details?.latitude || null
  });

  const [dropdowns, setDropdowns] = useState({
    customers: [],
    visitPurpose: [],
  });

  const [errors, setErrors] = useState({});
  const [isVisible, setIsVisible] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [customers, purposes] = await Promise.all([
          fetchCustomersOdoo(),
          fetchVisitPurposesOdoo(),
        ]);
        setDropdowns({
          customers: customers.map(c => ({ id: c.id, label: c.name?.trim() })),
          visitPurpose: purposes.map(p => ({ id: p.id, label: p.name })),
        });
      } catch (error) {
        console.error("Error fetching dropdown data:", error);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Permission to access location was denied');
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      setFormData(prevFormData => ({
        ...prevFormData,
        longitude: location.coords.longitude,
        latitude: location.coords.latitude
      }));
    })();
  }, []);

  const handleFieldChange = (field, value) => {
    setFormData(prevFormData => ({
      ...prevFormData,
      [field]: value
    }));

    if (errors[field]) {
      setErrors(prevErrors => ({
        ...prevErrors,
        [field]: null
      }));
    }
  };

  const toggleBottomSheet = type => {
    setSelectedType(type);
    setIsVisible(!isVisible);
  };

  const renderBottomSheet = () => {
    let items = [];
    let fieldName = '';

    switch (selectedType) {
      case 'Customers':
        items = dropdowns.customers;
        fieldName = 'customer';
        break;
      case 'Visit Purpose':
        items = dropdowns.visitPurpose;
        fieldName = 'visitPurpose';
        break;
      default:
        return null;
    }

    return (
      <DropdownSheet
        isVisible={isVisible}
        items={items}
        title={selectedType}
        onClose={() => setIsVisible(false)}
        onValueChange={value => handleFieldChange(fieldName, value)}
      />
    );
  };

  const validate = () => {
    Keyboard.dismiss();
    const requiredFields = {
      customer: 'Please select a customer',
      remarks: 'Please enter remarks',
      visitPurpose: 'Please select a purpose of visit'
    };

    let isValid = true;
    let newErrors = {};

    Object.keys(requiredFields).forEach(field => {
      if (!formData[field]) {
        newErrors[field] = requiredFields[field];
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const submit = async () => {
    if (validate()) {
      setIsSubmitting(true);
      try {
        await updateCustomerVisitOdoo(details?.id, {
          customerId: formData.customer?.id,
          // Convert to UTC string so Odoo doesn't shift the time on save.
          dateTime: formData.dateAndTime
            ? (formData.dateAndTime instanceof Date
                ? formData.dateAndTime.toISOString().slice(0, 19).replace('T', ' ')
                : new Date(formData.dateAndTime).toISOString().slice(0, 19).replace('T', ' '))
            : null,
          purposeId: formData.visitPurpose?.id,
          remarks: formData.remarks,
          contactPerson: formData.contactPerson,
          contactNumber: formData.contactNumber,
          longitude: formData.longitude,
          latitude: formData.latitude,
        });
        showToast({ type: 'success', title: 'Success', message: 'Visit updated successfully' });
        navigation.goBack();
      } catch (error) {
        showToast({ type: 'error', title: 'ERROR', message: 'An unexpected error occurred. Please try again later.' });
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <SafeAreaView>
      <NavigationHeader title="Edit Customer Visit" onBackPress={() => navigation.goBack()} />
      <RoundedScrollContainer>
        <FormInput
          label="Date & Time"
          dropIcon="calendar"
          editable={false}
          value={formatDate(formData.dateAndTime, 'dd-MM-yyyy hh:mm:ss')}
        />
        <FormInput
          label="Customer Name"
          placeholder="Select Customer"
          dropIcon="menu-down"
          editable={false}
          multiline={true}
          value={formData.customer?.label?.trim()}
          validate={errors.customer}
          onPress={() => {
            console.log('[EditVisit] opening CustomerScreen');
            navigation.navigate('CustomerScreen', {
              selectMode: true,
              onSelect: (selected) => {
                console.log('[EditVisit] customer picked id=' + selected?.id + ' name="' + selected?.name + '"');
                handleFieldChange('customer', {
                  value: selected.id,
                  label: selected.name,
                  ...selected,
                });
              },
            });
          }}
        />
        <FormInput
          label="Contact Person"
          placeholder="Contact person"
          value={formData.contactPerson}
          onChangeText={value => handleFieldChange('contactPerson', value)}
        />
        <FormInput
          label="Contact No"
          placeholder="Contact number"
          value={formData.contactNumber}
          onChangeText={value => handleFieldChange('contactNumber', value)}
        />
        <FormInput
          label="Visit Purpose"
          placeholder="Select purpose of visit"
          dropIcon="menu-down"
          editable={false}
          value={formData.visitPurpose?.label}
          validate={errors.visitPurpose}
          onPress={() => toggleBottomSheet('Visit Purpose')}
        />
        <FormInput
          label="Remarks"
          placeholder="Enter Remarks"
          multiline={true}
          numberOfLines={5}
          value={formData.remarks}
          validate={errors.remarks}
          onChangeText={value => handleFieldChange('remarks', value)}
        />
        {renderBottomSheet()}
        <LoadingButton title="SUBMIT" onPress={submit} loading={isSubmitting} />
      </RoundedScrollContainer>
    </SafeAreaView>
  );
};

export default EditVisit;
