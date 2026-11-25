import type { INodeProperties } from 'n8n-workflow';

function operationField(
	resource: string,
	options: Array<{ name: string; value: string; description: string; action: string }>,
	defaultValue: string,
): INodeProperties {
	return {
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [resource] } },
		options,
		default: defaultValue,
	};
}

function textAgentField(show: Record<string, string[]>, required = true): INodeProperties {
	return {
		displayName: 'Text Agent Name or ID',
		name: 'textAgentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTextAgents' },
		required,
		default: '',
		displayOptions: { show },
		description:
			'The text agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	};
}

function voiceAgentField(
	show: Record<string, string[]>,
	loadOptionsMethod: string,
	description: string,
): INodeProperties {
	return {
		displayName: 'Voice Agent Name or ID',
		name: 'voiceAgentId',
		type: 'options',
		typeOptions: { loadOptionsMethod },
		required: true,
		default: '',
		displayOptions: { show },
		description,
	};
}

/** Return All and Limit for a Get Many operation. */
function getManyFields(show: Record<string, string[]>): INodeProperties[] {
	return [
		{
			displayName: 'Return All',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions: { show },
			description: 'Whether to return all results or only up to a given limit',
		},
		{
			displayName: 'Limit',
			name: 'limit',
			type: 'number',
			typeOptions: { minValue: 1, maxValue: 100, numberPrecision: 0 },
			default: 50,
			displayOptions: { show: { ...show, returnAll: [false] } },
			description: 'Max number of results to return',
		},
	];
}

function leadField(show: Record<string, string[]>): INodeProperties {
	return {
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
				typeOptions: { searchListMethod: 'searchLeads' },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: '00000000-0000-4000-8000-000000000001',
			},
			{
				displayName: 'By Phone Number',
				name: 'phone',
				type: 'string',
				placeholder: '+34600111222',
			},
		],
		displayOptions: { show },
		description: 'The lead, by name, ID or phone number',
	};
}

function variablesField(show: Record<string, string[]>): INodeProperties {
	return {
		displayName: 'Lead Variables',
		name: 'leadVariables',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Variable',
		displayOptions: { show },
		options: [
			{
				displayName: 'Variable',
				name: 'variables',
				values: [
					{ displayName: 'Key', name: 'key', type: 'string', default: '' },
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Rows with an empty value are skipped',
					},
				],
			},
		],
		description: 'Only the listed variables are added or changed; the rest are kept',
	};
}

const STATUS_OPTIONS = [
	{ name: 'Active', value: 'active' },
	{ name: 'Closed', value: 'closed' },
	{ name: 'Inactive', value: 'inactive' },
	{ name: 'Pending', value: 'pending' },
];

const TEMPLATE_SEND = { resource: ['template'], operation: ['send'] };
const MESSAGE_SEND = { resource: ['message'], operation: ['send'] };
const LEAD_CREATE = { resource: ['lead'], operation: ['create'] };
const LEAD_UPDATE = { resource: ['lead'], operation: ['update'] };
const LEAD_GET_MANY = { resource: ['lead'], operation: ['getMany'] };
const LEAD_BY_AGENT = { resource: ['lead'], operation: ['get', 'getMany', 'update'] };
const PROPERTY_GET_MANY = { resource: ['property'], operation: ['getMany'] };

const PROPERTY_UPSERT = { resource: ['property'], operation: ['upsert'] };

const PROPERTY_TYPE_OPTIONS = [
	{ name: 'Building', value: 'building' },
	{ name: 'Commercial', value: 'commercial' },
	{ name: 'Country House', value: 'countryhouse' },
	{ name: 'Flat', value: 'flat' },
	{ name: 'Garage', value: 'garage' },
	{ name: 'House', value: 'house' },
	{ name: 'Land', value: 'land' },
	{ name: 'Office', value: 'office' },
	{ name: 'Room', value: 'room' },
	{ name: 'Storage', value: 'storage' },
];

const PROPERTY_FEATURE_OPTIONS = [
	{ name: 'Air Conditioning', value: 'air_conditioning' },
	{ name: 'Balcony', value: 'balcony' },
	{ name: 'Fitted Wardrobes', value: 'fitted_wardrobes' },
	{ name: 'Garden', value: 'garden' },
	{ name: 'Lift', value: 'lift' },
	{ name: 'Parking', value: 'parking' },
	{ name: 'Pets Allowed', value: 'pets_allowed' },
	{ name: 'Pool', value: 'pool' },
	{ name: 'Storage Room', value: 'storage_room' },
	{ name: 'Terrace', value: 'terrace' },
];

const IDEMPOTENCY_KEY_OPTION: INodeProperties = {
	displayName: 'Idempotency Key',
	name: 'idempotencyKey',
	type: 'string',
	default: '',
	description:
		'A stable key of your own, different for every send or call (for example the record ID in your CRM plus the reason). Running the workflow again with the same key does not repeat it, for 24 hours; the same key with another request is rejected. Up to 255 characters.',
};

const templateProperties: INodeProperties[] = [
	operationField(
		'template',
		[
			{
				name: 'Send',
				value: 'send',
				description: 'Send an approved WhatsApp template',
				action: 'Send a template message',
			},
		],
		'send',
	),
	textAgentField(TEMPLATE_SEND),
	{
		displayName: 'Template Name or ID',
		name: 'templateName',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTemplates', loadOptionsDependsOn: ['textAgentId'] },
		required: true,
		default: '',
		displayOptions: { show: TEMPLATE_SEND },
		description:
			'The approved template, as name|language. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+34600111222',
		displayOptions: { show: TEMPLATE_SEND },
		description: 'Recipient phone number with country code. The lead is created if it does not exist.',
	},
	{
		displayName: 'Header Type',
		name: 'headerType',
		type: 'options',
		options: [
			{ name: 'Document', value: 'document' },
			{ name: 'Image', value: 'image' },
			{ name: 'None', value: 'none' },
			{ name: 'Text', value: 'text' },
			{ name: 'Video', value: 'video' },
		],
		default: 'none',
		displayOptions: { show: TEMPLATE_SEND },
	},
	{
		displayName: 'Header Value',
		name: 'headerValue',
		type: 'string',
		default: '',
		displayOptions: {
			show: { ...TEMPLATE_SEND, headerType: ['text', 'image', 'video', 'document'] },
		},
		description: 'The header text, or the public URL of the file',
	},
	{
		displayName: 'Header Filename',
		name: 'headerFilename',
		type: 'string',
		default: '',
		displayOptions: { show: { ...TEMPLATE_SEND, headerType: ['document'] } },
	},
	{
		displayName: 'Body Variables',
		name: 'bodyVariables',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		default: {},
		placeholder: 'Add Variable',
		displayOptions: { show: TEMPLATE_SEND },
		options: [
			{
				displayName: 'Variable',
				name: 'variables',
				values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }],
			},
		],
		description: 'The values of {{1}}, {{2}}… in order',
	},
	{
		displayName: 'URL Buttons',
		name: 'urlButtons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Button',
		displayOptions: { show: TEMPLATE_SEND },
		options: [
			{
				displayName: 'Button',
				name: 'buttons',
				values: [
					{
						displayName: 'Button Index',
						name: 'index',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 9, numberPrecision: 0 },
						default: 0,
					},
					{
						displayName: 'URL Suffix',
						name: 'value',
						type: 'string',
						default: '',
						description: 'The variable part of the button URL',
					},
				],
			},
		],
	},
	variablesField(TEMPLATE_SEND),
	{
		displayName: 'Options',
		name: 'templateOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: TEMPLATE_SEND },
		options: [
			{
				displayName: 'Clear Previous Chat',
				name: 'resetConversation',
				type: 'boolean',
				default: false,
				description: 'Whether the agent starts this conversation from scratch',
			},
			IDEMPOTENCY_KEY_OPTION,
			{
				displayName: 'Pause AI',
				name: 'pauseAi',
				type: 'boolean',
				default: false,
				description: 'Whether the AI stops answering this lead after the template',
			},
			{
				displayName: 'Source Lead ID',
				name: 'sourceLeadId',
				type: 'string',
				default: '',
				description: 'The lead of the same person in another channel, such as the call that led here',
			},
		],
	},
];

const messageProperties: INodeProperties[] = [
	operationField(
		'message',
		[
			{
				name: 'Send',
				value: 'send',
				description: 'Send a text message to a lead',
				action: 'Send a message',
			},
		],
		'send',
	),
	textAgentField(MESSAGE_SEND),
	leadField(MESSAGE_SEND),
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: MESSAGE_SEND },
		description: 'Message text to send (max 4096 characters)',
	},
	{
		displayName: 'Options',
		name: 'messageOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: MESSAGE_SEND },
		options: [
			IDEMPOTENCY_KEY_OPTION,
		],
	},
];

const leadProperties: INodeProperties[] = [
	operationField(
		'lead',
		[
			{
				name: 'Create',
				value: 'create',
				description: 'Create a lead; if the agent already has a lead with that phone, update it instead (a new name replaces the old one, variables are merged)',
				action: 'Create a lead',
			},
			{ name: 'Get', value: 'get', description: 'Get a lead', action: 'Get a lead' },
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get the leads of an agent',
				action: 'Get many leads',
			},
			{ name: 'Update', value: 'update', description: 'Update a lead', action: 'Update a lead' },
		],
		'get',
	),
	{
		displayName: 'Agent Type',
		name: 'agentType',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'Text', value: 'text', description: 'A text agent: WhatsApp, Instagram, web chat' },
			{ name: 'Voice', value: 'voice', description: 'A voice agent without a text agent' },
		],
		default: 'text',
		displayOptions: { show: LEAD_BY_AGENT },
		description:
			"Whose leads to use. A voice agent with a text agent shares that agent's leads: choose Text.",
	},
	textAgentField(LEAD_CREATE),
	textAgentField({ ...LEAD_BY_AGENT, agentType: ['text'] }),
	voiceAgentField(
		{ ...LEAD_BY_AGENT, agentType: ['voice'] },
		'getStandaloneVoiceAgents',
		'The voice agent, among those without a text agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	),
	leadField({ resource: ['lead'], operation: ['get', 'update'] }),
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+34600111222',
		displayOptions: { show: LEAD_CREATE },
	},
	{
		displayName: 'Name',
		name: 'name',
		type: 'string',
		default: '',
		displayOptions: { show: LEAD_CREATE },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: LEAD_UPDATE },
		options: [
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_OPTIONS,
				default: 'active',
			},
		],
	},
	variablesField({ resource: ['lead'], operation: ['create', 'update'] }),
	...getManyFields(LEAD_GET_MANY),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: LEAD_GET_MANY },
		options: [
			{
				displayName: 'Created After',
				name: 'createdAfter',
				type: 'dateTime',
				default: '',
				description: 'Leads created at or after this time',
			},
			{
				displayName: 'Created Before',
				name: 'createdBefore',
				type: 'dateTime',
				default: '',
				description: 'Leads created before this time',
			},
			{
				displayName: 'Last Activity After',
				name: 'lastActivityAfter',
				type: 'dateTime',
				default: '',
				description:
					'Leads with a message or a call at or after this time. Use it to poll for changes.',
			},
			{
				displayName: 'Last Activity Before',
				name: 'lastActivityBefore',
				type: 'dateTime',
				default: '',
				description: 'Leads whose last message or call is before this time',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_OPTIONS,
				default: 'active',
			},
		],
	},
];

const aiControlProperties: INodeProperties[] = [
	operationField(
		'aiControl',
		[
			{ name: 'Get Status', value: 'getStatus', description: 'Get the AI status of a lead', action: 'Get AI status for a lead' },
			{ name: 'Pause', value: 'pause', description: 'Stop the AI answering a lead', action: 'Pause AI for a lead' },
			{ name: 'Resume', value: 'resume', description: 'Let the AI answer a lead again', action: 'Resume AI for a lead' },
		],
		'pause',
	),
	textAgentField({ resource: ['aiControl'] }),
	leadField({ resource: ['aiControl'] }),
	{
		displayName: 'Pause Options',
		name: 'pauseOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['aiControl'], operation: ['pause'] } },
		options: [
			{
				displayName: 'Duration (Minutes)',
				name: 'durationMin',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 525600, numberPrecision: 0 },
				default: 0,
				description: 'Pause duration in minutes (0 = until resumed)',
			},
			{ displayName: 'Reason', name: 'reason', type: 'string', default: '' },
		],
	},
];

const CALL_START = { resource: ['call'], operation: ['start'] };
const CALL_BY_ID = { resource: ['call'], operation: ['get', 'getRecording'] };
const CALL_RECORDING = { resource: ['call'], operation: ['getRecording'] };
const CALL_GET_MANY = { resource: ['call'], operation: ['getMany'] };

const CALL_STATUS_OPTIONS = [
	{ name: 'Completed', value: 'completed' },
	{ name: 'Dropped', value: 'dropped' },
	{ name: 'Failed', value: 'failed' },
	{ name: 'In Progress', value: 'in_progress' },
	{ name: 'No Answer', value: 'no_answer' },
	{ name: 'Rejected', value: 'rejected' },
];

const callProperties: INodeProperties[] = [
	operationField(
		'call',
		[
			{ name: 'Get', value: 'get', description: 'Get a call with its transcript', action: 'Get a call' },
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many calls, newest first',
				action: 'Get many calls',
			},
			{
				name: 'Get Recording',
				value: 'getRecording',
				description: 'Download the audio of a call',
				action: 'Get the recording of a call',
			},
			{
				name: 'Start',
				value: 'start',
				description: 'Have a voice agent call a phone number',
				action: 'Start a call',
			},
		],
		'start',
	),
	voiceAgentField(
		CALL_START,
		'getVoiceAgents',
		'The voice agent that calls. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	),
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+34600111222',
		displayOptions: { show: CALL_START },
		description:
			'Number to call, with country code. The lead is created if the agent has none with this number.',
	},
	{
		displayName: 'Lead Name',
		name: 'leadName',
		type: 'string',
		default: '',
		displayOptions: { show: CALL_START },
		description: 'Replaces the name of the lead before dialing, so the agent can use it',
	},
	variablesField(CALL_START),
	{
		displayName: 'Options',
		name: 'callOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: CALL_START },
		options: [IDEMPOTENCY_KEY_OPTION],
	},
	{
		displayName: 'Call ID',
		name: 'callId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '00000000-0000-4000-8000-000000000001',
		displayOptions: { show: CALL_BY_ID },
	},
	{
		displayName: 'Put Output File in Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		displayOptions: { show: CALL_RECORDING },
		hint: 'The name of the output binary field to put the file in',
	},
	...getManyFields(CALL_GET_MANY),
	{
		displayName: 'Filters',
		name: 'callFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: CALL_GET_MANY },
		options: [
			{
				displayName: 'Direction',
				name: 'direction',
				type: 'options',
				options: [
					{ name: 'Inbound', value: 'inbound' },
					{ name: 'Outbound', value: 'outbound' },
					{ name: 'Web', value: 'web' },
				],
				default: 'outbound',
			},
			{
				displayName: 'Lead ID',
				name: 'leadId',
				type: 'string',
				default: '',
				description: 'Only calls of this lead',
			},
			{
				displayName: 'Started After',
				name: 'startedAfter',
				type: 'dateTime',
				default: '',
				description: 'Calls started at or after this time',
			},
			{
				displayName: 'Started Before',
				name: 'startedBefore',
				type: 'dateTime',
				default: '',
				description: 'Calls started before this time',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: CALL_STATUS_OPTIONS,
				default: 'completed',
			},
			{
				displayName: 'Voice Agent Name or ID',
				name: 'voiceAgentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getVoiceAgents' },
				default: '',
				description:
					'Only calls of this voice agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	},
];

const propertyProperties: INodeProperties[] = [
	operationField(
		'property',
		[
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new property, or update the current one if it already exists (upsert)',
				action: 'Create or update a property',
			},
			{
				name: 'Delete',
				value: 'delete',
				description: 'Delete a property created with Create or Update',
				action: 'Delete a property',
			},
			{
				name: 'Get by Reference',
				value: 'getByReference',
				description: 'Find a property by its Idealista listing code or your reference',
				action: 'Get a property by reference',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get many published properties, with their photos, newest first',
				action: 'Get many properties',
			},
		],
		'getByReference',
	),
	...getManyFields(PROPERTY_GET_MANY),
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		required: true,
		default: '',
		placeholder: '109876543, 6543 or REF-0001',
		displayOptions: { show: { resource: ['property'], operation: ['getByReference'] } },
		description: 'Idealista listing code (full or its last 3+ digits) or your reference',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['property'], operation: ['getByReference'] } },
		description: 'Whether to return flat fields ready for template variables instead of the full response',
	},
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'REF-0001',
		displayOptions: { show: { resource: ['property'], operation: ['upsert'] } },
		description:
			'Your reference for the property: 1 to 50 letters, digits, dots, hyphens or underscores. Create or Update replaces the whole property that has it, so a field left empty is cleared.',
	},
	{
		displayName: 'Reference',
		name: 'reference',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'REF-0001',
		displayOptions: { show: { resource: ['property'], operation: ['delete'] } },
		description: 'Your reference for the property: 1 to 50 letters, digits, dots, hyphens or underscores',
	},
	{
		displayName: 'Type',
		name: 'propertyType',
		type: 'options',
		options: PROPERTY_TYPE_OPTIONS,
		required: true,
		default: 'flat',
		displayOptions: { show: PROPERTY_UPSERT },
	},
	{
		displayName: 'Listings',
		name: 'listings',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Listing',
		displayOptions: { show: PROPERTY_UPSERT },
		options: [
			{
				displayName: 'Listing',
				name: 'listing',
				values: [
					{
						displayName: 'Operation',
						name: 'listingOperation',
						type: 'options',
						options: [
							{ name: 'Rent', value: 'rent' },
							{ name: 'Sale', value: 'sale' },
						],
						default: 'sale',
					},
					{
						displayName: 'Price',
						name: 'price',
						type: 'number',
						typeOptions: { minValue: 0, numberPrecision: 2 },
						default: 0,
						description:
							'In euros; for rent, per month. A listing without a price (empty or 0) is skipped.',
					},
					{
						displayName: 'Available',
						name: 'available',
						type: 'boolean',
						default: true,
						description: 'Whether the listing is published, so the agent can offer it',
					},
				],
			},
		],
		description: 'Sale, rent or both, once each',
	},
	{
		displayName: 'Property Fields',
		name: 'propertyFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: PROPERTY_UPSERT },
		options: [
			{
				displayName: 'Address Visibility',
				name: 'addressVisibility',
				type: 'options',
				options: [
					{ name: 'Full', value: 'full', description: 'Street and number' },
					{ name: 'Hidden', value: 'hidden', description: 'No address, only the city' },
					{ name: 'Street', value: 'street', description: 'Street without the number' },
				],
				default: 'full',
				description: 'How much of the address the agent tells leads. Without this field, the address is hidden.',
			},
			{
				displayName: 'Agent Notes',
				name: 'agentNotes',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Internal notes for the agent',
			},
			{
				displayName: 'Bathrooms',
				name: 'bathrooms',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 0 },
				default: 0,
			},
			{
				displayName: 'Bedrooms',
				name: 'bedrooms',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 0 },
				default: 0,
			},
			{
				displayName: 'Built Area',
				name: 'builtM2',
				type: 'number',
				typeOptions: { minValue: 1, numberPrecision: 0 },
				default: 1,
				description: 'In square meters',
			},
			{ displayName: 'City', name: 'city', type: 'string', default: '' },
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description: 'The listing text, in Spanish',
			},
			{
				displayName: 'Features',
				name: 'features',
				type: 'multiOptions',
				options: PROPERTY_FEATURE_OPTIONS,
				default: [],
				description: 'The highlights the agent mentions',
			},
			{
				displayName: 'Image URLs',
				name: 'images',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description:
					'Public JPG, PNG or GIF links in order, one per line, up to 50. An expression can also give a list of links, or of images with a label as in the API.',
			},
			{
				displayName: 'Postal Code',
				name: 'postalCode',
				type: 'string',
				default: '',
				description: 'Spanish postal code, 5 digits. The province comes from it.',
			},
			{ displayName: 'Street', name: 'street', type: 'string', default: '' },
			{ displayName: 'Street Number', name: 'streetNumber', type: 'string', default: '' },
		],
	},
];

export const nodeProperties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: [
			{ name: 'AI Control', value: 'aiControl', description: 'Pause or resume the AI for a lead' },
			{ name: 'Call', value: 'call', description: 'Start voice calls and read them' },
			{ name: 'Lead', value: 'lead', description: 'Manage leads' },
			{ name: 'Message', value: 'message', description: 'Send text messages' },
			{ name: 'Property', value: 'property', description: 'Get, create, update and delete properties' },
			{ name: 'Template', value: 'template', description: 'Send WhatsApp templates' },
		],
		default: 'template',
	},
	...templateProperties,
	...messageProperties,
	...leadProperties,
	...aiControlProperties,
	...callProperties,
	...propertyProperties,
];
