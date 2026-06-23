import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { showToastMessage } from '@components/Toast';
import { getManual } from '../../../../data/employeeManuals';

// Renders one employee manual: the guide HTML in a WebView, plus an "Open PDF"
// header button that shares the bundled PDF to the device's system viewer.
const ManualViewerScreen = ({ navigation, route }) => {
  const manual = getManual(route?.params?.id);
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(true);

  const openPdf = async () => {
    if (!manual?.pdf) {
      console.log('[UserGuide] openPdf: no PDF bundled for', manual?.id);
      return;
    }
    try {
      setOpening(true);
      console.log('[UserGuide] openPdf: opening', manual.id);
      // Resolve the bundled asset to a local file, give it a .pdf name, then share.
      const asset = Asset.fromModule(manual.pdf);
      await asset.downloadAsync();
      const src = asset.localUri || asset.uri;
      console.log('[UserGuide] openPdf: asset resolved at', src);
      const dest = `${FileSystem.cacheDirectory}${manual.id}-manual.pdf`;
      let fileUri = src;
      try {
        await FileSystem.copyAsync({ from: src, to: dest });
        const info = await FileSystem.getInfoAsync(dest);
        if (info.exists) fileUri = dest;
        console.log('[UserGuide] openPdf: copied to', fileUri);
      } catch (copyErr) {
        console.log('[UserGuide] openPdf: copy failed, sharing source directly -', copyErr?.message);
      }
      if (!(await Sharing.isAvailableAsync())) {
        console.log('[UserGuide] openPdf: Sharing not available on this device');
        showToastMessage('Opening the PDF is not supported on this device');
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: manual.title,
      });
      console.log('[UserGuide] openPdf: share sheet opened for', manual.id);
    } catch (e) {
      console.log('[UserGuide] openPdf: error -', e?.message, e);
      showToastMessage('Could not open the PDF');
    } finally {
      setOpening(false);
    }
  };

  const pdfButton = (
    <TouchableOpacity onPress={openPdf} disabled={opening} activeOpacity={0.8} style={styles.pdfBtn}>
      {opening ? (
        <ActivityIndicator size="small" color={COLORS.primaryThemeColor} />
      ) : (
        <>
          <MaterialIcons name="picture-as-pdf" size={16} color={COLORS.primaryThemeColor} />
          <Text style={styles.pdfBtnText}>PDF</Text>
        </>
      )}
    </TouchableOpacity>
  );

  if (!manual) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <NavigationHeader title="Guide" onBackPress={() => navigation.goBack()} logo={false} />
        <View style={styles.center}>
          <Text style={{ color: '#999', fontSize: 16 }}>Guide not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <NavigationHeader
        title={manual.title}
        onBackPress={() => navigation.goBack()}
        logo={false}
        headerRight={pdfButton}
      />
      <View style={{ flex: 1 }}>
        <WebView
          originWhitelist={['*']}
          source={{ html: manual.html }}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          onLoadEnd={() => setLoading(false)}
        />
        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={COLORS.primaryThemeColor} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loader: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 56,
    justifyContent: 'center',
  },
  pdfBtnText: { marginLeft: 4, fontSize: 13, fontFamily: FONT_FAMILY.urbanistBold, color: COLORS.primaryThemeColor },
});

export default ManualViewerScreen;
