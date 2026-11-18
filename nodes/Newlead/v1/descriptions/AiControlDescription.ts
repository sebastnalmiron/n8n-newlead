import type { INodeProperties } from 'n8n-workflow';

export const aiControlOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['aiControl'],
			},
		},
		options: [
			{
				name: 'Pause',
				value: 'pause',
				description: 'Pause AI automatic responses for a lead',
				action: 'Pause AI for a lead',
			},
			{
				name: 'Resume',
				value: 'resume',
				description: 'Resume AI automatic responses for a lead',
				action: 'Resume AI for a lead',
			},
			{
				name: 'Get Status',
				value: 'getStatus',
				description: 'Get AI pause status for a lead',
				action: 'Get AI status for a lead',
			},
		],
		default: 'pause',
	},
];

export const aiControlFields: INodeProperties[] = [
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
				resource: ['aiControl'],
			},
		},
		description: 'Select the bot. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	// Lead Selection
	{
		displayName: 'Lead Name or ID',
		name: 'leadId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getLeads',
			loadOptionsDependsOn: ['botId'],
		},
		required: true,
		default: '',
		displayOptions: {
			show: {
				resource: ['aiControl'],
			},
		},
		description: 'Select the lead. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	// Lead ID manual input
	{
		displayName: 'Lead ID (Manual)',
		name: 'leadIdManual',
		type: 'string',
		default: '',
		displayOptions: {
			show: {
				resource: ['aiControl'],
			},
		},
		description: 'Or enter Lead ID manually (overrides dropdown selection)',
	},
	// Pause Options
	{
		displayName: 'Pause Options',
		name: 'pauseOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['aiControl'],
				operation: ['pause'],
			},
		},
		options: [
			{
				displayName: 'Duration (Minutes)',
				name: 'durationMin',
				type: 'number',
				typeOptions: {
					minValue: 0,
					maxValue: 525600,
					numberPrecision: 0,
				},
				default: 0,
				description: 'Pause duration in minutes (0 = indefinite)',
			},
			{
				displayName: 'Reason',
				name: 'reason',
				type: 'string',
				default: '',
				description: 'Reason for pausing AI',
			},
		],
	},
];
