import type { IDataObject, IHookFunctions, INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { apiErrorOf } from '../Newlead/v2/helpers';
import { v1Request, v1RequestAll } from '../Newlead/v2/transport';

/** What the node keeps in the workflow's static data between activation and deliveries. */
export interface EndpointState {
	endpointId?: string;
	secret?: string;
	/** The URL the endpoint was created for: only then is it this node's to delete. */
	url?: string;
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
		"An agent takes up to 3 active webhook endpoints, and listening for a test event in the editor uses one while it listens. Delete one in the agent's Webhooks panel, or deactivate another workflow that listens to this agent.",
	api_key_forbidden:
		'Creating webhook endpoints needs a key whose role can manage agents. Create the key in Settings › API keys with a user that can configure agents.',
};

function stateOf(context: IHookFunctions): EndpointState & IDataObject {
	return context.getWorkflowStaticData('node') as EndpointState & IDataObject;
}

function forget(state: EndpointState): void {
	delete state.endpointId;
	delete state.secret;
	delete state.url;
}

/** This node's webhook URL, its agent and its events, as the API takes them. */
function endpointConfig(context: IHookFunctions): EndpointConfig {
	const url = context.getNodeWebhookUrl('default') ?? '';
	if (!url.startsWith('https://')) {
		throw new NodeOperationError(
			context.getNode(),
			`Newlead only sends events to https URLs, and this n8n gives "${url}": set WEBHOOK_URL to its public https address and restart n8n`,
		);
	}
	const voice = context.getNodeParameter('agentType', 'text') === 'voice';
	const owner = voice
		? { voice_agent_id: context.getNodeParameter('voiceAgentId') as string }
		: { text_agent_id: context.getNodeParameter('textAgentId') as string };
	const events = context.getNodeParameter(voice ? 'voiceEvents' : 'textEvents', []) as string[];
	return { url, owner, events };
}

/** Keeps a NodeApiError as it is, adding what to do when the code has a hint; wraps anything else. */
function withHint(error: unknown, node: INode): NodeApiError {
	const apiError =
		error instanceof NodeApiError ? error : new NodeApiError(node, error as JsonObject);
	const details = apiErrorOf(apiError);
	// n8n shows only the description of a NodeApiError, so the API's own message has to be in it
	const lead = HINTS[details?.code ?? ''] ?? details?.message;
	// an error without a message of the API keeps its description: n8n shows '' as an empty toast
	if (lead) apiError.description = [lead, apiError.description].filter(Boolean).join(' ');
	return apiError;
}

/**
 * The subaccount's endpoints that point at this node's URL, whatever their agent: the URL carries the
 * node's webhook id, so they are this node's, even one left on a previous agent.
 */
function atUrl(endpoints: IDataObject[], config: EndpointConfig): IDataObject[] {
	return endpoints.filter((endpoint) => endpoint.url === config.url);
}

/** Deletes an endpoint; one that is already gone counts as deleted. */
async function removeEndpoint(context: IHookFunctions, id: string): Promise<void> {
	try {
		await v1Request.call(context, 'DELETE', `/webhook_endpoints/${id}`);
	} catch (error) {
		if (apiErrorOf(error)?.code !== 'resource_not_found') throw withHint(error, context.getNode());
	}
}

/** Whether the endpoint belongs to the agent this node is configured for. */
function sameOwner(endpoint: IDataObject, owner: IDataObject): boolean {
	return Object.entries(owner).every(([key, id]) => endpoint[key] === id);
}

function sameEvents(found: unknown, wanted: string[]): boolean {
	return (
		Array.isArray(found) &&
		found.length === wanted.length &&
		wanted.every((event) => found.includes(event))
	);
}

/**
 * Whether this node's endpoint is there, active, with the same agent, the same events and a secret we
 * know. A paused one that otherwise matches is reactivated (it keeps its id and secret). Any other
 * endpoint at this URL (a leftover of a test run or of a previous agent, one with other events or whose
 * secret was lost) is deleted, so it does not use up one of the agent's three; then n8n calls create.
 */
export async function checkEndpoint(context: IHookFunctions): Promise<boolean> {
	const config = endpointConfig(context);
	const state = stateOf(context);
	let all: IDataObject[];
	try {
		all = await v1RequestAll.call(context, '/webhook_endpoints');
	} catch (error) {
		// a hiccup of the API while n8n starts must not take down a healthy subscription
		if (context.getActivationMode() === 'init' && state.endpointId && state.secret) {
			context.logger.warn(
				'[NewleadTrigger] Could not check the webhook endpoint on start; keeping the stored one',
				{ endpointId: state.endpointId, error: (error as Error).message },
			);
			return true;
		}
		throw withHint(error, context.getNode());
	}
	const found = atUrl(all, config);
	const own = found.find(
		(endpoint) =>
			endpoint.id === state.endpointId &&
			Boolean(state.secret) &&
			sameOwner(endpoint, config.owner) &&
			sameEvents(endpoint.events, config.events),
	);
	for (const endpoint of found) {
		if (endpoint !== own) await removeEndpoint(context, endpoint.id as string);
	}
	if (!own) {
		// at another URL it may be production's, if this n8n database is a copy: leave it and forget it
		const stored = all.find((endpoint) => endpoint.id === state.endpointId);
		if (stored && stored.url !== config.url) {
			context.logger.warn(
				'[NewleadTrigger] The stored webhook endpoint points at another URL; it was left in place',
				{ endpointId: stored.id, url: stored.url },
			);
		}
		forget(state);
		return false;
	}
	if (own.active !== true) {
		try {
			await v1Request.call(context, 'PATCH', `/webhook_endpoints/${own.id as string}`, {
				body: { active: true },
			});
		} catch (error) {
			throw withHint(error, context.getNode());
		}
	}
	return true;
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
				description: `${prefix} · ${context.getWorkflow().name ?? ''}`.slice(
					0,
					DESCRIPTION_MAX_LENGTH,
				),
			},
		});
	} catch (error) {
		throw withHint(error, context.getNode());
	}
	if (typeof endpoint.id !== 'string' || typeof endpoint.secret !== 'string') {
		throw new NodeOperationError(
			context.getNode(),
			'The API created the endpoint without its id or secret',
		);
	}
	const state = stateOf(context);
	state.endpointId = endpoint.id;
	state.secret = endpoint.secret;
	state.url = config.url;
	return true;
}

/**
 * Deletes this node's endpoint (the one in the static data, if it was created for this URL); a 404 counts as deleted. On an editor test
 * URL (`/webhook-test/`) it deletes every endpoint at the URL, which is transient and one per node.
 * Endpoints of a production URL that are not ours are left alone, since another workflow may share the
 * webhook id: the next activation (checkEndpoint) cleans them. It never throws: n8n is deactivating
 * the workflow anyway. A failure is logged and the state kept.
 */
export async function deleteEndpoint(context: IHookFunctions): Promise<boolean> {
	const state = stateOf(context);
	try {
		const config = endpointConfig(context);
		const ids = new Set<string>();
		if (state.endpointId && (state.url === config.url || config.url.includes('/webhook-test/'))) {
			ids.add(state.endpointId);
		} else if (state.endpointId) {
			context.logger.warn(
				'[NewleadTrigger] Left the stored webhook endpoint in place: it was created for another URL',
				{ endpointId: state.endpointId, url: state.url ?? null },
			);
		}
		if (config.url.includes('/webhook-test/')) {
			const all = await v1RequestAll.call(context, '/webhook_endpoints');
			for (const endpoint of atUrl(all, config)) ids.add(endpoint.id as string);
		}
		for (const id of ids) await removeEndpoint(context, id);
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
