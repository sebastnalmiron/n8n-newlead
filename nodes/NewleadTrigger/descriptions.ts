import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';

/** The events of a text agent (LEAD_WEBHOOK_EVENTS in the API), by name. */
export const TEXT_EVENT_OPTIONS: INodePropertyOptions[] = [
	{ name: 'Follow-Up Sent', value: 'follow_up.sent', description: 'A follow-up message goes out' },
	{
		name: 'Lead Appointment Booked',
		value: 'lead.appointment_booked',
		description: 'The agent books an appointment',
	},
	{ name: 'Lead Created', value: 'lead.created', description: 'A new lead arrives' },
	{
		name: 'Lead Do Not Contact Changed',
		value: 'lead.do_not_contact_changed',
		description: 'A lead is opted out or opted back in, from the API, the dashboard or the agent',
	},
	{ name: 'Lead Handoff', value: 'lead.handoff', description: 'The agent notifies the team' },
	{
		name: 'Lead Qualified',
		value: 'lead.qualified',
		description: 'A lead completes the qualification',
	},
	{ name: 'Message Failed', value: 'message.failed', description: 'A message to a lead fails' },
	{ name: 'Message Received', value: 'message.received', description: 'A lead sends a message' },
];

/** The events of a voice agent (CALL_WEBHOOK_EVENTS in the API), by name. */
export const VOICE_EVENT_OPTIONS: INodePropertyOptions[] = [
	{
		name: 'Call Analyzed',
		value: 'call.analyzed',
		description: 'The variables extracted from a call are ready',
	},
	{ name: 'Call Ended', value: 'call.ended', description: 'A call ends' },
	{
		name: 'Call Rejected',
		value: 'call.rejected',
		description: 'A call is rejected before anyone handles it',
	},
	{ name: 'Call Started', value: 'call.started', description: 'A call starts' },
];

const TEXT = { agentType: ['text'] };
const VOICE = { agentType: ['voice'] };

export const triggerProperties: INodeProperties[] = [
	{
		displayName: 'Agent Type',
		name: 'agentType',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Text',
				value: 'text',
				description: 'Lead and message events: WhatsApp, Instagram, web chat',
			},
			{ name: 'Voice', value: 'voice', description: 'Call events' },
		],
		default: 'text',
	},
	{
		displayName: 'Text Agent Name or ID',
		name: 'textAgentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getTextAgents' },
		required: true,
		default: '',
		displayOptions: { show: TEXT },
		description:
			'The text agent whose events start the workflow. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Voice Agent Name or ID',
		name: 'voiceAgentId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getVoiceAgents' },
		required: true,
		default: '',
		displayOptions: { show: VOICE },
		description:
			'The voice agent whose calls start the workflow. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Events',
		name: 'textEvents',
		type: 'multiOptions',
		options: TEXT_EVENT_OPTIONS,
		required: true,
		default: [],
		displayOptions: { show: TEXT },
	},
	{
		displayName: 'Events',
		name: 'voiceEvents',
		type: 'multiOptions',
		options: VOICE_EVENT_OPTIONS,
		required: true,
		default: [],
		displayOptions: { show: VOICE },
	},
	{
		displayName:
			'Each agent takes up to 3 active webhook endpoints. Listening for a test event uses one while it listens.',
		name: 'endpointLimitNotice',
		type: 'notice',
		default: '',
	},
];
