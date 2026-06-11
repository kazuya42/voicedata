// Direkte Shopify-Anbindung (Admin REST API, Custom-App-Token).
// Produkt-Sync für den lokalen Katalog, Kunden-Suche, Bestellung mit Liefer-/Rechnungsanschrift.
import { ParsedFields, ShopPreview, deliveryFromFields, splitName } from './types';
import { findByNumber, searchCatalog } from './catalog';

export type ShopifyCreds = {
  domain: string; // z.B. mein-shop.myshopify.com
  token: string; // shpat_...
};

const API_VERSION = '2025-01';

const baseUrl = (creds: ShopifyCreds) =>
  `https://${creds.domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')}/admin/api/${API_VERSION}`;

const headers = (creds: ShopifyCreds) => ({
  'X-Shopify-Access-Token': creds.token,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

async function shopifyError(response: Response, context: string): Promise<Error> {
  let msg = `${context}: HTTP ${response.status}`;
  try {
    const j = await response.json();
    if (j?.errors) msg += ` – ${typeof j.errors === 'string' ? j.errors : JSON.stringify(j.errors)}`;
  } catch {}
  return new Error(msg);
}

export async function testShopify(creds: ShopifyCreds): Promise<void> {
  const response = await fetch(`${baseUrl(creds)}/shop.json`, { headers: headers(creds) });
  if (!response.ok) throw await shopifyError(response, 'Shopify-Verbindung');
}

async function findShopifyCustomer(creds: ShopifyCreds, email: string): Promise<any | null> {
  const response = await fetch(
    `${baseUrl(creds)}/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`,
    { headers: headers(creds) }
  );
  if (!response.ok) throw await shopifyError(response, 'Shopify-Kundensuche');
  const json = await response.json();
  return json.customers?.[0] || null;
}

// Variante zum Produkt finden: zuerst lokaler Katalog (SKU/Name), dann Live-Suche per Titel
async function findVariant(
  creds: ShopifyCreds,
  fields: ParsedFields
): Promise<{ variantId: string; name: string; sku: string; price: number } | null> {
  const local =
    findByNumber('shopify', fields.productNumber) ||
    searchCatalog('shopify', fields.productNumber || fields.productName, 1)[0];
  if (local) {
    return { variantId: local.externalId, name: local.name, sku: local.number, price: local.priceGross };
  }
  if (!fields.productName) return null;
  const response = await fetch(
    `${baseUrl(creds)}/products.json?title=${encodeURIComponent(fields.productName)}&limit=1`,
    { headers: headers(creds) }
  );
  if (!response.ok) throw await shopifyError(response, 'Shopify-Produktsuche');
  const json = await response.json();
  const p = json.products?.[0];
  const v = p?.variants?.[0];
  if (!p || !v) return null;
  return { variantId: String(v.id), name: p.title, sku: v.sku || '', price: parseFloat(v.price) || 0 };
}

// Vorschau ohne Nebenwirkungen
export async function shopifyPreview(fields: ParsedFields, creds: ShopifyCreds): Promise<ShopPreview> {
  const [customer, variant] = await Promise.all([
    findShopifyCustomer(creds, fields.customerEmail),
    findVariant(creds, fields),
  ]);
  return {
    type: 'shopify_preview',
    customer: {
      name: fields.customerName,
      email: fields.customerEmail,
      street: fields.customerStreet,
      zip: fields.customerZip,
      city: fields.customerCity,
      isNew: !customer,
      id: customer ? String(customer.id) : null,
    },
    product: {
      name: variant ? variant.name : fields.productName,
      number: variant ? variant.sku : fields.productNumber || 'N/A',
      quantity: fields.quantity,
      found: !!variant,
      id: variant ? variant.variantId : null,
      priceGross: variant?.price,
    },
    delivery: deliveryFromFields(fields),
  };
}

// Bestellung anlegen (financial_status pending ≙ Vorkasse)
export async function shopifyConfirmOrder(
  fields: ParsedFields,
  creds: ShopifyCreds
): Promise<{ orderNumber: string; total: number; customerWasCreated: boolean }> {
  const variant = await findVariant(creds, fields);
  if (!variant) throw new Error('Produkt nicht in Shopify gefunden.');

  const existing = await findShopifyCustomer(creds, fields.customerEmail);
  const { firstName, lastName } = splitName(fields.customerName);
  const deliv = deliveryFromFields(fields);
  const delivName = splitName(deliv.name || fields.customerName);

  const billing_address = {
    first_name: firstName,
    last_name: lastName,
    address1: fields.customerStreet || '',
    zip: fields.customerZip || '',
    city: fields.customerCity || '',
    country_code: 'DE',
  };
  const shipping_address = deliv.differs
    ? {
        first_name: delivName.firstName,
        last_name: delivName.lastName,
        address1: deliv.street || billing_address.address1,
        zip: deliv.zip || billing_address.zip,
        city: deliv.city || billing_address.city,
        country_code: 'DE',
      }
    : billing_address;

  const orderBody = {
    order: {
      line_items: [{ variant_id: Number(variant.variantId), quantity: Math.max(1, fields.quantity || 1) }],
      customer: existing
        ? { id: existing.id }
        : { first_name: firstName, last_name: lastName, email: fields.customerEmail },
      email: fields.customerEmail,
      billing_address,
      shipping_address,
      financial_status: 'pending',
      inventory_behaviour: 'decrement_obeying_policy',
      send_receipt: false,
      send_fulfillment_receipt: false,
    },
  };

  const response = await fetch(`${baseUrl(creds)}/orders.json`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify(orderBody),
  });
  if (!response.ok) throw await shopifyError(response, 'Shopify-Bestellung anlegen');
  const json = await response.json();
  const order = json.order;
  return {
    orderNumber: order?.name || String(order?.order_number || ''),
    total: parseFloat(order?.total_price || '0'),
    customerWasCreated: !existing,
  };
}

// Alle Produkte/Varianten seitenweise für den lokalen Katalog laden (page_info-Pagination)
export async function fetchAllShopifyProducts(
  creds: ShopifyCreds
): Promise<{ externalId: string; number: string; name: string; priceGross: number; taxRate: number | null }[]> {
  const out: { externalId: string; number: string; name: string; priceGross: number; taxRate: number | null }[] = [];
  let url: string | null = `${baseUrl(creds)}/products.json?limit=250&fields=id,title,variants`;
  let guard = 0;
  while (url && guard < 200) {
    guard += 1;
    const response: Response = await fetch(url, { headers: headers(creds) });
    if (!response.ok) throw await shopifyError(response, 'Shopify-Produkt-Sync');
    const json = await response.json();
    for (const p of json.products || []) {
      for (const v of p.variants || []) {
        const variantTitle = v.title && v.title !== 'Default Title' ? ` – ${v.title}` : '';
        out.push({
          externalId: String(v.id),
          number: v.sku || String(v.id),
          name: `${p.title}${variantTitle}`,
          priceGross: parseFloat(v.price) || 0,
          taxRate: null,
        });
      }
    }
    // Link-Header: <url>; rel="next"
    const link = response.headers.get('link') || response.headers.get('Link');
    const next = link?.split(',').find((part) => part.includes('rel="next"'));
    url = next ? next.substring(next.indexOf('<') + 1, next.indexOf('>')) : null;
  }
  return out;
}
