// ============================================================
// Save Research — Chat FAB (Content Script)
// ============================================================
// Injects a floating action button into every page.
// Uses Shadow DOM to avoid style conflicts with host page.

(() => {
  // Guard against multiple injections
  if (window.__saveResearchChatFab) return;
  window.__saveResearchChatFab = true;

  let hostEl = null;
  let shadowRoot = null;
  let isPanelOpen = false;
  let selectedText = '';

  // --- SVG Icons ---
  const CHAT_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
  const CLOSE_ICON = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  function createFab() {
    if (hostEl) return;

    hostEl = document.createElement('div');
    hostEl.id = 'sr-chat-fab-host';
    shadowRoot = hostEl.attachShadow({ mode: 'closed' });

    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          bottom: 24px;
          right: 24px;
          z-index: 2147483646;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          pointer-events: auto;
        }
        .fab-container {
          position: relative;
        }
        .fab {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: #0d9488;
          color: #fff;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .fab:hover {
          transform: scale(1.08);
          box-shadow: 0 6px 20px rgba(0,0,0,0.3);
        }
        .fab:active {
          transform: scale(0.95);
        }
        .selection-tooltip {
          position: absolute;
          bottom: 56px;
          right: 0;
          background: #1a1a2e;
          color: #e0e0e0;
          font-size: 12px;
          padding: 6px 10px;
          border-radius: 6px;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          opacity: 0;
          transform: translateY(4px);
          transition: opacity 0.15s ease, transform 0.15s ease;
          pointer-events: none;
        }
        .selection-tooltip.visible {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
          cursor: pointer;
        }
      </style>
      <div class="fab-container">
        <div class="selection-tooltip">Ask about selection</div>
        <button class="fab" aria-label="Open chat panel">${CHAT_ICON}</button>
      </div>
    `;

    const fab = shadowRoot.querySelector('.fab');
    const tooltip = shadowRoot.querySelector('.selection-tooltip');

    fab.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'toggle-sidepanel',
        selection: selectedText || '',
      });
    });

    tooltip.addEventListener('click', () => {
      chrome.runtime.sendMessage({
        action: 'toggle-sidepanel',
        selection: selectedText || '',
      });
    });

    document.documentElement.appendChild(hostEl);
  }

  function updateFabIcon(open) {
    isPanelOpen = open;
    if (!shadowRoot) return;
    const fab = shadowRoot.querySelector('.fab');
    if (fab) {
      fab.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
      fab.setAttribute('aria-label', open ? 'Close chat panel' : 'Open chat panel');
    }
  }

  // --- Selection tracking ---
  document.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    selectedText = text;

    if (!shadowRoot) return;
    const tooltip = shadowRoot.querySelector('.selection-tooltip');
    if (tooltip) {
      if (text.length > 0) {
        tooltip.classList.add('visible');
      } else {
        tooltip.classList.remove('visible');
      }
    }
  });

  // --- Messages from background ---
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'sr-chat-panel-state') {
      updateFabIcon(msg.open);
    }
  });

  // --- Init ---
  createFab();
})();
