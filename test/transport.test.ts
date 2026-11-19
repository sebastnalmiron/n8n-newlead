import { NodeApiError, NodeOperationError, type IDataObject, type INode } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import { v1RedirectLocation, v1Request, v1RequestAll } from '../nodes/Newlead/v2/transport';

const node = { name: 'Newlead', type: 'n8n-nodes-newlead.newlead', typeVersion: 2 } as INode;

function setup(impl: (...args: unknown[]) => Promise<unknown>) {
	const request = vi.fn(impl);
	const context = {
		getCredentials: vi.fn().mockResolvedValue({ baseUrl: 'https://api.newlead.ai' }),
		getNode: () => node,
		helpers: { httpRequestWithAuthentication: request },
	} as never;
	return { context, request };
}

function pages(list: IDataObject[]) {
	let call = 0;
	return setup(async () => list[Math.min(call++, list.length - 1)]);
}

describe('v1Request', () => {
	it('builds the /v1 request with body, query and the idempotency key', async () => {
		const { context, request } = setup(async () => ({ id: 'x' }));
		const result = await v1Request.call(context, 'POST', '/messages', {
			body: { type: 'text' },
			query: { a: 1 },
			idempotencyKey: 'k',
		});
		expect(result).toEqual({ id: 'x' });
		const [credential, options] = request.mock.calls[0];
		expect(credential).toBe('newleadApi');
		expect(options).toEqual({
			method: 'POST',
			url: 'https://api.newlead.ai/v1/messages',
			json: true,
			body: { type: 'text' },
			qs: { a: 1 },
			headers: { 'Idempotency-Key': 'k' },
		});
	});

	it('leaves empty body and query out', async () => {
		const { context, request } = setup(async () => ({}));
		await v1Request.call(context, 'GET', '/text_agents', { body: {}, query: {} });
		expect(request.mock.calls[0][1]).toEqual({
			method: 'GET',
			url: 'https://api.newlead.ai/v1/text_agents',
			json: true,
		});
	});

	it('writes the API error texts on the NodeApiError n8n already threw', async () => {
		const thrown = new NodeApiError(node, {
			message: 'Bad Gateway',
			httpCode: '502',
			response: {
				data: {
					error: {
						code: 'send_outcome_unknown',
						message: 'unknown',
						request_id: 'req_1',
						details: { call_id: 'call_9' },
					},
				},
			},
		} as never);
		const { context } = setup(() => Promise.reject(thrown));
		const error = await v1Request.call(context, 'POST', '/messages').catch((e: unknown) => e);
		expect(error).toBe(thrown);
		expect(error).toMatchObject({
			message: 'The send may have gone out',
			description: expect.stringContaining('Call ID: call_9. Request ID: req_1.'),
		});
	});

	it('turns a plain network error into a NodeApiError that keeps the original text', async () => {
		const thrown = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
		const { context } = setup(() => Promise.reject(thrown));
		const error = await v1Request.call(context, 'GET', '/leads').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		// n8n words ECONNRESET its own way and keeps the original text in `messages`
		expect((error as NodeApiError).messages).toContain('read ECONNRESET');
		expect((error as NodeApiError).message).not.toBe('');
	});

	it('does not double the slash when the base URL ends with one', async () => {
		const { context, request } = setup(async () => ({}));
		(context as unknown as { getCredentials: { mockResolvedValue: (v: unknown) => void } }).getCredentials.mockResolvedValue({
			baseUrl: 'https://rest.newlead.ai/',
		});
		await v1Request.call(context, 'GET', '/leads');
		expect(request.mock.calls[0][1]).toMatchObject({ url: 'https://rest.newlead.ai/v1/leads' });
	});
});

describe('v1RequestAll', () => {
	it('follows next_cursor with limit 100 until has_more is false', async () => {
		const { context, request } = pages([
			{ data: [{ id: 1 }], has_more: true, next_cursor: 'c1' },
			{ data: [{ id: 2 }], has_more: false, next_cursor: null },
		]);
		const items = await v1RequestAll.call(context, '/leads', { status: 'active' });
		expect(items).toEqual([{ id: 1 }, { id: 2 }]);
		expect(request.mock.calls[0][1]).toMatchObject({ qs: { status: 'active', limit: '100' } });
		expect(request.mock.calls[1][1]).toMatchObject({
			qs: { status: 'active', limit: '100', cursor: 'c1' },
		});
	});

	it('fails if has_more is true but there is no next_cursor', async () => {
		const { context, request } = pages([{ data: [{ id: 1 }], has_more: true, next_cursor: null }]);
		const error = await v1RequestAll.call(context, '/leads').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toContain('Pagination was interrupted');
		expect((error as Error).message).toContain('/leads');
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('fails if the API repeats a cursor', async () => {
		const { context, request } = pages([{ data: [{ id: 1 }], has_more: true, next_cursor: 'same' }]);
		const error = await v1RequestAll.call(context, '/leads').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeOperationError);
		expect((error as Error).message).toContain('/leads');
		expect(request).toHaveBeenCalledTimes(2);
	});
});

describe('v1RedirectLocation', () => {
	it('asks without following the redirect and returns the Location', async () => {
		const { context, request } = setup(async () => ({
			statusCode: 302,
			headers: { location: 'https://store.example.com/x.ogg?sig=1' },
			body: '',
		}));
		const link = await v1RedirectLocation.call(context, '/calls/c1/recording');
		expect(link).toBe('https://store.example.com/x.ogg?sig=1');
		expect(request.mock.calls[0][1]).toEqual({
			method: 'GET',
			url: 'https://api.newlead.ai/v1/calls/c1/recording',
			json: true,
			disableFollowRedirect: true,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		});
	});

	it('turns an API error that arrives as a response into its NodeApiError', async () => {
		const { context } = setup(async () => ({
			statusCode: 404,
			headers: {},
			body: {
				error: {
					code: 'resource_not_found',
					message: 'This call has no recording.',
					param: 'call_id',
					request_id: 'req_4',
				},
			},
		}));
		const error = await v1RedirectLocation.call(context, '/calls/c1/recording').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error).toMatchObject({
			message: 'resource_not_found: This call has no recording.',
			description: expect.stringContaining('Request ID: req_4.'),
		});
	});

	it('fails when the API answers without a link', async () => {
		const { context } = setup(async () => ({ statusCode: 200, headers: {}, body: {} }));
		await expect(v1RedirectLocation.call(context, '/calls/c1/recording')).rejects.toBeInstanceOf(
			NodeApiError,
		);
	});
});
