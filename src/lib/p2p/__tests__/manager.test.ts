import { describe, it, expect, vi, beforeEach } from 'vitest';
import { broadcastDelete, initializeP2P, getP2PConnection, disconnectP2P } from '../manager';
import { get } from 'svelte/store';
import { user, currentRoomId } from '$lib/stores';

vi.mock('$lib/stores', () => ({
  user: {
    subscribe: vi.fn(),
  },
  currentRoomId: {
    subscribe: vi.fn(),
  },
  connection: {
    subscribe: vi.fn(),
    setStatus: vi.fn(),
    addPeer: vi.fn(),
    removePeer: vi.fn(),
    getPeerName: vi.fn(),
    setError: vi.fn(),
    clearReconnection: vi.fn(),
    reset: vi.fn(),
    setReconnecting: vi.fn()
  },
  drafts: {
    clearDraft: vi.fn(),
    clearAll: vi.fn()
  },
  messages: {
    getRoomMessages: vi.fn().mockReturnValue([])
  },
  delivery: {
    handlePeerDisconnect: vi.fn(),
    trackMessage: vi.fn()
  }
}));

vi.mock('svelte/store', () => ({
  get: vi.fn()
}));

// We need to mock the connection and handlers
vi.mock('../connection', () => {
  return {
    P2PConnection: class {
      connect = vi.fn().mockResolvedValue(undefined);
      disconnect = vi.fn();
      broadcast = vi.fn().mockReturnValue(1);
      sendToPeer = vi.fn();
      getConnectedPeers = vi.fn().mockReturnValue(['peer1']);
      onMessage = vi.fn();
      onPeerConnected = vi.fn();
      onPeerDisconnected = vi.fn();
      onConnectionLost = vi.fn();
      isWebSocketConnected = vi.fn().mockReturnValue(true);
    }
  };
});

vi.mock('../handlers', () => ({
  routeP2PMessage: vi.fn(),
  setSendToPeerFn: vi.fn(),
  emitToast: vi.fn()
}));

vi.mock('$lib/wasm', () => ({
  wasm: {},
  isWasmReady: vi.fn().mockReturnValue(true)
}));

describe('P2P Manager - broadcastDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up any existing connection state
    disconnectP2P();

    // Setup basic store returns
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: true, id: 'user-123', name: 'Test User' };
      if (store === currentRoomId) return 'room-456';
      return null;
    });
  });

  it('should not broadcast if connection is not initialized', () => {
    // Override store config for this test
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: false };
      if (store === currentRoomId) return 'room-456';
      return null;
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    broadcastDelete('msg-1');

    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Manager] Cannot broadcast delete: not ready');
    consoleWarnSpy.mockRestore();
  });

  it('should broadcast delete message correctly', async () => {
    // Setup initialized store
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: true, id: 'user-123', name: 'Test User' };
      if (store === currentRoomId) return 'room-456';
      return null;
    });

    // Initialize the P2P connection first
    await initializeP2P('room-456');

    const conn = getP2PConnection();
    expect(conn).not.toBeNull();

    // Reset the broadcast mock count if it was called during init
    (conn!.broadcast as any).mockClear();

    broadcastDelete('msg-123');

    // It should broadcast the correct message format
    expect(conn!.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delete',
      messageId: 'msg-123',
      roomId: 'room-456',
      senderId: 'user-123',
      timestamp: expect.any(Number)
    }));
  });

  it('should include all required fields in the broadcast message', async () => {
    // Setup initialized store
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: true, id: 'user-789', name: 'Another User' };
      if (store === currentRoomId) return 'room-999';
      return null;
    });

    await initializeP2P('room-999');
    const conn = getP2PConnection();
    (conn!.broadcast as any).mockClear();

    const testTime = 1625097600000;
    vi.useFakeTimers();
    vi.setSystemTime(testTime);

    broadcastDelete('target-msg-id');

    expect(conn!.broadcast).toHaveBeenCalledTimes(1);
    const broadcastedMessage = (conn!.broadcast as any).mock.calls[0][0];

    expect(broadcastedMessage).toEqual({
      type: 'delete',
      messageId: 'target-msg-id',
      roomId: 'room-999',
      senderId: 'user-789',
      timestamp: testTime
    });

    vi.useRealTimers();
  });

  it('should not broadcast if roomId is not available', async () => {
    // Setup store without roomId
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: true, id: 'user-789', name: 'Another User' };
      if (store === currentRoomId) return null;
      return null;
    });

    // P2P is connected (simulated)
    await initializeP2P('room-999');

    // Now mock the roomId to be null
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: true, id: 'user-789', name: 'Another User' };
      if (store === currentRoomId) return null;
      return null;
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    broadcastDelete('msg-1');

    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Manager] Cannot broadcast delete: not ready');
    consoleWarnSpy.mockRestore();
  });

  it('should ignore errors during broadcast to prevent app crash', async () => {
    vi.mocked(get).mockImplementation((store) => {
      if (store === user) return { initialized: true, id: 'user-789', name: 'Another User' };
      if (store === currentRoomId) return 'room-999';
      return null;
    });

    await initializeP2P('room-999');
    const conn = getP2PConnection();
    // Wait for async initialization if any
    await new Promise(resolve => setTimeout(resolve, 0));

    // For some reason vitest spy mockImplementation doesn't immediately take effect
    // with some module layouts, so we'll stub it explicitly on the instance
    const originalBroadcast = conn!.broadcast;
    conn!.broadcast = vi.fn().mockImplementation(() => {
      throw new Error('Simulated broadcast error');
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // This should not throw an exception out of broadcastDelete
    expect(() => broadcastDelete('msg-1')).not.toThrow();

    // Just verifying it was called
    expect(conn!.broadcast).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith('[P2P Manager] Error broadcasting delete message:', expect.any(Error));

    consoleErrorSpy.mockRestore();
  });
});
