const {
  renderMarkdown,
  parseTableRow,
  parseTableAlignments,
} = require('../lib/markdown');

describe('renderMarkdown', () => {
  test('returns empty string for falsy input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown(undefined)).toBe('');
  });

  test('escapes HTML to prevent XSS', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('renders code blocks', () => {
    const result = renderMarkdown('```js\nconst x = 1;\n```');
    expect(result).toContain('<pre>');
    expect(result).toContain('<code');
    expect(result).toContain('language-js');
  });

  test('renders inline code', () => {
    const result = renderMarkdown('Use `map()` here');
    expect(result).toContain('<code>map()</code>');
  });

  test('renders bold', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  test('renders italic', () => {
    expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
  });

  test('renders strikethrough', () => {
    expect(renderMarkdown('~~deleted~~')).toContain('<del>deleted</del>');
  });

  test('renders headings', () => {
    expect(renderMarkdown('# H1')).toContain('<h1>H1</h1>');
    expect(renderMarkdown('## H2')).toContain('<h2>H2</h2>');
    expect(renderMarkdown('### H3')).toContain('<h3>H3</h3>');
  });

  test('renders horizontal rules', () => {
    expect(renderMarkdown('---')).toContain('<hr>');
    expect(renderMarkdown('***')).toContain('<hr>');
    expect(renderMarkdown('___')).toContain('<hr>');
  });

  test('renders blockquotes', () => {
    const result = renderMarkdown('> This is a quote');
    expect(result).toContain('<blockquote>');
  });

  test('renders unordered lists', () => {
    const result = renderMarkdown('- item 1\n- item 2');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item 1</li>');
    expect(result).toContain('<li>item 2</li>');
  });

  test('renders ordered lists', () => {
    const result = renderMarkdown('1. first\n2. second');
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>first</li>');
    expect(result).toContain('<li>second</li>');
  });

  test('renders paragraphs', () => {
    const result = renderMarkdown('First paragraph\n\nSecond paragraph');
    expect(result).toContain('<p>First paragraph</p>');
    expect(result).toContain('<p>Second paragraph</p>');
  });

  test('renders tables', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    const result = renderMarkdown(md);
    expect(result).toContain('<table>');
    expect(result).toContain('<th>Name</th>');
    expect(result).toContain('<td>Alice</td>');
    expect(result).toContain('<td>30</td>');
  });

  test('renders tables with alignment', () => {
    const md = '| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |';
    const result = renderMarkdown(md);
    expect(result).toContain('text-align:left');
    expect(result).toContain('text-align:center');
    expect(result).toContain('text-align:right');
  });

  test('handles complex markdown', () => {
    const md = `# Title

Some **bold** and *italic* text.

## Section

- item 1
- item 2

\`\`\`python
print("hello")
\`\`\`

> A quote

---

1. ordered
2. list`;

    const result = renderMarkdown(md);
    expect(result).toContain('<h1>Title</h1>');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<h2>Section</h2>');
    expect(result).toContain('<ul>');
    expect(result).toContain('<pre>');
    expect(result).toContain('<blockquote>');
    expect(result).toContain('<hr>');
    expect(result).toContain('<ol>');
  });
});

describe('parseTableRow', () => {
  test('parses pipe-separated cells', () => {
    expect(parseTableRow('| A | B | C |')).toEqual(['A', 'B', 'C']);
  });

  test('handles no leading/trailing pipes', () => {
    expect(parseTableRow('A | B | C')).toEqual(['A', 'B', 'C']);
  });
});

describe('parseTableAlignments', () => {
  test('detects left alignment', () => {
    expect(parseTableAlignments('| :--- |')).toEqual(['left']);
  });

  test('detects center alignment', () => {
    expect(parseTableAlignments('| :---: |')).toEqual(['center']);
  });

  test('detects right alignment', () => {
    expect(parseTableAlignments('| ---: |')).toEqual(['right']);
  });

  test('detects no alignment', () => {
    expect(parseTableAlignments('| --- |')).toEqual([null]);
  });

  test('handles mixed alignments', () => {
    expect(parseTableAlignments('| :--- | :---: | ---: | --- |'))
      .toEqual(['left', 'center', 'right', null]);
  });
});
