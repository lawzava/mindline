# E2E Testing Guide - Mindline

This document defines all features that should be tested end-to-end using Playwright.

## Overview

Mindline is a P2P real-time chat application with "radical transparency" - users see each other's messages as they type. Testing requires simulating multiple browser contexts to verify P2P functionality.

---

## Test Environment Setup

### Prerequisites
- Signaling server running on `localhost:3000`
- Application running on `localhost:5173`
- Multiple browser contexts to simulate different users

### Test User Setup
```typescript
// Each test should create isolated users
const userA = { name: 'Alice', context: browser.newContext() };
const userB = { name: 'Bob', context: browser.newContext() };
```

---

## 1. Landing Page Tests

### 1.1 Page Load
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Initial render | Navigate to `/` | Welcome card visible with "Welcome to Mindline" title |
| Loading state | Navigate to `/` | Loading spinner shown while WASM initializes |
| WASM load success | Wait for WASM | Loading spinner disappears, main content visible |
| WASM load failure | Mock WASM error | Error message displayed with "Try again" button |

### 1.2 Create Room Flow
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Click create room | Click "Create New Room" button | Navigates to `/{roomId}` with valid UUID |
| User auto-initialization | Create room without name | User initialized as "Anonymous" |
| User name preserved | Set name, create room | User name persisted in new room |

### 1.3 Join Room Flow
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Join button disabled | Page load with empty input | Join button is disabled |
| Join button enabled | Enter room ID | Join button becomes enabled |
| Enter key submit | Type room ID, press Enter | Navigates to room |
| Join via button | Type room ID, click arrow | Navigates to room |
| Whitespace handling | Enter "  roomid  " | Whitespace trimmed, joins correctly |

---

## 2. Header Tests

### 2.1 Username Input
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Display current name | Load page | Username input shows current name |
| Update name on blur | Change name, blur input | Toast "Name updated!" shown |
| Update name on Enter | Change name, press Enter | Toast "Name updated!" shown |
| Empty name rejected | Clear name, blur | Toast "Name cannot be empty", previous name restored |
| Name persisted | Change name, reload | Name persisted in localStorage |

### 2.2 Share Button (Room Only)
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Hidden on home | Navigate to `/` | Share button not visible |
| Visible in room | Navigate to room | Share button visible |
| Copy to clipboard | Click share button | Toast "Link copied to clipboard!" |
| Clipboard content | Click share, check clipboard | Contains full room URL |
| Web Share API | Mock navigator.share | Share dialog triggered (mobile) |

### 2.3 Theme Toggle
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Toggle to dark | Click moon icon | `dark` class added to html, sun icon shown |
| Toggle to light | Click sun icon | `dark` class removed, moon icon shown |
| Persisted in storage | Toggle, reload | Theme preference maintained |
| System preference | Clear storage, reload | Respects prefers-color-scheme |

---

## 3. Room Page Tests

### 3.1 Room Loading
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Loading state shown | Navigate to room | "Joining room..." spinner visible |
| Loading state clears | Wait for initialization | Spinner removed, chat UI visible |
| Room ID displayed | Enter room | Truncated room ID visible in header |

### 3.2 Room ID Copy
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Hover shows icon | Hover room ID badge | Copy icon fades in |
| Click copies ID | Click room ID badge | Toast "Room ID copied!" |
| Full ID copied | Click, check clipboard | Full room ID (not truncated) in clipboard |

### 3.3 Leave Room
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Leave button visible | Enter room | Leave button visible in header |
| Click leaves room | Click leave button | Navigates to `/` |
| State cleared | Leave room | Room ID cleared from store |
| P2P disconnected | Leave room, check network | WebSocket/WebRTC connections closed |

---

## 4. Connection Status Tests

### 4.1 Status Display
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Connecting state | Join room | Yellow spinner, "Connecting" badge |
| Connected state | P2P connects | Green icon, "Connected" badge |
| Disconnected state | Kill signaling server | Gray icon, "Disconnected" badge |
| Failed state | Max reconnect attempts | Red icon, "Failed" badge |
| Local mode | P2P init fails | Gray icon, "Local" badge |

### 4.2 Status Tooltips
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Connected tooltip | Hover connected badge | Shows "Connected to signaling server" |
| Disconnected tooltip | Hover disconnected badge | Shows "Not connected to signaling server" |
| Failed tooltip | Hover failed badge | Shows "Connection failed. Click reconnect..." |
| Local tooltip | Hover local badge | Shows "Working offline. Messages won't sync..." |

### 4.3 Peer Count
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Zero peers | Connect alone | Shows "Waiting for peers..." badge |
| One peer | Second user joins | Shows "1 peer" badge |
| Multiple peers | Third user joins | Shows "2 peers" badge |
| Peer leaves | Second user leaves | Count decremented |

### 4.4 Reconnect Button
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Hidden when connected | P2P connected | Reconnect button not visible |
| Shown when disconnected | P2P disconnects | Reconnect button visible |
| Shown when failed | P2P fails | Reconnect button visible |
| Click reconnects | Click reconnect | Status changes to "Connecting" |
| Success toast | Reconnection succeeds | Toast "Reconnected successfully!" |
| Failure toast | Reconnection fails | Toast "Failed to reconnect" |
| Spinner while reconnecting | Click reconnect | Button shows spinning icon |

### 4.5 Error Display
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Error icon shown | Connection error occurs | Red AlertCircle icon visible |
| Error tooltip | Hover error icon | Shows error message in tooltip |
| Error cleared | Reconnection succeeds | Error icon disappears |

---

## 5. Messaging Tests

### 5.1 Message Input
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Empty input disabled | Page load | Send button disabled |
| Non-empty enables | Type text | Send button enabled |
| Enter sends | Type, press Enter | Message sent, input cleared |
| Shift+Enter no send | Type, Shift+Enter | Newline inserted, not sent |
| Whitespace trimmed | Send "  hello  " | Message content is "hello" |
| Input auto-focused | Page load | Input has focus |

### 5.2 Message Display
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Empty state | No messages | Shows "No messages yet. Start the conversation!" |
| Own message right | Send message | Message aligned right, primary color |
| Other message left | Receive message | Message aligned left, muted color |
| Sender name shown | Receive message | Sender name above bubble (others only) |
| Timestamp on hover | Hover message | Timestamp fades in |
| Auto-scroll | Send message | Scrolls to bottom |

### 5.3 Message Send Failure
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Error toast | WASM send fails | Toast "Failed to send message" |
| Failed status | WASM send fails | Message shows "(failed)" indicator |

---

## 6. Real-time Typing (Radical Transparency)

### 6.1 Typing Broadcast
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Typing indicator sent | User A types | User B sees typing indicator |
| Content visible | User A types "hello" | User B sees "hello" in draft indicator |
| Cleared on send | User A sends message | Draft indicator disappears |
| Cleared on clear | User A clears input | Draft indicator disappears |

### 6.2 Draft Indicator Display
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Shows sender name | User A types | Shows "Alice" label |
| Shows content | User A types "hi" | Shows italic "hi" |
| Empty shows dots | User A focuses input | Shows animated typing dots |
| Multiple drafts | A and B type | Both drafts visible |
| Auto-timeout | User stops typing | Draft clears after 3 seconds |

---

## 7. Message Reactions

### 7.1 Adding Reactions
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Emoji picker on hover | Hover message | Smile icon appears |
| Click opens picker | Click smile icon | Emoji picker popover opens |
| Select emoji | Click 👍 | Reaction pill appears under message |
| Picker closes | Select emoji | Popover closes |
| Broadcast to peers | Add reaction | Other users see reaction |

### 7.2 Reaction Display
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Pill shows emoji | Add reaction | Pill shows "👍 1" |
| Count increments | Second user reacts | Pill shows "👍 2" |
| Own reaction styled | Add own reaction | Pill has primary color highlight |
| Other reaction styled | Other adds reaction | Pill has muted color |

### 7.3 Toggle Reactions
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Click to remove | Click own reaction | Reaction removed |
| Count decrements | Remove reaction | Count goes down |
| Pill removed at zero | Last reaction removed | Pill disappears |
| Re-add reaction | Click emoji again | Reaction re-added |

---

## 8. Message Edit

### 8.1 Edit UI
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Menu on own message | Hover own message | Three-dot menu appears |
| No menu on others | Hover others' message | Only emoji picker, no menu |
| Click edit | Click Edit in menu | Inline edit mode activated |
| Input pre-filled | Enter edit mode | Input contains original content |
| Cancel edit | Press Escape | Edit mode closed, content unchanged |
| Cancel via button | Click X button | Edit mode closed, content unchanged |

### 8.2 Save Edit
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Enter saves | Edit, press Enter | Edit saved, mode closed |
| Button saves | Edit, click checkmark | Edit saved, mode closed |
| Content updated | Save edit | Message shows new content |
| Edited indicator | Save edit | Shows "(edited)" in timestamp |
| Broadcast to peers | Save edit | Other users see edited content |
| Toast shown | Save edit | Toast "Message edited" |

### 8.3 Edit Validation
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Empty rejected | Clear content, save | Edit not saved |
| Same content | Save unchanged | Edit mode closes, no update |
| Whitespace trimmed | Add spaces, save | Spaces trimmed from content |

---

## 9. Message Delete

### 9.1 Delete UI
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Delete in menu | Open menu | Delete option visible (red) |
| Confirmation dialog | Click Delete | Alert dialog opens |
| Dialog content | Open dialog | Shows warning about deletion |
| Cancel closes | Click Cancel | Dialog closes, message unchanged |

### 9.2 Confirm Delete
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Click confirm | Click Delete in dialog | Message deleted |
| Content changed | Delete message | Shows "[Message deleted]" |
| Styled differently | Delete message | Message has italic, muted style |
| No actions | Delete message | No edit/delete/reaction options |
| Toast shown | Delete message | Toast "Message deleted" |
| Broadcast to peers | Delete message | Other users see deletion |

---

## 10. P2P Multi-User Tests

### 10.1 User Join/Leave
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Join notification | User B joins room | User A sees toast "Bob joined the room" |
| Leave notification | User B leaves | User A sees toast "Bob left the room" |
| Peer name tracked | B joins, then leaves | Leave toast shows name, not ID |

### 10.2 Message Sync
| Test | Steps | Expected Result |
|------|-------|-----------------|
| New message received | A sends | B receives message |
| History sync | B joins after messages | B receives message history |
| No duplicates | B syncs twice | Messages not duplicated |

### 10.3 Multi-User Typing
| Test | Steps | Expected Result |
|------|-------|-----------------|
| See multiple drafts | A and B type | C sees both drafts |
| Draft cleared on send | A sends | A's draft removed from C's view |
| Draft timeout | A stops typing | A's draft clears after 3s |

---

## 11. Offline/Error States

### 11.1 P2P Failure
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Warning toast | P2P init fails | Toast "P2P connection failed..." shown |
| Local mode | P2P fails | Status shows "Local" |
| Messages still work | Send in local mode | Message appears in own view |

### 11.2 Reconnection
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Auto-reconnect | Connection lost | Automatic reconnection attempts |
| Max attempts | 5 failures | Stops trying, shows error toast |
| Manual reconnect | Click reconnect | New connection attempt |

---

## 12. Persistence Tests

### 12.1 User Data
| Test | Steps | Expected Result |
|------|-------|-----------------|
| User ID persisted | Create user, reload | Same user ID |
| User name persisted | Set name, reload | Same name shown |
| Theme persisted | Toggle theme, reload | Theme preference maintained |

### 12.2 Messages
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Messages saved | Send messages, reload | Messages still visible |
| Edits saved | Edit message, reload | Edited content persisted |
| Reactions saved | Add reaction, reload | Reaction persisted |
| Deletions saved | Delete message, reload | Deletion persisted |

---

## 13. Responsive/Accessibility Tests

### 13.1 Mobile Layout
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Leave text hidden | Mobile viewport | Leave button shows icon only |
| Input full width | Mobile viewport | Message input spans full width |
| Bubbles max 80% | Mobile viewport | Messages don't exceed 80% width |

### 13.2 Keyboard Navigation
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Tab through controls | Press Tab | Focus moves through interactive elements |
| Enter activates buttons | Focus button, Enter | Button activated |
| Escape closes dialogs | Open dialog, Escape | Dialog closes |

### 13.3 Screen Reader
| Test | Steps | Expected Result |
|------|-------|-----------------|
| Buttons have labels | Check sr-only | All icon buttons have screen reader text |
| Status announced | Connection changes | Status changes are announced |

---

## Test Data Constants

```typescript
export const TEST_ROOM_ID = 'test-room-12345678';
export const TEST_USER_A = { name: 'Alice' };
export const TEST_USER_B = { name: 'Bob' };
export const TEST_MESSAGE = 'Hello, World!';
export const TEST_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👏', '🔥', '🎉'];
```

---

## Playwright Configuration Notes

```typescript
// playwright.config.ts recommendations
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: false, // P2P tests need sequential execution
  workers: 1, // Single worker for P2P coordination
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm run signaling',
      port: 3000,
      reuseExistingServer: true,
    },
    {
      command: 'pnpm run dev',
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
```

---

## Multi-Browser Context Pattern

```typescript
// Example: Testing P2P between two users
test('two users can exchange messages', async ({ browser }) => {
  // Create two isolated browser contexts
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();

  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  // User A creates room
  await pageA.goto('/');
  await pageA.getByRole('button', { name: 'Create New Room' }).click();
  const roomUrl = pageA.url();

  // User B joins same room
  await pageB.goto(roomUrl);

  // Wait for P2P connection
  await expect(pageA.getByText('1 peer')).toBeVisible();
  await expect(pageB.getByText('1 peer')).toBeVisible();

  // User A sends message
  await pageA.getByPlaceholder('Type a message...').fill('Hello from A!');
  await pageA.getByPlaceholder('Type a message...').press('Enter');

  // User B receives message
  await expect(pageB.getByText('Hello from A!')).toBeVisible();

  // Cleanup
  await contextA.close();
  await contextB.close();
});
```
