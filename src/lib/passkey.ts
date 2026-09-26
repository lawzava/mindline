/**
 * Passkey lock, the WebAuthn side (PROTOCOL.md §4). The passkey's PRF
 * extension turns a fixed salt into a secret only the authenticator can
 * produce, after the person proves presence (fingerprint, face, PIN).
 * Nothing is sent anywhere: there is no server, and the challenge is only
 * there because the API requires one.
 */

export class PasskeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PasskeyError';
	}
}

/**
 * Whether this browser can make a lock passkey. Browsers that report their
 * capabilities are asked about PRF up front; others find out on creation.
 */
export async function passkeySupported(): Promise<boolean> {
	if (typeof window === 'undefined' || typeof window.PublicKeyCredential !== 'function') {
		return false;
	}
	const probe = (
		PublicKeyCredential as unknown as {
			getClientCapabilities?: () => Promise<Record<string, boolean | undefined>>;
		}
	).getClientCapabilities;
	if (!probe) return true;
	try {
		return (await probe())['extension:prf'] !== false;
	} catch {
		return true;
	}
}

/**
 * One passkey account per device: making the lock again replaces the old
 * passkey in the provider instead of adding another entry beside it.
 */
function lockUserId(): Uint8Array {
	const KEY = 'mindline_lock_user';
	try {
		const stored = localStorage.getItem(KEY);
		if (stored && /^[0-9a-f]{32}$/.test(stored)) {
			return new Uint8Array(stored.match(/../g)!.map((h) => parseInt(h, 16)));
		}
		const id = random(16);
		localStorage.setItem(KEY, Array.from(id, (b) => b.toString(16).padStart(2, '0')).join(''));
		return id;
	} catch {
		return random(16);
	}
}

interface PrfOutputs {
	prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function prfOf(credential: PublicKeyCredential): Uint8Array | null {
	const first = (credential.getClientExtensionResults() as PrfOutputs).prf?.results?.first;
	return first ? new Uint8Array(first) : null;
}

/** Ask the passkey for its PRF output over `salt`. */
export async function passkeySecret(
	credentialId: Uint8Array,
	salt: Uint8Array
): Promise<Uint8Array> {
	let credential: PublicKeyCredential | null;
	try {
		credential = (await navigator.credentials.get({
			publicKey: {
				challenge: random(32),
				rpId: location.hostname,
				allowCredentials: [{ type: 'public-key', id: credentialId as BufferSource }],
				userVerification: 'required',
				extensions: {
					prf: { eval: { first: salt as BufferSource } }
				} as AuthenticationExtensionsClientInputs
			}
		})) as PublicKeyCredential | null;
	} catch {
		throw new PasskeyError('The passkey was not used.');
	}
	const secret = credential && prfOf(credential);
	if (!secret) throw new PasskeyError('This passkey cannot unlock Mindline.');
	return secret;
}

/** Make a passkey for this device's lock and read its secret once. */
export async function createLockPasskey(
	salt: Uint8Array
): Promise<{ credentialId: Uint8Array; secret: Uint8Array }> {
	let credential: PublicKeyCredential | null;
	try {
		credential = (await navigator.credentials.create({
			publicKey: {
				rp: { name: 'Mindline', id: location.hostname },
				user: {
					id: lockUserId() as BufferSource,
					name: 'mindline-lock',
					displayName: 'Mindline lock on this device'
				},
				challenge: random(32),
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 },
					{ type: 'public-key', alg: -257 }
				],
				authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
				extensions: {
					prf: { eval: { first: salt as BufferSource } }
				} as AuthenticationExtensionsClientInputs
			}
		})) as PublicKeyCredential | null;
	} catch {
		throw new PasskeyError('No passkey was made.');
	}
	if (!credential) throw new PasskeyError('No passkey was made.');
	const outputs = (credential.getClientExtensionResults() as PrfOutputs).prf;
	if (!outputs?.enabled && !outputs?.results?.first) {
		throw new PasskeyError(
			"This passkey provider can't lock Mindline. Try another, such as your phone or a security key."
		);
	}
	const credentialId = new Uint8Array(credential.rawId);
	// Some providers only return the PRF output on use, not on creation.
	const secret = prfOf(credential) ?? (await passkeySecret(credentialId, salt));
	return { credentialId, secret };
}
