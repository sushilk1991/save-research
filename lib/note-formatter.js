// ============================================================
// Save Research — Note Formatter
// ============================================================
// Formats chat/AI responses into structured markdown notes with frontmatter.

/**
 * Format a summary note as markdown with YAML frontmatter.
 * @param {object} params
 * @param {string} params.content - The note content (markdown)
 * @param {string} [params.title] - Page title
 * @param {string} [params.url] - Source URL
 * @param {string} [params.type='summary'] - Note type
 * @param {string[]} [params.tags=[]] - Tags for the note
 * @param {string} [params.author] - Content author
 * @param {string} [params.prompt] - The prompt that generated this content
 * @returns {string} Formatted markdown
 */
function formatNote(params) {
  const {
    content = '',
    title = 'Untitled',
    url = '',
    type = 'summary',
    tags = [],
    author = '',
    prompt = '',
  } = params;

  const now = new Date().toISOString();

  const frontmatter = [
    '---',
    `title: "${escapeYaml(title)}"`,
    `source: ${url}`,
    `type: ${type}`,
    `created: ${now}`,
  ];

  if (author) frontmatter.push(`author: "${escapeYaml(author)}"`);
  if (tags.length > 0) frontmatter.push(`tags: [${tags.map(t => `"${escapeYaml(t)}"`).join(', ')}]`);
  if (prompt) frontmatter.push(`prompt: "${escapeYaml(prompt)}"`);

  frontmatter.push('---', '');

  return frontmatter.join('\n') + content;
}

/**
 * Generate a safe filename from a title and optional suffix.
 * @param {string} title - Base title
 * @param {string} [suffix=''] - Optional suffix (e.g., 'summary', 'notes')
 * @returns {string} Safe filename with .md extension
 */
function generateFilename(title, suffix = '') {
  const safeName = title
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50)
    .toLowerCase();

  const timestamp = new Date().toISOString().slice(0, 10);
  const parts = [safeName, suffix, timestamp].filter(Boolean);
  return parts.join('-') + '.md';
}

/**
 * Escape special YAML characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeYaml(str) {
  if (!str) return '';
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/**
 * Create a Cornell-style note from content.
 * @param {object} params
 * @param {string} params.summary - Brief summary
 * @param {string} params.content - Full content/notes
 * @param {string} [params.cues] - Key cues/questions
 * @param {string} [params.title] - Page title
 * @param {string} [params.url] - Source URL
 * @returns {string}
 */
function formatCornellNote(params) {
  const { summary = '', content = '', cues = '', title = 'Untitled', url = '' } = params;

  return formatNote({
    content: [
      `# ${title}`,
      '',
      '## Summary',
      summary,
      '',
      cues ? '## Key Questions / Cues' : '',
      cues || '',
      cues ? '' : '',
      '## Notes',
      content,
      '',
    ].filter(line => line !== undefined).join('\n'),
    title,
    url,
    type: 'cornell-note',
  });
}

/**
 * Format a flashcard set from Q&A pairs.
 * @param {Array<{q: string, a: string}>} cards - Question/answer pairs
 * @param {string} [title] - Title of the source
 * @param {string} [url] - Source URL
 * @returns {string}
 */
function formatFlashcards(cards, title = 'Flashcards', url = '') {
  if (!cards || cards.length === 0) return '';

  const content = cards.map((card, i) => {
    return `### Card ${i + 1}\n\n**Q:** ${card.q}\n\n**A:** ${card.a}`;
  }).join('\n\n---\n\n');

  return formatNote({
    content: `# ${title}\n\n${content}`,
    title,
    url,
    type: 'flashcards',
  });
}

// Export for both Node.js (testing) and browser (extension)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatNote,
    generateFilename,
    escapeYaml,
    formatCornellNote,
    formatFlashcards,
  };
}
