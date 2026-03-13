const { cleanTextForSpeech } = require('../lib/tts');

describe('cleanTextForSpeech', () => {
  test('removes code blocks', () => {
    const text = 'Before\n```js\nconst x = 1;\n```\nAfter';
    const result = cleanTextForSpeech(text);
    expect(result).toContain('Before');
    expect(result).toContain('After');
    expect(result).not.toContain('const x');
  });

  test('removes inline code backticks but keeps content', () => {
    const result = cleanTextForSpeech('Use the `map` function');
    expect(result).toBe('Use the map function');
  });

  test('removes markdown link syntax but keeps text', () => {
    const result = cleanTextForSpeech('Visit [Google](https://google.com) for more');
    expect(result).toBe('Visit Google for more');
  });

  test('removes heading markers', () => {
    const result = cleanTextForSpeech('## Section Title');
    expect(result).toBe('Section Title');
  });

  test('removes bold and italic markers', () => {
    expect(cleanTextForSpeech('**bold** and *italic*')).toBe('bold and italic');
    expect(cleanTextForSpeech('***both***')).toBe('both');
  });

  test('removes blockquote markers', () => {
    expect(cleanTextForSpeech('> This is a quote')).toBe('This is a quote');
  });

  test('removes list markers', () => {
    expect(cleanTextForSpeech('- item one\n- item two')).toBe('item one\nitem two');
    expect(cleanTextForSpeech('1. first\n2. second')).toBe('first\nsecond');
  });

  test('handles complex markdown', () => {
    const md = `# Title

Some **bold** text with a [link](https://example.com).

## Subsection

- Point 1
- Point 2

> A quote

\`\`\`python
print("hello")
\`\`\`

Final paragraph.`;

    const result = cleanTextForSpeech(md);
    expect(result).toContain('Title');
    expect(result).toContain('Some bold text with a link.');
    expect(result).toContain('Point 1');
    expect(result).toContain('A quote');
    expect(result).toContain('Final paragraph.');
    expect(result).not.toContain('```');
    expect(result).not.toContain('print(');
  });
});
