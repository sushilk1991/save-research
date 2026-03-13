const { diffLines, diffSummary, renderDiffHtml } = require('../lib/diff');

describe('diffLines', () => {
  test('returns empty for two empty strings', () => {
    expect(diffLines('', '')).toEqual([]);
  });

  test('all added when old is empty', () => {
    const result = diffLines('', 'line1\nline2');
    expect(result).toEqual([
      { type: 'added', text: 'line1' },
      { type: 'added', text: 'line2' },
    ]);
  });

  test('all removed when new is empty', () => {
    const result = diffLines('line1\nline2', '');
    expect(result).toEqual([
      { type: 'removed', text: 'line1' },
      { type: 'removed', text: 'line2' },
    ]);
  });

  test('detects no changes', () => {
    const text = 'line1\nline2\nline3';
    const result = diffLines(text, text);
    expect(result.every(d => d.type === 'same')).toBe(true);
    expect(result).toHaveLength(3);
  });

  test('detects added lines', () => {
    const result = diffLines('A\nB', 'A\nB\nC');
    const added = result.filter(d => d.type === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].text).toBe('C');
  });

  test('detects removed lines', () => {
    const result = diffLines('A\nB\nC', 'A\nC');
    const removed = result.filter(d => d.type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].text).toBe('B');
  });

  test('detects mixed changes', () => {
    const result = diffLines('A\nB\nC', 'A\nD\nC');
    const types = result.map(d => d.type);
    expect(types).toContain('same');
    expect(types.includes('added') || types.includes('removed')).toBe(true);
  });
});

describe('diffSummary', () => {
  test('returns no content message for empty diff', () => {
    expect(diffSummary([]).summary).toBe('No content to compare.');
  });

  test('reports no changes', () => {
    const diff = [{ type: 'same', text: 'line' }];
    expect(diffSummary(diff).summary).toBe('No changes detected.');
  });

  test('reports added lines', () => {
    const diff = [
      { type: 'same', text: 'A' },
      { type: 'added', text: 'B' },
    ];
    const summary = diffSummary(diff);
    expect(summary.added).toBe(1);
    expect(summary.summary).toContain('1 line added');
  });

  test('reports removed lines', () => {
    const diff = [
      { type: 'removed', text: 'A' },
      { type: 'same', text: 'B' },
    ];
    const summary = diffSummary(diff);
    expect(summary.removed).toBe(1);
    expect(summary.summary).toContain('1 line removed');
  });

  test('reports mixed changes', () => {
    const diff = [
      { type: 'removed', text: 'A' },
      { type: 'added', text: 'B' },
      { type: 'added', text: 'C' },
    ];
    const summary = diffSummary(diff);
    expect(summary.added).toBe(2);
    expect(summary.removed).toBe(1);
    expect(summary.summary).toContain('2 lines added');
    expect(summary.summary).toContain('1 line removed');
  });
});

describe('renderDiffHtml', () => {
  test('returns no changes for empty diff', () => {
    expect(renderDiffHtml([])).toContain('No changes');
  });

  test('renders added lines with class', () => {
    const diff = [{ type: 'added', text: 'new line' }];
    const html = renderDiffHtml(diff);
    expect(html).toContain('diff-added');
    expect(html).toContain('+ new line');
  });

  test('renders removed lines with class', () => {
    const diff = [{ type: 'removed', text: 'old line' }];
    const html = renderDiffHtml(diff);
    expect(html).toContain('diff-removed');
    expect(html).toContain('- old line');
  });

  test('escapes HTML in diff content', () => {
    const diff = [{ type: 'added', text: '<script>alert("xss")</script>' }];
    const html = renderDiffHtml(diff);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
