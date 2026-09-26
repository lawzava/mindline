/**
 * Message origin signatures (PROTOCOL.md §3.5): the author's device signs
 * the message's current state, and the signature travels with the message
 * wherever it goes, including history served by other members. A served
 * copy is then the author's words or it is visibly unsigned, never a
 * member's forgery in someone else's name.
 */

import { fromB64url, toB64url } from './b64';
import { deviceIdFromSpki, importPeerPublicKey, type DeviceIdentity } from './identity';
import { lp } from './lp';
import type { Message, MessageOrigin } from '$lib/types/message';

const DELETED_MARKER = '[Message deleted]';

export interface OriginFields {
	roomId: string;
	id: string;
	device: string;
	timestamp: number;
	kind: 'text' | 'media' | 'deleted';
	/** Text content, a media descriptor, or '' for a deletion. */
	body: string;
	/** Edit time for an edited text message, else null. */
	editedAt: number | null;
	/** The message this one answers, or '' (a quote is part of what was said). */
	replyTo: string;
}

/** The signed state of a stored message. */
export function originOf(roomId: string, msg: Message): OriginFields {
	const deleted = msg.message_type === 'Deleted' || msg.content === DELETED_MARKER;
	const kind = deleted ? 'deleted' : msg.attachment ? 'media' : 'text';
	const body =
		kind === 'deleted'
			? ''
			: kind === 'media'
				? `${msg.attachment!.transferId}\n${msg.attachment!.name}\n${msg.attachment!.size}`
				: msg.content;
	return {
		roomId,
		id: msg.id,
		device: msg.sender_device ?? '',
		timestamp: msg.timestamp,
		kind,
		body,
		editedAt: kind === 'text' && msg.edited ? (msg.edit_timestamp ?? null) : null,
		replyTo: kind === 'deleted' ? '' : (msg.reply_to ?? '')
	};
}

function originBytes(f: OriginFields): Uint8Array<ArrayBuffer> {
	return lp(
		'mindline/v1/origin',
		f.roomId,
		f.id,
		f.device,
		String(f.timestamp),
		f.kind,
		f.body,
		f.editedAt === null ? '' : String(f.editedAt),
		f.replyTo
	);
}

const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const;

export async function signOrigin(
	identity: DeviceIdentity,
	roomId: string,
	msg: Message
): Promise<MessageOrigin> {
	const fields = originOf(roomId, { ...msg, sender_device: identity.deviceId });
	const sig = await crypto.subtle.sign(ECDSA, identity.privateKey, originBytes(fields));
	return { sig: toB64url(new Uint8Array(sig)), spki: toB64url(identity.spki) };
}

/**
 * True only when the message carries a signature by the key its
 * sender_device names, over exactly its current state in this room.
 */
export async function verifyOrigin(roomId: string, msg: Message): Promise<boolean> {
	const origin = msg.origin;
	if (!origin || typeof origin.sig !== 'string' || typeof origin.spki !== 'string') return false;
	const spki = fromB64url(origin.spki);
	const sig = fromB64url(origin.sig);
	if (!spki || !sig || !msg.sender_device) return false;
	try {
		if ((await deviceIdFromSpki(spki)) !== msg.sender_device) return false;
		const key = await importPeerPublicKey(spki);
		return await crypto.subtle.verify(ECDSA, key, sig, originBytes(originOf(roomId, msg)));
	} catch {
		return false;
	}
}
