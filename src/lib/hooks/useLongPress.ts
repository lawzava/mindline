/**
 * Long Press Svelte Action
 * Detects long press (touch hold) gestures on touch devices
 */

export interface LongPressOptions {
	duration?: number; // milliseconds to wait (default: 400)
	onLongPress: () => void;
	onCancel?: () => void;
}

export function longPress(node: HTMLElement, options: LongPressOptions) {
	const duration = options.duration ?? 400;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let startX = 0;
	let startY = 0;
	const moveThreshold = 10; // pixels - cancel if finger moves too much

	function handleTouchStart(event: TouchEvent) {
		const touch = event.touches[0];
		startX = touch.clientX;
		startY = touch.clientY;

		timeoutId = setTimeout(() => {
			// Provide haptic feedback if available
			if (navigator.vibrate) {
				navigator.vibrate(50);
			}
			options.onLongPress();
			timeoutId = null;
		}, duration);
	}

	function handleTouchMove(event: TouchEvent) {
		if (!timeoutId) return;

		const touch = event.touches[0];
		const deltaX = Math.abs(touch.clientX - startX);
		const deltaY = Math.abs(touch.clientY - startY);

		// Cancel if user is scrolling
		if (deltaX > moveThreshold || deltaY > moveThreshold) {
			cancel();
		}
	}

	function handleTouchEnd() {
		cancel();
	}

	function handleContextMenu(event: Event) {
		// Prevent native context menu on long press
		if (timeoutId !== null) {
			event.preventDefault();
		}
	}

	function cancel() {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
			options.onCancel?.();
		}
	}

	node.addEventListener('touchstart', handleTouchStart, { passive: true });
	node.addEventListener('touchmove', handleTouchMove, { passive: true });
	node.addEventListener('touchend', handleTouchEnd);
	node.addEventListener('touchcancel', handleTouchEnd);
	node.addEventListener('contextmenu', handleContextMenu);

	return {
		update(newOptions: LongPressOptions) {
			options = newOptions;
		},
		destroy() {
			cancel();
			node.removeEventListener('touchstart', handleTouchStart);
			node.removeEventListener('touchmove', handleTouchMove);
			node.removeEventListener('touchend', handleTouchEnd);
			node.removeEventListener('touchcancel', handleTouchEnd);
			node.removeEventListener('contextmenu', handleContextMenu);
		}
	};
}
