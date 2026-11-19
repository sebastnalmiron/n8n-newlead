import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { apiErrorOf, describeApiError } from './helpers';

const PAGE_SIZE = '100';

export interface V1RequestOptions {
	body?: IDataObject;
	query?: IDataObject;
	idempotencyKey?: string;
}

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions;

interface FullResponse {
	statusCode: number;
	headers: IDataObject;
	body: unknown;
}

function v1Url(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, '')}/v1${path}`;
}

/** The NodeApiError of a failed request, with the API's code, message and request id when the body has them. */
function toNodeApiError(context: RequestContext, error: unknown): NodeApiError {
	// httpRequestWithAuthentication already throws a NodeApiError, and the constructor ignores its
	// options for one: the texts are set on the instance.
	const apiError =
		error instanceof NodeApiError ? error : new NodeApiError(context.getNode(), error as JsonObject);
	const detail = apiErrorOf(error);
	if (detail) {
		const { message, description } = describeApiError(detail);
		apiError.message = message;
		apiError.description = description;
	}
	return apiError;
}

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
		url: v1Url(credentials.baseUrl as string, path),
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
		throw toNodeApiError(this, error);
	}
}

/**
 * Every page of a paginated list (leads, messages, calls), following next_cursor.
 * It always ends, and never returns a partial list: a page that says has_more without a
 * next_cursor, or one that repeats a cursor, throws.
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
		if (page.has_more !== true) {
			cursor = undefined;
		} else if (!next || seen.has(next)) {
			throw new NodeOperationError(
				this.getNode(),
				`Pagination was interrupted on /v1${path}: the API reported more results but ${next ? 'repeated a cursor' : 'sent no next_cursor'}. Try again later; if it persists, contact support.`,
			);
		} else {
			cursor = next;
			seen.add(next);
		}
	} while (cursor);
	return items;
}

/**
 * The Location of a /v1 route that answers with a redirect (the recording of a call), without
 * following it: on a redirect to another host n8n would send the x-api-key header there too.
 */
export async function v1RedirectLocation(this: IExecuteFunctions, path: string): Promise<string> {
	const credentials = await this.getCredentials('newleadApi');
	let response: FullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, 'newleadApi', {
			method: 'GET',
			url: v1Url(credentials.baseUrl as string, path),
			json: true,
			disableFollowRedirect: true,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		})) as FullResponse;
	} catch (error) {
		throw toNodeApiError(this, error);
	}
	const location = response.headers?.location;
	if (response.statusCode >= 300 && response.statusCode < 400 && typeof location === 'string' && location) {
		return location;
	}
	// With ignoreHttpStatusErrors an API error arrives as a response: it becomes the error any other request gives
	throw toNodeApiError(this, {
		message:
			response.statusCode < 400
				? 'The API answered without the link to the recording'
				: `Request failed with status code ${response.statusCode}`,
		httpCode: String(response.statusCode),
		response: { data: response.body },
	});
}
