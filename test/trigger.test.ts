import { NodeApiError, NodeOperationError, type IDataObject, type INode } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { checkEndpoint, createEndpoint, deleteEndpoint } from '../nodes/NewleadTrigger/subscription';

const node = { id: 'node-1', name: 'Newlead Trigger', type: 'n8n-nodes-newlead.newleadTrigger', typeVersion: 1 } as INode;
const AGENT = '11111111-1111-4111-8111-111111111111';
const VOICE = '55555555-5555-4555-8555-555555555555';
const NODE_URL = 'https://n8n.example.com/webhook/0b5c2d3e-0000-4000-8000-000000000001/webhook';
const OTHER_URL = 'https://n8n.example.com/webhook/0b5c2d3e-0000-4000-8000-000000000002/webhook';
const OURS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEFTOVER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECRET = `whsec_${'0'.repeat(64)}`;
const TEXT_PARAMS = { agentType: 'text', textAgentId: AGENT, textEvents: ['lead.created', 'message.received'] };

function apiError(httpCode: string, code: string) {
	return new NodeApiError(node, {
		message: code,
		httpCode,
		response: { data: { error: { code, message: `${code} message`, request_id: 'req_1' } } },
	} as never);
}

function endpoint(id: string, overrides: IDataObject = {}): IDataObject {
	return { object: 'webhook_endpoint', id, url: NODE_URL, events: ['lead.created', 'message.received'], active: true, ...overrides };
}

const list = (...endpoints: IDataObject[]) => ({ object: 'list', data: endpoints, has_more: false, next_cursor: null });

function hookContext(
	params: Record<string, unknown>,
	responses: unknown[],
	options: { staticData?: IDataObject; url?: string; mode?: string; workflowName?: string } = {},
) {
	let call = 0;
	const request = vi.fn(async () => {
		const response = responses[Math.min(call++, responses.length - 1)];
		if (response instanceof Error) throw response;
		return response;
	});
	const staticData = options.staticData ?? {};
	const warn = vi.fn();
	const context = {
		getNodeWebhookUrl: () => options.url ?? NODE_URL,
		getNodeParameter: (name: string, fallback?: unknown) => (name in params ? params[name] : fallback),
		getWorkflowStaticData: () => staticData,
		getWorkflow: () => ({ id: 'wf-1', name: options.workflowName ?? 'Leads to CRM', active: true }),
		getMode: () => options.mode ?? 'trigger',
		getNode: () => node,
		getCredentials: async () => ({ baseUrl: 'https://api.newlead.ai' }),
		logger: { warn },
		helpers: { httpRequestWithAuthentication: request },
	} as never;
	return { context, request, staticData, warn };
}

const sent = (request: ReturnType<typeof hookContext>['request'], index: number) =>
	request.mock.calls[index][1] as unknown as IDataObject;

describe('checkExists', () => {
	it('keeps its endpoint: same URL, active, same events, secret known', async () => {
		const { context, request } = hookContext(TEXT_PARAMS, [list(endpoint(OURS))], {
			staticData: { endpointId: OURS, secret: SECRET },
		});
		expect(await checkEndpoint(context)).toBe(true);
		expect(request).toHaveBeenCalledTimes(1);
		expect(sent(request, 0)).toMatchObject({
			method: 'GET',
			url: 'https://api.newlead.ai/v1/webhook_endpoints',
			qs: { text_agent_id: AGENT, limit: '100' },
		});
	});

	it('deletes a leftover at its URL and leaves the endpoints of other URLs alone', async () => {
		const { context, request } = hookContext(
			TEXT_PARAMS,
			[list(endpoint(OURS), endpoint(LEFTOVER), endpoint(FOREIGN, { url: OTHER_URL })), { deleted: true }],
			{ staticData: { endpointId: OURS, secret: SECRET } },
		);
		expect(await checkEndpoint(context)).toBe(true);
		expect(request).toHaveBeenCalledTimes(2);
		expect(sent(request, 1)).toMatchObject({
			method: 'DELETE',
			url: `https://api.newlead.ai/v1/webhook_endpoints/${LEFTOVER}`,
		});
	});

	for (const [label, found, staticData] of [
		['paused after 20 failures', endpoint(OURS, { active: false }), { endpointId: OURS, secret: SECRET }],
		['with other events', endpoint(OURS, { events: ['lead.created'] }), { endpointId: OURS, secret: SECRET }],
		['without the secret in the static data', endpoint(OURS), { endpointId: OURS }],
	] as const) {
		it(`deletes its endpoint ${label} so that create makes a new one`, async () => {
			const { context, request, staticData: state } = hookContext(TEXT_PARAMS, [list(found), { deleted: true }], {
				staticData: { ...staticData },
			});
			expect(await checkEndpoint(context)).toBe(false);
			expect(sent(request, 1)).toMatchObject({ method: 'DELETE', url: `https://api.newlead.ai/v1/webhook_endpoints/${OURS}` });
			expect(state).toEqual({});
		});
	}

	it('a voice agent is listed by voice_agent_id and compared with the voice events', async () => {
		const { context, request } = hookContext(
			{ agentType: 'voice', voiceAgentId: VOICE, voiceEvents: ['call.ended'] },
			[list(endpoint(OURS, { events: ['call.ended'], voice_agent_id: VOICE }))],
			{ staticData: { endpointId: OURS, secret: SECRET } },
		);
		expect(await checkEndpoint(context)).toBe(true);
		expect(sent(request, 0)).toMatchObject({ qs: { voice_agent_id: VOICE, limit: '100' } });
	});

	it('an http webhook URL fails before any request, saying what to change', async () => {
		const { context, request } = hookContext(TEXT_PARAMS, [list()], { url: 'http://localhost:5678/webhook/x/webhook' });
		const error = await checkEndpoint(context).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect(error).toMatchObject({
			message: 'Newlead only sends events to https URLs',
			description: expect.stringContaining('WEBHOOK_URL'),
		});
		expect(request).not.toHaveBeenCalled();
	});
});

describe('create', () => {
	it('creates the endpoint for this URL and keeps its id and secret', async () => {
		const { context, request, staticData } = hookContext(TEXT_PARAMS, [{ ...endpoint(OURS), secret: SECRET }]);
		expect(await createEndpoint(context)).toBe(true);
		expect(sent(request, 0)).toEqual({
			method: 'POST',
			url: 'https://api.newlead.ai/v1/webhook_endpoints',
			json: true,
			body: {
				text_agent_id: AGENT,
				url: NODE_URL,
				events: ['lead.created', 'message.received'],
				description: 'n8n · Leads to CRM',
			},
		});
		expect(staticData).toEqual({ endpointId: OURS, secret: SECRET });
	});

	it('a test listener says so in the description, cut to 200 characters', async () => {
		const { context, request } = hookContext(TEXT_PARAMS, [{ ...endpoint(OURS), secret: SECRET }], {
			mode: 'manual',
			workflowName: 'x'.repeat(300),
		});
		await createEndpoint(context);
		const description = (sent(request, 0).body as IDataObject).description as string;
		expect(description.startsWith('n8n test · x')).toBe(true);
		expect(description).toHaveLength(200);
	});

	it('the limit of 3 endpoints explains what to do', async () => {
		const { context } = hookContext(TEXT_PARAMS, [apiError('409', 'webhook_endpoint_limit_reached')]);
		const error = await createEndpoint(context).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error).toMatchObject({
			message: expect.stringContaining('webhook_endpoint_limit_reached'),
			description: expect.stringContaining('up to 3 active'),
		});
	});

	it('a key whose role cannot manage agents explains it', async () => {
		const { context } = hookContext(TEXT_PARAMS, [apiError('403', 'api_key_forbidden')]);
		const error = await createEndpoint(context).catch((e: unknown) => e);
		expect(error).toMatchObject({ description: expect.stringContaining('manage agents') });
	});

	it('without events it fails before any request', async () => {
		const { context, request } = hookContext({ ...TEXT_PARAMS, textEvents: [] }, [{}]);
		await expect(createEndpoint(context)).rejects.toThrow('Choose at least one event');
		expect(request).not.toHaveBeenCalled();
	});
});

describe('delete', () => {
	it('deletes every endpoint at its URL and forgets the secret', async () => {
		const { context, request, staticData } = hookContext(
			TEXT_PARAMS,
			[list(endpoint(OURS), endpoint(LEFTOVER), endpoint(FOREIGN, { url: OTHER_URL })), { deleted: true }],
			{ staticData: { endpointId: OURS, secret: SECRET } },
		);
		expect(await deleteEndpoint(context)).toBe(true);
		expect(request.mock.calls.slice(1).map((call) => (call[1] as IDataObject).url)).toEqual([
			`https://api.newlead.ai/v1/webhook_endpoints/${OURS}`,
			`https://api.newlead.ai/v1/webhook_endpoints/${LEFTOVER}`,
		]);
		expect(staticData).toEqual({});
	});

	it('one already gone (404) counts as deleted', async () => {
		const { context, staticData } = hookContext(TEXT_PARAMS, [list(endpoint(OURS)), apiError('404', 'resource_not_found')], {
			staticData: { endpointId: OURS, secret: SECRET },
		});
		expect(await deleteEndpoint(context)).toBe(true);
		expect(staticData).toEqual({});
	});

	it('a paused subscription (402) is logged, returns false and keeps the state', async () => {
		const { context, staticData, warn } = hookContext(
			TEXT_PARAMS,
			[list(endpoint(OURS)), apiError('402', 'subscription_inactive')],
			{ staticData: { endpointId: OURS, secret: SECRET } },
		);
		expect(await deleteEndpoint(context)).toBe(false);
		expect(warn).toHaveBeenCalledWith(
			'[NewleadTrigger] Could not delete the webhook endpoints of this node',
			expect.objectContaining({ error: expect.stringContaining('subscription_inactive') }),
		);
		expect(staticData).toEqual({ endpointId: OURS, secret: SECRET });
	});
});
