import { describe, expect, it } from 'vitest';

import {
	apiErrorOf,
	buildLeadVariables,
	buildPauseBody,
	buildTemplateComponents,
	idempotencyKeyFor,
	simplifyProperties,
	splitTemplateValue,
	toE164,
} from '../nodes/Newlead/v2/helpers';

describe('toE164', () => {
	it('adds the plus sign and strips separators', () => {
		expect(toE164('34 600-111-222')).toBe('+34600111222');
		expect(toE164('+34600111222')).toBe('+34600111222');
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

describe('buildPauseBody', () => {
	it('only sends what has a value', () => {
		expect(buildPauseBody({})).toEqual({});
		expect(buildPauseBody({ durationMin: 0, reason: '' })).toEqual({});
		expect(buildPauseBody({ durationMin: 45.9, reason: 'Visita' })).toEqual({
			duration_min: 45,
			reason: 'Visita',
		});
	});
});

describe('idempotencyKeyFor', () => {
	it('is stable for the same execution, node and item', () => {
		expect(idempotencyKeyFor('101', 'node-1', 2)).toBe('n8n:101:node-1:2');
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
});

describe('simplifyProperties', () => {
	const property = {
		reference: '109876543',
		internal_reference: 'SNAP-0412',
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
			price: 900,
			price_sale: 200000,
			price_rent: 900,
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

	it('is not available when the matched listing is gone', () => {
		const gone = { ...property, listings: [property.listings[0]] };
		expect(simplifyProperties([gone])).toMatchObject({ available: false, price: null });
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
