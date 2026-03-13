// ============================================================
// Save Research — Smart Quick Actions
// ============================================================
// Returns context-aware action prompts based on content type.

/**
 * Get quick action prompts for a given content type.
 * @param {string} type - Content type: 'youtube', 'twitter', 'page'
 * @param {object} [meta] - Additional metadata (e.g., transcript availability)
 * @returns {Array<{ label: string, prompt: string }>}
 */
function getQuickActions(type, meta = {}) {
  const common = [
    { label: 'Summarize', prompt: 'Summarize this content in a few concise paragraphs' },
    { label: 'Key takeaways', prompt: 'What are the key takeaways? List them as bullet points' },
    { label: 'ELI5', prompt: 'Explain this in simple terms, as if I\'m five years old' },
  ];

  if (type === 'youtube') {
    const actions = [
      ...common,
      { label: 'Chapters', prompt: 'Break this video into logical chapters with timestamps and brief descriptions' },
      { label: 'Action items', prompt: 'What actionable advice or steps does this video suggest? List them clearly' },
      { label: 'Quotes', prompt: 'What are the most memorable or important quotes from this video?' },
    ];

    if (meta.hasTranscript) {
      actions.push(
        { label: 'Study notes', prompt: 'Create detailed study notes from this video transcript, organized by topic' },
        { label: 'Quiz me', prompt: 'Generate 5 quiz questions based on the content of this video to test my understanding' },
      );
    }

    return actions;
  }

  if (type === 'reddit') {
    return [
      ...common,
      { label: 'Best comments', prompt: 'What are the most insightful or highest-quality comments in this discussion?' },
      { label: 'Consensus', prompt: 'What is the general consensus in the comments? Where do people agree and disagree?' },
      { label: 'Counter-arguments', prompt: 'What counter-arguments or criticisms are raised in the comments?' },
      { label: 'TL;DR', prompt: 'Give me a TL;DR of the post and the key points from the discussion' },
    ];
  }

  if (type === 'hackernews') {
    return [
      ...common,
      { label: 'Best insights', prompt: 'What are the most insightful or expert comments in this Hacker News discussion?' },
      { label: 'Consensus', prompt: 'What does the HN community think about this? Summarize the discussion sentiment' },
      { label: 'Resources', prompt: 'What links, tools, or resources are mentioned in the comments?' },
      { label: 'Debate', prompt: 'What are the main points of debate or disagreement in this discussion?' },
    ];
  }

  if (type === 'twitter') {
    return [
      ...common,
      { label: 'Thread TL;DR', prompt: 'Give me a TL;DR of this tweet thread in 2-3 sentences' },
      { label: 'Counter-arguments', prompt: 'What are potential counter-arguments or criticisms of the points made in these tweets?' },
      { label: 'Fact check', prompt: 'Are there any claims in these tweets that seem questionable or need fact-checking? Identify them' },
      { label: 'Related topics', prompt: 'What related topics or concepts should I explore to understand this better?' },
    ];
  }

  // General page
  const actions = [
    ...common,
    { label: 'Bullet points', prompt: 'Create concise bullet points covering all the main points' },
    { label: 'Critique', prompt: 'What are the strengths and weaknesses of the arguments in this content?' },
    { label: 'Questions', prompt: 'What are the most important questions this raises? What\'s left unanswered?' },
  ];

  if (meta.wordCount > 2000) {
    actions.push(
      { label: 'Study notes', prompt: 'Create organized study notes from this content with key concepts and definitions' },
      { label: 'Outline', prompt: 'Create a hierarchical outline of this content\'s structure and main points' },
    );
  }

  if (meta.wordCount > 500) {
    actions.push(
      { label: 'Quiz me', prompt: 'Generate 5 quiz questions based on this content to test my understanding' },
    );
  }

  return actions;
}

// Export for both Node.js (testing) and browser (extension)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getQuickActions };
}
