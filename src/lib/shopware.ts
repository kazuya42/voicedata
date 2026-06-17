// Direkte Shopware-6-Anbindung (Admin-API). Port der n8n-Kette mit allen Learnings:
// - Suchantworten haben top-level `total` (kein meta.total) bei Accept: application/json
// - POST /api/customer liefert 204 -> `?_response=basic` anhängen, Entity steht in `data`
// - Order-LineItems vom Typ product brauchen `payload.productNumber`
// - Bestellnummer via GET /api/_action/number-range/reserve/order
// - MwSt aus Produkt-Tax (associations.tax), Lieferanschrift in deliveries[], Zahlung Vorkasse in transactions[]
// - Kunde wird erst beim Bestätigen angelegt (nicht mehr bei der Vorschau)
import { ParsedFields, ShopPreview, deliveryFromFields, splitName } from './types';
import { fetchWithRetry, parseApiError } from './http';

// Instanz-spezifische Shopware-IDs. Pro Shop unterschiedlich – in den Einstellungen
// als JSON überschreibbar (siehe parseShopwareIds), sonst gelten die Defaults unten.
export type ShopwareIds = {
  currencyId: string;
  languageId: string;
  salesChannelId: string;
  orderStateOpen: string;
  countryId: string;
  salutationId: string;
  customerGroupId: string;
  paymentVorkasse: string;
  transactionStateOpen: string;
  shippingStandard: string;
  deliveryStateOpen: string;
};

// Defaults aus dem bisherigen Workflow übernommen (Testshop yakuza.bravion.de).
export const DEFAULT_SHOPWARE_IDS: ShopwareIds = {
  currencyId: 'b7d2554b0ce847cd82f3ac9bd1c0dfca',
  languageId: '2fbb5fe2e29a4d70aa5854ce7ce3e20b',
  salesChannelId: '019c14a31441723b8a3a5173f49b5795',
  orderStateOpen: '019c14a2d1a172469634ef7cb4638511',
  countryId: '019c14a2d10372a4be16521bf892db25',
  salutationId: '019c14a2d1027002b495f96502a19438',
  customerGroupId: 'cfbd5018d38d41d8adca10d94fc8bdd6',
  paymentVorkasse: '019c14a2d16b725a937772e8e4e91625',
  transactionStateOpen: '019c14a2d1ac7181a4f509c1c5e1f5c5',
  shippingStandard: '019c14a2d16f702d8216971ab1853288',
  deliveryStateOpen: '019c14a2d1a7702188e8cd5c47967563',
};

export type ShopwareCreds = {
  url: string;
  clientId: string;
  clientSecret: string;
  // Optionaler Override der Instanz-IDs (gemerged über DEFAULT_SHOPWARE_IDS).
  ids?: Partial<ShopwareIds>;
};

// JSON-String aus den Einstellungen robust in ein ShopwareIds-Teilobjekt parsen.
// Leerer/ungültiger Input -> {} (es gelten dann die Defaults).
export function parseShopwareIds(json: string | undefined | null): Partial<ShopwareIds> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Partial<ShopwareIds> = {};
    for (const key of Object.keys(DEFAULT_SHOPWARE_IDS) as (keyof ShopwareIds)[]) {
      const v = parsed[key];
      if (typeof v === 'string' && v.trim()) out[key] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

const effectiveIds = (creds: ShopwareCreds): ShopwareIds => ({
  ...DEFAULT_SHOPWARE_IDS,
  ...(creds.ids || {}),
});

let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

const cleanUrl = (url: string) => url.trim().replace(/\/+$/, '');

export async function getShopwareToken(creds: ShopwareCreds): Promise<string> {
  const key = `${creds.url}|${creds.clientId}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token;
  }
  const response = await fetchWithRetry(
    `${cleanUrl(creds.url)}/api/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    },
    { retries: 2 },
  );
  if (!response.ok) throw await parseApiError(response, 'Shopware-Anmeldung fehlgeschlagen');
  const json = await response.json();
  tokenCache = {
    key,
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 600) * 1000,
  };
  return json.access_token;
}

async function swSearch(
  creds: ShopwareCreds,
  token: string,
  entity: string,
  payload: any,
): Promise<{ total: number; data: any[] }> {
  const response = await fetchWithRetry(
    `${cleanUrl(creds.url)}/api/search/${entity}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
    { retries: 2 },
  );
  if (!response.ok) throw await parseApiError(response, `Shopware-Suche ${entity}`);
  const json = await response.json();
  // top-level `total`; defensiv auch meta.total unterstützen
  return { total: json.total ?? json.meta?.total ?? 0, data: json.data || [] };
}

async function findCustomerByEmail(
  creds: ShopwareCreds,
  token: string,
  email: string,
): Promise<any | null> {
  const res = await swSearch(creds, token, 'customer', {
    filter: [{ type: 'equals', field: 'email', value: email }],
    associations: { defaultBillingAddress: {} },
  });
  return res.total > 0 ? res.data[0] : null;
}

async function findProduct(
  creds: ShopwareCreds,
  token: string,
  fields: ParsedFields,
): Promise<any | null> {
  const payload = fields.productNumber
    ? {
        filter: [{ type: 'equals', field: 'productNumber', value: fields.productNumber }],
        associations: { tax: {} },
      }
    : {
        filter: [{ type: 'contains', field: 'name', value: fields.productName }],
        associations: { tax: {} },
      };
  const res = await swSearch(creds, token, 'product', payload);
  return res.data.length > 0 ? res.data[0] : null;
}

// Vorschau OHNE Nebenwirkungen: Kunde wird nur gesucht, nie angelegt
export async function shopwarePreview(
  fields: ParsedFields,
  creds: ShopwareCreds,
): Promise<ShopPreview> {
  const token = await getShopwareToken(creds);
  const [customer, product] = await Promise.all([
    findCustomerByEmail(creds, token, fields.customerEmail),
    findProduct(creds, token, fields),
  ]);
  return {
    type: 'shopware_preview',
    customer: {
      name: fields.customerName,
      email: fields.customerEmail,
      street: fields.customerStreet,
      zip: fields.customerZip,
      city: fields.customerCity,
      isNew: !customer,
      id: customer ? customer.id : null,
    },
    product: {
      name: product ? product.name : fields.productName,
      number: product ? product.productNumber : fields.productNumber || 'N/A',
      quantity: fields.quantity,
      found: !!product,
      id: product ? product.id : null,
      priceGross: product ? (product.price?.[0]?.gross ?? 0) : undefined,
    },
    delivery: deliveryFromFields(fields),
  };
}

async function createCustomer(
  creds: ShopwareCreds,
  token: string,
  fields: ParsedFields,
): Promise<any> {
  const { firstName, lastName } = splitName(fields.customerName);
  const ids = effectiveIds(creds);
  // Kunde anlegen = nicht idempotent -> kein Auto-Retry (Doppelanlage vermeiden).
  const response = await fetchWithRetry(`${cleanUrl(creds.url)}/api/customer?_response=basic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      firstName,
      lastName,
      email: fields.customerEmail,
      salutationId: ids.salutationId,
      groupId: ids.customerGroupId,
      defaultPaymentMethodId: ids.paymentVorkasse,
      salesChannelId: ids.salesChannelId,
      customerNumber: Math.floor(Math.random() * 100000).toString(),
      defaultBillingAddress: {
        firstName,
        lastName,
        street: fields.customerStreet || 'Dummy Str. 1',
        zipcode: fields.customerZip || '12345',
        city: fields.customerCity || 'Dummy City',
        countryId: ids.countryId,
        salutationId: ids.salutationId,
      },
    }),
  });
  if (!response.ok) throw await parseApiError(response, 'Shopware-Kunde anlegen');
  const json = await response.json();
  const created = json.data || json;
  if (!created.id) throw new Error('Shopware-Kunde angelegt, aber keine ID erhalten.');
  return created;
}

async function reserveOrderNumber(creds: ShopwareCreds, token: string): Promise<string> {
  const response = await fetchWithRetry(
    `${cleanUrl(creds.url)}/api/_action/number-range/reserve/order`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } },
    { retries: 1 },
  );
  if (!response.ok) throw await parseApiError(response, 'Bestellnummer reservieren');
  const json = await response.json();
  if (!json.number) throw new Error('Keine Bestellnummer vom NumberRange erhalten.');
  return String(json.number);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// Bestellung anlegen. Legt den Kunden hier (und erst hier) an, falls er noch nicht existiert.
export async function shopwareConfirmOrder(
  fields: ParsedFields,
  creds: ShopwareCreds,
): Promise<{ orderNumber: string; total: number; customerWasCreated: boolean }> {
  const token = await getShopwareToken(creds);
  const ids = effectiveIds(creds);

  let customer = await findCustomerByEmail(creds, token, fields.customerEmail);
  let customerWasCreated = false;
  if (!customer) {
    customer = await createCustomer(creds, token, fields);
    customerWasCreated = true;
    // frisch angelegte Kunden mit Adress-Association nachladen
    customer = (await findCustomerByEmail(creds, token, fields.customerEmail)) || customer;
  }

  const product = await findProduct(creds, token, fields);
  if (!product) throw new Error('Produkt nicht in Shopware gefunden.');

  const billingAddressId = customer.defaultBillingAddressId;
  if (!billingAddressId) throw new Error('Kunde hat keine Rechnungsadresse.');

  const orderNumber = await reserveOrderNumber(creds, token);

  const qty = Math.max(1, fields.quantity || 1);
  const gross = product.price?.[0]?.gross ?? 0;
  const total = round2(gross * qty);
  const taxRate = product.tax?.taxRate ?? 19;
  const taxAmount = round2((total * taxRate) / (100 + taxRate));
  const calculatedTaxes = [{ tax: taxAmount, taxRate, price: total }];
  const taxRules = [{ taxRate, percentage: 100 }];
  const rounding = { decimals: 2, interval: 0.01, roundForNet: true };

  // Lieferanschrift: abweichende Angaben gewinnen, sonst Rechnungsanschrift
  const addrSrc = customer.defaultBillingAddress || {};
  const deliv = deliveryFromFields(fields);
  const delivName = splitName(deliv.name || '');
  const billName = splitName(
    fields.customerName || `${customer.firstName || ''} ${customer.lastName || ''}`,
  );
  const shippingOrderAddress = {
    firstName: deliv.name ? delivName.firstName : customer.firstName || billName.firstName,
    lastName: deliv.name ? delivName.lastName : customer.lastName || billName.lastName,
    street: deliv.street || fields.customerStreet || addrSrc.street || 'Unbekannt',
    zipcode: deliv.zip || fields.customerZip || addrSrc.zipcode || '',
    city: deliv.city || fields.customerCity || addrSrc.city || 'Unbekannt',
    countryId: addrSrc.countryId || ids.countryId,
    salutationId: ids.salutationId,
  };

  const orderPayload = {
    orderNumber,
    orderCustomer: {
      customerId: customer.id,
      email: fields.customerEmail || customer.email,
      firstName: customer.firstName || billName.firstName,
      lastName: customer.lastName || billName.lastName,
    },
    currencyId: ids.currencyId,
    currencyFactor: 1,
    languageId: ids.languageId,
    salesChannelId: ids.salesChannelId,
    billingAddressId,
    stateId: ids.orderStateOpen,
    orderDateTime: new Date().toISOString(),
    itemRounding: rounding,
    totalRounding: rounding,
    price: {
      netPrice: round2(total - taxAmount),
      totalPrice: total,
      rawTotal: total,
      positionPrice: total,
      calculatedTaxes,
      taxRules,
      taxStatus: 'gross',
    },
    shippingCosts: {
      unitPrice: 0,
      totalPrice: 0,
      quantity: 1,
      calculatedTaxes: [{ tax: 0, taxRate, price: 0 }],
      taxRules,
    },
    transactions: [
      {
        paymentMethodId: ids.paymentVorkasse,
        stateId: ids.transactionStateOpen,
        amount: { unitPrice: total, totalPrice: total, quantity: 1, calculatedTaxes, taxRules },
      },
    ],
    deliveries: [
      {
        stateId: ids.deliveryStateOpen,
        shippingMethodId: ids.shippingStandard,
        shippingCosts: {
          unitPrice: 0,
          totalPrice: 0,
          quantity: 1,
          calculatedTaxes: [{ tax: 0, taxRate, price: 0 }],
          taxRules,
        },
        shippingDateEarliest: new Date().toISOString(),
        shippingDateLatest: new Date(Date.now() + 3 * 86400000).toISOString(),
        shippingOrderAddress,
      },
    ],
    lineItems: [
      {
        type: 'product',
        identifier: product.id,
        referencedId: product.id,
        productId: product.id,
        label: product.name || fields.productName || 'Produkt',
        quantity: qty,
        position: 1,
        states: ['is-physical'],
        payload: { productNumber: product.productNumber || fields.productNumber },
        price: { unitPrice: gross, totalPrice: total, quantity: qty, calculatedTaxes, taxRules },
      },
    ],
  };

  // Bestellung anlegen = nicht idempotent -> kein Auto-Retry (Doppelbestellung vermeiden).
  const response = await fetchWithRetry(`${cleanUrl(creds.url)}/api/order?_response=basic`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(orderPayload),
  });
  if (!response.ok) throw await parseApiError(response, 'Shopware-Bestellung anlegen');
  return { orderNumber, total, customerWasCreated };
}

// Verbindungstest für den Settings-Screen
export async function testShopware(creds: ShopwareCreds): Promise<void> {
  tokenCache = null;
  await getShopwareToken(creds);
}

// Alle (Haupt-)Produkte seitenweise für den lokalen Katalog laden
export async function fetchAllShopwareProducts(
  creds: ShopwareCreds,
): Promise<
  { externalId: string; number: string; name: string; priceGross: number; taxRate: number | null }[]
> {
  const token = await getShopwareToken(creds);
  const out: {
    externalId: string;
    number: string;
    name: string;
    priceGross: number;
    taxRate: number | null;
  }[] = [];
  let page = 1;
  const limit = 100;
  for (;;) {
    const res = await swSearch(creds, token, 'product', {
      page,
      limit,
      filter: [{ type: 'equals', field: 'parentId', value: null }],
      associations: { tax: {} },
    });
    for (const p of res.data) {
      out.push({
        externalId: p.id,
        number: p.productNumber || '',
        name: p.name || '',
        priceGross: p.price?.[0]?.gross ?? 0,
        taxRate: p.tax?.taxRate ?? null,
      });
    }
    if (res.data.length < limit) break;
    page += 1;
    if (page > 200) break; // Sicherheitsgrenze (20k Artikel)
  }
  return out;
}
