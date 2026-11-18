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
	assertLeadId,
	buildLeadVariables,
	buildPauseBody,
	buildTemplateComponents,
	errorDetails,
	isTooManyMatches,
	idempotencyKeyFor,
	pickIdempotencyKey,
	simplifyProperties,
	splitTemplateValue,
	toE164,
	type TemplateHeaderType,
} from './helpers';
import { v1Request, v1RequestAll } from './transport';

const LEAD_PICKER_LIMIT = '100';
/** The channels the old routes looked at when searching by phone (WHATSAPP_LEAD_CHANNELS in the API). */
const PHONE_LOOKUP_CHANNELS = ['whatsapp', 'meta_ads'];

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

/** The lead's id; a phone number is looked up inside the agent. */
async function resolveLeadId(context: IExecuteFunctions, itemIndex: number): Promise<string> {
	const locator = context.getNodeParameter('leadId', itemIndex) as IDataObject;
	if (locator.mode !== 'phone') {
		return assertLeadId(locator.value);
	}
	const value = String(locator.value ?? '').trim();
	const page = await v1Request.call(context, 'GET', '/leads', {
		query: {
			phone: toE164(value),
			text_agent_id: context.getNodeParameter('textAgentId', itemIndex) as string,
			limit: LEAD_PICKER_LIMIT,
		},
	});
	// The API also returns the web chat twins of a phone; a message would end up in the widget
	const leads = (page.data as IDataObject[]).filter((lead) =>
		PHONE_LOOKUP_CHANNELS.includes(lead.channel as string),
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
	const leadId = await resolveLeadId(context, itemIndex);
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
	if (operation === 'getMany') {
		const filters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
		const query = {
			text_agent_id: context.getNodeParameter('textAgentId', itemIndex) as string,
			...filters,
		};
		if (context.getNodeParameter('returnAll', itemIndex, false) as boolean) {
			return await v1RequestAll.call(context, '/leads', query);
		}
		const limit = context.getNodeParameter('limit', itemIndex, 50) as number;
		const page = await v1Request.call(context, 'GET', '/leads', {
			query: { ...query, limit: String(limit) },
		});
		return page.data as IDataObject[];
	}
	const leadId = await resolveLeadId(context, itemIndex);
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
	const leadId = await resolveLeadId(context, itemIndex);
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

async function runProperty(context: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
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
		case 'property':
			return await runProperty(context, itemIndex);
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
				const page = await v1Request.call(this, 'GET', '/text_agents');
				return (page.data as IDataObject[]).map((agent) => ({
					name: agent.name as string,
					value: agent.id as string,
				}));
			},

			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const textAgentId = this.getCurrentNodeParameter('textAgentId') as string;
				if (!textAgentId) return [];
				const page = await v1Request.call(this, 'GET', `/text_agents/${textAgentId}/templates`);
				return (page.data as IDataObject[])
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
				const textAgentId = this.getCurrentNodeParameter('textAgentId') as string;
				if (!textAgentId) return { results: [] };
				const page = await v1Request.call(this, 'GET', '/leads', {
					query: { text_agent_id: textAgentId, limit: LEAD_PICKER_LIMIT },
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
				const response = await runItem(this, resource, operation, itemIndex);
				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(response), {
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
