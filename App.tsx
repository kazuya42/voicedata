import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  ScrollView,
  Linking,
  Keyboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  RecordingPresets,
  useAudioRecorderState,
  setAudioModeAsync,
} from 'expo-audio';
import {
  Mic,
  Square,
  Settings,
  CheckCircle2,
  XCircle,
  X,
  AlertCircle,
  User,
  Mail,
  MapPin,
  Package,
  FileText,
} from 'lucide-react-native';

import SettingsScreen from './src/screens/SettingsScreen';
import TranscriptsScreen from './src/screens/TranscriptsScreen';
import { getCred } from './src/lib/credentials';
import { transcribeAudio, extractFields } from './src/lib/openai';
import { shopwarePreview, shopwareConfirmOrder, parseShopwareIds } from './src/lib/shopware';
import { validateForTarget } from './src/lib/validate';
import { shopifyPreview, shopifyConfirmOrder } from './src/lib/shopify';
import { tiktokPreview, tiktokConfirmOrder } from './src/lib/tiktok';
import { hubspotPreview, hubspotConfirm } from './src/lib/hubspot';
import { buildCsv, buildEmailText, buildSheetsRow } from './src/lib/localTargets';
import { searchCatalog } from './src/lib/catalog';
import { saveTranscript, markTranscriptSent, updateTranscriptFields } from './src/lib/transcripts';
import {
  ParsedFields,
  PreviewData,
  ShopPreview,
  HubspotPreview,
  TextPreview,
  TargetSystem,
  Transcript,
  CatalogProduct,
} from './src/lib/types';

type Tab = 'record' | 'transcripts' | 'settings';

const TARGETS: { key: TargetSystem; label: string }[] = [
  { key: 'shopware', label: 'Shopware' },
  { key: 'shopify', label: 'Shopify' },
  { key: 'tiktok_shop', label: 'TikTok Shop' },
  { key: 'hubspot', label: 'HubSpot' },
  { key: 'email', label: 'E-Mail' },
  { key: 'google_sheets', label: 'Sheets' },
  { key: 'csv', label: 'CSV' },
];

const WEB_BLOCKED_TARGETS: TargetSystem[] = ['shopware', 'shopify', 'tiktok_shop', 'hubspot'];

// Maximale Aufnahmedauer (5 Minuten) – danach automatischer Stopp.
const MAX_RECORDING_MS = 5 * 60 * 1000;

export default function App() {
  const [tab, setTab] = useState<Tab>('record');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>(
    'idle',
  );
  const [uploadMessage, setUploadMessage] = useState<string>('');
  const [targetSystem, setTargetSystem] = useState<TargetSystem>('shopware');
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [waveform, setWaveform] = useState<number[]>(Array(30).fill(5));
  const [isEditingFields, setIsEditingFields] = useState<boolean>(false);
  const [transcriptsRefreshKey, setTranscriptsRefreshKey] = useState<number>(0);
  const [currentTranscriptId, setCurrentTranscriptId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CatalogProduct[]>([]);

  // Bearbeitbare Felder
  const [editCustName, setEditCustName] = useState<string>('');
  const [editCustEmail, setEditCustEmail] = useState<string>('');
  const [editCustStreet, setEditCustStreet] = useState<string>('');
  const [editCustZip, setEditCustZip] = useState<string>('');
  const [editCustCity, setEditCustCity] = useState<string>('');
  const [editProdName, setEditProdName] = useState<string>('');
  const [editProdNumber, setEditProdNumber] = useState<string>('');
  const [editProdQty, setEditProdQty] = useState<string>('1');
  const [editDelivName, setEditDelivName] = useState<string>('');
  const [editDelivStreet, setEditDelivStreet] = useState<string>('');
  const [editDelivZip, setEditDelivZip] = useState<string>('');
  const [editDelivCity, setEditDelivCity] = useState<string>('');

  // Animated.Value via useMemo (stabil, ohne Ref-Zugriff im Render).
  const rotateAnim = useMemo(() => new Animated.Value(0), []);
  const pulseAnim = useMemo(() => new Animated.Value(1), []);

  // Audio Recorder
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 100);

  // Auto-Stopp nach maximaler Aufnahmedauer (verhindert endlose Aufnahmen / vollen Cache).
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch((e) =>
      console.error('Audio mode failed', e),
    );
    return () => {
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    };
  }, []);

  // Pulse animation when recording
  useEffect(() => {
    if (recorderState.isRecording) {
      Animated.loop(
        Animated.timing(rotateAnim, { toValue: 1, duration: 3000, useNativeDriver: true }),
      ).start();
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [recorderState.isRecording, pulseAnim, rotateAnim]);

  // Waveform: synchronisiert die Balkenhöhe mit dem externen Metering-Stream des Recorders.
  // setState im Effect ist hier gewollt (Animations-Tick je Metering-Update), daher Regel aus.
  useEffect(() => {
    if (recorderState.isRecording) {
      const db = recorderState.metering ?? -160;
      const clamped = Math.max(-60, Math.min(0, db));
      const height = 5 + ((clamped + 60) / 60) * 35;
      setWaveform((prev) => [...prev.slice(1), height]);
    } else {
      setWaveform(Array(30).fill(5));
    }
  }, [recorderState.metering, recorderState.isRecording]);

  const getFields = (): ParsedFields => ({
    customerName: editCustName,
    customerEmail: editCustEmail,
    customerStreet: editCustStreet,
    customerZip: editCustZip,
    customerCity: editCustCity,
    productName: editProdName,
    productNumber: editProdNumber,
    quantity: Math.max(1, parseInt(editProdQty, 10) || 1),
    deliveryName: editDelivName,
    deliveryStreet: editDelivStreet,
    deliveryZip: editDelivZip,
    deliveryCity: editDelivCity,
  });

  const setFields = (f: ParsedFields) => {
    setEditCustName(f.customerName || '');
    setEditCustEmail(f.customerEmail || '');
    setEditCustStreet(f.customerStreet || '');
    setEditCustZip(f.customerZip || '');
    setEditCustCity(f.customerCity || '');
    setEditProdName(f.productName || '');
    setEditProdNumber(f.productNumber || '');
    setEditProdQty(f.quantity ? String(f.quantity) : '1');
    setEditDelivName(f.deliveryName || '');
    setEditDelivStreet(f.deliveryStreet || '');
    setEditDelivZip(f.deliveryZip || '');
    setEditDelivCity(f.deliveryCity || '');
  };

  // Aufnahme starten
  const startRecording = async () => {
    try {
      const openaiKey = await getCred('openaiKey');
      if (!openaiKey) {
        Alert.alert(
          'OpenAI-Key fehlt',
          'Bitte trage zuerst den OpenAI-API-Key in den Einstellungen ein.',
        );
        setTab('settings');
        return;
      }
      setUploadStatus('idle');
      setUploadMessage('');

      const { status: currentStatus } = await getRecordingPermissionsAsync();
      if (currentStatus !== 'granted') {
        const { status } = await requestRecordingPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Berechtigung erforderlich',
            'Der Zugriff auf das Mikrofon wurde verweigert. Bitte aktiviere ihn in den Geräteeinstellungen.',
          );
          return;
        }
      }
      await recorder.prepareToRecordAsync({
        ...RecordingPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      await recorder.record();
      // Sicherheits-Auto-Stopp nach MAX_RECORDING_MS.
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = setTimeout(() => {
        Alert.alert(
          'Maximale Länge erreicht',
          'Die Aufnahme wurde nach 5 Minuten automatisch gestoppt.',
        );
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.error('Failed to start recording', err);
      Alert.alert('Fehler', 'Die Aufnahme konnte nicht gestartet werden.');
    }
  };

  // Aufnahme stoppen → transkribieren → Felder extrahieren → lokal speichern
  const stopRecording = async () => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('Kein Aufnahmepfad gefunden.');
      await processRecording(uri);
    } catch (err: any) {
      console.error('Failed to stop recording', err);
      setUploadStatus('error');
      setUploadMessage(
        'Aufnahme gestoppt, aber Verarbeitung fehlgeschlagen: ' + (err?.message || ''),
      );
    }
  };

  const processRecording = async (uri: string) => {
    const openaiKey = await getCred('openaiKey');
    if (!openaiKey) {
      Alert.alert('OpenAI-Key fehlt', 'Bitte trage den OpenAI-API-Key in den Einstellungen ein.');
      setTab('settings');
      return;
    }
    try {
      setUploadStatus('uploading');
      setUploadMessage('Transkribiere Aufnahme (Whisper)…');
      const text = await transcribeAudio(uri, openaiKey);

      setUploadMessage('Extrahiere Bestelldaten (GPT)…');
      const fields = await extractFields(text, openaiKey);

      const transcript = await saveTranscript(text, fields);
      setCurrentTranscriptId(transcript.id);
      setTranscriptsRefreshKey((k) => k + 1);

      setFields(fields);
      setUploadStatus('idle');
      setIsEditingFields(true);
    } catch (err: any) {
      console.error('Processing error', err);
      setUploadStatus('error');
      setUploadMessage(`Fehler bei der Verarbeitung: ${err?.message || 'Verbindungsfehler'}`);
    }
  };

  // Transkript aus der Liste laden
  const loadTranscript = (t: Transcript) => {
    setFields(t.fields);
    setCurrentTranscriptId(t.id);
    setTab('record');
    setUploadStatus('idle');
    setUploadMessage('');
    setIsEditingFields(true);
  };

  // Stage 2: Felder verarbeiten → Vorschau für das gewählte Ziel
  const processFields = async () => {
    const fields = getFields();
    if (currentTranscriptId) updateTranscriptFields(currentTranscriptId, fields).catch(() => {});

    if (Platform.OS === 'web' && WEB_BLOCKED_TARGETS.includes(targetSystem)) {
      Alert.alert(
        'Nur in der Mobil-App',
        'Shopware, Shopify und HubSpot sind im Browser wegen CORS nicht nutzbar. Bitte die App auf dem Handy verwenden.',
      );
      return;
    }

    const validationErrors = validateForTarget(fields, targetSystem);
    if (validationErrors.length > 0) {
      Alert.alert('Bitte prüfen', validationErrors.join('\n'));
      return;
    }

    setUploadStatus('uploading');
    setUploadMessage('Erstelle Vorschau…');
    try {
      let preview: PreviewData;
      if (targetSystem === 'shopware') {
        const [url, clientId, clientSecret, idsJson] = await Promise.all([
          getCred('shopwareUrl'),
          getCred('shopwareClientId'),
          getCred('shopwareClientSecret'),
          getCred('shopwareIds'),
        ]);
        if (!url || !clientId || !clientSecret)
          throw new Error('Shopware-Zugangsdaten fehlen (Einstellungen).');
        preview = await shopwarePreview(fields, {
          url,
          clientId,
          clientSecret,
          ids: parseShopwareIds(idsJson),
        });
      } else if (targetSystem === 'shopify') {
        const [domain, token] = await Promise.all([
          getCred('shopifyDomain'),
          getCred('shopifyToken'),
        ]);
        if (!domain || !token) throw new Error('Shopify-Zugangsdaten fehlen (Einstellungen).');
        preview = await shopifyPreview(fields, { domain, token });
      } else if (targetSystem === 'tiktok_shop') {
        const [appKey, appSecret, accessToken, shopCipher] = await Promise.all([
          getCred('tiktokAppKey'),
          getCred('tiktokAppSecret'),
          getCred('tiktokAccessToken'),
          getCred('tiktokShopCipher'),
        ]);
        if (!appKey || !appSecret || !accessToken || !shopCipher)
          throw new Error('TikTok Shop Zugangsdaten fehlen (Einstellungen).');
        preview = await tiktokPreview(fields, { appKey, appSecret, accessToken, shopCipher });
      } else if (targetSystem === 'hubspot') {
        const token = await getCred('hubspotToken');
        if (!token) throw new Error('HubSpot-Token fehlt (Einstellungen).');
        preview = await hubspotPreview(fields, { token });
      } else if (targetSystem === 'csv') {
        preview = buildCsv(fields);
      } else if (targetSystem === 'email') {
        preview = buildEmailText(fields);
      } else {
        preview = buildSheetsRow(fields, await getCred('googleSheetId'));
      }
      setUploadStatus('idle');
      setIsEditingFields(false);
      setSuggestions([]);
      setPreviewData(preview);
    } catch (err: any) {
      console.error('Preview error', err);
      setUploadStatus('error');
      setUploadMessage(`Fehler bei der Verarbeitung: ${err?.message || 'Verbindungsfehler'}`);
    }
  };

  // Stage 3: Bestätigen (Shop-Bestellung bzw. HubSpot-Übertragung)
  const confirmShopOrder = async () => {
    if (!previewData) return;
    const type = previewData.type;
    const fields = getFields();
    setPreviewData(null);
    setUploadStatus('uploading');
    setUploadMessage(
      type === 'hubspot_preview' ? 'Übertrage an HubSpot…' : 'Bestellung wird angelegt…',
    );
    try {
      let successMessage = '';
      if (type === 'shopware_preview') {
        const [url, clientId, clientSecret, idsJson] = await Promise.all([
          getCred('shopwareUrl'),
          getCred('shopwareClientId'),
          getCred('shopwareClientSecret'),
          getCred('shopwareIds'),
        ]);
        const result = await shopwareConfirmOrder(fields, {
          url,
          clientId,
          clientSecret,
          ids: parseShopwareIds(idsJson),
        });
        successMessage = `Bestellung ${result.orderNumber} erfolgreich in Shopware angelegt (${result.total.toFixed(2)} €).`;
      } else if (type === 'shopify_preview') {
        const [domain, token] = await Promise.all([
          getCred('shopifyDomain'),
          getCred('shopifyToken'),
        ]);
        const result = await shopifyConfirmOrder(fields, { domain, token });
        successMessage = `Bestellung ${result.orderNumber} erfolgreich in Shopify angelegt (${result.total.toFixed(2)}).`;
      } else if (type === 'tiktok_preview') {
        const [appKey, appSecret, accessToken, shopCipher] = await Promise.all([
          getCred('tiktokAppKey'),
          getCred('tiktokAppSecret'),
          getCred('tiktokAccessToken'),
          getCred('tiktokShopCipher'),
        ]);
        const result = await tiktokConfirmOrder(fields, { appKey, appSecret, accessToken, shopCipher });
        successMessage = `Bestellung ${result.orderNumber} erfolgreich in TikTok Shop angelegt (${result.total.toFixed(2)} €).`;
      } else if (type === 'hubspot_preview') {
        const token = await getCred('hubspotToken');
        const hp = previewData as HubspotPreview;
        const result = await hubspotConfirm(fields, { token }, hp.amount);
        successMessage = `HubSpot: Kontakt ${result.contactWasCreated ? 'angelegt' : 'aktualisiert'} und Deal „${result.dealName}" erstellt.`;
      } else {
        return;
      }
      setUploadStatus('success');
      // Felder bleiben absichtlich erhalten, damit dieselben Daten an weitere Ziele gesendet werden können
      setUploadMessage(successMessage);
      if (currentTranscriptId) {
        await markTranscriptSent(currentTranscriptId, targetSystem, successMessage);
        setTranscriptsRefreshKey((k) => k + 1);
      }
    } catch (err: any) {
      setUploadStatus('error');
      setUploadMessage('Fehler bei der Übertragung: ' + (err?.message || 'Verbindungsfehler'));
    }
  };

  // Helper: Vorschau schließen, ggf. zurück ins Edit-Modal
  const closePreview = () => {
    setPreviewData(null);
    if (editCustName || editProdName) setIsEditingFields(true);
  };

  // E-Mail-App öffnen
  const openEmailApp = (emailBody: string) => {
    const url = `mailto:?subject=${encodeURIComponent('Voicememo Bestellung')}&body=${encodeURIComponent(emailBody)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert(
        'Fehler',
        'E-Mail-App konnte nicht geöffnet werden. Bitte kopiere den Text manuell.',
      );
    });
    closePreview();
    if (currentTranscriptId) {
      markTranscriptSent(currentTranscriptId, 'email', 'E-Mail-Entwurf geöffnet').then(() =>
        setTranscriptsRefreshKey((k) => k + 1),
      );
    }
  };

  const copyToClipboard = async (text: string) => {
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      Alert.alert('Kopiert', 'Die Daten wurden in die Zwischenablage kopiert.');
    } catch {
      Alert.alert('Fehler', 'Kopieren in die Zwischenablage fehlgeschlagen.');
    }
  };

  // CSV als Datei exportieren (Share-Sheet auf Mobile, Download im Web)
  const downloadCsv = async (csv: string) => {
    if (!csv) return;
    try {
      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'voicedata_export.csv';
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const fileUri = FileSystem.cacheDirectory + 'voicedata_export.csv';
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/csv',
          dialogTitle: 'CSV speichern oder teilen',
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        await Clipboard.setStringAsync(csv);
        Alert.alert(
          'Teilen nicht verfügbar',
          'Die CSV-Daten wurden stattdessen in die Zwischenablage kopiert.',
        );
      }
    } catch (err) {
      console.error('CSV export failed', err);
      Alert.alert('Fehler', 'CSV-Export fehlgeschlagen.');
    }
  };

  // Sheets: Zeile kopieren + Sheet öffnen
  const openGoogleSheet = async (rowData: string, sheetUrl?: string) => {
    const url = sheetUrl || '';
    if (!url) {
      Alert.alert('Keine Sheet-ID', 'Bitte hinterlege die Google Sheet ID in den Einstellungen.');
      return;
    }
    try {
      if (rowData) await Clipboard.setStringAsync(rowData);
      Alert.alert(
        'Zeile kopiert',
        'Die Daten liegen tab-getrennt in der Zwischenablage. Im Sheet eine Zelle auswählen und einfügen – die Werte verteilen sich automatisch auf die Spalten.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Sheet öffnen',
            onPress: () =>
              Linking.openURL(url).catch(() =>
                Alert.alert('Fehler', 'Sheet konnte nicht geöffnet werden.'),
              ),
          },
        ],
      );
    } catch {
      Alert.alert('Fehler', 'Übertragung vorbereiten fehlgeschlagen.');
    }
  };

  // Produkt-Autocomplete aus dem lokalen Katalog
  const onProductInput = (text: string, kind: 'number' | 'name') => {
    if (kind === 'number') setEditProdNumber(text);
    else setEditProdName(text);
    if (targetSystem === 'shopware' || targetSystem === 'shopify' || targetSystem === 'tiktok_shop') {
      setSuggestions(text.trim().length >= 2 ? searchCatalog(targetSystem, text) : []);
    } else {
      setSuggestions([]);
    }
  };

  const applySuggestion = (p: CatalogProduct) => {
    setEditProdNumber(p.number);
    setEditProdName(p.name);
    setSuggestions([]);
  };

  const formatDuration = (millis: number) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const getMeteringScale = () => {
    if (!recorderState.isRecording) return 1;
    const db = recorderState.metering ?? -160;
    const clampedDb = Math.max(-60, Math.min(0, db));
    return 1 + ((clampedDb + 60) / 60) * 0.4;
  };
  const volumeScale = getMeteringScale();

  const shopPreview =
    previewData &&
    (previewData.type === 'shopware_preview' ||
      previewData.type === 'shopify_preview' ||
      previewData.type === 'tiktok_preview')
      ? (previewData as ShopPreview)
      : null;
  const hubspotPrev =
    previewData?.type === 'hubspot_preview' ? (previewData as HubspotPreview) : null;
  const textPreview =
    previewData && ['csv', 'email', 'google_sheets'].includes(previewData.type)
      ? (previewData as TextPreview)
      : null;

  const renderStatusCard = (extraStyle?: object) =>
    uploadStatus !== 'idle' && (
      <View
        style={[
          styles.statusCard,
          uploadStatus === 'success' && styles.statusCardSuccess,
          uploadStatus === 'error' && styles.statusCardError,
          extraStyle,
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
        {uploadStatus !== 'uploading' && (
          <TouchableOpacity
            onPress={() => {
              setUploadStatus('idle');
              setUploadMessage('');
            }}
            style={{ marginLeft: 10, padding: 4 }}
          >
            <X size={18} color={uploadStatus === 'success' ? '#A7F3D0' : '#FCA5A5'} />
          </TouchableOpacity>
        )}
      </View>
    );

  const renderTargetSelector = (disabled: boolean) => (
    <View style={styles.targetSelectorContainer}>
      <Text style={styles.targetSelectorLabel}>Zielsystem:</Text>
      <View style={styles.targetGrid}>
        {TARGETS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.targetBtn, targetSystem === t.key && styles.targetBtnActive]}
            onPress={() => {
              setTargetSystem(t.key);
              setSuggestions([]);
            }}
            disabled={disabled}
          >
            <Text
              style={[styles.targetBtnText, targetSystem === t.key && styles.targetBtnTextActive]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>VoiceData</Text>
          <Text style={styles.headerSubtitle}>
            {tab === 'record' && 'Sprache → Bestellung, direkt vom Gerät'}
            {tab === 'transcripts' && 'Gespeicherte Transkripte'}
            {tab === 'settings' && 'Verbindungen & Zugangsdaten'}
          </Text>
        </View>
      </View>

      {/* Inhalt je Tab */}
      {tab === 'settings' && <SettingsScreen />}
      {tab === 'transcripts' && (
        <TranscriptsScreen refreshKey={transcriptsRefreshKey} onLoadTranscript={loadTranscript} />
      )}
      {tab === 'record' && (
        <View style={styles.container}>
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

          {!recorderState.isRecording && renderTargetSelector(false)}

          <Text style={[styles.timer, recorderState.isRecording && styles.timerActive]}>
            {formatDuration(recorderState.durationMillis)}
          </Text>

          <View style={styles.buttonOuterContainer}>
            {recorderState.isRecording && (
              <Animated.View
                style={[styles.siriContainer, { transform: [{ scale: volumeScale }] }]}
              >
                <Animated.View
                  style={[
                    styles.siriGlow,
                    styles.siriBlue,
                    {
                      transform: [
                        {
                          rotate: rotateAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '360deg'],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={['#3B82F6', 'transparent']}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
                <Animated.View
                  style={[
                    styles.siriGlow,
                    styles.siriPurple,
                    {
                      transform: [
                        {
                          rotate: rotateAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['360deg', '0deg'],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={['#8B5CF6', 'transparent']}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
                <Animated.View
                  style={[
                    styles.siriGlow,
                    styles.siriPink,
                    {
                      transform: [
                        {
                          rotate: rotateAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0deg', '720deg'],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={['#EC4899', 'transparent']}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              </Animated.View>
            )}

            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                activeOpacity={0.85}
                style={[
                  styles.recordButton,
                  recorderState.isRecording ? styles.recordButtonActive : styles.recordButtonIdle,
                  uploadStatus === 'uploading' && { opacity: 0.5 },
                ]}
                onPress={recorderState.isRecording ? stopRecording : startRecording}
                disabled={uploadStatus === 'uploading'}
              >
                {recorderState.isRecording ? (
                  <Square size={36} color="#FFFFFF" fill="#FFFFFF" />
                ) : (
                  <Mic size={38} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </Animated.View>
          </View>

          {recorderState.isRecording && (
            <View style={styles.waveformContainer}>
              {waveform.map((h, i) => (
                <Animated.View
                  key={i}
                  style={[styles.waveformBar, { height: h, opacity: 0.3 + (i / 30) * 0.7 }]}
                />
              ))}
            </View>
          )}

          {!recorderState.isRecording && (editCustName || editProdName) && (
            <TouchableOpacity
              style={styles.reopenEditButton}
              onPress={() => setIsEditingFields(true)}
            >
              <Settings size={16} color="#6366F1" style={{ marginRight: 8 }} />
              <Text style={styles.reopenEditButtonText}>Erfasste Daten bearbeiten</Text>
            </TouchableOpacity>
          )}

          {renderStatusCard()}
        </View>
      )}

      {/* Tab-Bar */}
      <View style={styles.tabBar}>
        {[
          { key: 'record' as Tab, label: 'Aufnahme', Icon: Mic },
          { key: 'transcripts' as Tab, label: 'Transkripte', Icon: FileText },
          { key: 'settings' as Tab, label: 'Einstellungen', Icon: Settings },
        ].map(({ key, label, Icon }) => (
          <TouchableOpacity key={key} style={styles.tabItem} onPress={() => setTab(key)}>
            <Icon size={20} color={tab === key ? '#6366F1' : '#64748B'} />
            <Text style={[styles.tabLabel, tab === key && styles.tabLabelActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Edit Fields Modal */}
      <Modal
        visible={isEditingFields}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsEditingFields(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalBackdrop}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={{ width: '100%' }}
            >
              <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                <View style={[styles.modalContainer, { maxHeight: '90%' }]}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Erfasste Daten prüfen</Text>
                  </View>

                  <ScrollView
                    style={{ maxHeight: '70%' }}
                    contentContainerStyle={{ paddingBottom: 24 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    <View
                      style={[styles.targetSelectorContainer, { marginBottom: 16, marginTop: 4 }]}
                    >
                      <Text style={styles.targetSelectorLabel}>Zielsystem für Verarbeitung:</Text>
                      <View style={styles.targetGrid}>
                        {TARGETS.map((t) => (
                          <TouchableOpacity
                            key={t.key}
                            style={[
                              styles.targetBtn,
                              targetSystem === t.key && styles.targetBtnActive,
                            ]}
                            onPress={() => {
                              setTargetSystem(t.key);
                              setSuggestions([]);
                            }}
                            disabled={uploadStatus === 'uploading'}
                          >
                            <Text
                              style={[
                                styles.targetBtnText,
                                targetSystem === t.key && styles.targetBtnTextActive,
                              ]}
                            >
                              {t.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    <Text style={[styles.inputLabel, { color: '#6366F1' }]}>
                      KUNDE & RECHNUNGSANSCHRIFT
                    </Text>

                    <Text style={[styles.inputLabel, { marginTop: 8 }]}>Kunde / Name</Text>
                    <View style={styles.inputWithIconContainer}>
                      <User size={18} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInputWithIcon}
                        value={editCustName}
                        onChangeText={setEditCustName}
                        placeholder="Name des Kunden"
                        placeholderTextColor="#64748B"
                        editable={uploadStatus !== 'uploading'}
                      />
                    </View>

                    <Text style={[styles.inputLabel, { marginTop: 14 }]}>E-Mail-Adresse</Text>
                    <View style={styles.inputWithIconContainer}>
                      <Mail size={18} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInputWithIcon}
                        value={editCustEmail}
                        onChangeText={setEditCustEmail}
                        placeholder="kunden@email.de"
                        placeholderTextColor="#64748B"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={uploadStatus !== 'uploading'}
                      />
                    </View>

                    <Text style={[styles.inputLabel, { marginTop: 14 }]}>Straße & Hausnummer</Text>
                    <View style={styles.inputWithIconContainer}>
                      <MapPin size={18} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInputWithIcon}
                        value={editCustStreet}
                        onChangeText={setEditCustStreet}
                        placeholder="Musterstraße 12"
                        placeholderTextColor="#64748B"
                        editable={uploadStatus !== 'uploading'}
                      />
                    </View>

                    <View style={styles.rowInputs}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.inputLabel, { marginTop: 14 }]}>PLZ</Text>
                        <TextInput
                          style={styles.textInput}
                          value={editCustZip}
                          onChangeText={setEditCustZip}
                          placeholder="12345"
                          placeholderTextColor="#64748B"
                          keyboardType="number-pad"
                          editable={uploadStatus !== 'uploading'}
                        />
                      </View>
                      <View style={{ flex: 2 }}>
                        <Text style={[styles.inputLabel, { marginTop: 14 }]}>Ort</Text>
                        <TextInput
                          style={styles.textInput}
                          value={editCustCity}
                          onChangeText={setEditCustCity}
                          placeholder="Musterstadt"
                          placeholderTextColor="#64748B"
                          editable={uploadStatus !== 'uploading'}
                        />
                      </View>
                    </View>

                    <Text style={[styles.inputLabel, { marginTop: 22, color: '#6366F1' }]}>
                      LIEFERANSCHRIFT (optional – leer = wie Rechnungsanschrift)
                    </Text>

                    <Text style={[styles.inputLabel, { marginTop: 8 }]}>Empfänger</Text>
                    <View style={styles.inputWithIconContainer}>
                      <User size={18} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInputWithIcon}
                        value={editDelivName}
                        onChangeText={setEditDelivName}
                        placeholder="Abweichender Empfänger"
                        placeholderTextColor="#64748B"
                        editable={uploadStatus !== 'uploading'}
                      />
                    </View>

                    <Text style={[styles.inputLabel, { marginTop: 14 }]}>
                      Straße & Hausnummer (Lieferung)
                    </Text>
                    <View style={styles.inputWithIconContainer}>
                      <MapPin size={18} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInputWithIcon}
                        value={editDelivStreet}
                        onChangeText={setEditDelivStreet}
                        placeholder="Lieferstraße 1"
                        placeholderTextColor="#64748B"
                        editable={uploadStatus !== 'uploading'}
                      />
                    </View>

                    <View style={styles.rowInputs}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={[styles.inputLabel, { marginTop: 14 }]}>PLZ (Lieferung)</Text>
                        <TextInput
                          style={styles.textInput}
                          value={editDelivZip}
                          onChangeText={setEditDelivZip}
                          placeholder="12345"
                          placeholderTextColor="#64748B"
                          keyboardType="number-pad"
                          editable={uploadStatus !== 'uploading'}
                        />
                      </View>
                      <View style={{ flex: 2 }}>
                        <Text style={[styles.inputLabel, { marginTop: 14 }]}>Ort (Lieferung)</Text>
                        <TextInput
                          style={styles.textInput}
                          value={editDelivCity}
                          onChangeText={setEditDelivCity}
                          placeholder="Lieferort"
                          placeholderTextColor="#64748B"
                          editable={uploadStatus !== 'uploading'}
                        />
                      </View>
                    </View>

                    <Text style={[styles.inputLabel, { marginTop: 22, color: '#6366F1' }]}>
                      PRODUKT
                    </Text>

                    <Text style={[styles.inputLabel, { marginTop: 8 }]}>Produktname</Text>
                    <View style={styles.inputWithIconContainer}>
                      <Package size={18} color="#94A3B8" style={styles.inputIcon} />
                      <TextInput
                        style={styles.textInputWithIcon}
                        value={editProdName}
                        onChangeText={(t) => onProductInput(t, 'name')}
                        placeholder="Produktname"
                        placeholderTextColor="#64748B"
                        editable={uploadStatus !== 'uploading'}
                      />
                    </View>

                    <View style={styles.rowInputs}>
                      <View style={{ flex: 2, marginRight: 8 }}>
                        <Text style={[styles.inputLabel, { marginTop: 14 }]}>
                          Produkt / Artikelnummer
                        </Text>
                        <TextInput
                          style={styles.textInput}
                          value={editProdNumber}
                          onChangeText={(t) => onProductInput(t, 'number')}
                          placeholder="z.B. SW10001"
                          placeholderTextColor="#64748B"
                          autoCapitalize="none"
                          editable={uploadStatus !== 'uploading'}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.inputLabel, { marginTop: 14 }]}>Menge</Text>
                        <TextInput
                          style={styles.textInput}
                          value={editProdQty}
                          onChangeText={setEditProdQty}
                          placeholder="1"
                          placeholderTextColor="#64748B"
                          keyboardType="number-pad"
                          editable={uploadStatus !== 'uploading'}
                        />
                      </View>
                    </View>

                    {/* Autocomplete aus dem lokalen Katalog */}
                    {suggestions.length > 0 && (
                      <View style={styles.suggestionsBox}>
                        {suggestions.map((s) => (
                          <TouchableOpacity
                            key={`${s.shop}-${s.externalId}`}
                            style={styles.suggestionRow}
                            onPress={() => applySuggestion(s)}
                          >
                            <Text style={styles.suggestionNumber}>{s.number}</Text>
                            <Text style={styles.suggestionName} numberOfLines={1}>
                              {s.name}
                            </Text>
                            <Text style={styles.suggestionPrice}>
                              {s.priceGross ? `${s.priceGross.toFixed(2)} €` : ''}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </ScrollView>

                  {renderStatusCard({ marginTop: 0, marginBottom: 12 })}

                  <View style={[styles.modalFooter, { marginTop: 12 }]}>
                    <TouchableOpacity
                      style={[styles.modalButton, styles.modalButtonCancel]}
                      onPress={() => {
                        setIsEditingFields(false);
                        setSuggestions([]);
                        if (uploadStatus === 'success') {
                          setUploadStatus('idle');
                          setUploadMessage('');
                        }
                      }}
                      disabled={uploadStatus === 'uploading'}
                    >
                      <Text style={styles.modalButtonCancelText}>Fertig</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modalButton,
                        styles.modalButtonSave,
                        uploadStatus === 'uploading' && { opacity: 0.6 },
                      ]}
                      onPress={processFields}
                      disabled={uploadStatus === 'uploading'}
                    >
                      {uploadStatus === 'uploading' ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.modalButtonSaveText}>Verarbeiten</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Universal Preview Modal */}
      <Modal
        visible={!!previewData}
        animationType="fade"
        transparent={true}
        onRequestClose={closePreview}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {previewData?.type === 'shopware_preview' && 'Vorschau: Shopware Bestellung'}
                {previewData?.type === 'shopify_preview' && 'Vorschau: Shopify Bestellung'}
                {previewData?.type === 'tiktok_preview' && 'Vorschau: TikTok Shop Bestellung'}
                {previewData?.type === 'hubspot_preview' && 'Vorschau: HubSpot Kontakt + Deal'}
                {previewData?.type === 'csv' && 'Vorschau: CSV Export'}
                {previewData?.type === 'email' && 'Vorschau: E-Mail Entwurf'}
                {previewData?.type === 'google_sheets' && 'Vorschau: Google Sheets Zeile'}
              </Text>
            </View>

            <View style={styles.modalBody}>
              {shopPreview && (
                <>
                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>KUNDE & ANSCHRIFT</Text>
                    <View style={styles.previewRow}>
                      <Text style={styles.previewText}>
                        {shopPreview.customer.name || 'Unbekannt'}
                      </Text>
                      {shopPreview.customer.isNew && (
                        <View style={styles.badgeContainer}>
                          <Text style={styles.badgeText}>NEU</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.previewSubtext}>{shopPreview.customer.email}</Text>
                    {shopPreview.customer.street || shopPreview.customer.city ? (
                      <Text style={[styles.previewSubtext, { marginTop: 6, color: '#94A3B8' }]}>
                        {shopPreview.customer.street}
                        {shopPreview.customer.zip || shopPreview.customer.city ? '\n' : ''}
                        {shopPreview.customer.zip} {shopPreview.customer.city}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>LIEFERANSCHRIFT</Text>
                    {shopPreview.delivery.differs ? (
                      <>
                        <Text style={styles.previewText}>
                          {shopPreview.delivery.name || shopPreview.customer.name}
                        </Text>
                        <Text style={[styles.previewSubtext, { color: '#94A3B8' }]}>
                          {shopPreview.delivery.street || shopPreview.customer.street}
                          {'\n'}
                          {shopPreview.delivery.zip || shopPreview.customer.zip}{' '}
                          {shopPreview.delivery.city || shopPreview.customer.city}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.previewSubtext}>Wie Rechnungsanschrift</Text>
                    )}
                  </View>

                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>PRODUKT (Warenkorb)</Text>
                    <Text style={styles.previewText}>
                      {shopPreview.product.quantity || 1}x {shopPreview.product.name || 'Unbekannt'}
                    </Text>
                    {!!shopPreview.product.number && (
                      <Text style={styles.previewSubtext}>
                        Art-Nr: {shopPreview.product.number}
                        {shopPreview.product.priceGross
                          ? ` · ${shopPreview.product.priceGross.toFixed(2)} €`
                          : ''}
                      </Text>
                    )}
                    {shopPreview.product.found === false && (
                      <View style={[styles.warningContainer, { marginTop: 8 }]}>
                        <AlertCircle size={16} color="#F59E0B" style={styles.warningIcon} />
                        <Text style={styles.warningText}>
                          Produkt im Shop nicht gefunden! Bitte Schreibweise prüfen.
                        </Text>
                      </View>
                    )}
                  </View>
                </>
              )}

              {hubspotPrev && (
                <>
                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>KONTAKT</Text>
                    <View style={styles.previewRow}>
                      <Text style={styles.previewText}>
                        {hubspotPrev.contact.name || 'Unbekannt'}
                      </Text>
                      {hubspotPrev.contact.isNew && (
                        <View style={styles.badgeContainer}>
                          <Text style={styles.badgeText}>NEU</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.previewSubtext}>{hubspotPrev.contact.email}</Text>
                  </View>
                  <View style={styles.previewSection}>
                    <Text style={styles.previewSectionTitle}>DEAL</Text>
                    <Text style={styles.previewText}>{hubspotPrev.dealName}</Text>
                    <Text style={styles.previewSubtext}>
                      Wird mit dem Kontakt verknüpft (Standard-Pipeline).
                    </Text>
                  </View>
                </>
              )}

              {textPreview?.type === 'csv' && (
                <View style={styles.previewSection}>
                  <Text style={styles.previewSectionTitle}>CSV INHALT</Text>
                  <ScrollView
                    style={styles.csvScroll}
                    contentContainerStyle={styles.csvContainer}
                    horizontal={true}
                  >
                    <Text selectable={true} style={styles.codeText}>
                      {textPreview.data}
                    </Text>
                  </ScrollView>
                </View>
              )}

              {textPreview?.type === 'email' && (
                <View style={styles.previewSection}>
                  <Text style={styles.previewSectionTitle}>E-MAIL TEXT</Text>
                  <ScrollView
                    style={styles.textScroll}
                    contentContainerStyle={styles.textContainer}
                  >
                    <Text selectable={true} style={styles.previewText}>
                      {textPreview.data}
                    </Text>
                  </ScrollView>
                </View>
              )}

              {textPreview?.type === 'google_sheets' && (
                <View style={styles.previewSection}>
                  <Text style={styles.previewSectionTitle}>SPREADSHEET-ZEILE (TAB-GETRENNT)</Text>
                  <ScrollView
                    style={styles.textScroll}
                    contentContainerStyle={styles.textContainer}
                  >
                    <Text selectable={true} style={styles.previewText}>
                      {textPreview.data}
                    </Text>
                  </ScrollView>
                </View>
              )}
            </View>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={closePreview}
              >
                <Text style={styles.modalButtonCancelText}>
                  {shopPreview || hubspotPrev ? 'Abbrechen' : 'Schließen'}
                </Text>
              </TouchableOpacity>

              {shopPreview && (
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalButtonSave,
                    shopPreview.product.found === false && { opacity: 0.5 },
                  ]}
                  onPress={confirmShopOrder}
                  disabled={shopPreview.product.found === false}
                >
                  <Text style={styles.modalButtonSaveText}>Bestellen</Text>
                </TouchableOpacity>
              )}

              {hubspotPrev && (
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={confirmShopOrder}
                >
                  <Text style={styles.modalButtonSaveText}>Übertragen</Text>
                </TouchableOpacity>
              )}

              {textPreview?.type === 'email' && (
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={() => openEmailApp(textPreview.data)}
                >
                  <Text style={styles.modalButtonSaveText}>Mail App öffnen</Text>
                </TouchableOpacity>
              )}

              {textPreview?.type === 'csv' && (
                <>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => copyToClipboard(textPreview.data)}
                  >
                    <Text style={styles.modalButtonCancelText}>Kopieren</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={() => downloadCsv(textPreview.data)}
                  >
                    <Text style={styles.modalButtonSaveText}>Download</Text>
                  </TouchableOpacity>
                </>
              )}

              {textPreview?.type === 'google_sheets' && (
                <>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => copyToClipboard(textPreview.data)}
                  >
                    <Text style={styles.modalButtonCancelText}>Kopieren</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={() => openGoogleSheet(textPreview.data, textPreview.sheetUrl)}
                  >
                    <Text style={styles.modalButtonSaveText}>Sheet öffnen</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  siriContainer: {
    position: 'absolute',
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  siriGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.6,
  },
  siriBlue: { top: 10, left: 10 },
  siriPurple: { bottom: 10, right: 10 },
  siriPink: { top: 20, right: 20 },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    marginTop: 40,
    width: '100%',
    gap: 4,
  },
  waveformBar: {
    width: 4,
    backgroundColor: '#6366F1',
    borderRadius: 2,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
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
    fontSize: 64,
    fontWeight: '300',
    color: '#E2E8F0',
    fontVariant: ['tabular-nums'],
    marginBottom: 36,
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
    backgroundColor: '#6366F1',
    shadowColor: '#6366F1',
    shadowOpacity: 0.4,
    shadowRadius: 15,
  },
  recordButtonActive: {
    backgroundColor: '#EF4444',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
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
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  tabLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#6366F1',
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
  targetSelectorContainer: {
    marginBottom: 24,
    alignItems: 'center',
    width: '100%',
  },
  targetSelectorLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  targetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 2,
  },
  targetBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  targetBtnActive: {
    backgroundColor: '#334155',
  },
  targetBtnText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  targetBtnTextActive: {
    color: '#F8FAFC',
  },
  previewSection: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  previewSectionTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  previewSubtext: {
    color: '#64748B',
    fontSize: 13,
  },
  badgeContainer: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  badgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  csvScroll: {
    maxHeight: 250,
  },
  csvContainer: {
    padding: 12,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    color: '#38BDF8',
    fontSize: 13,
  },
  textScroll: {
    maxHeight: 250,
  },
  textContainer: {
    padding: 12,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputWithIconContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInputWithIcon: {
    flex: 1,
    paddingVertical: 14,
    color: '#F8FAFC',
    fontSize: 15,
  },
  rowInputs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  reopenEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
    marginTop: 20,
  },
  reopenEditButtonText: {
    color: '#6366F1',
    fontSize: 14,
    fontWeight: '600',
  },
  suggestionsBox: {
    marginTop: 10,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  suggestionNumber: {
    color: '#A5B4FC',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 10,
    minWidth: 80,
  },
  suggestionName: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 13,
  },
  suggestionPrice: {
    color: '#64748B',
    fontSize: 12,
    marginLeft: 8,
  },
});
