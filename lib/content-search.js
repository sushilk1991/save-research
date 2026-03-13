// ============================================================
// Save Research — Content Search
// ============================================================
// Full-text search within extracted page content.
// No Chrome API dependencies — fully testable.

/**
 * Search for a query within text content, returning matching excerpts.
 * @param {string} content - The text content to search
 * @param {string} query - The search query
 * @param {object} [options]
 * @param {number} [options.contextChars=80] - Characters of context around each match
 * @param {number} [options.maxResults=20] - Maximum results to return
 * @param {boolean} [options.caseSensitive=false] - Case-sensitive search
 * @returns {Array<{ index: number, excerpt: string, matchStart: number, matchEnd: number, lineNumber: number }>}
 */
function searchContent(content, query, options = {}) {
  if (!content || !query || typeof content !== 'string' || typeof query !== 'string') {
    return [];
  }

  const contextChars = options.contextChars ?? 80;
  const maxResults = options.maxResults ?? 20;
  const caseSensitive = options.caseSensitive ?? false;

  const searchIn = caseSensitive ? content : content.toLowerCase();
  const searchFor = caseSensitive ? query : query.toLowerCase();
  const results = [];

  let pos = 0;
  while (results.length < maxResults) {
    const idx = searchIn.indexOf(searchFor, pos);
    if (idx === -1) break;

    // Calculate line number
    const lineNumber = content.substring(0, idx).split('\n').length;

    // Extract context
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(content.length, idx + searchFor.length + contextChars);
    let excerpt = content.substring(start, end);

    // Add ellipsis if truncated
    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    results.push({
      index: idx,
      excerpt,
      matchStart: idx - start + (start > 0 ? 3 : 0), // Adjust for ellipsis
      matchEnd: idx - start + searchFor.length + (start > 0 ? 3 : 0),
      lineNumber,
    });

    pos = idx + searchFor.length;
  }

  return results;
}

/**
 * Count total occurrences of a query in content.
 * @param {string} content
 * @param {string} query
 * @param {boolean} [caseSensitive=false]
 * @returns {number}
 */
function countMatches(content, query, caseSensitive = false) {
  if (!content || !query) return 0;
  const searchIn = caseSensitive ? content : content.toLowerCase();
  const searchFor = caseSensitive ? query : query.toLowerCase();

  let count = 0;
  let pos = 0;
  while (true) {
    const idx = searchIn.indexOf(searchFor, pos);
    if (idx === -1) break;
    count++;
    pos = idx + searchFor.length;
  }
  return count;
}

/**
 * Highlight matches in text by wrapping them in <mark> tags.
 * HTML-escapes the text first to prevent XSS.
 * @param {string} text - Text to highlight
 * @param {string} query - Query to highlight
 * @param {boolean} [caseSensitive=false]
 * @returns {string} HTML with <mark> tags
 */
function highlightMatches(text, query, caseSensitive = false) {
  if (!text || !query) return escapeHtml(text || '');

  // Escape HTML first
  const escaped = escapeHtml(text);
  const escapedQuery = escapeHtml(query);

  // Build regex for highlighting
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(escapedQuery), flags);

  return escaped.replace(regex, '<mark>$&</mark>');
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape special regex characters.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export for both Node.js (testing) and browser (extension)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    searchContent,
    countMatches,
    highlightMatches,
    escapeHtml,
    escapeRegex,
  };
}
