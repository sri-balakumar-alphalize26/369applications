import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, TouchableOpacity, View, StyleSheet, Modal as RNModal, ScrollView, PanResponder } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { MaterialIcons } from '@expo/vector-icons';
import { RoundedScrollContainer, SafeAreaView } from '@components/containers';
import { useFocusEffect } from '@react-navigation/native';
import { NavigationHeader } from '@components/Header';
import { DetailField } from '@components/common/Detail';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { formatDateTime } from '@utils/common/date';
import { showToastMessage } from '@components/Toast';
import { showToast } from '@utils/common';
import { fetchCustomerVisitDetailsOdoo, markCustomerVisitAsDoneOdoo, resetCustomerVisitToDraftOdoo } from '@api/services/generalApi';
import { LoadingButton } from '@components/common/Button';
import StyledAlertModal from '@components/Modal/StyledAlertModal';
import { OverlayLoader } from '@components/Loader';
import useAuthStore from '@stores/auth/useAuthStore';
import Text from '@components/Text';

// Mirror of the Selection options on `customer.visit.visit_duration` —
// translates the stored key (e.g. '30_60') back to a human-readable label.
const DURATION_LABELS = {
  '0_15': '0 to 15 minutes',
  '15_30': '15 to 30 minutes',
  '30_60': '30 to 60 minutes',
  '60_plus': 'More than 60 minutes',
};

// State color map — matches the Easy Sales detail screen's badge palette.
const STATE_COLORS = {
  draft: '#FF9800',
  done: '#4CAF50',
};

const VisitDetails = ({ navigation, route }) => {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.is_admin || false;

  const initialDetails = route?.params?.visitDetails;
  const visitId = route?.params?.visitId || initialDetails?.id;
  const [details, setDetails] = useState(initialDetails || {});
  const [isLoading, setIsLoading] = useState(false);
  const [isConfirmationModalVisible, setIsConfirmationModalVisible] = useState(false);
  const [confirmationAction, setConfirmationAction] = useState(null);
  const [previewImageUri, setPreviewImageUri] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioPositionMs, setAudioPositionMs] = useState(0);
  const [audioDurationMs, setAudioDurationMs] = useState(0);
  const [waveBarWidth, setWaveBarWidth] = useState(0);
  const soundRef = useRef(null);

  // Cleanup any audio on unmount.
  useEffect(() => () => {
    if (soundRef.current) {
      soundRef.current.unloadAsync().catch(() => {});
    }
  }, []);

  // Write the voice note's base64 to a temp file and play it via expo-av.
  const playVoiceNote = async () => {
    try {
      if (!details?.voiceNoteBase64) return;
      if (soundRef.current) {
        // Already loaded — just resume.
        await soundRef.current.playAsync();
        setIsPlaying(true);
        return;
      }
      const ext = (details.voiceNoteFilename || 'voice_note.m4a').split('.').pop();
      const path = `${FileSystem.cacheDirectory}visit_${visitId}_voice.${ext}`;
      await FileSystem.writeAsStringAsync(path, details.voiceNoteBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { sound } = await Audio.Sound.createAsync({ uri: path }, { shouldPlay: true });
      soundRef.current = sound;
      setIsPlaying(true);
      sound.setOnPlaybackStatusUpdate(async (s) => {
        if (!s?.isLoaded) return;
        // While the user is dragging, don't let the playback updater fight
        // their finger — the drag handler is the source of truth for position.
        if (!isDraggingRef.current) {
          setAudioPositionMs(s.positionMillis || 0);
        }
        if (s.durationMillis) setAudioDurationMs(s.durationMillis);
        if (s.didJustFinish) {
          // Hard stop: pause AND rewind to 0. Without explicit pauseAsync the
          // sound's internal "playing" flag stays true, so the next frame can
          // re-emit isPlaying=true and the user perceives it as auto-replaying.
          try { await sound.pauseAsync(); } catch (_) {}
          try { await sound.setPositionAsync(0); } catch (_) {}
          setIsPlaying(false);
          setAudioPositionMs(0);
        } else {
          setIsPlaying(s.isPlaying);
        }
      });
    } catch (e) {
      console.log('[VisitDetails] voice playback error:', e?.message);
      setIsPlaying(false);
    }
  };
  const stopVoicePlayback = async () => {
    if (soundRef.current) {
      try { await soundRef.current.pauseAsync(); } catch (_) {}
    }
    setIsPlaying(false);
  };
  // Tap-to-seek (single tap on bar) — kept for accessibility / single-tap UX.
  const seekVoiceNote = async (event) => {
    if (!soundRef.current || !audioDurationMs || !waveBarWidth) return;
    const x = event?.nativeEvent?.locationX ?? 0;
    const ratio = Math.max(0, Math.min(1, x / waveBarWidth));
    const targetMs = Math.floor(ratio * audioDurationMs);
    try {
      await soundRef.current.setPositionAsync(targetMs);
      setAudioPositionMs(targetMs);
    } catch (e) {
      console.log('[VisitDetails] seek failed:', e?.message);
    }
  };

  // Drag-to-scrub: user can drag the bar left/right to seek through the audio.
  // The PanResponder is created once via useRef, so it captures the initial
  // (zero) values of state. We mirror state into refs so the responder always
  // sees fresh values during drag.
  const isDraggingRef = useRef(false);
  const wasPlayingBeforeDragRef = useRef(false);
  const durationMsRef = useRef(0);
  const barWidthRef = useRef(0);
  const isPlayingRef = useRef(false);
  useEffect(() => { durationMsRef.current = audioDurationMs; }, [audioDurationMs]);
  useEffect(() => { barWidthRef.current = waveBarWidth; }, [waveBarWidth]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const audioPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: async (evt) => {
        const dur = durationMsRef.current;
        const bw = barWidthRef.current;
        if (!soundRef.current || !dur || !bw) return;
        isDraggingRef.current = true;
        wasPlayingBeforeDragRef.current = isPlayingRef.current;
        if (isPlayingRef.current) {
          try { await soundRef.current.pauseAsync(); } catch (_) {}
          setIsPlaying(false);
        }
        const x = evt?.nativeEvent?.locationX ?? 0;
        const ratio = Math.max(0, Math.min(1, x / bw));
        setAudioPositionMs(Math.floor(ratio * dur));
      },
      onPanResponderMove: (evt) => {
        const dur = durationMsRef.current;
        const bw = barWidthRef.current;
        if (!dur || !bw) return;
        const x = evt?.nativeEvent?.locationX ?? 0;
        const ratio = Math.max(0, Math.min(1, x / bw));
        setAudioPositionMs(Math.floor(ratio * dur));
      },
      onPanResponderRelease: async (evt) => {
        const dur = durationMsRef.current;
        const bw = barWidthRef.current;
        if (!soundRef.current || !dur || !bw) {
          isDraggingRef.current = false;
          return;
        }
        const x = evt?.nativeEvent?.locationX ?? 0;
        const ratio = Math.max(0, Math.min(1, x / bw));
        const targetMs = Math.floor(ratio * dur);
        try {
          await soundRef.current.setPositionAsync(targetMs);
          setAudioPositionMs(targetMs);
          if (wasPlayingBeforeDragRef.current) {
            await soundRef.current.playAsync();
            setIsPlaying(true);
          }
        } catch (e) {
          console.log('[VisitDetails] scrub release failed:', e?.message);
        }
        isDraggingRef.current = false;
      },
      onPanResponderTerminate: () => { isDraggingRef.current = false; },
    })
  ).current;
  const formatMs = (ms) => {
    const total = Math.floor((ms || 0) / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const fetchDetails = async () => {
    console.log('[VisitDetails-page] opening for visitId=' + visitId);
    try {
      const updatedDetails = await fetchCustomerVisitDetailsOdoo(visitId);
      console.log('[VisitDetails-page] fetch returned: ' + (updatedDetails ? 'object' : 'null'));
      if (updatedDetails) {
        console.log('[VisitDetails-page] images count=' + (updatedDetails.images?.length || 0));
        console.log('[VisitDetails-page] voiceNoteFilename=' + updatedDetails.voiceNoteFilename);
        const vb = updatedDetails.voiceNoteBase64;
        console.log('[VisitDetails-page] voiceNoteBase64 typeof=' + typeof vb +
                    ' length=' + (typeof vb === 'string' ? vb.length : 'n/a'));
        if (typeof vb === 'string' && vb.length > 0) {
          console.log('[VisitDetails-page] voiceNoteBase64 head=' + vb.slice(0, 40) + '...');
        }
        console.log('[VisitDetails-page] visit_duration=' + updatedDetails.visit_duration +
                    ' purpose=' + (updatedDetails.purpose?.name || 'null'));
        setDetails(updatedDetails);
      }
    } catch (error) {
      console.error('[VisitDetails-page] fetch error:', error?.message, error?.stack);
      showToastMessage('Failed to fetch visit details');
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (visitId) {
        fetchDetails();
      }
    }, [visitId])
  );

  const handleMapIconPress = () => {
    if (details?.longitude && details?.latitude) {
      navigation.navigate('MapViewScreen', { latitude: details.latitude, longitude: details.longitude });
    } else {
      showToastMessage('The visit does not have location details');
    }
  };

  const handleMarkAsDone = async () => {
    setIsConfirmationModalVisible(false);
    setIsLoading(true);
    try {
      await markCustomerVisitAsDoneOdoo(visitId);
      showToast({ type: 'success', message: 'Visit marked as done successfully', title: 'Success' });
      fetchDetails();
    } catch (error) {
      console.error('Error marking visit as done:', error);
      showToast({ type: 'error', message: 'Failed to mark visit as done', title: 'Error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetToDraft = async () => {
    setIsConfirmationModalVisible(false);
    setIsLoading(true);
    try {
      await resetCustomerVisitToDraftOdoo(visitId);
      showToast({ type: 'success', message: 'Visit reset to draft successfully', title: 'Success' });
      fetchDetails();
    } catch (error) {
      console.error('Error resetting visit to draft:', error);
      showToast({ type: 'error', message: 'Failed to reset visit to draft', title: 'Error' });
    } finally {
      setIsLoading(false);
    }
  };

  const openConfirmationModal = (action) => {
    setConfirmationAction(action);
    setIsConfirmationModalVisible(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.white }}>
      <NavigationHeader
        title="Customer Visits Details"
        onBackPress={() => navigation.goBack()}
        logo={false}
      />
      <RoundedScrollContainer>
        {/* Status badge (Draft / Done) — colored pill, top-right */}
        <View style={detailStyles.statusRow}>
          <View
            style={[
              detailStyles.statusBadge,
              { backgroundColor: STATE_COLORS[(details?.state || 'draft').toLowerCase()] || '#999' },
            ]}
          >
            <Text style={detailStyles.statusBadgeText}>
              {(details?.state || 'draft').toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity onPress={handleMapIconPress} activeOpacity={0.7}>
            <Image
              style={{ height: 35, width: 30, tintColor: COLORS.orange }}
              source={require('@assets/icons/common/map_icon.png')}
            />
          </TouchableOpacity>
        </View>
        <DetailField
          label="Date & Time"
          value={(() => {
            // Odoo returns "YYYY-MM-DD HH:MM:SS" UTC. Append T+Z so JS parses
            // as UTC, then format in user's local timezone — matches Odoo display.
            const s = details?.date_time;
            if (!s || typeof s !== 'string') return '-';
            const dt = new Date(s.replace(' ', 'T') + 'Z');
            return isNaN(dt.getTime()) ? '-' : formatDateTime(dt);
          })()}
        />
        <DetailField label="Employee Name" value={details?.employee?.name?.trim() || '-'} multiline />
        <DetailField label="Customer Name" value={details?.customer?.name?.trim() || '-'} multiline />
        <DetailField label="Location" value={details?.location_name || '-'} />
        <DetailField
          label="Latitude"
          value={details?.latitude != null ? Number(details.latitude).toFixed(6) : '-'}
        />
        <DetailField
          label="Longitude"
          value={details?.longitude != null ? Number(details.longitude).toFixed(6) : '-'}
        />
        <DetailField label="Visit Purpose" value={details?.purpose?.name || '-'} />
        <DetailField
          label="Visit Duration"
          value={DURATION_LABELS[details?.visit_duration] || details?.visit_duration || '-'}
        />
        {/* Visit Status now shown as colored badge at the top — see statusRow */}
        <DetailField label="Remarks" value={details?.remarks || '-'} multiline numberOfLines={5} textAlignVertical={'top'} />

        {/* Photos — always render the card so user knows the section exists */}
        <View style={styles.attachCard}>
          <View style={styles.attachHeader}>
            <View style={styles.attachHeaderLeft}>
              <MaterialIcons name="photo-library" size={20} color={COLORS.primaryThemeColor} />
              <Text style={styles.attachHeaderTitle}>Photos</Text>
            </View>
            {Array.isArray(details?.images) && details.images.length > 0 && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{details.images.length}</Text>
              </View>
            )}
          </View>
          {Array.isArray(details?.images) && details.images.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {details.images.map((img) => (
                <TouchableOpacity
                  key={img.id}
                  activeOpacity={0.85}
                  onPress={() => setPreviewImageUri(img.dataUri)}
                  style={styles.imageThumbWrapper}
                >
                  <Image source={{ uri: img.dataUri }} style={styles.imageThumb} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.attachEmptyText}>No photos attached.</Text>
          )}
        </View>

        {/* Voice Note — always render the card so user knows the section exists */}
        <View style={styles.attachCard}>
          <View style={styles.attachHeader}>
            <View style={styles.attachHeaderLeft}>
              <MaterialIcons name="graphic-eq" size={20} color={COLORS.primaryThemeColor} />
              <Text style={styles.attachHeaderTitle}>Voice Note</Text>
            </View>
          </View>
          {details?.voiceNoteBase64 ? (
            <View>
              <View style={styles.voicePlayerRow}>
                <TouchableOpacity
                  style={styles.voicePlayBtn}
                  onPress={isPlaying ? stopVoicePlayback : playVoiceNote}
                  activeOpacity={0.8}
                >
                  <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={26} color="#fff" />
                </TouchableOpacity>
                <View
                  style={styles.voiceWaveBar}
                  onLayout={(e) => setWaveBarWidth(e.nativeEvent.layout.width)}
                  {...audioPanResponder.panHandlers}
                >
                  <View style={styles.voiceWaveTrack} />
                  <View
                    style={[
                      styles.voiceWaveFill,
                      {
                        width: audioDurationMs
                          ? `${Math.min(100, (audioPositionMs / audioDurationMs) * 100)}%`
                          : '0%',
                      },
                    ]}
                  />
                  {audioDurationMs > 0 && (
                    <View
                      style={[
                        styles.voiceWaveThumb,
                        {
                          left: `${Math.min(100, (audioPositionMs / audioDurationMs) * 100)}%`,
                        },
                      ]}
                    />
                  )}
                </View>
                <Text style={styles.voiceTime}>
                  {formatMs(audioPositionMs)} / {formatMs(audioDurationMs)}
                </Text>
              </View>
              <Text style={styles.voiceFilename} numberOfLines={1}>
                {details.voiceNoteFilename || 'voice_note.m4a'}
              </Text>
            </View>
          ) : (
            <Text style={styles.attachEmptyText}>No voice note recorded.</Text>
          )}
        </View>

        {/* Fullscreen image preview */}
        <RNModal
          visible={!!previewImageUri}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewImageUri(null)}
        >
          <TouchableOpacity
            style={styles.previewOverlay}
            activeOpacity={1}
            onPress={() => setPreviewImageUri(null)}
          >
            {previewImageUri && (
              <Image source={{ uri: previewImageUri }} style={styles.previewImage} resizeMode="contain" />
            )}
            <TouchableOpacity style={styles.previewClose} onPress={() => setPreviewImageUri(null)}>
              <MaterialIcons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </TouchableOpacity>
        </RNModal>

        {isAdmin && (
          <View style={{ marginTop: 30, marginBottom: 20 }}>
            {details?.state !== 'done' && (
              <LoadingButton
                width="100%"
                marginVertical={10}
                title="Mark as Done"
                onPress={() => openConfirmationModal('done')}
                backgroundColor={COLORS.primary}
              />
            )}
            {details?.state !== 'draft' && (
              <LoadingButton
                width="100%"
                marginVertical={10}
                title="Reset to Draft"
                onPress={() => openConfirmationModal('draft')}
                backgroundColor={COLORS.orange}
              />
            )}
          </View>
        )}

        <OverlayLoader visible={isLoading} />
        <StyledAlertModal
          isVisible={isConfirmationModalVisible}
          message={
            confirmationAction === 'done'
              ? 'Are you sure you want to mark this visit as done?'
              : 'Are you sure you want to reset this visit to draft?'
          }
          confirmText="YES"
          cancelText="CANCEL"
          destructive={confirmationAction !== 'done'}
          onCancel={() => setIsConfirmationModalVisible(false)}
          onConfirm={confirmationAction === 'done' ? handleMarkAsDone : handleResetToDraft}
        />
      </RoundedScrollContainer>
    </SafeAreaView>
  );
};

// Local styles for the status badge row at the top of the details page
const detailStyles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusBadgeText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});

const styles = StyleSheet.create({
  attachCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#ECECEC',
  },
  attachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  attachHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  attachHeaderTitle: {
    marginLeft: 8,
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#2e2a4f',
  },
  countBadge: {
    backgroundColor: COLORS.primaryThemeColor,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    minWidth: 22,
    alignItems: 'center',
  },
  countBadgeText: { color: '#fff', fontSize: 12, fontFamily: FONT_FAMILY.urbanistBold },
  imageThumbWrapper: { marginRight: 8 },
  imageThumb: { width: 90, height: 90, borderRadius: 10, backgroundColor: '#f0f0f0' },
  attachEmptyText: { fontSize: 12, color: '#999', fontFamily: FONT_FAMILY.urbanistMedium, paddingVertical: 6 },
  voicePlayerRow: { flexDirection: 'row', alignItems: 'center' },
  voicePlayBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primaryThemeColor,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  voiceWaveBar: {
    flex: 1, height: 22,           // wider hit area — easier to grab while scrubbing
    justifyContent: 'center',
    marginRight: 10,
    position: 'relative',
  },
  voiceWaveTrack: {
    position: 'absolute',
    left: 0, right: 0,
    top: 8,
    height: 6,
    backgroundColor: '#E5E0EE',
    borderRadius: 3,
  },
  voiceWaveFill: {
    position: 'absolute',
    left: 0,
    top: 8,
    height: 6,
    backgroundColor: COLORS.primaryThemeColor,
    borderRadius: 3,
  },
  voiceWaveThumb: {
    position: 'absolute',
    top: 3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.primaryThemeColor,
    borderWidth: 2, borderColor: '#fff',
    marginLeft: -8,             // center the thumb on the position
    elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2,
  },
  voiceFilename: { fontSize: 11, color: '#888', marginTop: 6, fontFamily: FONT_FAMILY.urbanistMedium },
  voiceTime: { fontSize: 11, color: '#666', minWidth: 78, textAlign: 'right', fontFamily: FONT_FAMILY.urbanistMedium },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: { width: '100%', height: '85%' },
  previewClose: {
    position: 'absolute', top: 40, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
});

export default VisitDetails;
