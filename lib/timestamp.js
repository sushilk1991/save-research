// ============================================================
// Save Research — Timestamp Utilities
// ============================================================
// Parse and handle video timestamps for navigation.

/**
 * Parse a timestamp string into total seconds.
 * Supports: "1:23", "01:23", "1:23:45", "01:23:45"
 * @param {string} timestamp - Timestamp string
 * @returns {number} Total seconds, or -1 if invalid
 */
function parseTimestamp(timestamp) {
  if (!timestamp || typeof timestamp !== 'string') return -1;

  const parts = timestamp.trim().split(':').map(Number);
  if (parts.some(isNaN)) return -1;

  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return -1;
}

/**
 * Format seconds to a timestamp string.
 * @param {number} totalSeconds
 * @returns {string} e.g., "1:23" or "1:23:45"
 */
function formatTimestamp(totalSeconds) {
  if (totalSeconds < 0 || isNaN(totalSeconds)) return '0:00';

  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Find all timestamps in text and return their positions.
 * Matches patterns like [00:00], [1:23:45], (00:00), 00:00
 * @param {string} text
 * @returns {Array<{ start: number, end: number, timestamp: string, seconds: number }>}
 */
function findTimestamps(text) {
  if (!text) return [];

  const results = [];
  // Match [MM:SS] or [HH:MM:SS] or (MM:SS) or standalone HH:MM:SS / MM:SS
  const regex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]|\((\d{1,2}:\d{2}(?::\d{2})?)\)|(?:^|\s)(\d{1,2}:\d{2}(?::\d{2})?)(?=\s|$)/gm;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const timestamp = match[1] || match[2] || match[3];
    const seconds = parseTimestamp(timestamp);
    if (seconds >= 0) {
      results.push({
        start: match.index,
        end: match.index + match[0].length,
        timestamp,
        seconds,
      });
    }
  }

  return results;
}

/**
 * Replace timestamps in HTML with clickable links.
 * Expects already-escaped HTML.
 * @param {string} html - HTML content (already escaped)
 * @param {string} videoId - YouTube video ID for the URL
 * @returns {string} HTML with timestamps wrapped in <a> tags
 */
function linkifyTimestamps(html, videoId) {
  if (!html || !videoId) return html || '';

  // Match timestamps in common formats within escaped HTML
  return html.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (match, ts) => {
    const seconds = parseTimestamp(ts);
    if (seconds < 0) return match;
    return `<a class="timestamp-link" data-seconds="${seconds}" href="#" title="Jump to ${ts}">[${ts}]</a>`;
  });
}

/**
 * Extract YouTube video ID from URL.
 * @param {string} url
 * @returns {string|null}
 */
function extractYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v') || null;
    }
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1) || null;
    }
  } catch {
    // Not a valid URL
  }
  return null;
}

// Export for both Node.js (testing) and browser (extension)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseTimestamp,
    formatTimestamp,
    findTimestamps,
    linkifyTimestamps,
    extractYouTubeId,
  };
}
