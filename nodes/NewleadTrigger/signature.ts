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

interface SignatureInput {
	header: unknown;
	rawBody: Buffer | undefined;
	secret: unknown;
	nowSeconds: number;
}

/**
 * Why a delivery does not come from Newlead, or null when it does: the HMAC-SHA256 of `{t}.{raw body}`,
 * keyed with the whole endpoint secret (`whsec_…`, prefix included), compared in constant time, with `t`
 * at most five minutes from `nowSeconds`. The raw body must be the bytes that arrived: serializing the
 * parsed JSON again changes them.
 */
export function signatureFailure(input: SignatureInput): string | null {
	if (typeof input.header !== 'string') return 'missing_signature';
	const parsed = parseSignatureHeader(input.header);
	if (!parsed) return 'malformed_signature';
	if (typeof input.secret !== 'string' || input.secret === '') return 'missing_secret';
	if (!input.rawBody) return 'missing_raw_body';
	const skew = input.nowSeconds - Number(parsed.t);
	if (Math.abs(skew) > SIGNATURE_TOLERANCE_SECONDS) return `stale_timestamp:${skew}s`;
	const expected = createHmac('sha256', input.secret)
		.update(`${parsed.t}.`)
		.update(input.rawBody)
		.digest();
	return timingSafeEqual(expected, Buffer.from(parsed.signature, 'hex')) ? null : 'mismatch';
}

export function verifySignature(input: SignatureInput): boolean {
	return signatureFailure(input) === null;
}
