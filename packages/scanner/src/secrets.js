'use strict';

const path = require('path');
const { SECRET_PATTERNS } = require('./patterns');

/**
 * File paths that indicate test/example/doc context — lower confidence.
 */
const LOW_CONFIDENCE_PATH_PATTERNS = [
  /\/__tests__\//i,
  /\/test\//i,
  /\/tests\//i,
  /\.test\.[jt]sx?$/i,
  /\.spec\.[jt]sx?$/i,
  /\/fixtures?\//i,
  /\/mocks?\//i,
  /\/examples?\//i,
  /\/docs?\//i,
  /\.example$/i,
  /\.sample$/i,
  /\.template$/i,
  /README/i,
  /CHANGELOG/i,
  /\.md$/i,
];

/**
 * Placeholder values that aren't real secrets.
 */
const PLACEHOLDER_PATTERNS = [
  /your[-_]?(key|secret|token|api[-_]?key)/i,
  /xxx+/i,
  /replace[-_]?me/i,
  /changeme/i,
  /TODO/,
  /FIXME/,
  /example/i,
  /placeholder/i,
  /dummy/i,
  /test[-_]?key/i,
  /fake[-_]?(key|secret)/i,
  /sk-\.{3,}/,  // sk-... (redacted)
];

/**
 * Check if a file path suggests low-confidence context (test, example, docs).
 * @param {string} filePath
 * @returns {boolean}
 */
function isLowConfidencePath(filePath) {
  return LOW_CONFIDENCE_PATH_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Check if the matched value looks like a placeholder, not a real secret.
 * Only checks the matched value itself to avoid false negatives from
 * words like "example" appearing elsewhere on the line.
 * @param {string} matchedValue - The regex match itself
 * @returns {boolean}
 */
function isPlaceholder(matchedValue) {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(matchedValue));
}

/**
 * Check if a line is inside a comment.
 * @param {string} line
 * @returns {boolean}
 */
function isComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/**
 * Mask a secret value for display, showing first 6 and last 4 chars.
 * @param {string} value
 * @returns {string}
 */
function maskSecret(value) {
  if (value.length <= 12) return value.slice(0, 4) + '...' + value.slice(-2);
  return value.slice(0, 6) + '...' + value.slice(-4);
}

/**
 * Extract a code snippet around the finding line.
 * @param {string[]} lines - All lines of the file
 * @param {number} lineIndex - 0-based index of the finding line
 * @returns {string}
 */
function extractSnippet(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length - 1, lineIndex + 1);
  const snippetLines = [];
  for (let i = start; i <= end; i++) {
    const prefix = i === lineIndex ? '> ' : '  ';
    snippetLines.push(`${prefix}${i + 1} | ${lines[i]}`);
  }
  return snippetLines.join('\n');
}

/**
 * Build the "what an attacker could do" impact line per pattern.
 * @param {string} patternId
 * @param {string} matchedValue
 * @returns {string}
 */
function getAttackImpact(patternId, matchedValue) {
  const impacts = {
    'secret-supabase-anon-key': 'With this key, anyone can query your Supabase database directly — including `SELECT * FROM users` — if Row Level Security is not enabled.',
    'secret-firebase-config': 'An attacker can use this key to access your Firebase project, potentially reading/writing data if security rules are permissive.',
    'secret-openai-key': 'Anyone with this key can make unlimited API calls billed to your OpenAI account. A single leaked key can rack up thousands in charges overnight.',
    'secret-stripe-key': 'This gives full access to your Stripe account — an attacker can issue refunds, create charges, and access customer payment data.',
    'secret-aws-access-key': 'An attacker can use this to access your AWS resources — spin up crypto miners, read S3 buckets, or delete infrastructure.',
    'secret-generic-api-key': 'This API key could grant access to external services. The impact depends on what the key controls.',
    'secret-database-url': 'This connection string may include credentials. An attacker can connect directly to your database and read, modify, or delete all data.',
    'secret-private-key': 'A private key allows impersonation — signing tokens, decrypting data, or authenticating as your service.',
  };
  return impacts[patternId] || 'An attacker could use this credential to access protected resources.';
}

/**
 * Scan file content for hardcoded secrets with context-awareness.
 * @param {string} filePath - Relative path of the file
 * @param {string} content - File content
 * @returns {import('./types').Finding[]}
 */
function detectSecrets(filePath, content) {
  const findings = [];
  const lines = content.split('\n');
  const lowConfidence = isLowConfidencePath(filePath);

  for (const secret of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(secret.pattern);
      if (!match) continue;

      const matchedValue = match[0];

      // Skip comments
      if (isComment(line)) continue;

      // Skip placeholder values
      if (isPlaceholder(matchedValue)) continue;

      // Skip low-confidence paths (test/example/docs) — don't flag
      if (lowConfidence) continue;

      const snippet = extractSnippet(lines, i);
      const masked = maskSecret(matchedValue);
      const impact = getAttackImpact(secret.id, matchedValue);

      findings.push({
        id: secret.id,
        severity: secret.severity,
        title: `${secret.name} exposed: \`${masked}\``,
        file: filePath,
        line: i + 1,
        snippet,
        description: `${secret.description}\n\nImpact: ${impact}`,
        fix: secret.fix,
      });
      // One finding per pattern per file is enough
      break;
    }
  }

  return findings;
}

module.exports = { detectSecrets, isLowConfidencePath, isPlaceholder };
