// Einstellungen: alle Zugangsdaten (nur auf dem Gerät gespeichert), Verbindungstests, Artikel-Sync.
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { AlertCircle, CheckCircle2, Lock } from 'lucide-react-native';
import { AllCreds, getAllCreds, isSecureStorage, setAllCreds } from '../lib/credentials';
import { testOpenAI } from '../lib/openai';
import { fetchAllShopwareProducts, testShopware, DEFAULT_SHOPWARE_IDS } from '../lib/shopware';
import { fetchAllShopifyProducts, testShopify } from '../lib/shopify';
import { testTikTok, fetchAllTikTokProducts } from '../lib/tiktok';
import { testHubspot } from '../lib/hubspot';
import { catalogCount, replaceCatalog } from '../lib/catalog';
import { CatalogShop } from '../lib/types';

type Busy =
  | ''
  | 'save'
  | 'openai'
  | 'shopware'
  | 'shopify'
  | 'tiktok'
  | 'hubspot'
  | 'sync_shopware'
  | 'sync_shopify'
  | 'sync_tiktok';

const emptyCreds: AllCreds = {
  openaiKey: '',
  shopwareUrl: '',
  shopwareClientId: '',
  shopwareClientSecret: '',
  shopwareIds: '',
  shopifyDomain: '',
  shopifyToken: '',
  tiktokAppKey: '',
  tiktokAppSecret: '',
  tiktokAccessToken: '',
  tiktokShopCipher: '',
  hubspotToken: '',
  googleSheetId: '',
  googleScriptUrl: '',
};

const SHOPWARE_IDS_PLACEHOLDER = JSON.stringify(DEFAULT_SHOPWARE_IDS, null, 2);

// Module-scope Komponenten (nicht im Render erzeugen – sonst State-Reset pro Render).
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secure?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.inputLabel}>{props.label}</Text>
      <TextInput
        style={[styles.textInput, props.multiline && styles.textInputMultiline]}
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor="#64748B"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!!props.secure}
        multiline={!!props.multiline}
      />
    </View>
  );
}

function ActionBtn(props: {
  label: string;
  onPress: () => void;
  busyKey: Busy;
  busy: Busy;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, props.primary && styles.actionBtnPrimary]}
      onPress={props.onPress}
      disabled={props.busy !== ''}
    >
      {props.busy === props.busyKey ? (
        <ActivityIndicator size="small" color={props.primary ? '#FFFFFF' : '#6366F1'} />
      ) : (
        <Text style={[styles.actionBtnText, props.primary && styles.actionBtnTextPrimary]}>
          {props.label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const [creds, setCreds] = useState<AllCreds>(emptyCreds);
  const [busy, setBusy] = useState<Busy>('');
  const [counts, setCounts] = useState<{ shopware: number; shopify: number; tiktok: number }>(
    () => ({
      shopware: catalogCount('shopware'),
      shopify: catalogCount('shopify'),
      tiktok: catalogCount('tiktok_shop'),
    }),
  );

  useEffect(() => {
    getAllCreds().then(setCreds);
  }, []);

  const update = (key: keyof AllCreds) => (value: string) =>
    setCreds((c) => ({ ...c, [key]: value }));

  const save = async () => {
    setBusy('save');
    try {
      await setAllCreds(creds);
      Alert.alert('Gespeichert', 'Alle Zugangsdaten wurden sicher auf diesem Gerät gespeichert.');
    } catch (e: any) {
      Alert.alert('Fehler', 'Speichern fehlgeschlagen: ' + (e?.message || ''));
    } finally {
      setBusy('');
    }
  };

  const runTest = async (which: Busy, fn: () => Promise<void>, okMsg: string) => {
    setBusy(which);
    try {
      await setAllCreds(creds); // erst speichern, dann mit gespeicherten Werten testen
      await fn();
      Alert.alert('Verbindung OK', okMsg);
    } catch (e: any) {
      Alert.alert('Verbindung fehlgeschlagen', e?.message || 'Unbekannter Fehler');
    } finally {
      setBusy('');
    }
  };

  const runSync = async (shop: CatalogShop) => {
    const busyKey: Busy =
      shop === 'shopware' ? 'sync_shopware' : shop === 'shopify' ? 'sync_shopify' : 'sync_tiktok';
    setBusy(busyKey);
    try {
      await setAllCreds(creds);
      let products: { externalId: string; number: string; name: string; priceGross: number; taxRate: number | null }[];
      if (shop === 'shopware') {
        products = await fetchAllShopwareProducts({
          url: creds.shopwareUrl,
          clientId: creds.shopwareClientId,
          clientSecret: creds.shopwareClientSecret,
        });
      } else if (shop === 'shopify') {
        products = await fetchAllShopifyProducts({
          domain: creds.shopifyDomain,
          token: creds.shopifyToken,
        });
      } else {
        products = await fetchAllTikTokProducts({
          appKey: creds.tiktokAppKey,
          appSecret: creds.tiktokAppSecret,
          accessToken: creds.tiktokAccessToken,
          shopCipher: creds.tiktokShopCipher,
        });
      }
      replaceCatalog(
        shop,
        products.map((p) => ({ shop, ...p })),
      );
      const n = catalogCount(shop);
      setCounts((c) => ({ ...c, [shop === 'tiktok_shop' ? 'tiktok' : shop]: n }));
      Alert.alert('Artikel synchronisiert', `${n} Artikel lokal gespeichert.`);
    } catch (e: any) {
      Alert.alert('Sync fehlgeschlagen', e?.message || 'Unbekannter Fehler');
    } finally {
      setBusy('');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 48 }}>
      <View style={styles.secureBanner}>
        {isSecureStorage ? (
          <>
            <Lock size={16} color="#10B981" style={{ marginRight: 8 }} />
            <Text style={styles.secureBannerTextOk}>
              Zugangsdaten werden verschlüsselt im SecureStore dieses Geräts gespeichert und
              nirgendwo sonst.
            </Text>
          </>
        ) : (
          <>
            <AlertCircle size={16} color="#F59E0B" style={{ marginRight: 8 }} />
            <Text style={styles.secureBannerTextWarn}>
              Web-Version: Zugangsdaten liegen im Browser-Speicher (weniger sicher als auf dem
              Handy).
            </Text>
          </>
        )}
      </View>

      <Section title="OPENAI (Transkription & Extraktion)">
        <Field
          label="API-Key"
          value={creds.openaiKey}
          onChange={update('openaiKey')}
          placeholder="sk-…"
          secure
        />
        <View style={styles.btnRow}>
          <ActionBtn
            label="Verbindung testen"
            busyKey="openai"
            busy={busy}
            onPress={() =>
              runTest('openai', () => testOpenAI(creds.openaiKey), 'OpenAI-Key funktioniert.')
            }
          />
        </View>
      </Section>

      <Section title="SHOPWARE">
        <Field
          label="Shop-URL"
          value={creds.shopwareUrl}
          onChange={update('shopwareUrl')}
          placeholder="https://mein-shop.de"
        />
        <Field
          label="Client-ID (Integration)"
          value={creds.shopwareClientId}
          onChange={update('shopwareClientId')}
          placeholder="SWIA…"
        />
        <Field
          label="Client-Secret"
          value={creds.shopwareClientSecret}
          onChange={update('shopwareClientSecret')}
          placeholder="•••"
          secure
        />
        <Field
          label="Instanz-IDs (JSON, optional – leer = Standard-Testshop)"
          value={creds.shopwareIds}
          onChange={update('shopwareIds')}
          placeholder={SHOPWARE_IDS_PLACEHOLDER}
          multiline
        />
        <View style={styles.btnRow}>
          <ActionBtn
            label="Verbindung testen"
            busyKey="shopware"
            busy={busy}
            onPress={() =>
              runTest(
                'shopware',
                () =>
                  testShopware({
                    url: creds.shopwareUrl,
                    clientId: creds.shopwareClientId,
                    clientSecret: creds.shopwareClientSecret,
                  }),
                'Shopware-Anmeldung funktioniert.',
              )
            }
          />
          <ActionBtn
            label={`Artikel sync (${counts.shopware})`}
            busyKey="sync_shopware"
            busy={busy}
            onPress={() => runSync('shopware')}
          />
        </View>
      </Section>

      <Section title="SHOPIFY">
        <Field
          label="Shop-Domain"
          value={creds.shopifyDomain}
          onChange={update('shopifyDomain')}
          placeholder="mein-shop.myshopify.com"
        />
        <Field
          label="Admin-API-Token (Custom App)"
          value={creds.shopifyToken}
          onChange={update('shopifyToken')}
          placeholder="shpat_…"
          secure
        />
        <View style={styles.btnRow}>
          <ActionBtn
            label="Verbindung testen"
            busyKey="shopify"
            busy={busy}
            onPress={() =>
              runTest(
                'shopify',
                () => testShopify({ domain: creds.shopifyDomain, token: creds.shopifyToken }),
                'Shopify-Verbindung funktioniert.',
              )
            }
          />
          <ActionBtn
            label={`Artikel sync (${counts.shopify})`}
            busyKey="sync_shopify"
            busy={busy}
            onPress={() => runSync('shopify')}
          />
        </View>
      </Section>

      <Section title="TIKTOK SHOP">
        <Field
          label="App Key"
          value={creds.tiktokAppKey}
          onChange={update('tiktokAppKey')}
          placeholder="7xyz…"
        />
        <Field
          label="App Secret"
          value={creds.tiktokAppSecret}
          onChange={update('tiktokAppSecret')}
          placeholder="•••"
          secure
        />
        <Field
          label="Access Token (aus Seller Center)"
          value={creds.tiktokAccessToken}
          onChange={update('tiktokAccessToken')}
          placeholder="ROW_…"
          secure
        />
        <Field
          label="Shop Cipher"
          value={creds.tiktokShopCipher}
          onChange={update('tiktokShopCipher')}
          placeholder="ROW_…"
        />
        <View style={styles.btnRow}>
          <ActionBtn
            label="Verbindung testen"
            busyKey="tiktok"
            busy={busy}
            onPress={() =>
              runTest(
                'tiktok',
                () =>
                  testTikTok({
                    appKey: creds.tiktokAppKey,
                    appSecret: creds.tiktokAppSecret,
                    accessToken: creds.tiktokAccessToken,
                    shopCipher: creds.tiktokShopCipher,
                  }),
                'TikTok Shop Verbindung funktioniert.',
              )
            }
          />
          <ActionBtn
            label={`Artikel sync (${counts.tiktok})`}
            busyKey="sync_tiktok"
            busy={busy}
            onPress={() => runSync('tiktok_shop')}
          />
        </View>
      </Section>

      <Section title="HUBSPOT">
        <Field
          label="Private-App-Token"
          value={creds.hubspotToken}
          onChange={update('hubspotToken')}
          placeholder="pat-…"
          secure
        />
        <View style={styles.btnRow}>
          <ActionBtn
            label="Verbindung testen"
            busyKey="hubspot"
            busy={busy}
            onPress={() =>
              runTest(
                'hubspot',
                () => testHubspot({ token: creds.hubspotToken }),
                'HubSpot-Verbindung funktioniert.',
              )
            }
          />
        </View>
      </Section>

      <Section title="GOOGLE SHEETS">
        <Field
          label="Apps Script URL (für direkten Push)"
          value={creds.googleScriptUrl}
          onChange={update('googleScriptUrl')}
          placeholder="https://script.google.com/macros/s/…/exec"
        />
        <Field
          label="Sheet-ID (optional, für Vorschau-Link)"
          value={creds.googleSheetId}
          onChange={update('googleSheetId')}
          placeholder="1a2b3c4d…"
        />
      </Section>

      <TouchableOpacity style={styles.saveButton} onPress={save} disabled={busy !== ''}>
        {busy === 'save' ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <CheckCircle2 size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>Alles speichern</Text>
          </>
        )}
      </TouchableOpacity>

      {Platform.OS === 'web' && (
        <View style={[styles.secureBanner, { marginTop: 16 }]}>
          <AlertCircle size={16} color="#F59E0B" style={{ marginRight: 8 }} />
          <Text style={styles.secureBannerTextWarn}>
            Im Browser sind Shopware/Shopify/HubSpot wegen Browser-Sicherheitsregeln (CORS) nicht
            nutzbar — bitte die Mobil-App verwenden.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16 },
  secureBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginBottom: 16,
  },
  secureBannerTextOk: { flex: 1, color: '#A7F3D0', fontSize: 12, lineHeight: 17 },
  secureBannerTextWarn: { flex: 1, color: '#FBBF24', fontSize: 12, lineHeight: 17 },
  section: {
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { color: '#6366F1', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#94A3B8', marginBottom: 6 },
  textInput: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F8FAFC',
    fontSize: 14,
  },
  textInputMultiline: { minHeight: 96, textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.35)',
  },
  actionBtnPrimary: { backgroundColor: '#6366F1', borderColor: '#6366F1' },
  actionBtnText: { color: '#A5B4FC', fontSize: 13, fontWeight: '600' },
  actionBtnTextPrimary: { color: '#FFFFFF' },
  saveButton: {
    flexDirection: 'row',
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
