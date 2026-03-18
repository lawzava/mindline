import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcastDelete, getP2PConnection, initializeP2P, disconnectP2P } from '../manager';
import { get } from 'svelte/store';

// Mock svelte/store BEFORE importing manager
vi.mock('svelte/store', () => ({
    get: vi.fn(),
    writable: vi.fn().mockReturnValue({ subscribe: vi.fn(), set: vi.fn(), update: vi.fn() }),
    derived: vi.fn().mockReturnValue({ subscribe: vi.fn() })
}));

// Mock the connection class to allow instantiation with 'new'
vi.mock('../connection', () => {
    return {
        P2PConnection: class {
            broadcast = vi.fn().mockReturnValue(1);
            getConnectedPeers = vi.fn().mockReturnValue(['peer1']);
            connect = vi.fn().mockResolvedValue(undefined);
            disconnect = vi.fn();
            sendToPeer = vi.fn();
            onMessage = vi.fn();
            onPeerConnected = vi.fn();
            onPeerDisconnected = vi.fn();
            onConnectionLost = vi.fn();
        }
    };
});

vi.mock('$lib/stores', () => {
    return {
        user: { subscribe: vi.fn() },
        currentRoomId: { subscribe: vi.fn() },
        connection: {
            setStatus: vi.fn(),
            addPeer: vi.fn(),
            removePeer: vi.fn(),
            getPeerName: vi.fn(),
            setError: vi.fn(),
            reset: vi.fn(),
            setReconnecting: vi.fn(),
            clearReconnection: vi.fn()
        },
        drafts: {
            clearDraft: vi.fn(),
            clearAll: vi.fn()
        },
        delivery: {
            handlePeerDisconnect: vi.fn(),
            trackMessage: vi.fn()
        },
        messages: {
            getRoomMessages: vi.fn().mockReturnValue([])
        }
    };
});

vi.mock('$lib/wasm', () => ({
    wasm: {},
    isWasmReady: vi.fn().mockReturnValue(true)
}));

vi.mock('../handlers', () => ({
    routeP2PMessage: vi.fn(),
    setSendToPeerFn: vi.fn(),
    emitToast: vi.fn()
}));

describe('P2P Manager - broadcastDelete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        disconnectP2P();
    });

    it('should warn when not connected (no p2pConnection)', () => {
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Set up the get mock to return a valid user and roomId
        vi.mocked(get).mockImplementation(() => {
            return { initialized: true, id: 'user-1' };
        });

        broadcastDelete('msg-123');

        expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Manager] Cannot broadcast delete: not ready');
    });

    it('should broadcast delete message when connected', async () => {
        // We need get() to return different things depending on which store is passed
        // in initializeP2P, get(user) is called
        // in broadcastDelete, get(user) and get(currentRoomId) are called
        let getCallCount = 0;
        vi.mocked(get).mockImplementation((store) => {
            getCallCount++;
            // Call 1: user in initializeP2P
            if (getCallCount === 1) return { initialized: true, id: 'user-1' };
            // Call 2: user in broadcastDelete
            if (getCallCount === 2) return { initialized: true, id: 'user-1' };
            // Call 3: currentRoomId in broadcastDelete
            if (getCallCount === 3) return 'room-1';
            return null;
        });

        // Initialize connection first to populate p2pConnection
        await initializeP2P('room-1');

        const mockConnection = getP2PConnection();
        expect(mockConnection).not.toBeNull();
        const broadcastSpy = vi.spyOn(mockConnection!, 'broadcast');

        broadcastDelete('msg-123');

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        expect(broadcastSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'delete',
            messageId: 'msg-123',
            roomId: 'room-1',
            senderId: 'user-1'
        }));
    });
});
