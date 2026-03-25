import type { INodeProperties } from 'n8n-workflow';

export const messageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['message'],
			},
		},
		options: [
			{
				name: 'Send',
				value: 'send',
				description: 'Send a manual text message to a lead (WhatsApp or Instagram)',
				action: 'Send a message',
			},
		],
		default: 'send',
	},
];

export const messageFields: INodeProperties[] = [
	// Bot Selection
	{
		displayName: 'Bot Name or ID',
		name: 'botId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getBots',
		},
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['send'],
			},
		},
		description: 'Select the bot. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	// Lead or Phone Number
	{
		displayName: 'Lead ID or Phone Number',
		name: 'leadIdOrPhone',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'lead_123456 or 5491123456789 (phone for WhatsApp)',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['send'],
			},
		},
		description: 'Enter a Lead ID (works for any channel) or phone number with country code for WhatsApp (e.g., 5491123456789)',
	},
	// Message
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['send'],
			},
		},
		description: 'Message text to send (max 4096 characters)',
	},
];
