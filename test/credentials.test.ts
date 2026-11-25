import { Expression } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { NewleadApi } from '../credentials/NewleadApi.credentials';
import { apiBaseUrl } from '../nodes/Newlead/v2/transport';

describe('NewleadApi credential', () => {
	const credential = new NewleadApi();

	it('is tested with GET /v1/me, which does not depend on the agents of the subaccount', () => {
		expect(credential.test.request).toMatchObject({ url: '/v1/me', method: 'GET' });
	});

	it.each([
		'https://rest.newlead.ai',
		'https://rest.newlead.ai/',
		'https://rest.newlead.ai/v1',
		'https://rest.newlead.ai/v1/',
		'https://rest.newlead.ai/v1/v1',
		'https://proxy.example.com/v10',
	])('tests %s against the same base URL the node calls', (baseUrl) => {
		// Resolved with n8n's own engine: a regex it did not take would break the test button
		const resolved = new Expression('UTC').resolveSimpleParameterValue(
			credential.test.request.baseURL as string,
			{ $credentials: { baseUrl } } as never,
		);
		expect(resolved).toBe(apiBaseUrl(baseUrl));
	});

	it('keeps x-api-key, the header the old routes of version 1 read', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { 'x-api-key': '={{$credentials.apiKey}}' } },
		});
		expect(credential.test.request.headers).toEqual({ 'x-api-key': '={{$credentials.apiKey}}' });
	});
});
