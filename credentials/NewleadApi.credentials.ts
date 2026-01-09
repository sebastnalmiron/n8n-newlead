import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class NewleadApi implements ICredentialType {
	name = 'newleadApi';
	displayName = 'Newlead API';
	documentationUrl = 'https://docs.newlead.ai';
	icon = { light: 'file:newlead.svg', dark: 'file:newlead.svg' } as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'API Key from Newlead dashboard (Settings → API Keys)',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://rest.newlead.ai',
			description: 'Base URL for the Newlead API',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/bots',
			method: 'GET',
		},
	};
}
