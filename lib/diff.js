// ============================================================
// Save Research — Text Diff
// ============================================================
// Simple line-based diff for comparing content versions.

/**
 * Compute a simple line-based diff between two texts.
 * Uses longest common subsequence approach.
 * @param {string} oldText - Previous version
 * @param {string} newText - Current version
 * @returns {Array<{ type: 'same'|'added'|'removed', text: string }>}
 */
function diffLines(oldText, newText) {
  if (!oldText && !newText) return [];
  if (!oldText) return newText.split('\n').map(text => ({ type: 'added', text }));
  if (!newText) return oldText.split('\n').map(text => ({ type: 'removed', text }));

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;

  // For very large texts, fall back to simpler approach
  if (m * n > 1000000) {
    return simpleDiff(oldLines, newLines);
  }

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const result = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

/**
 * Simple diff for large texts — just marks everything as changed.
 * @param {string[]} oldLines
 * @param {string[]} newLines
 * @returns {Array<{ type: string, text: string }>}
 */
function simpleDiff(oldLines, newLines) {
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const result = [];

  for (const line of oldLines) {
    if (!newSet.has(line)) {
      result.push({ type: 'removed', text: line });
    }
  }
  for (const line of newLines) {
    if (!oldSet.has(line)) {
      result.push({ type: 'added', text: line });
    } else {
      result.push({ type: 'same', text: line });
    }
  }

  return result;
}

/**
 * Generate a human-readable summary of changes.
 * @param {Array<{ type: string, text: string }>} diff - Diff result from diffLines
 * @returns {{ added: number, removed: number, unchanged: number, summary: string }}
 */
function diffSummary(diff) {
  if (!diff || diff.length === 0) {
    return { added: 0, removed: 0, unchanged: 0, summary: 'No content to compare.' };
  }

  const added = diff.filter(d => d.type === 'added').length;
  const removed = diff.filter(d => d.type === 'removed').length;
  const unchanged = diff.filter(d => d.type === 'same').length;

  const parts = [];
  if (added > 0) parts.push(`${added} line${added !== 1 ? 's' : ''} added`);
  if (removed > 0) parts.push(`${removed} line${removed !== 1 ? 's' : ''} removed`);
  if (parts.length === 0) return { added, removed, unchanged, summary: 'No changes detected.' };

  return { added, removed, unchanged, summary: parts.join(', ') + '.' };
}

/**
 * Render a diff as HTML.
 * @param {Array<{ type: string, text: string }>} diff
 * @returns {string} HTML
 */
function renderDiffHtml(diff) {
  if (!diff || diff.length === 0) return '<p>No changes.</p>';

  const lines = diff.map(d => {
    const escaped = d.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (d.type === 'added') return `<div class="diff-added">+ ${escaped}</div>`;
    if (d.type === 'removed') return `<div class="diff-removed">- ${escaped}</div>`;
    return `<div class="diff-same">  ${escaped}</div>`;
  });

  return lines.join('');
}

// Export for both Node.js (testing) and browser (extension)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { diffLines, diffSummary, renderDiffHtml };
}
