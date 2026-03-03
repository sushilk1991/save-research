// ============================================================
// Save Research — Progress Overlay (Content Script)
// ============================================================
// Injected into the active tab to show save progress.
// Uses Shadow DOM to avoid style conflicts with host page.

(() => {
  // Guard against multiple injections
  if (window.__saveResearchProgress) return;
  window.__saveResearchProgress = true;

  let hostEl = null;
  let shadowRoot = null;
  let dismissTimer = null;

  function createOverlay(steps) {
    // Remove existing overlay if present
    if (hostEl) hostEl.remove();

    hostEl = document.createElement('div');
    hostEl.id = 'sr-progress-host';
    shadowRoot = hostEl.attachShadow({ mode: 'closed' });

    const stepListHTML = steps
      .map((label, i) => `<li data-index="${i}" data-status="pending"><span class="icon"></span><span class="label">${label}</span></li>`)
      .join('');

    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 2147483647;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          pointer-events: auto;
        }
        .card {
          background: #1a1a2e;
          color: #e0e0e0;
          border-radius: 10px;
          padding: 14px 16px;
          width: 280px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          transform: translateX(320px);
          opacity: 0;
          animation: slideIn 0.3s ease-out forwards;
        }
        .card.hiding {
          animation: slideOut 0.3s ease-in forwards;
        }
        @keyframes slideIn {
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
          to { transform: translateX(320px); opacity: 0; }
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .title {
          font-weight: 600;
          font-size: 13px;
          color: #fff;
        }
        .close-btn {
          background: none;
          border: none;
          color: #888;
          cursor: pointer;
          font-size: 16px;
          padding: 0 0 0 8px;
          line-height: 1;
        }
        .close-btn:hover { color: #fff; }
        ul {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        li {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          color: #666;
          transition: color 0.2s;
        }
        li[data-status="active"] { color: #e0e0e0; }
        li[data-status="done"]   { color: #4ade80; }
        li[data-status="error"]  { color: #f87171; }
        li[data-status="skip"]   { color: #666; }
        .icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }
        /* Pending — hollow circle */
        li[data-status="pending"] .icon::after {
          content: '';
          width: 10px;
          height: 10px;
          border: 1.5px solid #555;
          border-radius: 50%;
        }
        /* Active — spinner */
        li[data-status="active"] .icon::after {
          content: '';
          width: 10px;
          height: 10px;
          border: 2px solid #555;
          border-top-color: #818cf8;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        /* Done — green check */
        li[data-status="done"] .icon::after {
          content: '\\2713';
          font-size: 13px;
          font-weight: 700;
        }
        /* Error — red X */
        li[data-status="error"] .icon::after {
          content: '\\2717';
          font-size: 13px;
          font-weight: 700;
        }
        /* Skip — gray dash */
        li[data-status="skip"] .icon::after {
          content: '\\2013';
          font-size: 13px;
        }
        .error-footer {
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px solid #333;
          color: #f87171;
          font-size: 12px;
          display: none;
        }
        .error-footer.visible { display: block; }
      </style>
      <div class="card">
        <div class="header">
          <span class="title">Saving...</span>
          <button class="close-btn" aria-label="Close">&times;</button>
        </div>
        <ul>${stepListHTML}</ul>
        <div class="error-footer"></div>
      </div>
    `;

    shadowRoot.querySelector('.close-btn').addEventListener('click', () => {
      hideOverlay();
    });

    document.documentElement.appendChild(hostEl);
  }

  function updateStep(index, status, detail) {
    if (!shadowRoot) return;
    const li = shadowRoot.querySelector(`li[data-index="${index}"]`);
    if (!li) return;
    li.setAttribute('data-status', status);
    if (detail) {
      li.querySelector('.label').textContent = detail;
    }
  }

  function showDone() {
    if (!shadowRoot) return;
    const title = shadowRoot.querySelector('.title');
    if (title) title.textContent = 'Saved!';
    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => hideOverlay(), 3000);
  }

  function showError(message) {
    if (!shadowRoot) return;
    const title = shadowRoot.querySelector('.title');
    if (title) title.textContent = 'Save Failed';
    const footer = shadowRoot.querySelector('.error-footer');
    if (footer) {
      footer.textContent = message || 'An error occurred';
      footer.classList.add('visible');
    }
  }

  function hideOverlay() {
    clearTimeout(dismissTimer);
    if (!shadowRoot) return;
    const card = shadowRoot.querySelector('.card');
    if (card) {
      card.classList.add('hiding');
      card.addEventListener('animationend', () => {
        if (hostEl) {
          hostEl.remove();
          hostEl = null;
          shadowRoot = null;
        }
      }, { once: true });
    } else {
      if (hostEl) {
        hostEl.remove();
        hostEl = null;
        shadowRoot = null;
      }
    }
  }

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action !== 'sr-progress') return;

    switch (msg.type) {
      case 'init':
        createOverlay(msg.steps);
        break;
      case 'update':
        updateStep(msg.stepIndex, msg.status, msg.detail);
        break;
      case 'done':
        showDone();
        break;
      case 'error':
        showError(msg.message);
        break;
    }
  });
})();
