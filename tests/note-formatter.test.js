const {
  formatNote,
  generateFilename,
  escapeYaml,
  formatCornellNote,
  formatFlashcards,
} = require('../lib/note-formatter');

describe('formatNote', () => {
  test('generates valid frontmatter', () => {
    const result = formatNote({
      content: 'Hello world',
      title: 'Test',
      url: 'https://example.com',
    });
    expect(result).toContain('---');
    expect(result).toContain('title: "Test"');
    expect(result).toContain('source: https://example.com');
    expect(result).toContain('type: summary');
    expect(result).toContain('created:');
    expect(result).toContain('Hello world');
  });

  test('includes optional fields', () => {
    const result = formatNote({
      content: 'Content',
      title: 'Test',
      tags: ['ai', 'ml'],
      author: 'John',
      prompt: 'Summarize this',
    });
    expect(result).toContain('tags: ["ai", "ml"]');
    expect(result).toContain('author: "John"');
    expect(result).toContain('prompt: "Summarize this"');
  });

  test('escapes quotes in title', () => {
    const result = formatNote({ content: '', title: 'Say "hello"' });
    expect(result).toContain('title: "Say \\"hello\\""');
  });
});

describe('generateFilename', () => {
  test('generates safe filename', () => {
    const name = generateFilename('Hello World!');
    expect(name).toMatch(/^hello-world-\d{4}-\d{2}-\d{2}\.md$/);
  });

  test('includes suffix', () => {
    const name = generateFilename('Test', 'summary');
    expect(name).toContain('-summary-');
  });

  test('truncates long titles', () => {
    const longTitle = 'a'.repeat(100);
    const name = generateFilename(longTitle);
    expect(name.length).toBeLessThan(80);
  });

  test('handles special characters', () => {
    const name = generateFilename('Test: "Special" (chars)!');
    expect(name).not.toMatch(/[^a-z0-9\-.]/);
  });
});

describe('escapeYaml', () => {
  test('escapes quotes', () => {
    expect(escapeYaml('say "hello"')).toBe('say \\"hello\\"');
  });

  test('replaces newlines with spaces', () => {
    expect(escapeYaml('line1\nline2')).toBe('line1 line2');
  });

  test('handles empty input', () => {
    expect(escapeYaml('')).toBe('');
    expect(escapeYaml(null)).toBe('');
  });
});

describe('formatCornellNote', () => {
  test('generates cornell note structure', () => {
    const result = formatCornellNote({
      summary: 'Brief summary',
      content: 'Detailed notes',
      cues: 'Key questions',
      title: 'Test Note',
      url: 'https://example.com',
    });
    expect(result).toContain('## Summary');
    expect(result).toContain('Brief summary');
    expect(result).toContain('## Key Questions / Cues');
    expect(result).toContain('## Notes');
    expect(result).toContain('type: cornell-note');
  });

  test('omits cues section when empty', () => {
    const result = formatCornellNote({ summary: 's', content: 'c' });
    expect(result).not.toContain('## Key Questions');
  });
});

describe('formatFlashcards', () => {
  test('formats Q&A cards', () => {
    const cards = [
      { q: 'What is AI?', a: 'Artificial Intelligence' },
      { q: 'What is ML?', a: 'Machine Learning' },
    ];
    const result = formatFlashcards(cards, 'AI Basics');
    expect(result).toContain('### Card 1');
    expect(result).toContain('**Q:** What is AI?');
    expect(result).toContain('**A:** Artificial Intelligence');
    expect(result).toContain('### Card 2');
    expect(result).toContain('type: flashcards');
  });

  test('returns empty for no cards', () => {
    expect(formatFlashcards([])).toBe('');
    expect(formatFlashcards(null)).toBe('');
  });
});
