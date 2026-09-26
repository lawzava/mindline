/**
 * Safety numbers as QR codes (PROTOCOL.md §1.3): one person shows the
 * code, the other scans it, and the app compares it with its own number.
 * The number is derived from public keys only, so the code is not secret.
 */

const PREFIX = 'MINDLINE-SAFETY:1:';

export function safetyQrText(number: string): string {
	return PREFIX + number.replace(/\s+/g, '');
}

/** The number in a scanned code, grouped like the screen shows it, or null. */
export function parseSafetyQr(text: string): string | null {
	if (!text.startsWith(PREFIX)) return null;
	const digits = text.slice(PREFIX.length);
	if (!/^\d{60}$/.test(digits)) return null;
	return digits.match(/\d{5}/g)!.join(' ');
}

export function compareScanned(text: string, own: string): 'match' | 'mismatch' | 'invalid' {
	const scanned = parseSafetyQr(text);
	if (!scanned) return 'invalid';
	return scanned === own ? 'match' : 'mismatch';
}
