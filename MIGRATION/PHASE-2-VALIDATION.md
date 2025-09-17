# Phase 2: Eliminate Duplicate Validation

## 🤖 AI Agent Execution Instructions

**If you are an AI agent, follow these instructions EXACTLY:**

1. **VERIFY PHASE 1 IS COMPLETE** - All 77 WASM functions must be available
2. **READ ENTIRE FILE FIRST** - Understand all changes before starting
3. **USE GREP COMMANDS** - Run the grep commands to find exact code locations
4. **DELETE AND REPLACE** - Don't comment out, actually delete old code
5. **TEST AFTER EACH VALIDATION TYPE** - Test room, message, username separately
6. **COMMIT AFTER EACH FILE** - Create restore points

### Pre-Execution Verification:
```bash
# Check Phase 1 is complete:
# In browser console:
console.log(Object.keys(window.safeWasm).length >= 77 ? '✅ WASM ready' : '❌ Phase 1 incomplete')
console.log(typeof window.safeWasm.validate_room_id === 'function' ? '✅ Room validation' : '❌')
console.log(typeof window.safeWasm.validate_message === 'function' ? '✅ Message validation' : '❌')
console.log(typeof window.safeWasm.validate_username === 'function' ? '✅ Username validation' : '❌')
```

## Goal
Use Rust for ALL validation logic. Remove duplicate validation code from JavaScript.

## Duration
1 week

## Prerequisites
- ✅ Phase 1 complete (all WASM functions available)
- All 77 functions accessible via window.safeWasm

## Summary

This phase migrates all validation logic from JavaScript to Rust, eliminating code duplication and ensuring consistent validation rules across the application.

The key validations to migrate:
1. Room ID validation
2. Message validation
3. Username validation

Check the original MIGRATION.md for detailed step-by-step instructions for each validation type.

## Files to Modify
- `js/room-manager.js` - Remove `isValidRoomId()`
- `js/message-manager.js` - Use Rust validation
- `js/user-manager.js` - Use Rust validation
- `js/event-handlers.js` - Update validation calls
- `js/state.js` - Remove validation constants

## Success Criteria
- [ ] `isValidRoomId` function DELETED
- [ ] No `substring(0, 2000)` in message handling
- [ ] No `substring(0, 32)` in username handling
- [ ] All validation uses `window.safeWasm.validate_*`
- [ ] Error messages from Rust properly displayed
- [ ] No JavaScript regex patterns for validation
- [ ] All validation constants removed from JavaScript
