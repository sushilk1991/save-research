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
  let cachedSystemPrompt = null; // Cached system prompt string
  let activeTabId = null;        // Track which tab we're monitoring
  let extractionGen = 0;         // Generation counter for stale extraction cancellation
  let renderRAF = null;          // requestAnimationFrame ID for throttled rendering

  const MAX_HISTORY = 20; // Cap chat history to prevent unbounded growth

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
  const exportChatBtn = document.getElementById('export-chat-btn');
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const tabBar = document.getElementById('tab-bar');
  const outlineView = document.getElementById('outline-view');
  const outlineList = document.getElementById('outline-list');
  const outlineEmpty = document.getElementById('outline-empty');
  let activeTab = 'chat';
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = document.getElementById('theme-icon');
  const searchView = document.getElementById('search-view');
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchCount = document.getElementById('search-count');
  const searchEmpty = document.getElementById('search-empty');

  // --- Theme ---
  const SUN_PATH = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z';
  const MOON_PATH = 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z';

  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    if (themeIcon) {
      themeIcon.querySelector('path').setAttribute('d', dark ? SUN_PATH : MOON_PATH);
    }
  }

  function initTheme() {
    const stored = localStorage.getItem('sr-theme');
    if (stored === 'dark') {
      applyTheme(true);
    } else if (stored === 'light') {
      applyTheme(false);
    } else {
      // Follow system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark);
    }
  }

  themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark');
    applyTheme(!isDark);
    localStorage.setItem('sr-theme', isDark ? 'light' : 'dark');
  });

  initTheme();

  // --- Initialize ---
  async function init() {
    // Get Ollama settings
    const settingsResp = await chrome.runtime.sendMessage({ action: 'get-ollama-settings' });
    if (settingsResp?.ok) {
      ollamaUrl = settingsResp.ollamaUrl;
      ollamaModel = settingsResp.model;
    }

    // Determine active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) activeTabId = tab.id;

    // Extract page content
    await extractContent();

    // Check for any pending selection from FAB toggle
    const selResp = await chrome.runtime.sendMessage({ action: 'get-selection' });
    if (selResp?.ok && selResp.selection) {
      setSelection(selResp.selection);
    }
  }

  async function extractContent() {
    const gen = ++extractionGen;

    pageTitle.textContent = 'Extracting content...';
    contextPill.textContent = 'Loading...';

    const resp = await chrome.runtime.sendMessage({ action: 'extract-page-content' });

    // Stale extraction — a newer one was started
    if (gen !== extractionGen) return;

    if (!resp?.ok || !resp.data) {
      pageTitle.textContent = 'Could not extract content';
      contextPill.textContent = 'Error';
      return;
    }

    pageContent = resp.data;
    cachedSystemPrompt = null; // Invalidate cached prompt
    currentUrl = pageContent.url;

    // Update header
    pageTitle.textContent = pageContent.title || pageContent.url;

    // Populate quick actions based on content type
    populateQuickActions();

    // Update context pill with reading/watch time
    if (pageContent.type === 'youtube') {
      const watchInfo = typeof estimateWatchTime === 'function'
        ? estimateWatchTime(pageContent.duration || 0)
        : { label: Math.floor((pageContent.duration || 0) / 60) + 'm' };
      const hasTx = pageContent.transcript ? 'transcript loaded' : 'no transcript';
      contextPill.textContent = `YouTube \u00B7 ${watchInfo.label} \u00B7 ${hasTx}`;
    } else if (pageContent.type === 'twitter') {
      const count = pageContent.tweets?.length || 0;
      contextPill.textContent = `Twitter \u00B7 ${count} tweet${count !== 1 ? 's' : ''}`;
    } else {
      const readInfo = typeof estimateReadingTime === 'function'
        ? estimateReadingTime(pageContent.content || '')
        : { label: '', words: pageContent.wordCount || 0 };
      const parts = ['Page'];
      if (readInfo.label) parts.push(readInfo.label);
      if (readInfo.words > 0) parts.push(`${readInfo.words.toLocaleString()} words`);
      else if (pageContent.domain) parts.push(pageContent.domain);
      contextPill.textContent = parts.join(' \u00B7 ');
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

  // --- Build system prompt (cached) ---
  function buildSystemPrompt() {
    if (cachedSystemPrompt !== null) return cachedSystemPrompt;
    if (!pageContent) return 'You are a helpful assistant.';

    let prompt;

    if (pageContent.type === 'youtube') {
      prompt = 'You are a helpful assistant analyzing a YouTube video the user is watching.\n\n';
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
      prompt += '\nAnswer the user\'s questions about this video. Be concise and specific. When referencing the content, quote relevant parts. Use markdown formatting for lists and structure.';
    } else if (pageContent.type === 'twitter') {
      prompt = 'You are a helpful assistant analyzing tweets the user is viewing.\n\n';
      if (pageContent.tweets && pageContent.tweets.length > 0) {
        prompt += '--- TWEETS ---\n';
        for (const tweet of pageContent.tweets) {
          prompt += `${tweet.author} (${tweet.time}):\n${tweet.text}\n\n`;
        }
        prompt += '---\n';
      }
      prompt += '\nAnswer the user\'s questions about these tweets. Be concise and specific. Use markdown formatting.';
    } else {
      // General page
      prompt = 'You are a helpful assistant analyzing the content of a web page the user is currently viewing.\n\n';
      prompt += `Page Title: ${pageContent.title}\n`;
      prompt += `URL: ${pageContent.url}\n`;
      if (pageContent.author) prompt += `Author: ${pageContent.author}\n`;
      prompt += `\n--- PAGE CONTENT ---\n${pageContent.content}\n---\n`;
      prompt += '\nAnswer the user\'s questions about this content. Be concise and specific. When referencing the content, quote relevant parts. Use markdown formatting for lists and structure.';
    }

    cachedSystemPrompt = prompt;
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
    // Escape HTML first to prevent XSS
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    let html = escaped
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
      .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
      // Unordered lists
      .replace(/^[*-] (.+)$/gm, '<li>$1</li>');

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

    // Cap history length
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory = chatHistory.slice(-MAX_HISTORY);
    }

    try {
      abortController = new AbortController();

      const resp = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ollamaModel,
          messages,
          stream: true,
          options: { temperature: 0.3 },
        }),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        throw new Error(`Ollama returned HTTP ${resp.status}`);
      }

      // Stream response with requestAnimationFrame throttling
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let pendingRender = false;

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
              // Throttle DOM updates with requestAnimationFrame
              if (!pendingRender) {
                pendingRender = true;
                renderRAF = requestAnimationFrame(() => {
                  assistantBubble.innerHTML = renderMarkdown(fullResponse);
                  scrollToBottom();
                  pendingRender = false;
                });
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Cancel any pending RAF
      if (renderRAF) {
        cancelAnimationFrame(renderRAF);
        renderRAF = null;
      }

      // Save assistant response to history
      chatHistory.push({ role: 'assistant', content: fullResponse });

      // Cap history length
      if (chatHistory.length > MAX_HISTORY) {
        chatHistory = chatHistory.slice(-MAX_HISTORY);
      }

      // Final render with action buttons
      assistantBubble.innerHTML = renderMarkdown(fullResponse);
      assistantBubble.appendChild(createMessageActions(fullResponse));
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

  // --- SVG Icons ---
  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
  const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  const SPEAK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const STOP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';

  // --- UI Helpers ---
  function createMessageActions(rawContent) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'message-action-btn';
    copyBtn.innerHTML = `${COPY_ICON} Copy`;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(rawContent);
        copyBtn.innerHTML = `${CHECK_ICON} Copied`;
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = `${COPY_ICON} Copy`;
          copyBtn.classList.remove('copied');
        }, 2000);
      } catch {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = rawContent;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        copyBtn.innerHTML = `${CHECK_ICON} Copied`;
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.innerHTML = `${COPY_ICON} Copy`;
          copyBtn.classList.remove('copied');
        }, 2000);
      }
    });
    actions.appendChild(copyBtn);

    // Save button — downloads response as markdown file
    const saveBtn = document.createElement('button');
    saveBtn.className = 'message-action-btn';
    saveBtn.innerHTML = `${SAVE_ICON} Save`;
    saveBtn.addEventListener('click', () => {
      const title = pageContent?.title || 'chat-response';
      const safeName = title.replace(/[^a-z0-9]+/gi, '-').substring(0, 50).toLowerCase();
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const filename = `${safeName}-${timestamp}.md`;

      const frontmatter = [
        '---',
        `source: ${pageContent?.url || ''}`,
        `title: "${(pageContent?.title || '').replace(/"/g, '\\"')}"`,
        `saved: ${new Date().toISOString()}`,
        `type: chat-response`,
        '---',
        '',
      ].join('\n');

      const blob = new Blob([frontmatter + rawContent], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      saveBtn.innerHTML = `${CHECK_ICON} Saved`;
      saveBtn.classList.add('copied');
      setTimeout(() => {
        saveBtn.innerHTML = `${SAVE_ICON} Save`;
        saveBtn.classList.remove('copied');
      }, 2000);
    });
    actions.appendChild(saveBtn);

    // Speak button (only if TTS is available)
    if (typeof TTS !== 'undefined' && TTS.isAvailable()) {
      const speakBtn = document.createElement('button');
      speakBtn.className = 'message-action-btn';
      speakBtn.innerHTML = `${SPEAK_ICON} Listen`;

      const updateSpeakBtn = (state) => {
        if (state === 'playing') {
          speakBtn.innerHTML = `${STOP_ICON} Stop`;
        } else {
          speakBtn.innerHTML = `${SPEAK_ICON} Listen`;
        }
      };

      speakBtn.addEventListener('click', () => {
        if (TTS.getState() === 'playing') {
          TTS.stop();
        } else {
          TTS.setOnStateChange(updateSpeakBtn);
          TTS.speak(rawContent);
        }
      });
      actions.appendChild(speakBtn);
    }

    return actions;
  }

  function appendMessage(role, content, isLoading = false) {
    const div = document.createElement('div');
    div.className = `message ${role}`;

    if (isLoading) {
      div.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    } else if (role === 'user') {
      div.textContent = content;
    } else {
      div.innerHTML = renderMarkdown(content);
      if (content) {
        div.appendChild(createMessageActions(content));
      }
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

    // Use DOM API instead of innerHTML to prevent XSS
    div.appendChild(document.createTextNode(errorText));
    div.appendChild(document.createElement('br'));

    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => {
      if (isStreaming) return; // Guard against concurrent retry
      div.remove();
      // Find and remove the last user message from history
      const lastUserIdx = chatHistory.findLastIndex(m => m.role === 'user');
      if (lastUserIdx !== -1) {
        const lastUserMsg = chatHistory[lastUserIdx];
        chatHistory.splice(lastUserIdx, 1);
        sendMessage(lastUserMsg.content);
      }
    });
    div.appendChild(retryBtn);

    chatMessages.appendChild(div);
    scrollToBottom();
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

  // Quick action chips are now created dynamically in populateQuickActions()

  // Listen for selection from FAB
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'sr-chat-selection' && msg.selection) {
      setSelection(msg.selection);
    }
  });

  // Monitor tab URL changes — reset chat only for our active tab
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== activeTabId) return; // Only react to our tab
    if (changeInfo.url && changeInfo.url !== currentUrl) {
      // URL changed — reset everything
      chatHistory = [];
      pageContent = null;
      cachedSystemPrompt = null;
      selectionText = '';
      chatMessages.innerHTML = '';
      welcomeMessage.classList.remove('hidden');
      chatMessages.appendChild(welcomeMessage);
      clearSelection();
      extractContent();
    }
  });

  // --- Tab Switching ---
  function switchTab(tab) {
    activeTab = tab;
    for (const btn of tabBar.querySelectorAll('.tab')) {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    }

    const chatVisible = tab === 'chat';
    chatMessages.style.display = chatVisible ? '' : 'none';
    quickActions.style.display = chatVisible ? '' : 'none';
    selectionQuote.style.display = chatVisible ? '' : 'none';
    document.querySelector('.input-area').style.display = chatVisible ? '' : 'none';
    outlineView.classList.toggle('hidden', tab !== 'outline');
    searchView.classList.toggle('hidden', tab !== 'search');

    if (tab === 'outline') {
      renderOutline();
    } else if (tab === 'search') {
      searchInput.focus();
    }
  }

  tabBar.addEventListener('click', (e) => {
    const tab = e.target.dataset?.tab;
    if (tab) switchTab(tab);
  });

  // --- Outline ---
  function renderOutline() {
    outlineList.innerHTML = '';

    if (!pageContent?.content) {
      outlineEmpty.style.display = '';
      return;
    }

    const headings = typeof extractHeadings === 'function'
      ? extractHeadings(pageContent.content)
      : [];

    if (headings.length === 0) {
      outlineEmpty.style.display = '';
      return;
    }

    outlineEmpty.style.display = 'none';

    for (const heading of headings) {
      const li = document.createElement('li');
      li.className = `outline-item level-${heading.level}`;
      li.textContent = heading.text;
      li.addEventListener('click', () => {
        // Ask about this heading in chat
        switchTab('chat');
        const prompt = `Explain the section "${heading.text}" in detail`;
        chatInput.value = prompt;
        autoResize();
        updateInputState();
        chatInput.focus();
      });
      outlineList.appendChild(li);
    }
  }

  // --- Quick Actions ---
  function populateQuickActions() {
    quickActions.innerHTML = '';

    if (!pageContent || typeof getQuickActions !== 'function') {
      // Fallback: static chips
      const fallback = [
        { label: 'Summarize', prompt: 'Summarize this content in a few paragraphs' },
        { label: 'Key takeaways', prompt: 'What are the key takeaways? List them as bullet points' },
        { label: 'ELI5', prompt: 'Explain this in simple terms' },
      ];
      for (const action of fallback) {
        quickActions.appendChild(createChip(action));
      }
      return;
    }

    const meta = {
      hasTranscript: !!pageContent.transcript,
      wordCount: pageContent.wordCount || 0,
    };

    const actions = getQuickActions(pageContent.type, meta);
    for (const action of actions) {
      quickActions.appendChild(createChip(action));
    }
  }

  function createChip(action) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.textContent = action.label;
    btn.dataset.prompt = action.prompt;
    btn.disabled = isStreaming || !pageContent;
    btn.addEventListener('click', () => {
      if (!isStreaming && pageContent) {
        sendMessage(action.prompt);
      }
    });
    return btn;
  }

  // --- Search ---
  let searchDebounce = null;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(performSearch, 200);
  });

  function performSearch() {
    const query = searchInput.value.trim();
    searchResults.innerHTML = '';

    if (!query || !pageContent?.content) {
      searchCount.textContent = '';
      searchResults.appendChild(searchEmpty);
      searchEmpty.textContent = query ? 'No content loaded.' : 'Type to search within this page\'s content.';
      return;
    }

    if (typeof searchContent !== 'function') {
      searchCount.textContent = '';
      searchEmpty.textContent = 'Search module not loaded.';
      searchResults.appendChild(searchEmpty);
      return;
    }

    const results = searchContent(pageContent.content, query, { contextChars: 60, maxResults: 50 });
    const total = typeof countMatches === 'function' ? countMatches(pageContent.content, query) : results.length;

    if (results.length === 0) {
      searchCount.textContent = '0 results';
      searchEmpty.textContent = `No matches for "${query}"`;
      searchResults.appendChild(searchEmpty);
      return;
    }

    searchCount.textContent = total > 50 ? `50 of ${total}` : `${total} result${total !== 1 ? 's' : ''}`;

    for (const result of results) {
      const div = document.createElement('div');
      div.className = 'search-result-item';

      const lineSpan = document.createElement('span');
      lineSpan.className = 'line-num';
      lineSpan.textContent = `L${result.lineNumber}`;
      div.appendChild(lineSpan);

      const textSpan = document.createElement('span');
      textSpan.innerHTML = typeof highlightMatches === 'function'
        ? highlightMatches(result.excerpt, query)
        : result.excerpt;
      div.appendChild(textSpan);

      // Click to ask AI about this excerpt
      div.addEventListener('click', () => {
        switchTab('chat');
        const prompt = `Explain this part of the content: "${result.excerpt.replace(/\.\.\./g, '').trim()}"`;
        chatInput.value = prompt;
        autoResize();
        updateInputState();
        chatInput.focus();
      });

      searchResults.appendChild(div);
    }
  }

  // --- Export chat ---
  function exportChat() {
    if (chatHistory.length === 0) return;

    const title = pageContent?.title || 'Chat';
    const safeName = title.replace(/[^a-z0-9]+/gi, '-').substring(0, 50).toLowerCase();
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const filename = `chat-${safeName}-${timestamp}.md`;

    const lines = [
      '---',
      `source: ${pageContent?.url || ''}`,
      `title: "${(pageContent?.title || '').replace(/"/g, '\\"')}"`,
      `exported: ${new Date().toISOString()}`,
      `type: chat-export`,
      `messages: ${chatHistory.length}`,
      '---',
      '',
      `# Chat: ${title}`,
      '',
    ];

    for (const msg of chatHistory) {
      if (msg.role === 'user') {
        lines.push(`**You:** ${msg.content}`, '');
      } else {
        lines.push(msg.content, '');
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  exportChatBtn.addEventListener('click', exportChat);

  // --- Clear chat ---
  function clearChat() {
    if (isStreaming) return;
    chatHistory = [];
    chatMessages.innerHTML = '';
    welcomeMessage.classList.remove('hidden');
    chatMessages.appendChild(welcomeMessage);
    clearSelection();
  }

  clearChatBtn.addEventListener('click', clearChat);

  // --- Keyboard Shortcuts ---
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd+Shift+C — copy last assistant response
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      const lastAssistant = chatHistory.findLast(m => m.role === 'assistant');
      if (lastAssistant) {
        navigator.clipboard.writeText(lastAssistant.content).catch(() => {});
      }
      return;
    }

    // Escape — stop streaming or clear input
    if (e.key === 'Escape') {
      if (isStreaming && abortController) {
        abortController.abort();
      } else if (chatInput.value.trim()) {
        chatInput.value = '';
        autoResize();
        updateInputState();
      }
      return;
    }

    // Ctrl/Cmd+L — clear chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
      e.preventDefault();
      clearChat();
      return;
    }

    // Ctrl/Cmd+E — export chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      exportChat();
      return;
    }

    // Ctrl/Cmd+F — search content
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      switchTab('search');
      return;
    }

    // / — focus input (when not already focused)
    if (e.key === '/' && document.activeElement !== chatInput) {
      e.preventDefault();
      chatInput.focus();
      return;
    }
  });

  // --- Start ---
  init();
})();
