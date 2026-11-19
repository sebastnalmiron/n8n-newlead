import { NodeApiError, NodeOperationError, type IDataObject, type INode } from 'n8n-workflow';
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
		// Like n8n: a parameter that does not exist and has no default throws
		getNodeParameter: (name: string, _index: number, fallback?: unknown) => {
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Could not get parameter ${name}`);
		},
		getNode: () => node,
		getExecutionId: () => 'exec-9',
		getWorkflowDataProxy: () => ({ $runIndex: options.runIndex ?? 0 }),
		getCredentials: async () => ({ baseUrl: 'https://api.newlead.ai' }),
		continueOnFail: () => options.continueOnFail ?? false,
		helpers: {
			httpRequestWithAuthentication: request,
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (data: object[], meta: { itemData: unknown }) =>
				data.map((item) => ({ ...item, pairedItem: meta.itemData })),
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

	it('uses the own idempotency key when given', async () => {
		const { run, request } = setup({ ...params, templateOptions: { idempotencyKey: ' crm-9 ' } });
		await run();
		expect(sent(request).headers).toEqual({ 'Idempotency-Key': 'crm-9' });
	});

	it('rejects an own key over 255 characters, sending nothing', async () => {
		const { run, request } = setup({ ...params, templateOptions: { idempotencyKey: 'k'.repeat(256) } });
		await expect(run()).rejects.toBeInstanceOf(NodeOperationError);
		expect(request).not.toHaveBeenCalled();
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
		const { run, request } = setup({ ...base, leadId: { mode: 'id', value: LEAD } }, [
			{ id: LEAD, text_agent_id: AGENT },
			{ id: 'msg' },
		]);
		await run();
		expect(request).toHaveBeenCalledTimes(2);
		expect(sent(request, 0).method).toBe('GET');
		expect(sent(request, 0).url).toBe(`https://api.newlead.ai/v1/leads/${LEAD}`);
		expect(sent(request, 0).headers).toBeUndefined();
		const options = sent(request, 1);
		expect(options.body).toEqual({ type: 'text', lead_id: LEAD, text: 'Hola' });
		expect(options.headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:0:0' });
	});

	it('does not send when the lead belongs to another agent', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'id', value: LEAD } }, [
			{ id: LEAD, text_agent_id: '33333333-3333-4333-8333-333333333333' },
		]);
		await expect(run()).rejects.toThrow(/does not belong to the selected text agent/);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('does not send to a lead without a text agent', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'list', value: LEAD } }, [
			{ id: LEAD, text_agent_id: null },
		]);
		await expect(run()).rejects.toThrow(/does not belong to the selected text agent/);
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('rejects an empty or invalid lead id before any request', async () => {
		for (const value of ['', 'abc']) {
			const { run, request } = setup({ ...base, leadId: { mode: 'id', value } });
			await expect(run()).rejects.toBeInstanceOf(NodeOperationError);
			expect(request).not.toHaveBeenCalled();
		}
	});

	it('uses the own idempotency key when given, and the generated one when empty', async () => {
		const byPhone = { mode: 'phone', value: '+34600111222' };
		const own = setup(
			{ ...base, leadId: byPhone, messageOptions: { idempotencyKey: ' crm-7 ' } },
			[{ data: [{ id: LEAD, channel: 'whatsapp' }] }, { id: 'msg' }],
		);
		await own.run();
		expect(sent(own.request, 1).headers).toEqual({ 'Idempotency-Key': 'crm-7' });
		const empty = setup(
			{ ...base, leadId: byPhone, messageOptions: { idempotencyKey: '' } },
			[{ data: [{ id: LEAD, channel: 'whatsapp' }] }, { id: 'msg' }],
		);
		await empty.run();
		expect(sent(empty.request, 1).headers).toEqual({ 'Idempotency-Key': 'n8n:exec-9:node-1:0:0' });
	});

	it('looks the lead up by phone inside the agent, without a key on the GET', async () => {
		const { run, request } = setup({ ...base, leadId: { mode: 'phone', value: '+34 600 111 222' } }, [
			{ data: [{ id: LEAD, channel: 'whatsapp' }] },
			{ id: 'msg' },
		]);
		await run();
		const lookup = sent(request, 0);
		expect(lookup.method).toBe('GET');
		expect(lookup.qs).toEqual({ phone: '+34600111222', text_agent_id: AGENT, limit: '100' });
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
			{ data: [{ id: LEAD, channel: 'whatsapp' }, { id: 'other', channel: 'meta_ads' }] },
		]);
		await expect(run()).rejects.toThrow('More than one lead');
		expect(request).toHaveBeenCalledTimes(1);
	});
});

describe('Message > Send: lead by phone and channel', () => {
	const send = {
		resource: 'message',
		operation: 'send',
		textAgentId: AGENT,
		message: 'Hola',
		leadId: { mode: 'phone', value: '+34600111222' },
	};

	it('picks the WhatsApp lead when a web chat twin has the same phone', async () => {
		const { run, request } = setup(send, [
			{ data: [{ id: 'web', channel: 'webchat' }, { id: LEAD, channel: 'whatsapp' }] },
			{ id: 'msg' },
		]);
		await run();
		expect((sent(request, 1).body as IDataObject).lead_id).toBe(LEAD);
	});

	it('fails without sending when only the web chat lead has the phone', async () => {
		const { run, request } = setup(send, [{ data: [{ id: 'web', channel: 'webchat' }] }]);
		await expect(run()).rejects.toThrow('No lead with phone');
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
		expect(options.body).toEqual({ duration_minutes: 30 });
		expect(options.headers).toBeUndefined();
	});
});

describe('AI Control: resume, status and invalid ids', () => {
	const ai = { resource: 'aiControl', textAgentId: AGENT, leadId: { mode: 'id', value: LEAD } };

	it('resume is a POST without key and without body', async () => {
		const { run, request } = setup({ ...ai, operation: 'resume' });
		await run();
		const options = sent(request);
		expect(options.url).toBe(`https://api.newlead.ai/v1/leads/${LEAD}/resume_ai`);
		expect(options.body).toBeUndefined();
		expect(options.headers).toBeUndefined();
	});

	it('status returns the three fields of the lead', async () => {
		const { run } = setup({ ...ai, operation: 'getStatus' }, [
			{ id: LEAD, ai_paused: true, ai_paused_until: '2026-12-01T10:00:00Z', name: 'x' },
		]);
		const [result] = await run();
		expect(result[0].json).toEqual({
			lead_id: LEAD,
			ai_paused: true,
			ai_paused_until: '2026-12-01T10:00:00Z',
		});
	});

	it('status with an empty lead id fails instead of reading undefined', async () => {
		const { run, request } = setup({
			...ai,
			operation: 'getStatus',
			leadId: { mode: 'id', value: '' },
		});
		await expect(run()).rejects.toBeInstanceOf(NodeOperationError);
		expect(request).not.toHaveBeenCalled();
	});

	it('pause with a negative duration fails before calling the API', async () => {
		const { run, request } = setup({ ...ai, operation: 'pause', pauseOptions: { durationMin: -5 } });
		await expect(run()).rejects.toBeInstanceOf(NodeOperationError);
		expect(request).not.toHaveBeenCalled();
	});
});

describe('Lead > Get Many and Property', () => {
	it('getMany lists with the agent, the filters and the limit', async () => {
		const { run, request } = setup(
			{
				resource: 'lead',
				operation: 'getMany',
				textAgentId: AGENT,
				returnAll: false,
				limit: 10,
				filters: { status: 'closed' },
			},
			[{ data: [{ id: 'a' }, { id: 'b' }] }],
		);
		const [result] = await run();
		expect(sent(request).qs).toEqual({ text_agent_id: AGENT, status: 'closed', limit: '10' });
		expect(result.map((item) => item.json.id)).toEqual(['a', 'b']);
	});

	it('getMany with return all follows the cursor', async () => {
		const { run, request } = setup(
			{ resource: 'lead', operation: 'getMany', textAgentId: AGENT, returnAll: true },
			[
				{ data: [{ id: 'a' }], has_more: true, next_cursor: 'c1' },
				{ data: [{ id: 'b' }], has_more: false, next_cursor: null },
			],
		);
		const [result] = await run();
		expect(request).toHaveBeenCalledTimes(2);
		expect((sent(request, 1).qs as IDataObject).cursor).toBe('c1');
		expect(result).toHaveLength(2);
	});

	it('property accepts a numeric reference and simplifies', async () => {
		const { run, request } = setup(
			{ resource: 'property', operation: 'getByReference', reference: 109876543 },
			[{ data: [] }],
		);
		const [result] = await run();
		expect(sent(request).qs).toEqual({ reference: '109876543' });
		expect(result[0].json).toMatchObject({ found: false, status: 'none' });
	});

	it('property getMany lists the published properties up to the limit', async () => {
		const { run, request } = setup(
			{ resource: 'property', operation: 'getMany', returnAll: false, limit: 5 },
			[{ data: [{ id: 'p1' }, { id: 'p2' }], has_more: true, next_cursor: 'c1' }],
		);
		const [result] = await run();
		expect(request).toHaveBeenCalledTimes(1);
		expect(sent(request).qs).toEqual({ limit: '5' });
		expect(result.map((item) => item.json.id)).toEqual(['p1', 'p2']);
	});

	it('property getMany with return all follows the cursor', async () => {
		const { run, request } = setup({ resource: 'property', operation: 'getMany', returnAll: true }, [
			{ data: [{ id: 'p1' }], has_more: true, next_cursor: 'c1' },
			{ data: [{ id: 'p2' }], has_more: false, next_cursor: null },
		]);
		const [result] = await run();
		expect(request).toHaveBeenCalledTimes(2);
		expect((sent(request, 1).qs as IDataObject).cursor).toBe('c1');
		expect(result.map((item) => item.json.id)).toEqual(['p1', 'p2']);
	});
});

describe('Property > Get by Reference: more than 3 matches', () => {
	const params = { resource: 'property', operation: 'getByReference', reference: '546' };
	const invalid = (message: string) =>
		new NodeApiError(node, {
			message: 'Bad Request',
			httpCode: '400',
			response: { data: { error: { code: 'parameter_invalid', message, param: 'reference' } } },
		});

	it('is a result with Simplify on', async () => {
		const { run, request } = setup(params, [{}]);
		request.mockRejectedValue(
			invalid('reference matches 12 properties. Send the full Idealista listing code or the internal reference.'),
		);
		const [result] = await run();
		expect(result[0].json).toMatchObject({ found: false, status: 'many' });
	});

	it('stays an error for a malformed reference', async () => {
		const { run, request } = setup(params, [{}]);
		request.mockRejectedValue(invalid('reference does not match the pattern'));
		await expect(run()).rejects.toThrow('parameter_invalid');
	});

	it('stays an error with Simplify off', async () => {
		const { run, request } = setup({ ...params, simplify: false }, [{}]);
		request.mockRejectedValue(invalid('reference matches 12 properties. Send more.'));
		await expect(run()).rejects.toThrow('parameter_invalid');
	});
});

describe('continueOnFail', () => {
	const getLead = {
		resource: 'lead',
		operation: 'get',
		textAgentId: AGENT,
		leadId: { mode: 'id', value: LEAD },
	};

	function failingRun(error: Error) {
		const { run, request } = setup(getLead, [{}], { continueOnFail: true });
		request.mockRejectedValue(error);
		return run;
	}

	function apiError(code: string, extra: IDataObject = {}) {
		return new NodeApiError(node, {
			message: 'Bad Gateway',
			httpCode: '502',
			response: {
				data: { error: { code, message: 'texto', param: null, request_id: 'req_1', ...extra } },
			},
		});
	}

	it('keeps code and request id of an API error on the error item', async () => {
		const [items] = await failingRun(apiError('lead_not_found'))();
		expect(items[0].json.error).toBe('lead_not_found: texto');
		expect(items[0].json.details).toMatchObject({
			code: 'lead_not_found',
			request_id: 'req_1',
			outcome_unknown: false,
		});
		expect(items[0].error).toBeInstanceOf(NodeApiError);
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});

	it('flags a send with an unknown outcome', async () => {
		const [items] = await failingRun(
			apiError('send_outcome_unknown', { details: { call_id: 'c1' } }),
		)();
		const details = items[0].json.details as IDataObject;
		expect(details.outcome_unknown).toBe(true);
		expect(details.code).toBe('send_outcome_unknown');
		expect(String(details.description)).toContain('do not repeat it with a different idempotency key');
	});

	it('gives null code and request id for a validation error', async () => {
		const { run } = setup({ ...getLead, leadId: { mode: 'id', value: 'abc' } }, [{}], {
			continueOnFail: true,
		});
		const [items] = await run();
		expect(items[0].json.error).toContain('lead ID');
		expect(items[0].json.details).toMatchObject({
			code: null,
			request_id: null,
			outcome_unknown: false,
		});
		expect(items[0].error).toBeInstanceOf(NodeOperationError);
		expect(items[0].pairedItem).toEqual({ item: 0 });
	});
});

describe('versioning', () => {
	it('opens the AI tool variant of version 1 as version 1', () => {
		const versioned = new Newlead();
		const v1 = versioned.getNodeType(1).description;
		expect(v1).toMatchObject({ version: 1, defaultVersion: 1 });
		expect(versioned.description.defaultVersion).toBe(2);
	});

	it('is not offered as an AI tool: a retry as a tool changes the run index, and with it the key', () => {
		expect(new NewleadV2({} as never).description.usableAsTool).toBeUndefined();
	});

	it('keeps v1 for saved flows and makes v2 the default', () => {
		const versioned = new Newlead();
		expect(versioned.currentVersion).toBe(2);
		expect(versioned.getNodeType(1).description.version).toBe(1);
		expect(versioned.getNodeType().description.version).toBe(2);
		expect(versioned.getNodeType(1)).not.toBeInstanceOf(NewleadV2);
	});
});

describe('Dropdowns follow pagination', () => {
	function loadContext(responses: IDataObject[], current: Params = {}) {
		let call = 0;
		const request = vi.fn(async () => responses[Math.min(call++, responses.length - 1)]);
		const context = {
			getNode: () => node,
			getCurrentNodeParameter: (name: string) => current[name],
			getCredentials: async () => ({ baseUrl: 'https://api.newlead.ai' }),
			helpers: { httpRequestWithAuthentication: request },
		} as never;
		return { context, request };
	}
	const loadOptions = new NewleadV2({} as never).methods.loadOptions;

	it('getTextAgents returns agents from every page', async () => {
		const { context, request } = loadContext([
			{ data: [{ id: 'a1', name: 'One' }], has_more: true, next_cursor: 'c1' },
			{ data: [{ id: 'a2', name: 'Two' }], has_more: false, next_cursor: null },
		]);
		const options = await loadOptions.getTextAgents.call(context);
		expect(options.map((option) => option.value)).toEqual(['a1', 'a2']);
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('getTemplates finds an approved template on the second page', async () => {
		const { context } = loadContext(
			[
				{
					data: [{ name: 'old', language: 'es', status: 'REJECTED', category: 'UTILITY' }],
					has_more: true,
					next_cursor: 'c1',
				},
				{
					data: [{ name: 'welcome', language: 'es', status: 'APPROVED', category: 'UTILITY' }],
					has_more: false,
					next_cursor: null,
				},
			],
			{ textAgentId: AGENT },
		);
		const options = await loadOptions.getTemplates.call(context);
		expect(options.map((option) => option.value)).toEqual(['welcome|es']);
	});
});
