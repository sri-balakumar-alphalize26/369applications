import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, ScrollView, FlatList, TextInput, TouchableOpacity,
  StyleSheet, Image, ActivityIndicator, Platform, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from '@components/containers';
import { NavigationHeader } from '@components/Header';
import { RoundedContainer } from '@components/containers';
import { Button } from '@components/common/Button';
import Text from '@components/Text';
import { StyledAlertModal } from '@components/Modal';
import { COLORS, FONT_FAMILY } from '@constants/theme';
import { showToastMessage } from '@components/Toast';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {
  fetchWhatsAppSessions,
  connectWhatsAppSession,
  disconnectWhatsAppSession,
  createWhatsAppSession,
  deleteWhatsAppSession,
  refreshWhatsAppStatus,
  pollQrStatus,
  sendWhatsAppMessage,
  sendWhatsAppDocument,
  fetchWhatsAppMessages,
} from '@api/services/whatsappApi';

import ContactsSheet from './ContactsSheet';

const TABS = ['Session', 'Send', 'History'];

const WhatsAppScreen = ({ navigation }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [showContacts, setShowContacts] = useState(false);

  return (
    <SafeAreaView backgroundColor={COLORS.primaryThemeColor}>
      <NavigationHeader title="WhatsApp" onBackPress={() => navigation.goBack()} logo={false} />
      <RoundedContainer backgroundColor="#f5f5f5">
        <View style={{ flex: 1 }}>
          {/* Tab Bar */}
          <View style={s.tabBar}>
            {TABS.map((tab, i) => (
              <TouchableOpacity
                key={tab}
                style={[s.tab, activeTab === i && s.tabActive]}
                onPress={() => setActiveTab(i)}
              >
                <Text style={[s.tabText, activeTab === i && s.tabTextActive]}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeTab === 0 && <SessionTab />}
          {activeTab === 1 && <SendTab />}
          {activeTab === 2 && <HistoryTab />}

          {/* Floating Contacts Button */}
          <TouchableOpacity style={s.fab} onPress={() => setShowContacts(true)} activeOpacity={0.8}>
            <Text style={s.fabIcon}>👤</Text>
          </TouchableOpacity>
        </View>
      </RoundedContainer>

      <ContactsSheet visible={showContacts} onClose={() => setShowContacts(false)} />
    </SafeAreaView>
  );
};

// ─── Session Tab ────────────────────────────────────────────────
const STEPS = ['Disconnected', 'Scan QR Code', 'Connected'];

const SessionTab = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [qrImage, setQrImage] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef(null);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchWhatsAppSessions();
      setSessions(data || []);
    } catch (e) {
      showToastMessage('Failed to load sessions: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const [pollStatus, setPollStatus] = useState('');

  // Start polling for QR / connection status
  const startPolling = (sessionId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setPollStatus('Waiting for QR code...');
    let pollCount = 0;
    pollRef.current = setInterval(async () => {
      pollCount++;
      try {
        const result = await pollQrStatus(sessionId);
        console.log('[WA Poll]', pollCount, 'status:', result.status, 'has_qr:', !!result.qr_image);
        if (result.status === 'waiting_qr' && result.qr_image) {
          // qr_image may be raw base64 or include data: prefix
          const qr = typeof result.qr_image === 'string' && result.qr_image.startsWith('data:')
            ? result.qr_image
            : result.qr_image;
          setQrImage(qr);
          setPollStatus('');
        } else if (result.status === 'waiting_qr') {
          setPollStatus('Generating QR code... (' + pollCount + ')');
        } else if (result.status === 'connected') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setQrImage(null);
          setActiveSessionId(null);
          setConnecting(false);
          setPollStatus('');
          showToastMessage('WhatsApp connected!');
          loadSessions();
        } else if (result.status === 'error') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setQrImage(null);
          setConnecting(false);
          setPollStatus('');
          showToastMessage('Connection error: ' + (result.error_message || ''));
          loadSessions();
        }
        // Timeout after 90 seconds
        if (pollCount > 30) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setConnecting(false);
          setPollStatus('');
          showToastMessage('QR code timeout. Try again.');
        }
      } catch (e) {
        console.warn('QR poll error:', e.message);
        setPollStatus('Poll error: ' + e.message);
      }
    }, 3000);
  };

  const handleConnect = async (sessionId) => {
    try {
      setConnecting(true);
      setActiveSessionId(sessionId);
      setQrImage(null);
      await connectWhatsAppSession(sessionId);
      startPolling(sessionId);
    } catch (e) {
      setConnecting(false);
      showToastMessage('Failed to connect: ' + e.message);
    }
  };

  const handleRefreshStatus = async (sessionId) => {
    try {
      setRefreshing(true);
      await refreshWhatsAppStatus(sessionId);
      // Single poll to get latest QR/status
      const result = await pollQrStatus(sessionId);
      if (result.status === 'waiting_qr' && result.qr_image) {
        setQrImage(result.qr_image);
        setActiveSessionId(sessionId);
        // Resume polling if QR is showing
        if (!pollRef.current) startPolling(sessionId);
      } else if (result.status === 'connected') {
        setQrImage(null);
        setActiveSessionId(null);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
      await loadSessions();
      showToastMessage('Status refreshed');
    } catch (e) {
      showToastMessage('Refresh failed: ' + e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async (sessionId) => {
    try {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      await disconnectWhatsAppSession(sessionId);
      setQrImage(null);
      setActiveSessionId(null);
      setConnecting(false);
      showToastMessage('Disconnected');
      loadSessions();
    } catch (e) {
      showToastMessage('Failed to disconnect: ' + e.message);
    }
  };

  const handleCreateSession = async () => {
    try {
      await createWhatsAppSession('Mobile App Session');
      showToastMessage('Session created');
      loadSessions();
    } catch (e) {
      showToastMessage('Failed to create session: ' + e.message);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState(null);

  const handleDelete = (sessionId, sessionName, status) => {
    const isConnected = status === 'connected';
    const message = isConnected
      ? `This session is currently CONNECTED.\n\nAre you sure you want to delete "${sessionName}"?`
      : `Are you sure you want to delete "${sessionName}"?`;
    setDeleteTarget({ sessionId, message });
  };

  const executeDelete = async () => {
    const { sessionId } = deleteTarget || {};
    setDeleteTarget(null);
    if (!sessionId) return;
    try {
      await deleteWhatsAppSession(sessionId);
      showToastMessage('Session deleted');
      loadSessions();
    } catch (e) {
      showToastMessage('Failed to delete: ' + e.message);
    }
  };

  const getStepIndex = (status) => {
    if (status === 'connected') return 2;
    if (status === 'waiting_qr') return 1;
    return 0;
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primaryThemeColor} /></View>;
  }

  return (
    <>
    <ScrollView contentContainerStyle={s.content}>
      {sessions.map((session) => {
        const stepIndex = getStepIndex(session.status);
        const isThisActive = activeSessionId === session.id;

        return (
          <View key={session.id} style={s.sessionCard}>
            {/* Session Name */}
            <Text style={s.sessionName}>{session.name || 'Session ' + session.id}</Text>
            {session.phone_number ? (
              <Text style={s.phoneText}>{session.phone_number}</Text>
            ) : null}

            {/* Status Progress Bar (like Odoo) */}
            <View style={s.progressBar}>
              {STEPS.map((step, i) => (
                <View key={step} style={s.progressStep}>
                  <View style={[
                    s.progressDot,
                    i <= stepIndex ? s.progressDotActive : {},
                    i === stepIndex && s.progressDotCurrent,
                  ]} />
                  <Text style={[
                    s.progressLabel,
                    i === stepIndex && s.progressLabelActive,
                  ]}>{step}</Text>
                </View>
              ))}
            </View>

            {session.error_message ? (
              <Text style={s.errorText}>{session.error_message}</Text>
            ) : null}

            {/* Action Buttons */}
            <View style={s.buttonRow}>
              {session.status !== 'connected' && (
                <TouchableOpacity
                  style={[s.actionBtn, s.connectBtn]}
                  onPress={() => handleConnect(session.id)}
                  disabled={connecting && isThisActive}
                >
                  <Text style={s.actionBtnText}>
                    {connecting && isThisActive ? 'Connecting...' : 'Connect WhatsApp'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[s.actionBtn, s.refreshBtn]}
                onPress={() => handleRefreshStatus(session.id)}
                disabled={refreshing}
              >
                <Text style={s.refreshBtnText}>
                  {refreshing ? 'Refreshing...' : 'Refresh Status'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, s.deleteBtn]}
                onPress={() => handleDelete(session.id, session.name || 'Session ' + session.id, session.status)}
              >
                <Text style={s.deleteBtnText}>🗑</Text>
              </TouchableOpacity>
              {session.status === 'connected' && (
                <TouchableOpacity
                  style={[s.actionBtn, s.disconnectBtn]}
                  onPress={() => handleDisconnect(session.id)}
                >
                  <Text style={s.actionBtnText}>Disconnect</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Waiting / QR Code */}
            {isThisActive && !qrImage && pollStatus ? (
              <View style={s.qrContainer}>
                <ActivityIndicator size="small" color="#25D366" style={{ marginBottom: 8 }} />
                <Text style={s.qrHint}>{pollStatus}</Text>
              </View>
            ) : null}
            {isThisActive && qrImage && (
              <View style={s.qrContainer}>
                <Text style={s.qrTitle}>Scan this QR code with WhatsApp</Text>
                <Image
                  source={{ uri: qrImage.startsWith('data:') ? qrImage : `data:image/png;base64,${qrImage}` }}
                  style={s.qrImage}
                  resizeMode="contain"
                />
                <Text style={s.qrHint}>Open WhatsApp {'>'} Linked Devices {'>'} Link a Device</Text>
              </View>
            )}
          </View>
        );
      })}

      {sessions.length === 0 && (
        <View style={s.emptyContainer}>
          <Text style={s.emptyText}>No WhatsApp sessions found</Text>
          <Text style={[s.emptyText, { fontSize: 12, marginTop: 4 }]}>Create a session to get started</Text>
        </View>
      )}

      <TouchableOpacity style={s.createBtn} onPress={handleCreateSession}>
        <Text style={s.createBtnText}>+ Create New Session</Text>
      </TouchableOpacity>
    </ScrollView>
    <StyledAlertModal
      isVisible={!!deleteTarget}
      message={deleteTarget?.message || 'Delete this session?'}
      confirmText="DELETE"
      cancelText="CANCEL"
      destructive
      onConfirm={executeDelete}
      onCancel={() => setDeleteTarget(null)}
    />
    </>
  );
};

// ─── Send Tab ───────────────────────────────────────────────────
const SendTab = () => {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setFile(result.assets[0]);
      }
    } catch (e) {
      showToastMessage('Failed to pick file');
    }
  };

  const handleSend = async () => {
    if (!phone.trim()) { showToastMessage('Enter phone number'); return; }
    if (!message.trim() && !file) { showToastMessage('Enter message or attach file'); return; }

    setSending(true);
    try {
      if (file) {
        const base64 = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await sendWhatsAppDocument(phone.trim(), base64, file.name || 'document', message.trim());
        showToastMessage('Document sent!');
      } else {
        await sendWhatsAppMessage(phone.trim(), message.trim());
        showToastMessage('Message sent!');
      }
      setMessage('');
      setFile(null);
    } catch (e) {
      showToastMessage('Send failed: ' + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.label}>Phone Number</Text>
      <TextInput
        style={s.input}
        placeholder="e.g. 919876543210"
        placeholderTextColor="#999"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />

      <Text style={s.label}>Message</Text>
      <TextInput
        style={[s.input, s.textArea]}
        placeholder="Type your message..."
        placeholderTextColor="#999"
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity style={s.attachBtn} onPress={handlePickFile}>
        <Text style={s.attachBtnText}>{file ? file.name : '+ Attach File'}</Text>
      </TouchableOpacity>
      {file && (
        <TouchableOpacity onPress={() => setFile(null)}>
          <Text style={s.removeFile}>Remove attachment</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.sendBtn, sending && { opacity: 0.6 }]}
        onPress={handleSend}
        disabled={sending}
      >
        <Text style={s.sendBtnText}>{sending ? 'Sending...' : 'Send'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

// ─── History Tab ────────────────────────────────────────────────
const HistoryTab = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadMessages = useCallback(async () => {
    try {
      const data = await fetchWhatsAppMessages(null, 100);
      setMessages(data || []);
    } catch (e) {
      showToastMessage('Failed to load messages: ' + e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMessages(); }, []);

  const onRefresh = () => {
    setRefreshing(true);
    loadMessages();
  };

  const renderMessage = ({ item }) => {
    const isSent = item.direction === 'outgoing';
    return (
      <View style={s.msgCard}>
        <View style={s.msgHeader}>
          <Text style={[s.msgDirection, { color: isSent ? '#2563eb' : '#16a34a' }]}>
            {isSent ? '↑ Sent' : '↓ Received'}
          </Text>
          <Text style={s.msgStatus}>{item.status || ''}</Text>
        </View>
        <Text style={s.msgPhone}>{item.phone || 'Unknown'}</Text>
        <Text style={s.msgText} numberOfLines={3}>{item.message || '(no text)'}</Text>
        <Text style={s.msgDate}>{item.create_date || ''}</Text>
      </View>
    );
  };

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primaryThemeColor} /></View>;
  }

  return (
    <FlatList
      data={messages}
      renderItem={renderMessage}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={[s.content, { paddingBottom: 100 }]}
      ListEmptyComponent={
        <View style={s.emptyContainer}>
          <Text style={s.emptyText}>No messages yet</Text>
        </View>
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    />
  );
};

// ─── Styles ─────────────────────────────────────────────────────
const s = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#25D366',
  },
  tabText: {
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#9ca3af',
  },
  tabTextActive: {
    color: '#25D366',
  },
  content: {
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  // Session
  sessionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  sessionName: {
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#1f2937',
    marginBottom: 4,
  },
  phoneText: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 8,
  },
  // Progress bar (Odoo-style status steps)
  progressBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 4,
  },
  progressStep: {
    alignItems: 'center',
    flex: 1,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
    marginBottom: 4,
  },
  progressDotActive: {
    backgroundColor: '#25D366',
  },
  progressDotCurrent: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#25D366',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 3,
  },
  progressLabel: {
    fontSize: 10,
    color: '#9ca3af',
    textAlign: 'center',
  },
  progressLabelActive: {
    color: '#25D366',
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  errorText: {
    fontSize: 11,
    color: '#ef4444',
    marginBottom: 6,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  connectBtn: {
    backgroundColor: '#25D366',
  },
  refreshBtn: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  refreshBtnText: {
    color: '#374151',
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  disconnectBtn: {
    backgroundColor: '#ef4444',
  },
  deleteBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 10,
  },
  deleteBtnText: {
    fontSize: 16,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  qrContainer: {
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  qrTitle: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#1f2937',
    marginBottom: 12,
  },
  qrImage: {
    width: 250,
    height: 250,
  },
  qrHint: {
    marginTop: 10,
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
  },
  createBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#25D366',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  createBtnText: {
    color: '#25D366',
    fontSize: 14,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#25D366',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 10,
  },
  fabIcon: {
    fontSize: 26,
  },
  // Send
  label: {
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#374151',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1f2937',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  attachBtn: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#6b7280',
    borderStyle: 'dashed',
  },
  attachBtnText: {
    color: '#6b7280',
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  removeFile: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  sendBtn: {
    marginTop: 20,
    backgroundColor: '#25D366',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  // History
  msgCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  msgHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  msgDirection: {
    fontSize: 12,
    fontFamily: FONT_FAMILY.urbanistBold,
  },
  msgStatus: {
    fontSize: 11,
    color: '#9ca3af',
  },
  msgPhone: {
    fontSize: 13,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: '#374151',
    marginBottom: 4,
  },
  msgText: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 4,
  },
  msgDate: {
    fontSize: 11,
    color: '#9ca3af',
    textAlign: 'right',
  },
});

export default WhatsAppScreen;
