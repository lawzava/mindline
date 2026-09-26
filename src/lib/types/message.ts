/**
 * Message shapes shared across stores, P2P, and persistence.
 * Field names stay snake_case: this is the persisted localStorage format.
 */

export interface Message {
	id: string;
	sender_id: string;
	sender_name: string;
	message_type: string;
	content: string;
	timestamp: number;
	room_id: string;
	status: string;
	edited: boolean;
	edit_timestamp: number | null;
	original_content: string | null;
	reply_to: string | null;
	reactions: Record<string, { users: string[]; count: number }>;
	mentions: string[];
	local_timestamp: number;
	delivery_attempts: number;
	size_bytes: number;
	/**
	 * Authenticated origin: the envelope-verified deviceId this message
	 * arrived from (or our own for sent messages). Edit/delete authorization
	 * compares against this, never against the self-asserted sender_id.
	 */
	sender_device?: string;
	/** Arrived through history sync: a peer's assertion, never a live arrival. */
	synced?: boolean;
	/** The author's signature over this state (PROTOCOL.md §3.5). */
	origin?: MessageOrigin;
	/** Synced without a valid author signature: shown as an unverified copy. */
	unsigned?: boolean;
	/** Media metadata when message_type is 'Media'; blob lives in IndexedDB. */
	attachment?: MessageAttachment;
}

export interface MessageAttachment {
	transferId: string;
	kind: 'file' | 'image' | 'voice' | 'video';
	name: string;
	mime: string;
	size: number;
	thumb?: string;
	thumbMime?: string;
	duration?: number;
	waveform?: number[];
	/** local | transferring | ready | failed */
	state: string;
}

export interface DraftMessage {
	peerId: string;
	content: string;
	senderName: string;
	timestamp: number;
}

export interface MessageOrigin {
	/** base64url ECDSA P-256 signature over the origin fields. */
	sig: string;
	/** base64url SPKI of the signing device; must hash to sender_device. */
	spki: string;
}
