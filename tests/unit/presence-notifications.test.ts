import { beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import { routeP2PMessage } from '$lib/p2p/handlers';
import { connection } from '$lib/stores/connection';
import type { UserConnectedMessage } from '$lib/p2p/types';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn() } }));

function announce(name: string) {
	const message: UserConnectedMessage = {
		type: 'user-connected',
		senderName: name,
		senderId: 'peer',
		timestamp: 0
	};
	routeP2PMessage(message, 'peer');
}

describe('peer presence notices', () => {
	beforeEach(() => {
		connection.removePeer('peer');
		vi.clearAllMocks();
	});

	test('duplicate announcements and name updates do not repeat the join notice', () => {
		announce('Alice');
		announce('Alice');
		announce('Alicia');
		expect(toast.success).toHaveBeenCalledExactlyOnceWith('Alice joined the room');
		expect(connection.getPeerName('peer')).toBe('Alicia');
	});

	test('a peer who leaves can receive a new join notice', () => {
		announce('Alice');
		connection.removePeer('peer');
		announce('Alice');
		expect(toast.success).toHaveBeenCalledTimes(2);
	});
});
