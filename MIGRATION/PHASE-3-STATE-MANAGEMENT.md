# Phase 3: Migrate State Management

## 🤖 AI Agent Execution Instructions

**If you are an AI agent, follow these instructions EXACTLY:**

1. **CRITICAL PHASE** - Errors here break everything
2. **BACKUP STATE FILES FIRST** - Create .backup copies
3. **ONE STATE AT A TIME** - User → Room → Messages → Peers
4. **UPDATE ALL REFERENCES** - Use grep to find all usage points
5. **TEST STATE PERSISTENCE** - Verify state survives page refresh
6. **WATCH FOR LOOPS** - State changes can cause infinite loops

### Pre-Execution Safety Check:
```bash
# Verify Phase 2 complete
grep -r "isValidRoomId" js/ && echo "❌ Phase 2 incomplete" || echo "✅ Validation migrated"

# Create critical backups
cp js/state.js js/state.js.backup
cp js/app-state.js js/app-state.js.backup
echo "✅ Backups created"
```

### Migration Order (DO NOT CHANGE):
1. User State (getCurrentUserId, setCurrentUserId)
2. Room State (getCurrentRoomId, setCurrentRoomId)
3. Message History (getChatHistory, setChatHistory)
4. Connected Peers (peer management functions)

## Goal
Rust as single source of truth for all state. Remove duplicate state management from JavaScript.

## Duration
1 week

## Prerequisites
- ✅ Phase 2 complete (validation migrated)
- All validation using Rust functions

## Summary

This critical phase migrates all application state from JavaScript to Rust:
1. User state (userId, userName)
2. Room state (currentRoomId)
3. Message history
4. Connected peers

Check the original MIGRATION.md for detailed migration steps for each state type.

## Files to Modify
- `js/state.js` - Convert to Rust wrapper
- `js/app-state.js` - Remove duplicate state
- All JS files - Update state access patterns

## Success Criteria
- [ ] AppState object has NO user/room/message state
- [ ] All state queries use Rust functions
- [ ] State persists across page refreshes
- [ ] No errors in browser console
- [ ] Multi-tab state synchronization works
- [ ] All existing features still functional
