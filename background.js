// ============================================================
// Save Research — Background Service Worker
// ============================================================

// --- Default Settings ---

const DEFAULT_SETTINGS = {
  collections: [
    { id: 'research', name: 'Research', folder: 'SaveResearch' }
  ],
  activeCollectionId: 'research',
  organizeByType: true,
  showNotifications: true,
  markdownMethod: 'markdownnew', // 'markdownnew' | 'jina' | 'builtin'
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
    videoQuality: '720p', // '720p' | '1080p' | 'audio-only'
  },
  twitter: {
    enabled: true,
    savePdf: false,
  },
  chat: {
    showFab: true,
  },
};

// --- File Type Maps ---

const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tiff'
]);
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv'
]);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']);
const DOC_EXTS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv']);

// --- Storage Helpers ---

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  // Deep merge to handle nested objects (folders, ai)
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  merged.folders = { ...DEFAULT_SETTINGS.folders, ...(settings?.folders || {}) };
  merged.ai = { ...DEFAULT_SETTINGS.ai, ...(settings?.ai || {}) };
  merged.youtube = { ...DEFAULT_SETTINGS.youtube, ...(settings?.youtube || {}) };
  merged.twitter = { ...DEFAULT_SETTINGS.twitter, ...(settings?.twitter || {}) };
  merged.chat = { ...DEFAULT_SETTINGS.chat, ...(settings?.chat || {}) };
  return merged;
}

async function getActiveCollection() {
  const s = await getSettings();
  return s.collections.find(c => c.id === s.activeCollectionId) || s.collections[0];
}

function subfolderFor(type, settings) {
  if (!settings.organizeByType) return '';
  const name = settings.folders[type];
  return name ? name + '/' : '';
}

// --- Progress Overlay Helpers ---

function _nullProgress() {
  return { update() {}, done() {}, error() {} };
}

async function progressInit(tabId, steps) {
  if (!tabId) return _nullProgress();

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['progress.js'],
    });
  } catch (err) {
    console.warn(`[Save Research] Could not inject progress overlay: ${err.message}`);
    return _nullProgress();
  }

  const send = (payload) => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'sr-progress', ...payload });
    } catch {}
  };

  send({ type: 'init', steps });

  return {
    update(stepIndex, status, detail) {
      send({ type: 'update', stepIndex, status, detail });
    },
    done() {
      send({ type: 'done' });
    },
    error(message) {
      send({ type: 'error', message });
    },
  };
}

// --- Context Menu Setup ---

async function setupContextMenus() {
  await chrome.contextMenus.removeAll();

  const settings = await getSettings();
  const cols = settings.collections;
  const multi = cols.length > 1;

  const menuDefs = [
    { type: 'image',     label: 'Save Image',     contexts: ['image'] },
    { type: 'link',      label: 'Save Link',      contexts: ['link'] },
    { type: 'video',     label: 'Save Video',     contexts: ['video', 'audio'] },
    { type: 'page',      label: 'Save Page',      contexts: ['page'] },
    { type: 'selection', label: 'Save Selection', contexts: ['selection'] },
  ];

  if (multi) {
    for (const def of menuDefs) {
      chrome.contextMenus.create({
        id: `parent__${def.type}`,
        title: `${def.label} to...`,
        contexts: def.contexts,
      });
      for (const col of cols) {
        chrome.contextMenus.create({
          id: `${def.type}__${col.id}`,
          parentId: `parent__${def.type}`,
          title: col.name,
          contexts: def.contexts,
        });
      }
    }
  } else {
    const col = cols[0];
    for (const def of menuDefs) {
      chrome.contextMenus.create({
        id: `${def.type}__${col.id}`,
        title: `${def.label} to ${col.name}`,
        contexts: def.contexts,
      });
    }
  }
}

// --- Click Handler ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = info.menuItemId;
  if (typeof id !== 'string' || !id.includes('__')) return;
  if (id.startsWith('parent__')) return;

  const sepIdx = id.indexOf('__');
  const type = id.substring(0, sepIdx);
  const collectionId = id.substring(sepIdx + 2);

  const settings = await getSettings();
  const collection = settings.collections.find(c => c.id === collectionId);
  if (!collection) {
    notify('Error', 'Collection not found');
    return;
  }

  const tabId = tab?.id;

  try {
    switch (type) {
      case 'image':
        await saveImage(info.srcUrl, collection, settings, tabId);
        break;
      case 'link':
        await saveLink(info.linkUrl, collection, settings, tabId);
        break;
      case 'video':
        await saveMedia(info.srcUrl, collection, settings, tabId);
        break;
      case 'page':
        await savePage(tab.url, tab.title, collection, settings, tabId);
        break;
      case 'selection':
        await saveSelection(info.selectionText, tab.url, tab.title, collection, settings, tabId);
        break;
    }
  } catch (err) {
    console.error('Save Research error:', err);
    notify('Save Failed', err.message || 'Unknown error');
  }
});

// --- Save Handlers ---

async function saveImage(url, collection, settings, tabId) {
  if (!url) throw new Error('No image URL found');

  const steps = ['Saving file'];
  const progress = await progressInit(tabId, steps);

  try {
    progress.update(0, 'active');
    const filename = generateFilename(url, 'image');
    const path = `${collection.folder}/${subfolderFor('images', settings)}${filename}`;
    await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify' });
    progress.update(0, 'done');
    progress.done();
    notify('Image Saved', `Saved to ${collection.name}/${settings.folders.images || ''}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

async function saveLink(url, collection, settings, tabId) {
  if (!url) throw new Error('No link URL found');

  if (settings.youtube?.enabled && isYouTubeUrl(url)) {
    return saveYouTube(url, null, collection, settings, tabId);
  }

  if (settings.twitter?.enabled && isTwitterUrl(url)) {
    return saveTwitter(url, null, collection, settings, tabId);
  }

  const ext = getExtension(url);

  if (IMAGE_EXTS.has(ext)) return saveImage(url, collection, settings, tabId);
  if (VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) return saveMedia(url, collection, settings, tabId);
  if (DOC_EXTS.has(ext)) return saveDocument(url, collection, settings, tabId);

  return saveLinkAsMarkdown(url, collection, settings, tabId);
}

async function saveLinkAsMarkdown(url, collection, settings, tabId) {
  const aiEnabled = !!settings.ai?.enabled;
  const steps = ['Converting to Markdown'];
  if (aiEnabled) steps.push('AI enrichment');
  steps.push('Saving file');
  const progress = await progressInit(tabId, steps);

  try {
    let idx = 0;
    progress.update(idx, 'active');
    let markdown = await urlToMarkdown(url, settings.markdownMethod);
    progress.update(idx, 'done');

    idx++;
    if (aiEnabled) {
      progress.update(idx, 'active');
      markdown = await enrichWithAI(markdown, settings);
      progress.update(idx, 'done');
      idx++;
    }

    progress.update(idx, 'active');
    const title = extractTitleFromMarkdown(markdown) || titleFromUrl(url);
    const filename = sanitizeFilename(title) + '.md';
    const path = `${collection.folder}/${subfolderFor('pages', settings)}${filename}`;
    await downloadTextFile(markdown, path);
    progress.update(idx, 'done');

    progress.done();
    notify('Link Saved', `Saved "${title}" to ${collection.name}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

async function saveMedia(url, collection, settings, tabId) {
  if (!url) throw new Error('No media URL found');
  if (url.startsWith('blob:')) {
    throw new Error('Cannot download blob URLs directly. Try the page\'s own download button.');
  }

  const steps = ['Saving file'];
  const progress = await progressInit(tabId, steps);

  try {
    progress.update(0, 'active');
    const filename = generateFilename(url, 'media');
    const path = `${collection.folder}/${subfolderFor('media', settings)}${filename}`;
    await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify' });
    progress.update(0, 'done');
    progress.done();
    notify('Media Saved', `Saved to ${collection.name}/${settings.folders.media || ''}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

async function saveDocument(url, collection, settings, tabId) {
  const steps = ['Saving file'];
  const progress = await progressInit(tabId, steps);

  try {
    progress.update(0, 'active');
    const filename = generateFilename(url, 'document');
    const path = `${collection.folder}/${subfolderFor('documents', settings)}${filename}`;
    await chrome.downloads.download({ url, filename: path, conflictAction: 'uniquify' });
    progress.update(0, 'done');
    progress.done();
    notify('Document Saved', `Saved to ${collection.name}/${settings.folders.documents || ''}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

async function savePage(url, title, collection, settings, tabId) {
  if (!url) throw new Error('No page URL');

  if (settings.youtube?.enabled && isYouTubeUrl(url)) {
    return saveYouTube(url, 'tab', collection, settings, tabId);
  }

  if (settings.twitter?.enabled && isTwitterUrl(url)) {
    return saveTwitter(url, 'tab', collection, settings, tabId);
  }

  const aiEnabled = !!settings.ai?.enabled;
  const steps = ['Converting to Markdown'];
  if (aiEnabled) steps.push('AI enrichment');
  steps.push('Saving file');
  const progress = await progressInit(tabId, steps);

  try {
    let idx = 0;
    progress.update(idx, 'active');
    let markdown = await urlToMarkdown(url, settings.markdownMethod);
    progress.update(idx, 'done');

    idx++;
    if (aiEnabled) {
      progress.update(idx, 'active');
      markdown = await enrichWithAI(markdown, settings);
      progress.update(idx, 'done');
      idx++;
    }

    progress.update(idx, 'active');
    const pageTitle = title || extractTitleFromMarkdown(markdown) || titleFromUrl(url);
    const filename = sanitizeFilename(pageTitle) + '.md';
    const path = `${collection.folder}/${subfolderFor('pages', settings)}${filename}`;
    await downloadTextFile(markdown, path);
    progress.update(idx, 'done');

    progress.done();
    notify('Page Saved', `Saved "${pageTitle}" to ${collection.name}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

async function saveSelection(text, pageUrl, pageTitle, collection, settings, tabId) {
  if (!text) throw new Error('No text selected');

  const aiEnabled = !!settings.ai?.enabled;
  const steps = [];
  if (aiEnabled) steps.push('AI enrichment');
  steps.push('Saving note');
  const progress = await progressInit(tabId, steps);

  try {
    let idx = 0;
    const now = new Date().toISOString();
    let markdown = [
      '---',
      `source: ${pageUrl}`,
      `title: "${(pageTitle || '').replace(/"/g, '\\"')}"`,
      `saved: ${now}`,
      `type: selection`,
      '---',
      '',
      `> ${text.split('\n').join('\n> ')}`,
      '',
      `— [Source](${pageUrl})`,
      '',
    ].join('\n');

    if (aiEnabled) {
      progress.update(idx, 'active');
      markdown = await enrichWithAI(markdown, settings);
      progress.update(idx, 'done');
      idx++;
    }

    progress.update(idx, 'active');
    const filename = sanitizeFilename(`${pageTitle || 'selection'}-${timestamp()}`) + '.md';
    const path = `${collection.folder}/${subfolderFor('notes', settings)}${filename}`;
    await downloadTextFile(markdown, path);
    progress.update(idx, 'done');

    progress.done();
    notify('Selection Saved', `Saved to ${collection.name}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

// --- YouTube Detection & Utilities ---

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

function extractVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0];
    return u.searchParams.get('v') || '';
  } catch { return ''; }
}

function normalizeYouTubeUrl(url) {
  const id = extractVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${p(m)}:${p(s)}`;
  return `${m}:${p(s)}`;
}

// --- Twitter/X Detection & Utilities ---

function isTwitterUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'x.com' || u.hostname === 'www.x.com' ||
            u.hostname === 'twitter.com' || u.hostname === 'www.twitter.com' ||
            u.hostname === 'mobile.twitter.com') &&
           /^\/[^/]+\/status\/\d+/.test(u.pathname);
  } catch { return false; }
}

function extractTweetId(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  } catch { return ''; }
}

function extractTwitterAuthor(url) {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/^\/([^/]+)\/status\//);
    return match ? match[1] : '';
  } catch { return ''; }
}

function normalizeTwitterUrl(url) {
  try {
    const u = new URL(url);
    const userMatch = u.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
    if (userMatch) return `https://x.com/${userMatch[1]}/status/${userMatch[2]}`;
    return url;
  } catch { return url; }
}

// --- YouTube Extraction ---

async function extractYouTubeFromTab(url, tabId) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');
    tabId = tab.id;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const pr = window.ytInitialPlayerResponse;
      if (!pr) return null;
      const vd = pr.videoDetails || {};
      const mic = pr.microformat?.playerMicroformatRenderer || {};

      // Find caption track URL
      const captionTracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      let captionTrack = captionTracks.find(t => t.languageCode === 'en' && !t.kind) // manual English
                      || captionTracks.find(t => t.languageCode === 'en')             // auto English
                      || captionTracks[0];                                             // any language

      return {
        title: vd.title || '',
        channelName: vd.author || '',
        duration: parseInt(vd.lengthSeconds || '0', 10),
        description: vd.shortDescription || '',
        viewCount: vd.viewCount || '',
        publishDate: mic.publishDate || mic.uploadDate || '',
        thumbnail: vd.thumbnail?.thumbnails?.pop()?.url || '',
        captionTrackUrl: captionTrack?.baseUrl || '',
        captionLanguage: captionTrack?.languageCode || '',
        isAutoGenerated: captionTrack?.kind === 'asr',
      };
    },
  });

  const data = results?.[0]?.result;
  if (!data) throw new Error('Could not read ytInitialPlayerResponse from tab');
  return data;
}

async function extractYouTubeFromFetch(url) {
  const canonicalUrl = normalizeYouTubeUrl(url);
  const resp = await fetch(canonicalUrl, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`YouTube fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();

  // Brace-counting parser to extract ytInitialPlayerResponse JSON
  const marker = 'var ytInitialPlayerResponse = ';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('ytInitialPlayerResponse not found in page HTML');

  const jsonStart = start + marker.length;
  let depth = 0;
  let i = jsonStart;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('Failed to parse ytInitialPlayerResponse JSON');

  const pr = JSON.parse(html.substring(jsonStart, i + 1));
  const vd = pr.videoDetails || {};
  const mic = pr.microformat?.playerMicroformatRenderer || {};

  const captionTracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  let captionTrack = captionTracks.find(t => t.languageCode === 'en' && !t.kind)
                  || captionTracks.find(t => t.languageCode === 'en')
                  || captionTracks[0];

  return {
    title: vd.title || '',
    channelName: vd.author || '',
    duration: parseInt(vd.lengthSeconds || '0', 10),
    description: vd.shortDescription || '',
    viewCount: vd.viewCount || '',
    publishDate: mic.publishDate || mic.uploadDate || '',
    thumbnail: vd.thumbnail?.thumbnails?.pop()?.url || '',
    captionTrackUrl: captionTrack?.baseUrl || '',
    captionLanguage: captionTrack?.languageCode || '',
    isAutoGenerated: captionTrack?.kind === 'asr',
  };
}

// --- YouTube Transcript ---

async function fetchTranscript(baseUrl, tabId) {
  if (!baseUrl) return null;

  const transcriptUrl = baseUrl + '&fmt=json3';

  try {
    let json3;
    if (tabId) {
      // Inject fetch into YouTube tab (same-origin, has cookies)
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

    return json3;
  } catch (err) {
    console.warn('[Save Research] Transcript fetch failed:', err.message);
    return null;
  }
}

function formatTranscript(json3) {
  if (!json3?.events) return '';

  const lines = [];
  for (const event of json3.events) {
    if (!event.segs) continue;
    const text = event.segs.map(s => s.utf8 || '').join('').trim();
    if (!text) continue;

    const totalSeconds = Math.floor((event.tStartMs || 0) / 1000);
    const mm = Math.floor(totalSeconds / 60);
    const ss = totalSeconds % 60;
    lines.push(`[${p(mm)}:${p(ss)}] ${text}`);
  }
  return lines.join('\n');
}

// --- YouTube Markdown Assembly ---

function buildYouTubeMarkdown(url, videoData, transcript) {
  const canonicalUrl = normalizeYouTubeUrl(url);
  const now = new Date().toISOString();

  // Truncate description for the body (first 500 chars)
  const descExcerpt = videoData.description
    ? videoData.description.substring(0, 500) + (videoData.description.length > 500 ? '...' : '')
    : '';

  const parts = [
    '---',
    `source: ${canonicalUrl}`,
    `type: youtube`,
    `title: "${(videoData.title || '').replace(/"/g, '\\"')}"`,
    `channel: "${(videoData.channelName || '').replace(/"/g, '\\"')}"`,
    `duration: "${formatDuration(videoData.duration)}"`,
  ];

  if (videoData.publishDate) parts.push(`published: ${videoData.publishDate}`);
  if (videoData.viewCount) parts.push(`views: ${videoData.viewCount}`);
  parts.push(`saved: ${now}`);
  parts.push('---');
  parts.push('');
  parts.push(`# ${videoData.title || 'Untitled Video'}`);
  parts.push('');

  if (descExcerpt) {
    parts.push(descExcerpt);
    parts.push('');
  }

  if (transcript) {
    parts.push('## Transcript');
    parts.push('');
    parts.push(transcript);
    parts.push('');
  }

  return parts.join('\n');
}

// --- YouTube AI Enrichment ---

async function enrichYouTubeWithAI(markdown, videoData, transcript, settings) {
  if (!settings.ai?.enabled) return markdown;

  try {
    const available = await isModelAvailable(settings);
    if (!available) return markdown;

    const loaded = await isModelLoaded(settings);
    if (!loaded) {
      try { await loadModel(settings); } catch { return markdown; }
    }

    // Build AI input — prefer transcript, fall back to description
    const aiInput = transcript || videoData.description || '';
    if (!aiInput) return markdown;

    const snippet = aiInput.substring(0, 200000);

    const resp = await fetch(`${settings.ai.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ai.model,
        messages: [
          {
            role: 'system',
            content: 'You extract metadata from video transcripts. Respond with ONLY valid JSON — no markdown fences, no explanation, no extra text.',
          },
          {
            role: 'user',
            content: [
              `Video: "${videoData.title}" by ${videoData.channelName}`,
              '',
              'Extract metadata from this video transcript/description. Return JSON with exactly these fields:',
              '{"tags": ["3-7 lowercase topic tags"], "summary": "2-3 sentence summary of the key points, max 300 chars", "category": "one of: research, tutorial, reference, news, opinion, tool, other", "takeaways": ["3-5 key takeaways as short bullet points"]}',
              '',
              'Content:',
              snippet,
            ].join('\n'),
          },
        ],
        stream: false,
        think: false,
        options: { temperature: 0.1, num_predict: 800, num_ctx: 131072 },
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!resp.ok) return markdown;

    const data = await resp.json();
    const rawResponse = data?.message?.content || '';
    const cleaned = rawResponse
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json?\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const meta = JSON.parse(cleaned);

    console.log(`[Save Research] YouTube AI tags: ${JSON.stringify(meta.tags)}, category: ${meta.category}`);
    return injectYouTubeAIMetadata(markdown, meta);
  } catch (err) {
    console.warn(`[Save Research] YouTube AI enrichment skipped: ${err.message}`);
    return markdown;
  }
}

function injectYouTubeAIMetadata(markdown, meta) {
  if (!meta) return markdown;

  // 1. Inject into YAML frontmatter
  const fmLines = [];
  if (Array.isArray(meta.tags) && meta.tags.length > 0) {
    fmLines.push(`ai_tags: [${meta.tags.map(t => String(t).toLowerCase().trim()).join(', ')}]`);
  }
  if (meta.summary) {
    fmLines.push(`ai_summary: "${String(meta.summary).replace(/"/g, '\\"')}"`);
  }
  if (meta.category) {
    fmLines.push(`ai_category: ${String(meta.category).toLowerCase().trim()}`);
  }

  let result = markdown;
  if (fmLines.length > 0) {
    result = result.replace(/^(---\n[\s\S]*?)(---)/m, `$1${fmLines.join('\n')}\n$2`);
  }

  // 2. Add visible summary + tags after the first heading
  if (meta.summary) {
    const summary = String(meta.summary).trim();
    const tagsStr = Array.isArray(meta.tags) && meta.tags.length > 0
      ? meta.tags.map(t => `\`${String(t).toLowerCase().trim()}\``).join(' ')
      : '';
    const categoryStr = meta.category
      ? `**${String(meta.category).charAt(0).toUpperCase() + String(meta.category).slice(1)}**`
      : '';

    const summaryBlock = [
      '',
      `> **Summary:** ${summary}`,
      tagsStr ? `>\n> ${tagsStr}${categoryStr ? ' — ' + categoryStr : ''}` : '',
      '',
    ].filter(Boolean).join('\n');

    result = result.replace(/^(#\s+.+\n)/m, `$1${summaryBlock}\n`);
  }

  // 3. Add Key Takeaways section before Transcript
  if (Array.isArray(meta.takeaways) && meta.takeaways.length > 0) {
    const takeawaysBlock = [
      '## Key Takeaways',
      '',
      ...meta.takeaways.map(t => `- ${String(t).trim()}`),
      '',
    ].join('\n');

    // Insert before ## Transcript if it exists, otherwise before the end
    if (result.includes('## Transcript')) {
      result = result.replace('## Transcript', `${takeawaysBlock}\n## Transcript`);
    } else {
      result = result.trimEnd() + '\n\n' + takeawaysBlock;
    }
  }

  return result;
}

// --- yt-dlp Companion Integration ---

async function downloadViaYtDlp(url, title, collection, settings) {
  const yt = settings.youtube;
  if (!yt?.downloadVideo) return;

  try {
    // Health check
    const healthResp = await fetch(`${yt.companionUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthResp.ok) {
      console.warn('[Save Research] yt-dlp companion not reachable');
      return;
    }
    const health = await healthResp.json();
    if (!health.ytdlp) {
      console.warn('[Save Research] yt-dlp not installed on companion server');
      return;
    }

    // Build output directory
    const mediaSubfolder = subfolderFor('media', settings);
    const outputDir = mediaSubfolder
      ? `${collection.folder}/${mediaSubfolder}`
      : `${collection.folder}/`;

    // Request download
    const dlResp = await fetch(`${yt.companionUrl}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: normalizeYouTubeUrl(url),
        output_dir: outputDir,
        quality: yt.videoQuality || '720p',
      }),
      signal: AbortSignal.timeout(600000), // 10 min timeout for downloads
    });

    if (!dlResp.ok) {
      const err = await dlResp.text();
      console.warn(`[Save Research] yt-dlp download failed: ${err}`);
      return;
    }

    const result = await dlResp.json();
    console.log(`[Save Research] Video downloaded: ${result.filename || 'unknown'}`);
    notify('Video Downloaded', `Downloaded "${title}" via yt-dlp`);
  } catch (err) {
    console.warn(`[Save Research] yt-dlp download error: ${err.message}`);
  }
}

// --- YouTube Save Orchestrator ---

async function saveYouTube(url, source, collection, settings, tabId) {
  const canonicalUrl = normalizeYouTubeUrl(url);
  const fromTab = source === 'tab';

  const aiEnabled = !!settings.ai?.enabled;
  const downloadVideo = !!settings.youtube?.downloadVideo;
  const steps = ['Extracting video metadata', 'Fetching transcript', 'Building note'];
  if (aiEnabled) steps.push('AI enrichment');
  steps.push('Saving file');
  if (downloadVideo) steps.push('Downloading video');
  const progress = await progressInit(tabId, steps);

  try {
    let idx = 0;

    // 1. Extract video data
    progress.update(idx, 'active');
    let videoData;
    try {
      videoData = fromTab
        ? await extractYouTubeFromTab(canonicalUrl, tabId)
        : await extractYouTubeFromFetch(canonicalUrl);
    } catch (err) {
      console.warn(`[Save Research] YouTube extraction failed (${fromTab ? 'tab' : 'fetch'}): ${err.message}`);
      if (fromTab) {
        try {
          videoData = await extractYouTubeFromFetch(canonicalUrl);
        } catch (err2) {
          console.warn(`[Save Research] YouTube fetch fallback also failed: ${err2.message}`);
          progress.error('Could not extract video data — saving as page');
          return saveLinkAsMarkdown(url, collection, settings, tabId);
        }
      } else {
        progress.error('Could not extract video data — saving as page');
        return saveLinkAsMarkdown(url, collection, settings, tabId);
      }
    }
    progress.update(idx, 'done');
    idx++;

    // 2. Fetch transcript
    progress.update(idx, 'active');
    let transcript = '';
    if (videoData.captionTrackUrl) {
      const json3 = await fetchTranscript(videoData.captionTrackUrl, fromTab ? tabId : null);
      if (json3) transcript = formatTranscript(json3);
    }
    progress.update(idx, transcript ? 'done' : 'skip');
    idx++;

    // 3. Build markdown
    progress.update(idx, 'active');
    let markdown = buildYouTubeMarkdown(canonicalUrl, videoData, transcript);
    progress.update(idx, 'done');
    idx++;

    // 4. AI enrichment
    if (aiEnabled) {
      progress.update(idx, 'active');
      markdown = await enrichYouTubeWithAI(markdown, videoData, transcript, settings);
      progress.update(idx, 'done');
      idx++;
    }

    // 5. Save markdown file
    progress.update(idx, 'active');
    const title = videoData.title || titleFromUrl(canonicalUrl);
    const filename = sanitizeFilename(title) + '.md';
    const path = `${collection.folder}/${subfolderFor('pages', settings)}${filename}`;
    await downloadTextFile(markdown, path);
    progress.update(idx, 'done');
    idx++;

    // 6. yt-dlp download (non-blocking, fire-and-forget)
    if (downloadVideo) {
      progress.update(idx, 'active');
      downloadViaYtDlp(canonicalUrl, title, collection, settings).then(() => {
        progress.update(idx, 'done');
        progress.done();
      }).catch(() => {
        progress.update(idx, 'skip');
        progress.done();
      });
    } else {
      progress.done();
    }

    notify('YouTube Saved', `Saved "${title}" to ${collection.name}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

// --- Twitter/X DOM Extraction ---

function _extractTweetsFromDOM(threadAuthor) {
  const tweetEls = document.querySelectorAll('[data-testid="tweet"]');
  if (!tweetEls.length) return [];

  // Normalize the expected author handle for comparison
  const expectedHandle = threadAuthor
    ? (threadAuthor.startsWith('@') ? threadAuthor : `@${threadAuthor}`).toLowerCase()
    : null;

  const tweets = [];
  let firstAuthorHandle = null;

  for (const el of tweetEls) {
    // Author info from User-Name testid — extract early so we can filter
    const userNameEl = el.querySelector('[data-testid="User-Name"]');
    let authorName = '';
    let authorHandle = '';
    if (userNameEl) {
      const spans = userNameEl.querySelectorAll('span');
      for (const span of spans) {
        const t = span.textContent.trim();
        if (t.startsWith('@') && !authorHandle) {
          authorHandle = t;
        } else if (t && !authorName && !t.startsWith('@') && t !== '·' && !t.includes('·')) {
          authorName = t;
        }
      }
    }

    // Determine the thread author: use the URL-based handle if provided,
    // otherwise use the first tweet's author as the thread owner
    if (!firstAuthorHandle && authorHandle) {
      firstAuthorHandle = authorHandle.toLowerCase();
    }
    const threadOwner = expectedHandle || firstAuthorHandle;

    // Skip tweets from other users (replies/comments, not part of the thread)
    if (threadOwner && authorHandle && authorHandle.toLowerCase() !== threadOwner) {
      continue;
    }

    // Text content — preserve line breaks and emoji
    const textEl = el.querySelector('[data-testid="tweetText"]');
    let text = '';
    if (textEl) {
      const parts = [];
      for (const node of textEl.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.textContent);
        } else if (node.tagName === 'BR') {
          parts.push('\n');
        } else if (node.tagName === 'IMG' && node.alt) {
          parts.push(node.alt); // emoji
        } else if (node.tagName === 'A') {
          parts.push(node.textContent);
        } else {
          parts.push(node.textContent || '');
        }
      }
      text = parts.join('');
    }

    // Timestamp
    const timeEl = el.querySelector('time[datetime]');
    const timestamp = timeEl?.getAttribute('datetime') || '';

    // Permalink
    let permalink = '';
    const timeLink = el.querySelector('a[href*="/status/"]');
    if (timeLink) {
      const href = timeLink.getAttribute('href');
      if (href) permalink = href.startsWith('http') ? href : `https://x.com${href}`;
    }

    // Media — images
    const mediaUrls = [];
    const photoEls = el.querySelectorAll('[data-testid="tweetPhoto"] img');
    for (const img of photoEls) {
      let src = img.src || '';
      if (src.includes('pbs.twimg.com/media/')) {
        // Normalize to large format
        const base = src.split('?')[0];
        src = `${base}?format=jpg&name=large`;
      }
      if (src) mediaUrls.push(src);
    }

    // Video poster/thumbnail
    const videoEls = el.querySelectorAll('[data-testid="videoPlayer"] video[poster]');
    for (const vid of videoEls) {
      if (vid.poster) mediaUrls.push(vid.poster);
    }

    // Metrics from aria-labels
    const metrics = {};
    const metricGroup = el.querySelector('[role="group"]');
    if (metricGroup) {
      const buttons = metricGroup.querySelectorAll('button[aria-label]');
      for (const btn of buttons) {
        const label = btn.getAttribute('aria-label') || '';
        const replyMatch = label.match(/(\d[\d,]*)\s*repl/i);
        const repostMatch = label.match(/(\d[\d,]*)\s*repost/i);
        const likeMatch = label.match(/(\d[\d,]*)\s*like/i);
        const viewMatch = label.match(/(\d[\d,]*)\s*view/i);
        const bookmarkMatch = label.match(/(\d[\d,]*)\s*bookmark/i);
        if (replyMatch) metrics.replies = replyMatch[1];
        if (repostMatch) metrics.reposts = repostMatch[1];
        if (likeMatch) metrics.likes = likeMatch[1];
        if (viewMatch) metrics.views = viewMatch[1];
        if (bookmarkMatch) metrics.bookmarks = bookmarkMatch[1];
      }
    }

    tweets.push({ text, authorName, authorHandle, timestamp, permalink, mediaUrls, metrics });
  }

  return tweets;
}

// --- Twitter Tab Extraction + Background Tab Fallback ---

async function extractTwitterFromTab(tabId, authorHandle) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');
    tabId = tab.id;
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: _extractTweetsFromDOM,
    args: [authorHandle || null],
  });

  const tweets = results?.[0]?.result;
  if (!tweets || tweets.length === 0) throw new Error('No tweets found in tab DOM');
  return tweets;
}

async function extractTwitterFromBackgroundTab(url) {
  const authorHandle = extractTwitterAuthor(url);
  const tab = await chrome.tabs.create({ url, active: false });

  try {
    // Wait for tab to finish loading
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Background tab load timed out'));
      }, 20000);

      function listener(tabId, changeInfo) {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      }
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Extra delay for X's SPA rendering
    await new Promise(r => setTimeout(r, 3000));

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: _extractTweetsFromDOM,
      args: [authorHandle || null],
    });

    const tweets = results?.[0]?.result;
    if (!tweets || tweets.length === 0) throw new Error('No tweets found in background tab DOM');
    return tweets;
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

// --- Twitter Markdown Assembly ---

function buildTwitterMarkdown(url, tweets) {
  const canonicalUrl = normalizeTwitterUrl(url);
  const now = new Date().toISOString();
  const main = tweets[0];

  const parts = [
    '---',
    `source: ${canonicalUrl}`,
    `type: tweet`,
    `author: "${main.authorHandle || ''}"`,
    `author_name: "${(main.authorName || '').replace(/"/g, '\\"')}"`,
  ];

  if (main.timestamp) parts.push(`posted: ${main.timestamp}`);
  parts.push(`saved: ${now}`);
  if (tweets.length > 1) parts.push(`thread_length: ${tweets.length}`);
  parts.push('---');
  parts.push('');
  parts.push(`# Tweet by ${main.authorName || main.authorHandle || 'Unknown'}`);
  parts.push('');

  // First tweet text
  if (main.text) {
    parts.push(main.text);
    parts.push('');
  }

  // First tweet media
  for (const mediaUrl of main.mediaUrls || []) {
    parts.push(`![Tweet media](${mediaUrl})`);
    parts.push('');
  }

  // Subsequent tweets in thread
  for (let i = 1; i < tweets.length; i++) {
    const t = tweets[i];
    parts.push('---');
    parts.push('');

    // Attribution line
    const dateStr = t.timestamp ? formatTwitterDate(t.timestamp) : '';
    const attribution = [
      `**${t.authorName || t.authorHandle || 'Unknown'}**`,
      t.authorHandle ? `(${t.authorHandle})` : '',
      dateStr ? `— *${dateStr}*` : '',
    ].filter(Boolean).join(' ');
    parts.push(attribution);
    parts.push('');

    if (t.text) {
      parts.push(t.text);
      parts.push('');
    }

    for (const mediaUrl of t.mediaUrls || []) {
      parts.push(`![Tweet media](${mediaUrl})`);
      parts.push('');
    }
  }

  // Metrics blockquote (main tweet)
  const m = main.metrics || {};
  const metricParts = [];
  if (m.likes) metricParts.push(`Likes: ${m.likes}`);
  if (m.reposts) metricParts.push(`Retweets: ${m.reposts}`);
  if (m.replies) metricParts.push(`Replies: ${m.replies}`);
  if (m.views) metricParts.push(`Views: ${m.views}`);
  if (m.bookmarks) metricParts.push(`Bookmarks: ${m.bookmarks}`);

  if (metricParts.length > 0) {
    parts.push('---');
    parts.push('');
    parts.push(`> ${metricParts.join(' · ')}`);
    parts.push('');
  }

  return parts.join('\n');
}

function formatTwitterDate(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// --- Twitter AI Enrichment ---

async function enrichTwitterWithAI(markdown, tweets, settings) {
  if (!settings.ai?.enabled) return markdown;

  try {
    const available = await isModelAvailable(settings);
    if (!available) return markdown;

    const loaded = await isModelLoaded(settings);
    if (!loaded) {
      try { await loadModel(settings); } catch { return markdown; }
    }

    // Combine all tweet text for analysis
    const combinedText = tweets.map(t => t.text).filter(Boolean).join('\n\n');
    if (!combinedText) return markdown;

    const main = tweets[0];

    const resp = await fetch(`${settings.ai.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ai.model,
        messages: [
          {
            role: 'system',
            content: 'You extract metadata from tweets. Respond with ONLY valid JSON — no markdown fences, no explanation, no extra text.',
          },
          {
            role: 'user',
            content: [
              `Tweet by ${main.authorName || main.authorHandle || 'unknown'}${tweets.length > 1 ? ` (thread of ${tweets.length})` : ''}:`,
              '',
              'Extract metadata from this tweet. Return JSON with exactly these fields:',
              '{"tags": ["3-7 lowercase topic tags"], "summary": "1-2 sentence summary, max 200 chars", "category": "one of: research, tutorial, reference, news, opinion, tool, other"}',
              '',
              'Content:',
              combinedText,
            ].join('\n'),
          },
        ],
        stream: false,
        think: false,
        options: { temperature: 0.1, num_predict: 500, num_ctx: 131072 },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) return markdown;

    const data = await resp.json();
    const rawResponse = data?.message?.content || '';
    const cleaned = rawResponse
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json?\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const meta = JSON.parse(cleaned);

    console.log(`[Save Research] Twitter AI tags: ${JSON.stringify(meta.tags)}, category: ${meta.category}`);
    return injectAIMetadata(markdown, meta);
  } catch (err) {
    console.warn(`[Save Research] Twitter AI enrichment skipped: ${err.message}`);
    return markdown;
  }
}

// --- Twitter PDF Companion Call ---

async function generateTweetPdf(url, tweets, collection, settings) {
  if (!settings.twitter?.savePdf) return;

  const companionUrl = settings.youtube?.companionUrl;
  if (!companionUrl) return;

  try {
    // Health check
    const healthResp = await fetch(`${companionUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!healthResp.ok) {
      console.warn('[Save Research] Companion server not reachable for tweet PDF');
      return;
    }
    const health = await healthResp.json();
    if (!health.weasyprint) {
      console.warn('[Save Research] weasyprint not available — skipping tweet PDF');
      return;
    }

    // Build output directory
    const mediaSubfolder = subfolderFor('pages', settings);
    const outputDir = mediaSubfolder
      ? `${collection.folder}/${mediaSubfolder}`
      : `${collection.folder}/`;

    const main = tweets[0];
    const titleSnippet = (main.text || '').substring(0, 60).replace(/\n/g, ' ');
    const filename = sanitizeFilename(`${main.authorName || main.authorHandle || 'tweet'} - ${titleSnippet}`);

    const dlResp = await fetch(`${companionUrl}/tweet-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tweets,
        output_dir: outputDir,
        filename,
        source_url: normalizeTwitterUrl(url),
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!dlResp.ok) {
      const err = await dlResp.text();
      console.warn(`[Save Research] Tweet PDF generation failed: ${err}`);
      return;
    }

    const result = await dlResp.json();
    console.log(`[Save Research] Tweet PDF saved: ${result.filename || 'unknown'}`);
  } catch (err) {
    console.warn(`[Save Research] Tweet PDF error: ${err.message}`);
  }
}

// --- Twitter Save Orchestrator ---

async function saveTwitter(url, source, collection, settings, tabId) {
  const canonicalUrl = normalizeTwitterUrl(url);
  const fromTab = source === 'tab';

  const aiEnabled = !!settings.ai?.enabled;
  const savePdf = !!settings.twitter?.savePdf;
  const steps = ['Extracting tweet data', 'Building note'];
  if (aiEnabled) steps.push('AI enrichment');
  steps.push('Saving file');
  if (savePdf) steps.push('Generating PDF');
  const progress = await progressInit(tabId, steps);

  try {
    let idx = 0;

    // 1. Extract tweets from DOM
    progress.update(idx, 'active');
    let tweets;
    const authorHandle = extractTwitterAuthor(canonicalUrl);
    try {
      tweets = fromTab
        ? await extractTwitterFromTab(tabId, authorHandle)
        : await extractTwitterFromBackgroundTab(canonicalUrl);
    } catch (err) {
      console.warn(`[Save Research] Twitter extraction failed (${fromTab ? 'tab' : 'background'}): ${err.message}`);
      if (fromTab) {
        try {
          tweets = await extractTwitterFromBackgroundTab(canonicalUrl);
        } catch (err2) {
          console.warn(`[Save Research] Twitter background tab fallback also failed: ${err2.message}`);
          progress.error('Could not extract tweet data — saving as page');
          return saveLinkAsMarkdown(url, collection, settings, tabId);
        }
      } else {
        progress.error('Could not extract tweet data — saving as page');
        return saveLinkAsMarkdown(url, collection, settings, tabId);
      }
    }
    progress.update(idx, 'done');
    idx++;

    // 2. Build markdown
    progress.update(idx, 'active');
    let markdown = buildTwitterMarkdown(canonicalUrl, tweets);
    progress.update(idx, 'done');
    idx++;

    // 3. AI enrichment
    if (aiEnabled) {
      progress.update(idx, 'active');
      markdown = await enrichTwitterWithAI(markdown, tweets, settings);
      progress.update(idx, 'done');
      idx++;
    }

    // 4. Save markdown file
    progress.update(idx, 'active');
    const main = tweets[0];
    const titleSnippet = (main.text || '').substring(0, 60).replace(/\n/g, ' ');
    const title = `${main.authorName || main.authorHandle || 'Tweet'} - ${titleSnippet}`;
    const filename = sanitizeFilename(title) + '.md';
    const path = `${collection.folder}/${subfolderFor('pages', settings)}${filename}`;
    await downloadTextFile(markdown, path);
    progress.update(idx, 'done');
    idx++;

    // 5. PDF generation (non-blocking, fire-and-forget)
    if (savePdf) {
      progress.update(idx, 'active');
      generateTweetPdf(canonicalUrl, tweets, collection, settings).then(() => {
        progress.update(idx, 'done');
        progress.done();
      }).catch(() => {
        progress.update(idx, 'skip');
        progress.done();
      });
    } else {
      progress.done();
    }

    notify('Tweet Saved', `Saved "${main.authorName || main.authorHandle || 'tweet'}" to ${collection.name}`);
  } catch (err) {
    progress.error(err.message);
    notify('Save Failed', err.message);
    throw err;
  }
}

// --- AI Enrichment (Ollama) ---

// Cache model availability to avoid hitting /api/tags on every save
let _modelCache = { model: null, url: null, available: null, checkedAt: 0 };
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function isModelAvailable(settings) {
  const now = Date.now();
  const ai = settings.ai;

  // Return cached result if still fresh
  if (_modelCache.model === ai.model &&
      _modelCache.url === ai.ollamaUrl &&
      now - _modelCache.checkedAt < MODEL_CACHE_TTL) {
    return _modelCache.available;
  }

  try {
    const resp = await fetch(`${ai.ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) {
      _modelCache = { model: ai.model, url: ai.ollamaUrl, available: false, checkedAt: now };
      return false;
    }
    const data = await resp.json();
    const models = data.models || [];
    // Match exact name or name without tag (e.g. "qwen3:0.5b" matches "qwen3:0.5b")
    const available = models.some(m => m.name === ai.model);
    _modelCache = { model: ai.model, url: ai.ollamaUrl, available, checkedAt: now };
    return available;
  } catch {
    _modelCache = { model: ai.model, url: ai.ollamaUrl, available: false, checkedAt: now };
    return false;
  }
}

async function isModelLoaded(settings) {
  try {
    const resp = await fetch(`${settings.ai.ollamaUrl}/api/ps`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return (data.models || []).some(m => m.name === settings.ai.model);
  } catch {
    return false;
  }
}

async function loadModel(settings) {
  console.log(`[Save Research] Loading model "${settings.ai.model}" into memory...`);
  const resp = await fetch(`${settings.ai.ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ai.model,
      prompt: '',
      stream: false,
      keep_alive: '10m',
    }),
    signal: AbortSignal.timeout(120000), // Model loading can take up to 2 min
  });
  if (!resp.ok) throw new Error(`Load failed: HTTP ${resp.status}`);
  console.log(`[Save Research] Model "${settings.ai.model}" loaded and ready`);
}

/**
 * Pre-warm the model on startup so first save is fast.
 * Fire-and-forget — failures are logged but don't block anything.
 */
async function preloadModel(settings) {
  if (!settings.ai?.enabled) return;

  try {
    const available = await isModelAvailable(settings);
    if (!available) {
      console.log(`[Save Research] Model "${settings.ai.model}" not pulled in Ollama — AI tagging will be skipped`);
      return;
    }

    const loaded = await isModelLoaded(settings);
    if (loaded) {
      console.log(`[Save Research] Model "${settings.ai.model}" already loaded`);
      return;
    }

    await loadModel(settings);
  } catch (err) {
    console.warn(`[Save Research] Model preload failed: ${err.message}`);
  }
}

async function enrichWithAI(markdown, settings) {
  if (!settings.ai?.enabled) return markdown;

  try {
    // Check if model is pulled — skip entirely if not
    const available = await isModelAvailable(settings);
    if (!available) {
      console.log(`[Save Research] Model "${settings.ai.model}" not available, skipping AI enrichment`);
      return markdown;
    }

    // Ensure model is loaded into memory (no-op if already loaded)
    const loaded = await isModelLoaded(settings);
    if (!loaded) {
      try {
        await loadModel(settings);
      } catch (loadErr) {
        console.warn(`[Save Research] Could not load model: ${loadErr.message}`);
        return markdown;
      }
    }

    // Send generous content — qwen3.5:4b supports 256K context and
    // we set num_ctx=131072 (128K). ~200K chars ≈ ~50K tokens, well within range.
    const snippet = markdown.substring(0, 200000);

    const resp = await fetch(`${settings.ai.ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ai.model,
        messages: [
          {
            role: 'system',
            content: 'You extract metadata from articles. Respond with ONLY valid JSON — no markdown fences, no explanation, no extra text.'
          },
          {
            role: 'user',
            content: [
              'Extract metadata from this content. Return JSON with exactly these fields:',
              '{"tags": ["3-7 lowercase topic tags"], "summary": "2-3 sentence summary of the key points, max 300 chars", "category": "one of: research, tutorial, reference, news, opinion, tool, other"}',
              '',
              'Content:',
              snippet
            ].join('\n')
          }
        ],
        stream: false,
        think: false, // Disable thinking mode — we need direct JSON output
        options: { temperature: 0.1, num_predict: 500, num_ctx: 131072 },
      }),
      signal: AbortSignal.timeout(60000), // Allow more time for larger context
    });

    if (!resp.ok) {
      console.warn(`[Save Research] Ollama returned ${resp.status} — saving without AI tags`);
      return markdown;
    }

    const data = await resp.json();
    const rawResponse = data?.message?.content || '';

    // Extract JSON from response (handle models that wrap in code fences or <think> tags)
    const cleaned = rawResponse
      .replace(/<think>[\s\S]*?<\/think>/gi, '')  // Strip thinking tags (qwen3)
      .replace(/```json?\s*/gi, '')
      .replace(/```/g, '')
      .trim();
    const meta = JSON.parse(cleaned);

    console.log(`[Save Research] AI tags: ${JSON.stringify(meta.tags)}, category: ${meta.category}`);
    return injectAIMetadata(markdown, meta);
  } catch (err) {
    console.warn(`[Save Research] AI enrichment skipped: ${err.message}`);
    return markdown;
  }
}

function injectAIMetadata(markdown, meta) {
  if (!meta) return markdown;

  // 1. Inject into YAML frontmatter
  const fmLines = [];
  if (Array.isArray(meta.tags) && meta.tags.length > 0) {
    fmLines.push(`ai_tags: [${meta.tags.map(t => String(t).toLowerCase().trim()).join(', ')}]`);
  }
  if (meta.summary) {
    fmLines.push(`ai_summary: "${String(meta.summary).replace(/"/g, '\\"')}"`);
  }
  if (meta.category) {
    fmLines.push(`ai_category: ${String(meta.category).toLowerCase().trim()}`);
  }

  let result = markdown;
  if (fmLines.length > 0) {
    result = result.replace(/^(---\n[\s\S]*?)(---)/m, `$1${fmLines.join('\n')}\n$2`);
  }

  // 2. Add visible summary block after the first heading in the body
  if (meta.summary) {
    const summary = String(meta.summary).trim();
    const tagsStr = Array.isArray(meta.tags) && meta.tags.length > 0
      ? meta.tags.map(t => `\`${String(t).toLowerCase().trim()}\``).join(' ')
      : '';
    const categoryStr = meta.category
      ? `**${String(meta.category).charAt(0).toUpperCase() + String(meta.category).slice(1)}**`
      : '';

    const summaryBlock = [
      '',
      `> **Summary:** ${summary}`,
      tagsStr ? `>\n> ${tagsStr}${categoryStr ? ' — ' + categoryStr : ''}` : '',
      '',
    ].filter(Boolean).join('\n');

    // Insert after the first markdown heading
    result = result.replace(/^(#\s+.+\n)/m, `$1${summaryBlock}\n`);
  }

  return result;
}

// --- Markdown Conversion ---

async function urlToMarkdown(url, method) {
  if (method === 'markdownnew') return fetchViaMarkdownNew(url);
  if (method === 'jina') return fetchViaJina(url);
  return fetchAndConvert(url);
}

async function fetchViaMarkdownNew(url) {
  try {
    const resp = await fetch(`https://markdown.new/${url}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      console.warn(`markdown.new returned ${resp.status}, falling back to Jina`);
      return fetchViaJina(url);
    }
    const text = await resp.text();
    if (!text || text.length < 50) {
      console.warn('markdown.new returned empty response, falling back to Jina');
      return fetchViaJina(url);
    }
    const now = new Date().toISOString();
    return `---\nsource: ${url}\nsaved: ${now}\nconverter: markdown.new\n---\n\n${text}`;
  } catch (err) {
    console.warn('markdown.new failed:', err.message, '— falling back to Jina');
    return fetchViaJina(url);
  }
}

async function fetchViaJina(url) {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/markdown' },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      console.warn(`Jina returned ${resp.status}, falling back to built-in`);
      return fetchAndConvert(url);
    }
    const text = await resp.text();
    if (!text || text.length < 50) return fetchAndConvert(url);
    const now = new Date().toISOString();
    return `---\nsource: ${url}\nsaved: ${now}\nconverter: jina\n---\n\n${text}`;
  } catch (err) {
    console.warn('Jina failed:', err.message, '— falling back to built-in');
    return fetchAndConvert(url);
  }
}

async function fetchAndConvert(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`Failed to fetch page: ${resp.status}`);
  const html = await resp.text();
  return htmlToMarkdown(html, url);
}

function htmlToMarkdown(html, sourceUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : 'Untitled';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let content = bodyMatch ? bodyMatch[1] : html;

  content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
  content = content.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  content = content.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  content = content.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  content = content.replace(/<header[\s\S]*?<\/header>/gi, '');

  content = content.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n\n');
  content = content.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n\n');
  content = content.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n\n');
  content = content.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n\n');
  content = content.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '\n##### $1\n\n');
  content = content.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '\n###### $1\n\n');

  content = content.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  content = content.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, '$1\n');
  content = content.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  content = content.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
  content = content.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
  content = content.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
  content = content.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  content = content.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  content = content.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  content = content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n\n');
  content = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  content = content.replace(/<\/?[uo]l[^>]*>/gi, '\n');
  content = content.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n\n');
  content = content.replace(/<hr[^>]*\/?>/gi, '\n---\n\n');
  content = content.replace(/<br[^>]*\/?>/gi, '\n');
  content = content.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '$1|\n');
  content = content.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, '| $1 ');
  content = content.replace(/<\/?table[^>]*>/gi, '\n');
  content = content.replace(/<\/?thead[^>]*>/gi, '');
  content = content.replace(/<\/?tbody[^>]*>/gi, '');
  content = content.replace(/<[^>]+>/g, '');

  content = decodeEntities(content);
  content = content.replace(/[ \t]+$/gm, '');
  content = content.replace(/\n{3,}/g, '\n\n');
  content = content.trim();

  const now = new Date().toISOString();
  return [
    '---',
    `source: ${sourceUrl}`,
    `title: "${title.replace(/"/g, '\\"')}"`,
    `saved: ${now}`,
    '---',
    '',
    `# ${title}`,
    '',
    content,
    '',
  ].join('\n');
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// --- Download Helpers ---

async function downloadTextFile(content, path) {
  const encoded = encodeURIComponent(content);
  if (encoded.length > 5 * 1024 * 1024) {
    throw new Error('Content too large. Try saving a shorter page.');
  }
  const dataUrl = `data:text/markdown;charset=utf-8,${encoded}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: path,
    conflictAction: 'uniquify',
  });
}

// --- Filename Utilities ---

function getExtension(url) {
  try {
    const u = new URL(url);

    // 1. Check pathname for extension (e.g. /photo.jpg)
    const pathname = u.pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot !== -1) {
      const ext = pathname.substring(dot + 1).toLowerCase();
      if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext)) return ext;
    }

    // 2. Check query params: ?format=jpg, ?type=png, ?ext=webp
    for (const key of ['format', 'type', 'ext', 'f']) {
      const val = u.searchParams.get(key);
      if (val && val.length <= 5 && /^[a-z0-9]+$/i.test(val)) return val.toLowerCase();
    }

    return '';
  } catch { return ''; }
}

const DEFAULT_EXT = { image: 'jpg', media: 'mp4', document: 'pdf' };

function generateFilename(url, contentType) {
  try {
    const u = new URL(url);
    let name = u.pathname.split('/').pop();
    name = name.split('?')[0].split('#')[0];

    if (!name || name === '' || name === '/') {
      name = `${contentType}-${timestamp()}`;
    }

    name = sanitizeFilename(decodeURIComponent(name));

    // Ensure the filename has an extension
    if (!name.includes('.') || name.endsWith('.')) {
      const ext = getExtension(url) || DEFAULT_EXT[contentType] || '';
      if (ext) name = name.replace(/\.+$/, '') + '.' + ext;
    }

    return name;
  } catch {
    const ext = DEFAULT_EXT[contentType] || '';
    return `${contentType}-${timestamp()}${ext ? '.' + ext : ''}`;
  }
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .substring(0, 200) || 'untitled';
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '').split('/').pop();
    return path ? decodeURIComponent(path) : u.hostname;
  } catch { return 'page'; }
}

function extractTitleFromMarkdown(md) {
  const fmMatch = md.match(/^---[\s\S]*?title:\s*"?([^"\n]+)"?[\s\S]*?---/);
  if (fmMatch) return fmMatch[1].trim();
  const h1Match = md.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  return null;
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function p(n) { return String(n).padStart(2, '0'); }

// --- Notifications ---

async function notify(title, message) {
  const settings = await getSettings();
  if (!settings.showNotifications) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `Save Research: ${title}`,
    message,
  });
}

// --- Chat Side Panel Helpers ---

let _sidePanelOpenTabId = null;
let _toggleInProgress = false;  // Mutex for toggle-sidepanel
let _pendingSelection = null;   // Selection text pending pickup by side panel

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
    // Inject Defuddle into the MAIN world (idempotent — checks if already loaded)
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        if (typeof Defuddle !== 'undefined') return 'already loaded';
        return 'needs injection';
      },
    }).then(async (results) => {
      if (results?.[0]?.result === 'needs injection') {
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          files: ['lib/defuddle.js'],
        });
      }
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

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(async () => {
  await setupContextMenus();
  const settings = await getSettings();
  preloadModel(settings); // fire-and-forget
});

chrome.runtime.onStartup.addListener(async () => {
  await setupContextMenus();
  const settings = await getSettings();
  preloadModel(settings); // fire-and-forget
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.settings) {
    await setupContextMenus();
    // Re-check model when AI settings change
    _modelCache = { model: null, url: null, available: null, checkedAt: 0 };
    const settings = await getSettings();
    preloadModel(settings); // fire-and-forget
  }
});

// Reset side panel state when tracked tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (_sidePanelOpenTabId === tabId) {
    _sidePanelOpenTabId = null;
  }
});

// Reset side panel state when active tab changes
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (_sidePanelOpenTabId && _sidePanelOpenTabId !== tabId) {
    chrome.tabs.sendMessage(_sidePanelOpenTabId, {
      action: 'sr-chat-panel-state',
      open: false,
    }).catch(() => {});
    _sidePanelOpenTabId = null;
  }
});

// Handle messages from popup, options page, and chat
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) return;

  if (msg.action === 'savePage') {
    (async () => {
      const settings = await getSettings();
      const collection = settings.collections.find(c => c.id === msg.collectionId)
                         || settings.collections[0];
      await savePage(msg.url, msg.title, collection, settings, msg.tabId);
      sendResponse({ ok: true });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'testYtDlp') {
    (async () => {
      const resp = await fetch(`${msg.url}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      sendResponse({ ok: true, ...data });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.action === 'testOllama') {
    (async () => {
      // 1. Check available models
      const tagsResp = await fetch(`${msg.url}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!tagsResp.ok) throw new Error(`HTTP ${tagsResp.status}`);
      const tagsData = await tagsResp.json();
      const models = (tagsData.models || []).map(m => m.name);

      // 2. If model exists, send a test message to verify it actually responds
      const modelExists = models.includes(msg.model);
      let testPassed = false;
      let testError = null;
      if (modelExists) {
        try {
          const chatResp = await fetch(`${msg.url}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: msg.model,
              messages: [{ role: 'user', content: 'Reply with just the word OK' }],
              stream: false,
              think: false,
              options: { temperature: 0, num_predict: 20, num_ctx: 2048 },
            }),
            signal: AbortSignal.timeout(60000),
          });
          if (chatResp.ok) {
            testPassed = true;
          } else {
            testError = `Ollama returned HTTP ${chatResp.status}`;
            console.warn(`[Save Research] Test chat failed: HTTP ${chatResp.status}`);
          }
        } catch (err) {
          testError = err.message;
          console.warn(`[Save Research] Test chat error: ${err.message}`);
        }
      }

      sendResponse({ ok: true, models, modelExists, testPassed, testError });
    })().catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // --- Chat Side Panel Actions ---

  if (msg.action === 'toggle-sidepanel') {
    if (_toggleInProgress) return false;
    _toggleInProgress = true;
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        if (_sidePanelOpenTabId === tab.id) {
          await closeSidePanel(tab.id);
        } else {
          // Store selection for side panel to pick up during init
          _pendingSelection = msg.selection || null;
          await openSidePanel(tab.id);
        }
      } finally {
        _toggleInProgress = false;
      }
    })();
    return false;
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
        const json3 = await fetchTranscript(content.captionTrackUrl, tab.id);
        content.transcript = json3 ? formatTranscript(json3) : null;
      }
      sendResponse({ ok: true, data: content });
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

  if (msg.action === 'get-panel-state') {
    const tabId = sender.tab?.id;
    sendResponse({ ok: true, open: _sidePanelOpenTabId === tabId });
    return false;
  }

  if (msg.action === 'get-selection') {
    // Check pending selection from FAB toggle first
    if (_pendingSelection) {
      const sel = _pendingSelection;
      _pendingSelection = null;
      sendResponse({ ok: true, selection: sel });
      return true;
    }
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        sendResponse({ ok: true, selection: '' });
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
});
