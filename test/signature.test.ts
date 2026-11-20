import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import { parseSignatureHeader, signatureFailure, verifySignature } from '../nodes/NewleadTrigger/signature';

const SECRET = 'whsec_prueba';
const BODY = Buffer.from('{"event":"lead.created","occurred_at":"2026-11-13T09:00:00.000Z"}');
const NOW = 1_763_000_000;

function hex(t: number | string, body: Buffer = BODY, secret = SECRET): string {
	return createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
}

function sign(t: number | string, body: Buffer = BODY, secret = SECRET): string {
	return `t=${t},v1=${hex(t, body, secret)}`;
}

const verify = (header: unknown, overrides: { rawBody?: Buffer; secret?: unknown; nowSeconds?: number } = {}) =>
	verifySignature({ header, rawBody: BODY, secret: SECRET, nowSeconds: NOW, ...overrides });

describe('parseSignatureHeader', () => {
	it('reads t and v1, with or without spaces after the comma', () => {
		expect(parseSignatureHeader(`t=${NOW},v1=${hex(NOW)}`)).toEqual({ t: String(NOW), signature: hex(NOW) });
		expect(parseSignatureHeader(`t=${NOW}, v1=${hex(NOW)}`)).toEqual({ t: String(NOW), signature: hex(NOW) });
	});

	it('rejects anything else', () => {
		for (const header of [
			undefined,
			'',
			['t=1,v1=a'],
			`v1=${hex(NOW)}`,
			`t=${NOW}`,
			`t=abc,v1=${hex(NOW)}`,
			`t=${NOW},v1=${hex(NOW).toUpperCase()}`,
			`t=${NOW},v1=${hex(NOW).slice(1)}`,
			`t=1234567890123,v1=${hex(NOW)}`,
		]) {
			expect(parseSignatureHeader(header)).toBeNull();
		}
	});
});

describe('verifySignature', () => {
	it('accepts a delivery signed with the whole endpoint secret', () => {
		expect(verify(sign(NOW))).toBe(true);
	});

	it('rejects the secret without its whsec_ prefix, another secret and a changed body', () => {
		expect(verify(sign(NOW, BODY, 'prueba'))).toBe(false);
		expect(verify(sign(NOW, BODY, 'whsec_otra'))).toBe(false);
		expect(verify(sign(NOW), { rawBody: Buffer.from(`${BODY.toString()} `) })).toBe(false);
	});

	it('accepts up to five minutes of clock difference, in both directions, and not one second more', () => {
		expect(verify(sign(NOW - 300))).toBe(true);
		expect(verify(sign(NOW + 300))).toBe(true);
		expect(verify(sign(NOW - 301))).toBe(false);
		expect(verify(sign(NOW + 301))).toBe(false);
	});

	it('rejects without a raw body or a secret', () => {
		expect(verify(sign(NOW), { rawBody: undefined })).toBe(false);
		expect(verify(sign(NOW), { secret: undefined })).toBe(false);
		expect(verify(sign(NOW), { secret: '' })).toBe(false);
	});
});

describe('signatureFailure', () => {
	const failure = (header: unknown, overrides: { rawBody?: Buffer; secret?: unknown; nowSeconds?: number } = {}) =>
		signatureFailure({ header, rawBody: BODY, secret: SECRET, nowSeconds: NOW, ...overrides });

	it('is null for a valid delivery and names why it is not otherwise', () => {
		expect(failure(sign(NOW))).toBeNull();
		expect(failure(undefined)).toBe('missing_signature');
		expect(failure(['t=1,v1=a'])).toBe('missing_signature');
		expect(failure('t=abc')).toBe('malformed_signature');
		expect(failure(sign(NOW), { secret: undefined })).toBe('missing_secret');
		expect(failure(sign(NOW), { secret: '' })).toBe('missing_secret');
		expect(failure(sign(NOW), { rawBody: undefined })).toBe('missing_raw_body');
		expect(failure(sign(NOW - 301))).toBe('stale_timestamp:301s');
		expect(failure(sign(NOW + 301))).toBe('stale_timestamp:-301s');
		expect(failure(sign(NOW, BODY, 'whsec_otra'))).toBe('mismatch');
	});
});
