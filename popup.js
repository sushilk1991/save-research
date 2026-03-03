// ============================================================
// Save Research — Popup
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
};

function isYouTubeUrl(url) {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') &&
      u.pathname === '/watch' && u.searchParams.has('v')
    ) || (
      u.hostname === 'youtu.be' && u.pathname.length > 1
    );
  } catch { return false; }
}

function isTwitterUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'x.com' || u.hostname === 'www.x.com' ||
            u.hostname === 'twitter.com' || u.hostname === 'www.twitter.com' ||
            u.hostname === 'mobile.twitter.com') &&
           /^\/[^/]+\/status\/\d+/.test(u.pathname);
  } catch { return false; }
}

document.addEventListener('DOMContentLoaded', async () => {
  const stored = await chrome.storage.sync.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...stored.settings };

  // Populate collection dropdown
  const select = document.getElementById('active-collection');
  for (const col of settings.collections) {
    const opt = document.createElement('option');
    opt.value = col.id;
    opt.textContent = col.name;
    if (col.id === settings.activeCollectionId) opt.selected = true;
    select.appendChild(opt);
  }

  // Show active folder path
  updateFolderPath(settings);

  // Switch active collection
  select.addEventListener('change', async (e) => {
    settings.activeCollectionId = e.target.value;
    await chrome.storage.sync.set({ settings });
    updateFolderPath(settings);
  });

  // Detect YouTube/Twitter tab and update button label
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    if (settings.youtube?.enabled && isYouTubeUrl(tab.url)) {
      document.getElementById('save-current').textContent = 'Save YouTube Video';
    } else if (settings.twitter?.enabled && isTwitterUrl(tab.url)) {
      document.getElementById('save-current').textContent = 'Save Tweet';
    }
  }

  // Save current page
  document.getElementById('save-current').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    // Send a synthetic context menu click for the current page
    const col = settings.collections.find(c => c.id === settings.activeCollectionId)
                || settings.collections[0];

    // Fire-and-forget — the overlay on the tab handles feedback
    chrome.runtime.sendMessage({
      action: 'savePage',
      url: tab.url,
      title: tab.title,
      collectionId: col.id,
      tabId: tab.id,
    });
    window.close();
  });

  // Open settings
  document.getElementById('open-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
});

function updateFolderPath(settings) {
  const col = settings.collections.find(c => c.id === settings.activeCollectionId)
              || settings.collections[0];
  document.getElementById('folder-path').textContent = `~/Downloads/${col.folder}/`;
}
