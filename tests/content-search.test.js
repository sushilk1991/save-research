const {
  searchContent,
  countMatches,
  highlightMatches,
  escapeHtml,
  escapeRegex,
} = require('../lib/content-search');

describe('searchContent', () => {
  test('returns empty for invalid input', () => {
    expect(searchContent('', 'test')).toEqual([]);
    expect(searchContent('hello', '')).toEqual([]);
    expect(searchContent(null, 'test')).toEqual([]);
  });

  test('finds simple matches', () => {
    const content = 'The quick brown fox jumps over the lazy dog';
    const results = searchContent(content, 'fox');
    expect(results).toHaveLength(1);
    expect(results[0].excerpt).toContain('fox');
    expect(results[0].lineNumber).toBe(1);
  });

  test('finds multiple matches', () => {
    const content = 'hello world hello world hello';
    const results = searchContent(content, 'hello');
    expect(results).toHaveLength(3);
  });

  test('is case-insensitive by default', () => {
    const content = 'Hello HELLO hello';
    const results = searchContent(content, 'hello');
    expect(results).toHaveLength(3);
  });

  test('respects case sensitivity option', () => {
    const content = 'Hello HELLO hello';
    const results = searchContent(content, 'hello', { caseSensitive: true });
    expect(results).toHaveLength(1);
  });

  test('respects maxResults', () => {
    const content = 'a a a a a a a a a a a a';
    const results = searchContent(content, 'a', { maxResults: 3 });
    expect(results).toHaveLength(3);
  });

  test('provides correct line numbers', () => {
    const content = 'line one\nline two\nline three\nline four';
    const results = searchContent(content, 'three');
    expect(results[0].lineNumber).toBe(3);
  });

  test('provides context around matches', () => {
    const content = 'x'.repeat(200) + 'MATCH' + 'y'.repeat(200);
    const results = searchContent(content, 'MATCH', { contextChars: 10 });
    expect(results[0].excerpt.length).toBeLessThan(30 + 6); // 10+5+10 + ellipsis
  });
});

describe('countMatches', () => {
  test('returns 0 for empty input', () => {
    expect(countMatches('', 'test')).toBe(0);
    expect(countMatches('hello', '')).toBe(0);
  });

  test('counts matches correctly', () => {
    expect(countMatches('hello hello hello', 'hello')).toBe(3);
  });

  test('is case-insensitive by default', () => {
    expect(countMatches('Hello HELLO hello', 'hello')).toBe(3);
  });

  test('supports case sensitivity', () => {
    expect(countMatches('Hello HELLO hello', 'hello', true)).toBe(1);
  });
});

describe('highlightMatches', () => {
  test('returns escaped text when no query', () => {
    expect(highlightMatches('hello <b>world</b>', '')).toBe('hello &lt;b&gt;world&lt;/b&gt;');
  });

  test('wraps matches in mark tags', () => {
    const result = highlightMatches('hello world', 'world');
    expect(result).toBe('hello <mark>world</mark>');
  });

  test('handles multiple matches', () => {
    const result = highlightMatches('foo bar foo', 'foo');
    expect(result).toBe('<mark>foo</mark> bar <mark>foo</mark>');
  });

  test('escapes HTML in content to prevent XSS', () => {
    const result = highlightMatches('<script>alert("xss")</script>', 'alert');
    expect(result).not.toContain('<script>');
    expect(result).toContain('<mark>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('escapes special regex characters in query', () => {
    const result = highlightMatches('price is $5.00', '$5.00');
    expect(result).toContain('<mark>');
  });
});

describe('escapeHtml', () => {
  test('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
  });

  test('escapes all special characters', () => {
    expect(escapeHtml('&<>"\''))
      .toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('escapeRegex', () => {
  test('escapes special regex characters', () => {
    const escaped = escapeRegex('test.+*?^${}()|[]\\');
    expect(escaped).toBe('test\\.\\+\\*\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
  });
});
