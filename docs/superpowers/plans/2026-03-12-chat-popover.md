# Chat Popover Side Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-side chat panel to the Save Research extension that lets users chat with page content via Ollama, with special YouTube transcript support.

**Architecture:** Chrome Side Panel API for the chat UI, content scripts for FAB injection and page content extraction via Defuddle, background.js as message relay. Ollama `/api/chat` with streaming for real-time responses.

**Tech Stack:** Chrome Extensions MV3 (Side Panel API), Defuddle (content extraction), Ollama API (LLM chat), vanilla JS, Shadow DOM

---

## File Structure

```
save-research/
├── manifest.json           # MODIFY — add sidePanel permission, content scripts, web-accessible resources
├── background.js           # MODIFY — add message relay handlers for chat, side panel open/close
├── sidepanel.html          # CREATE — side panel HTML shell
├── sidepanel.css           # CREATE — side panel styles
├── sidepanel.js            # CREATE — chat logic, Ollama streaming, message rendering
├── chat-fab.js             # CREATE — content script, FAB injection via Shadow DOM
├── chat-content.js         # CREATE — content script, Defuddle extraction + selection handling
└── lib/
    └── defuddle.js         # CREATE — download Defuddle browser bundle from unpkg
```

---

## Chunk 1: Foundation — Manifest, Defuddle, and FAB

### Task 1: Download Defuddle and update manifest.json

**Files:**
- Create: `lib/defuddle.js`
- Modify: `manifest.json`

- [ ] **Step 1: Create lib/ directory and download Defuddle browser bundle**

```bash
mkdir -p lib
curl -o lib/defuddle.js "https://unpkg.com/defuddle@0.12.0/dist/defuddle.js"
```

Verify the file downloaded and is ~67KB.

- [ ] **Step 2: Update manifest.json — add sidePanel permission, content scripts, side panel config, web-accessible resources**

Replace the entire `manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "Save Research",
  "version": "1.1.0",
  "description": "Save images, links, videos, and pages to dedicated folders with one right-click",
  "permissions": [
    "contextMenus",
    "downloads",
    "storage",
    "activeTab",
    "notifications",
    "scripting",
    "sidePanel"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "options_ui": {
    "page": "options.html",
    "open_in_tab": true
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["chat-fab.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["lib/defuddle.js"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

Key changes from current manifest:
- Added `"sidePanel"` to permissions
- Added `"side_panel"` config pointing to `sidepanel.html`
- Added `content_scripts` entry for `chat-fab.js` on all URLs
- Added `web_accessible_resources` for Defuddle library
- Bumped version to 1.1.0

- [ ] **Step 3: Commit**

```bash
git add manifest.json lib/defuddle.js
git commit -m "feat: add Defuddle library and update manifest for side panel chat"
```

---

### Task 2: Create the FAB content script (chat-fab.js)

**Files:**
- Create: `chat-fab.js`

- [ ] **Step 1: Create chat-fab.js — Shadow DOM FAB with selection awareness**

Create `chat-fab.js`:

```javascript
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

  // Hide tooltip on click elsewhere
  document.addEventListener('mousedown', (e) => {
    if (hostEl && !hostEl.contains(e.target)) {
      // Will be handled by mouseup — selection may change
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
```

- [ ] **Step 2: Verify FAB injection manually**

1. Load the unpacked extension in Chrome (`chrome://extensions` → Load unpacked)
2. Open any webpage
3. Verify the teal circular FAB appears at bottom-right
4. Hover over FAB — verify scale-up animation
5. Select text on the page — verify "Ask about selection" tooltip appears above FAB

- [ ] **Step 3: Commit**

```bash
git add chat-fab.js
git commit -m "feat: add floating action button content script with selection awareness"
```

---

## Chunk 2: Content Extraction (chat-content.js)

### Task 3: Create the content extraction script

**Files:**
- Create: `chat-content.js`

This script is NOT a content script in the manifest. It's injected on-demand by background.js via `chrome.scripting.executeScript` when the side panel needs page content. This avoids loading Defuddle on every page load.

- [ ] **Step 1: Create chat-content.js — on-demand page content extractor**

Create `chat-content.js`:

```javascript
// ============================================================
// Save Research — Chat Content Extractor
// ============================================================
// Injected on-demand by background.js to extract page content.
// Uses Defuddle for general pages, custom logic for YouTube.

(() => {
  // Detect page type
  function detectPageType() {
    const hostname = window.location.hostname;
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(hostname)) {
      return 'youtube';
    }
    if (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(hostname)) {
      return 'twitter';
    }
    return 'page';
  }

  // --- YouTube extraction ---
  function extractYouTube() {
    const pr = window.ytInitialPlayerResponse;
    if (!pr) return null;

    const vd = pr.videoDetails || {};
    const mic = pr.microformat?.playerMicroformatRenderer || {};

    const captionTracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const captionTrack = captionTracks.find(t => t.languageCode === 'en' && !t.kind)
                      || captionTracks.find(t => t.languageCode === 'en')
                      || captionTracks[0];

    return {
      type: 'youtube',
      title: vd.title || document.title,
      channel: vd.author || '',
      duration: parseInt(vd.lengthSeconds || '0', 10),
      description: vd.shortDescription || '',
      viewCount: vd.viewCount || '',
      publishDate: mic.publishDate || mic.uploadDate || '',
      captionTrackUrl: captionTrack?.baseUrl || '',
      url: window.location.href,
    };
  }

  // --- Twitter extraction ---
  function extractTwitter() {
    const tweets = [];
    const tweetEls = document.querySelectorAll('[data-testid="tweet"]');

    for (const el of tweetEls) {
      const nameEl = el.querySelector('[data-testid="User-Name"]');
      const textEl = el.querySelector('[data-testid="tweetText"]');
      const timeEl = el.querySelector('time');

      let text = '';
      if (textEl) {
        for (const node of textEl.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
          else if (node.tagName === 'IMG') text += node.alt || '';
          else if (node.tagName === 'BR') text += '\n';
          else text += node.textContent || '';
        }
      }

      tweets.push({
        author: nameEl?.textContent?.trim() || '',
        text: text.trim(),
        time: timeEl?.getAttribute('datetime') || '',
      });
    }

    return {
      type: 'twitter',
      title: document.title,
      tweets,
      url: window.location.href,
    };
  }

  // --- General page extraction via Defuddle ---
  // Defuddle is loaded separately; this function is called after it's available
  function extractGeneral() {
    try {
      if (typeof Defuddle !== 'undefined') {
        const result = new Defuddle(document).parse();
        return {
          type: 'page',
          title: result.title || document.title,
          author: result.author || '',
          content: result.content || document.body.innerText,
          url: window.location.href,
          domain: result.domain || window.location.hostname,
          wordCount: result.wordCount || 0,
        };
      }
    } catch (err) {
      console.warn('[Save Research] Defuddle extraction failed:', err.message);
    }

    // Fallback: raw text extraction
    return {
      type: 'page',
      title: document.title,
      author: '',
      content: document.body.innerText.substring(0, 100000),
      url: window.location.href,
      domain: window.location.hostname,
      wordCount: 0,
    };
  }

  // --- Main extraction logic ---
  const pageType = detectPageType();
  let result;

  if (pageType === 'youtube') {
    result = extractYouTube();
    if (!result) {
      // Fallback to general extraction if YouTube data unavailable
      result = extractGeneral();
    }
  } else if (pageType === 'twitter') {
    result = extractTwitter();
    if (!result.tweets || result.tweets.length === 0) {
      result = extractGeneral();
    }
  } else {
    result = extractGeneral();
  }

  // Truncate content to ~100K chars to stay within Ollama context limits
  if (result.content && result.content.length > 100000) {
    result.content = result.content.substring(0, 100000) + '\n\n[Content truncated...]';
  }

  // Return result to the caller (chrome.scripting.executeScript)
  result;
})();
```

- [ ] **Step 2: Commit**

```bash
git add chat-content.js
git commit -m "feat: add on-demand content extraction script with YouTube/Twitter/Defuddle support"
```

---

## Chunk 3: Background.js Message Relay

### Task 4: Add chat message handlers to background.js

**Files:**
- Modify: `background.js:1904-1995` (add new message handlers and side panel logic)

- [ ] **Step 1: Add side panel state tracking and new message handlers to background.js**

Add the following code BEFORE the existing `chrome.runtime.onInstalled.addListener` block (i.e., insert at approximately line 1903, before the event listeners section):

```javascript
// --- Chat Side Panel Helpers ---

let _sidePanelOpenTabId = null;

async function openSidePanel(tabId) {
  try {
    await chrome.sidePanel.open({ tabId });
    _sidePanelOpenTabId = tabId;
    chrome.tabs.sendMessage(tabId, { action: 'sr-chat-panel-state', open: true }).catch(() => {});
  } catch (err) {
    console.warn('[Save Research] Could not open side panel:', err.message);
  }
}

async function closeSidePanel(tabId) {
  try {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    // Re-enable for future use
    await chrome.sidePanel.setOptions({ tabId, enabled: true });
    _sidePanelOpenTabId = null;
    chrome.tabs.sendMessage(tabId, { action: 'sr-chat-panel-state', open: false }).catch(() => {});
  } catch (err) {
    console.warn('[Save Research] Could not close side panel:', err.message);
  }
}

async function extractPageContent(tabId) {
  try {
    // First inject Defuddle into the MAIN world so it's available to the page
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['lib/defuddle.js'],
    });
  } catch (err) {
    console.warn('[Save Research] Could not inject Defuddle:', err.message);
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['chat-content.js'],
    });
    return results?.[0]?.result || null;
  } catch (err) {
    console.error('[Save Research] Content extraction failed:', err);
    return null;
  }
}

async function fetchYouTubeTranscript(captionTrackUrl, tabId) {
  if (!captionTrackUrl) return null;
  const transcriptUrl = captionTrackUrl + '&fmt=json3';

  try {
    let json3;
    if (tabId) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: async (url) => {
          const r = await fetch(url);
          if (!r.ok) return null;
          return r.json();
        },
        args: [transcriptUrl],
      });
      json3 = results?.[0]?.result;
    } else {
      const resp = await fetch(transcriptUrl, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      json3 = await resp.json();
    }

    if (!json3?.events) return null;

    // Format transcript with timestamps
    const lines = [];
    for (const evt of json3.events) {
      if (!evt.segs) continue;
      const text = evt.segs.map(s => s.utf8 || '').join('').trim();
      if (!text) continue;
      const secs = Math.floor((evt.tStartMs || 0) / 1000);
      const mm = String(Math.floor(secs / 60)).padStart(2, '0');
      const ss = String(secs % 60).padStart(2, '0');
      lines.push(`[${mm}:${ss}] ${text}`);
    }
    return lines.join('\n');
  } catch (err) {
    console.warn('[Save Research] Chat transcript fetch failed:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Add message handlers for chat actions inside the existing `chrome.runtime.onMessage.addListener` callback**

Add these handlers inside the existing `chrome.runtime.onMessage.addListener` block in `background.js`, BEFORE the closing `});` of that listener (after the `testOllama` handler, around line 1993):

```javascript
  if (msg.action === 'toggle-sidepanel') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      if (_sidePanelOpenTabId === tab.id) {
        await closeSidePanel(tab.id);
      } else {
        await openSidePanel(tab.id);
      }
    })();
    return false; // no async response needed
  }

  if (msg.action === 'extract-page-content') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      const content = await extractPageContent(tab.id);
      if (content && content.type === 'youtube' && content.captionTrackUrl) {
        content.transcript = await fetchYouTubeTranscript(content.captionTrackUrl, tab.id);
      }
      sendResponse({ ok: true, data: content });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'chat-with-ollama') {
    (async () => {
      const settings = await getSettings();
      const ai = settings.ai;
      if (!ai.ollamaUrl) {
        sendResponse({ ok: false, error: 'Ollama URL not configured' });
        return;
      }
      // For streaming, we return a port-based connection instead
      // But since side panel can call Ollama directly (it's a local URL),
      // we just return the settings so the side panel can make the call
      sendResponse({
        ok: true,
        ollamaUrl: ai.ollamaUrl,
        model: ai.model,
      });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'get-ollama-settings') {
    (async () => {
      const settings = await getSettings();
      sendResponse({
        ok: true,
        ollamaUrl: settings.ai.ollamaUrl,
        model: settings.ai.model,
      });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'get-selection') {
    // Relay to content script in active tab
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        sendResponse({ ok: false, selection: '' });
        return;
      }
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => window.getSelection()?.toString()?.trim() || '',
        });
        sendResponse({ ok: true, selection: results?.[0]?.result || '' });
      } catch {
        sendResponse({ ok: true, selection: '' });
      }
    })().catch(() => sendResponse({ ok: true, selection: '' }));
    return true;
  }
```

- [ ] **Step 3: Verify background.js loads without errors**

1. Reload the extension in `chrome://extensions`
2. Click "service worker" link on the extension card
3. Check console for errors — should be clean

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat: add side panel and chat message handlers to background service worker"
```

---

## Chunk 4: Side Panel UI

### Task 5: Create the side panel HTML shell

**Files:**
- Create: `sidepanel.html`

- [ ] **Step 1: Create sidepanel.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="sidepanel.css">
  <title>Save Research Chat</title>
</head>
<body>
  <div class="panel">
    <!-- Header -->
    <div class="panel-header">
      <div class="header-info">
        <span class="header-title" id="page-title">Loading...</span>
      </div>
    </div>

    <!-- Context indicator -->
    <div class="context-bar" id="context-bar">
      <span class="context-pill" id="context-pill"></span>
    </div>

    <!-- Quick action chips -->
    <div class="quick-actions" id="quick-actions">
      <button class="chip" data-prompt="Summarize this content in a few paragraphs">Summarize</button>
      <button class="chip" data-prompt="What are the key takeaways from this content? List them as bullet points">Key takeaways</button>
      <button class="chip" data-prompt="Create concise bullet points covering all the main points">Bullet points</button>
      <button class="chip" data-prompt="Explain this content in simple terms, as if I'm five years old">ELI5</button>
    </div>

    <!-- Chat messages -->
    <div class="chat-messages" id="chat-messages">
      <div class="welcome-message" id="welcome-message">
        <p>Ask anything about this page.</p>
      </div>
    </div>

    <!-- Selection quote -->
    <div class="selection-quote hidden" id="selection-quote">
      <span class="selection-text" id="selection-text"></span>
      <button class="selection-dismiss" id="selection-dismiss" aria-label="Dismiss selection">&times;</button>
    </div>

    <!-- Input area -->
    <div class="input-area">
      <textarea id="chat-input" placeholder="Ask a question..." rows="1"></textarea>
      <button id="send-btn" class="send-btn" aria-label="Send message" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </div>

  <script src="sidepanel.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add sidepanel.html
git commit -m "feat: add side panel HTML shell with header, chips, chat area, and input"
```

---

### Task 6: Create the side panel CSS

**Files:**
- Create: `sidepanel.css`

- [ ] **Step 1: Create sidepanel.css**

```css
/* ============================================================
   Save Research — Side Panel Styles
   ============================================================ */

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  background: #fafafa;
  color: #1a1a1a;
  height: 100vh;
  overflow: hidden;
}

.panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* --- Header --- */
.panel-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.header-info {
  flex: 1;
  min-width: 0;
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- Context Bar --- */
.context-bar {
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.context-pill {
  display: inline-block;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  background: #f0fdfa;
  color: #0d9488;
  font-weight: 500;
}

/* --- Quick Actions --- */
.quick-actions {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.quick-actions::-webkit-scrollbar {
  display: none;
}

.chip {
  flex-shrink: 0;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 16px;
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  font-family: inherit;
}

.chip:hover {
  background: #f0fdfa;
  border-color: #0d9488;
  color: #0d9488;
}

.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* --- Chat Messages --- */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.welcome-message {
  text-align: center;
  color: #9ca3af;
  font-size: 13px;
  padding: 40px 20px;
}

.welcome-message.hidden {
  display: none;
}

.message {
  max-width: 88%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.55;
  word-wrap: break-word;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.message.user {
  align-self: flex-end;
  background: #0d9488;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.message.assistant {
  align-self: flex-start;
  background: #f3f4f6;
  color: #1a1a1a;
  border-bottom-left-radius: 4px;
}

/* Markdown rendering in assistant messages */
.message.assistant h1,
.message.assistant h2,
.message.assistant h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 8px 0 4px;
}

.message.assistant h1:first-child,
.message.assistant h2:first-child,
.message.assistant h3:first-child {
  margin-top: 0;
}

.message.assistant p {
  margin: 6px 0;
}

.message.assistant p:first-child {
  margin-top: 0;
}

.message.assistant p:last-child {
  margin-bottom: 0;
}

.message.assistant ul,
.message.assistant ol {
  margin: 6px 0;
  padding-left: 20px;
}

.message.assistant li {
  margin: 2px 0;
}

.message.assistant code {
  background: #e5e7eb;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
}

.message.assistant pre {
  background: #1f2937;
  color: #e5e7eb;
  padding: 10px 12px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 6px 0;
  font-size: 12px;
}

.message.assistant pre code {
  background: none;
  padding: 0;
  color: inherit;
}

.message.assistant strong {
  font-weight: 600;
}

.message.assistant blockquote {
  border-left: 3px solid #d1d5db;
  padding-left: 10px;
  margin: 6px 0;
  color: #6b7280;
}

/* Loading indicator */
.message.assistant .loading-dots {
  display: inline-flex;
  gap: 4px;
  padding: 4px 0;
}

.loading-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #9ca3af;
  animation: bounce 1.2s ease-in-out infinite;
}

.loading-dots span:nth-child(2) { animation-delay: 0.15s; }
.loading-dots span:nth-child(3) { animation-delay: 0.3s; }

@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}

/* Error message */
.message.error {
  align-self: center;
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
  font-size: 12px;
  text-align: center;
  max-width: 100%;
}

.message.error .retry-btn {
  display: inline-block;
  margin-top: 6px;
  padding: 3px 12px;
  font-size: 11px;
  border: 1px solid #dc2626;
  border-radius: 4px;
  background: #fff;
  color: #dc2626;
  cursor: pointer;
}

.message.error .retry-btn:hover {
  background: #fef2f2;
}

/* --- Selection Quote --- */
.selection-quote {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 16px;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.selection-quote.hidden {
  display: none;
}

.selection-text {
  flex: 1;
  font-size: 12px;
  color: #6b7280;
  font-style: italic;
  line-height: 1.4;
  max-height: 40px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.selection-dismiss {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  line-height: 1;
}

.selection-dismiss:hover {
  color: #374151;
}

/* --- Input Area --- */
.input-area {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  background: #fff;
  border-top: 1px solid #e5e7eb;
  flex-shrink: 0;
}

#chat-input {
  flex: 1;
  resize: none;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.4;
  max-height: 100px;
  overflow-y: auto;
  outline: none;
  transition: border-color 0.15s ease;
}

#chat-input:focus {
  border-color: #0d9488;
}

#chat-input::placeholder {
  color: #9ca3af;
}

.send-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: #0d9488;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.send-btn:hover {
  background: #0f766e;
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Commit**

```bash
git add sidepanel.css
git commit -m "feat: add side panel CSS with chat message styles and responsive layout"
```

---

### Task 7: Create the side panel JavaScript

**Files:**
- Create: `sidepanel.js`

- [ ] **Step 1: Create sidepanel.js — chat logic, Ollama streaming, markdown rendering**

Create `sidepanel.js`:

```javascript
// ============================================================
// Save Research — Side Panel Chat
// ============================================================

(() => {
  // --- State ---
  let pageContent = null;   // Extracted page data (cached per URL)
  let chatHistory = [];     // Array of { role: 'user'|'assistant', content: string }
  let currentUrl = '';       // Track URL for reset
  let selectionText = '';    // Text selection from page
  let isStreaming = false;   // Prevent concurrent requests
  let ollamaUrl = '';
  let ollamaModel = '';
  let abortController = null;

  // --- DOM Elements ---
  const pageTitle = document.getElementById('page-title');
  const contextPill = document.getElementById('context-pill');
  const quickActions = document.getElementById('quick-actions');
  const chatMessages = document.getElementById('chat-messages');
  const welcomeMessage = document.getElementById('welcome-message');
  const selectionQuote = document.getElementById('selection-quote');
  const selectionTextEl = document.getElementById('selection-text');
  const selectionDismiss = document.getElementById('selection-dismiss');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  // --- Initialize ---
  async function init() {
    // Get Ollama settings
    const settingsResp = await chrome.runtime.sendMessage({ action: 'get-ollama-settings' });
    if (settingsResp?.ok) {
      ollamaUrl = settingsResp.ollamaUrl;
      ollamaModel = settingsResp.model;
    }

    // Extract page content
    await extractContent();

    // Check for any text selection on the page
    const selResp = await chrome.runtime.sendMessage({ action: 'get-selection' });
    if (selResp?.ok && selResp.selection) {
      setSelection(selResp.selection);
    }
  }

  async function extractContent() {
    pageTitle.textContent = 'Extracting content...';
    contextPill.textContent = 'Loading...';

    const resp = await chrome.runtime.sendMessage({ action: 'extract-page-content' });

    if (!resp?.ok || !resp.data) {
      pageTitle.textContent = 'Could not extract content';
      contextPill.textContent = 'Error';
      return;
    }

    pageContent = resp.data;
    currentUrl = pageContent.url;

    // Update header
    pageTitle.textContent = pageContent.title || pageContent.url;

    // Update context pill
    if (pageContent.type === 'youtube') {
      const mins = Math.floor((pageContent.duration || 0) / 60);
      const hasTx = pageContent.transcript ? 'transcript loaded' : 'no transcript';
      contextPill.textContent = `YouTube \u00B7 ${mins}m \u00B7 ${hasTx}`;
    } else if (pageContent.type === 'twitter') {
      const count = pageContent.tweets?.length || 0;
      contextPill.textContent = `Twitter \u00B7 ${count} tweet${count !== 1 ? 's' : ''}`;
    } else {
      const wc = pageContent.wordCount || 0;
      contextPill.textContent = wc > 0 ? `Page \u00B7 ${wc.toLocaleString()} words` : `Page \u00B7 ${pageContent.domain}`;
    }
  }

  // --- Selection ---
  function setSelection(text) {
    if (!text) return;
    selectionText = text;
    selectionTextEl.textContent = text.length > 200 ? text.substring(0, 200) + '...' : text;
    selectionQuote.classList.remove('hidden');
  }

  function clearSelection() {
    selectionText = '';
    selectionQuote.classList.add('hidden');
    selectionTextEl.textContent = '';
  }

  selectionDismiss.addEventListener('click', clearSelection);

  // --- Build system prompt ---
  function buildSystemPrompt() {
    if (!pageContent) return 'You are a helpful assistant.';

    if (pageContent.type === 'youtube') {
      let prompt = `You are a helpful assistant analyzing a YouTube video the user is watching.\n\n`;
      prompt += `Video: ${pageContent.title}\n`;
      if (pageContent.channel) prompt += `Channel: ${pageContent.channel}\n`;
      if (pageContent.duration) {
        const mins = Math.floor(pageContent.duration / 60);
        const secs = pageContent.duration % 60;
        prompt += `Duration: ${mins}m ${secs}s\n`;
      }
      if (pageContent.description) {
        prompt += `\nDescription:\n${pageContent.description.substring(0, 2000)}\n`;
      }
      if (pageContent.transcript) {
        prompt += `\n--- TRANSCRIPT ---\n${pageContent.transcript}\n---\n`;
      }
      prompt += `\nAnswer the user's questions about this video. Be concise and specific. When referencing the content, quote relevant parts. Use markdown formatting for lists and structure.`;
      return prompt;
    }

    if (pageContent.type === 'twitter') {
      let prompt = `You are a helpful assistant analyzing tweets the user is viewing.\n\n`;
      if (pageContent.tweets && pageContent.tweets.length > 0) {
        prompt += `--- TWEETS ---\n`;
        for (const tweet of pageContent.tweets) {
          prompt += `${tweet.author} (${tweet.time}):\n${tweet.text}\n\n`;
        }
        prompt += `---\n`;
      }
      prompt += `\nAnswer the user's questions about these tweets. Be concise and specific. Use markdown formatting.`;
      return prompt;
    }

    // General page
    let prompt = `You are a helpful assistant analyzing the content of a web page the user is currently viewing.\n\n`;
    prompt += `Page Title: ${pageContent.title}\n`;
    prompt += `URL: ${pageContent.url}\n`;
    if (pageContent.author) prompt += `Author: ${pageContent.author}\n`;
    prompt += `\n--- PAGE CONTENT ---\n${pageContent.content}\n---\n`;
    prompt += `\nAnswer the user's questions about this content. Be concise and specific. When referencing the content, quote relevant parts. Use markdown formatting for lists and structure.`;
    return prompt;
  }

  // --- Build messages array for Ollama ---
  function buildMessages(userMessage) {
    const systemPrompt = buildSystemPrompt();
    const messages = [{ role: 'system', content: systemPrompt }];

    // Include last 10 messages from history
    const recentHistory = chatHistory.slice(-10);
    messages.push(...recentHistory);

    // Prepend selection context to user message if present
    let finalMessage = userMessage;
    if (selectionText) {
      finalMessage = `[Regarding this excerpt: "${selectionText}"]\n\n${userMessage}`;
    }

    messages.push({ role: 'user', content: finalMessage });
    return messages;
  }

  // --- Simple Markdown renderer ---
  function renderMarkdown(text) {
    let html = text
      // Code blocks (must be before inline code)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // Inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Blockquotes
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // Unordered lists
      .replace(/^[*-] (.+)$/gm, '<li>$1</li>')
      // Ordered lists
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    // Wrap consecutive <li> elements in <ul>
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Paragraphs: split on double newlines
    html = html.split(/\n{2,}/).map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      // Don't wrap blocks that are already HTML elements
      if (/^<(h[1-3]|pre|ul|ol|blockquote|li)/.test(trimmed)) return trimmed;
      return `<p>${trimmed}</p>`;
    }).join('');

    // Clean up single newlines within paragraphs
    html = html.replace(/(?<!\n)\n(?!\n)/g, '<br>');

    return html;
  }

  // --- Send message ---
  async function sendMessage(text) {
    if (!text.trim() || isStreaming || !pageContent) return;

    const userMessage = text.trim();
    isStreaming = true;
    updateInputState();

    // Hide welcome message
    welcomeMessage.classList.add('hidden');

    // Add user message bubble
    appendMessage('user', userMessage);

    // Clear input
    chatInput.value = '';
    autoResize();

    // Add assistant message bubble with loading dots
    const assistantBubble = appendMessage('assistant', '', true);

    // Build messages array
    const messages = buildMessages(userMessage);

    // Clear selection after sending
    clearSelection();

    // Save user message to history
    chatHistory.push({ role: 'user', content: userMessage });

    try {
      abortController = new AbortController();

      const resp = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages,
          stream: true,
          options: { temperature: 0.3, num_ctx: 131072 },
        }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        throw new Error(`Ollama returned HTTP ${resp.status}`);
      }

      // Stream response
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              fullResponse += json.message.content;
              // Update bubble with rendered markdown
              assistantBubble.innerHTML = renderMarkdown(fullResponse);
              scrollToBottom();
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Save assistant response to history
      chatHistory.push({ role: 'assistant', content: fullResponse });

      // Final render
      assistantBubble.innerHTML = renderMarkdown(fullResponse);
      scrollToBottom();

    } catch (err) {
      if (err.name === 'AbortError') {
        assistantBubble.innerHTML = '<em>Stopped</em>';
      } else {
        assistantBubble.remove();
        showError(err.message);
      }
    } finally {
      isStreaming = false;
      abortController = null;
      updateInputState();
    }
  }

  // --- UI Helpers ---
  function appendMessage(role, content, isLoading = false) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    if (isLoading) {
      div.innerHTML = `<div class="loading-dots"><span></span><span></span><span></span></div>`;
    } else if (role === 'user') {
      div.textContent = content;
    } else {
      div.innerHTML = renderMarkdown(content);
    }

    chatMessages.appendChild(div);
    scrollToBottom();
    return div;
  }

  function showError(message) {
    const div = document.createElement('div');
    div.className = 'message error';

    let errorText = message;
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
      errorText = `Can't reach Ollama at ${ollamaUrl}. Check that it's running.`;
    } else if (message.includes('404') || message.includes('model')) {
      errorText = `Model '${ollamaModel}' not available. Check your extension settings.`;
    }

    div.innerHTML = `${errorText}<br><button class="retry-btn" id="retry-btn">Retry</button>`;
    chatMessages.appendChild(div);
    scrollToBottom();

    div.querySelector('.retry-btn').addEventListener('click', () => {
      div.remove();
      // Retry last user message
      const lastUserMsg = chatHistory.filter(m => m.role === 'user').pop();
      if (lastUserMsg) {
        chatHistory.pop(); // Remove the failed user message
        sendMessage(lastUserMsg.content);
      }
    });
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function updateInputState() {
    const hasText = chatInput.value.trim().length > 0;
    sendBtn.disabled = !hasText || isStreaming || !pageContent;

    // Disable chips while streaming
    for (const chip of quickActions.querySelectorAll('.chip')) {
      chip.disabled = isStreaming || !pageContent;
    }
  }

  function autoResize() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
  }

  // --- Event Listeners ---

  // Send on button click
  sendBtn.addEventListener('click', () => sendMessage(chatInput.value));

  // Send on Enter (Shift+Enter for newline)
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(chatInput.value);
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    autoResize();
    updateInputState();
  });

  // Quick action chips
  for (const chip of quickActions.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      if (!isStreaming && pageContent) {
        sendMessage(chip.dataset.prompt);
      }
    });
  }

  // Listen for selection from FAB
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'sr-chat-selection' && msg.selection) {
      setSelection(msg.selection);
    }
  });

  // Monitor tab URL changes — reset chat when URL changes
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && changeInfo.url !== currentUrl) {
      // URL changed — reset everything
      chatHistory = [];
      pageContent = null;
      selectionText = '';
      chatMessages.innerHTML = '';
      welcomeMessage.classList.remove('hidden');
      chatMessages.appendChild(welcomeMessage);
      clearSelection();
      extractContent();
    }
  });

  // --- Start ---
  init();
})();
```

- [ ] **Step 2: Verify the side panel works end-to-end**

1. Reload the extension in `chrome://extensions`
2. Open any webpage
3. Click the FAB — side panel should open from the right
4. Verify: page title shows in header, context pill shows page type and word count
5. Click "Summarize" chip — verify Ollama streams a response
6. Type a question and press Enter — verify response
7. Select text on the page, click FAB — verify selection quote appears
8. Navigate to a YouTube video — verify "YouTube" context pill with transcript info
9. Navigate to a different page — verify chat resets

- [ ] **Step 3: Commit**

```bash
git add sidepanel.js sidepanel.css sidepanel.html
git commit -m "feat: add complete side panel chat UI with Ollama streaming and markdown rendering"
```

---

## Chunk 5: Integration and Polish

### Task 8: Wire FAB selection to side panel

**Files:**
- Modify: `background.js` (add selection relay in toggle-sidepanel handler)

- [ ] **Step 1: Update the toggle-sidepanel handler in background.js to forward selection to side panel**

Find the `toggle-sidepanel` handler added in Task 4 and replace it with:

```javascript
  if (msg.action === 'toggle-sidepanel') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      if (_sidePanelOpenTabId === tab.id) {
        await closeSidePanel(tab.id);
      } else {
        await openSidePanel(tab.id);
        // If selection was included, forward it to the side panel after a short delay
        // (panel needs time to load)
        if (msg.selection) {
          setTimeout(() => {
            chrome.runtime.sendMessage({
              action: 'sr-chat-selection',
              selection: msg.selection,
            }).catch(() => {});
          }, 500);
        }
      }
    })();
    return false;
  }
```

- [ ] **Step 2: Verify selection forwarding**

1. Open a webpage, select some text
2. Click the FAB
3. Side panel opens with the selected text shown as a quote above the input
4. Type a question — verify the selection is included in the prompt context

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "feat: forward text selection from FAB to side panel on open"
```

---

### Task 9: Handle edge cases and panel close tracking

**Files:**
- Modify: `background.js` (add tab close listener to reset panel state)

- [ ] **Step 1: Add tab removal listener to reset side panel state**

Add this after the existing `chrome.storage.onChanged` listener in background.js:

```javascript
// Reset side panel state when tracked tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (_sidePanelOpenTabId === tabId) {
    _sidePanelOpenTabId = null;
  }
});

// Reset side panel state when active tab changes
chrome.tabs.onActivated.addListener(({ tabId }) => {
  // The side panel in Chrome is per-tab, so when switching tabs
  // the panel may not be open on the new tab
  if (_sidePanelOpenTabId && _sidePanelOpenTabId !== tabId) {
    // Notify the old tab that panel is no longer showing for it
    chrome.tabs.sendMessage(_sidePanelOpenTabId, {
      action: 'sr-chat-panel-state',
      open: false,
    }).catch(() => {});
    _sidePanelOpenTabId = null;
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "feat: handle tab close and tab switch for side panel state tracking"
```

---

### Task 10: Final manual verification

- [ ] **Step 1: Full end-to-end test on a regular webpage**

1. Load extension, open any article/blog post
2. FAB visible at bottom-right (teal, circular)
3. Click FAB → side panel opens, FAB icon changes to X
4. Context pill shows "Page - X words"
5. Click "Summarize" → Ollama streams a summary
6. Ask "What are the main topics?" → streams response
7. Click FAB (X icon) → panel closes, FAB returns to chat icon

- [ ] **Step 2: Full end-to-end test on YouTube**

1. Open a YouTube video with captions
2. Click FAB → side panel opens
3. Context pill shows "YouTube - Xm - transcript loaded"
4. Click "Key takeaways" → streams bullet points from transcript
5. Ask "What does the speaker say about X?" → accurate answer with timestamps
6. Click "Bullet points" → structured notes

- [ ] **Step 3: Selection test**

1. Open any page, select a paragraph of text
2. "Ask about selection" tooltip appears near FAB
3. Click FAB → panel opens with selection quote visible
4. Ask "Explain this in simpler terms" → response focuses on selected text
5. Click X on selection quote → selection dismissed
6. Next message uses full page context

- [ ] **Step 4: Error handling test**

1. Stop Ollama (`ollama stop` or kill process)
2. Open side panel, try to send a message
3. Verify error message: "Can't reach Ollama at http://localhost:11434..."
4. Verify "Retry" button appears
5. Start Ollama, click Retry → message goes through

- [ ] **Step 5: Navigation reset test**

1. Open side panel, have a conversation
2. Navigate to a different URL in the same tab
3. Verify chat history clears
4. Verify page content re-extracts for new page

- [ ] **Step 6: Commit all final changes (if any fixups needed)**

```bash
git add -A
git commit -m "feat: complete chat popover side panel with Ollama integration"
```
