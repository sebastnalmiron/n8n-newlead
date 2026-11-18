import type { INodeProperties } from 'n8n-workflow';

export const propertyOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['property'],
			},
		},
		options: [
			{
				name: 'Get by Reference',
				value: 'getByReference',
				description:
					'Find a property of the subaccount by its Idealista listing code or internal reference',
				action: 'Get a property by reference',
			},
		],
		default: 'getByReference',
	},
];

export const propertyFields: INodeProperties[] = [
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		required: true,
		default: '',
		placeholder: '109876543, 6543 or SNAP-0412',
		displayOptions: {
			show: {
				resource: ['property'],
				operation: ['getByReference'],
			},
		},
		description:
			'Idealista listing code (full or its last 3+ digits) or the agency internal reference. The API key must belong to a subaccount with an Idealista account connected.',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: {
			show: {
				resource: ['property'],
				operation: ['getByReference'],
			},
		},
		description:
			'Whether to return flat fields ready for template variables (found, price_sale, URL, sales_agent_name…) instead of the raw API response',
	},
];
