/**
 * UX Enhancements Module
 * Handles advanced UX features like toasts, sidebar, progressive disclosure, etc.
 */

// Toast notification system
class ToastManager {
  constructor() {
    this.container = document.getElementById('toastContainer');
    this.toasts = new Map();
  }

  show(message, type = 'info', duration = 5000) {
    const id = Date.now().toString();
    const toast = this.createToast(id, message, type);

    this.container.appendChild(toast);
    this.toasts.set(id, toast);

    // Auto remove after duration
    if (duration > 0) {
      setTimeout(() => this.remove(id), duration);
    }

    return id;
  }

  createToast(id, message, type) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.dataset.toastId = id;

    const icons = {
      success: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>`,
      error: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>`,
      warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.732 15.5c-.77.833.192 2.5 1.732 2.5z"></path>`,
      info: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>`
    };

    toast.innerHTML = `
      <div class="toast-content">
        <svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          ${icons[type] || icons.info}
        </svg>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" onclick="toastManager.remove('${id}')" aria-label="Close">
        ×
      </button>
    `;

    return toast;
  }

  remove(id) {
    const toast = this.toasts.get(id);
    if (toast) {
      toast.classList.add('removing');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
        this.toasts.delete(id);
      }, 300);
    }
  }

  clear() {
    this.toasts.forEach((_, id) => this.remove(id));
  }
}

// Sidebar management for mobile
class SidebarManager {
  constructor() {
    this.sidebar = document.getElementById('sidebarContainer');
    this.toggle = document.getElementById('sidebarToggle');
    this.overlay = document.getElementById('sidebarOverlay');
    this.isOpen = false;

    this.bindEvents();
  }

  bindEvents() {
    this.toggle?.addEventListener('click', () => this.toggle());
    this.overlay?.addEventListener('click', () => this.close());

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1024 && this.isOpen) {
        this.close();
      }
    });
  }

  open() {
    this.sidebar?.classList.add('active');
    this.overlay?.classList.add('active');
    this.isOpen = true;
    document.body.style.overflow = 'hidden';
  }

  close() {
    this.sidebar?.classList.remove('active');
    this.overlay?.classList.remove('active');
    this.isOpen = false;
    document.body.style.overflow = '';
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}

// Progressive disclosure management
class DisclosureManager {
  constructor() {
    this.bindEvents();
  }

  bindEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.matches('.disclosure-trigger') || e.target.closest('.disclosure-trigger')) {
        const trigger = e.target.matches('.disclosure-trigger') ? e.target : e.target.closest('.disclosure-trigger');
        this.toggle(trigger);
      }
    });
  }

  toggle(trigger) {
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    const isExpanded = trigger.getAttribute('aria-expanded') === 'true';

    trigger.setAttribute('aria-expanded', !isExpanded);
    panel?.classList.toggle('expanded');
  }
}

// Loading states manager
class LoadingManager {
  static setButtonLoading(button, loading = true) {
    if (loading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  static createSkeleton(container, count = 3) {
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton-card mb-4';
      skeleton.innerHTML = `
        <div class="skeleton skeleton-text large mb-2"></div>
        <div class="skeleton skeleton-text mb-2"></div>
        <div class="skeleton skeleton-text small"></div>
      `;
      container.appendChild(skeleton);
    }
  }

  static removeSkeleton(container) {
    const skeletons = container.querySelectorAll('.skeleton-card');
    skeletons.forEach(skeleton => skeleton.remove());
  }
}

// Enhanced message display with actions
class MessageEnhancer {
  static enhanceMessage(messageElement, messageData) {
    messageElement.className = 'message-container ' + messageElement.className;

    // Add message actions
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.innerHTML = `
      <button class="message-action" title="Reply" data-action="reply">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path>
        </svg>
      </button>
      <button class="message-action" title="React" data-action="react">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
      </button>
      <button class="message-action" title="Copy" data-action="copy">
        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
        </svg>
      </button>
    `;

    // Bind action events
    actions.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) {
        MessageEnhancer.handleAction(action, messageData);
      }
    });

    messageElement.appendChild(actions);
    return messageElement;
  }

  static handleAction(action, messageData) {
    switch (action) {
      case 'copy':
        navigator.clipboard.writeText(messageData.content);
        window.toastManager?.show('Message copied to clipboard', 'success', 2000);
        break;
      case 'react':
        // Could implement emoji reactions here
        window.toastManager?.show('Reactions coming soon!', 'info', 2000);
        break;
      case 'reply':
        // Could implement threaded replies here
        window.toastManager?.show('Replies coming soon!', 'info', 2000);
        break;
    }
  }
}

// FAB (Floating Action Button) manager
class FABManager {
  constructor() {
    this.fab = document.getElementById('quickActionFab');
    this.bindEvents();
    this.updateVisibility();

    // Show FAB when user has joined a room
    window.addEventListener('room-joined', () => this.show());
    window.addEventListener('room-left', () => this.hide());
  }

  bindEvents() {
    this.fab?.addEventListener('click', () => {
      // Quick actions menu could be implemented here
      window.toastManager?.show('Quick actions menu coming soon!', 'info', 2000);
    });
  }

  show() {
    if (this.fab) {
      this.fab.style.display = 'flex';
    }
  }

  hide() {
    if (this.fab) {
      this.fab.style.display = 'none';
    }
  }

  updateVisibility() {
    // Show FAB based on current state
    const currentRoom = localStorage.getItem('currentRoomId');
    if (currentRoom) {
      this.show();
    } else {
      this.hide();
    }
  }
}

// Error boundary and enhanced error handling
class ErrorHandler {
  static init() {
    window.addEventListener('error', ErrorHandler.handleError);
    window.addEventListener('unhandledrejection', ErrorHandler.handlePromiseRejection);
  }

  static handleError(event) {
    // Always log errors
    console.error('Global error:', event.error);
    window.toastManager?.show(
      'Something went wrong. Please try again.',
      'error',
      5000
    );
  }

  static handlePromiseRejection(event) {
    // Always log promise rejections
    console.error('Unhandled promise rejection:', event.reason);
    window.toastManager?.show(
      'An unexpected error occurred.',
      'error',
      5000
    );
  }

  static showError(message, error = null) {
    if (error) {
      // Always log errors
      console.error('Error:', error);
    }
    window.toastManager?.show(message, 'error', 5000);
  }

  static showSuccess(message) {
    window.toastManager?.show(message, 'success', 3000);
  }

  static showWarning(message) {
    window.toastManager?.show(message, 'warning', 4000);
  }

  static showInfo(message) {
    window.toastManager?.show(message, 'info', 3000);
  }
}

// Initialize all UX enhancements
export function initializeUXEnhancements() {
  // Create global instances
  window.toastManager = new ToastManager();
  window.sidebarManager = new SidebarManager();
  window.disclosureManager = new DisclosureManager();
  window.fabManager = new FABManager();

  // Initialize error handling
  ErrorHandler.init();

  // Export classes for use in other modules
  window.LoadingManager = LoadingManager;
  window.MessageEnhancer = MessageEnhancer;
  window.ErrorHandler = ErrorHandler;

  // Only log in development
  if (window.MINDLINE_CONFIG && !window.MINDLINE_CONFIG.IS_PRODUCTION) {
    console.log('UX Enhancements initialized');
  }
}

// Auto-initialize when module loads
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initializeUXEnhancements);
}