import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Camera } from 'expo-camera';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { fetchProductByBarcodeOdoo } from '@api/services/generalApi';
import { showToastMessage } from '@components/Toast';
import OfflineBanner from '@components/common/OfflineBanner';

const Scanner = ({ navigation, route }) => {
  const onScanCallback = route?.params?.onScan;
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

    // If a custom callback is provided, use it
    if (typeof onScanCallback === 'function') {
      setLoading(true);
      try {
        await onScanCallback(data);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Default: look up product by barcode in Odoo
    setLoading(true);
    try {
      const products = await fetchProductByBarcodeOdoo(data);
      if (products && products.length > 0) {
        navigation.replace('ProductDetail', { detail: products[0] });
        return;
      }
    } catch (error) {
      console.log('Barcode lookup error:', error.message);
    }
    // No product found or error - silently reset to scan again
    setScanned(false);
    setLoading(false);
  };

  if (hasPermission === null) {
    return (
      <SafeAreaView backgroundColor={COLORS.white}>
        <NavigationHeader
          title="Scan Barcode"
          color={COLORS.black}
          backgroundColor={COLORS.white}
          onBackPress={() => navigation.goBack()}
        />
        <OfflineBanner message="OFFLINE MODE — scanning from cached products" />
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
          title="Scan Barcode"
          color={COLORS.black}
          backgroundColor={COLORS.white}
          onBackPress={() => navigation.goBack()}
        />
        <OfflineBanner message="OFFLINE MODE — scanning from cached products" />
        <View style={styles.centered}>
          <Text style={styles.permissionText}>
            Camera permission is required to scan barcodes.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView backgroundColor={COLORS.white}>
      <NavigationHeader
        title="Scan Barcode"
        color={COLORS.black}
        backgroundColor={COLORS.white}
        onBackPress={() => navigation.goBack()}
      />
      <OfflineBanner message="OFFLINE MODE — scanning from cached products" />
      <View style={styles.cameraContainer}>
        <Camera
          style={StyleSheet.absoluteFillObject}
          barCodeScannerSettings={{
            barCodeTypes: [
              'ean13',
              'ean8',
              'upc_a',
              'upc_e',
              'code39',
              'code128',
              'qr',
            ],
          }}
          onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
        />
        <View style={styles.overlay}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.white} />
              <Text style={styles.instructionText}>Looking up product...</Text>
            </View>
          ) : (
            <>
              <View style={styles.scanFrame} />
              <Text style={styles.instructionText}>
                Point camera at the barcode
              </Text>
              {scanned && (
                <TouchableOpacity
                  style={styles.scanAgainButton}
                  onPress={() => setScanned(false)}
                >
                  <Text style={styles.scanAgainText}>Tap to Scan Again</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  cameraContainer: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    fontFamily: FONT_FAMILY.urbanistMedium,
    color: COLORS.gray,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
  },
  scanFrame: {
    width: 280,
    height: 150,
    borderWidth: 2,
    borderColor: '#FF9800',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  instructionText: {
    marginTop: 20,
    fontSize: 14,
    color: COLORS.white,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  scanAgainButton: {
    marginTop: 16,
    backgroundColor: COLORS.primaryThemeColor,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  scanAgainText: {
    color: COLORS.white,
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistSemiBold,
  },
});

export default Scanner;
