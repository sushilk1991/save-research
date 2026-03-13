const {
  parseTimestamp,
  formatTimestamp,
  findTimestamps,
  linkifyTimestamps,
  extractYouTubeId,
} = require('../lib/timestamp');

describe('parseTimestamp', () => {
  test('returns -1 for invalid input', () => {
    expect(parseTimestamp('')).toBe(-1);
    expect(parseTimestamp(null)).toBe(-1);
    expect(parseTimestamp('abc')).toBe(-1);
  });

  test('parses MM:SS format', () => {
    expect(parseTimestamp('1:23')).toBe(83);
    expect(parseTimestamp('01:23')).toBe(83);
    expect(parseTimestamp('0:00')).toBe(0);
    expect(parseTimestamp('59:59')).toBe(3599);
  });

  test('parses HH:MM:SS format', () => {
    expect(parseTimestamp('1:23:45')).toBe(5025);
    expect(parseTimestamp('01:23:45')).toBe(5025);
    expect(parseTimestamp('0:00:00')).toBe(0);
  });
});

describe('formatTimestamp', () => {
  test('formats seconds to timestamp', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(83)).toBe('1:23');
    expect(formatTimestamp(3599)).toBe('59:59');
    expect(formatTimestamp(3600)).toBe('1:00:00');
    expect(formatTimestamp(5025)).toBe('1:23:45');
  });

  test('handles invalid input', () => {
    expect(formatTimestamp(-1)).toBe('0:00');
    expect(formatTimestamp(NaN)).toBe('0:00');
  });
});

describe('findTimestamps', () => {
  test('returns empty for no timestamps', () => {
    expect(findTimestamps('Hello world')).toEqual([]);
    expect(findTimestamps('')).toEqual([]);
  });

  test('finds bracketed timestamps', () => {
    const results = findTimestamps('[00:00] Hello\n[01:23] World');
    expect(results).toHaveLength(2);
    expect(results[0].seconds).toBe(0);
    expect(results[1].seconds).toBe(83);
  });

  test('finds parenthesized timestamps', () => {
    const results = findTimestamps('(1:23)');
    expect(results).toHaveLength(1);
    expect(results[0].seconds).toBe(83);
  });

  test('finds HH:MM:SS timestamps', () => {
    const results = findTimestamps('[1:23:45] Long video');
    expect(results).toHaveLength(1);
    expect(results[0].seconds).toBe(5025);
  });
});

describe('linkifyTimestamps', () => {
  test('returns original for no videoId', () => {
    expect(linkifyTimestamps('test', '')).toBe('test');
    expect(linkifyTimestamps('test', null)).toBe('test');
  });

  test('wraps timestamps in anchor tags', () => {
    const result = linkifyTimestamps('[01:23] Hello', 'abc123');
    expect(result).toContain('class="timestamp-link"');
    expect(result).toContain('data-seconds="83"');
    expect(result).toContain('[01:23]');
  });

  test('handles multiple timestamps', () => {
    const result = linkifyTimestamps('[00:00] Start\n[01:23] Middle', 'abc123');
    expect(result).toContain('data-seconds="0"');
    expect(result).toContain('data-seconds="83"');
  });

  test('does not modify non-timestamp brackets', () => {
    const result = linkifyTimestamps('[hello] world', 'abc123');
    expect(result).toBe('[hello] world');
  });
});

describe('extractYouTubeId', () => {
  test('returns null for invalid input', () => {
    expect(extractYouTubeId('')).toBe(null);
    expect(extractYouTubeId(null)).toBe(null);
    expect(extractYouTubeId('not-a-url')).toBe(null);
  });

  test('extracts from youtube.com watch URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  test('extracts from youtu.be short URL', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  test('returns null for non-youtube URLs', () => {
    expect(extractYouTubeId('https://example.com/watch?v=test')).toBe(null);
  });
});
