// ============================================================
// Save Research — Options Page
// ============================================================

const DEFAULT_SETTINGS = {
  collections: [
    { id: 'research', name: 'Research', folder: 'SaveResearch' }
  ],
  activeCollectionId: 'research',
  organizeByType: true,
  showNotifications: true,
  markdownMethod: 'markdownnew',
  folders: {
    images: 'images',
    pages: 'pages',
    media: 'media',
    notes: 'notes',
    documents: 'documents',
  },
  ai: {
    enabled: false,
    ollamaUrl: 'http://localhost:11434',
    model: 'qwen3.5:4b',
  },
  youtube: {
    enabled: true,
    downloadVideo: false,
    companionUrl: 'http://localhost:11435',
    videoQuality: '720p',
  },
  twitter: {
    enabled: true,
    savePdf: false,
  },
  chat: {
    showFab: true,
  },
};

let settings = structuredClone(DEFAULT_SETTINGS);

// --- Init ---

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.sync.get('settings');
  settings = structuredClone(DEFAULT_SETTINGS);
  if (stored.settings) {
    Object.assign(settings, stored.settings);
    settings.folders = { ...DEFAULT_SETTINGS.folders, ...(stored.settings.folders || {}) };
    settings.ai = { ...DEFAULT_SETTINGS.ai, ...(stored.settings.ai || {}) };
    settings.youtube = { ...DEFAULT_SETTINGS.youtube, ...(stored.settings.youtube || {}) };
    settings.twitter = { ...DEFAULT_SETTINGS.twitter, ...(stored.settings.twitter || {}) };
    settings.chat = { ...DEFAULT_SETTINGS.chat, ...(stored.settings.chat || {}) };
  }
  render();
  bindEvents();
});

// --- Render ---

function render() {
  renderCollections();

  // Folder organization
  document.getElementById('organize-by-type').checked = settings.organizeByType;
  document.getElementById('folder-images').value = settings.folders.images;
  document.getElementById('folder-pages').value = settings.folders.pages;
  document.getElementById('folder-media').value = settings.folders.media;
  document.getElementById('folder-notes').value = settings.folders.notes;
  document.getElementById('folder-documents').value = settings.folders.documents;
  toggleFolderNames(settings.organizeByType);
  updateFolderPreview();

  // Markdown
  document.getElementById('markdown-method').value = settings.markdownMethod;

  // AI
  document.getElementById('ai-enabled').checked = settings.ai.enabled;
  document.getElementById('ai-url').value = settings.ai.ollamaUrl;
  document.getElementById('ai-model').value = settings.ai.model;
  toggleAISettings(settings.ai.enabled);

  // Twitter/X
  document.getElementById('tw-enabled').checked = settings.twitter.enabled;
  document.getElementById('tw-save-pdf').checked = settings.twitter.savePdf;

  // YouTube
  document.getElementById('yt-enabled').checked = settings.youtube.enabled;
  document.getElementById('yt-download').checked = settings.youtube.downloadVideo;
  document.getElementById('yt-companion-url').value = settings.youtube.companionUrl;
  document.getElementById('yt-quality').value = settings.youtube.videoQuality;
  toggleCompanionSettings(settings.youtube.downloadVideo);

  // Chat
  document.getElementById('chat-show-fab').checked = settings.chat.showFab;

  // General
  document.getElementById('show-notifications').checked = settings.showNotifications;
}

function renderCollections() {
  const container = document.getElementById('collections-list');
  const template = document.getElementById('collection-template');
  container.innerHTML = '';

  for (const col of settings.collections) {
    const node = template.content.cloneNode(true);
    const item = node.querySelector('.collection-item');

    item.dataset.id = col.id;
    if (col.id === settings.activeCollectionId) item.classList.add('active');

    item.querySelector('.col-name').value = col.name;
    item.querySelector('.col-folder').value = col.folder;

    item.querySelector('.col-name').addEventListener('input', (e) => {
      const c = settings.collections.find(c => c.id === col.id);
      if (c) { c.name = e.target.value; save(); }
    });

    item.querySelector('.col-folder').addEventListener('input', (e) => {
      const c = settings.collections.find(c => c.id === col.id);
      if (c) { c.folder = e.target.value; save(); updateFolderPreview(); }
    });

    item.querySelector('.btn-active').addEventListener('click', () => {
      settings.activeCollectionId = col.id;
      save();
      renderCollections();
      updateFolderPreview();
    });

    item.querySelector('.btn-delete').addEventListener('click', () => {
      if (settings.collections.length <= 1) {
        showStatus('You need at least one collection');
        return;
      }
      settings.collections = settings.collections.filter(c => c.id !== col.id);
      if (settings.activeCollectionId === col.id) {
        settings.activeCollectionId = settings.collections[0].id;
      }
      save();
      renderCollections();
      updateFolderPreview();
    });

    container.appendChild(node);
  }
}

// --- Events ---

function bindEvents() {
  // Add collection
  document.getElementById('add-collection').addEventListener('click', () => {
    const id = 'col_' + Date.now();
    settings.collections.push({ id, name: 'New Collection', folder: 'SaveNew' });
    save();
    renderCollections();
    const items = document.querySelectorAll('.collection-item');
    items[items.length - 1]?.querySelector('.col-name').focus();
  });

  // Organize by type toggle
  document.getElementById('organize-by-type').addEventListener('change', (e) => {
    settings.organizeByType = e.target.checked;
    toggleFolderNames(e.target.checked);
    save();
    updateFolderPreview();
  });

  // Folder name inputs
  for (const type of ['images', 'pages', 'media', 'notes', 'documents']) {
    document.getElementById(`folder-${type}`).addEventListener('input', (e) => {
      settings.folders[type] = e.target.value;
      save();
      updateFolderPreview();
    });
  }

  // Markdown method
  document.getElementById('markdown-method').addEventListener('change', (e) => {
    settings.markdownMethod = e.target.value;
    save();
  });

  // AI enabled toggle
  document.getElementById('ai-enabled').addEventListener('change', (e) => {
    settings.ai.enabled = e.target.checked;
    toggleAISettings(e.target.checked);
    save();
  });

  // AI URL
  document.getElementById('ai-url').addEventListener('input', (e) => {
    settings.ai.ollamaUrl = e.target.value;
    save();
  });

  // AI model
  document.getElementById('ai-model').addEventListener('input', (e) => {
    settings.ai.model = e.target.value;
    save();
  });

  // Test Ollama connection
  document.getElementById('test-ollama').addEventListener('click', testOllamaConnection);

  // Twitter/X enabled toggle
  document.getElementById('tw-enabled').addEventListener('change', (e) => {
    settings.twitter.enabled = e.target.checked;
    save();
  });

  // Twitter/X save PDF toggle
  document.getElementById('tw-save-pdf').addEventListener('change', (e) => {
    settings.twitter.savePdf = e.target.checked;
    save();
  });

  // YouTube enabled toggle
  document.getElementById('yt-enabled').addEventListener('change', (e) => {
    settings.youtube.enabled = e.target.checked;
    save();
  });

  // YouTube download toggle
  document.getElementById('yt-download').addEventListener('change', (e) => {
    settings.youtube.downloadVideo = e.target.checked;
    toggleCompanionSettings(e.target.checked);
    save();
  });

  // YouTube companion URL
  document.getElementById('yt-companion-url').addEventListener('input', (e) => {
    settings.youtube.companionUrl = e.target.value;
    save();
  });

  // YouTube quality
  document.getElementById('yt-quality').addEventListener('change', (e) => {
    settings.youtube.videoQuality = e.target.value;
    save();
  });

  // Test yt-dlp connection
  document.getElementById('test-ytdlp').addEventListener('click', testYtDlpConnection);

  // Chat FAB toggle
  document.getElementById('chat-show-fab').addEventListener('change', (e) => {
    settings.chat.showFab = e.target.checked;
    save();
  });

  // Notifications
  document.getElementById('show-notifications').addEventListener('change', (e) => {
    settings.showNotifications = e.target.checked;
    save();
  });
}

// --- UI Helpers ---

function toggleFolderNames(show) {
  document.getElementById('folder-names').style.display = show ? '' : 'none';
  document.getElementById('folder-preview').style.display = show ? '' : 'none';
}

function toggleAISettings(show) {
  document.getElementById('ai-settings').style.display = show ? '' : 'none';
}

function toggleCompanionSettings(show) {
  document.getElementById('yt-companion-settings').style.display = show ? '' : 'none';
}

async function testYtDlpConnection() {
  const btn = document.getElementById('test-ytdlp');
  const status = document.getElementById('ytdlp-status');

  btn.disabled = true;
  btn.textContent = 'Testing...';
  setStatusLoading(status, `Connecting to ${settings.youtube.companionUrl}...`);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'testYtDlp',
      url: settings.youtube.companionUrl,
    });

    if (response?.ok) {
      if (response.ytdlp) {
        const wpStatus = response.weasyprint
          ? ` weasyprint ${response.weasyprint_version || 'available'}.`
          : ' weasyprint: not installed.';
        setStatusResult(status,
          `Connected. yt-dlp ${response.version || 'available'}.${wpStatus} Ready to download.`,
          'success');
      } else {
        setStatusResult(status,
          'Server running but yt-dlp not found. Install with: pip install yt-dlp',
          'warning');
      }
    } else {
      setStatusResult(status, `Failed: ${response?.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    setStatusResult(status, `Cannot reach companion at ${settings.youtube.companionUrl}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Test Connection';
}

function updateFolderPreview() {
  const el = document.getElementById('folder-preview');
  const col = settings.collections.find(c => c.id === settings.activeCollectionId)
              || settings.collections[0];
  if (!settings.organizeByType) {
    el.textContent = '';
    return;
  }
  const f = settings.folders;
  el.textContent = `Preview: ~/Downloads/${col.folder}/${f.images}/, ${f.pages}/, ${f.media}/, ${f.notes}/, ${f.documents}/`;
}

function setStatusLoading(el, text) {
  el.className = 'ollama-status loading';
  el.innerHTML = `<span class="spinner"></span><span>${text}</span>`;
}

function setStatusResult(el, text, type) {
  el.className = `ollama-status ${type}`;
  el.innerHTML = `<span>${text}</span>`;
}

async function testOllamaConnection() {
  const btn = document.getElementById('test-ollama');
  const status = document.getElementById('ollama-status');

  btn.disabled = true;
  btn.textContent = 'Testing...';
  setStatusLoading(status, 'Connecting to Ollama...');

  try {
    // Step 1: Check connection and models
    setStatusLoading(status, `Connecting to ${settings.ai.ollamaUrl}...`);

    const response = await chrome.runtime.sendMessage({
      action: 'testOllama',
      url: settings.ai.ollamaUrl,
      model: settings.ai.model,
    });

    if (response?.ok) {
      const models = response.models || [];

      if (!response.modelExists) {
        setStatusResult(status,
          `Connected, but "${settings.ai.model}" not found. Available: ${models.slice(0, 5).join(', ') || 'none'}`,
          'warning');
      } else if (response.testPassed) {
        setStatusResult(status,
          `Connected and "${settings.ai.model}" responded. Ready to use.`,
          'success');
      } else {
        const reason = response.testError || 'unknown error';
        if (reason.includes('403')) {
          setStatusResult(status,
            `CORS blocked. Run in terminal: launchctl setenv OLLAMA_ORIGINS "chrome-extension://*" then restart Ollama.`,
            'error');
        } else {
          setStatusResult(status,
            `Model "${settings.ai.model}" found but failed to respond (${reason}).`,
            'warning');
        }
      }
    } else {
      setStatusResult(status, `Failed: ${response?.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    setStatusResult(status, `Cannot reach Ollama at ${settings.ai.ollamaUrl}`, 'error');
  }

  btn.disabled = false;
  btn.textContent = 'Test Connection';
}

// --- Persistence ---

let saveTimeout = null;

function save() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await chrome.storage.sync.set({ settings });
    showStatus('Settings saved');
  }, 400);
}

function showStatus(msg) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}
