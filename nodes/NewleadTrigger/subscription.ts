import type { IDataObject, IHookFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { apiErrorOf } from '../Newlead/v2/helpers';
import { v1Request, v1RequestAll } from '../Newlead/v2/transport';

/** What the node keeps in the workflow's static data between activation and deliveries. */
export interface EndpointState {
	endpointId?: string;
	secret?: string;
}

interface EndpointConfig {
	url: string;
	owner: IDataObject;
	events: string[];
}

const DESCRIPTION_MAX_LENGTH = 200;

/** What to do about the API errors a user can fix, by code. */
const HINTS: Record<string, string> = {
	webhook_endpoint_limit_reached:
		"An agent takes up to 3 active webhook endpoints, and listening for a test event in the editor uses one while it listens. Pause or delete one in the agent's Webhooks panel, or deactivate another workflow that listens to this agent.",
	api_key_forbidden:
		'Creating webhook endpoints needs a key whose role can manage agents. Create the key in Settings › API with a user that can configure agents.',
};

function stateOf(context: IHookFunctions): EndpointState & IDataObject {
	return context.getWorkflowStaticData('node') as EndpointState & IDataObject;
}

function forget(state: EndpointState): void {
	delete state.endpointId;
	delete state.secret;
}

/** This node's webhook URL, its agent and its events, as the API takes them. */
function endpointConfig(context: IHookFunctions): EndpointConfig {
	const url = context.getNodeWebhookUrl('default') ?? '';
	if (!url.startsWith('https://')) {
		throw new NodeOperationError(context.getNode(), 'Newlead only sends events to https URLs', {
			description: `This n8n gives the webhook URL "${url}". Set WEBHOOK_URL to the public https address of this n8n and restart it.`,
		});
	}
	const voice = context.getNodeParameter('agentType', 'text') === 'voice';
	const owner = voice
		? { voice_agent_id: context.getNodeParameter('voiceAgentId') as string }
		: { text_agent_id: context.getNodeParameter('textAgentId') as string };
	const events = context.getNodeParameter(voice ? 'voiceEvents' : 'textEvents', []) as string[];
	return { url, owner, events };
}

/** The agent's endpoints that point at this node's URL: the URL carries the node's webhook id, so they are this node's. */
async function endpointsAtUrl(context: IHookFunctions, config: EndpointConfig): Promise<IDataObject[]> {
	const endpoints = await v1RequestAll.call(context, '/webhook_endpoints', config.owner);
	return endpoints.filter((endpoint) => endpoint.url === config.url);
}

/** Deletes an endpoint; one that is already gone counts as deleted. */
async function removeEndpoint(context: IHookFunctions, id: string): Promise<void> {
	try {
		await v1Request.call(context, 'DELETE', `/webhook_endpoints/${id}`);
	} catch (error) {
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- v1Request already throws a NodeApiError
		if (apiErrorOf(error)?.code !== 'resource_not_found') throw error;
	}
}

function sameEvents(found: unknown, wanted: string[]): boolean {
	return Array.isArray(found) && found.length === wanted.length && wanted.every((event) => found.includes(event));
}

/**
 * Whether this node's endpoint is there, active, with the same events and a secret we know. Any
 * other endpoint at this URL (a paused one, a leftover of a test run, one whose secret was lost)
 * is deleted, so it does not use up one of the agent's three; then n8n calls create.
 */
export async function checkEndpoint(context: IHookFunctions): Promise<boolean> {
	const config = endpointConfig(context);
	const state = stateOf(context);
	const found = await endpointsAtUrl(context, config);
	const own = found.find(
		(endpoint) =>
			endpoint.id === state.endpointId &&
			Boolean(state.secret) &&
			endpoint.active === true &&
			sameEvents(endpoint.events, config.events),
	);
	for (const endpoint of found) {
		if (endpoint !== own) await removeEndpoint(context, endpoint.id as string);
	}
	if (!own) forget(state);
	return own !== undefined;
}

/** Subscribes this node's URL to the agent's events and keeps the id and the secret, which the API shows only now. */
export async function createEndpoint(context: IHookFunctions): Promise<boolean> {
	const config = endpointConfig(context);
	if (config.events.length === 0) {
		throw new NodeOperationError(context.getNode(), 'Choose at least one event');
	}
	const prefix = context.getMode() === 'manual' ? 'n8n test' : 'n8n';
	let endpoint: IDataObject;
	try {
		endpoint = await v1Request.call(context, 'POST', '/webhook_endpoints', {
			body: {
				...config.owner,
				url: config.url,
				events: config.events,
				description: `${prefix} · ${context.getWorkflow().name ?? ''}`.slice(0, DESCRIPTION_MAX_LENGTH),
			},
		});
	} catch (error) {
		const hint = HINTS[apiErrorOf(error)?.code ?? ''];
		if (hint && error instanceof NodeApiError) {
			error.description = [hint, error.description].filter(Boolean).join(' ');
		}
		// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- v1Request already throws a NodeApiError
		throw error;
	}
	if (typeof endpoint.id !== 'string' || typeof endpoint.secret !== 'string') {
		throw new NodeOperationError(context.getNode(), 'The API created the endpoint without its id or secret');
	}
	const state = stateOf(context);
	state.endpointId = endpoint.id;
	state.secret = endpoint.secret;
	return true;
}

/**
 * Deletes every endpoint at this node's URL. It never throws: n8n is deactivating the workflow
 * anyway. A failure is logged and the state kept; the next activation cleans up (checkEndpoint).
 */
export async function deleteEndpoint(context: IHookFunctions): Promise<boolean> {
	const state = stateOf(context);
	try {
		for (const endpoint of await endpointsAtUrl(context, endpointConfig(context))) {
			await removeEndpoint(context, endpoint.id as string);
		}
	} catch (error) {
		context.logger.warn('[NewleadTrigger] Could not delete the webhook endpoints of this node', {
			endpointId: state.endpointId,
			error: (error as Error).message,
		});
		return false;
	}
	forget(state);
	return true;
}
