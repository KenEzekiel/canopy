import * as path from 'path';
import { Finding } from './types';

const TEST_CREDENTIAL_PATTERNS = [
  { pattern: /(['"`])admin\1\s*[,;]?\s*.*(['"`])admin123\2/i, name: 'admin/admin123' },
  { pattern: /(['"`])admin\1\s*[,;]?\s*.*(['"`])password\2/i, name: 'admin/password' },
  { pattern: /(['"`])test@test\.com\1/i, name: 'test@test.com' },
  { pattern: /(['"`])user@example\.com\1\s*[,;]?\s*.*(['"`])password\2/i, name: 'user@example.com/password' },
  { pattern: /password\s*[:=]\s*(['"`])password(123)?\1/i, name: 'password=password' },
  { pattern: /password\s*[:=]\s*(['"`])123456\1/i, name: 'password=123456' },
  { pattern: /password\s*[:=]\s*(['"`])admin\1/i, name: 'password=admin' },
  { pattern: /secret\s*[:=]\s*(['"`])secret\1/i, name: 'secret=secret' },
];

const SEED_FILE_PATTERNS = [
  /seed/i, /fixture/i, /mock/i,
  /\/__tests__\//i, /\.test\.[jt]sx?$/i, /\.spec\.[jt]sx?$/i,
];

export function detectTestCredentials(filePath: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const ext = path.extname(filePath).toLowerCase();

  if (!['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb'].includes(ext)) return findings;
  if (SEED_FILE_PATTERNS.some((p) => p.test(filePath))) return findings;

  const lines = content.split('\n');

  for (const cred of TEST_CREDENTIAL_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (cred.pattern.test(line)) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) continue;

        findings.push({
          id: 'hardcoded-test-credentials',
          severity: 'high',
          title: `Hardcoded test credentials: ${cred.name}`,
          file: filePath,
          line: i + 1,
          description: `Test credentials (${cred.name}) are hardcoded in production code. AI coding tools often generate these during development and they ship to production.\n\nImpact: An attacker can try these default credentials to gain access to your application or admin panel.`,
          fix: 'Remove hardcoded credentials. Use environment variables for any auth configuration, and ensure seed/test data is not included in production builds.',
        });
        break;
      }
    }
  }

  return findings;
}
