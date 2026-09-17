import type {
	IExecuteFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	INodeListSearchResult,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	newleadApiRequest,
	getBots,
	getTemplates,
	getLeads,
	buildTemplateComponentsFromUnified,
	getDynamicVariables,
} from './GenericFunctions';

import { templateOperations, templateFields } from './descriptions/TemplateDescription';
import { leadOperations, leadFields } from './descriptions/LeadDescription';
import { messageOperations, messageFields } from './descriptions/MessageDescription';
import { aiControlOperations, aiControlFields } from './descriptions/AiControlDescription';

export class Newlead implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Newlead',
		name: 'newlead',
		icon: 'file:newlead.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Newlead Platform API (WhatsApp, Instagram & more)',
		defaults: {
			name: 'Newlead',
		},
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: [
			{
				name: 'newleadApi',
				required: true,
			},
		],
		properties: [
			// Resource Selection
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Template',
						value: 'template',
						description: 'Send WhatsApp template messages (WhatsApp only)',
					},
					{
						name: 'Message',
						value: 'message',
						description: 'Send manual text messages (WhatsApp & Instagram)',
					},
					{
						name: 'Lead',
						value: 'lead',
						description: 'Manage leads',
					},
					{
						name: 'AI Control',
						value: 'aiControl',
						description: 'Control AI automatic responses',
					},
				],
				default: 'template',
			},
			// Operations and Fields
			...templateOperations,
			...templateFields,
			...leadOperations,
			...leadFields,
			...messageOperations,
			...messageFields,
			...aiControlOperations,
			...aiControlFields,
		],
	};

	methods = {
		loadOptions: {
			async getBots(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				return getBots.call(this);
			},

			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const botId = this.getCurrentNodeParameter('botId') as string;
				return getTemplates.call(this, botId);
			},

			async getLeads(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const botId = this.getCurrentNodeParameter('botId') as string;
				return getLeads.call(this, botId);
			},
		},
		listSearch: {
			async getLeads(this: ILoadOptionsFunctions): Promise<INodeListSearchResult> {
				const botId = this.getCurrentNodeParameter('botId') as string;
				const leads = await getLeads.call(this, botId);
				
				return {
					results: leads.map((lead) => ({
						name: lead.name as string,
						value: lead.value as string,
						url: `https://dashboard.newlead.ai/bots/${botId}/leads/${lead.value}`,
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

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[];

				// ===================
				// TEMPLATE OPERATIONS
				// ===================
				if (resource === 'template') {
					if (operation === 'send') {
						const botId = this.getNodeParameter('botId', i) as string;
						const templateValue = this.getNodeParameter('templateName', i) as string;
						const [templateName, templateLanguage] = templateValue.split('|');
						const phoneNumber = this.getNodeParameter('phoneNumber', i) as string;

						// Get components
						const componentsRaw = this.getNodeParameter(
							'templateComponents.components',
							i,
							[],
						) as IDataObject[];

						// Build components from unified structure
						const components = buildTemplateComponentsFromUnified(componentsRaw);

						const body: IDataObject = {
							to: phoneNumber,
							template_name: templateName,
							template_language: templateLanguage,
						};

						if (components.length > 0) {
							body.components = components;
						}

						const dynamicVariables = getDynamicVariables.call(this, i);
						if (dynamicVariables) {
							body.dynamic_variables = dynamicVariables;
						}
						if (this.getNodeParameter('manualMode', i, false) as boolean) {
							body.manual = true;
						}
						if (this.getNodeParameter('clearPreviousChat', i, false) as boolean) {
							body.reset_conversation = true;
						}

						responseData = (await newleadApiRequest.call(
							this,
							'POST',
							`/bots/${botId}/templates/send`,
							body,
						)) as IDataObject;
					}
				}

				// ================
				// LEAD OPERATIONS
				// ================
				else if (resource === 'lead') {
					const botId = this.getNodeParameter('botId', i) as string;

					if (operation === 'get') {
						const leadIdResource = this.getNodeParameter('leadId', i) as IDataObject;
						const leadId = leadIdResource.value as string;

						responseData = (await newleadApiRequest.call(
							this,
							'GET',
							`/bots/${botId}/leads/${leadId}`,
						)) as IDataObject;
					} else if (operation === 'getMany') {
						const options = this.getNodeParameter('options', i, {}) as IDataObject;
						const query: IDataObject = {};

						if (options.status) {
							query.status = options.status;
						}

						responseData = (await newleadApiRequest.call(
							this,
							'GET',
							`/bots/${botId}/leads`,
							{},
							query,
						)) as IDataObject;
					} else if (operation === 'create') {
						const phoneNumber = this.getNodeParameter('phoneNumber', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i, {}) as IDataObject;

						const body: IDataObject = { phone_number: phoneNumber };
						if (additionalFields.name) {
							body.name = additionalFields.name;
						}
						const dynamicVariables = getDynamicVariables.call(this, i);
						if (dynamicVariables) {
							body.dynamic_variables = dynamicVariables;
						}

						responseData = (await newleadApiRequest.call(
							this,
							'POST',
							`/bots/${botId}/leads`,
							body,
						)) as IDataObject;
					} else if (operation === 'update') {
						const leadIdResource = this.getNodeParameter('leadId', i) as IDataObject;
						const leadId = leadIdResource.value as string;

						const updateFields = this.getNodeParameter('updateFields', i, {}) as IDataObject;

						const body: IDataObject = { ...updateFields };

						const dynamicVariables = getDynamicVariables.call(this, i);
						if (dynamicVariables) {
							body.dynamic_variables = dynamicVariables;
							// Only the listed variables change; the rest stay on the lead.
							body.dynamic_variables_mode = 'merge';
						}

						responseData = (await newleadApiRequest.call(
							this,
							'PATCH',
							`/bots/${botId}/leads/${leadId}`,
							body,
						)) as IDataObject;
					}
				}

				// ===================
				// MESSAGE OPERATIONS
				// ===================
				else if (resource === 'message') {
					if (operation === 'send') {
						const botId = this.getNodeParameter('botId', i) as string;
						const leadIdOrPhone = (this.getNodeParameter('leadIdOrPhone', i) as string).trim();
						const message = this.getNodeParameter('message', i) as string;

						if (!leadIdOrPhone) {
							throw new NodeOperationError(
								this.getNode(),
								'Lead ID, phone or WhatsApp ID is required',
								{ itemIndex: i },
							);
						}

						responseData = (await newleadApiRequest.call(
							this,
							'POST',
							`/bots/${botId}/leads/${encodeURIComponent(leadIdOrPhone)}/messages/manual`,
							{ message },
						)) as IDataObject;
					}
				}

				// ======================
				// AI CONTROL OPERATIONS
				// ======================
				else if (resource === 'aiControl') {
					const botId = this.getNodeParameter('botId', i) as string;
					const leadIdManual = this.getNodeParameter('leadIdManual', i, '') as string;
					const leadId = leadIdManual || (this.getNodeParameter('leadId', i) as string);

					if (operation === 'pause') {
						const pauseOptions = this.getNodeParameter('pauseOptions', i, {}) as IDataObject;

						// 0 = indefinite.
						const minutes = Number(pauseOptions.durationMin ?? 0);
						const body: IDataObject = {
							duration_min: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0,
						};
						if (pauseOptions.reason) {
							body.reason = pauseOptions.reason;
						}

						responseData = (await newleadApiRequest.call(
							this,
							'POST',
							`/bots/${botId}/leads/${leadId}/ai-pause`,
							body,
						)) as IDataObject;
					} else if (operation === 'resume') {
						responseData = (await newleadApiRequest.call(
							this,
							'POST',
							`/bots/${botId}/leads/${leadId}/ai-resume`,
						)) as IDataObject;
					} else if (operation === 'getStatus') {
						responseData = (await newleadApiRequest.call(
							this,
							'GET',
							`/bots/${botId}/leads/${leadId}/ai-status`,
						)) as IDataObject;
					}
				}

				// Push response data
				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData!),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: (error as Error).message,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
