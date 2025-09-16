#!/usr/bin/env node

/**
 * Script to generate a fix for localStorage corruption
 * Run this and paste the output in browser console
 */

console.log(`
// ============================================
// Mindline Storage Fix
// Copy and paste this entire block into your browser console
// ============================================

(function fixMindlineStorage() {
    console.log('🔧 Starting Mindline storage fix...');

    // Clear all room-related localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('room_') || key.includes('chatHistory_') || key.includes('messages_'))) {
            keysToRemove.push(key);
        }
    }

    console.log('📦 Found', keysToRemove.length, 'room-related keys to clear');
    keysToRemove.forEach(key => {
        console.log('  Removing:', key);
        localStorage.removeItem(key);
    });

    // Clear service worker caches
    if ('caches' in window) {
        caches.keys().then(names => {
            console.log('🗑️ Clearing', names.length, 'caches');
            return Promise.all(names.map(name => {
                console.log('  Deleting cache:', name);
                return caches.delete(name);
            }));
        }).then(() => {
            console.log('✅ All caches cleared');

            // Unregister service worker
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistrations().then(registrations => {
                    console.log('📝 Found', registrations.length, 'service worker(s)');
                    return Promise.all(registrations.map(reg => {
                        console.log('  Unregistering:', reg.scope);
                        return reg.unregister();
                    }));
                }).then(() => {
                    console.log('✅ Service workers unregistered');
                    console.log('');
                    console.log('🎉 Storage fix complete!');
                    console.log('');
                    console.log('👉 Now refresh the page with Cmd+Shift+R (Mac) or Ctrl+F5 (PC)');
                    console.log('   This will load the fixed WASM module.');
                });
            }
        });
    } else {
        console.log('✅ Storage cleared');
        console.log('');
        console.log('🎉 Storage fix complete!');
        console.log('');
        console.log('👉 Now refresh the page with Cmd+Shift+R (Mac) or Ctrl+F5 (PC)');
    }
})();

// ============================================
`);

console.log('\n📋 The fix code has been printed above.');
console.log('📌 Copy everything between the separator lines');
console.log('🌐 Paste it into your browser console at http://localhost:8080');
console.log('♻️ Then hard refresh the page');