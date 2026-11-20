import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import {
	assertId,
	assertPropertyReference,
	buildLeadVariables,
	buildListQuery,
	buildPauseBody,
	buildPropertyBody,
	buildTemplateComponents,
	errorDetails,
	isTooManyMatches,
	idempotencyKeyFor,
	pickIdempotencyKey,
	recordingFile,
	simplifyProperties,
	splitTemplateValue,
	toE164,
	type ListFilter,
	type TemplateHeaderType,
} from './helpers';
import { fetchRecording, v1RedirectLocation, v1Request, v1RequestAll } from './transport';

const LEAD_PICKER_LIMIT = '100';
/** The channels the old routes looked at when searching by phone (WHATSAPP_LEAD_CHANNELS in the API). */
const PHONE_LOOKUP_CHANNELS = ['whatsapp', 'meta_ads'];

/** Lead > Get Many: each filter of the node and its query parameter in /v1. */
const LEAD_FILTERS: Record<string, ListFilter> = {
	status: { parameter: 'status' },
	createdAfter: { parameter: 'created_after', date: true },
	createdBefore: { parameter: 'created_before', date: true },
	lastActivityAfter: { parameter: 'last_activity_after', date: true },
	lastActivityBefore: { parameter: 'last_activity_before', date: true },
};

/** Call > Get Many: each filter of the node and its query parameter in /v1. */
const CALL_FILTERS: Record<string, ListFilter> = {
	voiceAgentId: { parameter: 'voice_agent_id' },
	leadId: { parameter: 'lead_id', id: 'lead ID' },
	direction: { parameter: 'direction' },
	status: { parameter: 'status' },
	startedAfter: { parameter: 'started_after', date: true },
	startedBefore: { parameter: 'started_before', date: true },
};

function voiceAgentOptions(agents: IDataObject[]): INodePropertyOptions[] {
	return agents.map((agent) => ({ name: agent.name as string, value: agent.id as string }));
}

function leadLabel(lead: IDataObject): string {
	const contact = (lead.phone as string) || (lead.username ? `@${lead.username as string}` : '');
	if (lead.name && contact) return `${lead.name as string} (${contact})`;
	return (lead.name as string) || contact || (lead.id as string);
}

/** The key the user gave in the options, or one built from the execution, node, run and item. */
function idempotencyKey(
	context: IExecuteFunctions,
	itemIndex: number,
	options: IDataObject = {},
): string {
	return pickIdempotencyKey(
		options.idempotencyKey,
		idempotencyKeyFor(
			context.getExecutionId(),
			context.getNode().id,
			context.getWorkflowDataProxy(itemIndex).$runIndex as number,
			itemIndex,
		),
	);
}

function variablesOf(context: IExecuteFunctions, itemIndex: number): IDataObject | undefined {
	return buildLeadVariables(
		context.getNodeParameter('leadVariables.variables', itemIndex, []) as IDataObject[],
	);
}

/** For each Agent Type: the parameter that holds the agent and the GET /v1/leads filter it becomes. */
const AGENT_SCOPE = {
	text: { parameter: 'textAgentId', filter: 'text_agent_id' },
	voice: { parameter: 'voiceAgentId', filter: 'voice_agent_id' },
} as const;

/** The leads of a text agent or, in Lead with Agent Type Voice, of a voice agent without a text agent. */
function leadScope(context: IExecuteFunctions, itemIndex: number, allowVoice = false): IDataObject {
	const voice = allowVoice && context.getNodeParameter('agentType', itemIndex, 'text') === 'voice';
	const kind = voice ? AGENT_SCOPE.voice : AGENT_SCOPE.text;
	return { [kind.filter]: context.getNodeParameter(kind.parameter, itemIndex) as string };
}

/** The lead's id; a phone number is looked up inside the agent. */
async function resolveLeadId(
	context: IExecuteFunctions,
	itemIndex: number,
	scope: IDataObject,
): Promise<string> {
	const locator = context.getNodeParameter('leadId', itemIndex) as IDataObject;
	if (locator.mode !== 'phone') {
		return assertId(locator.value, 'lead ID');
	}
	const value = String(locator.value ?? '').trim();
	const page = await v1Request.call(context, 'GET', '/leads', {
		query: { phone: toE164(value), ...scope, limit: LEAD_PICKER_LIMIT },
	});
	// In a text agent the API also returns the web chat twins of a phone; a message would end up in
	// the widget. A voice agent's leads are all calls, looked up like the voice route does: agent and phone.
	const leads = (page.data as IDataObject[]).filter(
		(lead) =>
			scope[AGENT_SCOPE.voice.filter] !== undefined || PHONE_LOOKUP_CHANNELS.includes(lead.channel as string),
	);
	if (leads.length === 0) {
		throw new NodeOperationError(context.getNode(), `No lead with phone ${value} in this agent`, {
			itemIndex,
		});
	}
	if (leads.length > 1) {
		throw new NodeOperationError(
			context.getNode(),
			`More than one lead matches the phone ${value} in this agent`,
			{ itemIndex, description: 'Pick the lead by ID or from the list.' },
		);
	}
	return leads[0].id as string;
}

async function sendTemplate(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const template = splitTemplateValue(context.getNodeParameter('templateName', itemIndex) as string);
	const components = buildTemplateComponents({
		headerType: context.getNodeParameter('headerType', itemIndex, 'none') as TemplateHeaderType,
		headerValue: context.getNodeParameter('headerValue', itemIndex, '') as string,
		headerFilename: context.getNodeParameter('headerFilename', itemIndex, '') as string,
		bodyVariables: context.getNodeParameter('bodyVariables.variables', itemIndex, []) as IDataObject[],
		urlButtons: context.getNodeParameter('urlButtons.buttons', itemIndex, []) as IDataObject[],
	});
	const options = context.getNodeParameter('templateOptions', itemIndex, {}) as IDataObject;
	const variables = variablesOf(context, itemIndex);
	const sourceLeadId = String(options.sourceLeadId ?? '').trim();
	return await v1Request.call(context, 'POST', '/messages', {
		idempotencyKey: idempotencyKey(context, itemIndex, options),
		body: {
			type: 'template',
			text_agent_id: context.getNodeParameter('textAgentId', itemIndex) as string,
			to: toE164(context.getNodeParameter('phoneNumber', itemIndex) as string),
			template: { ...template, ...(components.length > 0 ? { components } : {}) },
			...(variables ? { lead_variables: variables } : {}),
			...(options.pauseAi ? { pause_ai: true } : {}),
			...(options.resetConversation ? { reset_conversation: true } : {}),
			...(sourceLeadId ? { source_lead_id: sourceLeadId } : {}),
		},
	});
}

async function sendMessage(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	// Validate the own key first: it costs nothing, the lead check below is a request
	const options = context.getNodeParameter('messageOptions', itemIndex, {}) as IDataObject;
	const key = idempotencyKey(context, itemIndex, options);
	const leadId = await resolveLeadId(context, itemIndex, leadScope(context, itemIndex));
	const textAgentId = context.getNodeParameter('textAgentId', itemIndex) as string;
	const locator = context.getNodeParameter('leadId', itemIndex) as IDataObject;
	if (locator.mode !== 'phone') {
		// The phone lookup already filters by agent; a list or an id may point at a lead of another one
		const lead = await v1Request.call(context, 'GET', `/leads/${leadId}`);
		if (lead.text_agent_id !== textAgentId) {
			throw new NodeOperationError(
				context.getNode(),
				'The lead does not belong to the selected text agent',
				{ itemIndex, description: 'Choose another lead, or the agent that owns this one.' },
			);
		}
	}
	return await v1Request.call(context, 'POST', '/messages', {
		idempotencyKey: key,
		body: {
			type: 'text',
			lead_id: leadId,
			text: context.getNodeParameter('message', itemIndex) as string,
		},
	});
}

/** A Get Many operation: every page with Return All, otherwise one page up to Limit. */
async function getMany(
	context: IExecuteFunctions,
	itemIndex: number,
	path: string,
	query: IDataObject = {},
): Promise<IDataObject[]> {
	if (context.getNodeParameter('returnAll', itemIndex, false) as boolean) {
		return await v1RequestAll.call(context, path, query);
	}
	const limit = context.getNodeParameter('limit', itemIndex, 50) as number;
	const page = await v1Request.call(context, 'GET', path, {
		query: { ...query, limit: String(limit) },
	});
	return page.data as IDataObject[];
}

async function runLead(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'create') {
		const name = (context.getNodeParameter('name', itemIndex, '') as string).trim();
		const variables = variablesOf(context, itemIndex);
		return await v1Request.call(context, 'POST', '/leads', {
			idempotencyKey: idempotencyKey(context, itemIndex),
			body: {
				text_agent_id: context.getNodeParameter('textAgentId', itemIndex) as string,
				phone: toE164(context.getNodeParameter('phoneNumber', itemIndex) as string),
				...(name ? { name } : {}),
				...(variables ? { variables } : {}),
			},
		});
	}
	const scope = leadScope(context, itemIndex, true);
	if (operation === 'getMany') {
		const filters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
		return await getMany(context, itemIndex, '/leads', {
			...scope,
			...buildListQuery(filters, LEAD_FILTERS, context.getTimezone()),
		});
	}
	const leadId = await resolveLeadId(context, itemIndex, scope);
	if (operation === 'update') {
		const fields = context.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
		const name = String(fields.name ?? '').trim();
		const variables = variablesOf(context, itemIndex);
		const body = {
			...(name ? { name } : {}),
			...(fields.status ? { status: fields.status } : {}),
			...(variables ? { variables } : {}),
		};
		if (Object.keys(body).length === 0) {
			throw new NodeOperationError(context.getNode(), 'Nothing to update', {
				itemIndex,
				description: 'Add a name, a status or a variable.',
			});
		}
		return await v1Request.call(context, 'PATCH', `/leads/${leadId}`, { body });
	}
	return await v1Request.call(context, 'GET', `/leads/${leadId}`);
}

async function runAiControl(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject> {
	const leadId = await resolveLeadId(context, itemIndex, leadScope(context, itemIndex));
	if (operation === 'pause') {
		const options = context.getNodeParameter('pauseOptions', itemIndex, {}) as IDataObject;
		return await v1Request.call(context, 'POST', `/leads/${leadId}/pause_ai`, {
			body: buildPauseBody(options),
		});
	}
	if (operation === 'resume') {
		return await v1Request.call(context, 'POST', `/leads/${leadId}/resume_ai`);
	}
	const lead = await v1Request.call(context, 'GET', `/leads/${leadId}`);
	return { lead_id: lead.id, ai_paused: lead.ai_paused, ai_paused_until: lead.ai_paused_until };
}

/** The path of PUT and DELETE /v1/properties/{reference}. */
function propertyPath(context: IExecuteFunctions, itemIndex: number): string {
	const reference = assertPropertyReference(context.getNodeParameter('reference', itemIndex));
	return `/properties/${encodeURIComponent(reference)}`;
}

async function runProperty(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'getMany') {
		return await getMany(context, itemIndex, '/properties');
	}
	if (operation === 'delete') {
		return await v1Request.call(context, 'DELETE', propertyPath(context, itemIndex));
	}
	if (operation === 'upsert') {
		// A PUT is idempotent by itself: no Idempotency-Key
		return await v1Request.call(context, 'PUT', propertyPath(context, itemIndex), {
			body: buildPropertyBody({
				type: context.getNodeParameter('propertyType', itemIndex) as string,
				listings: context.getNodeParameter('listings.listing', itemIndex, []) as IDataObject[],
				fields: context.getNodeParameter('propertyFields', itemIndex, {}) as IDataObject,
			}),
		});
	}
	const reference = String(context.getNodeParameter('reference', itemIndex)).trim();
	const simplify = context.getNodeParameter('simplify', itemIndex, true);
	let page: IDataObject;
	try {
		page = await v1Request.call(context, 'GET', '/properties', { query: { reference } });
	} catch (error) {
		// Like version 1, more than 3 matches is a result. A malformed reference has the same code and param
		if (simplify && isTooManyMatches(error)) return simplifyProperties([], 'many');
		throw error instanceof NodeApiError ? error : new NodeApiError(context.getNode(), error as JsonObject);
	}
	return simplify ? simplifyProperties(page.data as IDataObject[]) : page;
}

async function startCall(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const options = context.getNodeParameter('callOptions', itemIndex, {}) as IDataObject;
	const name = String(context.getNodeParameter('leadName', itemIndex, '')).trim();
	const variables = variablesOf(context, itemIndex);
	// Written on the lead before dialing, so the agent uses them during the call
	const lead = { ...(name ? { name } : {}), ...(variables ? { variables } : {}) };
	return await v1Request.call(context, 'POST', '/calls', {
		idempotencyKey: idempotencyKey(context, itemIndex, options),
		body: {
			voice_agent_id: context.getNodeParameter('voiceAgentId', itemIndex) as string,
			to: toE164(context.getNodeParameter('phoneNumber', itemIndex) as string),
			...(Object.keys(lead).length > 0 ? { lead } : {}),
		},
	});
}

async function runCall(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	if (operation === 'start') {
		return await startCall(context, itemIndex);
	}
	if (operation === 'getMany') {
		const filters = context.getNodeParameter('callFilters', itemIndex, {}) as IDataObject;
		return await getMany(
			context,
			itemIndex,
			'/calls',
			buildListQuery(filters, CALL_FILTERS, context.getTimezone()),
		);
	}
	const callId = assertId(context.getNodeParameter('callId', itemIndex), 'call ID');
	return await v1Request.call(context, 'GET', `/calls/${callId}`);
}

/** Call > Get Recording: the audio as binary data, downloaded from the signed link without the API key. */
async function downloadRecording(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const callId = assertId(context.getNodeParameter('callId', itemIndex), 'call ID');
	const link = await v1RedirectLocation.call(context, `/calls/${callId}/recording`);
	const response = await fetchRecording.call(context, link, itemIndex);
	const { fileName, mimeType } = recordingFile(link, callId, response.headers['content-type']);
	const field = context.getNodeParameter('binaryPropertyName', itemIndex, 'data') as string;
	// httpRequest with arraybuffer already gives a Buffer: copying it would double the memory
	const audio = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body);
	return {
		json: { call_id: callId },
		binary: {
			[field]: await context.helpers.prepareBinaryData(audio, fileName, mimeType),
		},
	};
}

async function runItem(
	context: IExecuteFunctions,
	resource: string,
	operation: string,
	itemIndex: number,
): Promise<IDataObject | IDataObject[]> {
	switch (resource) {
		case 'template':
			return await sendTemplate(context, itemIndex);
		case 'message':
			return await sendMessage(context, itemIndex);
		case 'lead':
			return await runLead(context, operation, itemIndex);
		case 'aiControl':
			return await runAiControl(context, operation, itemIndex);
		case 'call':
			return await runCall(context, operation, itemIndex);
		case 'property':
			return await runProperty(context, operation, itemIndex);
		default:
			throw new NodeOperationError(context.getNode(), `Unknown resource: ${resource}`, { itemIndex });
	}
}

// eslint-disable-next-line @n8n/community-nodes/icon-validation -- la descripción llega del VersionedNodeType, que declara el icono
export class NewleadV2 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 2,
			subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
			defaults: { name: 'Newlead' },
			inputs: [NodeConnectionTypes.Main],
			outputs: [NodeConnectionTypes.Main],
			// No usableAsTool: as a tool n8n raises the run index on every attempt, so a retry would get a new idempotency key and could send the WhatsApp twice
			credentials: [{ name: 'newleadApi', required: true }],
			properties: nodeProperties,
		};
	}

	methods = {
		loadOptions: {
			async getTextAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const agents = await v1RequestAll.call(this, '/text_agents');
				return agents.map((agent) => ({
					name: agent.name as string,
					value: agent.id as string,
				}));
			},

			async getStandaloneVoiceAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const agents = await v1RequestAll.call(this, '/voice_agents');
				// A voice agent with a text agent has no leads of its own: they are the text agent's
				return voiceAgentOptions(agents.filter((agent) => !agent.text_agent_id));
			},

			async getVoiceAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return voiceAgentOptions(await v1RequestAll.call(this, '/voice_agents'));
			},

			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const textAgentId = this.getCurrentNodeParameter('textAgentId') as string;
				if (!textAgentId) return [];
				const templates = await v1RequestAll.call(this, `/text_agents/${textAgentId}/templates`);
				return templates
					.filter((template) => String(template.status).toUpperCase() === 'APPROVED')
					.map((template) => ({
						name: `${template.name as string} (${template.language as string})`,
						value: `${template.name as string}|${template.language as string}`,
						description: template.category as string,
					}));
			},
		},
		listSearch: {
			async searchLeads(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
				// Only Lead has Agent Type; Message and AI Control always work on text agents
				const voice =
					this.getCurrentNodeParameter('resource') === 'lead' &&
					this.getCurrentNodeParameter('agentType') === 'voice';
				const kind = voice ? AGENT_SCOPE.voice : AGENT_SCOPE.text;
				const agentId = this.getCurrentNodeParameter(kind.parameter) as string;
				if (!agentId) return { results: [] };
				const page = await v1Request.call(this, 'GET', '/leads', {
					query: { [kind.filter]: agentId, limit: LEAD_PICKER_LIMIT },
				});
				return {
					results: (page.data as IDataObject[]).map((lead) => ({
						name: leadLabel(lead),
						value: lead.id as string,
					})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Get Recording gives a file; every other operation gives JSON
				const executionData =
					resource === 'call' && operation === 'getRecording'
						? [await downloadRecording(this, itemIndex)]
						: this.helpers.returnJsonArray(await runItem(this, resource, operation, itemIndex));
				returnData.push(
					...this.helpers.constructExecutionMetaData(executionData, {
						itemData: { item: itemIndex },
					}),
				);
			} catch (error) {
				const failure =
					error instanceof NodeApiError || error instanceof NodeOperationError
						? error
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
				if (!this.continueOnFail()) throw failure;
				// n8n routes an item with `error` to the error output; `details` keeps what an uncertain send needs
				returnData.push({
					json: { error: failure.message, details: errorDetails(failure) },
					error: failure,
					pairedItem: { item: itemIndex },
				});
			}
		}

		return [returnData];
	}
}
