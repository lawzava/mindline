# Phase 0: Pre-Migration Preparation

## 🤖 AI Agent Execution Instructions

**If you are an AI agent, follow these instructions EXACTLY:**

1. **READ THIS ENTIRE FILE** before starting any work
2. **EXECUTE EACH NUMBERED STEP** in the exact order given
3. **COPY AND RUN** each command block exactly as shown
4. **CHECK EACH CHECKBOX** only when that item is verified complete
5. **STOP IMMEDIATELY** if any command fails or test doesn't pass
6. **DO NOT PROCEED** to Phase 1 until ALL checkboxes are checked

### Execution Command:
```bash
# You should execute this phase step by step
# Start with Task 1, then 2, then 3, etc.
# After completing all tasks, verify all checkboxes are checked
# Only then proceed to: cat MIGRATION/PHASE-1-BUG-FIXES.md
```

## Goal
Ensure the codebase is ready for migration with proper backups, working builds, and baseline metrics.

## Duration
1 day

## Prerequisites
- Git repository with clean working tree
- Node.js and npm installed
- Rust and cargo installed
- All current features working

## Tasks

### 1. Create Complete Backup

```bash
# Step 1: Commit any pending changes
git add .
git commit -m "Pre-migration checkpoint"

# Step 2: Create migration branch
git checkout -b migration/js-to-rust

# Step 3: Create physical backup
tar -czf ../mindline-backup-$(date +%Y%m%d-%H%M%S).tar.gz .

# Step 4: Verify backup
ls -lh ../mindline-backup-*.tar.gz
```

### 2. Document Current State

```bash
# Step 1: Record current metrics
echo "=== Pre-Migration Metrics ===" > MIGRATION/baseline-metrics.txt
echo "Date: $(date)" >> MIGRATION/baseline-metrics.txt
echo "" >> MIGRATION/baseline-metrics.txt

# Step 2: Bundle size
echo "Bundle Sizes:" >> MIGRATION/baseline-metrics.txt
du -sh dist/* >> MIGRATION/baseline-metrics.txt 2>/dev/null || echo "No dist folder yet" >> MIGRATION/baseline-metrics.txt
echo "" >> MIGRATION/baseline-metrics.txt

# Step 3: Line counts
echo "JavaScript Lines of Code:" >> MIGRATION/baseline-metrics.txt
find js -name "*.js" -exec wc -l {} + | tail -1 >> MIGRATION/baseline-metrics.txt
echo "" >> MIGRATION/baseline-metrics.txt

echo "Rust Lines of Code:" >> MIGRATION/baseline-metrics.txt
find src -name "*.rs" -exec wc -l {} + | tail -1 >> MIGRATION/baseline-metrics.txt
echo "" >> MIGRATION/baseline-metrics.txt

# Step 4: Dependencies
echo "NPM Dependencies:" >> MIGRATION/baseline-metrics.txt
npm list --depth=0 | wc -l >> MIGRATION/baseline-metrics.txt

# Step 5: View metrics
cat MIGRATION/baseline-metrics.txt
```

### 3. Verify Build System

```bash
# Step 1: Clean build
rm -rf dist pkg target

# Step 2: Build WASM
npm run build-wasm
# MUST succeed with no errors

# Step 3: Build JavaScript
npm run build
# MUST succeed with no errors

# Step 4: Start dev server
npm start
# Open http://localhost:8080
# Verify app loads without console errors
```

### 4. Test All Current Features

**Manual Testing Checklist:**
- [ ] Create a new room
- [ ] Copy room link
- [ ] Join room from another browser/tab
- [ ] Send messages between users
- [ ] See typing indicators
- [ ] Change username
- [ ] Room persists after refresh
- [ ] Messages persist after refresh
- [ ] Dark/light theme toggle works
- [ ] No console errors during any action

### 5. Setup Test Environment

```bash
# Step 1: Install test dependencies (if needed)
npm install --save-dev playwright

# Step 2: Create test output directory
mkdir -p MIGRATION/test-results

# Step 3: Run existing E2E test
npm run test:e2e
# Should pass without errors
```

### 6. Document Known Issues

Create a file `MIGRATION/known-issues.txt` with any current problems:

```bash
cat > MIGRATION/known-issues.txt << 'EOF'
# Known Issues Before Migration
# Date: $(date)

## Functional Issues
- [ ] Issue description here

## Performance Issues
- [ ] Issue description here

## Console Warnings
- [ ] Warning description here

EOF
```

### 7. Create Migration Tracking

```bash
# Create progress tracker
cat > MIGRATION/progress.md << 'EOF'
# Migration Progress Tracker

## Phase Status
- [ ] Phase 0: Preparation
- [ ] Phase 1: Bug Fixes
- [ ] Phase 2: Validation
- [ ] Phase 3: State Management
- [ ] Phase 4: Business Logic
- [ ] Phase 5: Rust Features
- [ ] Phase 6: Cleanup
- [ ] Phase 7: WebRTC

## Notes
- Started: $(date)
- Completed: TBD

EOF
```

## Validation Checklist

### ✅ MUST be true before proceeding:
- [ ] Git repository on migration branch
- [ ] Physical backup created
- [ ] Current metrics documented
- [ ] Build system working (WASM + JS)
- [ ] All features tested and working
- [ ] No critical console errors
- [ ] E2E tests passing
- [ ] Known issues documented

### 🔴 STOP if any of these are true:
- [ ] Build failures exist
- [ ] Critical features broken
- [ ] Tests failing
- [ ] Working on main/master branch
- [ ] No backup created

## Success Criteria

You are ready to proceed to Phase 1 when:
1. All validation checkboxes are checked ✅
2. Baseline metrics are recorded
3. A full backup exists
4. You're on a feature branch
5. The application is fully functional

## Next Steps

Once Phase 0 is complete:
```bash
# Move to Phase 1
cat MIGRATION/PHASE-1-BUG-FIXES.md
```

## Rollback Plan

If you need to abort the migration:
```bash
# Option 1: Git rollback
git checkout main
git branch -D migration/js-to-rust

# Option 2: Restore from backup
cd ..
tar -xzf mindline-backup-[timestamp].tar.gz
```

---

⚠️ **IMPORTANT**: Do not proceed to Phase 1 until ALL items in this phase are complete and verified.