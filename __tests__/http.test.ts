import { parseApiError } from '../src/lib/http';

const mockResponse = (status: number, body: unknown): Response =>
  ({
    status,
    json: async () => body,
  }) as unknown as Response;

describe('parseApiError', () => {
  test('OpenAI-Format (error.message)', async () => {
    const err = await parseApiError(
      mockResponse(401, { error: { message: 'Invalid key' } }),
      'OpenAI',
    );
    expect(err.message).toBe('OpenAI: HTTP 401 – Invalid key');
  });

  test('Shopware-Format (errors[].detail)', async () => {
    const err = await parseApiError(
      mockResponse(400, { errors: [{ detail: 'Pflichtfeld fehlt' }] }),
      'Shopware-Bestellung',
    );
    expect(err.message).toBe('Shopware-Bestellung: HTTP 400 – Pflichtfeld fehlt');
  });

  test('HubSpot-Format (message)', async () => {
    const err = await parseApiError(mockResponse(403, { message: 'Forbidden' }), 'HubSpot');
    expect(err.message).toBe('HubSpot: HTTP 403 – Forbidden');
  });

  test('Shopify-Format (errors als String)', async () => {
    const err = await parseApiError(mockResponse(422, { errors: 'Not found' }), 'Shopify');
    expect(err.message).toBe('Shopify: HTTP 422 – Not found');
  });

  test('Body ist kein JSON -> nur Status', async () => {
    const broken = {
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response;
    const err = await parseApiError(broken, 'Test');
    expect(err.message).toBe('Test: HTTP 500');
  });
});
