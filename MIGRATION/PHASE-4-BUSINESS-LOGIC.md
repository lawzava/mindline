# Phase 4: Migrate Business Logic

## 🤖 AI Agent Execution Instructions

**If you are an AI agent, follow these instructions EXACTLY:**

1. **VERIFY STATE IS IN RUST** - Phase 3 must be complete
2. **FOCUS ON LOGIC, NOT UI** - Keep UI functions, move logic
3. **TEST MESSAGE FLOW** - Every message operation must work
4. **PRESERVE USER EXPERIENCE** - No visible changes to users
5. **USE EXISTING RUST FUNCTIONS** - Don't create new ones

### Pre-Execution Verification:
```bash
# Check state is migrated to Rust
grep -r "AppState.currentUserId" js/ && echo "❌ State not migrated" || echo "✅ State in Rust"
```

## Goal
Move all business logic to Rust, keep JavaScript for UI only.

## Duration
1 week

## Prerequisites
- ✅ Phase 3 complete (state in Rust)
- All state managed by Rust

## Summary

Migrate core business logic:
1. Message management (send, receive, store)
2. Room management (create, join, leave)
3. Draft message handling
4. Message synchronization

Check the original MIGRATION.md for detailed migration instructions.

## Files to Modify
- `js/message-manager.js` - Keep only UI updates
- `js/room-manager.js` - Keep only UI coordination
- `js/user-manager.js` - Minimal UI helpers

## Success Criteria
- [ ] All message operations use Rust
- [ ] Room management fully in Rust
- [ ] Draft system uses Rust storage
- [ ] No business logic remaining in JS
