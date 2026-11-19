import { NodeApiError, type INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	apiErrorOf,
	assertLeadId,
	buildLeadVariables,
	buildListQuery,
	buildPauseBody,
	buildTemplateComponents,
	describeApiError,
	idempotencyKeyFor,
	pickIdempotencyKey,
	simplifyProperties,
	splitTemplateValue,
	toApiDateTime,
	toE164,
} from '../nodes/Newlead/v2/helpers';

describe('toE164', () => {
	it.each([
		['34 600-111-222', '+34600111222'],
		['+34600111222', '+34600111222'],
		['+34 (600) 111 222', '+34600111222'],
		['0034600111222', '+34600111222'],
		['34600111222', '+34600111222'],
		[34600111222, '+34600111222'],
	])('accepts %s', (input, expected) => {
		expect(toE164(input)).toBe(expected);
	});

	it.each([
		'612345678',
		'911234567',
		'+34 (0) 600 111 222',
		'+34600111222 ext 5',
		'34600111222.0',
		'',
		null,
		'0034',
	])('rejects %j', (input) => {
		expect(() => toE164(input)).toThrow();
	});

	it('says the country prefix is missing', () => {
		expect(() => toE164('612345678')).toThrow(/country prefix.*\+34600111222/);
	});
});

describe('splitTemplateValue', () => {
	it('reads name|language', () => {
		expect(splitTemplateValue('bienvenida|es')).toEqual({ name: 'bienvenida', language: 'es' });
	});

	it('fails without a language', () => {
		expect(() => splitTemplateValue('bienvenida')).toThrow('name|language');
	});
});

describe('buildTemplateComponents', () => {
	it('is empty without values', () => {
		expect(
			buildTemplateComponents({ headerType: 'none', bodyVariables: [], urlButtons: [] }),
		).toEqual([]);
	});

	it('builds header, body and URL buttons in the order v1 expects', () => {
		expect(
			buildTemplateComponents({
				headerType: 'document',
				headerValue: 'https://example.com/a.pdf',
				headerFilename: 'a.pdf',
				bodyVariables: [{ value: 'Ana' }, { value: 3 }],
				urlButtons: [{ index: 1, value: 'abc' }],
			}),
		).toEqual([
			{
				type: 'header',
				parameters: [
					{ type: 'document', document: { link: 'https://example.com/a.pdf', filename: 'a.pdf' } },
				],
			},
			{
				type: 'body',
				parameters: [
					{ type: 'text', text: 'Ana' },
					{ type: 'text', text: '3' },
				],
			},
			{ type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'abc' }] },
		]);
	});

	it('accepts numbers and booleans and rejects objects and arrays', () => {
		expect(
			buildTemplateComponents({
				headerType: 'text',
				headerValue: 7 as never,
				bodyVariables: [{ value: true }],
				urlButtons: [],
			}),
		).toEqual([
			{ type: 'header', parameters: [{ type: 'text', text: '7' }] },
			{ type: 'body', parameters: [{ type: 'text', text: 'true' }] },
		]);
		const base = { headerType: 'none' as const, bodyVariables: [], urlButtons: [] };
		expect(() =>
			buildTemplateComponents({ ...base, bodyVariables: [{ value: { a: 1 } }] }),
		).toThrow(/text, number or boolean/);
		expect(() =>
			buildTemplateComponents({ ...base, urlButtons: [{ index: 0, value: [1] }] }),
		).toThrow(/text, number or boolean/);
		expect(() =>
			buildTemplateComponents({ ...base, headerType: 'text', headerValue: {} as never }),
		).toThrow(/text, number or boolean/);
	});

	it('builds a text and an image header', () => {
		expect(
			buildTemplateComponents({
				headerType: 'text',
				headerValue: 'Hola',
				bodyVariables: [],
				urlButtons: [],
			}),
		).toEqual([{ type: 'header', parameters: [{ type: 'text', text: 'Hola' }] }]);
		expect(
			buildTemplateComponents({
				headerType: 'image',
				headerValue: 'https://example.com/a.png',
				bodyVariables: [],
				urlButtons: [],
			}),
		).toEqual([
			{
				type: 'header',
				parameters: [{ type: 'image', image: { link: 'https://example.com/a.png' } }],
			},
		]);
	});
});

describe('buildLeadVariables', () => {
	it('skips empty rows and keeps 0 and false', () => {
		expect(
			buildLeadVariables([
				{ key: 'city', value: 'Málaga' },
				{ key: 'rooms', value: 0 },
				{ key: 'ok', value: false },
				{ key: 'empty', value: '   ' },
				{ key: '', value: 'x' },
			]),
		).toEqual({ city: 'Málaga', rooms: 0, ok: false });
	});

	it('is undefined when nothing is left', () => {
		expect(buildLeadVariables([{ key: 'a', value: '' }])).toBeUndefined();
	});
});

describe('assertLeadId', () => {
	it('returns a valid UUID, trimmed', () => {
		expect(assertLeadId(' 22222222-2222-4222-8222-222222222222 ')).toBe(
			'22222222-2222-4222-8222-222222222222',
		);
	});

	it.each([[''], ['   '], [undefined], [null], ['abc'], ['123'], [42]])(
		'rejects %j before any request is made',
		(value) => {
			expect(() => assertLeadId(value)).toThrow(/lead ID/);
		},
	);
});

describe('pickIdempotencyKey', () => {
	it('uses the own key, trimmed, instead of the generated one', () => {
		expect(pickIdempotencyKey('  crm-42 ', 'n8n:1:2:0:0')).toBe('crm-42');
	});

	it.each([[undefined], [''], ['   ']])('falls back to the generated key for %j', (value) => {
		expect(pickIdempotencyKey(value, 'n8n:1:2:0:0')).toBe('n8n:1:2:0:0');
	});

	it('rejects a key longer than 255 characters', () => {
		expect(() => pickIdempotencyKey('k'.repeat(256), 'g')).toThrow(/255/);
		expect(pickIdempotencyKey('k'.repeat(255), 'g')).toHaveLength(255);
	});
});

describe('buildPauseBody', () => {
	it.each([[-5], ['abc'], [Number.NaN], ['-1']])('rejects the duration %j', (durationMin) => {
		expect(() => buildPauseBody({ durationMin })).toThrow(/duration/i);
	});

	it('keeps empty and 0 as an indefinite pause', () => {
		expect(buildPauseBody({ durationMin: '' })).toEqual({});
		expect(buildPauseBody({ durationMin: undefined })).toEqual({});
		expect(buildPauseBody({ durationMin: '0' })).toEqual({});
	});

	it('only sends what has a value', () => {
		expect(buildPauseBody({})).toEqual({});
		expect(buildPauseBody({ durationMin: 0, reason: '' })).toEqual({});
		expect(buildPauseBody({ durationMin: 45.9, reason: 'Visita' })).toEqual({
			duration_minutes: 45,
			reason: 'Visita',
		});
	});
});

describe('idempotencyKeyFor', () => {
	it('is stable for the same run and item', () => {
		expect(idempotencyKeyFor('101', 'node-1', 0, 2)).toBe('n8n:101:node-1:0:2');
	});

	it('differs per run, so a Loop Over Items does not collide', () => {
		expect(idempotencyKeyFor('101', 'node-1', 0, 0)).not.toBe(
			idempotencyKeyFor('101', 'node-1', 1, 0),
		);
	});

	it('differs per item', () => {
		expect(idempotencyKeyFor('101', 'node-1', 0, 0)).not.toBe(
			idempotencyKeyFor('101', 'node-1', 0, 1),
		);
	});
});

describe('apiErrorOf', () => {
	const body = {
		error: { code: 'lead_ai_paused', message: 'Already paused.', request_id: 'req-1', param: null },
	};

	it('reads the v1 error wherever n8n leaves it', () => {
		const expected = {
			code: 'lead_ai_paused',
			message: 'Already paused.',
			param: null,
			requestId: 'req-1',
			details: null,
		};
		expect(apiErrorOf({ response: { data: body } })).toEqual(expected);
		expect(apiErrorOf({ response: { body } })).toEqual(expected);
		expect(apiErrorOf({ cause: { response: { data: body } } })).toEqual(expected);
		expect(apiErrorOf({ body })).toEqual(expected);
	});

	it('skips a body whose error is not the v1 object', () => {
		expect(apiErrorOf({ response: { data: { error: 'text' }, body } })).toMatchObject({
			code: 'lead_ai_paused',
		});
	});

	it('is null for anything else', () => {
		expect(apiErrorOf(new Error('socket hang up'))).toBeNull();
	});

	const node: INode = {
		id: 'n1',
		name: 'NewLead',
		type: 'newlead',
		typeVersion: 2,
		position: [0, 0],
		parameters: {},
	};

	it('reads the body of a real NodeApiError', () => {
		const cause = Object.assign(new Error('Bad gateway'), {
			response: {
				status: 502,
				data: {
					error: {
						code: 'send_outcome_unknown',
						message: 'Unknown outcome.',
						request_id: 'req-9',
						details: { call_id: 'call-1' },
					},
				},
			},
		});
		const error = new NodeApiError(node, cause as never);
		expect(apiErrorOf(error)).toMatchObject({
			code: 'send_outcome_unknown',
			requestId: 'req-9',
			details: { call_id: 'call-1' },
		});
	});

	it('is null for a non-JSON or empty body', () => {
		expect(apiErrorOf({ response: { data: '<html>Bad gateway</html>' } })).toBeNull();
		expect(apiErrorOf({ response: { data: '' } })).toBeNull();
		expect(apiErrorOf({ context: { data: undefined } })).toBeNull();
	});
});

describe('describeApiError', () => {
	it('warns the send may have gone out', () => {
		const result = describeApiError({
			code: 'send_outcome_unknown',
			message: 'x',
			param: null,
			requestId: 'req-9',
			details: { call_id: 'call-1' },
		});
		expect(result.message).toBe('The send may have gone out');
		expect(result.description).toMatch(/check/i);
		expect(result.description).toMatch(/different idempotency key/i);
		expect(result.description).toContain('call-1');
		expect(result.description).toContain('req-9');
	});

	it('shows code, message, param and request id for the rest', () => {
		const result = describeApiError({
			code: 'invalid_request',
			message: 'Bad phone.',
			param: 'to',
			requestId: 'req-2',
			details: null,
		});
		expect(result.message).toBe('invalid_request: Bad phone.');
		expect(result.description).toContain('to');
		expect(result.description).toContain('req-2');
	});
});

describe('simplifyProperties', () => {
	const property = {
		reference: '109876543',
		internal_reference: 'REF-0001',
		type: 'flat',
		type_label: 'Piso',
		available: true,
		matched_operation: 'rent',
		summary: 'Piso en Málaga',
		listings: [
			{
				operation: 'sale',
				price: 200000,
				idealista_code: '111',
				url: 'https://i.co/111',
				available: true,
			},
			{
				operation: 'rent',
				price: 900,
				idealista_code: '222',
				url: 'https://i.co/222',
				available: true,
			},
		],
		city: 'Málaga',
		province: 'Málaga',
		address: 'Calle Mayor 1',
		bedrooms: 2,
		bathrooms: 1,
		built_m2: 80,
		features: 'Terraza',
		description: 'Bonito',
		visit_hours: 'Tardes',
		sales_agent: { name: 'Ana', phone: '+34600111222' },
		agent_notes: 'Nota interna',
		url: 'https://i.co/222',
	};

	it('flattens a single match and leaves the internal notes out', () => {
		const result = simplifyProperties([property]);
		expect(result).toMatchObject({
			found: true,
			status: 'unique',
			operation: 'rent',
			reference: '109876543',
			available: true,
			price: '900 € al mes',
			price_sale: '200.000 €',
			price_rent: '900 € al mes',
			reference_sale: '111',
			reference_rent: '222',
			url_sale: 'https://i.co/111',
			url_rent: 'https://i.co/222',
			sales_agent_name: 'Ana',
			sales_agent_phone: '+34600111222',
			candidates_count: 0,
		});
		expect(JSON.stringify(result)).not.toContain('Nota interna');
	});

	it('writes the price as text like version 1: sale and rent, null without listing', () => {
		expect(simplifyProperties([{ ...property, matched_operation: 'sale' }])).toMatchObject({
			price: '200.000 €',
			price_sale: '200.000 €',
			price_rent: '900 € al mes',
		});
		const rentOnly = { ...property, matched_operation: 'rent', listings: [property.listings[1]] };
		expect(simplifyProperties([rentOnly])).toMatchObject({ price_sale: null, price_rent: '900 € al mes' });
		expect(simplifyProperties([{ ...property, matched_operation: null }])).toMatchObject({ price: null });
		expect(simplifyProperties([])).toMatchObject({ price: null, price_sale: null, price_rent: null });
	});

	it('is not available when the matched listing is gone', () => {
		const gone = { ...property, listings: [property.listings[0]] };
		expect(simplifyProperties([gone])).toMatchObject({ available: false, price: null });
	});

	it('ignores a withdrawn listing for price and URL', () => {
		const withdrawn = {
			...property,
			listings: [
				{
					operation: 'rent',
					price: 700,
					idealista_code: '333',
					url: 'https://i.co/old',
					available: false,
				},
				property.listings[1],
			],
		};
		expect(simplifyProperties([withdrawn])).toMatchObject({
			price: '900 € al mes',
			price_rent: '900 € al mes',
			reference_rent: '222',
			url_rent: 'https://i.co/222',
		});
	});

	it('says few and none without property fields', () => {
		expect(simplifyProperties([property, property])).toMatchObject({
			found: false,
			status: 'few',
			reference: null,
			candidates_count: 2,
		});
		expect(simplifyProperties([])).toMatchObject({
			found: false,
			status: 'none',
			candidates_count: 0,
		});
	});
});

describe('toApiDateTime', () => {
	it.each([
		['2026-11-19T10:00:00', '2026-11-19T09:00:00.000Z'],
		['2026-07-01T10:00:00', '2026-07-01T08:00:00.000Z'],
		['2026-11-19', '2026-11-18T23:00:00.000Z'],
		['2026-11-19 10:00', '2026-11-19T09:00:00.000Z'],
		['2026-11-19T10:00:00.250', '2026-11-19T09:00:00.250Z'],
		['2026-11-19T10:00:00+01:00', '2026-11-19T09:00:00.000Z'],
		['2026-11-19T09:00:00Z', '2026-11-19T09:00:00.000Z'],
	])('reads %s in the workflow time zone (Europe/Madrid)', (input, expected) => {
		expect(toApiDateTime(input, 'Europe/Madrid')).toBe(expected);
	});

	it('takes a Date as it is', () => {
		expect(toApiDateTime(new Date('2026-11-19T09:00:00Z'), 'Europe/Madrid')).toBe(
			'2026-11-19T09:00:00.000Z',
		);
	});

	it.each(['', 'yesterday', '19/11/2026', '2026-13-01T00:00:00', '2026-02-30', '2026-11-19T25:00:00'])(
		'rejects %j',
		(input) => {
			expect(() => toApiDateTime(input, 'Europe/Madrid')).toThrow(/not a date/);
		},
	);
});

describe('buildListQuery', () => {
	it('maps the filters, leaves the empty ones out and sends the dates in UTC', () => {
		expect(
			buildListQuery(
				{ status: 'closed', leadId: '  ', startedAfter: '2026-11-19T10:00:00' },
				{
					status: { parameter: 'status' },
					leadId: { parameter: 'lead_id' },
					startedAfter: { parameter: 'started_after', date: true },
					startedBefore: { parameter: 'started_before', date: true },
				},
				'Europe/Madrid',
			),
		).toEqual({ status: 'closed', started_after: '2026-11-19T09:00:00.000Z' });
	});
});
