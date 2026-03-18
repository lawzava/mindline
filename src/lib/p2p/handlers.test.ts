import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeP2PMessage, setSendToPeerFn } from './handlers';
import type {
    TypedP2PMessage,
    ChatMessage,
    TypingMessage,
    SyncRequestMessage,
    SyncResponseMessage,
    UserConnectedMessage,
    EditMessage,
    DeleteMessage,
    ReactionMessage,
    DeliveryAckMessage
} from './types';

// Mock dependencies
vi.mock('$lib/stores/messages', () => ({
  messages: {
    addMessage: vi.fn(),
    getRoomMessages: vi.fn(),
    updateMessage: vi.fn(),
    getMessage: vi.fn()
  }
}));

vi.mock('$lib/stores/drafts', () => ({
  drafts: {
    clearDraft: vi.fn(),
    setDraft: vi.fn()
  }
}));

vi.mock('$lib/stores/connection', () => ({
  connection: {
    setPeerName: vi.fn(),
    startSync: vi.fn(),
    updateSyncProgress: vi.fn(),
    endSync: vi.fn()
  }
}));

vi.mock('$lib/stores/delivery', () => ({
  delivery: {
    recordDelivery: vi.fn()
  }
}));

vi.mock('$lib/stores/user', () => ({
  user: {
    subscribe: vi.fn(),
    set: vi.fn(),
    update: vi.fn()
  }
}));

vi.mock('svelte/store', () => ({
  get: vi.fn((store) => {
    // Provide a mocked return for specific stores
    if (store === 'mock_currentRoomId') return 'room_123';
    if (store === 'mock_userStore') return { id: 'local_user_1' };
    return null;
  }),
  writable: vi.fn(),
  derived: vi.fn()
}));

vi.mock('$lib/stores/room', () => ({
  currentRoomId: 'mock_currentRoomId'
}));

vi.mock('$lib/stores/user', () => ({
  user: 'mock_userStore'
}));

vi.mock('$lib/wasm', () => ({
  wasm: {
    decryptMessageContent: vi.fn((content) => `decrypted_${content}`),
    receiveMessageFromPeer: vi.fn(),
    saveRoomMessagesToStorage: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn()
  },
  isWasmReady: vi.fn(() => true)
}));

vi.mock('svelte-sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('routeP2PMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSendToPeerFn(vi.fn());
  });

  it('handles chat messages correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    const { drafts } = await import('$lib/stores/drafts');
    const { connection } = await import('$lib/stores/connection');

    const msg: ChatMessage = {
      type: 'chat',
      content: 'hello',
      senderName: 'Alice',
      senderId: 'alice_1',
      messageId: 'msg_1',
      timestamp: 12345,
      roomId: 'room_123',
      encrypted: true
    };

    routeP2PMessage(msg, 'peer_alice');

    expect(connection.setPeerName).toHaveBeenCalledWith('peer_alice', 'Alice');
    expect(messages.addMessage).toHaveBeenCalledWith('room_123', expect.objectContaining({
      id: 'msg_1',
      content: 'decrypted_hello',
      sender_id: 'alice_1',
      sender_name: 'Alice',
      room_id: 'room_123'
    }));
    expect(drafts.clearDraft).toHaveBeenCalledWith('peer_alice');
  });

  it('handles typing messages correctly', async () => {
    const { drafts } = await import('$lib/stores/drafts');
    const { connection } = await import('$lib/stores/connection');

    const msg: TypingMessage = {
      type: 'typing',
      content: 'typing...',
      senderName: 'Bob',
      senderId: 'bob_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_bob');

    expect(connection.setPeerName).toHaveBeenCalledWith('peer_bob', 'Bob');
    expect(drafts.setDraft).toHaveBeenCalledWith('peer_bob', 'Bob', 'typing...');

    // Clear typing
    routeP2PMessage({ ...msg, content: '' }, 'peer_bob');
    expect(drafts.clearDraft).toHaveBeenCalledWith('peer_bob');
  });

  it('handles sync requests correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    const mockMessages = [{ id: 'msg_1', content: 'hello' }];
    (messages.getRoomMessages as any).mockReturnValue(mockMessages);

    const mockSendToPeer = vi.fn();
    setSendToPeerFn(mockSendToPeer);

    const msg: SyncRequestMessage = {
      type: 'sync-request',
      roomId: 'room_123',
      lastSync: 12345,
      messageCount: 0,
      requesterId: 'charlie_1'
    };

    routeP2PMessage(msg, 'peer_charlie');

    expect(messages.getRoomMessages).toHaveBeenCalledWith('room_123');
    expect(mockSendToPeer).toHaveBeenCalledWith('peer_charlie', expect.objectContaining({
      type: 'sync-response',
      roomId: 'room_123',
      messages: mockMessages,
      encrypted: false
    }));
  });

  it('handles sync responses correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    const { connection } = await import('$lib/stores/connection');

    const syncedMessages = [
      { id: 'msg_1', content: 'hello', message_type: 'Text', encrypted: true },
      { id: 'msg_2', content: 'world', message_type: 'Text', encrypted: false }
    ];

    const msg: SyncResponseMessage = {
      type: 'sync-response',
      roomId: 'room_123',
      messages: syncedMessages as any,
      timestamp: 12345,
      encrypted: true
    };

    (messages.getRoomMessages as any).mockReturnValue([]);

    routeP2PMessage(msg, 'peer_dave');

    expect(connection.startSync).toHaveBeenCalledWith('peer_dave');
    expect(messages.addMessage).toHaveBeenCalledTimes(2);
    expect(messages.addMessage).toHaveBeenCalledWith('room_123', expect.objectContaining({ id: 'msg_1', content: 'decrypted_hello' }));
    expect(messages.addMessage).toHaveBeenCalledWith('room_123', expect.objectContaining({ id: 'msg_2', content: 'world' }));
  });

  it('handles user connected correctly', async () => {
    const { connection } = await import('$lib/stores/connection');
    const { toast } = await import('svelte-sonner');

    const msg: UserConnectedMessage = {
      type: 'user-connected',
      senderName: 'Eve',
      senderId: 'eve_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_eve');

    expect(connection.setPeerName).toHaveBeenCalledWith('peer_eve', 'Eve');
    expect(toast.success).toHaveBeenCalledWith('Eve joined the room');
  });

  it('handles edit messages correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({ sender_id: 'frank_1', content: 'old' });

    const msg: EditMessage = {
      type: 'edit',
      roomId: 'room_123',
      messageId: 'msg_1',
      newContent: 'new',
      senderId: 'frank_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_frank');

    expect(messages.updateMessage).toHaveBeenCalledWith('room_123', 'msg_1', expect.objectContaining({
      content: 'new',
      edited: true,
      edit_timestamp: 12345,
      original_content: 'old'
    }));
  });

  it('rejects edit messages from non-owners', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({ sender_id: 'frank_1', content: 'old' });

    const msg: EditMessage = {
      type: 'edit',
      roomId: 'room_123',
      messageId: 'msg_1',
      newContent: 'new',
      senderId: 'malicious_user',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_malicious');

    expect(messages.updateMessage).not.toHaveBeenCalled();
  });

  it('handles delete messages correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({ sender_id: 'grace_1' });

    const msg: DeleteMessage = {
      type: 'delete',
      roomId: 'room_123',
      messageId: 'msg_1',
      senderId: 'grace_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_grace');

    expect(messages.updateMessage).toHaveBeenCalledWith('room_123', 'msg_1', expect.objectContaining({
      content: '[Message deleted]',
      message_type: 'Deleted'
    }));
  });

  it('handles reaction messages correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({ id: 'msg_1', reactions: {} });

    const msg: ReactionMessage = {
      type: 'reaction',
      roomId: 'room_123',
      messageId: 'msg_1',
      reaction: '👍',
      senderId: 'heidi_1',
      senderName: 'Heidi',
      action: 'add',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_heidi');

    expect(messages.updateMessage).toHaveBeenCalledWith('room_123', 'msg_1', expect.objectContaining({
      reactions: { '👍': { users: ['heidi_1'], count: 1 } }
    }));
  });

  it('handles delivery ack messages correctly', async () => {
    const { delivery } = await import('$lib/stores/delivery');

    const msg: DeliveryAckMessage = {
      type: 'delivery-ack',
      messageId: 'msg_1',
      roomId: 'room_123',
      peerId: 'peer_ivan',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_ivan');

    expect(delivery.recordDelivery).toHaveBeenCalledWith('msg_1', 'peer_ivan');
  });

  it('warns on unknown message type', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const msg = { type: 'unknown_type' } as any;

    routeP2PMessage(msg, 'peer_unknown');

    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] Unknown message type: unknown_type');
    consoleWarnSpy.mockRestore();
  });

  it('catches and logs errors during routing', async () => {
    const { messages } = await import('$lib/stores/messages');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Force an error
    (messages.addMessage as any).mockImplementation(() => {
      throw new Error('Test error');
    });

    const msg: ChatMessage = {
      type: 'chat',
      content: 'hello',
      senderName: 'Alice',
      senderId: 'alice_1',
      messageId: 'msg_1',
      timestamp: 12345,
      roomId: 'room_123',
      encrypted: false
    };

    routeP2PMessage(msg, 'peer_alice');

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[P2P Handler] Error routing message:',
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('handles edit messages without original content', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({ sender_id: 'frank_1' });

    const msg: EditMessage = {
      type: 'edit',
      roomId: 'room_123',
      messageId: 'msg_1',
      newContent: 'new',
      senderId: 'frank_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_frank');

    expect(messages.updateMessage).toHaveBeenCalledWith('room_123', 'msg_1', expect.objectContaining({
      content: 'new',
      edited: true,
      edit_timestamp: 12345,
      original_content: null
    }));
  });

  it('rejects delete messages from non-owners', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({ sender_id: 'grace_1' });

    const msg: DeleteMessage = {
      type: 'delete',
      roomId: 'room_123',
      messageId: 'msg_1',
      senderId: 'malicious_user',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_malicious');

    expect(messages.updateMessage).not.toHaveBeenCalled();
  });

  it('handles remove reaction action correctly', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({
      id: 'msg_1',
      reactions: { '👍': { users: ['heidi_1', 'other_user'], count: 2 } }
    });

    const msg: ReactionMessage = {
      type: 'reaction',
      roomId: 'room_123',
      messageId: 'msg_1',
      reaction: '👍',
      senderId: 'heidi_1',
      senderName: 'Heidi',
      action: 'remove',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_heidi');

    expect(messages.updateMessage).toHaveBeenCalledWith('room_123', 'msg_1', expect.objectContaining({
      reactions: { '👍': { users: ['other_user'], count: 1 } }
    }));
  });

  it('handles removing the last reaction completely', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue({
      id: 'msg_1',
      reactions: { '👍': { users: ['heidi_1'], count: 1 } }
    });

    const msg: ReactionMessage = {
      type: 'reaction',
      roomId: 'room_123',
      messageId: 'msg_1',
      reaction: '👍',
      senderId: 'heidi_1',
      senderName: 'Heidi',
      action: 'remove',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_heidi');

    expect(messages.updateMessage).toHaveBeenCalledWith('room_123', 'msg_1', expect.objectContaining({
      reactions: {}
    }));
  });
});

import { emitToast } from './handlers';
describe('emitToast', () => {
  it('emits success toast for peer-joined', async () => {
    const { toast } = await import('svelte-sonner');
    emitToast('peer-joined', 'msg');
    expect(toast.success).toHaveBeenCalledWith('msg');
  });

  it('emits success toast for success', async () => {
    const { toast } = await import('svelte-sonner');
    emitToast('success', 'msg');
    expect(toast.success).toHaveBeenCalledWith('msg');
  });

  it('emits info toast for peer-left', async () => {
    const { toast } = await import('svelte-sonner');
    emitToast('peer-left', 'msg');
    expect(toast.info).toHaveBeenCalledWith('msg');
  });

  it('emits info toast for info', async () => {
    const { toast } = await import('svelte-sonner');
    emitToast('info', 'msg');
    expect(toast.info).toHaveBeenCalledWith('msg');
  });

  it('emits error toast for error', async () => {
    const { toast } = await import('svelte-sonner');
    emitToast('error', 'msg');
    expect(toast.error).toHaveBeenCalledWith('msg');
  });
});

describe('edge cases', () => {
  afterEach(() => { vi.clearAllMocks(); });
  it('handles chat messages missing senderName but having senderId', async () => {
    const { messages } = await import('$lib/stores/messages');
    const { drafts } = await import('$lib/stores/drafts');
    const { connection } = await import('$lib/stores/connection');

    const msg: ChatMessage = {
      type: 'chat',
      content: 'hello',
      senderName: '',
      senderId: 'alice_1',
      messageId: 'msg_1',
      timestamp: 12345,
      roomId: 'room_123',
      encrypted: true
    };

    routeP2PMessage(msg, 'peer_alice');

    // connection.setPeerName shouldn't be called without senderName
    expect(connection.setPeerName).not.toHaveBeenCalled();
    expect(messages.addMessage).toHaveBeenCalled();
  });

  it('handles invalid chat messages gracefully', async () => {
    const { messages } = await import('$lib/stores/messages');
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Missing content
    const msg: ChatMessage = {
      type: 'chat',
      content: '',
      senderName: '',
      senderId: 'alice_1',
      messageId: 'msg_1',
      timestamp: 12345,
      roomId: 'room_123',
      encrypted: true
    };

    routeP2PMessage(msg, 'peer_alice');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] Invalid chat message received');
    expect(messages.addMessage).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe('more coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles sync response missing room ID', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // override get to return null for currentRoomId
    const store = await import('svelte/store');
    (store.get as any).mockReturnValueOnce(null);

    const msg: SyncResponseMessage = {
      type: 'sync-response',
      roomId: '',
      messages: [] as any,
      timestamp: 12345,
      encrypted: true
    };

    routeP2PMessage(msg, 'peer_x');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] No room ID for sync response');
    consoleWarnSpy.mockRestore();
  });

  it('handles sync request missing room ID', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await import('svelte/store');
    (store.get as any).mockReturnValueOnce(null);

    const msg: SyncRequestMessage = {
      type: 'sync-request',
      roomId: '',
      lastSync: 12345,
      messageCount: 0,
      requesterId: 'y_1'
    };

    routeP2PMessage(msg, 'peer_y');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] No room ID for sync request');
    consoleWarnSpy.mockRestore();
  });

  it('handles edit message missing properties', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await import('svelte/store');
    (store.get as any).mockReturnValueOnce(null);

    const msg: EditMessage = {
      type: 'edit',
      roomId: '',
      messageId: '',
      newContent: 'new',
      senderId: 'frank_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_frank');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] Invalid edit message');
    consoleWarnSpy.mockRestore();
  });

  it('handles delete message missing properties', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await import('svelte/store');
    (store.get as any).mockReturnValueOnce(null);

    const msg: DeleteMessage = {
      type: 'delete',
      roomId: '',
      messageId: '',
      senderId: 'grace_1',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_grace');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] Invalid delete message');
    consoleWarnSpy.mockRestore();
  });

  it('handles reaction message missing message found', async () => {
    const { messages } = await import('$lib/stores/messages');
    (messages.getMessage as any).mockReturnValue(null);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const msg: ReactionMessage = {
      type: 'reaction',
      roomId: 'room_123',
      messageId: 'msg_1',
      reaction: '👍',
      senderId: 'heidi_1',
      senderName: 'Heidi',
      action: 'add',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_heidi');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] Message not found for reaction');
    consoleWarnSpy.mockRestore();
  });

  it('handles reaction message missing parameters', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await import('svelte/store');
    (store.get as any).mockReturnValueOnce(null);

    const msg: ReactionMessage = {
      type: 'reaction',
      roomId: '',
      messageId: '',
      reaction: '',
      senderId: 'heidi_1',
      senderName: 'Heidi',
      action: 'add',
      timestamp: 12345
    };

    routeP2PMessage(msg, 'peer_heidi');
    expect(consoleWarnSpy).toHaveBeenCalledWith('[P2P Handler] Invalid reaction message');
    consoleWarnSpy.mockRestore();
  });
});
