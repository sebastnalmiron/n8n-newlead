import type { INodeProperties } from 'n8n-workflow';

export const leadOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['lead'],
			},
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a lead, or update it if the phone already exists in the bot',
				action: 'Create a lead',
			},
			{
				name: 'Get',
				value: 'get',
				description: 'Get a lead by ID',
				action: 'Get a lead',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get all leads from a bot',
				action: 'Get many leads',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a lead (name, status, and add or change dynamic variables)',
				action: 'Update a lead',
			},
		],
		default: 'get',
	},
];

export const leadFields: INodeProperties[] = [
	// Bot Selection - All operations
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
				resource: ['lead'],
			},
		},
		description: 'Select the bot. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	// Lead Selection - Get and Update
	{
		displayName: 'Lead',
		name: 'leadId',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: {
					searchListMethod: 'getLeads',
					searchable: true,
				},
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'c848c5a4-c052-4a3b-80bc-54b02475b06e',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[a-zA-Z0-9_-]+$',
							errorMessage: 'Not a valid Lead ID',
						},
					},
				],
			},
			{
				displayName: 'By Phone Number',
				name: 'phone',
				type: 'string',
				placeholder: '5491123456789',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[0-9]{10,15}$',
							errorMessage: 'Not a valid phone number (10-15 digits)',
						},
					},
				],
			},
			{
				displayName: 'By WhatsApp ID',
				name: 'bsuid',
				type: 'string',
				placeholder: 'US.1349…',
				validation: [
					{
						type: 'regex',
						properties: {
							regex: '^[A-Za-z]{2}[.][A-Za-z0-9]+$',
							errorMessage: 'Not a valid WhatsApp ID (e.g. US.1349…)',
						},
					},
				],
			},
		],
		displayOptions: {
			show: {
				resource: ['lead'],
				operation: ['get', 'update'],
			},
		},
		description: 'Select the lead by name, ID, phone number, or WhatsApp ID (Business-Scoped User ID, e.g. US.1349…)',
	},
	// Create
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '5491123456789',
		displayOptions: {
			show: {
				resource: ['lead'],
				operation: ['create'],
			},
		},
		description: 'Phone number with country code. If a lead with this phone already exists in the bot, it is updated instead of duplicated.',
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['lead'],
				operation: ['create'],
			},
		},
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Lead name',
			},
		],
	},
	// Update Fields
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: {
				resource: ['lead'],
				operation: ['update'],
			},
		},
		options: [
			{
				displayName: 'Name',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Lead name',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Active', value: 'active' },
					{ name: 'Inactive', value: 'inactive' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Closed', value: 'closed' },
				],
				default: 'active',
				description: 'Lead status',
			},
		],
	},
	// Dynamic Variables
	{
		displayName: 'Dynamic Variables',
		name: 'dynamicVariables',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		placeholder: 'Add Variable',
		displayOptions: {
			show: {
				resource: ['lead'],
				operation: ['create', 'update'],
			},
		},
		options: [
			{
				displayName: 'Variable',
				name: 'variables',
				values: [
					{
						displayName: 'Key',
						name: 'key',
						type: 'string',
						default: '',
						description: 'Variable name',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Variable value. Rows with an empty value are skipped.',
					},
				],
			},
		],
		description: 'Custom variables stored on the lead. Only the listed ones are added or changed; the rest are kept.',
	},
	// Get Many Options
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				resource: ['lead'],
				operation: ['getMany'],
			},
		},
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Active', value: 'active' },
					{ name: 'All', value: '' },
					{ name: 'Closed', value: 'closed' },
					{ name: 'Inactive', value: 'inactive' },
					{ name: 'Pending', value: 'pending' },
				],
				default: '',
				description: 'Filter by status',
			},
		],
	},
];
