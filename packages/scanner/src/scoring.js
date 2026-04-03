'use strict';

const SEVERITY_PENALTIES = {
  critical: 20,
  high: 10,
  medium: 5,
  low: 2,
};

/**
 * Calculate security score from findings.
 * Starts at 100, deducts per severity. Min 0.
 * @param {import('./types').Finding[]} findings
 * @returns {{ score: number, summary: import('./types').ScanSummary }}
 */
function calculateScore(findings) {
  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  let score = 100;

  for (const f of findings) {
    summary[f.severity]++;
    score -= SEVERITY_PENALTIES[f.severity] || 0;
  }

  return { score: Math.max(0, score), summary };
}

module.exports = { calculateScore };
