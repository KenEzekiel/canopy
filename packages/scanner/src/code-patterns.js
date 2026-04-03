'use strict';

const path = require('path');
const fs = require('fs');

// ─── Helpers ────────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*');
}

function isTestFile(filePath) {
  return /(\/__tests__\/|\.test\.|\.spec\.|\/test\/|\/tests\/|\/fixtures?\/|\/mocks?\/)/i.test(filePath);
}

function extractSnippet(lines, idx) {
  const start = Math.max(0, idx - 1);
  const end = Math.min(lines.length - 1, idx + 1);
  const out = [];
  for (let i = start; i <= end; i++) {
    out.push(`${i === idx ? '> ' : '  '}${i + 1} | ${lines[i]}`);
  }
  return out.join('\n');
}

// ─── #1: Broken RLS pattern ────────────────────────────────────────────────

const BROKEN_RLS_PATTERN = /auth\.role\(\)\s*=\s*['"]authenticated['"]/i;

/**
 * Check SQL migration files for broken RLS policies.
 * auth.role() = 'authenticated' lets ANY logged-in user see ALL data.
 */
function checkBrokenRLS(files, projectRoot) {
  const findings = [];
  const sqlFiles = files.filter((f) =>
    f.endsWith('.sql') && (/migration/i.test(f) || /supabase/i.test(f) || /policies/i.test(f))
  );

  for (const relPath of sqlFiles) {
    let content;
    try {
      content = fs.readFileSync(path.join(projectRoot, relPath), 'utf-8');
    } catch { continue; }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (BROKEN_RLS_PATTERN.test(lines[i])) {
        findings.push({
          id: 'broken-rls-auth-role',
          severity: 'critical',
          title: 'Broken RLS: auth.role() = \'authenticated\' allows any user to access all rows',
          file: relPath,
          line: i + 1,
          snippet: extractSnippet(lines, i),
          description: 'This RLS policy only checks if the user is logged in, not if they OWN the data. Any authenticated user can read/modify every row in this table.\n\nImpact: User A can see and modify User B\'s data — financial records, messages, personal info — just by being logged in.',
          fix: 'Replace `auth.role() = \'authenticated\'` with an ownership check: `auth.uid() = user_id` (where user_id is the column that references the owning user).',
        });
        break;
      }
    }
  }

  return findings;
}

// ─── #7: Permissive CORS ───────────────────────────────────────────────────

const CORS_WILDCARD = /cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/i;
const CORS_CREDENTIALS_WILDCARD_A = /credentials\s*:\s*true[\s\S]{0,200}origin\s*:\s*['"]\*['"]/i;
const CORS_CREDENTIALS_WILDCARD_B = /origin\s*:\s*['"]\*['"][\s\S]{0,200}credentials\s*:\s*true/i;
const CORS_HEADER_WILDCARD = /['"]Access-Control-Allow-Origin['"]\s*[,:]\s*['"]\*['"]/i;

/**
 * Check for overly permissive CORS configuration.
 */
function checkPermissiveCORS(filePath, content) {
  if (!isCodeFile(filePath) || isTestFile(filePath)) return [];
  const findings = [];
  const lines = content.split('\n');

  // Check for credentials: true + origin: '*' (catastrophic combo, either order)
  if (CORS_CREDENTIALS_WILDCARD_A.test(content) || CORS_CREDENTIALS_WILDCARD_B.test(content)) {
    const idx = lines.findIndex((l) => /origin\s*:\s*['"]\*['"]/.test(l));
    if (idx >= 0 && !isComment(lines[idx])) {
      findings.push({
        id: 'cors-credentials-wildcard',
        severity: 'critical',
        title: 'CORS: credentials + wildcard origin allows any site to make authenticated requests',
        file: filePath,
        line: idx + 1,
        snippet: extractSnippet(lines, idx),
        description: 'Setting `credentials: true` with `origin: \'*\'` means any website can make authenticated requests to your API, including sending cookies and auth headers.\n\nImpact: An attacker\'s website can make API calls as your logged-in users — reading their data, performing actions on their behalf.',
        fix: 'Replace `origin: \'*\'` with a specific list of allowed origins: `origin: [\'https://yourdomain.com\']`',
      });
      return findings; // Don't double-flag
    }
  }

  // Check for basic wildcard CORS
  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) continue;
    if (CORS_WILDCARD.test(lines[i]) || CORS_HEADER_WILDCARD.test(lines[i])) {
      findings.push({
        id: 'cors-wildcard-origin',
        severity: 'medium',
        title: 'CORS: wildcard origin allows any website to call your API',
        file: filePath,
        line: i + 1,
        snippet: extractSnippet(lines, i),
        description: 'Setting `origin: \'*\'` allows any website to make requests to your API. This is fine for public APIs but dangerous if your API handles user data.\n\nImpact: Any website can make cross-origin requests to your API endpoints.',
        fix: 'If this API handles user data or auth, restrict origin to your domain(s): `origin: [\'https://yourdomain.com\']`',
      });
      break;
    }
  }

  return findings;
}

// ─── #8: Firebase rules misconfigured ──────────────────────────────────────

const FIREBASE_OPEN_RULES = /allow\s+read\s*,\s*write\s*:\s*if\s+true/i;
const FIREBASE_AUTH_ONLY_RULES = /allow\s+read\s*,\s*write\s*:\s*if\s+request\.auth\s*!=\s*null/i;

/**
 * Check Firebase/Firestore rules for overly permissive access.
 */
function checkFirebaseRules(files, projectRoot) {
  const findings = [];
  const ruleFiles = files.filter((f) =>
    /firestore\.rules$/i.test(f) || /storage\.rules$/i.test(f) || /database\.rules\.json$/i.test(f)
  );

  for (const relPath of ruleFiles) {
    let content;
    try {
      content = fs.readFileSync(path.join(projectRoot, relPath), 'utf-8');
    } catch { continue; }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (FIREBASE_OPEN_RULES.test(lines[i])) {
        findings.push({
          id: 'firebase-rules-open',
          severity: 'critical',
          title: 'Firebase: database is fully open (allow read, write: if true)',
          file: relPath,
          line: i + 1,
          snippet: extractSnippet(lines, i),
          description: 'Your Firebase rules allow anyone to read and write all data without any authentication.\n\nImpact: Anyone on the internet can read, modify, and delete all data in your database. No login required.',
          fix: 'At minimum, require authentication: `allow read, write: if request.auth != null`. Better: add ownership checks per collection.',
        });
        break;
      }

      if (FIREBASE_AUTH_ONLY_RULES.test(lines[i])) {
        findings.push({
          id: 'firebase-rules-auth-only',
          severity: 'high',
          title: 'Firebase: rules only check authentication, not ownership',
          file: relPath,
          line: i + 1,
          snippet: extractSnippet(lines, i),
          description: 'Your Firebase rules check if the user is logged in, but not if they own the data. Any authenticated user can access all data.\n\nImpact: User A can read and modify User B\'s data just by being logged in.',
          fix: 'Add ownership checks: `allow read, write: if request.auth.uid == resource.data.userId`',
        });
        break;
      }
    }
  }

  return findings;
}

// ─── #11: SQL injection via string concatenation ───────────────────────────

const SQL_INJECTION_TEMPLATE = /\.(query|execute|raw)\s*\(\s*`[^`]*\$\{/;

/**
 * Check for SQL injection via template literal interpolation in query calls.
 */
function checkSQLInjection(filePath, content) {
  if (!isCodeFile(filePath) || isTestFile(filePath)) return [];
  const findings = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) continue;
    if (SQL_INJECTION_TEMPLATE.test(lines[i])) {
      findings.push({
        id: 'sql-injection-template-literal',
        severity: 'critical',
        title: 'SQL injection: user input interpolated directly into query',
        file: filePath,
        line: i + 1,
        snippet: extractSnippet(lines, i),
        description: 'A SQL query uses template literal interpolation (`${variable}`) instead of parameterized queries. If the variable contains user input, this is a SQL injection vulnerability.\n\nImpact: An attacker can inject arbitrary SQL — reading all data, deleting tables, or bypassing authentication.',
        fix: 'Use parameterized queries instead:\n  Before: `.query(\\`SELECT * FROM users WHERE id = ${id}\\`)`\n  After:  `.query(\'SELECT * FROM users WHERE id = $1\', [id])`',
      });
      break;
    }
  }

  return findings;
}

// ─── #12: Sensitive data in console.log ────────────────────────────────────

const CONSOLE_SENSITIVE = /console\.(log|debug|info)\s*\([^)]*\b(password|token|secret|apiKey|api_key|credential|ssn|credit.?card|authorization)\b/i;

/**
 * Check for sensitive data being logged to console.
 */
function checkConsoleSensitive(filePath, content) {
  if (!isCodeFile(filePath) || isTestFile(filePath)) return [];
  // Also skip seed/migration/config files
  if (/seed|migration|config/i.test(filePath)) return [];
  const findings = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (isComment(lines[i])) continue;
    if (!CONSOLE_SENSITIVE.test(lines[i])) continue;

    // Reduce false positives: skip if the sensitive word is inside a plain string literal
    // e.g. console.log('Seeded with export token') — not a real leak
    // Real leaks look like: console.log(password), console.log("pw:", token), console.log({token})
    const line = lines[i];
    const sensitiveInStringOnly = /console\.(log|debug|info)\s*\(\s*['"`][^'"`]*\b(password|token|secret|apiKey|credential)\b[^'"`]*['"`]\s*\)/i.test(line);
    if (sensitiveInStringOnly) continue;

    findings.push({
      id: 'console-log-sensitive',
      severity: 'high',
      title: 'Sensitive data logged to console',
      file: filePath,
      line: i + 1,
      snippet: extractSnippet(lines, i),
      description: 'A console.log statement references sensitive data (password, token, secret, etc.). In production, this appears in browser DevTools or server logs.\n\nImpact: Passwords, tokens, or API keys visible in browser DevTools to anyone inspecting the page, or in server logs accessible to ops/infra teams.',
      fix: 'Remove the console.log, or redact sensitive fields before logging: `console.log({ ...user, password: \'[REDACTED]\' })`',
    });
    break;
  }

  return findings;
}

// ─── #14: Webhook without signature verification ───────────────────────────

const WEBHOOK_ROUTE = /['"]\/?api\/webhook|['"]\/?webhook|['"]\/?api\/stripe[_-]?webhook|['"]\/?api\/payment[_-]?webhook/i;
const SIGNATURE_VERIFY = /constructEvent|verifyWebhookSignature|verify.?signature|hmac|createHmac|webhook.?secret/i;

/**
 * Check for webhook endpoints without signature verification.
 * Only flags if a webhook route exists but no verification is found in the same file.
 */
function checkWebhookSignature(filePath, content) {
  if (!isCodeFile(filePath) || isTestFile(filePath)) return [];
  const findings = [];

  if (!WEBHOOK_ROUTE.test(content)) return findings;
  if (SIGNATURE_VERIFY.test(content)) return findings; // Has verification — OK

  const lines = content.split('\n');
  const idx = lines.findIndex((l) => WEBHOOK_ROUTE.test(l));
  if (idx < 0) return findings;

  findings.push({
    id: 'webhook-no-signature-verification',
    severity: 'high',
    title: 'Webhook endpoint without signature verification',
    file: filePath,
    line: idx + 1,
    snippet: extractSnippet(lines, idx),
    description: 'This webhook endpoint does not appear to verify the request signature. Without verification, anyone can send fake webhook events to your endpoint.\n\nImpact: An attacker can forge payment confirmations, trigger fake events, or manipulate your application state by sending crafted webhook payloads.',
    fix: 'Verify the webhook signature using the provider\'s SDK:\n  Stripe: `stripe.webhooks.constructEvent(body, sig, webhookSecret)`\n  Generic: verify HMAC signature from the X-Signature header.',
  });

  return findings;
}

// ─── Exports ───────────────────────────────────────────────────────────────

/**
 * Run all code pattern checks on a single file.
 * @param {string} filePath - Relative file path
 * @param {string} content - File content
 * @returns {import('./types').Finding[]}
 */
function checkCodePatterns(filePath, content) {
  return [
    ...checkPermissiveCORS(filePath, content),
    ...checkSQLInjection(filePath, content),
    ...checkConsoleSensitive(filePath, content),
    ...checkWebhookSignature(filePath, content),
  ];
}

/**
 * Run project-level code pattern checks (need full file list).
 * @param {string[]} files - All relative file paths
 * @param {string} projectRoot - Absolute project root
 * @returns {import('./types').Finding[]}
 */
function checkProjectPatterns(files, projectRoot) {
  return [
    ...checkBrokenRLS(files, projectRoot),
    ...checkFirebaseRules(files, projectRoot),
  ];
}

module.exports = { checkCodePatterns, checkProjectPatterns };
