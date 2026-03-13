const {
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
} = require('../lib/content-utils');

// --- estimateReadingTime ---

describe('estimateReadingTime', () => {
  test('returns 0 for empty input', () => {
    expect(estimateReadingTime('')).toEqual({ minutes: 0, words: 0, label: '0 min read' });
    expect(estimateReadingTime(null)).toEqual({ minutes: 0, words: 0, label: '0 min read' });
    expect(estimateReadingTime(undefined)).toEqual({ minutes: 0, words: 0, label: '0 min read' });
  });

  test('returns minimum 1 minute for short text', () => {
    const result = estimateReadingTime('Hello world');
    expect(result.minutes).toBe(1);
    expect(result.words).toBe(2);
    expect(result.label).toBe('1 min read');
  });

  test('calculates correctly for ~238 words', () => {
    const words = new Array(238).fill('word').join(' ');
    const result = estimateReadingTime(words);
    expect(result.words).toBe(238);
    expect(result.minutes).toBe(1);
  });

  test('calculates correctly for ~500 words', () => {
    const words = new Array(500).fill('word').join(' ');
    const result = estimateReadingTime(words);
    expect(result.words).toBe(500);
    expect(result.minutes).toBe(3); // ceil(500/238) = 3
    expect(result.label).toBe('3 min read');
  });

  test('formats hours correctly for long content', () => {
    const words = new Array(20000).fill('word').join(' ');
    const result = estimateReadingTime(words);
    expect(result.label).toMatch(/^\d+h\s?\d*m?\s?read$/);
  });

  test('respects custom wpm', () => {
    const words = new Array(100).fill('word').join(' ');
    const result = estimateReadingTime(words, 100);
    expect(result.minutes).toBe(1);

    const result2 = estimateReadingTime(words, 50);
    expect(result2.minutes).toBe(2);
  });

  test('handles multiple whitespace', () => {
    const result = estimateReadingTime('  hello   world  ');
    expect(result.words).toBe(2);
  });
});

// --- estimateWatchTime ---

describe('estimateWatchTime', () => {
  test('returns 0 for invalid input', () => {
    expect(estimateWatchTime(0)).toEqual({ remaining: 0, label: '0 min' });
    expect(estimateWatchTime(-1)).toEqual({ remaining: 0, label: '0 min' });
    expect(estimateWatchTime(100, 0, 0)).toEqual({ remaining: 0, label: '0 min' });
  });

  test('calculates remaining time', () => {
    const result = estimateWatchTime(600, 300); // 10 min video, 5 min in
    expect(result.remaining).toBe(300);
    expect(result.label).toBe('5 min');
  });

  test('adjusts for playback speed', () => {
    const result = estimateWatchTime(600, 0, 2); // 10 min video at 2x
    expect(result.remaining).toBe(300);
    expect(result.label).toBe('5 min');
  });

  test('handles completed video', () => {
    const result = estimateWatchTime(600, 600);
    expect(result.remaining).toBe(0);
    expect(result.label).toBe('0 min');
  });

  test('formats hours for long videos', () => {
    const result = estimateWatchTime(7200, 0); // 2 hour video
    expect(result.label).toBe('2h');
  });
});

// --- extractHeadings ---

describe('extractHeadings', () => {
  test('returns empty array for empty input', () => {
    expect(extractHeadings('')).toEqual([]);
    expect(extractHeadings(null)).toEqual([]);
  });

  test('extracts markdown headings', () => {
    const content = '# Title\n\nSome text\n\n## Section One\n\nMore text\n\n### Subsection\n\nContent';
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: 'Title', id: 'title' });
    expect(headings[1]).toEqual({ level: 2, text: 'Section One', id: 'section-one' });
    expect(headings[2]).toEqual({ level: 3, text: 'Subsection', id: 'subsection' });
  });

  test('handles special characters in headings', () => {
    const content = '## What\'s New? (2024)';
    const headings = extractHeadings(content);
    expect(headings[0].id).toBe('whats-new-2024');
  });

  test('ignores lines that are not headings', () => {
    const content = 'Not a heading\n#no space\n## Valid Heading';
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe('Valid Heading');
  });
});

// --- truncateText ---

describe('truncateText', () => {
  test('returns empty string for falsy input', () => {
    expect(truncateText(null, 10)).toBe('');
    expect(truncateText('', 10)).toBe('');
  });

  test('returns original text if shorter than max', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  test('truncates at word boundary', () => {
    const result = truncateText('hello wonderful world today', 20);
    expect(result).toBe('hello wonderful...');
    expect(result.length).toBeLessThanOrEqual(20);
  });

  test('uses custom suffix', () => {
    const result = truncateText('hello wonderful world', 15, ' [more]');
    expect(result).toContain('[more]');
  });
});

// --- formatDuration ---

describe('formatDuration', () => {
  test('handles zero and invalid', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(null)).toBe('0:00');
  });

  test('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  test('formats minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2:05');
  });

  test('formats hours, minutes, seconds', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  test('pads correctly', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(60)).toBe('1:00');
  });
});

// --- extractDomain ---

describe('extractDomain', () => {
  test('returns empty for invalid input', () => {
    expect(extractDomain('')).toBe('');
    expect(extractDomain(null)).toBe('');
    expect(extractDomain('not-a-url')).toBe('');
  });

  test('extracts domain', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com');
  });

  test('strips www prefix', () => {
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
  });

  test('preserves subdomains other than www', () => {
    expect(extractDomain('https://blog.example.com')).toBe('blog.example.com');
  });
});

// --- contentFingerprint ---

describe('contentFingerprint', () => {
  test('returns "0" for empty input', () => {
    expect(contentFingerprint('')).toBe('0');
    expect(contentFingerprint(null)).toBe('0');
  });

  test('returns consistent hash for same input', () => {
    const a = contentFingerprint('hello world');
    const b = contentFingerprint('hello world');
    expect(a).toBe(b);
  });

  test('returns different hash for different input', () => {
    const a = contentFingerprint('hello');
    const b = contentFingerprint('world');
    expect(a).not.toBe(b);
  });

  test('returns hex string', () => {
    const hash = contentFingerprint('test');
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

// --- stripHtml ---

describe('stripHtml', () => {
  test('returns empty for invalid input', () => {
    expect(stripHtml('')).toBe('');
    expect(stripHtml(null)).toBe('');
  });

  test('strips simple tags', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello');
  });

  test('converts br tags to newlines', () => {
    expect(stripHtml('Hello<br>World')).toBe('Hello\nWorld');
    expect(stripHtml('Hello<br/>World')).toBe('Hello\nWorld');
  });

  test('converts p closing tags to double newlines', () => {
    expect(stripHtml('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });

  test('decodes HTML entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#39;')).toBe('& < > " \'');
  });

  test('handles complex HTML', () => {
    const html = '<div><h1>Title</h1><p>Text with <strong>bold</strong> and <a href="#">link</a></p></div>';
    const result = stripHtml(html);
    expect(result).toBe('TitleText with bold and link');
  });
});

// --- countSyllables ---

describe('countSyllables', () => {
  test('short words get 1 syllable', () => {
    expect(countSyllables('a')).toBe(1);
    expect(countSyllables('go')).toBe(1);
  });

  test('counts common words correctly', () => {
    expect(countSyllables('hello')).toBe(2);
    expect(countSyllables('beautiful')).toBe(3);
    expect(countSyllables('cat')).toBe(1);
  });

  test('handles silent e', () => {
    expect(countSyllables('make')).toBe(1);
    expect(countSyllables('time')).toBe(1);
  });
});

// --- analyzeReadability ---

describe('analyzeReadability', () => {
  test('returns N/A for empty input', () => {
    const result = analyzeReadability('');
    expect(result.readabilityLabel).toBe('N/A');
    expect(result.words).toBe(0);
  });

  test('analyzes simple text', () => {
    const text = 'The cat sat on the mat. The dog ran in the park.';
    const result = analyzeReadability(text);
    expect(result.words).toBeGreaterThan(0);
    expect(result.sentences).toBe(2);
    expect(result.gradeLevel).toBeLessThan(10);
    expect(result.readabilityLabel).toBeTruthy();
  });

  test('complex text has higher grade level', () => {
    const simple = 'The cat is big. It is nice.';
    const complex = 'The pharmaceutical conglomerate systematically administered unprecedented transformational initiatives.';
    const simpleResult = analyzeReadability(simple);
    const complexResult = analyzeReadability(complex);
    expect(complexResult.gradeLevel).toBeGreaterThan(simpleResult.gradeLevel);
  });

  test('returns valid readability labels', () => {
    const validLabels = ['Very Easy', 'Easy', 'Moderate', 'Difficult', 'Very Difficult', 'N/A'];
    const result = analyzeReadability('Some sample text here. Another sentence.');
    expect(validLabels).toContain(result.readabilityLabel);
  });
});

// --- getContentStats ---

describe('getContentStats', () => {
  test('returns zeros for empty input', () => {
    const stats = getContentStats('');
    expect(stats.words).toBe(0);
    expect(stats.characters).toBe(0);
  });

  test('returns comprehensive stats', () => {
    const text = 'First paragraph here. Two sentences here.\n\nSecond paragraph. Also has two sentences.';
    const stats = getContentStats(text);
    expect(stats.words).toBeGreaterThan(0);
    expect(stats.characters).toBeGreaterThan(0);
    expect(stats.sentences).toBeGreaterThan(0);
    expect(stats.paragraphs).toBe(2);
    expect(stats.readingTime).toContain('min');
    expect(stats.gradeLevel).toBeGreaterThanOrEqual(0);
    expect(stats.readabilityLabel).toBeTruthy();
  });
});
