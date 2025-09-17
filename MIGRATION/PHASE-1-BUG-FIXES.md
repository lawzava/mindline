# Phase 1: Critical Bug Fixes & Enablement

## 🤖 AI Agent Execution Instructions

**If you are an AI agent, follow these instructions EXACTLY:**

1. **VERIFY PHASE 0 IS COMPLETE** - Check that all Phase 0 tasks are done
2. **READ THIS ENTIRE FILE** before making any changes
3. **EXECUTE TASKS IN ORDER** - Complete 1.1, then 1.2, then 1.3
4. **TEST AFTER EACH TASK** - Run the verification tests before moving to next task
5. **STOP IF ANY TEST FAILS** - Use `cat MIGRATION/ROLLBACK-PROCEDURES.md`
6. **COMMIT AFTER EACH WORKING TASK** - Use git commits as checkpoints

### Pre-Execution Checklist:
```bash
# Verify you're ready for Phase 1:
[ -f "MIGRATION/baseline-metrics.txt" ] && echo "✅ Metrics recorded" || echo "❌ Run Phase 0 first"
git branch --show-current | grep -q "migration" && echo "✅ On migration branch" || echo "❌ Wrong branch"
npm run build-wasm && echo "✅ WASM builds" || echo "❌ Fix build first"
```

### Execution Order:
```bash
# Task 1.1: Fix UUID Generation (Follow ALL 6 steps)
# Task 1.2: Fix URL Parameters (Follow ALL 6 steps)
# Task 1.3: Fix WASM Proxies (Follow ALL 5 steps)
# Then run validation tests
# Only proceed to Phase 2 if ALL tests pass
```

## Goal
Fix blocking issues preventing Rust function usage. These bugs currently force JavaScript fallbacks instead of using existing Rust implementations.

## Duration
1 week

## Prerequisites
- ✅ Phase 0 (Preparation) complete
- Working build system
- Backup created

## Known Issues to Fix
1. UUID generation causes "cross-browser serialization issues"
2. URL functions create "corrupted arrays"
3. 77 WASM functions lack proxy wrappers

## Tasks

### ⚠️ IMPORTANT: Complete ALL steps in order. Test after EACH step. DO NOT proceed if tests fail.

### 1.1 Fix UUID Generation Issue

**Problem**: `generate_uuid()` commented out due to "cross-browser serialization issues"

**Step-by-Step Instructions**:

1. **FIRST**: Locate the exact issue in `js/state.js` at lines 186-199:
   ```javascript
   // Find this comment block:
   // NOTE: Using Rust UUID generation causes issues with room IDs
   // window.safeWasm.generate_uuid() - commented due to issues
   ```

2. **THEN**: Check Rust implementation in `src/utils.rs`:
   ```rust
   // Find the generate_uuid() function
   // Check if it returns JsValue or String
   // Ensure it uses wasm_bindgen correctly
   ```

3. **FIX**: In `src/utils.rs`, ensure the function returns a proper JavaScript string:
   ```rust
   #[wasm_bindgen]
   pub fn generate_uuid() -> String {
       // Implementation must return String, not JsValue
       // Use uuid::Uuid::new_v4().to_string()
   }
   ```

4. **UPDATE**: In `js/wasm-manager.js`, verify the proxy exists around line 50-100:
   ```javascript
   window.safeWasm.generate_uuid = safeWasmCall(
     () => wasm.generate_uuid(),
     'generate_uuid',
     []
   );
   ```

5. **REPLACE**: In `js/state.js`, replace the entire `generateUUID()` function (lines 186-199) with:
   ```javascript
   export function generateUUID() {
     if (window.safeWasm && window.safeWasm.generate_uuid) {
       return window.safeWasm.generate_uuid();
     }
     throw new Error('WASM UUID generation not available');
   }
   ```

6. **TEST**: Run these commands and verify no errors:
   ```bash
   npm run build-wasm
   npm run build
   npm start
   # Then open browser, create a room, verify room ID is generated
   ```

### 1.2 Fix URL Parameter Handling

**Problem**: `get_room_from_url()` and `update_url_with_room()` create "corrupted arrays"

**Step-by-Step Instructions**:

1. **LOCATE**: Find the commented functions in `js/state.js` around lines 140-183

2. **CHECK**: Examine Rust implementation in `src/utils.rs`:
   ```rust
   // Find get_room_from_url() and update_url_with_room()
   // Check how they handle URL encoding
   ```

3. **FIX** in `src/utils.rs`:
   ```rust
   #[wasm_bindgen]
   pub fn get_room_from_url() -> Option<String> {
       // MUST properly decode URL parameters
       // MUST handle special characters
       // MUST return None for missing params, not empty string
   }
   ```

4. **VERIFY** proxy exists in `js/wasm-manager.js`:
   ```javascript
   window.safeWasm.get_room_from_url = safeWasmCall(
     () => wasm.get_room_from_url(),
     'get_room_from_url',
     []
   );
   ```

5. **REPLACE** in `js/state.js`:
   ```javascript
   export function getRoomFromURL() {
     if (window.safeWasm && window.safeWasm.get_room_from_url) {
       const roomId = window.safeWasm.get_room_from_url();
       return roomId || null; // Convert undefined to null
     }
     return null;
   }
   ```

6. **TEST**:
   ```bash
   # Test with special characters in URL
   # Open: http://localhost:8080/?room=test-room_123
   # Verify room ID is correctly parsed
   ```

### 1.3 Fix WASM Function Proxies

**Step-by-Step Instructions**:

1. **OPEN** `js/wasm-manager.js`

2. **FIND** the section where proxies are created (around lines 50-200)

3. **ADD** missing proxies for ALL 77 unused functions (see [UNUSED-FUNCTIONS.md](UNUSED-FUNCTIONS.md) for complete list):

   ```javascript
   // State Management Functions (ADD THESE IF MISSING)
   window.safeWasm.add_connected_peer = safeWasmCall(
     () => wasm.add_connected_peer(...arguments),
     'add_connected_peer',
     ['peerId']
   );

   window.safeWasm.get_app_config = safeWasmCall(
     () => wasm.get_app_config(),
     'get_app_config',
     []
   );

   window.safeWasm.get_app_state = safeWasmCall(
     () => wasm.get_app_state(),
     'get_app_state',
     []
   );

   // ... continue for all 77 functions
   ```

4. **VERIFY** each proxy has:
   - Correct function name
   - Proper argument passing
   - Error handling via safeWasmCall

5. **TEST** availability:
   ```javascript
   // In browser console, verify all functions exist:
   console.log(Object.keys(window.safeWasm).length); // Should be 77+
   ```

## Validation Tests

### ⚠️ CRITICAL: Run these tests IN ORDER. STOP if any fail.

### 1. Build Test
```bash
npm run build-wasm  # MUST succeed with no errors
npm run build       # MUST succeed with no errors
```

### 2. Function Availability Test
```javascript
// In browser console:
typeof window.safeWasm.generate_uuid === 'function'  // MUST be true
typeof window.safeWasm.get_room_from_url === 'function'  // MUST be true
window.safeWasm.generate_uuid()  // MUST return valid UUID string
```

### 3. Integration Test
- Create a new room
- Share room link
- Open in new browser
- Verify auto-join works

### 4. Automated Test Script
Save as `MIGRATION/TEST-SCRIPTS/test-phase-1.js`:
```javascript
// Test Phase 1 completion
console.log('Testing Phase 1 Bug Fixes...');

// Test 1: UUID Generation
try {
  const uuid = window.safeWasm.generate_uuid();
  console.assert(uuid && uuid.length === 36, 'UUID format incorrect');
  console.log('✅ UUID generation working');
} catch (e) {
  console.error('❌ UUID generation failed:', e);
}

// Test 2: URL Functions
try {
  // Set a test room in URL
  window.history.pushState({}, '', '?room=test-room-123');
  const roomId = window.safeWasm.get_room_from_url();
  console.assert(roomId === 'test-room-123', 'URL parsing failed');
  console.log('✅ URL parsing working');
} catch (e) {
  console.error('❌ URL parsing failed:', e);
}

// Test 3: Function availability
const expectedFunctions = 77;
const actualFunctions = Object.keys(window.safeWasm).length;
console.assert(actualFunctions >= expectedFunctions,
  `Expected ${expectedFunctions} functions, found ${actualFunctions}`);
console.log(`✅ ${actualFunctions} WASM functions available`);

console.log('Phase 1 tests complete!');
```

## Success Criteria

### ✅ ALL must be true:
- [ ] UUID generation returns valid UUID strings
- [ ] URL parsing handles special characters correctly
- [ ] All 77 WASM functions accessible via window.safeWasm
- [ ] Zero console errors during normal operation
- [ ] Room creation and joining works properly
- [ ] Build completes without errors
- [ ] Test script passes all checks

## Common Issues & Solutions

### Issue: "wasm is not defined"
**Solution**: Ensure WASM module is loaded before creating proxies

### Issue: UUID returns undefined
**Solution**: Check Rust function returns String, not Option<String>

### Issue: URL parsing returns corrupted data
**Solution**: Ensure proper UTF-8 encoding in Rust

### Issue: Functions exist but throw errors
**Solution**: Check argument count and types in proxy definitions

## Rollback Procedure

If Phase 1 fails and cannot be fixed:

```bash
# Revert changes
git checkout -- js/state.js
git checkout -- js/wasm-manager.js
git checkout -- src/utils.rs

# Rebuild
npm run build-wasm && npm run build

# Verify original functionality works
npm start
```

## Next Steps

Once all success criteria are met:
```bash
# Proceed to Phase 2
cat MIGRATION/PHASE-2-VALIDATION.md
```

---

⚠️ **CRITICAL**: Do not proceed to Phase 2 until ALL tests pass and success criteria are met.