import { describe, it, expect } from 'bun:test';
import { detectSecrets } from '../src/secrets';

// Build test secrets at runtime to avoid GitHub push protection
const STRIPE_LIVE = ['sk', 'live', 'TESTVALUE0000000000000000'].join('_');
const STRIPE_TEST = ['sk', 'test', 'TESTVALUE0000000000000000'].join('_');

describe('detectSecrets', () => {
  // --- Supabase anon key (JWT format) ---
  describe('Supabase anon key', () => {
    it('detects JWT-format key in source code', () => {
      const content = `const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRlc3QiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMH0.abc123def456ghi789jkl012mno345pqr678stu901vwx";`;
      const findings = detectSecrets('src/lib/supabase.ts', content);
      expect(findings.length).toBe(1);
      expect(findings[0].id).toBe('secret-supabase-anon-key');
    });
  });

  // --- OpenAI key ---
  describe('OpenAI key', () => {
    it('detects sk- prefixed key', () => {
      const content = `const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz123456";`;
      const findings = detectSecrets('src/api/openai.ts', content);
      expect(findings.some(f => f.id === 'secret-openai-key')).toBe(true);
    });
  });

  // --- Stripe key ---
  describe('Stripe key', () => {
    it('detects sk_live_ key', () => {
      const content = `const stripe = new Stripe("${STRIPE_LIVE}");`;
      const findings = detectSecrets('src/payments/stripe.ts', content);
      expect(findings.some(f => f.id === 'secret-stripe-key')).toBe(true);
    });

    it('detects sk_test_ key', () => {
      const content = `const stripe = new Stripe("${STRIPE_TEST}");`;
      const findings = detectSecrets('src/payments/stripe.ts', content);
      expect(findings.some(f => f.id === 'secret-stripe-key')).toBe(true);
    });
  });

  // --- AWS key ---
  describe('AWS access key', () => {
    it('detects AKIA prefixed key', () => {
      const content = `const awsKey = "AKIAIOSFODNN7REALKEY";`;
      const findings = detectSecrets('src/config/aws.ts', content);
      expect(findings.some(f => f.id === 'secret-aws-access-key')).toBe(true);
    });
  });

  // --- Database URL ---
  describe('Database URL', () => {
    it('detects postgres connection string', () => {
      const content = `const db = "postgres://admin:secretpass@db.myhost.com:5432/mydb";`;
      const findings = detectSecrets('src/db/connection.ts', content);
      expect(findings.some(f => f.id === 'secret-database-url')).toBe(true);
    });

    it('detects mongodb connection string', () => {
      const content = `const mongo = "mongodb://root:password123@mongo.myhost.com:27017/app";`;
      const findings = detectSecrets('src/db/mongo.ts', content);
      expect(findings.some(f => f.id === 'secret-database-url')).toBe(true);
    });
  });

  // --- Private key ---
  describe('Private key', () => {
    it('detects RSA private key header', () => {
      const content = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----`;
      const findings = detectSecrets('src/auth/key.pem', content);
      expect(findings.some(f => f.id === 'secret-private-key')).toBe(true);
    });

    it('detects generic private key header', () => {
      const content = `-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----`;
      const findings = detectSecrets('src/certs/private.key', content);
      expect(findings.some(f => f.id === 'secret-private-key')).toBe(true);
    });
  });

  // --- Generic API key ---
  describe('Generic API key', () => {
    it('detects api_key assignment', () => {
      const content = `const api_key = "abcdef1234567890abcdef";`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.some(f => f.id === 'secret-generic-api-key')).toBe(true);
    });
  });

  // --- False positive: placeholders ---
  describe('placeholder filtering', () => {
    it('does NOT flag your-key-here', () => {
      const content = `const key = "your-key-here-abcdefghijklmnop";`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag xxx placeholder', () => {
      const content = `const api_key = "xxxxxxxxxxxxxxxxxxxx";`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag TODO placeholder', () => {
      const content = `const api_key = "TODO_replace_with_real_key";`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag example placeholder', () => {
      const content = `const api_key = "example_key_for_docs_1234";`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.length).toBe(0);
    });
  });

  // --- False positive: comments ---
  describe('comment filtering', () => {
    it('does NOT flag secrets in // comments', () => {
      const content = `// const key = "${STRIPE_LIVE}";`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag secrets in # comments', () => {
      const content = `# api_key = "abcdef1234567890abcdef"`;
      const findings = detectSecrets('src/config.py', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag secrets in * comments (JSDoc)', () => {
      const content = `* Example: ${STRIPE_LIVE}`;
      const findings = detectSecrets('src/config.ts', content);
      expect(findings.length).toBe(0);
    });
  });

  // --- False positive: test files ---
  describe('test file filtering', () => {
    it('does NOT flag secrets in .test.ts files', () => {
      const content = `const key = "${STRIPE_LIVE}";`;
      const findings = detectSecrets('src/payments/stripe.test.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag secrets in __tests__ directory', () => {
      const content = `const key = "${STRIPE_LIVE}";`;
      const findings = detectSecrets('src/__tests__/stripe.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag secrets in fixtures directory', () => {
      const content = `const key = "AKIAIOSFODNN7REALKEY";`;
      const findings = detectSecrets('src/fixtures/aws-config.ts', content);
      expect(findings.length).toBe(0);
    });

    it('does NOT flag secrets in .spec.ts files', () => {
      const content = `const db = "postgres://admin:pass@localhost:5432/test";`;
      const findings = detectSecrets('src/db.spec.ts', content);
      expect(findings.length).toBe(0);
    });
  });
});
