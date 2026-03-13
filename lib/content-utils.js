// ============================================================
// Save Research — Content Utilities
// ============================================================
// Pure utility functions for content analysis and transformation.
// No Chrome API dependencies — fully testable.

/**
 * Estimate reading time for text content.
 * @param {string} text - The text content to analyze
 * @param {number} [wpm=238] - Words per minute (average adult reading speed)
 * @returns {{ minutes: number, words: number, label: string }}
 */
function estimateReadingTime(text, wpm = 238) {
  if (!text || typeof text !== 'string') {
    return { minutes: 0, words: 0, label: '0 min read' };
  }

  const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  const minutes = Math.max(1, Math.ceil(words / wpm));

  let label;
  if (minutes < 60) {
    label = `${minutes} min read`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    label = remainingMins > 0
      ? `${hours}h ${remainingMins}m read`
      : `${hours}h read`;
  }

  return { minutes, words, label };
}

/**
 * Estimate watch time remaining for a video based on playback speed.
 * @param {number} durationSeconds - Total video duration in seconds
 * @param {number} [currentTime=0] - Current playback position in seconds
 * @param {number} [speed=1] - Playback speed multiplier
 * @returns {{ remaining: number, label: string }}
 */
function estimateWatchTime(durationSeconds, currentTime = 0, speed = 1) {
  if (!durationSeconds || durationSeconds <= 0 || speed <= 0) {
    return { remaining: 0, label: '0 min' };
  }

  const remainingSecs = Math.max(0, durationSeconds - currentTime);
  const adjustedSecs = remainingSecs / speed;
  const minutes = Math.ceil(adjustedSecs / 60);

  let label;
  if (minutes < 60) {
    label = `${minutes} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    label = remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
  }

  return { remaining: Math.round(adjustedSecs), label };
}

/**
 * Extract headings from markdown/text content to build a table of contents.
 * @param {string} content - Markdown or plain text content
 * @returns {Array<{ level: number, text: string, id: string }>}
 */
function extractHeadings(content) {
  if (!content || typeof content !== 'string') return [];

  const headings = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      headings.push({ level, text, id });
    }
  }

  return headings;
}

/**
 * Truncate text to a maximum length, breaking at word boundaries.
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum character length
 * @param {string} [suffix='...'] - Suffix to append when truncated
 * @returns {string}
 */
function truncateText(text, maxLength, suffix = '...') {
  if (!text || text.length <= maxLength) return text || '';
  const truncated = text.substring(0, maxLength - suffix.length);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.5) {
    return truncated.substring(0, lastSpace) + suffix;
  }
  return truncated + suffix;
}

/**
 * Format a duration in seconds to a human-readable string.
 * @param {number} seconds - Duration in seconds
 * @returns {string} e.g., "1:23:45" or "23:45" or "0:45"
 */
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Extract domain from a URL string.
 * @param {string} url - The URL to extract domain from
 * @returns {string} The domain or empty string
 */
function extractDomain(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Generate a simple content fingerprint for dedup / change detection.
 * Uses djb2 hash algorithm — fast, not cryptographic.
 * @param {string} text - Content to fingerprint
 * @returns {string} Hex hash string
 */
function contentFingerprint(text) {
  if (!text) return '0';
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
  }
  return (hash >>> 0).toString(16);
}

/**
 * Strip HTML tags from a string, preserving text content.
 * @param {string} html - HTML string to strip
 * @returns {string} Plain text
 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Calculate readability statistics for text.
 * Uses Flesch-Kincaid approach for grade level.
 * @param {string} text - Text to analyze
 * @returns {{ sentences: number, words: number, syllables: number, gradeLevel: number, readabilityLabel: string }}
 */
function analyzeReadability(text) {
  if (!text || typeof text !== 'string') {
    return { sentences: 0, words: 0, syllables: 0, gradeLevel: 0, readabilityLabel: 'N/A' };
  }

  const cleaned = text.replace(/[^\w\s.!?]/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  if (wordCount === 0) {
    return { sentences: 0, words: 0, syllables: 0, gradeLevel: 0, readabilityLabel: 'N/A' };
  }

  // Count sentences (split on . ! ?)
  const sentences = Math.max(1, (cleaned.match(/[.!?]+/g) || []).length);

  // Count syllables (rough approximation)
  let totalSyllables = 0;
  for (const word of words) {
    totalSyllables += countSyllables(word);
  }

  // Flesch-Kincaid Grade Level
  const gradeLevel = Math.max(0,
    0.39 * (wordCount / sentences) + 11.8 * (totalSyllables / wordCount) - 15.59
  );

  const rounded = Math.round(gradeLevel * 10) / 10;

  let readabilityLabel;
  if (rounded <= 5) readabilityLabel = 'Very Easy';
  else if (rounded <= 8) readabilityLabel = 'Easy';
  else if (rounded <= 12) readabilityLabel = 'Moderate';
  else if (rounded <= 16) readabilityLabel = 'Difficult';
  else readabilityLabel = 'Very Difficult';

  return {
    sentences,
    words: wordCount,
    syllables: totalSyllables,
    gradeLevel: rounded,
    readabilityLabel,
  };
}

/**
 * Count syllables in a word (rough English approximation).
 * @param {string} word
 * @returns {number}
 */
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 2) return 1;

  // Remove trailing silent e
  word = word.replace(/e$/, '');

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g);
  const count = vowelGroups ? vowelGroups.length : 1;

  return Math.max(1, count);
}

/**
 * Generate a comprehensive content stats object.
 * @param {string} text - Text content
 * @returns {{ words: number, characters: number, sentences: number, paragraphs: number, readingTime: string, gradeLevel: number, readabilityLabel: string }}
 */
function getContentStats(text) {
  if (!text) {
    return { words: 0, characters: 0, sentences: 0, paragraphs: 0, readingTime: '0 min', gradeLevel: 0, readabilityLabel: 'N/A' };
  }

  const readTime = estimateReadingTime(text);
  const readability = analyzeReadability(text);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

  return {
    words: readTime.words,
    characters: text.length,
    sentences: readability.sentences,
    paragraphs,
    readingTime: readTime.label,
    gradeLevel: readability.gradeLevel,
    readabilityLabel: readability.readabilityLabel,
  };
}

// Export for both Node.js (testing) and browser (extension)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    estimateReadingTime,
    estimateWatchTime,
    extractHeadings,
    truncateText,
    formatDuration,
    extractDomain,
    contentFingerprint,
    stripHtml,
    analyzeReadability,
    countSyllables,
    getContentStats,
  };
}
