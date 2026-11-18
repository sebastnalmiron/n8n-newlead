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
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { nodeProperties } from './descriptions';
import {
	buildLeadVariables,
	buildPauseBody,
	buildTemplateComponents,
	idempotencyKeyFor,
	simplifyProperties,
	splitTemplateValue,
	toE164,
	type TemplateHeaderType,
} from './helpers';
import { v1Request, v1RequestAll } from './transport';

const LEAD_PICKER_LIMIT = '100';

function leadLabel(lead: IDataObject): string {
	const contact = (lead.phone as string) || (lead.username ? `@${lead.username as string}` : '');
	if (lead.name && contact) return `${lead.name as string} (${contact})`;
	return (lead.name as string) || contact || (lead.id as string);
}

function idempotencyKey(context: IExecuteFunctions, itemIndex: number): string {
	return idempotencyKeyFor(
		context.getExecutionId(),
		context.getNode().id,
		context.getWorkflowDataProxy(itemIndex).$runIndex as number,
		itemIndex,
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
	const value = String(locator.value ?? '').trim();
	if (locator.mode !== 'phone') {
		return value;
	}
	const page = await v1Request.call(context, 'GET', '/leads', {
		query: {
			phone: toE164(value),
			text_agent_id: context.getNodeParameter('textAgentId', itemIndex) as string,
			limit: '2',
		},
	});
	const leads = page.data as IDataObject[];
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
		idempotencyKey: idempotencyKey(context, itemIndex),
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
	return await v1Request.call(context, 'POST', '/messages', {
		idempotencyKey: idempotencyKey(context, itemIndex),
		body: {
			type: 'text',
			lead_id: await resolveLeadId(context, itemIndex),
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
	const reference = (context.getNodeParameter('reference', itemIndex) as string).trim();
	const page = await v1Request.call(context, 'GET', '/properties', { query: { reference } });
	return context.getNodeParameter('simplify', itemIndex, true)
		? simplifyProperties(page.data as IDataObject[])
		: page;
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
			usableAsTool: true,
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
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
