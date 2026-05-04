import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Camera } from 'expo-camera';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { OverlayLoader } from '@components/Loader';
import { showToastMessage } from '@components/Toast';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { fetchInvoiceByIdOdoo } from '@api/services/generalApi';

const InvoiceScannerScreen = ({ navigation, route }) => {
  const onScanCallback = route?.params?.onScan;
  const isCallbackMode = typeof onScanCallback === 'function';
  const [hasPermission, setHasPermission] = useState(null);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const handleBarCodeScanned = async ({ data }) => {
    if (scanned || loading) return;
    setScanned(true);

    // Callback mode: just return raw scanned data and go back
    if (isCallbackMode) {
      onScanCallback(data);
      navigation.goBack();
      return;
    }

    setLoading(true);
    try {
      let invoiceId;
      const urlMatch = data.match(/\/customer-invoices\/(\d+)/);
      if (urlMatch) {
        invoiceId = parseInt(urlMatch[1], 10);
      } else {
        invoiceId = parseInt(data, 10);
      }
      if (isNaN(invoiceId) || invoiceId <= 0) {
        showToastMessage('Invalid QR code. Expected an invoice ID or URL.');
        setScanned(false);
        setLoading(false);
        return;
      }

      const invoice = await fetchInvoiceByIdOdoo(invoiceId);
      if (invoice) {
        navigation.replace('InvoiceDetailsScreen', { invoice });
      } else {
        showToastMessage('No invoice found for this QR code');
        setScanned(false);
      }
    } catch (error) {
      showToastMessage(`Error fetching invoice: ${error.message}`);
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  if (hasPermission === null) {
    return (
      <SafeAreaView backgroundColor={COLORS.white}>
        <NavigationHeader
          title="Scan Invoice QR"
          color={COLORS.black}
          backgroundColor={COLORS.white}
          onBackPress={() => navigation.goBack()}
        />
        <View style={styles.centered}>
          <Text style={styles.permissionText}>Requesting camera permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasPermission) {
    return (
      <SafeAreaView backgroundColor={COLORS.white}>
        <NavigationHeader
          title="Scan Invoice QR"
          color={COLORS.black}
          backgroundColor={COLORS.white}
          onBackPress={() => navigation.goBack()}
        />
        <View style={styles.centered}>
          <Text style={styles.permissionText}>
            Camera permission is required to scan QR codes.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView backgroundColor={COLORS.white}>
      <NavigationHeader
        title="Scan Invoice QR"
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={() => navigation.goBack()}
      />
      <View style={styles.cameraContainer}>
        <Camera
          style={StyleSheet.absoluteFillObject}
          barCodeScannerSettings={{ barCodeTypes: ['qr'] }}
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <View style={styles.overlay}>
          <View style={styles.scanFrame} />
          <Text style={styles.instructionText}>
            Point camera at the QR code on the invoice
          </Text>
        </View>
      </View>
      <OverlayLoader visible={loading} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  cameraContainer: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  permissionText: { fontSize: 16, textAlign: 'center', fontFamily: FONT_FAMILY.urbanistMedium, color: COLORS.gray },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  scanFrame: { width: 250, height: 250, borderWidth: 2, borderColor: '#FF9800', borderRadius: 12, backgroundColor: 'transparent' },
  instructionText: { marginTop: 20, fontSize: 14, color: COLORS.white, fontFamily: FONT_FAMILY.urbanistSemiBold, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
});

export default InvoiceScannerScreen;
