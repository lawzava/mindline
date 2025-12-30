/**
 * Web Crypto API Bridge for WASM
 * Provides real AES-256-GCM encryption that Rust can call via JavaScript interop
 */

/**
 * Encrypt data using AES-256-GCM via Web Crypto API
 */
export async function webcryptoEncrypt(
	plaintext: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array
): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key as BufferSource,
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
		cryptoKey,
		plaintext as BufferSource
	);

	return new Uint8Array(ciphertext);
}

/**
 * Decrypt data using AES-256-GCM via Web Crypto API
 */
export async function webcryptoDecrypt(
	ciphertext: Uint8Array,
	key: Uint8Array,
	iv: Uint8Array
): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key as BufferSource,
		{ name: 'AES-GCM' },
		false,
		['decrypt']
	);

	const plaintext = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: iv as BufferSource, tagLength: 128 },
		cryptoKey,
		ciphertext as BufferSource
	);

	return new Uint8Array(plaintext);
}

/**
 * Derive a key from password using PBKDF2 via Web Crypto API
 */
export async function webcryptoDeriveKey(
	password: string,
	salt: Uint8Array,
	iterations = 600000
): Promise<Uint8Array> {
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);

	const derivedBits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: salt as BufferSource,
			iterations: iterations,
			hash: 'SHA-256'
		},
		keyMaterial,
		256
	);

	return new Uint8Array(derivedBits);
}

/**
 * Generate cryptographically secure random bytes
 */
export function webcryptoRandomBytes(length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}

/**
 * Setup the crypto bridge on the window object for WASM to call
 */
export function setupCryptoBridge(): void {
	if (typeof window !== 'undefined') {
		(window as Window & typeof globalThis & Record<string, unknown>).webcryptoEncrypt =
			webcryptoEncrypt;
		(window as Window & typeof globalThis & Record<string, unknown>).webcryptoDecrypt =
			webcryptoDecrypt;
		(window as Window & typeof globalThis & Record<string, unknown>).webcryptoDeriveKey =
			webcryptoDeriveKey;
		(window as Window & typeof globalThis & Record<string, unknown>).webcryptoRandomBytes =
			webcryptoRandomBytes;
	}
}
