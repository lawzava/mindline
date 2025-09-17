/**
 * Room History Management
 * Handles room history storage and UI updates
 */

import logger from './logger.js';

// Use WASM validation function
function isValidRoomId(id) {
  if (!window.safeWasm || !window.safeWasm.validate_room_id) {
    // Fallback if WASM not ready
    return false;
  }
  try {
    return window.safeWasm.validate_room_id(id);
  } catch (error) {
    logger.error('Room ID validation error:', error);
    return false;
  }
}

/**
 * Generate shareable room URL
 * @param {string} roomId - The room ID to share
 * @returns {string} Complete shareable URL
 */
export function generateShareableURL(roomId) {
  const baseURL = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
  return `${baseURL}?r=${encodeURIComponent(roomId)}`;
}

/**
 * Get room history from localStorage
 * @returns {Array} Array of room objects with {id, name, lastJoined}
 */
export function getRoomHistory() {
  try {
    const history = localStorage.getItem('roomHistory');
    return history ? JSON.parse(history) : [];
  } catch (error) {
    logger.error('Error parsing room history:', error);
    return [];
  }
}

/**
 * Add room to history
 * @param {string} roomId - Room ID to add
 */
export function addRoomToHistory(roomId) {
  if (!roomId || !isValidRoomId(roomId)) return;

  const history = getRoomHistory();
  const now = Date.now();

  // Remove existing entry for this room
  const filteredHistory = history.filter(room => room.id !== roomId);

  // Add new entry at the beginning
  const newEntry = {
    id: roomId,
    name: roomId, // Could be extended to store custom names
    lastJoined: now
  };

  filteredHistory.unshift(newEntry);

  // Keep only last 10 rooms
  const limitedHistory = filteredHistory.slice(0, 10);

  // Save back to localStorage
  try {
    localStorage.setItem('roomHistory', JSON.stringify(limitedHistory));
    updateRoomHistoryUI();
  } catch (error) {
    logger.error('Error saving room history:', error);
  }
}

/**
 * Remove room from history
 * @param {string} roomId - Room ID to remove
 */
export function removeRoomFromHistory(roomId) {
  const history = getRoomHistory();
  const filteredHistory = history.filter(room => room.id !== roomId);

  try {
    localStorage.setItem('roomHistory', JSON.stringify(filteredHistory));
    updateRoomHistoryUI();
  } catch (error) {
    logger.error('Error removing room from history:', error);
  }
}


/**
 * Update room history UI
 */
export function updateRoomHistoryUI() {
  const roomHistoryList = document.getElementById('roomHistoryList');
  if (!roomHistoryList) return;

  const history = getRoomHistory();

  if (history.length === 0) {
    roomHistoryList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
          </svg>
        </div>
        <h3 class="empty-state-title">No rooms yet</h3>
        <p class="empty-state-description">Join or create your first room to start chatting with radical transparency.</p>
        <div class="empty-state-action">
          <button class="neo-btn neo-btn-primary neo-hover-nuclear" onclick="document.getElementById('roomIdInput').focus()">
            Create Room
          </button>
        </div>
      </div>
    `;
    return;
  }

  // Generate room history HTML
  const roomsHTML = history.map(room => {
    const timeAgo = formatTimeAgo(room.lastJoined);
    return `
      <div class="room-history-item neo-card neo-hover-bounce cursor-pointer"
           onclick="joinRoomFromHistory('${room.id}')">
        <div class="flex justify-between items-center">
          <div class="flex-1">
            <div class="room-name neo-text-bold text-primary dark:text-primary-dark">${room.name}</div>
            <div class="room-meta text-xs text-gray-500 dark:text-gray-400">Last joined ${timeAgo}</div>
          </div>
          <div class="flex gap-2 items-center">
            <button onclick="event.stopPropagation(); shareRoomById('${room.id}')"
                    class="neo-btn-mini neo-hover-bounce"
                    title="Share room">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"></path>
              </svg>
            </button>
            <button onclick="event.stopPropagation(); removeRoomFromHistory('${room.id}')"
                    class="neo-btn-mini neo-hover-bounce text-error dark:text-error-dark"
                    title="Remove from history">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  roomHistoryList.innerHTML = roomsHTML;
}

/**
 * Format timestamp as "time ago"
 * @param {number} timestamp - Timestamp to format
 * @returns {string} Formatted time ago string
 */
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'Just now';
  }
}

// Global functions for HTML onclick handlers
window.removeRoomFromHistory = removeRoomFromHistory;