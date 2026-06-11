/**
 * Canonical length-prefixed field encoding (PROTOCOL.md §0):
 * u32be(byteLen(field)) ‖ utf8(field) per field, concatenated. Every
 * keyed-MAC input and AAD uses this; no delimiter strings anywhere, so
 * attacker-influenced values (roomIds, ids) cannot play delimiter games.
 */
const textEncoder = new TextEncoder();

export function lp(...fields: string[]): Uint8Array<ArrayBuffer> {
	const encoded = fields.map((f) => textEncoder.encode(f));
	const out = new Uint8Array(encoded.reduce((sum, f) => sum + 4 + f.length, 0));
	const view = new DataView(out.buffer);
	let offset = 0;
	for (const f of encoded) {
		view.setUint32(offset, f.length);
		out.set(f, offset + 4);
		offset += 4 + f.length;
	}
	return out;
}
