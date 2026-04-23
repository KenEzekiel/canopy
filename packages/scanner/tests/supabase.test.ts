import { describe, it, expect } from 'bun:test';
import { checkSupabaseSecurity } from '../src/supabase';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function createTempProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canopy-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return dir;
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('checkSupabaseSecurity', () => {
  describe('client-side Supabase without RLS', () => {
    it('detects createClient with JWT in client-side code and no RLS', () => {
      const projectDir = createTempProject({
        'src/lib/supabase.ts': `
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  "https://test.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMH0.abc123def456ghi789jkl012mno345pqr678stu901vwx"
);`,
      });

      try {
        const files = ['src/lib/supabase.ts'];
        const findings = checkSupabaseSecurity(files, projectDir);
        expect(findings.some(f => f.id === 'supabase-no-rls')).toBe(true);
      } finally {
        cleanup(projectDir);
      }
    });
  });

  describe('service role key', () => {
    it('detects service_role key in source code', () => {
      const projectDir = createTempProject({
        'src/api/admin.ts': `
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  "https://test.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMH0.abc123def456ghi789jkl012mno345pqr678stu901vwx",
  { auth: { autoRefreshToken: false } }
);
// Using service_role for admin operations
const adminClient = createClient(url, "service_role_key");`,
      });

      try {
        const files = ['src/api/admin.ts'];
        const findings = checkSupabaseSecurity(files, projectDir);
        expect(findings.some(f => f.id === 'supabase-service-role-key')).toBe(true);
      } finally {
        cleanup(projectDir);
      }
    });
  });

  describe('with RLS migrations present', () => {
    it('does NOT flag no-rls when RLS migrations exist', () => {
      const projectDir = createTempProject({
        'src/lib/supabase.ts': `
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(
  "https://test.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMH0.abc123def456ghi789jkl012mno345pqr678stu901vwx"
);`,
        'supabase/migrations/001_enable_rls.sql': `
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid() = id);`,
      });

      try {
        const files = ['src/lib/supabase.ts', 'supabase/migrations/001_enable_rls.sql'];
        const findings = checkSupabaseSecurity(files, projectDir);
        expect(findings.some(f => f.id === 'supabase-no-rls')).toBe(false);
      } finally {
        cleanup(projectDir);
      }
    });
  });

  describe('no Supabase usage', () => {
    it('returns no findings when no createClient + JWT found', () => {
      const projectDir = createTempProject({
        'src/index.ts': `console.log("hello");`,
      });

      try {
        const files = ['src/index.ts'];
        const findings = checkSupabaseSecurity(files, projectDir);
        expect(findings.length).toBe(0);
      } finally {
        cleanup(projectDir);
      }
    });
  });
});
