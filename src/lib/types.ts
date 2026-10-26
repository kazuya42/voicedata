// Gemeinsame Typen für den gesamten Bestell-Flow

export type ParsedFields = {
  customerName: string;
  customerEmail: string;
  customerStreet: string;
  customerZip: string;
  customerCity: string;
  productName: string;
  productNumber: string;
  quantity: number;
  deliveryName: string;
  deliveryStreet: string;
  deliveryZip: string;
  deliveryCity: string;
};

export const emptyFields = (): ParsedFields => ({
  customerName: '',
  customerEmail: '',
  customerStreet: '',
  customerZip: '',
  customerCity: '',
  productName: '',
  productNumber: '',
  quantity: 1,
  deliveryName: '',
  deliveryStreet: '',
  deliveryZip: '',
  deliveryCity: '',
});

export type TargetSystem =
  | 'shopware'
  | 'shopify'
  | 'tiktok_shop'
  | 'hubspot'
  | 'email'
  | 'google_sheets'
  | 'csv';

export type PreviewCustomer = {
  name: string;
  email: string;
  street: string;
  zip: string;
  city: string;
  isNew: boolean;
  id: string | null;
};

export type PreviewProduct = {
  name: string;
  number: string;
  quantity: number;
  found: boolean;
  id: string | null;
  priceGross?: number;
};

export type PreviewDelivery = {
  name: string;
  street: string;
  zip: string;
  city: string;
  differs: boolean;
};

export type ShopPreview = {
  type: 'shopware_preview' | 'shopify_preview' | 'tiktok_preview';
  customer: PreviewCustomer;
  product: PreviewProduct;
  delivery: PreviewDelivery;
};

export type HubspotPreview = {
  type: 'hubspot_preview';
  contact: { name: string; email: string; isNew: boolean; id: string | null };
  dealName: string;
  amount: number | null;
};

export type TextPreview = {
  type: 'csv' | 'email' | 'google_sheets';
  data: string;
  sheetUrl?: string;
};

export type PreviewData = ShopPreview | HubspotPreview | TextPreview;

export type TranscriptStatus = 'draft' | 'sent';

export type Transcript = {
  id: string;
  createdAt: string; // ISO
  transcriptText: string;
  fields: ParsedFields;
  status: TranscriptStatus;
  sentTarget?: TargetSystem;
  sentAt?: string;
  resultInfo?: string;
};

export type CatalogShop = 'shopware' | 'shopify' | 'tiktok_shop';

export type CatalogProduct = {
  shop: CatalogShop;
  externalId: string; // Shopware-Produkt-ID bzw. Shopify-Variant-ID
  number: string; // Artikelnummer / SKU
  name: string;
  priceGross: number;
  taxRate: number | null;
};

// Zugangsdaten aller Integrationen (Mobil: SecureStore, Desktop: verschlüsselte Datei).
export const CRED_KEYS = [
  'openaiKey',
  'shopwareUrl',
  'shopwareClientId',
  'shopwareClientSecret',
  'shopwareIds',
  'shopwareBasicUser',
  'shopwareBasicPass',
  'shopifyDomain',
  'shopifyToken',
  'tiktokAppKey',
  'tiktokAppSecret',
  'tiktokAccessToken',
  'tiktokShopCipher',
  'hubspotToken',
  'googleSheetId',
  'googleScriptUrl',
] as const;

export type CredKey = (typeof CRED_KEYS)[number];

// Anzeigenamen der Zielsysteme (Auswahl, Transkript-Liste, Statusmeldungen).
export const TARGET_LABELS: Record<TargetSystem, string> = {
  shopware: 'Shopware',
  shopify: 'Shopify',
  tiktok_shop: 'TikTok Shop',
  hubspot: 'HubSpot',
  email: 'E-Mail',
  google_sheets: 'Google Sheets',
  csv: 'CSV',
};

// Hilfsfunktion: abweichende Lieferanschrift erkannt?
export const deliveryFromFields = (f: ParsedFields): PreviewDelivery => {
  const differs = !!(f.deliveryName || f.deliveryStreet || f.deliveryZip || f.deliveryCity);
  return {
    name: f.deliveryName || '',
    street: f.deliveryStreet || '',
    zip: f.deliveryZip || '',
    city: f.deliveryCity || '',
    differs,
  };
};

export const splitName = (name: string): { firstName: string; lastName: string } => {
  const parts = (name || 'Unbekannt').trim().split(/\s+/);
  return {
    firstName: parts[0] || 'Unbekannt',
    lastName: parts.slice(1).join(' ') || parts[0] || 'Unbekannt',
  };
};
