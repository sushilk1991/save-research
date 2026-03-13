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
      let prompt = 'You are a helpful assistant analyzing a YouTube video the user is watching.\n\n';
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
      return prompt;
    }

    if (pageContent.type === 'twitter') {
      let prompt = 'You are a helpful assistant analyzing tweets the user is viewing.\n\n';
      if (pageContent.tweets && pageContent.tweets.length > 0) {
        prompt += '--- TWEETS ---\n';
        for (const tweet of pageContent.tweets) {
          prompt += `${tweet.author} (${tweet.time}):\n${tweet.text}\n\n`;
        }
        prompt += '---\n';
      }
      prompt += '\nAnswer the user\'s questions about these tweets. Be concise and specific. Use markdown formatting.';
      return prompt;
    }

    // General page
    let prompt = 'You are a helpful assistant analyzing the content of a web page the user is currently viewing.\n\n';
    prompt += `Page Title: ${pageContent.title}\n`;
    prompt += `URL: ${pageContent.url}\n`;
    if (pageContent.author) prompt += `Author: ${pageContent.author}\n`;
    prompt += `\n--- PAGE CONTENT ---\n${pageContent.content}\n---\n`;
    prompt += '\nAnswer the user\'s questions about this content. Be concise and specific. When referencing the content, quote relevant parts. Use markdown formatting for lists and structure.';
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
      div.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
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

    div.innerHTML = `${errorText}<br><button class="retry-btn">Retry</button>`;
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
