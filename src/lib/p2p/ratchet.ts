/**
 * Generation ratchet engine (PROTOCOL.md §1.4) — store-free so it is unit
 * testable in plain node (no `$app/*`, no IndexedDB, no stores).
 *
 * This file owns the cryptographic and convergence logic of the key
 * generations: minting fresh generation secrets, the minter-signed grant
 * certificate that makes the `minter` field unforgeable and chains
 * generations via `prevGid`, verifying grants, and (in later parts) the
 * `(g, gid)` convergence and retention. The wire/transport and persistence
 * live in the connection/manager layers.
 */

import { fromB64url, toB64url } from '$lib/crypto/b64';
import { deviceIdFromSpki, importPeerPublicKey, type DeviceIdentity } from '$lib/crypto/identity';
import { generationId } from '$lib/crypto/keys';
import { lp } from '$lib/crypto/lp';

/** Upper bound on a generation number (PROTOCOL.md §1.4 — bounded integer). */
export const MAX_GENERATION = 2 ** 32;

/** A wire `rekey-grant` body (`hs` class). */
export interface RekeyGrant {
	g: number;
	minter: string; // deviceId of the original minter
	minterSpki: string; // base64url SPKI of the minter
	gid: string; // generationId(rk)
	prevGid: string; // gid of the generation this one succeeds ('' for g=1)
	rk: string; // base64url(rk_g)
	cert: string; // base64url ECDSA over the bound payload
}

/** A grant whose certificate, minter binding, and gid commitment all hold. */
export interface VerifiedGrant {
	g: number;
	gid: string;
	prevGid: string;
	minter: string;
	rk: Uint8Array;
}

/** Bytes the minter signs: binds room, generation, minter, gid, and chain. */
function grantPayload(roomId: string, g: number, minter: string, gid: string, prevGid: string) {
	return lp('rekey-grant', roomId, String(g), minter, gid, prevGid);
}

/**
 * Build a minter-signed grant for a generation this device holds the raw
 * secret for. `prevGid` chains to the predecessor generation (§1.4): only
 * a holder of `rk_{g-1}` knows `gid_{g-1}`, so the chain forecloses leaps.
 */
export async function buildGrant(opts: {
	identity: DeviceIdentity;
	roomId: string;
	g: number;
	rk: Uint8Array;
	prevGid: string;
}): Promise<RekeyGrant> {
	const { identity, roomId, g, rk, prevGid } = opts;
	const gid = await generationId(rk);
	const cert = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		identity.privateKey,
		grantPayload(roomId, g, identity.deviceId, gid, prevGid) as BufferSource
	);
	return {
		g,
		minter: identity.deviceId,
		minterSpki: toB64url(identity.spki),
		gid,
		prevGid,
		rk: toB64url(rk),
		cert: toB64url(new Uint8Array(cert))
	};
}

/**
 * Verify a grant (§1.4): the minter must be the hash of the presented
 * SPKI (no forged low `minter` for tie-break hijack, F2), the gid must
 * commit to rk (no rk substitution), g must be a bounded integer, and the
 * certificate must verify against the minter's key over the exact bound
 * payload (which covers gid and prevGid). Returns null on any failure.
 */
export async function verifyGrant(grant: RekeyGrant, roomId: string): Promise<VerifiedGrant | null> {
	try {
		if (!Number.isInteger(grant.g) || grant.g < 1 || grant.g >= MAX_GENERATION) return null;
		const spki = fromB64url(grant.minterSpki);
		const rk = fromB64url(grant.rk);
		const cert = fromB64url(grant.cert);
		if (!spki || !rk || !cert || rk.length !== 32) return null;
		if (typeof grant.gid !== 'string' || typeof grant.prevGid !== 'string') return null;

		// minter is bound to the presented key…
		if ((await deviceIdFromSpki(spki)) !== grant.minter) return null;
		// …gid is bound to the secret…
		if ((await generationId(rk)) !== grant.gid) return null;
		// …and the certificate is signed by the minter over the whole tuple.
		const pub = await importPeerPublicKey(spki);
		const ok = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			pub,
			cert as BufferSource,
			grantPayload(roomId, grant.g, grant.minter, grant.gid, grant.prevGid) as BufferSource
		);
		if (!ok) return null;

		return { g: grant.g, gid: grant.gid, prevGid: grant.prevGid, minter: grant.minter, rk };
	} catch {
		return null;
	}
}
