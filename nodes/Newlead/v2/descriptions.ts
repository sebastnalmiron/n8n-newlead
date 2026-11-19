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
				typeOptions: { searchListMethod: 'searchLeads', searchable: true },
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

const IDEMPOTENCY_KEY_OPTION: INodeProperties = {
	displayName: 'Idempotency Key',
	name: 'idempotencyKey',
	type: 'string',
	default: '',
	description:
		'A stable key of your own, different for every send (for example the record ID in your CRM plus the reason for the message). Running the workflow again with the same key does not send again, for 24 hours; the same key with another message is rejected. Up to 255 characters.',
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

const propertyProperties: INodeProperties[] = [
	operationField(
		'property',
		[
			{
				name: 'Get by Reference',
				value: 'getByReference',
				description: 'Find a property by its Idealista listing code or internal reference',
				action: 'Get a property by reference',
			},
			{
				name: 'Get Many',
				value: 'getMany',
				description: 'Get the properties published on Idealista, with their photos, newest first',
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
		description: 'Idealista listing code (full or its last 3+ digits) or the internal reference',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['property'], operation: ['getByReference'] } },
		description: 'Whether to return flat fields ready for template variables instead of the full response',
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
			{ name: 'Lead', value: 'lead', description: 'Manage leads' },
			{ name: 'Message', value: 'message', description: 'Send text messages' },
			{ name: 'Property', value: 'property', description: 'Get properties imported from Idealista' },
			{ name: 'Template', value: 'template', description: 'Send WhatsApp templates' },
		],
		default: 'template',
	},
	...templateProperties,
	...messageProperties,
	...leadProperties,
	...aiControlProperties,
	...propertyProperties,
];
