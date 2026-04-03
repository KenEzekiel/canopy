import { SECRET_PATTERNS } from './patterns';
import { Finding } from './types';

const LOW_CONFIDENCE_PATH_PATTERNS = [
  /\/__tests__\//i, /\/test\//i, /\/tests\//i,
  /\.test\.[jt]sx?$/i, /\.spec\.[jt]sx?$/i,
  /\/fixtures?\//i, /\/mocks?\//i, /\/examples?\//i, /\/docs?\//i,
  /\.example$/i, /\.sample$/i, /\.template$/i,
  /README/i, /CHANGELOG/i, /\.md$/i,
];

const PLACEHOLDER_PATTERNS = [
  /your[-_]?(key|secret|token|api[-_]?key)/i,
  /xxx+/i, /replace[-_]?me/i, /changeme/i,
  /TODO/, /FIXME/, /example/i, /placeholder/i, /dummy/i,
  /test[-_]?key/i, /fake[-_]?(key|secret)/i, /sk-\.{3,}/,
];

function isLowConfidencePath(filePath: string): boolean {
  return LOW_CONFIDENCE_PATH_PATTERNS.some((p) => p.test(filePath));
}

function isPlaceholder(matchedValue: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(matchedValue));
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function maskSecret(value: string): string {
  if (value.length <= 12) return value.slice(0, 4) + '...' + value.slice(-2);
  return value.slice(0, 6) + '...' + value.slice(-4);
}

function extractSnippet(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length - 1, lineIndex + 1);
  const snippetLines: string[] = [];
  for (let i = start; i <= end; i++) {
    const prefix = i === lineIndex ? '> ' : '  ';
    snippetLines.push(`${prefix}${i + 1} | ${lines[i]}`);
  }
  return snippetLines.join('\n');
}

function getAttackImpact(patternId: string): string {
  const impacts: Record<string, string> = {
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

export function detectSecrets(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');
  const lowConfidence = isLowConfidencePath(filePath);

  for (const secret of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(secret.pattern);
      if (!match) continue;

      const matchedValue = match[0];
      if (isComment(line)) continue;
      if (isPlaceholder(matchedValue)) continue;
      if (lowConfidence) continue;

      const snippet = extractSnippet(lines, i);
      const masked = maskSecret(matchedValue);
      const impact = getAttackImpact(secret.id);

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
      break;
    }
  }

  return findings;
}
