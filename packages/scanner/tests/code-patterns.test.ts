import { describe, it, expect } from 'bun:test';
import { checkCodePatterns } from '../src/code-patterns';

describe('checkCodePatterns', () => {
  // --- CORS wildcard + credentials ---
  describe('CORS wildcard', () => {
    it('detects credentials + wildcard origin', () => {
      const content = `app.use(cors({ origin: '*', credentials: true }));`;
      const findings = checkCodePatterns('src/server.ts', content);
      expect(findings.some(f => f.id === 'cors-credentials-wildcard')).toBe(true);
    });

    it('detects wildcard origin without credentials as medium', () => {
      const content = `app.use(cors({ origin: '*' }));`;
      const findings = checkCodePatterns('src/server.ts', content);
      expect(findings.some(f => f.id === 'cors-wildcard-origin')).toBe(true);
      expect(findings.find(f => f.id === 'cors-wildcard-origin')!.severity).toBe('medium');
    });

    it('detects Access-Control-Allow-Origin header wildcard', () => {
      const content = `res.setHeader('Access-Control-Allow-Origin', '*');`;
      const findings = checkCodePatterns('src/middleware.ts', content);
      expect(findings.some(f => f.id === 'cors-wildcard-origin')).toBe(true);
    });

    it('does NOT flag CORS in comments', () => {
      const content = `// app.use(cors({ origin: '*', credentials: true }));`;
      const findings = checkCodePatterns('src/server.ts', content);
      expect(findings.filter(f => f.id.startsWith('cors-')).length).toBe(0);
    });

    it('does NOT flag CORS in test files', () => {
      const content = `app.use(cors({ origin: '*', credentials: true }));`;
      const findings = checkCodePatterns('src/__tests__/server.ts', content);
      expect(findings.filter(f => f.id.startsWith('cors-')).length).toBe(0);
    });
  });

  // --- SQL injection ---
  describe('SQL injection', () => {
    it('detects template literal in .query()', () => {
      const content = 'db.query(`SELECT * FROM users WHERE id = ${userId}`);';
      const findings = checkCodePatterns('src/db/users.ts', content);
      expect(findings.some(f => f.id === 'sql-injection-template-literal')).toBe(true);
    });

    it('detects template literal in .execute()', () => {
      const content = 'conn.execute(`DELETE FROM orders WHERE id = ${orderId}`);';
      const findings = checkCodePatterns('src/db/orders.ts', content);
      expect(findings.some(f => f.id === 'sql-injection-template-literal')).toBe(true);
    });

    it('does NOT flag SQL injection in comments', () => {
      const content = '// db.query(`SELECT * FROM users WHERE id = ${userId}`);';
      const findings = checkCodePatterns('src/db/users.ts', content);
      expect(findings.filter(f => f.id === 'sql-injection-template-literal').length).toBe(0);
    });

    it('does NOT flag SQL injection in test files', () => {
      const content = 'db.query(`SELECT * FROM users WHERE id = ${userId}`);';
      const findings = checkCodePatterns('src/__tests__/db.ts', content);
      expect(findings.filter(f => f.id === 'sql-injection-template-literal').length).toBe(0);
    });
  });

  // --- Console.log sensitive ---
  describe('console.log sensitive data', () => {
    it('detects console.log with password variable', () => {
      const content = `console.log("Login:", password);`;
      const findings = checkCodePatterns('src/auth/login.ts', content);
      expect(findings.some(f => f.id === 'console-log-sensitive')).toBe(true);
    });

    it('detects console.log with token variable', () => {
      const content = `console.log("Token:", token);`;
      const findings = checkCodePatterns('src/auth/session.ts', content);
      expect(findings.some(f => f.id === 'console-log-sensitive')).toBe(true);
    });

    it('detects console.log with secret variable', () => {
      const content = `console.log(secret);`;
      const findings = checkCodePatterns('src/auth/session.ts', content);
      expect(findings.some(f => f.id === 'console-log-sensitive')).toBe(true);
    });

    it('does NOT flag console.log in comments', () => {
      const content = `// console.log("Login:", password);`;
      const findings = checkCodePatterns('src/auth/login.ts', content);
      expect(findings.filter(f => f.id === 'console-log-sensitive').length).toBe(0);
    });

    it('does NOT flag console.log in test files', () => {
      const content = `console.log("Login:", password);`;
      const findings = checkCodePatterns('src/__tests__/auth.ts', content);
      expect(findings.filter(f => f.id === 'console-log-sensitive').length).toBe(0);
    });
  });

  // --- Webhook without signature ---
  describe('webhook without signature verification', () => {
    it('detects webhook route without signature check', () => {
      const content = `app.post("/api/webhook", async (req, res) => {\n  const event = req.body;\n  processEvent(event);\n});`;
      const findings = checkCodePatterns('src/routes/webhook.ts', content);
      expect(findings.some(f => f.id === 'webhook-no-signature-verification')).toBe(true);
    });

    it('does NOT flag webhook with constructEvent (Stripe)', () => {
      const content = `app.post("/api/webhook", async (req, res) => {\n  const event = stripe.webhooks.constructEvent(body, sig, secret);\n});`;
      const findings = checkCodePatterns('src/routes/webhook.ts', content);
      expect(findings.filter(f => f.id === 'webhook-no-signature-verification').length).toBe(0);
    });

    it('does NOT flag webhook with HMAC verification', () => {
      const content = `app.post("/api/webhook", async (req, res) => {\n  const hmac = createHmac('sha256', secret);\n});`;
      const findings = checkCodePatterns('src/routes/webhook.ts', content);
      expect(findings.filter(f => f.id === 'webhook-no-signature-verification').length).toBe(0);
    });

    it('does NOT flag webhook in test files', () => {
      const content = `app.post("/api/webhook", async (req, res) => {\n  processEvent(req.body);\n});`;
      const findings = checkCodePatterns('src/__tests__/webhook.ts', content);
      expect(findings.filter(f => f.id === 'webhook-no-signature-verification').length).toBe(0);
    });
  });

  // --- Non-code files ---
  describe('non-code files', () => {
    it('does NOT scan .md files', () => {
      const content = `app.use(cors({ origin: '*', credentials: true }));`;
      const findings = checkCodePatterns('README.md', content);
      expect(findings.length).toBe(0);
    });
  });
});
