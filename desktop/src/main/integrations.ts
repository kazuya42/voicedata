// Zielsysteme der Mobil-App (Shopware, Shopify, TikTok Shop, HubSpot, Google Sheets, CSV, E-Mail)
// im Desktop-Main-Prozess. Nutzt dieselben Module aus src/lib wie die Mobil-App; im Main-Prozess
// gibt es kein CORS, daher funktionieren alle Shop-Ziele (anders als in der Web-Version).
import type { HubspotCreds } from '../../../src/lib/hubspot';
import { hubspotConfirm, hubspotPreview, testHubspot } from '../../../src/lib/hubspot';
import {
  buildCsv,
  buildEmailText,
  buildSheetsRow,
  pushToGoogleSheets,
} from '../../../src/lib/localTargets';
import type { ShopifyCreds } from '../../../src/lib/shopify';
import {
  fetchAllShopifyProducts,
  shopifyConfirmOrder,
  shopifyPreview,
  testShopify,
} from '../../../src/lib/shopify';
import type { ShopwareCreds } from '../../../src/lib/shopware';
import {
  fetchAllShopwareProducts,
  parseShopwareIds,
  shopwareConfirmOrder,
  shopwarePreview,
  syncShopwareIds,
  testShopware,
} from '../../../src/lib/shopware';
import type { TikTokCreds } from '../../../src/lib/tiktok';
import {
  fetchAllTikTokProducts,
  testTikTok,
  tiktokConfirmOrder,
  tiktokPreview,
} from '../../../src/lib/tiktok';
import { replaceCatalog } from '../../../src/lib/catalog';
import { testLlm } from '../../../src/lib/llm';
import type {
  CatalogShop,
  HubspotPreview,
  ParsedFields,
  PreviewData,
  TargetSystem,
} from '../../../src/lib/types';
import { validateForTarget } from '../../../src/lib/validate';
import type { Creds, IntegrationTest } from '../shared/types';
import { getCreds, saveCreds } from './credentials';
import { testOpenAI } from './engines/openai';
import { getLlmConfig } from './settings';

function shopwareCreds(c: Creds): ShopwareCreds {
  if (!c.shopwareUrl || !c.shopwareClientId || !c.shopwareClientSecret) {
    throw new Error('Shopware-Zugangsdaten fehlen (Einstellungen).');
  }
  return {
    url: c.shopwareUrl,
    clientId: c.shopwareClientId,
    clientSecret: c.shopwareClientSecret,
    ids: parseShopwareIds(c.shopwareIds),
    basicUser: c.shopwareBasicUser || undefined,
    basicPass: c.shopwareBasicPass || undefined,
  };
}

function shopifyCreds(c: Creds): ShopifyCreds {
  if (!c.shopifyDomain || !c.shopifyToken) {
    throw new Error('Shopify-Zugangsdaten fehlen (Einstellungen).');
  }
  return { domain: c.shopifyDomain, token: c.shopifyToken };
}

function tiktokCreds(c: Creds): TikTokCreds {
  if (!c.tiktokAppKey || !c.tiktokAppSecret || !c.tiktokAccessToken || !c.tiktokShopCipher) {
    throw new Error('TikTok Shop Zugangsdaten fehlen (Einstellungen).');
  }
  return {
    appKey: c.tiktokAppKey,
    appSecret: c.tiktokAppSecret,
    accessToken: c.tiktokAccessToken,
    shopCipher: c.tiktokShopCipher,
  };
}

function hubspotCreds(c: Creds): HubspotCreds {
  if (!c.hubspotToken) throw new Error('HubSpot-Token fehlt (Einstellungen).');
  return { token: c.hubspotToken };
}

export async function testIntegration(kind: IntegrationTest): Promise<void> {
  const c = getCreds();
  if (kind === 'openai') {
    if (!c.openaiKey) throw new Error('OpenAI-Key fehlt');
    return testOpenAI(c.openaiKey);
  }
  if (kind === 'ai') return testLlm(getLlmConfig());
  if (kind === 'shopware') return testShopware(shopwareCreds(c));
  if (kind === 'shopify') return testShopify(shopifyCreds(c));
  if (kind === 'tiktok_shop') return testTikTok(tiktokCreds(c));
  return testHubspot(hubspotCreds(c));
}

// Lädt alle Artikel des Shops und ersetzt den lokalen Katalog; liefert die Anzahl.
export async function syncCatalog(shop: CatalogShop): Promise<number> {
  const c = getCreds();
  const products =
    shop === 'shopware'
      ? await fetchAllShopwareProducts(shopwareCreds(c))
      : shop === 'shopify'
        ? await fetchAllShopifyProducts(shopifyCreds(c))
        : await fetchAllTikTokProducts(tiktokCreds(c));
  replaceCatalog(
    shop,
    products.map((p) => ({ shop, ...p })),
  );
  return products.length;
}

// Liest die Instanz-IDs aus dem Shop, speichert sie und liefert sie als JSON (für das Formular).
export async function syncShopwareInstanceIds(): Promise<string> {
  const ids = await syncShopwareIds(shopwareCreds(getCreds()));
  const json = JSON.stringify(ids, null, 2);
  saveCreds({ shopwareIds: json });
  return json;
}

export async function previewOrder(
  target: TargetSystem,
  fields: ParsedFields,
): Promise<PreviewData> {
  const errors = validateForTarget(fields, target);
  if (errors.length) throw new Error(errors.join('\n'));
  const c = getCreds();
  if (target === 'shopware') return shopwarePreview(fields, shopwareCreds(c));
  if (target === 'shopify') return shopifyPreview(fields, shopifyCreds(c));
  if (target === 'tiktok_shop') return tiktokPreview(fields, tiktokCreds(c));
  if (target === 'hubspot') return hubspotPreview(fields, hubspotCreds(c));
  if (target === 'csv') return buildCsv(fields);
  if (target === 'email') return buildEmailText(fields);
  return buildSheetsRow(fields, c.googleSheetId);
}

// Schreibender Schritt (Bestellung/Kontakt anlegen) – nie automatisch wiederholen.
export async function confirmOrder(
  target: TargetSystem,
  fields: ParsedFields,
  preview: PreviewData,
): Promise<string> {
  const c = getCreds();
  if (target === 'shopware') {
    const r = await shopwareConfirmOrder(fields, shopwareCreds(c));
    return `Bestellung ${r.orderNumber} erfolgreich in Shopware angelegt (${r.total.toFixed(2)} €).`;
  }
  if (target === 'shopify') {
    const r = await shopifyConfirmOrder(fields, shopifyCreds(c));
    return `Bestellung ${r.orderNumber} erfolgreich in Shopify angelegt (${r.total.toFixed(2)}).`;
  }
  if (target === 'tiktok_shop') {
    const r = await tiktokConfirmOrder(fields, tiktokCreds(c));
    return `Bestellung ${r.orderNumber} erfolgreich in TikTok Shop angelegt (${r.total.toFixed(2)} €).`;
  }
  if (target === 'hubspot') {
    const amount = preview.type === 'hubspot_preview' ? (preview as HubspotPreview).amount : null;
    const r = await hubspotConfirm(fields, hubspotCreds(c), amount);
    return `HubSpot: Kontakt ${r.contactWasCreated ? 'angelegt' : 'aktualisiert'} und Deal „${r.dealName}“ erstellt.`;
  }
  throw new Error('Für dieses Ziel gibt es keinen Bestätigungsschritt.');
}

export async function pushOrderToSheets(fields: ParsedFields): Promise<string> {
  await pushToGoogleSheets(fields, getCreds().googleScriptUrl);
  return 'Zeile erfolgreich in Google Sheets eingetragen.';
}
