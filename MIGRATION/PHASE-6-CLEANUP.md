# Phase 6: Code Cleanup

## 🤖 AI Agent Execution Instructions

**If you are an AI agent, follow these instructions EXACTLY:**

1. **CREATE BACKUP FIRST** - Never delete without backup
2. **VERIFY EACH FILE** - Check files before deletion with diff/grep
3. **TEST AFTER EACH DELETION** - Ensure build still works
4. **USE PROVIDED SCRIPTS** - Copy and run the verification scripts
5. **MEASURE METRICS** - Document bundle size before/after
6. **DO NOT RUSH** - This phase is dangerous, go slowly

### Critical Warning:
```bash
# BEFORE starting ANY cleanup:
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
cp -r . backups/$(date +%Y%m%d_%H%M%S)/
echo "BACKUP CREATED - Safe to proceed"
```

## Goal
Remove all dead code and optimize bundle size

## Prerequisites
- ✅ Phases 1-5 complete
- Application fully migrated to Rust
- All features working correctly

## Tasks

### 6.1 Remove Dead Files

**⚠️ CRITICAL: Verify EACH file before deletion**

**Step 1: Create Full Backup**
```bash
# Create backup directory with timestamp
mkdir -p backups/$(date +%Y%m%d_%H%M%S)
cp -r . backups/$(date +%Y%m%d_%H%M%S)/
echo "Backup created at: backups/$(date +%Y%m%d_%H%M%S)/"
```

**Step 2: Remove Backup Files**
```bash
# Verify file exists and is a backup
ls -la index_backup.html
# Confirm it's older/duplicate of index.html
diff index.html index_backup.html

# If confirmed as backup, delete:
rm index_backup.html
echo "✅ Deleted: index_backup.html"
```

**Step 3: Remove One-Time Fix Scripts**
```bash
# Check if fix-storage.js is still needed
grep -r "fix-storage" . --exclude-dir=node_modules --exclude-dir=backups
# If no references found:
rm fix-storage.js
echo "✅ Deleted: fix-storage.js"
```

**Step 4: Organize Test Files**
```bash
# Create dev-tests directory
mkdir -p dev-tests

# Move test files (DO NOT delete yet)
mv tests/test-basic.js dev-tests/
mv tests/test-browser-scenario.js dev-tests/
mv tests/test-debug.js dev-tests/
mv tests/test-exact-params.js dev-tests/
mv tests/test-logging.js dev-tests/
mv tests/test-memory-fix.js dev-tests/
mv tests/test-phase3.js dev-tests/
mv tests/test-string-passing.js dev-tests/
mv tests/test_room_id.html dev-tests/
mv tests/test_room_id_local.js dev-tests/

# Keep E2E test in place
echo "⚠️ Keeping: test-mindline-e2e.js (active E2E test)"
```

### 6.2 Remove Dead Dependencies

**Step 1: Verify Dependency Not Used**
```bash
# Search for any usage
grep -r "wasm-pack-plugin" . --exclude-dir=node_modules --exclude-dir=backups
# Should return NO results
```

**Step 2: Uninstall Package**
```bash
npm uninstall @wasm-tool/wasm-pack-plugin
echo "✅ Removed: @wasm-tool/wasm-pack-plugin"
```

**Step 3: Verify Build Still Works**
```bash
npm run build-wasm
npm run build
# MUST succeed without errors
```

### 6.3 Remove Unused Rust Functions

**⚠️ DANGEROUS: Test THOROUGHLY after each removal**

**Step 1: Identify Truly Unused Functions**

Create a script to verify usage:
```javascript
// save as check-wasm-usage.js
const usedFunctions = new Set();
const fs = require('fs');
const path = require('path');

// Scan all JS files for WASM function calls
function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (file.endsWith('.js')) {
      const content = fs.readFileSync(filePath, 'utf8');
      const matches = content.match(/window\.safeWasm\.(\w+)/g);
      if (matches) {
        matches.forEach(match => {
          const func = match.replace('window.safeWasm.', '');
          usedFunctions.add(func);
        });
      }
    }
  });
}

scanDirectory('./js');
console.log('Used functions:', Array.from(usedFunctions).sort());
```

**Step 2: Comment Out Unused Functions First**
```rust
// In relevant Rust files, comment out instead of deleting:
// #[wasm_bindgen]
// pub fn unused_function() {
//     // Commented out - marked for removal
// }
```

**Step 3: Test Thoroughly**
```bash
npm run build-wasm
npm run build
npm start
# Test ALL features in browser
```

**Step 4: Delete Only After Verification**
```rust
// Only delete after 24 hours of testing with no issues
```

### 6.4 Optimize JavaScript Modules

**⚠️ DO NOT delete code - refactor to use Rust**

**Step 1: Analyze js/state.js**
```javascript
// Current: ~200 lines
// Target: ~50 lines (only Rust wrappers)

// KEEP: Export functions that wrap Rust
// REMOVE: AppState object properties
// REMOVE: Direct state manipulation
// REMOVE: Validation logic
```

**Step 2: Reduce js/message-manager.js**
```javascript
// Current: ~470 lines
// Target: ~150 lines (only UI updates)

// KEEP: displayMessage() UI function
// KEEP: updateMessageUI() function
// REMOVE: Message validation
// REMOVE: Storage logic
// REMOVE: Business logic
```

**Step 3: Minimize js/room-manager.js**
```javascript
// Current: ~280 lines
// Target: ~100 lines (only UI coordination)

// KEEP: UI update functions
// KEEP: DOM manipulation
// REMOVE: Room validation
// REMOVE: State management
// REMOVE: Business logic
```

## Verification Steps After EACH Cleanup

**1. Build Verification**
```bash
npm run build-wasm && npm run build
# MUST complete without errors
```

**2. Bundle Size Check**
```bash
# Before cleanup
du -sh dist/bundle.js > before.txt

# After cleanup
du -sh dist/bundle.js > after.txt

# Compare
diff before.txt after.txt
```

**3. Feature Testing Checklist**
- [ ] Create new room
- [ ] Join existing room
- [ ] Send messages
- [ ] Receive messages
- [ ] Typing indicators work
- [ ] Room history displays
- [ ] User can change name
- [ ] P2P connection establishes
- [ ] Messages persist on refresh
- [ ] No console errors

**4. Performance Metrics**
```javascript
// In browser console
console.time('Initial Load');
location.reload();
// After load:
console.timeEnd('Initial Load');
// Should be faster than before
```

## Success Criteria
- [ ] All dead files in backups or removed
- [ ] @wasm-tool/wasm-pack-plugin uninstalled
- [ ] Bundle size reduced by 40%+
- [ ] Load time improved by 30%+
- [ ] All features still working
- [ ] No console errors
- [ ] Test files organized in dev-tests/

## 🔴 ROLLBACK Plan If Issues Occur

```bash
# If ANYTHING breaks:
git status  # Check what changed
git diff    # Review changes

# Rollback specific file:
git checkout -- path/to/file

# Or restore from backup:
cp -r backups/[timestamp]/* .

# Rebuild:
npm run build-wasm && npm run build
```

## Next Step
```bash
# After ALL success criteria are met:
cat MIGRATION/PHASE-7-WEBRTC.md
```

⚠️ **WARNING**: This phase has the highest risk of breaking the application. Take your time and test thoroughly after each change.