/**
 * QR invites for phone-to-phone sharing. The code carries the full invite
 * URL, key fragment included, so it is as much a bearer capability as the
 * link itself. Encoding is local (uqr) and rendered as inline SVG: no
 * network, no canvas, no data: URL.
 */
import { encode } from 'uqr';

/** Light modules around the symbol; the spec minimum is four. */
export const QR_QUIET_ZONE = 4;

export interface QrCode {
	version: number;
	/** Modules per side, quiet zone included. */
	size: number;
	/** Row-major, `true` = dark module. */
	modules: boolean[][];
}

/**
 * Error correction M at minimum (a phone camera held at arm's length
 * over another phone's glossy screen), boosted for free when the higher
 * level fits the same version.
 */
export function encodeQr(text: string): QrCode {
	const qr = encode(text, { ecc: 'M', boostEcc: true, border: QR_QUIET_ZONE });
	return { version: qr.version, size: qr.size, modules: qr.data };
}

/**
 * One SVG path for all dark modules, one subpath per horizontal run, in
 * module units (pair with `viewBox="0 0 size size"` and crispEdges).
 */
export function qrPath(modules: readonly (readonly boolean[])[]): string {
	let d = '';
	for (let y = 0; y < modules.length; y++) {
		const row = modules[y];
		let x = 0;
		while (x < row.length) {
			if (!row[x]) {
				x++;
				continue;
			}
			const start = x;
			while (x < row.length && row[x]) x++;
			d += `M${start} ${y}h${x - start}v1h${start - x}z`;
		}
	}
	return d;
}
