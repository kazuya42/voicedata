// TikTok Shop Anbindung (TTS Open API v2).
// Authentifizierung: App Key + App Secret + Access Token + Shop Cipher.
// Jeder Request muss mit HMAC-SHA256 signiert werden (siehe signRequest).
import { ParsedFields, ShopPreview, deliveryFromFields, splitName } from './types';
import { findByNumber, searchCatalog } from './catalog';
import { fetchWithRetry, parseApiError } from './http';

export type TikTokCreds = {
  appKey: string;
  appSecret: string;
  accessToken: string;
  shopCipher: string;
};

const BASE = 'https://open-api.tiktokglobalshop.com';

// HMAC-SHA256 Signierung laut TikTok Shop Partner Center Dokumentation:
// https://partner.tiktokshop.com/docv2/page/sign-your-api-request
// sign_string = app_secret + path + sorted_params_string + body + app_secret
async function signRequest(
  appSecret: string,
  path: string,
  params: Record<string, string>,
  body: string,
): Promise<string> {
  const sorted = Object.entries(params)
    .filter(([k]) => k !== 'sign' && k !== 'access_token')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('');
  const msg = appSecret + path + sorted + body + appSecret;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

// Baut URL mit allen Pflicht-Query-Params (app_key, timestamp, shop_cipher, sign) auf.
async function tiktokFetch(
  creds: TikTokCreds,
  path: string,
  extraParams: Record<string, string> = {},
  init: RequestInit = {},
  retries = 0,
): Promise<Response> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    app_key: creds.appKey,
    timestamp,
    shop_cipher: creds.shopCipher,
    ...extraParams,
  };
  const body = init.body ? String(init.body) : '';
  const sign = await signRequest(creds.appSecret, path, params, body);
  const qs = new URLSearchParams({ ...params, sign }).toString();
  const url = `${BASE}${path}?${qs}`;
  return fetchWithRetry(
    url,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-tts-access-token': creds.accessToken,
        ...(init.headers as Record<string, string> | undefined),
      },
    },
    { timeoutMs: 20_000, retries },
  );
}

// Verbindungstest: Liste der erreichbaren Shops abrufen
export async function testTikTok(creds: TikTokCreds): Promise<void> {
  const response = await tiktokFetch(creds, '/authorization/202309/shops', {}, {}, 1);
  if (!response.ok) throw await parseApiError(response, 'TikTok Shop Verbindung');
  const json = await response.json();
  if (json?.code !== 0) {
    throw new Error(`TikTok Shop Verbindung: ${json?.message || 'Unbekannter Fehler'} (${json?.code})`);
  }
}

// Produkt aus lokalem Katalog oder live per API suchen
async function findTikTokProduct(
  creds: TikTokCreds,
  fields: ParsedFields,
): Promise<{ productId: string; skuId: string; name: string; sku: string; price: number } | null> {
  const local =
    findByNumber('tiktok_shop', fields.productNumber) ||
    searchCatalog('tiktok_shop', fields.productNumber || fields.productName, 1)[0];
  if (local) {
    return {
      productId: local.externalId.split('|')[0] || local.externalId,
      skuId: local.externalId.split('|')[1] || local.externalId,
      name: local.name,
      sku: local.number,
      price: local.priceGross,
    };
  }

  if (!fields.productName) return null;

  const bodyObj = { keyword: fields.productName, page_size: 1 };
  const body = JSON.stringify(bodyObj);
  const response = await tiktokFetch(
    creds,
    '/product/202312/products/search',
    {},
    { method: 'POST', body },
    2,
  );
  if (!response.ok) throw await parseApiError(response, 'TikTok Produktsuche');
  const json = await response.json();
  if (json?.code !== 0) return null;

  const product = json?.data?.products?.[0];
  const sku = product?.skus?.[0];
  if (!product || !sku) return null;

  return {
    productId: String(product.id),
    skuId: String(sku.id),
    name: product.title || fields.productName,
    sku: sku.seller_sku || String(sku.id),
    price: parseFloat(sku.price?.original_price || '0'),
  };
}

// Vorschau ohne Nebenwirkungen
export async function tiktokPreview(fields: ParsedFields, creds: TikTokCreds): Promise<ShopPreview> {
  const product = await findTikTokProduct(creds, fields);
  return {
    type: 'tiktok_preview',
    customer: {
      name: fields.customerName,
      email: fields.customerEmail,
      street: fields.customerStreet,
      zip: fields.customerZip,
      city: fields.customerCity,
      isNew: true,
      id: null,
    },
    product: {
      name: product ? product.name : fields.productName,
      number: product ? product.sku : fields.productNumber || 'N/A',
      quantity: fields.quantity,
      found: !!product,
      id: product ? product.skuId : null,
      priceGross: product?.price,
    },
    delivery: deliveryFromFields(fields),
  };
}

// Bestellung anlegen — nicht idempotent, kein Auto-Retry (Doppelbestellung vermeiden).
export async function tiktokConfirmOrder(
  fields: ParsedFields,
  creds: TikTokCreds,
): Promise<{ orderNumber: string; total: number }> {
  const product = await findTikTokProduct(creds, fields);
  if (!product) throw new Error('Produkt nicht in TikTok Shop gefunden.');

  const { firstName, lastName } = splitName(fields.customerName);
  const deliv = deliveryFromFields(fields);
  const delivName = splitName(deliv.name || fields.customerName);

  const shippingAddress = deliv.differs
    ? {
        first_name: delivName.firstName,
        last_name: delivName.lastName,
        address_line1: deliv.street || fields.customerStreet || '',
        postal_code: deliv.zip || fields.customerZip || '',
        city: deliv.city || fields.customerCity || '',
        country_code: 'DE',
      }
    : {
        first_name: firstName,
        last_name: lastName,
        address_line1: fields.customerStreet || '',
        postal_code: fields.customerZip || '',
        city: fields.customerCity || '',
        country_code: 'DE',
      };

  const orderBody = JSON.stringify({
    buyer_email: fields.customerEmail,
    line_items: [
      {
        product_id: product.productId,
        sku_id: product.skuId,
        quantity: Math.max(1, fields.quantity || 1),
      },
    ],
    recipient_address: shippingAddress,
  });

  const response = await tiktokFetch(
    creds,
    '/order/202309/orders',
    {},
    { method: 'POST', body: orderBody },
  );
  if (!response.ok) throw await parseApiError(response, 'TikTok Shop Bestellung anlegen');
  const json = await response.json();
  if (json?.code !== 0) {
    throw new Error(`TikTok Bestellung fehlgeschlagen: ${json?.message || 'Unbekannter Fehler'}`);
  }

  const order = json?.data;
  return {
    orderNumber: order?.order_id || order?.order_number || 'unbekannt',
    total: parseFloat(order?.payment?.total_amount || '0'),
  };
}

// Alle Produkte/SKUs für den lokalen Katalog laden (paginiert)
export async function fetchAllTikTokProducts(creds: TikTokCreds): Promise<
  { externalId: string; number: string; name: string; priceGross: number; taxRate: number | null }[]
> {
  const out: {
    externalId: string;
    number: string;
    name: string;
    priceGross: number;
    taxRate: number | null;
  }[] = [];

  let pageToken: string | null = null;
  let guard = 0;

  while (guard < 200) {
    guard += 1;
    const bodyObj: Record<string, unknown> = { page_size: 100, status: 'ACTIVATE' };
    if (pageToken) bodyObj.page_token = pageToken;
    const body = JSON.stringify(bodyObj);

    const response = await tiktokFetch(
      creds,
      '/product/202312/products/search',
      {},
      { method: 'POST', body },
      2,
    );
    if (!response.ok) throw await parseApiError(response, 'TikTok Produkt-Sync');
    const json = await response.json();
    if (json?.code !== 0) throw new Error(`TikTok Produkt-Sync: ${json?.message}`);

    for (const p of json?.data?.products || []) {
      for (const sku of p.skus || []) {
        const skuLabel = sku.sales_attributes?.map((a: any) => a.value_name).join(' / ');
        const name = skuLabel ? `${p.title} – ${skuLabel}` : p.title;
        out.push({
          // externalId = "productId|skuId" damit findTikTokProduct beide Teile hat
          externalId: `${p.id}|${sku.id}`,
          number: sku.seller_sku || String(sku.id),
          name,
          priceGross: parseFloat(sku.price?.original_price || '0'),
          taxRate: null,
        });
      }
    }

    pageToken = json?.data?.next_page_token || null;
    if (!pageToken) break;
  }

  return out;
}
