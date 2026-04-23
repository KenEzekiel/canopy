import { describe, it, expect } from 'bun:test';
import { detectTestCredentials } from '../src/credentials';

describe('detectTestCredentials', () => {
  describe('detection in production code', () => {
    it('detects admin/password in production code', () => {
      const content = `const user = "admin", pass = "password";`;
      const findings = detectTestCredentials('src/auth/login.ts', content);
      expect(findings.length).toBe(1);
      expect(findings[0].id).toBe('hardcoded-test-credentials');
    });

    it('detects admin/admin123', () => {
      const content = `const creds = { user: "admin", password: "admin123" };`;
      const findings = detectTestCredentials('src/auth/login.ts', content);
      expect(findings.length).toBe(1);
    });

    it('detects password=password', () => {
      const content = `password = "password"`;
      const findings = detectTestCredentials('src/config.ts', content);
      expect(findings.length).toBe(1);
    });

    it('detects password=123456', () => {
      const content = `password = "123456"`;
      const findings = detectTestCredentials('src/config.ts', content);
      expect(findings.length).toBe(1);
    });

    it('detects secret=secret', () => {
      const content = `secret = "secret"`;
      const findings = detectTestCredentials('src/config.ts', content);
      expect(findings.length).toBe(1);
    });
  });

  describe('false positives: test files', () => {
    it('does NOT flag in .test.ts files', () => {
      const content = `const user = "admin", pass = "password";`;
      const findings = detectTestCredentials('src/auth/login.test.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag in __tests__ directory', () => {
      const content = `const user = "admin", pass = "password";`;
      const findings = detectTestCredentials('src/__tests__/auth.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag in .spec.ts files', () => {
      const content = `password = "password"`;
      const findings = detectTestCredentials('src/auth.spec.ts', content);
      expect(findings.length).toBe(0);
    });
  });

  describe('false positives: seed/fixture files', () => {
    it('does NOT flag in seed files', () => {
      const content = `const user = "admin", pass = "password";`;
      const findings = detectTestCredentials('src/db/seed.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag in fixture files', () => {
      const content = `password = "password"`;
      const findings = detectTestCredentials('src/fixtures/users.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag in mock files', () => {
      const content = `const creds = { user: "admin", password: "admin123" };`;
      const findings = detectTestCredentials('src/mocks/auth.ts', content);
      expect(findings.length).toBe(0);
    });
  });

  describe('false positives: comments', () => {
    it('does NOT flag in // comments', () => {
      const content = `// const user = "admin", pass = "password";`;
      const findings = detectTestCredentials('src/auth/login.ts', content);
      expect(findings.length).toBe(0);
    });
  });

  describe('non-code files', () => {
    it('does NOT scan .md files', () => {
      const content = `password = "password"`;
      const findings = detectTestCredentials('README.md', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT scan .json files', () => {
      const content = `{ "password": "password" }`;
      const findings = detectTestCredentials('config.json', content);
      expect(findings.length).toBe(0);
    });
  });
});
