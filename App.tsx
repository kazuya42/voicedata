import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  TextInput,
  SafeAreaView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  RecordingPresets,
  useAudioRecorderState,
} from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Mic,
  Square,
  Settings,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Volume2,
} from 'lucide-react-native';

const STORAGE_KEY = '@n8n_webhook_url';

export default function App() {
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [isSettingsVisible, setIsSettingsVisible] = useState<boolean>(false);
  const [tempUrl, setTempUrl] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState<string>('');

  // Audio Recorder setup
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 100); // Poll status every 100ms

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const statusFadeAnim = useRef(new Animated.Value(1)).current;

  // Load saved Webhook URL on start
  useEffect(() => {
    async function loadSettings() {
      try {
        const savedUrl = await AsyncStorage.getItem(STORAGE_KEY);
        if (savedUrl) {
          setWebhookUrl(savedUrl);
          setTempUrl(savedUrl);
        } else {
          // Open settings if no URL is saved yet
          setIsSettingsVisible(true);
        }
      } catch (e) {
        console.error('Failed to load settings', e);
      }
    }
    loadSettings();
  }, []);

  // Pulse animation when recording
  useEffect(() => {
    if (recorderState.isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recorderState.isRecording]);

  // Request Permissions & Start Recording
  const startRecording = async () => {
    try {
      setUploadStatus('idle');
      setUploadMessage('');

      const { status: currentStatus } = await getRecordingPermissionsAsync();
      if (currentStatus !== 'granted') {
        const { status } = await requestRecordingPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Berechtigung erforderlich',
            'Der Zugriff auf das Mikrofon wurde verweigert. Bitte aktiviere ihn in den Geräteeinstellungen.'
          );
          return;
        }
      }

      await recorder.prepareToRecordAsync({
        isMeteringEnabled: true,
      });
      await recorder.record();
    } catch (err) {
      console.error('Failed to start recording', err);
      Alert.alert('Fehler', 'Die Aufnahme konnte nicht gestartet werden.');
    }
  };

  // Stop Recording & Upload
  const stopRecording = async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) {
        throw new Error('Kein Aufnahmepfad gefunden.');
      }

      if (!webhookUrl) {
        Alert.alert('Fehler', 'Bitte konfiguriere zuerst die Webhook-URL in den Einstellungen.');
        setIsSettingsVisible(true);
        return;
      }

      await uploadAudio(uri);
    } catch (err) {
      console.error('Failed to stop recording', err);
      setUploadStatus('error');
      setUploadMessage('Aufnahme gestoppt, aber Speichern fehlgeschlagen.');
    }
  };

  // Upload Logic
  const uploadAudio = async (uri: string) => {
    setUploadStatus('uploading');
    setUploadMessage('Übertrage Audio an n8n...');

    try {
      const formData = new FormData();

      if (Platform.OS === 'web') {
        // Web-specific file handling
        const blobResponse = await fetch(uri);
        const blob = await blobResponse.blob();
        formData.append('file', blob, 'audio_recording.webm');
      } else {
        // Native mobile file handling
        formData.append('file', {
          uri: uri,
          name: 'audio_recording.m4a',
          type: 'audio/m4a',
        } as any);
      }

      formData.append('recorded_at', new Date().toISOString());
      formData.append('platform', Platform.OS);

      // Perform POST Request
      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json',
          // Omit Content-Type to let fetch generate the boundary
        },
      });

      if (response.ok) {
        setUploadStatus('success');
        setUploadMessage('Erfolgreich übertragen!');
        // Automatically clear success message after 4 seconds
        setTimeout(() => {
          setUploadStatus('idle');
          setUploadMessage('');
        }, 4000);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.error('Upload error', error);
      setUploadStatus('error');
      setUploadMessage(`Fehler beim Senden: ${error.message || 'Verbindungsfehler'}`);
    }
  };

  // Save Settings
  const saveSettings = async () => {
    let formattedUrl = tempUrl.trim();
    if (!formattedUrl) {
      Alert.alert('Ungültige URL', 'Bitte gib eine gültige Webhook-URL ein.');
      return;
    }

    // Basic URL validation
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      Alert.alert('Ungültige URL', 'Die URL muss mit http:// oder https:// beginnen.');
      return;
    }

    try {
      await AsyncStorage.setItem(STORAGE_KEY, formattedUrl);
      setWebhookUrl(formattedUrl);
      setIsSettingsVisible(false);
      
      // Notify if user uses localhost on a physical device
      if (Platform.OS !== 'web' && (formattedUrl.includes('localhost') || formattedUrl.includes('127.0.0.1'))) {
        Alert.alert(
          'Hinweis',
          'Du verwendest "localhost". Wenn du die App auf einem echten Handy testest, verwende stattdessen die lokale IP-Adresse deines PCs (z.B. http://192.168.x.x:5678).'
        );
      }
    } catch (e) {
      console.error('Failed to save URL', e);
      Alert.alert('Fehler', 'Die URL konnte nicht gespeichert werden.');
    }
  };

  // Helper to format duration (ms -> MM:SS)
  const formatDuration = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Map audio metering to scales for visual feedback
  const getMeteringScale = () => {
    if (!recorderState.isRecording) return 1;
    const db = recorderState.metering ?? -160;
    const clampedDb = Math.max(-60, Math.min(0, db));
    // scale from 1.0 to 1.4 based on volume
    return 1 + ((clampedDb + 60) / 60) * 0.4;
  };

  const volumeScale = getMeteringScale();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>VoiceData</Text>
          <Text style={styles.headerSubtitle}>Instant Voice to n8n Webhook</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => {
            setTempUrl(webhookUrl);
            setIsSettingsVisible(true);
          }}
        >
          <Settings size={22} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Main Container */}
      <View style={styles.container}>
        
        {/* Visualizer Status */}
        <View style={styles.statusContainer}>
          {recorderState.isRecording ? (
            <View style={styles.recordingLabelContainer}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>AUFNAHME LÄUFT</Text>
            </View>
          ) : (
            <Text style={styles.idleText}>Bereit zur Aufnahme</Text>
          )}
        </View>

        {/* Timer */}
        <Text style={[styles.timer, recorderState.isRecording && styles.timerActive]}>
          {formatDuration(recorderState.durationMillis)}
        </Text>

        {/* Record/Stop Button Area */}
        <View style={styles.buttonOuterContainer}>
          {/* Animated Glow Rings depending on volume level */}
          {recorderState.isRecording && (
            <Animated.View
              style={[
                styles.glowRing,
                {
                  transform: [{ scale: volumeScale }],
                  opacity: 0.35,
                },
              ]}
            />
          )}

          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[
                styles.recordButton,
                recorderState.isRecording ? styles.recordButtonActive : styles.recordButtonIdle,
              ]}
              onPress={recorderState.isRecording ? stopRecording : startRecording}
            >
              {recorderState.isRecording ? (
                <Square size={36} color="#FFFFFF" fill="#FFFFFF" />
              ) : (
                <Mic size={38} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>

        {/* Volume Level Meter Bar */}
        {recorderState.isRecording && (
          <View style={styles.volumeMeterContainer}>
            <Volume2 size={16} color="#EF4444" style={styles.volumeIcon} />
            <View style={styles.volumeTrack}>
              <Animated.View 
                style={[
                  styles.volumeFill, 
                  { 
                    width: `${Math.max(5, Math.min(100, ((recorderState.metering ?? -160) + 160) / 1.6))}%` 
                  }
                ]} 
              />
            </View>
          </View>
        )}

        {/* Upload Status Card */}
        {uploadStatus !== 'idle' && (
          <View
            style={[
              styles.statusCard,
              uploadStatus === 'success' && styles.statusCardSuccess,
              uploadStatus === 'error' && styles.statusCardError,
            ]}
          >
            {uploadStatus === 'uploading' && (
              <ActivityIndicator size="small" color="#6366F1" style={styles.statusCardIcon} />
            )}
            {uploadStatus === 'success' && (
              <CheckCircle2 size={20} color="#10B981" style={styles.statusCardIcon} />
            )}
            {uploadStatus === 'error' && (
              <XCircle size={20} color="#EF4444" style={styles.statusCardIcon} />
            )}
            <Text
              style={[
                styles.statusCardText,
                uploadStatus === 'success' && styles.statusCardTextSuccess,
                uploadStatus === 'error' && styles.statusCardTextError,
              ]}
            >
              {uploadMessage}
            </Text>
          </View>
        )}
      </View>

      {/* Footer Info */}
      <View style={styles.footer}>
        <View style={styles.serverInfoCard}>
          <Text style={styles.serverInfoLabel}>Aktivierter Webhook:</Text>
          <Text style={styles.serverInfoValue} numberOfLines={1}>
            {webhookUrl || 'Nicht eingerichtet (Zahnrad oben rechts tippen)'}
          </Text>
        </View>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={isSettingsVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsSettingsVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Verbindung einrichten</Text>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>n8n Webhook URL</Text>
              <TextInput
                style={styles.textInput}
                placeholder="https://n8n.domain.com/webhook/..."
                placeholderTextColor="#64748B"
                value={tempUrl}
                onChangeText={setTempUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              
              <View style={styles.warningContainer}>
                <AlertCircle size={16} color="#F59E0B" style={styles.warningIcon} />
                <Text style={styles.warningText}>
                  Verwende für Tests auf dem echten Gerät die LAN-IP deines PCs (z.B. 192.168.x.x) statt "localhost".
                </Text>
              </View>
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => setIsSettingsVisible(false)}
              >
                <Text style={styles.modalButtonCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={saveSettings}
              >
                <Text style={styles.modalButtonSaveText}>Speichern</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A', // Obsidian/Midnight Slate
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 40 : 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  settingsButton: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  statusContainer: {
    height: 40,
    justifyContent: 'center',
    marginBottom: 16,
  },
  recordingLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FCA5A5',
    letterSpacing: 1,
  },
  idleText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  timer: {
    fontSize: 72,
    fontWeight: '300',
    color: '#E2E8F0',
    fontVariant: ['tabular-nums'],
    marginBottom: 48,
  },
  timerActive: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  buttonOuterContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  glowRing: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  recordButtonIdle: {
    backgroundColor: '#6366F1', // Premium Indigo
    shadowColor: '#6366F1',
    shadowOpacity: 0.4,
    shadowRadius: 15,
  },
  recordButtonActive: {
    backgroundColor: '#EF4444', // Crimson Red
  },
  volumeMeterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '70%',
    height: 24,
    marginTop: 40,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  volumeIcon: {
    marginRight: 8,
  },
  volumeTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  volumeFill: {
    height: '100%',
    backgroundColor: '#EF4444',
    borderRadius: 3,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 32,
    width: '100%',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  statusCardSuccess: {
    borderColor: '#059669',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  statusCardError: {
    borderColor: '#DC2626',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  statusCardIcon: {
    marginRight: 12,
  },
  statusCardText: {
    fontSize: 14,
    color: '#E2E8F0',
    fontWeight: '500',
    flex: 1,
  },
  statusCardTextSuccess: {
    color: '#A7F3D0',
  },
  statusCardTextError: {
    color: '#FCA5A5',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  serverInfoCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  serverInfoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  serverInfoValue: {
    fontSize: 13,
    color: '#E2E8F0',
    marginTop: 4,
    fontWeight: '500',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
  },
  modalHeader: {
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  modalBody: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#F8FAFC',
    fontSize: 15,
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  warningIcon: {
    marginRight: 8,
    marginTop: 1,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#FBBF24',
    lineHeight: 18,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonCancel: {
    backgroundColor: '#334155',
    marginRight: 12,
  },
  modalButtonCancelText: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '600',
  },
  modalButtonSave: {
    backgroundColor: '#6366F1',
  },
  modalButtonSaveText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
