import type {
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { getTextAgents, getVoiceAgents } from '../Newlead/v2/agents';
import { triggerProperties } from './descriptions';
import { verifySignature } from './signature';
import { checkEndpoint, createEndpoint, deleteEndpoint, type EndpointState } from './subscription';

export class NewleadTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Newlead Trigger',
		name: 'newleadTrigger',
		icon: 'file:newlead.svg',
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{ ($parameter["agentType"] === "voice" ? $parameter["voiceEvents"] : $parameter["textEvents"]).join(", ") }}',
		description: 'Starts the workflow when a Newlead agent sends an event',
		defaults: { name: 'Newlead Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'newleadApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: triggerProperties,
	};

	methods = {
		loadOptions: { getTextAgents, getVoiceAgents },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return await checkEndpoint(this);
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return await createEndpoint(this);
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return await deleteEndpoint(this);
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject();
		// n8n reads the raw body before parsing JSON; if it has not, read it: the signature covers those bytes
		if (!request.rawBody && typeof request.readRawBody === 'function') await request.readRawBody();
		const headers = this.getHeaderData();
		const delivery = typeof headers['x-webhook-delivery'] === 'string' ? headers['x-webhook-delivery'] : null;
		const { secret } = this.getWorkflowStaticData('node') as EndpointState;
		const valid = verifySignature({
			header: headers['x-webhook-signature'],
			rawBody: request.rawBody,
			secret,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		if (!valid) {
			this.logger.warn('[NewleadTrigger] Rejected a delivery with an invalid signature', { delivery });
			this.getResponseObject().status(401).json({ error: 'invalid_signature' });
			return { noWebhookResponse: true };
		}
		return {
			workflowData: [this.helpers.returnJsonArray({ ...this.getBodyData(), delivery_id: delivery })],
		};
	}
}
