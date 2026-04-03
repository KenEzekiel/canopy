'use strict';

/**
 * Secret detection regex patterns from the brief.
 * Each pattern has a name, regex, severity, and optional context.
 */
const SECRET_PATTERNS = [
  {
    name: 'Supabase Anon Key',
    pattern: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    severity: 'critical',
    context: 'supabase',
    id: 'secret-supabase-anon-key',
    description: 'Your Supabase anon key is hardcoded in source code. Anyone can see this in browser DevTools and query your database directly.',
    fix: 'Move the key to an environment variable (e.g. NEXT_PUBLIC_SUPABASE_ANON_KEY) and ensure Row Level Security is enabled on all tables.',
  },
  {
    name: 'Firebase Config',
    pattern: /apiKey\s*[:=]\s*["']AIza[A-Za-z0-9_-]{35}["']/,
    severity: 'critical',
    id: 'secret-firebase-config',
    description: 'Firebase API key is hardcoded in source code.',
    fix: 'Move Firebase config to environment variables.',
  },
  {
    name: 'OpenAI API Key',
    pattern: /sk-(?!_(live|test)_)[A-Za-z0-9\-]{20,}/,
    severity: 'critical',
    id: 'secret-openai-key',
    description: 'OpenAI API key is exposed in source code. This allows anyone to make API calls billed to your account.',
    fix: 'Move the key to an environment variable (OPENAI_API_KEY) and never commit it.',
  },
  {
    name: 'Stripe Secret Key',
    pattern: /sk_(live|test)_[A-Za-z0-9]{20,}/,
    severity: 'critical',
    id: 'secret-stripe-key',
    description: 'Stripe secret key is exposed in source code. This gives full access to your Stripe account.',
    fix: 'Move the key to an environment variable (STRIPE_SECRET_KEY).',
  },
  {
    name: 'AWS Access Key',
    pattern: /AKIA[A-Z0-9]{16}/,
    severity: 'critical',
    id: 'secret-aws-access-key',
    description: 'AWS access key ID is exposed in source code.',
    fix: 'Use environment variables or AWS IAM roles instead of hardcoding credentials.',
  },
  {
    name: 'Generic API Key',
    pattern: /(api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i,
    severity: 'high',
    id: 'secret-generic-api-key',
    description: 'A potential API key or secret is hardcoded in source code.',
    fix: 'Move secrets to environment variables and load them at runtime.',
  },
  {
    name: 'Database URL',
    pattern: /(postgres|mysql|mongodb|redis):\/\/[^:\s"']+:[^@\s"']+@[^\s"']+/i,
    severity: 'critical',
    id: 'secret-database-url',
    description: 'Database connection string with credentials is exposed in source code.',
    fix: 'Move the connection string to an environment variable (DATABASE_URL).',
  },
  {
    name: 'Private Key',
    pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    severity: 'critical',
    id: 'secret-private-key',
    description: 'A private key is committed in source code.',
    fix: 'Remove the private key from source control and store it securely (e.g. secrets manager, env var).',
  },
];

/**
 * Files/directories to always skip when walking the tree.
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '.turbo', '.vercel', '.output', 'vendor', '__pycache__',
]);

/**
 * File extensions to scan for secrets and code patterns.
 */
const SCANNABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml',
  '.py', '.rb', '.go', '.rs', '.java',
  '.html', '.htm', '.vue', '.svelte',
  '.env', '.cfg', '.conf', '.ini',
  '.sh', '.bash', '.zsh',
  '.md', '.txt',
  '.pem', '.key', '.cert',
]);

module.exports = { SECRET_PATTERNS, SKIP_DIRS, SCANNABLE_EXTENSIONS };
