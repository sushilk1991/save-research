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
    if (['www.reddit.com', 'reddit.com', 'old.reddit.com', 'new.reddit.com'].includes(hostname)) {
      return 'reddit';
    }
    if (['news.ycombinator.com'].includes(hostname)) {
      return 'hackernews';
    }
    if (hostname.endsWith('wikipedia.org')) {
      return 'wikipedia';
    }
    if (['arxiv.org', 'www.arxiv.org'].includes(hostname)) {
      return 'arxiv';
    }
    if (['github.com', 'www.github.com'].includes(hostname)) {
      return 'github';
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

  // --- Reddit extraction ---
  function extractReddit() {
    const postTitle = document.querySelector('[slot="title"]')?.textContent
      || document.querySelector('.Post h1, .Post h3')?.textContent
      || document.title;

    const postBody = document.querySelector('[slot="text-body"]')?.innerText
      || document.querySelector('.Post .RichTextJSON-root, .Post [data-click-id="text"]')?.innerText
      || '';

    // Extract comments
    const comments = [];
    const commentEls = document.querySelectorAll('shreddit-comment, .Comment');
    for (const el of commentEls) {
      const author = el.getAttribute('author')
        || el.querySelector('.Comment__author, [data-testid="comment_author_link"]')?.textContent?.trim();
      const body = el.querySelector('[slot="comment"]')?.innerText
        || el.querySelector('.Comment__body, .RichTextJSON-root')?.innerText;
      const score = el.getAttribute('score')
        || el.querySelector('.Comment__score, [data-testid="comment-score"]')?.textContent?.trim();

      if (body) {
        comments.push({
          author: author || 'anonymous',
          text: body.trim().substring(0, 2000),
          score: score || '',
        });
      }
    }

    return {
      type: 'reddit',
      title: postTitle?.trim() || document.title,
      content: postBody.trim(),
      comments: comments.slice(0, 50), // Cap at 50 comments
      url: window.location.href,
      domain: 'reddit.com',
      wordCount: (postBody + ' ' + comments.map(c => c.text).join(' ')).split(/\s+/).length,
    };
  }

  // --- Hacker News extraction ---
  function extractHackerNews() {
    const titleEl = document.querySelector('.titleline > a, .storylink');
    const title = titleEl?.textContent || document.title;
    const storyUrl = titleEl?.href || window.location.href;

    const comments = [];
    const commentEls = document.querySelectorAll('.comtr');
    for (const el of commentEls) {
      const author = el.querySelector('.hnuser')?.textContent;
      const body = el.querySelector('.commtext')?.innerText;
      if (body) {
        comments.push({
          author: author || 'anonymous',
          text: body.trim().substring(0, 2000),
        });
      }
    }

    return {
      type: 'hackernews',
      title: title.trim(),
      storyUrl,
      comments: comments.slice(0, 50),
      url: window.location.href,
      domain: 'news.ycombinator.com',
      wordCount: comments.map(c => c.text).join(' ').split(/\s+/).length,
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
      content: document.body.textContent.substring(0, 100000),
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
  } else if (pageType === 'reddit') {
    result = extractReddit();
    if (!result.content && (!result.comments || result.comments.length === 0)) {
      result = extractGeneral();
    }
  } else if (pageType === 'hackernews') {
    result = extractHackerNews();
    if (!result.comments || result.comments.length === 0) {
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
  return result;
})();
