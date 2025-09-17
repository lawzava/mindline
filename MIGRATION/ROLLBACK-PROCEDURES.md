# Rollback Procedures

## Emergency Rollback Guide

This document provides step-by-step rollback procedures for each migration phase.

## General Rollback Principles

1. **STOP immediately** when issues are detected
2. **Document the issue** before rolling back
3. **Use git for clean rollback** when possible
4. **Test after rollback** to ensure stability
5. **Keep backups** until migration is complete

## Quick Rollback Commands

### Instant Rollback (Any Phase)
```bash
# Check what changed
git status
git diff

# Rollback ALL changes
git stash
git checkout main

# Or rollback specific files
git checkout -- path/to/file

# Rebuild
npm run build-wasm && npm run build
npm start
```

### Restore from Backup
```bash
# If git rollback isn't sufficient
cd ..
cp -r mindline mindline-broken
tar -xzf mindline-backup-[timestamp].tar.gz
cd mindline
npm install
npm run build-wasm && npm run build
```

## Phase-Specific Rollbacks

### Phase 1: Bug Fixes
```bash
# Revert UUID changes
git checkout -- js/state.js
git checkout -- src/utils.rs

# Revert WASM proxy changes
git checkout -- js/wasm-manager.js

# Clean and rebuild
rm -rf pkg target dist
npm run build-wasm && npm run build
```

### Phase 2: Validation
```bash
# Restore validation functions
git checkout -- js/room-manager.js
git checkout -- js/message-manager.js
git checkout -- js/user-manager.js
git checkout -- js/event-handlers.js

# Rebuild
npm run build
```

### Phase 3: State Management
```bash
# Critical - restore state files
git checkout -- js/state.js
git checkout -- js/app-state.js

# Restore all state references
git checkout -- js/app.js
git checkout -- js/room-manager.js
git checkout -- js/message-manager.js
git checkout -- js/user-manager.js
git checkout -- js/p2p-manager.js

# Clear localStorage (state might be corrupted)
# In browser console:
localStorage.clear()

# Rebuild
npm run build
```

### Phase 4: Business Logic
```bash
# Restore business logic files
git checkout -- js/message-manager.js
git checkout -- js/room-manager.js
git checkout -- js/user-manager.js

# Rebuild
npm run build
```

### Phase 5: Rust Features
```bash
# Usually just disabling features
# Update js files to not use advanced features
git checkout -- js/*.js

# Rebuild
npm run build
```

### Phase 6: Cleanup
```bash
# Restore deleted files from backup
cp ../mindline-backup-*/index_backup.html .
cp ../mindline-backup-*/fix-storage.js .
cp -r ../mindline-backup-*/tests .

# Reinstall removed dependencies
npm install @wasm-tool/wasm-pack-plugin

# Restore Rust functions (if commented/deleted)
git checkout -- src/*.rs

# Rebuild everything
npm run build-wasm && npm run build
```

### Phase 7: WebRTC
```bash
# Restore WebRTC handling
git checkout -- js/webrtc.js
git checkout -- js/p2p-manager.js

# Rebuild
npm run build
```

## Diagnostic Commands

### Check What's Broken
```bash
# Check build errors
npm run build-wasm 2>&1 | tee build-errors.log
npm run build 2>&1 | tee webpack-errors.log

# Check browser console
# Open Developer Tools > Console
# Look for red errors

# Check network tab
# Open Developer Tools > Network
# Look for failed requests

# Check WASM loading
# In browser console:
console.log(window.safeWasm);
```

### Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "wasm is not defined" | Rebuild WASM: `npm run build-wasm` |
| "Cannot read property of undefined" | State corrupted, clear localStorage |
| "Module not found" | Run `npm install` |
| Blank screen | Check browser console, rebuild all |
| Messages not sending | Check P2P connection, rollback Phase 4 |
| Room join fails | Rollback Phase 2 validation changes |

## Nuclear Option: Full Reset

If nothing else works:

```bash
# Save any important data
cp -r . ../mindline-attempt-backup

# Complete reset to original
cd ..
rm -rf mindline
tar -xzf mindline-backup-[ORIGINAL-TIMESTAMP].tar.gz
cd mindline

# Fresh install and build
npm install
npm run build-wasm
npm run build
npm start
```

## Prevention Tips

1. **Test after EVERY change** - Don't batch changes
2. **Commit working states** - Use git commits as checkpoints
3. **Keep console open** - Watch for errors in real-time
4. **Use separate branch** - Never work on main
5. **Document issues** - Note what caused the problem

## Getting Help

If rollback fails:

1. Check git history: `git log --oneline -20`
2. Find last working commit: `git checkout [commit-hash]`
3. Compare with backup: `diff -r . ../mindline-backup-*/`
4. Check MIGRATION/known-issues.txt for similar problems

## Recovery Verification

After any rollback, verify:

- [ ] Build completes without errors
- [ ] App loads without console errors
- [ ] Can create rooms
- [ ] Can join rooms
- [ ] Messages send/receive
- [ ] State persists on refresh
- [ ] No visual glitches

---

⚠️ **Remember**: It's better to rollback early than to compound problems. If something feels wrong, STOP and assess.