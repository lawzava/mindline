/**
 * Remote edit/delete authorization (PROTOCOL.md §3.7): the envelope-
 * verified sender device must own the stored message. Messages persisted
 * before sender_device existed fail closed — remotely immutable; the
 * body-asserted senderId is forgeable and never consulted.
 */
export function remotePeerOwnsMessage(msg: { sender_device?: string }, peerId: string): boolean {
	return !!msg.sender_device && msg.sender_device === peerId;
}
