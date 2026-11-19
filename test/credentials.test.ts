import { describe, expect, it } from 'vitest';

import { NewleadApi } from '../credentials/NewleadApi.credentials';

describe('NewleadApi credential', () => {
	const credential = new NewleadApi();

	it('is tested with GET /v1/me, which does not depend on the agents of the subaccount', () => {
		expect(credential.test.request).toMatchObject({
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/me',
			method: 'GET',
		});
	});

	it('keeps x-api-key, the header the old routes of version 1 read', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: { headers: { 'x-api-key': '={{$credentials.apiKey}}' } },
		});
		expect(credential.test.request.headers).toEqual({ 'x-api-key': '={{$credentials.apiKey}}' });
	});
});
