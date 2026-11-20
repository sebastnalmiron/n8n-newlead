import { createHmac, timingSafeEqual } from 'crypto';

/** How far the timestamp of a delivery may be from our clock (Newlead docs: webhook-signatures). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** `t` and `v1` of an `X-Webhook-Signature: t=<unix>,v1=<hex>` header, or null when it is malformed. */
export function parseSignatureHeader(header: unknown): { t: string; signature: string } | null {
	if (typeof header !== 'string') return null;
	const fields = new Map<string, string>();
	for (const part of header.split(',')) {
		const [key, ...rest] = part.trim().split('=');
		fields.set(key, rest.join('='));
	}
	const t = fields.get('t') ?? '';
	const signature = fields.get('v1') ?? '';
	if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(signature)) return null;
	return { t, signature };
}

/**
 * Whether a delivery comes from Newlead: the HMAC-SHA256 of `{t}.{raw body}`, keyed with the whole
 * endpoint secret (`whsec_…`, prefix included), compared in constant time, with `t` at most five
 * minutes from `nowSeconds`. The raw body must be the bytes that arrived: serializing the parsed
 * JSON again changes them.
 */
export function verifySignature(input: {
	header: unknown;
	rawBody: Buffer | undefined;
	secret: unknown;
	nowSeconds: number;
}): boolean {
	const parsed = parseSignatureHeader(input.header);
	if (!parsed || !input.rawBody || typeof input.secret !== 'string' || input.secret === '') {
		return false;
	}
	if (Math.abs(input.nowSeconds - Number(parsed.t)) > SIGNATURE_TOLERANCE_SECONDS) return false;
	const expected = createHmac('sha256', input.secret)
		.update(`${parsed.t}.`)
		.update(input.rawBody)
		.digest();
	return timingSafeEqual(expected, Buffer.from(parsed.signature, 'hex'));
}
