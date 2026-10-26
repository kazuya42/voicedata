// Einstellungen: KI-Anbieter (OpenAI/OpenRouter/Ollama) und Zugangsdaten aller Integrationen
// der Mobil-App (Shopware, Shopify, TikTok Shop, HubSpot, Google Sheets) inkl. Tests und Artikel-Sync.
import { DEFAULT_LLM_MODEL, DEFAULT_OLLAMA_URL } from '../../../src/lib/llm';
import type { LlmProvider } from '../../../src/lib/llm';
import type { CatalogShop } from '../../../src/lib/types';
import type { Creds, DesktopCredKey, IntegrationTest, Settings } from '../shared/types';
import { $, button, el, errorMessage, showBanner, vd } from './dom';

type FieldDef = {
  key: DesktopCredKey;
  label: string;
  placeholder: string;
  secret?: boolean;
  multiline?: boolean;
};

type SectionDef = {
  title: string;
  fields: FieldDef[];
  test?: { kind: IntegrationTest; ok: string };
  sync?: CatalogShop;
  shopwareIds?: boolean;
};

const SECTIONS: SectionDef[] = [
  {
    title: 'OpenAI',
    fields: [
      {
        key: 'openaiKey',
        label: 'API-Key (Transkription per OpenAI und KI „OpenAI“)',
        placeholder: 'sk-…',
        secret: true,
      },
    ],
    test: { kind: 'openai', ok: 'OpenAI-Key funktioniert.' },
  },
  {
    title: 'OpenRouter',
    fields: [
      {
        key: 'openrouterKey',
        label: 'API-Key (für KI „OpenRouter“)',
        placeholder: 'sk-or-…',
        secret: true,
      },
    ],
  },
  {
    title: 'Shopware',
    fields: [
      { key: 'shopwareUrl', label: 'Shop-URL', placeholder: 'https://mein-shop.de' },
      { key: 'shopwareClientId', label: 'Client-ID (Integration)', placeholder: 'SWIA…' },
      { key: 'shopwareClientSecret', label: 'Client-Secret', placeholder: '•••', secret: true },
      {
        key: 'shopwareIds',
        label: 'Instanz-IDs (JSON, optional – leer = Standard-Testshop)',
        placeholder: '{ … }',
        multiline: true,
      },
      {
        key: 'shopwareBasicUser',
        label: 'HTTP-Basic-Auth Benutzer (optional)',
        placeholder: 'benutzername',
      },
      {
        key: 'shopwareBasicPass',
        label: 'HTTP-Basic-Auth Passwort (optional)',
        placeholder: 'passwort',
        secret: true,
      },
    ],
    test: { kind: 'shopware', ok: 'Shopware-Anmeldung funktioniert.' },
    sync: 'shopware',
    shopwareIds: true,
  },
  {
    title: 'Shopify',
    fields: [
      { key: 'shopifyDomain', label: 'Shop-Domain', placeholder: 'mein-shop.myshopify.com' },
      {
        key: 'shopifyToken',
        label: 'Admin-API-Token (Custom App)',
        placeholder: 'shpat_…',
        secret: true,
      },
    ],
    test: { kind: 'shopify', ok: 'Shopify-Verbindung funktioniert.' },
    sync: 'shopify',
  },
  {
    title: 'TikTok Shop',
    fields: [
      { key: 'tiktokAppKey', label: 'App Key', placeholder: '7xyz…' },
      { key: 'tiktokAppSecret', label: 'App Secret', placeholder: '•••', secret: true },
      {
        key: 'tiktokAccessToken',
        label: 'Access Token (aus Seller Center)',
        placeholder: 'ROW_…',
        secret: true,
      },
      { key: 'tiktokShopCipher', label: 'Shop Cipher', placeholder: 'ROW_…' },
    ],
    test: { kind: 'tiktok_shop', ok: 'TikTok Shop Verbindung funktioniert.' },
    sync: 'tiktok_shop',
  },
  {
    title: 'HubSpot',
    fields: [
      { key: 'hubspotToken', label: 'Private-App-Token', placeholder: 'pat-…', secret: true },
    ],
    test: { kind: 'hubspot', ok: 'HubSpot-Verbindung funktioniert.' },
  },
  {
    title: 'Google Sheets',
    fields: [
      {
        key: 'googleScriptUrl',
        label: 'Apps Script URL (für direkten Push)',
        placeholder: 'https://script.google.com/macros/s/…/exec',
      },
      {
        key: 'googleSheetId',
        label: 'Sheet-ID (optional, für „Sheet öffnen“)',
        placeholder: '1a2b3c4d…',
      },
    ],
  },
];

const inputs = new Map<DesktopCredKey, HTMLInputElement | HTMLTextAreaElement>();
const syncButtons = new Map<CatalogShop, HTMLButtonElement>();

// Zugangsdaten erst speichern, dann mit den gespeicherten Werten arbeiten (wie in der Mobil-App).
async function withSavedCreds(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  btn.disabled = true;
  try {
    await vd.saveCreds(collectCreds());
    await fn();
  } catch (e) {
    showBanner(errorMessage(e));
  } finally {
    btn.disabled = false;
  }
}

async function refreshSyncCounts(): Promise<void> {
  const counts = await vd.catalogCounts();
  for (const [shop, btn] of syncButtons) btn.textContent = `Artikel sync (${counts[shop]})`;
}

export function initCredsForm(): void {
  const root = $('cred-sections');
  for (const section of SECTIONS) {
    const box = el('div', undefined, 'cred-section');
    box.append(el('h2', section.title));
    for (const f of section.fields) {
      const label = el('label', f.label, 'field');
      const input = f.multiline ? el('textarea') : el('input');
      if (input instanceof HTMLInputElement) input.type = f.secret ? 'password' : 'text';
      input.placeholder = f.placeholder;
      input.autocomplete = 'off';
      input.spellcheck = false;
      label.append(input);
      box.append(label);
      inputs.set(f.key, input);
    }
    const actions = el('div', undefined, 'actions');
    if (section.test) {
      const { kind, ok } = section.test;
      const b = button('Verbindung testen', () =>
        withSavedCreds(b, async () => {
          await vd.testIntegration(kind);
          showBanner(ok);
        }),
      );
      actions.append(b);
    }
    if (section.sync) {
      const shop = section.sync;
      const b = button('Artikel sync', () =>
        withSavedCreds(b, async () => {
          b.textContent = 'Synchronisiere…';
          try {
            const n = await vd.syncCatalog(shop);
            showBanner(`${n} Artikel lokal gespeichert.`);
          } finally {
            await refreshSyncCounts();
          }
        }),
      );
      syncButtons.set(shop, b);
      actions.append(b);
    }
    if (section.shopwareIds) {
      const b = button('IDs sync', () =>
        withSavedCreds(b, async () => {
          const json = await vd.syncShopwareIds();
          const field = inputs.get('shopwareIds');
          if (field) field.value = json;
          showBanner('Instanz-IDs wurden automatisch aus dem Shop gelesen und gespeichert.');
        }),
      );
      actions.append(b);
    }
    if (actions.childElementCount) box.append(actions);
    root.append(box);
  }

  // Modellnamen sind anbieterspezifisch → beim Wechsel leeren (dann gilt der Standard).
  $('ai-provider').addEventListener('change', () => {
    $<HTMLInputElement>('ai-model').value = '';
    renderAiFields();
  });
  $('ollama-load-models').addEventListener('click', () => void loadOllamaModels(true));
  $('ai-test').addEventListener('click', async () => {
    const btn = $<HTMLButtonElement>('ai-test');
    btn.disabled = true;
    btn.textContent = 'Teste…';
    try {
      // Erst speichern, damit der Test genau die Auswahl im Formular prüft.
      await vd.saveSettings(collectAiSettings());
      await vd.saveCreds(collectCreds());
      await vd.testIntegration('ai');
      showBanner('KI-Verbindung funktioniert.');
    } catch (e) {
      showBanner(errorMessage(e));
    } finally {
      btn.disabled = false;
      btn.textContent = 'KI testen';
    }
  });
}

function renderAiFields(): void {
  const provider = $<HTMLSelectElement>('ai-provider').value as LlmProvider;
  $('ollama-url-field').classList.toggle('hidden', provider !== 'ollama');
  $('ollama-load-models').classList.toggle('hidden', provider !== 'ollama');
  $('ai-model-hint').textContent =
    provider === 'ollama'
      ? '(installiertes Modell wählen)'
      : `(leer = ${DEFAULT_LLM_MODEL[provider]})`;
  const options = $('ai-model-options');
  if (provider === 'openrouter') {
    options.replaceChildren(
      ...[
        'openai/gpt-4o-mini',
        'anthropic/claude-haiku-4.5',
        'anthropic/claude-sonnet-4.5',
        'google/gemini-2.5-flash',
      ].map((m) => Object.assign(el('option'), { value: m })),
    );
  } else if (provider === 'openai') {
    options.replaceChildren(Object.assign(el('option'), { value: 'gpt-4o-mini' }));
  } else {
    void loadOllamaModels(false);
  }
}

async function loadOllamaModels(announce: boolean): Promise<void> {
  try {
    const models = await vd.listOllamaModels($<HTMLInputElement>('ollama-url').value.trim());
    $('ai-model-options').replaceChildren(
      ...models.map((m) => Object.assign(el('option'), { value: m })),
    );
    if (announce) {
      showBanner(
        models.length
          ? `${models.length} Ollama-Modelle gefunden – im Feld „Modell“ auswählen.`
          : 'Ollama läuft, aber es ist kein Modell installiert (z. B. „ollama pull qwen3:8b“).',
      );
    }
  } catch (e) {
    if (announce) showBanner(errorMessage(e));
  }
}

export async function loadCredsForm(settings: Settings): Promise<void> {
  const creds = await vd.getCreds();
  for (const [key, input] of inputs) input.value = creds[key];
  $<HTMLSelectElement>('ai-provider').value = settings.aiProvider;
  $<HTMLInputElement>('ai-model').value = settings.aiModel;
  $<HTMLInputElement>('ollama-url').value = settings.ollamaUrl || DEFAULT_OLLAMA_URL;
  renderAiFields();
  await refreshSyncCounts();
}

export function collectCreds(): Partial<Creds> {
  const patch: Partial<Creds> = {};
  for (const [key, input] of inputs) patch[key] = input.value;
  return patch;
}

export function collectAiSettings(): Pick<Settings, 'aiProvider' | 'aiModel' | 'ollamaUrl'> {
  return {
    aiProvider: $<HTMLSelectElement>('ai-provider').value as LlmProvider,
    aiModel: $<HTMLInputElement>('ai-model').value.trim(),
    ollamaUrl: $<HTMLInputElement>('ollama-url').value.trim() || DEFAULT_OLLAMA_URL,
  };
}
