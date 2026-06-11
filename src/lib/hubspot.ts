// Direkte HubSpot-Anbindung (CRM v3/v4, Private-App-Token).
// Ziel-Verhalten: Kontakt anlegen/aktualisieren (Suche per E-Mail) + Deal mit Association.
import { HubspotPreview, ParsedFields, splitName } from './types';

export type HubspotCreds = { token: string };

const BASE = 'https://api.hubapi.com';

const headers = (creds: HubspotCreds) => ({
  Authorization: `Bearer ${creds.token}`,
  'Content-Type': 'application/json',
});

async function hsError(response: Response, context: string): Promise<Error> {
  let msg = `${context}: HTTP ${response.status}`;
  try {
    const j = await response.json();
    if (j?.message) msg += ` – ${j.message}`;
  } catch {}
  return new Error(msg);
}

export async function testHubspot(creds: HubspotCreds): Promise<void> {
  const response = await fetch(`${BASE}/crm/v3/objects/contacts?limit=1`, { headers: headers(creds) });
  if (!response.ok) throw await hsError(response, 'HubSpot-Verbindung');
}

async function findContactByEmail(creds: HubspotCreds, email: string): Promise<any | null> {
  const response = await fetch(`${BASE}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
      properties: ['email', 'firstname', 'lastname'],
      limit: 1,
    }),
  });
  if (!response.ok) throw await hsError(response, 'HubSpot-Kontaktsuche');
  const json = await response.json();
  return json.results?.[0] || null;
}

const dealName = (fields: ParsedFields) =>
  `${Math.max(1, fields.quantity || 1)}x ${fields.productName || fields.productNumber || 'Produkt'} – ${fields.customerName || 'Unbekannt'}`;

// Vorschau ohne Nebenwirkungen
export async function hubspotPreview(fields: ParsedFields, creds: HubspotCreds): Promise<HubspotPreview> {
  const contact = await findContactByEmail(creds, fields.customerEmail);
  return {
    type: 'hubspot_preview',
    contact: {
      name: fields.customerName,
      email: fields.customerEmail,
      isNew: !contact,
      id: contact ? contact.id : null,
    },
    dealName: dealName(fields),
    amount: null,
  };
}

async function getDefaultPipelineStage(creds: HubspotCreds): Promise<{ pipeline: string; stage: string }> {
  const response = await fetch(`${BASE}/crm/v3/pipelines/deals`, { headers: headers(creds) });
  if (!response.ok) throw await hsError(response, 'HubSpot-Pipelines laden');
  const json = await response.json();
  const pipeline = json.results?.find((p: any) => p.id === 'default') || json.results?.[0];
  if (!pipeline) throw new Error('Keine Deal-Pipeline in HubSpot gefunden.');
  const stage = pipeline.stages?.sort((a: any, b: any) => a.displayOrder - b.displayOrder)?.[0];
  if (!stage) throw new Error('Keine Deal-Stage in HubSpot gefunden.');
  return { pipeline: pipeline.id, stage: stage.id };
}

// Kontakt anlegen/aktualisieren + Deal anlegen + verknüpfen
export async function hubspotConfirm(
  fields: ParsedFields,
  creds: HubspotCreds,
  amount?: number | null
): Promise<{ contactId: string; dealId: string; dealName: string; contactWasCreated: boolean }> {
  const { firstName, lastName } = splitName(fields.customerName);
  const contactProps = {
    email: fields.customerEmail,
    firstname: firstName,
    lastname: lastName,
    address: fields.customerStreet || '',
    zip: fields.customerZip || '',
    city: fields.customerCity || '',
  };

  let contact = await findContactByEmail(creds, fields.customerEmail);
  let contactWasCreated = false;
  if (contact) {
    const response = await fetch(`${BASE}/crm/v3/objects/contacts/${contact.id}`, {
      method: 'PATCH',
      headers: headers(creds),
      body: JSON.stringify({ properties: contactProps }),
    });
    if (!response.ok) throw await hsError(response, 'HubSpot-Kontakt aktualisieren');
  } else {
    const response = await fetch(`${BASE}/crm/v3/objects/contacts`, {
      method: 'POST',
      headers: headers(creds),
      body: JSON.stringify({ properties: contactProps }),
    });
    if (!response.ok) throw await hsError(response, 'HubSpot-Kontakt anlegen');
    contact = await response.json();
    contactWasCreated = true;
  }

  const { pipeline, stage } = await getDefaultPipelineStage(creds);
  const name = dealName(fields);
  const dealResponse = await fetch(`${BASE}/crm/v3/objects/deals`, {
    method: 'POST',
    headers: headers(creds),
    body: JSON.stringify({
      properties: {
        dealname: name,
        pipeline,
        dealstage: stage,
        ...(amount != null && amount > 0 ? { amount: String(amount) } : {}),
      },
    }),
  });
  if (!dealResponse.ok) throw await hsError(dealResponse, 'HubSpot-Deal anlegen');
  const deal = await dealResponse.json();

  const assocResponse = await fetch(
    `${BASE}/crm/v4/objects/deals/${deal.id}/associations/default/contacts/${contact.id}`,
    { method: 'PUT', headers: headers(creds) }
  );
  if (!assocResponse.ok) throw await hsError(assocResponse, 'HubSpot-Verknüpfung Deal↔Kontakt');

  return { contactId: contact.id, dealId: deal.id, dealName: name, contactWasCreated };
}
