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
