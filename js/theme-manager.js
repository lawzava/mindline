/**
 * Theme Manager
 * Handles light/dark theme switching and persistence
 */

import logger from './logger.js';

/**
 * Toggle between light and dark themes
 */
export function toggleTheme() {
  // Toggle on both documentElement and body for consistency
  document.documentElement.classList.toggle('dark');
  document.body.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');

  // Update icon visibility for both desktop and mobile
  updateThemeIcons(isDark);

  logger.debug('Theme toggled to:', isDark ? 'dark' : 'light');
}

/**
 * Initialize theme based on user preference
 */
export function initializeTheme() {
  // Check for saved theme preference or default to system preference
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  let shouldUseDark = false;
  if (savedTheme === 'dark') {
    shouldUseDark = true;
  } else if (savedTheme === 'light') {
    shouldUseDark = false;
  } else {
    // No saved preference, use system preference
    shouldUseDark = prefersDark;
  }

  // Apply theme
  if (shouldUseDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }

  // Update icons
  updateThemeIcons(shouldUseDark);

  // Save the initial theme if it wasn't explicitly set
  if (!savedTheme) {
    localStorage.setItem('theme', shouldUseDark ? 'dark' : 'light');
  }

  logger.debug('Theme initialized:', shouldUseDark ? 'dark' : 'light');
}

/**
 * Update theme toggle icons visibility
 * @param {boolean} isDark - Whether dark theme is active
 */
function updateThemeIcons(isDark) {
  // Update desktop icons
  const sunIcon = document.getElementById('sunIcon');
  const moonIcon = document.getElementById('moonIcon');

  if (sunIcon && moonIcon) {
    if (isDark) {
      moonIcon.classList.add('hidden');
      sunIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    }
  }

  // Update mobile icons
  const sunIconMobile = document.getElementById('sunIconMobile');
  const moonIconMobile = document.getElementById('moonIconMobile');

  if (sunIconMobile && moonIconMobile) {
    if (isDark) {
      moonIconMobile.classList.add('hidden');
      sunIconMobile.classList.remove('hidden');
    } else {
      sunIconMobile.classList.add('hidden');
      moonIconMobile.classList.remove('hidden');
    }
  }
}

/**
 * Get current theme
 * @returns {string} 'light' or 'dark'
 */
export function getCurrentTheme() {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Set theme explicitly
 * @param {string} theme - 'light' or 'dark'
 */
export function setTheme(theme) {
  const isDark = theme === 'dark';

  if (isDark) {
    document.documentElement.classList.add('dark');
    document.body.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
    document.body.classList.remove('dark');
  }

  localStorage.setItem('theme', theme);
  updateThemeIcons(isDark);

  logger.debug('Theme set to:', theme);
}

// Global function for HTML onclick handlers
window.toggleTheme = toggleTheme;