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
}

export interface DraftMessage {
	peerId: string;
	content: string;
	senderName: string;
	timestamp: number;
}
