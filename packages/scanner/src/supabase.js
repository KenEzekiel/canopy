'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Client-side path patterns where a Supabase anon key is dangerous.
 */
const CLIENT_PATHS = [
  /^src\/(app|pages|components|lib|utils|hooks)\//,
  /^app\//,
  /^pages\//,
  /^components\//,
  /^lib\//,
  /^frontend\//,
  /^client\//,
  /^public\//,
];

/**
 * Deep Supabase security check:
 * 1. Is createClient() called with a hardcoded key in client-side code?
 * 2. Does a supabase/migrations folder exist with RLS policies?
 * @param {string[]} files - All relative file paths
 * @param {string} projectRoot - Absolute project root
 * @returns {import('./types').Finding[]}
 */
function checkSupabaseSecurity(files, projectRoot) {
  const findings = [];

  // Find files that call createClient with what looks like a hardcoded key
  const supabaseClientFiles = [];
  const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
  const createClientPattern = /createClient\s*\(/;

  for (const relPath of files) {
    const ext = path.extname(relPath).toLowerCase();
    if (!['.js', '.jsx', '.ts', '.tsx', '.mjs'].includes(ext)) continue;

    const fullPath = path.join(projectRoot, relPath);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch { continue; }

    if (createClientPattern.test(content) && jwtPattern.test(content)) {
      const isClientSide = CLIENT_PATHS.some((p) => p.test(relPath));
      supabaseClientFiles.push({ relPath, content, isClientSide });
    }
  }

  if (supabaseClientFiles.length === 0) return findings;

  // Check for RLS: look for supabase/migrations folder with policy statements
  const hasRLS = checkForRLS(files, projectRoot);

  for (const { relPath, content, isClientSide } of supabaseClientFiles) {
    // Check if the key is the service_role key (catastrophic)
    // Only match service_role inside a string literal (quoted), not in comments or variable names
    const serviceRoleInString = /['"`].*service[_-]?role.*['"`]/i;
    if (serviceRoleInString.test(content)) {
      const lines = content.split('\n');
      const lineIdx = lines.findIndex((l) => serviceRoleInString.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
      if (lineIdx >= 0) {
        findings.push({
          id: 'supabase-service-role-key',
          severity: 'critical',
          title: 'Supabase service_role key detected in source code',
          file: relPath,
          line: lineIdx + 1,
          description: 'The Supabase service_role key has FULL access to your database, bypassing all Row Level Security. This is catastrophic if exposed in client-side code.\n\nImpact: An attacker gets unrestricted read/write/delete access to every table in your database — including auth.users.',
          fix: 'The service_role key must NEVER be in client-side code. Use it only in server-side code (API routes, serverless functions). For client-side, use the anon key with RLS enabled.',
        });
        continue;
      }
    }

    if (isClientSide && !hasRLS) {
      const lines = content.split('\n');
      const lineIdx = lines.findIndex((l) => createClientPattern.test(l));
      findings.push({
        id: 'supabase-no-rls',
        severity: 'critical',
        title: 'Supabase client in client-side code with no RLS detected',
        file: relPath,
        line: lineIdx >= 0 ? lineIdx + 1 : undefined,
        description: 'Your Supabase client is initialized in client-side code, but no Row Level Security migrations were found. Without RLS, anyone with the anon key can query your entire database.\n\nImpact: An attacker can open DevTools, grab the anon key, and run `SELECT * FROM users` (or any table) directly against your database.',
        fix: 'Enable Row Level Security on every table in your Supabase dashboard, or add RLS policies via migrations in supabase/migrations/. At minimum: `ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;`',
      });
    }
  }

  return findings;
}

/**
 * Check if the project has RLS policies in supabase migrations.
 * @param {string[]} files
 * @param {string} projectRoot
 * @returns {boolean}
 */
function checkForRLS(files, projectRoot) {
  // Look for supabase/migrations directory
  const migrationFiles = files.filter((f) =>
    f.startsWith('supabase/migrations/') || f.startsWith('supabase\\migrations\\')
  );

  if (migrationFiles.length === 0) return false;

  // Check if any migration file mentions RLS
  for (const mf of migrationFiles) {
    try {
      const content = fs.readFileSync(path.join(projectRoot, mf), 'utf-8');
      if (/ENABLE ROW LEVEL SECURITY/i.test(content) || /CREATE POLICY/i.test(content)) {
        return true;
      }
    } catch { continue; }
  }

  return false;
}

module.exports = { checkSupabaseSecurity };
