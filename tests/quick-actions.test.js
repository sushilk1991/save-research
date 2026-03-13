const { getQuickActions } = require('../lib/quick-actions');

describe('getQuickActions', () => {
  test('returns common actions for unknown type', () => {
    const actions = getQuickActions('page');
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Summarize');
    expect(labels).toContain('Key takeaways');
    expect(labels).toContain('ELI5');
  });

  test('returns YouTube-specific actions', () => {
    const actions = getQuickActions('youtube');
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Chapters');
    expect(labels).toContain('Action items');
    expect(labels).toContain('Quotes');
  });

  test('adds study notes and quiz for YouTube with transcript', () => {
    const actions = getQuickActions('youtube', { hasTranscript: true });
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Study notes');
    expect(labels).toContain('Quiz me');
  });

  test('omits study notes for YouTube without transcript', () => {
    const actions = getQuickActions('youtube', { hasTranscript: false });
    const labels = actions.map(a => a.label);
    expect(labels).not.toContain('Study notes');
  });

  test('returns Twitter-specific actions', () => {
    const actions = getQuickActions('twitter');
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Thread TL;DR');
    expect(labels).toContain('Counter-arguments');
    expect(labels).toContain('Fact check');
    expect(labels).toContain('Related topics');
  });

  test('adds study notes for long pages', () => {
    const actions = getQuickActions('page', { wordCount: 3000 });
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Study notes');
    expect(labels).toContain('Outline');
  });

  test('adds quiz for medium pages', () => {
    const actions = getQuickActions('page', { wordCount: 800 });
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Quiz me');
  });

  test('omits study notes and quiz for short pages', () => {
    const actions = getQuickActions('page', { wordCount: 200 });
    const labels = actions.map(a => a.label);
    expect(labels).not.toContain('Study notes');
    expect(labels).not.toContain('Quiz me');
  });

  test('returns Reddit-specific actions', () => {
    const actions = getQuickActions('reddit');
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Best comments');
    expect(labels).toContain('Consensus');
    expect(labels).toContain('TL;DR');
  });

  test('returns Hacker News-specific actions', () => {
    const actions = getQuickActions('hackernews');
    const labels = actions.map(a => a.label);
    expect(labels).toContain('Best insights');
    expect(labels).toContain('Resources');
    expect(labels).toContain('Debate');
  });

  test('all actions have both label and prompt', () => {
    for (const type of ['youtube', 'twitter', 'reddit', 'hackernews', 'page']) {
      const actions = getQuickActions(type, { hasTranscript: true, wordCount: 5000 });
      for (const action of actions) {
        expect(action.label).toBeTruthy();
        expect(action.prompt).toBeTruthy();
        expect(typeof action.label).toBe('string');
        expect(typeof action.prompt).toBe('string');
      }
    }
  });
});
