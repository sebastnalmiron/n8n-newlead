import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { apiErrorOf, describeApiError } from './helpers';

const PAGE_SIZE = '100';

export interface V1RequestOptions {
	body?: IDataObject;
	query?: IDataObject;
	idempotencyKey?: string;
}

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions;

/** A request to /v1. Errors keep the API's code, message and request id. */
export async function v1Request(
	this: RequestContext,
	method: IHttpRequestMethods,
	path: string,
	options: V1RequestOptions = {},
): Promise<IDataObject> {
	const credentials = await this.getCredentials('newleadApi');
	const request: IHttpRequestOptions = {
		method,
		url: `${credentials.baseUrl as string}/v1${path}`,
		json: true,
		...(options.body && Object.keys(options.body).length > 0 ? { body: options.body } : {}),
		...(options.query && Object.keys(options.query).length > 0 ? { qs: options.query } : {}),
		...(options.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : {}),
	};
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'newleadApi',
			request,
		)) as IDataObject;
	} catch (error) {
		// httpRequestWithAuthentication already throws a NodeApiError, and the constructor ignores its
		// options for one: the texts are set on the instance.
		const apiError =
			error instanceof NodeApiError ? error : new NodeApiError(this.getNode(), error as JsonObject);
		const detail = apiErrorOf(error);
		if (detail) {
			const { message, description } = describeApiError(detail);
			apiError.message = message;
			apiError.description = description;
		}
		throw apiError;
	}
}

/**
 * Every page of a paginated list (leads, messages, calls), following next_cursor. Not for
 * /text_agents or /templates: they are a single page and the API rejects `limit` there.
 * It always ends: a page without next_cursor, or one that repeats a cursor, stops the loop.
 */
export async function v1RequestAll(
	this: RequestContext,
	path: string,
	query: IDataObject = {},
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await v1Request.call(this, 'GET', path, {
			query: { ...query, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
		});
		items.push(...((page.data as IDataObject[] | undefined) ?? []));
		const next = typeof page.next_cursor === 'string' ? page.next_cursor : '';
		cursor = page.has_more === true && next && !seen.has(next) ? next : undefined;
		if (cursor) seen.add(cursor);
	} while (cursor);
	return items;
}
