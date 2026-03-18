import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcastReaction, initializeP2P, disconnectP2P } from '../manager';
import { P2PConnection } from '../connection';
import { user, currentRoomId } from '$lib/stores';

// Mock the dependencies
vi.mock('../connection', () => {
    const P2PConnectionMock = vi.fn(function(this: any) {
        this.connect = vi.fn().mockResolvedValue(undefined);
        this.disconnect = vi.fn();
        this.broadcast = vi.fn().mockReturnValue(1);
        this.onMessage = vi.fn();
        this.onPeerConnected = vi.fn();
        this.onPeerDisconnected = vi.fn();
        this.onConnectionLost = vi.fn();
        this.sendToPeer = vi.fn();
        this.getConnectedPeers = vi.fn().mockReturnValue(['peer1']);
    });
	return {
		P2PConnection: P2PConnectionMock
	};
});

// Partial mock for stores
vi.mock('$lib/stores', () => {
	return {
		user: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		currentRoomId: {
			subscribe: vi.fn(),
			set: vi.fn(),
			update: vi.fn()
		},
		connection: {
			setStatus: vi.fn(),
			setError: vi.fn(),
			setReconnecting: vi.fn(),
			clearReconnection: vi.fn(),
			addPeer: vi.fn(),
			removePeer: vi.fn(),
			reset: vi.fn(),
			getPeerName: vi.fn()
		},
		drafts: {
			clearDraft: vi.fn(),
			clearAll: vi.fn()
		},
		messages: {
			getRoomMessages: vi.fn().mockReturnValue([])
		},
		delivery: {
			trackMessage: vi.fn(),
			handlePeerDisconnect: vi.fn()
		}
	};
});

// Mock svelte/store get
vi.mock('svelte/store', async (importOriginal) => {
    const actual = await importOriginal<typeof import('svelte/store')>();
	return {
        ...actual,
		get: vi.fn((store) => {
			if (store === user) {
				return { initialized: true, id: 'user-123', name: 'Alice' };
			}
			if (store === currentRoomId) {
				return 'room-456';
			}
			if (store?.subscribe === vi.mocked(user).subscribe) {
				return { initialized: true, id: 'user-123', name: 'Alice' };
			}
			return null;
		})
	};
});

// Mock wasm
vi.mock('$lib/wasm', () => ({
	wasm: {},
	isWasmReady: vi.fn().mockReturnValue(true)
}));

describe('P2P Manager - broadcastReaction', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		disconnectP2P(); // Ensure a clean state
        // wait a bit for isDisconnecting flag to reset
        await new Promise(resolve => setTimeout(resolve, 600));
	});

	it('should broadcast a reaction when connection is ready', async () => {
		// Initialize the P2P connection to set module state
		await initializeP2P('room-456');

		// Get the mocked instance
		const mockConnectionInstance = vi.mocked(P2PConnection).mock.instances[0];

		// Mock Date.now for predictable timestamps
		const now = 1620000000000;
		vi.spyOn(Date, 'now').mockReturnValue(now);

		// Call the function
		broadcastReaction('msg-789', '👍', 'add');

		// Assertions
		expect(mockConnectionInstance.broadcast).toHaveBeenCalledTimes(1);
		expect(mockConnectionInstance.broadcast).toHaveBeenCalledWith({
			type: 'reaction',
			messageId: 'msg-789',
			roomId: 'room-456',
			reaction: '👍',
			senderId: 'user-123',
			senderName: 'Alice',
			action: 'add',
			timestamp: now
		});

		vi.restoreAllMocks();
	});

	it('should not broadcast and should log warning if P2P is not connected', () => {
		const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// Call without initializing P2P
		broadcastReaction('msg-789', '👍', 'add');

		expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Manager] Cannot broadcast reaction: not ready');
		consoleWarnSpy.mockRestore();
	});

	it('should broadcast a reaction removal', async () => {
		await initializeP2P('room-456');
		const mockConnectionInstance = vi.mocked(P2PConnection).mock.instances[0];
		const now = 1620000000000;
		vi.spyOn(Date, 'now').mockReturnValue(now);

		broadcastReaction('msg-789', '👍', 'remove');

		expect(mockConnectionInstance.broadcast).toHaveBeenCalledWith(expect.objectContaining({
			action: 'remove',
			reaction: '👍'
		}));

		vi.restoreAllMocks();
	});
});
