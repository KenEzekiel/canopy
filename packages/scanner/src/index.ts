import * as fs from 'fs';
import * as path from 'path';
import { SKIP_DIRS, SCANNABLE_EXTENSIONS } from './patterns';
import { detectSecrets } from './secrets';
import { detectTestCredentials } from './credentials';
import { checkSupabaseSecurity } from './supabase';
import { checkCodePatterns, checkProjectPatterns } from './code-patterns';
import { calculateScore } from './scoring';
import { Finding, ScanResult } from './types';

export type { Finding, ScanResult, Severity, ScanSummary, ScanMeta } from './types';

const SCANNER_PKG_DIR = path.resolve(__dirname, '..');

function walkDir(dir: string, root: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.resolve(fullPath) === SCANNER_PKG_DIR) continue;
      results.push(...walkDir(fullPath, root));
    } else if (entry.isFile()) results.push(path.relative(root, fullPath));
  }
  return results;
}

function parseGitignoreLines(gitignorePath: string): string[] {
  try {
    return fs.readFileSync(gitignorePath, 'utf-8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch { return []; }
}

function isIgnoredByPatterns(basename: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (p === basename) return true;
    if (p === '.env*' && basename.startsWith('.env')) return true;
    if (p === '.env.*' && (basename === '.env' || basename.startsWith('.env.'))) return true;
    if (p === '*.env' && basename.endsWith('.env')) return true;
  }
  return false;
}

function collectGitignorePatterns(projectRoot: string, relFilePath: string): string[] {
  const patterns: string[] = [];
  const parts = path.dirname(relFilePath).split(path.sep);
  patterns.push(...parseGitignoreLines(path.join(projectRoot, '.gitignore')));
  let current = projectRoot;
  for (const part of parts) {
    if (part === '.') continue;
    current = path.join(current, part);
    patterns.push(...parseGitignoreLines(path.join(current, '.gitignore')));
  }
  return patterns;
}

function checkCommittedEnvFiles(files: string[], projectRoot: string): Finding[] {
  const findings: Finding[] = [];
  const envFiles = files.filter((f) => {
    const base = path.basename(f);
    return base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example') && !base.endsWith('.sample') && !base.endsWith('.template'));
  });

  for (const envFile of envFiles) {
    const basename = path.basename(envFile);
    const patterns = collectGitignorePatterns(projectRoot, envFile);
    if (isIgnoredByPatterns(basename, patterns)) continue;

    findings.push({
      id: 'env-committed', severity: 'critical',
      title: `Environment file committed: ${envFile}`,
      file: envFile,
      description: 'A .env file is present in the project and is NOT covered by .gitignore. It may be committed to version control with secrets inside.',
      fix: `Add ${envFile} to .gitignore and remove it from version control with: git rm --cached ${envFile}`,
    });
  }
  return findings;
}

function checkGitignore(projectPath: string): Finding[] {
  const findings: Finding[] = [];
  const gitignorePath = path.join(projectPath, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    findings.push({
      id: 'gitignore-missing', severity: 'critical',
      title: 'No .gitignore file found', file: '.gitignore',
      description: 'The project has no .gitignore file. Secrets, build artifacts, and dependencies may be accidentally committed.',
      fix: 'Create a .gitignore file that at minimum includes: .env*, node_modules/, dist/, build/',
    });
    return findings;
  }

  const lines = parseGitignoreLines(gitignorePath);
  const hasEnvRule = lines.some(
    (l) => l === '.env' || l === '.env*' || l === '.env.*' || l === '*.env' || l === '.env.local'
  );
  if (!hasEnvRule) {
    findings.push({
      id: 'gitignore-no-env', severity: 'critical',
      title: '.gitignore does not cover .env files', file: '.gitignore',
      description: 'Your .gitignore does not include a rule for .env files. Environment files containing secrets could be accidentally committed.',
      fix: 'Add .env* to your .gitignore file.',
    });
  }
  return findings;
}

export function scan(projectPath: string): ScanResult {
  const startTime = Date.now();
  const absPath = path.resolve(projectPath);

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${projectPath}`);
  }

  const allFiles = walkDir(absPath, absPath);
  const findings: Finding[] = [];

  findings.push(...checkCommittedEnvFiles(allFiles, absPath));
  findings.push(...checkGitignore(absPath));

  let filesScanned = 0;
  for (const relPath of allFiles) {
    const ext = path.extname(relPath).toLowerCase();
    const base = path.basename(relPath);
    if (!SCANNABLE_EXTENSIONS.has(ext) && !base.startsWith('.env')) continue;

    if (base.startsWith('.env') && !base.endsWith('.example') && !base.endsWith('.sample') && !base.endsWith('.template')) {
      const patterns = collectGitignorePatterns(absPath, relPath);
      if (isIgnoredByPatterns(base, patterns)) continue;
    }

    const fullPath = path.join(absPath, relPath);
    let content: string;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 1_048_576) continue;
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch { continue; }

    filesScanned++;
    findings.push(...detectSecrets(relPath, content));
    findings.push(...detectTestCredentials(relPath, content));
    findings.push(...checkCodePatterns(relPath, content));
  }

  findings.push(...checkSupabaseSecurity(allFiles, absPath));
  findings.push(...checkProjectPatterns(allFiles, absPath));

  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const key = `${f.file}:${f.line || 0}:${f.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { score, summary } = calculateScore(deduped);

  return { score, summary, findings: deduped, meta: { filesScanned, timeMs: Date.now() - startTime } };
}
