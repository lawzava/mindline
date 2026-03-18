import { describe, it, expect, vi } from 'vitest';
import { routeP2PMessage } from './handlers';
import type { TypedP2PMessage } from './types';

describe('routeP2PMessage', () => {
    it('should catch and log errors when routing a malformed message', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Injecting a null message to intentionally cause an error
        const message = null as unknown as TypedP2PMessage;
        routeP2PMessage(message, 'peer-1');

        expect(consoleSpy).toHaveBeenCalledWith(
            '[P2P Handlers] Error routing message:',
            expect.any(TypeError),
            message
        );

        consoleSpy.mockRestore();
    });

    it('should catch and log errors when type getter throws', () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const malformedMessage = {
            get type() {
                throw new Error('Simulated access error');
            }
        } as unknown as TypedP2PMessage;

        routeP2PMessage(malformedMessage, 'peer-1');

        expect(consoleSpy).toHaveBeenCalledWith(
            '[P2P Handlers] Error routing message:',
            expect.any(Error),
            malformedMessage
        );

        consoleSpy.mockRestore();
    });
});
