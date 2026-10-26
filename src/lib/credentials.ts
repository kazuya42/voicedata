// Zugangsdaten-Speicher: SecureStore auf iOS/Android (Hardware-verschlüsselt),
// AsyncStorage-Fallback im Web (mit Hinweis in den Einstellungen).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CRED_KEYS, CredKey } from './types';

const PREFIX = 'vd_cred_';

export const isSecureStorage = Platform.OS !== 'web';

export async function getCred(key: CredKey): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      return (await AsyncStorage.getItem(PREFIX + key)) || '';
    }
    return (await SecureStore.getItemAsync(PREFIX + key)) || '';
  } catch {
    return '';
  }
}

export async function setCred(key: CredKey, value: string): Promise<void> {
  const v = (value || '').trim();
  if (Platform.OS === 'web') {
    if (v) await AsyncStorage.setItem(PREFIX + key, v);
    else await AsyncStorage.removeItem(PREFIX + key);
    return;
  }
  if (v) await SecureStore.setItemAsync(PREFIX + key, v);
  else await SecureStore.deleteItemAsync(PREFIX + key);
}

export type AllCreds = Record<CredKey, string>;
export async function getAllCreds(): Promise<AllCreds> {
  const entries = await Promise.all(CRED_KEYS.map(async (k) => [k, await getCred(k)] as const));
  return Object.fromEntries(entries) as AllCreds;
}

export async function setAllCreds(creds: Partial<AllCreds>): Promise<void> {
  await Promise.all((Object.keys(creds) as CredKey[]).map((k) => setCred(k, creds[k] ?? '')));
}
