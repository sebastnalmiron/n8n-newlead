import type { IDataObject } from 'n8n-workflow';

export type TemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

export interface TemplateComponentsInput {
	headerType: TemplateHeaderType;
	headerValue?: unknown;
	headerFilename?: string;
	bodyVariables: IDataObject[];
	urlButtons: IDataObject[];
}

export interface ApiErrorInfo {
	code: string;
	message: string;
	param: string | null;
	requestId: string | null;
	details: IDataObject | null;
}

/**
 * The API only takes E.164: `34 600-111-222` becomes `+34600111222`. A number without `+` or `00`
 * must already carry its country code (11+ digits, WhatsApp style): guessing one would send the
 * message to somebody else.
 */
export function toE164(phone: unknown): string {
	const raw = String(phone ?? '').trim();
	if (!raw) {
		throw new Error('The phone number is empty');
	}
	if (!/^\+?[\d\s\-()]+$/.test(raw) || /\(\s*0\s*\)/.test(raw)) {
		throw new Error(
			`The phone number "${raw}" can only have digits, a leading + and the separators space, hyphen and parentheses (and no (0))`,
		);
	}
	const digits = raw.replace(/\D/g, '');
	let international: string | null = null;
	if (raw.startsWith('+')) international = digits;
	else if (digits.startsWith('00')) international = digits.slice(2);
	else if (digits.length >= 11) international = digits;
	if (international === null) {
		throw new Error(
			`The phone number "${raw}" is missing the country prefix: use the international format, for example +34600111222`,
		);
	}
	const normalized = `+${international}`;
	if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
		throw new Error(`The phone number "${raw}" is not a valid international number`);
	}
	return normalized;
}

/** Template values are text, numbers or booleans; anything else would reach the lead as `[object Object]`. */
function templateText(value: unknown, label: string): string {
	if (value === undefined || value === null) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	throw new Error(`${label} must be text, number or boolean`);
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
	const value = templateText(input.headerValue, 'The header value').trim();
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
				text: templateText(row.value, 'A body variable'),
			})),
		});
	}
	for (const button of input.urlButtons) {
		components.push({
			type: 'button',
			sub_type: 'url',
			index: String(button.index ?? 0),
			parameters: [{ type: 'text', text: templateText(button.value, 'A button value') }],
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

/**
 * The optional body of pause_ai. Without a duration (empty or 0) the pause lasts until resume_ai.
 * A negative or non-numeric duration throws: turning it into an indefinite pause would silence
 * the lead without anybody asking for it.
 */
export function buildPauseBody(options: IDataObject): IDataObject {
	const raw = String(options.durationMin ?? '').trim();
	const duration = raw === '' ? 0 : Number(raw);
	if (!Number.isFinite(duration) || duration < 0) {
		throw new Error(`The pause duration "${raw}" must be a number of minutes, 0 or more`);
	}
	const minutes = Math.floor(duration);
	const reason = String(options.reason ?? '').trim();
	return {
		...(minutes > 0 ? { duration_minutes: minutes } : {}),
		...(reason ? { reason } : {}),
	};
}

const LEAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A lead id outside the phone mode. An empty one would turn GET /v1/leads/{id} into the lead list. */
export function assertLeadId(value: unknown): string {
	const raw = typeof value === 'string' ? value : '';
	const id = raw.trim();
	if (!LEAD_ID_PATTERN.test(id)) {
		throw new Error(
			`The lead ID "${raw}" is not valid: it must be a UUID such as 00000000-0000-4000-8000-000000000001`,
		);
	}
	return id;
}

const IDEMPOTENCY_KEY_MAX = 255;

/** The key the user chose (their CRM record id, say) wins over the generated one. */
export function pickIdempotencyKey(own: unknown, generated: string): string {
	const key = typeof own === 'string' ? own.trim() : '';
	if (!key) return generated;
	if (key.length > IDEMPOTENCY_KEY_MAX) {
		throw new Error(`The idempotency key can have up to ${IDEMPOTENCY_KEY_MAX} characters`);
	}
	return key;
}

/**
 * Same execution, node, run and item, same key: n8n's Retry On Fail never sends twice. The run
 * index matters: Loop Over Items restarts `itemIndex` at 0 on every pass, so without it the second
 * pass would reuse the first key and that lead would never get its message.
 */
export function idempotencyKeyFor(
	executionId: string,
	nodeId: string,
	runIndex: number,
	itemIndex: number,
): string {
	return `n8n:${executionId}:${nodeId}:${runIndex}:${itemIndex}`;
}

function isPlainObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorBodyOf(error: IDataObject): IDataObject | undefined {
	// NodeApiError keeps the response body in context.data
	const context = error.context as IDataObject | undefined;
	const response = error.response as IDataObject | undefined;
	const causeResponse = (error.cause as IDataObject | undefined)?.response as
		| IDataObject
		| undefined;
	const candidates = [
		response?.data,
		response?.body,
		causeResponse?.data,
		causeResponse?.body,
		context?.data,
		error.body,
	];
	return candidates.find(
		(candidate) => isPlainObject(candidate) && isPlainObject(candidate.error),
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
		details: isPlainObject(detail.details) ? detail.details : null,
	};
}

/** Text for the n8n error panel. A send with an unknown outcome must not be retried blindly. */
export function describeApiError(detail: ApiErrorInfo): { message: string; description: string } {
	const requestId = detail.requestId ? `Request ID: ${detail.requestId}.` : '';
	if (detail.code === 'send_outcome_unknown') {
		const callId =
			typeof detail.details?.call_id === 'string' ? `Call ID: ${detail.details.call_id}.` : '';
		return {
			message: 'The send may have gone out',
			description: [
				'Check whether it was delivered before repeating it, and do not repeat it with a different idempotency key.',
				callId,
				requestId,
			]
				.filter(Boolean)
				.join(' '),
		};
	}
	const param = detail.param ? `Parameter: ${detail.param}.` : '';
	return {
		message: `${detail.code}: ${detail.message}`,
		description: [param, requestId].filter(Boolean).join(' '),
	};
}

/** What an error item carries for a Continue On Fail flow, so it can tell an uncertain send from a failed one. */
export function errorDetails(error: { description?: string | null }): IDataObject {
	const detail = apiErrorOf(error);
	return {
		code: detail?.code ?? null,
		request_id: detail?.requestId ?? null,
		outcome_unknown: detail?.code === 'send_outcome_unknown',
		description: error.description ?? null,
	};
}

function statusOf(count: number): 'none' | 'unique' | 'few' {
	if (count === 0) return 'none';
	return count === 1 ? 'unique' : 'few';
}

/** GET /v1/properties answers parameter_invalid on `reference` for both a malformed one and more than 3 matches; only the message tells them apart. */
export function isTooManyMatches(error: unknown): boolean {
	const detail = apiErrorOf(error);
	return (
		detail?.code === 'parameter_invalid' &&
		detail.param === 'reference' &&
		/^reference matches \d+ properties/.test(detail.message)
	);
}

/** 1800 → "1.800 € al mes" (rent), 333000 → "333.000 €" (sale): the text version 1 gave. */
function formatPrice(price: unknown, operation: 'sale' | 'rent' | null): string | null {
	if (typeof price !== 'number') return null;
	const amount = Math.round(price)
		.toString()
		.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return operation === 'rent' ? `${amount} € al mes` : `${amount} €`;
}

/**
 * GET /v1/properties → flat fields for template variables, with the same names as node version 1.
 * `found` is true only with exactly one match. The agent notes are left out on purpose: they are
 * never sent to leads.
 */
export function simplifyProperties(
	properties: IDataObject[],
	forcedStatus?: 'many',
): IDataObject {
	const property = properties.length === 1 ? properties[0] : {};
	const listings = (property.listings as IDataObject[] | undefined) ?? [];
	// Same rule as the API (propertyMappers.ts): a withdrawn listing must not give an old price or URL
	const listingOf = (operation: unknown) =>
		listings.find((item) => item.operation === operation && item.available === property.available);
	const fieldOf = (operation: unknown, field: string) => listingOf(operation)?.[field] ?? null;
	const matched = (property.matched_operation as string | null | undefined) ?? null;
	const matchedGone = matched !== null && listingOf(matched)?.available !== true;
	const salesAgent = property.sales_agent as IDataObject | null | undefined;
	return {
		found: properties.length === 1,
		status: forcedStatus ?? statusOf(properties.length),
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
		price: formatPrice(fieldOf(matched, 'price'), matched as 'sale' | 'rent' | null),
		price_sale: formatPrice(fieldOf('sale', 'price'), 'sale'),
		price_rent: formatPrice(fieldOf('rent', 'price'), 'rent'),
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
