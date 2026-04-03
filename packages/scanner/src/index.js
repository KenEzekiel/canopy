'use strict';

const fs = require('fs');
const path = require('path');
const { SKIP_DIRS, SCANNABLE_EXTENSIONS } = require('./patterns');
const { detectSecrets } = require('./secrets');
const { detectTestCredentials } = require('./credentials');
const { checkSupabaseSecurity } = require('./supabase');
const { checkCodePatterns, checkProjectPatterns } = require('./code-patterns');
const { calculateScore } = require('./scoring');

/**
 * Recursively walk a directory, yielding file paths.
 * Skips node_modules, .git, etc.
 * @param {string} dir - Absolute path to walk
 * @param {string} root - Project root for relative paths
 * @returns {string[]} Array of relative file paths
 */
function walkDir(dir, root) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, root));
    } else if (entry.isFile()) {
      results.push(path.relative(root, fullPath));
    }
  }

  return results;
}

/**
 * Check if .env files are committed (exist in the project tree).
 * @param {string[]} files - Relative file paths
 * @returns {import('./types').Finding[]}
 */
/**
 * Parse a .gitignore file and return non-comment, non-empty lines.
 * @param {string} gitignorePath - Absolute path to .gitignore
 * @returns {string[]}
 */
function parseGitignoreLines(gitignorePath) {
  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Check if a file basename is covered by any gitignore pattern.
 * Handles: .env, .env*, .env.*, *.env
 * @param {string} basename - e.g. ".env" or ".env.local"
 * @param {string[]} patterns - gitignore lines
 * @returns {boolean}
 */
function isIgnoredByPatterns(basename, patterns) {
  for (const p of patterns) {
    if (p === basename) return true;
    // .env* matches .env, .env.local, .env.production, etc.
    if (p === '.env*' && basename.startsWith('.env')) return true;
    if (p === '.env.*' && (basename === '.env' || basename.startsWith('.env.'))) return true;
    if (p === '*.env' && basename.endsWith('.env')) return true;
  }
  return false;
}

/**
 * Collect all gitignore patterns that apply to a given file path.
 * Walks from project root down to the file's directory, collecting patterns.
 * @param {string} projectRoot - Absolute project root
 * @param {string} relFilePath - Relative file path
 * @returns {string[]}
 */
function collectGitignorePatterns(projectRoot, relFilePath) {
  const patterns = [];
  const parts = path.dirname(relFilePath).split(path.sep);

  // Root .gitignore
  patterns.push(...parseGitignoreLines(path.join(projectRoot, '.gitignore')));

  // Walk down to the file's directory, collecting sub-gitignores
  let current = projectRoot;
  for (const part of parts) {
    if (part === '.') continue;
    current = path.join(current, part);
    patterns.push(...parseGitignoreLines(path.join(current, '.gitignore')));
  }

  return patterns;
}

/**
 * Check if .env files exist AND are not covered by any .gitignore.
 * Only flags .env files that would actually be committed.
 * @param {string[]} files - Relative file paths
 * @param {string} projectRoot - Absolute project root
 * @returns {import('./types').Finding[]}
 */
function checkCommittedEnvFiles(files, projectRoot) {
  const findings = [];
  const envFiles = files.filter((f) => {
    const base = path.basename(f);
    return base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example') && !base.endsWith('.sample') && !base.endsWith('.template'));
  });

  for (const envFile of envFiles) {
    const basename = path.basename(envFile);
    const patterns = collectGitignorePatterns(projectRoot, envFile);

    if (isIgnoredByPatterns(basename, patterns)) {
      // Covered by gitignore — not a real finding
      continue;
    }

    findings.push({
      id: 'env-committed',
      severity: 'critical',
      title: `Environment file committed: ${envFile}`,
      file: envFile,
      description: 'A .env file is present in the project and is NOT covered by .gitignore. It may be committed to version control with secrets inside.',
      fix: `Add ${envFile} to .gitignore and remove it from version control with: git rm --cached ${envFile}`,
    });
  }

  return findings;
}

/**
 * Check if .gitignore exists and covers .env files.
 * @param {string} projectPath - Absolute project root
 * @returns {import('./types').Finding[]}
 */
/**
 * Check if .gitignore exists and covers .env files.
 * Checks root .gitignore only (sub-directory gitignores are handled in checkCommittedEnvFiles).
 * @param {string} projectPath - Absolute project root
 * @returns {import('./types').Finding[]}
 */
function checkGitignore(projectPath) {
  const findings = [];
  const gitignorePath = path.join(projectPath, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    findings.push({
      id: 'gitignore-missing',
      severity: 'critical',
      title: 'No .gitignore file found',
      file: '.gitignore',
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
      id: 'gitignore-no-env',
      severity: 'critical',
      title: '.gitignore does not cover .env files',
      file: '.gitignore',
      description: 'Your .gitignore does not include a rule for .env files. Environment files containing secrets could be accidentally committed.',
      fix: 'Add .env* to your .gitignore file.',
    });
  }

  return findings;
}

/**
 * Scan a project directory for security issues.
 * @param {string} projectPath - Path to the project root
 * @returns {import('./types').ScanResult}
 */
function scan(projectPath) {
  const startTime = Date.now();
  const absPath = path.resolve(projectPath);

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
    throw new Error(`Project path does not exist or is not a directory: ${projectPath}`);
  }

  const allFiles = walkDir(absPath, absPath);
  const findings = [];

  // 1. Check for committed .env files (cross-referenced against .gitignore)
  findings.push(...checkCommittedEnvFiles(allFiles, absPath));

  // 2. Check .gitignore coverage
  findings.push(...checkGitignore(absPath));

  // 3. Scan source files for hardcoded secrets + test credentials
  let filesScanned = 0;
  for (const relPath of allFiles) {
    const ext = path.extname(relPath).toLowerCase();
    const base = path.basename(relPath);

    // Scan files with known extensions OR extensionless dotfiles like .env
    if (!SCANNABLE_EXTENSIONS.has(ext) && !base.startsWith('.env')) continue;

    // Skip gitignored .env files — they contain secrets by design
    if (base.startsWith('.env') && !base.endsWith('.example') && !base.endsWith('.sample') && !base.endsWith('.template')) {
      const patterns = collectGitignorePatterns(absPath, relPath);
      if (isIgnoredByPatterns(base, patterns)) continue;
    }

    const fullPath = path.join(absPath, relPath);
    let content;
    try {
      // Skip large files (>1MB) — likely not source code
      const stat = fs.statSync(fullPath);
      if (stat.size > 1_048_576) continue;
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    filesScanned++;
    findings.push(...detectSecrets(relPath, content));
    findings.push(...detectTestCredentials(relPath, content));
    findings.push(...checkCodePatterns(relPath, content));
  }

  // 4. Supabase deep security check (anon key + RLS)
  findings.push(...checkSupabaseSecurity(allFiles, absPath));

  // 5. Project-level code pattern checks (broken RLS, Firebase rules)
  findings.push(...checkProjectPatterns(allFiles, absPath));

  // 6. Deduplicate findings (same file + same line + same id)
  const seen = new Set();
  const deduped = findings.filter((f) => {
    const key = `${f.file}:${f.line || 0}:${f.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const { score, summary } = calculateScore(deduped);

  return {
    score,
    summary,
    findings: deduped,
    meta: {
      filesScanned,
      timeMs: Date.now() - startTime,
    },
  };
}

module.exports = { scan };
