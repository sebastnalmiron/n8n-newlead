import type { IDataObject } from 'n8n-workflow';

export type TemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

export interface TemplateComponentsInput {
	headerType: TemplateHeaderType;
	headerValue?: string;
	headerFilename?: string;
	bodyVariables: IDataObject[];
	urlButtons: IDataObject[];
}

export interface ApiErrorInfo {
	code: string;
	message: string;
	param: string | null;
	requestId: string | null;
}

/** The API only takes E.164: `34 600-111-222` becomes `+34600111222`. */
export function toE164(phone: string): string {
	return `+${phone.replace(/\D/g, '')}`;
}

/** The template dropdown stores `name|language`. */
export function splitTemplateValue(value: string): { name: string; language: string } {
	const [name, language] = value.split('|');
	if (!name || !language) {
		throw new Error('The template must be in the form name|language');
	}
	return { name, language };
}

function headerParameter(input: TemplateComponentsInput): IDataObject | null {
	const value = input.headerValue?.trim();
	if (input.headerType === 'none' || !value) {
		return null;
	}
	if (input.headerType === 'text') {
		return { type: 'text', text: value };
	}
	if (input.headerType === 'document') {
		const filename = input.headerFilename?.trim();
		return { type: 'document', document: { link: value, ...(filename ? { filename } : {}) } };
	}
	return { type: input.headerType, [input.headerType]: { link: value } };
}

/** The `template.components` of POST /v1/messages: header, body and URL buttons. */
export function buildTemplateComponents(input: TemplateComponentsInput): IDataObject[] {
	const components: IDataObject[] = [];
	const header = headerParameter(input);
	if (header) {
		components.push({ type: 'header', parameters: [header] });
	}
	if (input.bodyVariables.length > 0) {
		components.push({
			type: 'body',
			parameters: input.bodyVariables.map((row) => ({
				type: 'text',
				text: String(row.value ?? ''),
			})),
		});
	}
	for (const button of input.urlButtons) {
		components.push({
			type: 'button',
			sub_type: 'url',
			index: String(button.index ?? 0),
			parameters: [{ type: 'text', text: String(button.value ?? '') }],
		});
	}
	return components;
}

/**
 * Key/value rows → lead variables. Empty keys and blank values are skipped: an expression that
 * resolves to nothing must not wipe a value the lead already has. 0 and false are kept.
 */
export function buildLeadVariables(rows: IDataObject[]): IDataObject | undefined {
	const variables: IDataObject = {};
	for (const row of rows) {
		const key = String(row.key ?? '').trim();
		const value = row.value;
		if (!key || value === undefined || value === null) continue;
		if (typeof value === 'string' && value.trim() === '') continue;
		variables[key] = value;
	}
	return Object.keys(variables).length > 0 ? variables : undefined;
}

/** The optional body of pause_ai. Without a duration the pause lasts until resume_ai. */
export function buildPauseBody(options: IDataObject): IDataObject {
	const minutes = Math.floor(Number(options.durationMin));
	const reason = String(options.reason ?? '').trim();
	return {
		...(Number.isFinite(minutes) && minutes > 0 ? { duration_min: minutes } : {}),
		...(reason ? { reason } : {}),
	};
}

/** Same execution, node and item, same key: n8n's Retry On Fail never sends twice. */
export function idempotencyKeyFor(executionId: string, nodeId: string, itemIndex: number): string {
	return `n8n:${executionId}:${nodeId}:${itemIndex}`;
}

function errorBodyOf(error: IDataObject): IDataObject | undefined {
	const response = error.response as IDataObject | undefined;
	const causeResponse = (error.cause as IDataObject | undefined)?.response as
		| IDataObject
		| undefined;
	const candidates = [
		response?.data,
		response?.body,
		causeResponse?.data,
		causeResponse?.body,
		error.body,
	];
	return candidates.find(
		(candidate) =>
			typeof candidate === 'object' &&
			candidate !== null &&
			typeof (candidate as IDataObject).error === 'object' &&
			(candidate as IDataObject).error !== null,
	) as IDataObject | undefined;
}

/** The `{ error: { code, message, param, request_id } }` of a v1 response, wherever n8n left it. */
export function apiErrorOf(error: unknown): ApiErrorInfo | null {
	if (typeof error !== 'object' || error === null) {
		return null;
	}
	const detail = errorBodyOf(error as IDataObject)?.error as IDataObject | undefined;
	if (typeof detail?.code !== 'string') {
		return null;
	}
	return {
		code: detail.code,
		message: String(detail.message ?? detail.code),
		param: typeof detail.param === 'string' ? detail.param : null,
		requestId: typeof detail.request_id === 'string' ? detail.request_id : null,
	};
}

function statusOf(count: number): 'none' | 'unique' | 'few' {
	if (count === 0) return 'none';
	return count === 1 ? 'unique' : 'few';
}

/**
 * GET /v1/properties → flat fields for template variables, with the same names as node version 1.
 * `found` is true only with exactly one match. The agent notes are left out on purpose: they are
 * never sent to leads.
 */
export function simplifyProperties(properties: IDataObject[]): IDataObject {
	const property = properties.length === 1 ? properties[0] : {};
	const listings = (property.listings as IDataObject[] | undefined) ?? [];
	const listingOf = (operation: unknown) => listings.find((item) => item.operation === operation);
	const fieldOf = (operation: unknown, field: string) => listingOf(operation)?.[field] ?? null;
	const matched = (property.matched_operation as string | null | undefined) ?? null;
	const matchedGone = matched !== null && listingOf(matched)?.available !== true;
	const salesAgent = property.sales_agent as IDataObject | null | undefined;
	return {
		found: properties.length === 1,
		status: statusOf(properties.length),
		operation: matched,
		reference: property.reference ?? null,
		internal_reference: property.internal_reference ?? null,
		available:
			property.available === undefined ? null : property.available === true && !matchedGone,
		summary: property.summary ?? null,
		property_type: property.type_label ?? null,
		city: property.city ?? null,
		province: property.province ?? null,
		address: property.address ?? null,
		bedrooms: property.bedrooms ?? null,
		bathrooms: property.bathrooms ?? null,
		built_m2: property.built_m2 ?? null,
		price: fieldOf(matched, 'price'),
		price_sale: fieldOf('sale', 'price'),
		price_rent: fieldOf('rent', 'price'),
		reference_sale: fieldOf('sale', 'idealista_code'),
		reference_rent: fieldOf('rent', 'idealista_code'),
		features: property.features ?? null,
		description: property.description ?? null,
		url: property.url ?? null,
		url_sale: fieldOf('sale', 'url'),
		url_rent: fieldOf('rent', 'url'),
		sales_agent_name: salesAgent?.name ?? null,
		sales_agent_phone: salesAgent?.phone ?? null,
		visit_hours: property.visit_hours ?? null,
		candidates_count: properties.length > 1 ? properties.length : 0,
	};
}
