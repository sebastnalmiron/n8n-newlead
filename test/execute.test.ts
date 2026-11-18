import { NodeOperationError, type IDataObject, type INode } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { Newlead } from '../nodes/Newlead/Newlead.node';
import { NewleadV2 } from '../nodes/Newlead/v2/NewleadV2.node';

const node = { id: 'node-1', name: 'Newlead', type: 'n8n-nodes-newlead.newlead', typeVersion: 2 } as INode;
const AGENT = '11111111-1111-4111-8111-111111111111';
const LEAD = '22222222-2222-4222-8222-222222222222';

type Params = Record<string, unknown>;

function setup(
	params: Params,
	responses: IDataObject[] = [{ id: LEAD }],
	options: { items?: number; runIndex?: number; continueOnFail?: boolean } = {},
) {
	let call = 0;
	const request = vi.fn(async () => responses[Math.min(call++, responses.length - 1)]);
	const context = {
		getInputData: () => Array.from({ length: options.items ?? 1 }, () => ({ json: {} })),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		getNode: () => node,
		getExecutionId: () => 'exec-9',
		getWorkflowDataProxy: () => ({ $runIndex: options.runIndex ?? 0 }),
		getCredentials: async () => ({ baseUrl: 'https://api.newlead.ai' }),
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: {
			httpRequestWithAuthentication: request,
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (data: unknown[]) => data,
		},
	} as never;
	const run = () => new NewleadV2({} as never).execute.call(context);
	return { run, request };
}

const sent = (request: ReturnType<typeof setup>['request'], index = 0) =>
	request.mock.calls[index][1] as unknown as IDataObject;

describe('Template > Send', () => {
	const params = {
		resource: 'template',
		operation: 'send',
		textAgentId: AGENT,
		templateName: 'welcome|es',
		phoneNumber: '+34600111222',
		headerType: 'none',
		'bodyVariables.variables': [{ value: 'Ana' }],
		templateOptions: { pauseAi: true, sourceLeadId: '  ' },
	};

	it('posts the body with a stable idempotency key', async () => {
		const first = setup(params);
		await first.run();
		const again = setup(params);
		await again.run();
		const options = sent(first.request);
		expect(options.method).toBe('POST');
		expect(options.url).toBe('https://api.newlead.ai/v1/messages');
		expect(options.body).toEqual({
			type: 'template',
			text_agent_id: AGENT,
			to: '+34600111222',
			template: {
				name: 'welcome',
				language: 'es',
				components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }] }],
			},
			pause_ai: true,
		});
		expect(options.headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:0:0' });
		expect(sent(again.request).headers).toEqual(options.headers);
	});

	it('changes the key with the run and the item', async () => {
		const { run, request } = setup(params, [{}], { items: 2, runIndex: 3 });
		await run();
		expect(sent(request, 0).headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:3:0' });
		expect(sent(request, 1).headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:3:1' });
	});

	it('sends source_lead_id only when it has a value', async () => {
		const { run, request } = setup({ ...params, templateOptions: { sourceLeadId: ` ${LEAD} ` } });
		await run();
		expect((sent(request).body as IDataObject).source_lead_id).toBe(LEAD);
	});

	it('fails with a NodeOperationError on a bad phone, sending nothing', async () => {
		const { run, request } = setup({ ...params, phoneNumber: '600111222' });
		await expect(run()).rejects.toBeInstanceOf(NodeOperationError);
		expect(request).not.toHaveBeenCalled();
	});

	it('rejects an object in a template value', async () => {
		const { run, request } = setup({ ...params, 'bodyVariables.variables': [{ value: { a: 1 } }] });
		await expect(run()).rejects.toBeInstanceOf(NodeOperationError);
		expect(request).not.toHaveBeenCalled();
	});
});

describe('Message > Send', () => {
	const base = { resource: 'message', operation: 'send', textAgentId: AGENT, message: 'Hola' };

	it('sends text to a lead by id, with the key and no text_agent_id', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'id', value: LEAD } });
		await run();
		expect(request).toHaveBeenCalledTimes(1);
		const options = sent(request);
		expect(options.body).toEqual({ type: 'text', lead_id: LEAD, text: 'Hola' });
		expect(options.headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:0:0' });
	});

	it('looks the lead up by phone inside the agent, without a key on the GET', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'phone', value: '+34 600 111 222' } }, [
			{ data: [{ id: LEAD }] },
			{ id: 'msg' },
		]);
		await run();
		const lookup = sent(request, 0);
		expect(lookup.method).toBe('GET');
		expect(lookup.qs).toEqual({ phone: '+34600111222', text_agent_id: AGENT, limit: '2' });
		expect(lookup.headers).toBeUndefined();
		expect((sent(request, 1).body as IDataObject).lead_id).toBe(LEAD);
	});

	it('fails without sending when no lead has that phone', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'phone', value: '+34600111222' } }, [
			{ data: [] },
		]);
		await expect(run()).rejects.toThrow('No lead with phone');
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('fails without sending when several leads share the phone', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'phone', value: '+34600111222' } }, [
			{ data: [{ id: LEAD }, { id: 'other' }] },
		]);
		await expect(run()).rejects.toThrow('More than one lead');
		expect(request).toHaveBeenCalledTimes(1);
	});
});

describe('Lead', () => {
	it('create posts with the key and leaves an empty name out', async () => {
		const { run, request } = setup({
			resource: 'lead',
			operation: 'create',
			textAgentId: AGENT,
			phoneNumber: '+34600111222',
			name: '  ',
			'leadVariables.variables': [
				{ key: 'city', value: 'Madrid' },
				{ key: 'x', value: '' },
			],
		});
		await run();
		const options = sent(request);
		expect(options.method).toBe('POST');
		expect(options.body).toEqual({
			text_agent_id: AGENT,
			phone: '+34600111222',
			variables: { city: 'Madrid' },
		});
		expect(options.headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:0:0' });
	});

	it('update is a PATCH without key, without text_agent_id and without an empty name', async () => {
		const { run, request } = setup({
			resource: 'lead',
			operation: 'update',
			textAgentId: AGENT,
			leadId: { mode: 'id', value: LEAD },
			updateFields: { name: '', status: 'closed' },
		});
		await run();
		const options = sent(request);
		expect(options.method).toBe('PATCH');
		expect(options.url).toBe(`https://api.newlead.ai/v1/leads/${LEAD}`);
		expect(options.body).toEqual({ status: 'closed' });
		expect(options.headers).toBeUndefined();
	});

	it('update with nothing to change fails before calling the API', async () => {
		const { run, request } = setup({
			resource: 'lead',
			operation: 'update',
			textAgentId: AGENT,
			leadId: { mode: 'id', value: LEAD },
			updateFields: { name: ' ' },
		});
		await expect(run()).rejects.toThrow('Nothing to update');
		expect(request).not.toHaveBeenCalled();
	});

	it('get is a GET without key', async () => {
		const { run, request } = setup({
			resource: 'lead',
			operation: 'get',
			textAgentId: AGENT,
			leadId: { mode: 'id', value: LEAD },
		});
		await run();
		expect(sent(request).method).toBe('GET');
		expect(sent(request).headers).toBeUndefined();
	});
});

describe('AI Control', () => {
	it('pause is a POST without key', async () => {
		const { run, request } = setup({
			resource: 'aiControl',
			operation: 'pause',
			textAgentId: AGENT,
			leadId: { mode: 'id', value: LEAD },
			pauseOptions: { durationMin: 30, reason: ' ' },
		});
		await run();
		const options = sent(request);
		expect(options.url).toBe(`https://api.newlead.ai/v1/leads/${LEAD}/pause_ai`);
		expect(options.body).toEqual({ duration_min: 30 });
		expect(options.headers).toBeUndefined();
	});
});

describe('errors', () => {
	it('continueOnFail returns the message instead of throwing', async () => {
		const { run } = setup(
			{
				resource: 'message',
				operation: 'send',
				textAgentId: AGENT,
				message: 'x',
				leadId: { mode: 'phone', value: 'abc' },
			},
			[{}],
			{ continueOnFail: true },
		);
		const [result] = await run();
		expect(result[0].json.error).toContain('phone number');
	});
});

describe('versioning', () => {
	it('keeps v1 for saved flows and makes v2 the default', () => {
		const versioned = new Newlead();
		expect(versioned.currentVersion).toBe(2);
		expect(versioned.getNodeType(1).description.version).toBe(1);
		expect(versioned.getNodeType().description.version).toBe(2);
		expect(versioned.getNodeType(1)).not.toBeInstanceOf(NewleadV2);
	});
});
