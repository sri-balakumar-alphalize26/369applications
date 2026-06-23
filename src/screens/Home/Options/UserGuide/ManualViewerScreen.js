import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import Text from '@components/Text';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { showToastMessage } from '@components/Toast';
import { getManual } from '../../../../data/employeeManuals';

// Renders one employee manual: the guide HTML in a WebView, plus an "Open PDF"
// header button that shares the bundled PDF to the device's system viewer.
const ManualViewerScreen = ({ navigation, route }) => {
  const manual = getManual(route?.params?.id);
  const [opening, setOpening] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('[UserGuide] viewer mount:', {
      id: route?.params?.id,
      found: !!manual,
      title: manual?.title,
      hasPdf: !!manual?.pdf,
      htmlLength: manual?.html?.length,
    });
  }, []);

  // Resolve the bundled PDF asset to a local file with a proper .pdf name.
  const materializePdf = async () => {
    const asset = Asset.fromModule(manual.pdf);
    await asset.downloadAsync();
    const src = asset.localUri || asset.uri;
    const dest = `${FileSystem.cacheDirectory}${manual.id}-manual.pdf`;
    try {
      await FileSystem.copyAsync({ from: src, to: dest });
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists) return dest;
    } catch (copyErr) {
      console.log('[UserGuide] materializePdf: copy failed, using source -', copyErr?.message);
    }
    return src;
  };

  // Open straight in the device's PDF viewer (Android: ACTION_VIEW intent;
  // iOS: Quick Look via Sharing). Falls back to the share sheet on failure.
  const openPdf = async () => {
    if (!manual?.pdf) {
      console.log('[UserGuide] openPdf: no PDF bundled for', manual?.id);
      return;
    }
    try {
      setOpening(true);
      console.log('[UserGuide] openPdf: opening', manual.id);
      const fileUri = await materializePdf();
      console.log('[UserGuide] openPdf: file at', fileUri);

      if (Platform.OS === 'android') {
        try {
          const contentUri = await FileSystem.getContentUriAsync(fileUri);
          console.log('[UserGuide] openPdf: ACTION_VIEW', contentUri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: 'application/pdf',
          });
          return;
        } catch (intentErr) {
          console.log('[UserGuide] openPdf: intent failed, share fallback -', intentErr?.message);
        }
      }

      if (!(await Sharing.isAvailableAsync())) {
        showToastMessage('Opening the PDF is not supported on this device');
        return;
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: manual.title,
      });
    } catch (e) {
      console.log('[UserGuide] openPdf: error -', e?.message, e);
      showToastMessage('Could not open the PDF');
    } finally {
      setOpening(false);
    }
  };

  // Download to a folder the user chooses (Android: Storage Access Framework
  // directory picker; iOS: share sheet with "Save to Files").
  const downloadPdf = async () => {
    if (!manual?.pdf) return;
    try {
      setDownloading(true);
      console.log('[UserGuide] downloadPdf: start', manual.id);
      const fileUri = await materializePdf();
      const fileName = `${manual.id}-manual.pdf`;

      if (Platform.OS === 'android') {
        const SAF = FileSystem.StorageAccessFramework;
        const permissions = await SAF.requestDirectoryPermissionsAsync();
        if (!permissions.granted) {
          console.log('[UserGuide] downloadPdf: folder permission denied');
          showToastMessage('Storage permission denied');
          return;
        }
        const base64 = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const safUri = await SAF.createFileAsync(permissions.directoryUri, fileName, 'application/pdf');
        await FileSystem.writeAsStringAsync(safUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log('[UserGuide] downloadPdf: saved to', safUri);
        showToastMessage('PDF saved: ' + fileName);
      } else {
        if (!(await Sharing.isAvailableAsync())) {
          showToastMessage('Saving is not supported on this device');
          return;
        }
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: `Save ${manual.title}`,
        });
      }
    } catch (e) {
      console.log('[UserGuide] downloadPdf: error -', e?.message, e);
      showToastMessage('Could not download the PDF');
    } finally {
      setDownloading(false);
    }
  };

  const headerActions = (
    <View style={styles.headerActions}>
      <TouchableOpacity
        onPress={downloadPdf}
        disabled={downloading || opening}
        activeOpacity={0.8}
        style={[styles.pdfBtn, { marginRight: 8 }]}
      >
        {downloading ? (
          <ActivityIndicator size="small" color={COLORS.primaryThemeColor} />
        ) : (
          <>
            <MaterialIcons name="file-download" size={16} color={COLORS.primaryThemeColor} />
            <Text style={styles.pdfBtnText}>Save</Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        onPress={openPdf}
        disabled={opening || downloading}
        activeOpacity={0.8}
        style={styles.pdfBtn}
      >
        {opening ? (
          <ActivityIndicator size="small" color={COLORS.primaryThemeColor} />
        ) : (
          <>
            <MaterialIcons name="picture-as-pdf" size={16} color={COLORS.primaryThemeColor} />
            <Text style={styles.pdfBtnText}>PDF</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
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
        headerRight={headerActions}
      />
      <View style={{ flex: 1 }}>
        <WebView
          originWhitelist={['*']}
          source={{ html: manual.html }}
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          onLoadStart={() => console.log('[UserGuide] webview: load start', manual.id)}
          onLoadEnd={() => {
            console.log('[UserGuide] webview: load end', manual.id);
            setLoading(false);
          }}
          onError={(e) => console.log('[UserGuide] webview: error', e?.nativeEvent)}
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
  headerActions: { flexDirection: 'row', alignItems: 'center' },
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
